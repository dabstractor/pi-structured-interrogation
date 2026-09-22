# State & Persistence — pi-interrogator

## Question state machine

```
                 upsert(new id)                    user answers/edits
   ┌──────────┐ ───────────────► ┌───────────┐ ────────────────────► ┌──────────────────┐
   │ (absent) │                  │   open    │                      │ answered(pending) │
   └──────────┘                  └─────┬─────┘ ◄──────────────────── └────────┬─────────┘
                                       │ upsert changed options              │ ctrl+s
        dependsOn unmet (local)        │ (answer reset + marker)             ▼
   ┌──────────┐ ◄──────────────────────┤                          ┌──────────────────┐
   │   moot   │        ┌───────────┐   │                          │    submitted     │
   └────┬─────┘        │  reasked  │ ◄─┘                          └────────┬─────────┘
        │ re-met       └─────┬─────┘                                       │ agent_settled
        ▼                    │ user answers                                │ (no re-ask)
      open ◄─────────────────┘                                             ▼
                                                                        ┌──────────────────┐
   ┌───────────┐  upsert omission                                        │ closed (archived) │
   │ withdrawn │ ◄──────────────────── any status                        └────────┬─────────┘
   └───────────┘                                                                  │ user edits
        closed+reopen via re-upsert with same id (rev+1) ─────────────────────────┘
```

- `moot`/`withdrawn` are terminal-until-re-upsert; both stay visible (dimmed, with reason) — the audit trail (Q34=A).
- Editing a closed answer re-marks it `answered(pending)`; next submission diff marks it `(changed)` (Q24=B).
- Answer edits apply through the ripple confirm (ui-spec.md) before entering `answered(pending)`.

## rev and epoch semantics

- `rev` (per question, integer, starts 1): bumps on any content mutation (agent upsert text/options/dependsOn, or withdrawal-re-add). The model must echo the current rev when upserting an existing question. User answers do **not** bump rev (answers are epoch territory).
- `epoch` (session, integer, starts 1): bumps on every submission — including every auto-submitted one (AUTOSUBMIT-001; each firing is a full submission). Any `questions`/`answers` call must carry the epoch it was based on (top-level `epoch` param). Read is never guarded. Both guards reject with current state + delta digest (tool-protocol.md).
- Snapshots: full state copied on every submission (bounded ring of 10) — powers diff cards and post-hoc recovery; not user-facing undo in v1.

## Answer shape (WRITEIN-001)

`answer = { value, at, text?, custom? }`. `custom: true` marks a WRITE-IN: `value` holds the user's own text (not an option value), committed via the synthetic Other row (panel) or a `customText`-only bridge submission. Renderers, diff cards, and the completion record display write-ins as `✎ {text}`. Replay/reconstruction is value-first and needs no special case; the bridge's answer validation accepts custom values as-is (they are not checked against option lists).

## Storage (three layers, one source of truth)

1. **In-memory `InterrogationState`** (state.ts) — authoritative while the process lives. Mutations emit change events consumed by panel/widget/renderers.
2. **Tool result `details`** (canonical, Q5=A) — every interrogate result carries the full post-call state. Branch-correct by construction: reconstruction replays the *latest interrogate result on the current branch*, then applies subsequent `interrogation-submission` messages' `details.changed` deltas.
3. **`interrogation-state` custom entries** (mirror, Q37 residue) — debounced (2s) `appendEntry` on mutation; not in model context; fallback when compaction drops the tool-result entry behind the boundary.

## Reconstruction (`session_start`)

```
1. entries = buildContextEntries()
2. find last entry: toolResult for "interrogate" with details.state → base = details.state
   else scan custom entries type "interrogation-state" (newest first) → base
   else: no state; done
3. replay subsequent interrogation-submission messages: apply details.changed (answers, epochs)
4. if any question status ∈ {open, reasked, answered, submitted, moot, withdrawn} (non-empty set):
     TUI: NEVER open the panel (SURFACE-002 — session-start auto-open is
       disabled entirely; the user runs /interrogate). Set the suspend widget
       line directly when resumable questions exist — it is the ONLY cue.
       [The `session_tree` run of the same algorithm never opens anything
       either, see Branching.]
     non-TUI: mark fallback active
5. recompute dependsOn moot-ness from current answers (cheap, idempotent)
```

## Compaction (`session_before_compact`)

Handler returns custom instructions for the summarizer (FR-29), verbatim:

> Preserve verbatim: the user's stated goals and plan constraints from all messages (including side conversations), all interrogation answers and later changes, the interrogation goal, and the fact that current interrogation state is available via `interrogate({})`.

No other compaction machinery. Post-compaction, the model pull-refreshes; reconstruction survives via the entry mirror; the completion injection is unaffected.

## Branching (/tree, /fork, /resume)

`session_start` reconstruction is branch-relative (`buildContextEntries()`), so forked/resumed sessions inherit exactly the questions/answers visible on that branch. The entry-mirror fallback scans the same branch. Never cache state across `session_shutdown`.

### Tree navigation (`session_tree`) — silent, never a surface

Mid-session `/tree` navigation fires `session_tree` — NOT `session_start`
(pi reserves `session_start` for session replacement: startup | reload | new |
resume | fork). The same reconstruction algorithm re-runs against the
destination branch (raw branch walk, same base selection, same delta replay,
same moot recompute), with one absolute rule:

> **The panel NEVER auto-opens or reopens on tree navigation.** Surfacing is
> user-driven (`/interrogate`) or model-driven (an upsert while suspended,
> `{reopen:true}`) — never navigation-driven. A user who is not using the
> interrogation must never see it appear because they browsed the tree.

Consequences:

- State still follows the branch — branch-relativity is not optional: the
  singleton is reset and rebuilt from the destination branch; the non-TUI
  digest fallback flag is recomputed (it shapes tool results, never surfaces).
- Panel open at navigation time → suspends (descend, never destroy): an open
  panel must never keep rendering the abandoned branch's questions.
- Panel suspended → stays suspended, with the host's stored state references
  retargeted onto the reconstructed instance (and the current UI surface), so
  the next deliberate resume rehydrates from the branch the user is on now —
  never the pre-navigation state — and the suspend reminder line reflects the
  destination branch.
- Destination branch has no interrogation (or only a completed one) → full
  teardown: open panel suspended, reminder widget cleared, resume record
  disposed — nothing may stay resumable advertising a foreign branch's
  questions.
- FR-34 `onRestored` bridge emission does NOT fire on `session_tree` —
  re-emitting would surface the question set on remote clients exactly the
  way the panel used to pop on the TUI.

Design rationale: navigation is a read-only act on the user's part. Any
surprise surface movement on a read-only act is a bug, not a convenience.

## Auto-close algorithm (Q9=B)

```
on submission delivery: submittedRun = false
on tool_execution_end (interrogate, action=upsert): mark each touched submitted question reasked; submittedRun = true
on agent_settled:
   for q in submitted-at-current-epoch:
      if q not reasked this run → status = closed (archived)
   if no open/reasked/answered/moot questions remain → completion flow:
      inject interrogation-completion (full record, once) → dismiss panel → clear in-memory state
Aborted runs count as settled (agent_settled fires; the model saw the answers before abort and can re-ask).
```

Submissions now also arrive via auto-submit (AUTOSUBMIT-001) — the per-submission contracts (one epoch bump, one delta, one close-pass arming via `noteSubmissionDelivered`) are unchanged; auto-submit simply fires the same pipeline more often. A model turn triggered by an auto-submission may interleave with further user edits; each submission's snapshot ring keeps the diffs correct.

## Drafts lifecycle (R4)

Panel-local `{questionId → {value, text}}` + `batchNote`. Preserved across navigation, view toggles, upserts, suspend/resume. Flushed into state on submit; cleared on submit or explicit clear. **Not** written to any persistent layer — restart loses drafts by design (documented limitation, Q6=B).

Role binding (WRITEIN-002): a slot's text is elaboration (`answer.text`) when its question's answer is a real option, and the answer itself (`answer.value`, `custom: true`) when the answer came via Other or the question is `type:"text"`; the binding is evaluated at commit/submit time from the current selection. Superseding a write-in with an option accept keeps the slot (R4) and re-binds it as elaboration.

## Completion record format (the one full injection)

```
INTERROGATION COMPLETE — {goal}
[group] {id} {title}: {answer value/label} {★ if recommendation followed} {— free text}
…every question, grouped, in order…
NOTES: {batch notes in order}
Withdrawn/moot: {ids + reasons}
```
Rendered as the recap card (renderer); `content` is this record verbatim — the model writes the spec from it (commitment 2, Q30).

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
- Answer edits apply through the ripple confirm (ui-spec.md) before entering `answered(pending)`. A same-value re-commit is not an edit — no confirm, no state write (ANSWER-PIN-001).

## rev and epoch semantics

- `rev` (per question, integer, starts 1): bumps on any content mutation (agent upsert text/options/dependsOn, or withdrawal-re-add). The model must echo the current rev when upserting an existing question. User answers do **not** bump rev (answers are epoch territory).
- `epoch` (session, integer, starts 1): bumps on every submission — including every auto-submitted one (AUTOSUBMIT-001; each firing is a full submission). Any `questions`/`answers` call must carry the epoch it was based on (top-level `epoch` param). Read is never guarded. Both guards reject with current state + delta digest (tool-protocol.md).
- Snapshots: full state copied on every submission (bounded ring of 10) — powers diff cards and post-hoc recovery; not user-facing undo in v1.

## Answer shape (WRITEIN-001)

`answer = { value, at, text?, custom? }`. `custom: true` marks a WRITE-IN: `value` holds the user's own text (not an option value), committed via the synthetic Other row (panel), shown as `✎ {text}`. Renderers, diff cards, and the completion record display write-ins as `✎ {text}`. Replay/reconstruction is value-first and needs no special case.

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

Submissions now also arrive via auto-submit (AUTOSUBMIT-001) — the per-submission contracts (one epoch bump, one delta, one close-pass arming via `noteSubmissionDelivered`) are unchanged; auto-submit simply fires the same pipeline more often. A model turn triggered by an auto-submission may interleave with further user edits; each submission's snapshot ring keeps the diffs correct. The ring also captures the agent-settled close pass: every close pass that actually closes ids appends ONE snapshot at the submission's existing epoch — no epoch bump — whose question statuses are `closed` (a close pass with nothing to close appends nothing). These close-pass entries are what let post-archive edits diff as `(changed)` (AC-13: the archived snapshot supplies the `before.status === "closed"` side), and `digestSince` treats them as no-ops: consecutive same-epoch pairs whose answer signatures are identical contribute zero segments, so a submitted→closed status flip is digest-invisible.

## Drafts lifecycle (R4)

The shipped draft store holds `{questionId → {value, text}}` + `batchNote` in extension memory across navigation, view toggles, upserts and suspend/resume. Its restart limitation (Q6=B) is superseded by [Local input recovery](#local-input-recovery).

Role binding (WRITEIN-002): a slot's text is elaboration (`answer.text`) when its question's answer is a real option, and the answer itself (`answer.value`, `custom: true`) when the answer came via Other or the question is `type:"text"`; the binding is evaluated at commit/submit time from the current selection. Superseding a write-in with an option accept keeps the slot (R4) and re-binds it as elaboration.

## Side chat (ephemeral by design — SIDECHAT-002)

The live chat (`{questionId, messages, usage, …}`) is an in-memory singleton. Opening another chat replaces it; answering/closing its question, `/clear`, `/new` or shutdown discards the conversation. Its transcript is not question state or main-session content: no tool-result details, session entries, compaction changes or main-transcript renderer. Recovery concerns the user's input, not the conversation.

## Local input recovery

**New requirements, not shipped.** The shipped panel keeps drafts in memory. The following extends R4 to abrupt process termination and failed hibernation without changing when the panel opens or how answers are submitted.

- **Capture on edit, before Enter.** Whenever the editor receives an edit (including paste), save its full expanded string locally: Other/write-in, text answer, elaboration, batch note or active side-chat composer. Restore the exact string, including newlines, Unicode and leading/trailing whitespace, only to its originating session, branch, question (if any) and field. Do not save a paste placeholder or display preview. Saving must progress during continuous typing; do not wait indefinitely for idle, send, blur, suspend or shutdown.
- **Recovery point.** A completed local save must survive restart within the OS and storage system's durability guarantees. Replace it atomically: an interrupted write leaves the previous or new complete value, never a torn one. Older writes and incidental empty buffers (initialization, view change, send cleanup) must not overwrite newer user edits. On write failure keep the last durable value and the live edit; never claim the edit was saved. Recovery guarantees the latest completed save, not keystrokes the editor never received or a write still in flight.
- **Drafts are not answers or messages.** Saving and restoring must not advance, commit, queue, submit, send, resend or call a model. “Saved locally” does not mean queued, submitted or remotely delivered. Retire only the matching recovery value on deliberate discard, replacement by the user, or successful handoff of that text; do not clear the only durable copy ahead of the handoff. For quick clarification in side chat, the active draft/last user prompt suffices; no transcript archive is required. A refused or failed send or aborted turn leaves the prompt recoverable for manual retry without overwriting newer typing.
- **Re-edit and commit.** When opening Other or a text-answer editor, use the newer matching draft if present; otherwise use the exact recorded write-in or text `answer.value`, or blank if none exists. Never seed Other with an option value. An intentional deletion to empty is an edit, not an absent draft: preserve the empty editor, not the previous answer text. Discarding the edit leaves the recorded answer intact; no delayed save or replay may resurrect a discarded draft.
- **Reject blank answer values at the shared final mutation** (`applyAnswer`), regardless of ingress (panel, side-chat apply, non-TUI `answers[]`, or submit reconciliation). Use `value.trim()` only to test emptiness; store nonblank values untrimmed. Reject before any answer/status change, advance or submission; preserve any prior answer. In the editor, keep focus and content and show an inline reason, e.g. `Answer cannot be blank`. On reconstruction/replay, a historical blank must neither replace a valid answer nor count or appear as validly answered/submitted; do not fabricate missing text. No semantic validation or additional model calls.

**Acceptance cases (new):**

1. In the real Other, text and side-chat editors, type half a response. Hard-kill pi after a completed save, **without Enter**, blur, suspend or graceful shutdown. Resume the same branch and reopen the field: exact draft, no answer or send. Repeat for elaboration and batch note.
2. Type continuously and paste multiline Unicode with surrounding whitespace; kill during typing. Verify recovery points progressed without an idle interval and the last completed one restores expanded text exactly.
3. Fail a write, delay an older write past a newer edit or discard, and switch branches with the same question ID. Verify no false saved indication, clobber, resurrection or cross-branch restore.
4. Press Enter on a nonblank write-in; kill on either side of the save/commit handoff. The saved text remains recoverable as draft or committed answer; restart neither repeats the commit nor triggers submission. Refuse a chat send, fail it, and abort a turn: reopen with the prompt recoverable and no duplicate send.
5. Reopen a committed Other/text answer; verify its exact value. Clear or enter only whitespace, attempt commit, then restart and reopen: the newer edit wins, the prior answer is unchanged, and rejection kept focus and explained why. Repeat blank rejection through non-editor ingress; replay a legacy blank with and without a prior valid answer and verify the resulting answer and counts.

## Completion record format (the one full injection)

```
INTERROGATION COMPLETE — {goal}
[group] {id} {title}: {answer value/label} {★ if recommendation followed} {— free text}
…every question, grouped, in order…
NOTES: {batch notes in order}
Withdrawn/moot: {ids + reasons}
```
Rendered as the recap card (renderer); `content` is this record verbatim — the model writes the spec from it (commitment 2, Q30).

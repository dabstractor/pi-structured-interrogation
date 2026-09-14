# System Context — bugfix changeset 001_6d9f684be2bb

Synthesis of the five research briefs (core-modules.md, delivery-completion.md,
panel-ui.md, spec-contracts.md, test-infrastructure.md). All 12 PRD defects are
CONFIRMED against HEAD. Baseline: **930 tests / 43 files green, `tsc --noEmit`
clean** — every subtask must keep both green (TDD: failing test → fix → pass).

## Repo shape

- TypeScript ESM pi extension (`package.json` `pi.extensions: ["./src/index.ts"]`),
  Node ≥22, vitest ^1 colocated `*.test.ts`, strict tsconfig, no shared test
  helpers (idioms copy-propagated: `MockPi`/`makeMockPi`, `tuiCtx()`/`printCtx()`
  ExecutorContext stubs, `seedState`/`seedQ` fixtures, `flush()`).
- Entry: `src/index.ts` — `createLifecycle(pi, { onAfterClosePass: createCompletionTrigger(...) })`,
  `registerTool(createInterrogateTool(config, { onReopen }))`, panel host +
  `DraftStore` in closure, renderers, `/interrogate` command + break-out shortcut.
- State spine: `InterrogationState` (src/state.ts) — EventEmitter singleton
  (`getState`/`setState`/`resetState`), events `changed` / `questions-upserted` /
  `epoch-bumped` / `completed-cleared`. Statuses: `open | answered | submitted |
  reasked | moot | withdrawn | closed` (7 — "closed" exists). Terminal-until-re-upsert:
  `moot`/`withdrawn` (closed reopens via re-upsert).
- Executor core: `executeInterrogate(args, ctx, config?, deps?)` (src/tool.ts) —
  routing read/upsert/record/reopen; synchronous, UI-free (h2.0 §1 invariant).

## Spec citation caveat (important for downstream agents)

spec/ files use **plain markdown headings — there are NO `h2.N` numeric ids**.
PRD references like "h2.37"/"h3.6"/"h2.38" are positional indices into those
files. Cite as `file.md → "Heading text"`. Full index table in
spec-contracts.md §0. Strongest citations per bug: spec-contracts.md §15 map.

## Confirmed defect map (fix surfaces)

| Bug | File:line | Confirmed cause |
|-----|-----------|-----------------|
| BUG-001 | tool.ts:248, state.ts:218 | upsert reuses singleton; `readonly goal`, no setter; tool.test.ts:145–154 asserts the buggy behavior (must be rewritten) |
| BUG-002 | tool.ts:248, completion.ts:~118, state.ts:394 | `completed` only ever set (never reset); singleton survives completion with goal/epoch/snapshots retained |
| BUG-003 | delivery.ts:162 | content = `Submitted {k}: {list}\n{reminder}[NOTE:…]` — no epoch segment; `diff.epoch` (pre-bump) available |
| BUG-004 | fallback.ts:197–222, lifecycle.ts:~203 | recordAnswers: applyAnswer only (+snapshot+bumpEpoch); never `markSubmitted`; close pass archives `submitted` only. PRD's detect.ts claim is MISDIRECTED — detect.ts is the TUI-only round detector; non-TUI answers flow `answers[]` → tool.ts:325 → recordAnswers |
| BUG-005 | command.ts:81–82, index.ts:172–173, panel/suspend.ts:103–105 | three duplicated `status === "open"`-only gates; `ACTIVE_STATUSES = ["open","answered","submitted","reasked"]` already exists (panel.ts:172) but is unused by these gates |
| BUG-006 | tool.ts:261 (no evaluateDependsOn after applyUpsert), depends-on.ts:163–164 (`if (!q.dependsOn \|\| q.dependsOn.length === 0) continue;`) | existing evaluateDependsOn call sites: reconstruct.ts:368, panel/ripple-confirm.ts:129, panel/actions.ts:249, delivery.ts:331 |
| BUG-007 | reconstruct.ts:289 | `applyAnswer(id, { value: to })` where `to` is snapshots.ts label-preferred summary; DiffEntry `{id,title,from,to,editedArchived}` carries NO raw value — fix must add one (computeEntries, snapshots.ts ~148–172) |
| BUG-008 | panel/actions.ts:355 | `shipDrafts(diff.changed.map(c => c.id))`; `pendingIds` (status "answered") already computed at ~343; merge rule 2 (merge.ts:181–193) resets answer → id re-enters diff as `from:"old" → to:"(unanswered)"` |
| BUG-009 | tool.ts:248–261 | `applyCaps` returns `{questions, goal, warnings}`; `capped.goal` discarded; state created with RAW goal |
| BUG-010 | guards.ts:226–234, tool-schema.ts:108 | epoch guard `if (sentEpoch !== undefined && sentEpoch !== state.epoch)` — opt-in on upsert; record path already throws on missing epoch (precedent: plain Error, not StaleError) |
| BUG-011 | panel/keys.ts:354–356, panel/panel.ts buildLines 1045–1145 | focusText unguarded; TextField rendered only in note mode + short view (`PanelView = "short" \| "deep" \| "overview"`, panel.ts:95); contrast: externalEditor keys.ts:366 gates on focus, digits ~385 gate on view |
| BUG-012 | fallback.ts:197–222, state.ts:339–346 | recordAnswers: no status check; applyAnswer unconditionally sets `answered` |

## Fix architecture (decisions pinned for this changeset)

1. **Goal mutability (BUG-001/009):** replace `readonly goal` with a private
   field + `get goal()`; add `setGoal(goal)` mutation that emits `changed`
   (all consumers — panel header layout.ts:209, read digest results.ts:125,
   fallback digest fallback.ts:125, completion delivery.ts:336/395 — already
   read live state on `changed`). tool.ts upsert path applies `capped.goal`
   on BOTH create and update. Goal applies only on upsert actions (schema
   keeps goal optional alongside `questions[]`).
2. **New interrogation after completion (BUG-002):** in tool.ts upsert case,
   when `existing?.completed === true`, swap in a FRESH singleton
   (`setState(createInterrogationState(goal))`) — epoch restarts at 1,
   completed=false, fresh snapshots (all readonly/new-instance constraints
   researched in core-modules.md). Retain previous goal when the new upsert
   sends none (FR-30: goal anchors; avoids blank header). Spec gap: epoch
   reset on new interrogation is UNSPECIFIED — this changeset pins "fresh
   epoch 1"; record in spec/decisions.md (final docs task).
3. **Submission delta (BUG-003):** content line 1 becomes
   `Submitted {k}: {list} (state epoch {n})` with **n = post-bump epoch**
   (the epoch the model must echo to avoid the guaranteed-STALE cycle; the
   pre-bump value would recreate the bug). Budget loop must account for the
   suffix. Reminder/note lines unchanged.
4. **Raw value on DiffEntry (BUG-007 enabler):** add raw post-change
   `value` (answer.value; undefined when unanswered) to DiffEntry in
   snapshots.ts computeEntries; flows through SubmissionMessage.details.changed
   into reconstruction. Display renderers keep using label summaries.
5. **Draft-safe submit (BUG-008):** ship drafts only for ids that actually
   had pending answers (`pendingIds`), and filter agent-caused resets
   (id ∉ pendingIds ∧ to === "(unanswered)") out of the SubmissionCardData
   passed to buildSubmission so k and the delta list describe only user
   shipments.
6. **Non-TUI parity (BUG-004/012):** recordAnswers skips terminal statuses
   (`moot`/`withdrawn`/`closed`) reporting them in a new `ignored` bucket
   (tool.ts record result gains a line; docstring made truthful), then marks
   recorded ids `submitted` (merge.ts markSubmitted) so the existing
   agent_settled close pass + completion predicate (BLOCKING set includes
   `submitted`; zero-question rule satisfied because recordAnswers bumps
   epoch) fire identically in print/rpc/json modes.
7. **dependsOn (BUG-006):** depends-on.ts reopens `moot` questions whose
   dependsOn is empty/absent (replace the early `continue` for that case);
   tool.ts calls `evaluateDependsOn(state)` after every `applyUpsert`
   (create and update paths) — pure state logic, safe for the synchronous
   UI-free executor.
8. **Resumable pending answers (BUG-005):** one shared predicate
   (`hasResumableQuestions(state)` over ACTIVE_STATUSES) exported from
   panel/suspend.ts (it already owns countStatuses + widget); used by
   suspend.ts widget visibility, command.ts toggle, index.ts onReopen.
   Widget line already renders "{open} open · {answered} answered".
9. **ctrl+t guard (BUG-011):** keys.ts focusText dispatch gated to
   `panel.view === "short"` (spec renders the field only there + note mode;
   deep/overview keep scrolling/navigation semantics).

## Cross-cutting invariants to preserve

- Executor stays synchronous + UI-free (h2.0 §1); panel opens only via events.
- `assertFresh` ordering (guards before mutation); StaleError propagates uncaught.
- One submission = one snapshot + one epoch bump (recordAnswers, buildSubmission).
- Merge rule 2 never touches drafts; DraftStore is closure-scoped (index.ts:100).
- Serialization tolerance: reconstruction reads UNTRUSTED history — new
  DiffEntry.value and goal updates must degrade gracefully on legacy payloads.
- tests are byte-exact on content strings (delivery.test.ts) — expect
  intentional assertion updates, never weakening.

## Where the work concentrates

- `src/tool.ts` upsert case (lines ~240–262): BUG-001, 002, 006a, 009.
- `src/fallback.ts` recordAnswers: BUG-004, 012.
- `src/panel/actions.ts` submit (309–377) + `src/snapshots.ts`: BUG-008, 007.
- Three duplicated open-count gates (command/index/suspend): BUG-005.

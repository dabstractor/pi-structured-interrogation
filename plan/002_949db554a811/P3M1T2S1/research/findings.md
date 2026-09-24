# P3.M1.T2.S1 research — unanswered gate on handleUpserted suspended-reopen

## Bug site (verified against current tree)

- `handleUpserted(ids: string[])` at `src/panel/panel.ts:1466-1491` (JSDoc at :1466; research note's "1429" has drifted — the body/anchors below are current).
  - `phase === "open"`: stuck-open remount or `currentPanel?.invalidate()` — panel already open, invalidate is a read-refresh, NOT a surface → leave ungated.
  - `phase === "suspended" && activePi && lastOpts`: unconditional `openPanel(activePi, { ...lastOpts, focusQuestionId: firstActiveUpsertedId(lastOpts.state, ids) })` — this is the gate target.
- Subscription lifecycle (armed/disarmed, verified):
  - `openPanel` arms it: panel.ts:1654-1656 (`off` then `on` on `opts.state`; `upsertState` module var at :1421).
  - `resetHostRecord` disarms: panel.ts:1505-1506.
  - `retargetHostState` re-arms on the new instance: panel.ts:1544-1546.
  - Panel disposal also drops it (panel.ts dispose path, referenced in seams doc).

## Why the gate is necessary (state.ts emission semantics)

`upsertQuestion` (state.ts:329-343) emits `questions-upserted` ([id]) on EVERY upsert — including a **description-only edit of an existing answered question** (wholesale replace, `emit` unconditional). So a description-only upsert over a fully-answered set while suspended WOULD reopen the panel today → violates SURFACE-001 / FR-D6 (PRD h2.37, h2.39: "description-only edits over an answered set surface nothing").

## Emission origin

The `questions-upserted` event only fires from real upsert mutations (tool.test.ts:690 "upsert fires questions-upserted per applied question"), never on reads — so no upsert-call gate needed here; only the unanswered predicate.

## Shared predicate (per item contract: share ONE helper, do not duplicate)

- `nextUnanswered(ordered, -1)` from `src/panel/actions.ts:106` (+ `UNANSWERED_STATUSES = ["open","reasked"]`, actions.ts:85) — this is the SAME predicate P3.M1.T1.S1's PRP uses for maybeAutoOpen gate (2). Import it in panel.ts (already imported at panel.ts:52 per T1.S1 PRP context — verify at implementation).
- `nextUnanswered(state.orderedQuestions(), -1) !== undefined` ⇒ unanswered question exists.
- Do NOT use `hasResumableQuestions` (suspend.ts:66, includes answered/submitted) and do NOT use `firstActiveUpsertedId`/ACTIVE_STATUSES (RESUMABLE_STATUSES, includes answered/submitted) for the gate.

## Existing tests to update/add

- `src/panel/panel.test.ts:645` `test_upsert_while_suspended_reopens` — upserts a NEW id (`choiceQ("q2", { status: "answered" })` but state.ts forces NEW ids to `status: "open"`), so q1 is open too → still opens under the gate. Stays green; keep as-is.
- Add: answered set + description-only upsert (EXISTING id, status "answered", edited description) while suspended → NO open (custom still 1 call, host.isSuspended() true). NOTE: re-upserting an existing id keeps caller-supplied status; to simulate description-only edit use `state.upsertQuestion(choiceQ("q1", { status: "answered", description: "edited", rev: 2 }))` with q1 already answered.
- Add: suspended with a reasked question + upsert of an existing open question → opens (reasked counts as unanswered).
- Add: completed state — out of scope here (completed interrogations teardown; P3.M1.T1.S1 owns the completed gate on maybeAutoOpen); handleUpserted fires only while a subscription exists, and resetHostRecord disarms on teardown.

## Downstream

- P3.M1.T3.S1 (tree-nav flips + AC-15) consumes this gating in scripted assertions; AC/h2.39 wording: "Model upserts while panel suspended → panel reopens only when the upsert leaves unanswered questions."

## Files touched

- `src/panel/panel.ts` (gate + JSDoc), `src/panel/panel.test.ts` (new tests). Nothing else.

# Overview & BUG-001 adjudication — bugfix changeset 001 (plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329)

Baseline (per PRD h2.0): suite green (47 files, 1321 tests), `tsc --noEmit` clean, HEAD `16d9f65`. Three verified bugs: BUG-001 (Major), BUG-002 (Minor), BUG-003 (Minor). Full research: `bug001-writein-supersede.md`, `bug002-003-ctrlg-and-stale-caps.md`, `conventions-and-testing.md` (same directory).

## BUG-001 adjudication: RESTORE the re-bind (rejected: amend docs to bless the drop)

The PRD (h2.5) defers restore-vs-amend to owner-level adjudication. This plan adjudicates **RESTORE**, on the following evidence:

1. **Three canonical sources promise the behavior** — `spec/ui-spec.md:37` (WRITEIN-002, quoted verbatim in bug001 report §(b)), `spec/product-requirements.md:84` (AC-2b tail), `README.md:225-228` + `:279`. None was ever amended.
2. **The drop was a side effect, not a ruling.** VAL-002 (plan/002 validation, Issue B) fixed a real bug — *machine* write-through (`syncBufferToQuestion` on advance) copying committed buffers into slots. The implemented fix (`consumeCommittedBuffer`, delete-at-commit) also deleted the only carrier of the superseded write-in's text. The validator's own alternative fix direction ("clear the slot when an option accept supersedes a custom:true answer, so only user-held drafts re-bind") *implicitly preserved* the re-bind; the shipped form did not.
3. **The PRD frames the drop as a contract violation** — AC-2b and R4's "never destroyed"; severity Major; the user's committed words vanish with no model-visible trace.
4. **The restore design preserves VAL-002's protections entirely**: consume-at-commit stays (machine write-throughs never become drafts); re-staging happens only at supersede time, from the recorded answer's value, and never over a user-held slot (guard 4: `draftTextFor !== undefined`). The shipped test's manual re-staging (`actions.test.ts:2223`) becomes the bug's regression proof once deleted.
5. **The amend alternative costs more and blesses data loss**: it would touch five surfaces (ui-spec:37, PRD AC-2b, README ×2, delete the shipped test) and convert an advertised feature into silent text loss.

The ruling is recorded in `spec/decisions.md` by subtask `P1.M1.T1.S1` (house format: dated section + `WRITEIN-002-RESTORE-001` bullet; precedent: 2026-10-05 ANSWER-PIN-001 amendment, itself a BUG-001-class adjudication).

## Fix designs (detail in the research files)

- **BUG-001** — new exported helper `stageSupersededWriteIn(panel, questionId, superseded, newValue)` in `src/panel/actions.ts` with 4 guards (custom-only / non-empty / not byte-equal to new value / no user-held slot via `draftTextFor !== undefined`), staged via the public `panel.commitTextDraft` seam. Wired at BOTH apply sites: `acceptOptionIndex` (`actions.ts:268-321`, after the `applyAnswer` at ~:313) and `applyConfirmedEdit` (`ripple-confirm.ts:142-166`, the FR-18 modal path) — missing the modal site leaves the bug alive for every victims>0 supersede. `reconcileDraftsForSubmit` needs no change; the stale assumption comment at `actions.ts:538` gets extended.
- **BUG-002** — ATOMIC two-part fix, fork-first: (1) `openExternalEditor` (`panel.ts:1306-1348`) apply-side fork on `bufferOwner === "note"` → `batchNote` + `drafts.setNote` (mirroring `exitNoteMode` `panel.ts:1286-1291`), else existing question-draft block; landing the fork first avoids a corruption window; (2) widen the gate `keys.ts:566` to `editorFocused` (the canonical flag at :425), keeping the bare tier-2 guard at :567; update three stale comments (keys.ts:96, :145, :562-564). Gate-only widening would be WORSE than the bug (note text would corrupt the question's draft slot). ui-spec:84 already says "editor focus (any duty)" — no spec edit.
- **BUG-003** — exactly two live stale references: `README.md:113-116` (drop the "capped at 400" clause) and `src/state.ts:324-328` setGoal JSDoc (rewrite the "enforced at the tool call-site" sentence); optional `tool.ts:201` "(BUG-009)" attribution cleanup. All other "cap" hits are legit ruling citations, pinning tests, render budgets, or frozen plan/ archives.

## Commands & conventions (from conventions-and-testing.md)

`npm test` (vitest run), `npm run typecheck` (tsc --noEmit); no linter/formatter. TDD implied per subtask. House fixtures: `makePanel()` (keys.test.ts:63), `seed()`/`choiceQ()` (actions.test.ts:64,82), `makeEditorHarness()` (panel.test.ts:1881), `vi.hoisted`+`vi.mock("node:child_process")` with real fs (keymap-ac.test.ts:52). Tests cite owning task IDs in headers. Docs: per-file docs ride with the implementing subtask (Mode A); final Mode-B task sweeps README + spec coherence (P1.M3.T2).

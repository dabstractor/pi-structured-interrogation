# Research — P1.M5.T2.S1 README behavior-claim sync

README.md (284 lines, sections: Install / Usage / Configuration / Keymap / Limitations / Development / Project structure). Verified drift points against HEAD code:

1. **Goal updatable + 400 cap**: `tool.ts` — a parsed `goal` applies on ANY upsert via `state.setGoal(capped.goal)` (FR-30, BUG-001/BUG-009); `caps.goal` 400 is enforced on stored state. README mentions goal only in the `caps.goal` comment. → Usage/model-note wording: goal updatable on every upsert, capped at 400.
2. **Second interrogation completes**: `tool.ts` ~266 — upsert after completion swaps to fresh state (epoch 1, completed=false). README silent. → small Usage note.
3. **'(state epoch {n})'**: `delivery.ts:46,64,91` — submission content line ends `(state epoch {n})` with POST-bump epoch (BUG-003), enabling one-round-trip re-asks. README Usage step 3 says "compact delta message" — fine, add epoch mention.
4. **Epoch required on upserts touching existing ids**: `guards.ts assertFresh` (BUG-010, P1.M1.T3.S1). README Usage model note says "stable ids, `rev`-guarded" → must say rev+epoch guarded.
5. **Non-TUI closes + completes**: `fallback.ts` — `recordAnswers` marks recorded ids `submitted` (BUG-004) so the close pass fires and the completion record is injected at settle; terminal-status ids go to an `ignored` bucket (BUG-012). README Limitations says "you answer in your next message" — needs the close/complete-at-settle claim.
6. **Fully-answered suspended panels resumable**: `command.ts` + `index.ts` use a shared resumable predicate over active statuses (open/answered/submitted/reasked, BUG-005); `/interrogate`, break-out key, and `{reopen:true}` all resume. README Usage step 4 — add explicit "even when everything is answered but not submitted".
7. **ctrl+t short-view-only**: `keys.ts` gates focusText on `panel.view === "short"` (BUG-011). README Usage step 2 + Keymap table row.
8. **Restart restores exact values**: `reconstruct.ts replaySubmission` prefers `DiffEntry.value` raw values, tolerates legacy label summaries (BUG-007; P1.M5.T1.S1 PRP contract, in flight — assume landed). README Limitations drafts bullet — strengthen "restores questions and submitted answers (exact values)".
9. **Drafts of re-asked questions survive submit**: `actions.ts` submit — `shipDrafts(pendingIds)` only shipped ids survive flush; agent-reset entries filtered from delta (BUG-008). README draft-store mention + Usage step 4 "drafts intact".

Out of scope: `spec/decisions.md` (P1.M5.T2.S2), keymap re-verification section (untouched — no key defaults changed), Configuration defaults (unchanged). Validation: `npx tsc --noEmit`, `npm test`, plus grep checks that stale phrases are gone.

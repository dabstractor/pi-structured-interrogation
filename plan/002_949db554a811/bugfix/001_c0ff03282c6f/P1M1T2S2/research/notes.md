# Research notes — P1.M1.T2.S2 (Discuss gesture preserves the in-flight draft)

## Verified facts (working tree + bug-002-draft-r4.md)

1. **src/panel/discuss.ts `discussInChat` (~:105-126)** — full current behavior read:
   - `const id = panel.currentId; question = state.getQuestion(id)`; returns false when absent
     (panel untouched).
   - `panel.suspend()` FIRST, then `void Promise.resolve().then(() => pi.ui.setEditorText?.(text))`.
     Single suspend call site — no other exit mechanism in the discuss path.
   - The deferred template write overwrites the MAIN pi editor — DELIBERATE ("the template IS
     the feature"; docblock: must win over preservation logic).
2. **keys.ts :483** — `if (matchesKey(data, b.discuss))` routes to the host-side discussInChat
   closure (:330). It's a config-level intercept, NOT gated on editor focus → fires mid-editing
   (that's how BUG-002 gesture 2 loses the buffer).
3. **S1 contract (parallel, Implementing)**: `writeThroughCurrentDraft()` private helper on
   InterrogationPanel, called inside `suspend()` after the resolved-guard, before `done(null)`.
   Stages: bufferOwner==="note" → batchNote + drafts.setNote; else draftSlots.set(id,{value:id,text})
   + drafts.setDraft(id,text). Skips blur/invalidate/FR-18. Empty-buffer no-op.
   ⇒ **discussInChat needs ZERO code change**: it calls panel.suspend(), which S1 armed.
   Item contract clause "if any discuss code path suspends by other means, call the helper
   explicitly" — verified there are none (single suspend() call).
4. **Ordering analysis**: write-through is synchronous inside suspend(); the template write is
   a microtask AFTER suspend. These never conflict — different targets (draft slot/store vs
   pi main editor). No clobber risk either direction.
5. **Test seams**:
   - discuss.test.ts uses fakePanel (suspend: vi.fn()) — those tests CANNOT exercise the
     write-through; don't flip them, they stay as-is.
   - The new TDD test needs a REAL InterrogationPanel. Harness precedent: panel.test.ts
     `makeSuspendPanel` (S1's PRP Task 1) + text-field.test.ts editor-open path (focus "text",
     bufferOwner = question id via the ✎ Other-row write-in duty or focusText seam).
   - fake pi object: `pi.ui.setEditorText = vi.fn()` (discuss.test.ts fakePi pattern :92) —
     assert it was called with the discuss template AFTER suspension (deferral), and that it
     does NOT interfere with the draft staging.
6. **No double-staging**: after resume, editor re-seeds from the draft (existing rehydration);
   typing again re-seeds/overwrites slot — assert drafts.getDraft still equals latest after a
   second commit or second write-through.
7. Docs: none (README swept in P1.M3.T2 per item contract).

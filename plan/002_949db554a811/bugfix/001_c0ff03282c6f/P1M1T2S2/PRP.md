# PRP — Bugfix P1.M1.T2.S2: Discuss gesture (ctrl+shift+e) preserves the in-flight draft

## Goal

**Feature Goal**: Close BUG-002 gesture 2 (PRD h2.2/h3.1, R4/ESC-002): prove, via TDD, that the discuss gesture (ctrl+shift+e → `discussInChat`) no longer destroys typed-but-unsubmitted editor text — `discussInChat` exits through `panel.suspend()`, which S1 (parallel, Implementing) arms with `writeThroughCurrentDraft()`. The discuss path suspends by no other means (verified: single `suspend()` call site in discuss.ts), so it inherits the fix with **zero discuss.ts code change**; this subtask is the verification contract plus a defensive assertion that the deferred template write never clobbers the staged draft.

**Deliverable**: New tests in `src/panel/discuss.test.ts` (real-panel discuss journey with a fake `pi` capturing `setEditorText`) — no production code changes expected. If (and only if) implementation reveals a discuss path that suspends by other means, add an explicit `writeThroughCurrentDraft()` call there before suspending.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- TDD: open editor in write-in duty on a choice question, type `'precious unsaved typing'`, call `discussInChat(pi, panel)` → panel resolved with discuss payload (suspended) AND `drafts.getDraft('q1') === 'precious unsaved typing'` AND the `draftSlots` entry intact (fails before S1 lands / before the fix)
- `pi.ui.setEditorText` still receives the discuss template (the handoff feature is intact) and does not touch the draft slot/store
- No double-staging: after a simulated resume + re-open, typing again re-seeds from/over the draft without duplication

## Why

R4/commitment 6: "Typed-but-unsubmitted text survives … Never destroyed except by explicit user action", and ESC-002: "Every exit is a draft write-through". The keys.ts step-4 config intercept for ctrl+shift+e (:483) is ungated by editor focus, so it fires mid-editing; pre-fix, discuss.ts:116 called `panel.suspend()` which never staged the buffer — a user mid-write-in-answer (WRITEIN-001 means full hand-written answers live in this editor) who invokes "discuss in chat" loses the entire answer. S1's `writeThroughCurrentDraft()` inside `suspend()` fixes the mechanism; this subtask proves the discuss gesture — the second of the three BUG-002 exits — actually delivers R4, per the PRD h2.5 recommendation ("call it at the top of suspend(), discussInChat, and enterNoteMode").

## What

1. **TDD tests in `src/panel/discuss.test.ts`** (new describe, real-panel harness — see Tasks): the PRD h3.1 repro step 3 discuss variant, verbatim expectations.
2. **No production change expected** — `discussInChat` calls `panel.suspend()` (:116) and `suspend()` performs the write-through once S1 lands. Contingency (from the item contract): if any discuss code path suspends by other means, call `writeThroughCurrentDraft()` explicitly before suspending. Verified during research: there is exactly ONE suspend call and no other exit path in discuss.ts — so this contingency is expected to be dead.
3. **Docs: none** — README drafts passages (66-68/212/254-255) are swept in P1.M3.T2 per the item contract.

### Success Criteria

- [ ] New test: editor in write-in duty on choice question q1, `setText('precious unsaved typing')`, `discussInChat(pi, panel)` → returns true; panel suspended (`done(null)` called / resolved); `drafts.getDraft('q1') === 'precious unsaved typing'`; `panel.draftTextFor('q1')` same; draftSlots entry `{value:'q1', text}` present
- [ ] `pi.ui.setEditorText` called exactly once with the discuss template (microtask deferral intact — template still wins on the MAIN editor; the draft slot is a different target and unaffected)
- [ ] Empty editor buffer + discuss → no slot created (`draftTextFor('q1')` undefined), handoff still runs
- [ ] No current question (`currentId` undefined / unknown id) → returns false, panel untouched, no draft writes (existing discuss.test.ts behavior — regression)
- [ ] No-double-staging: after the discuss suspend, re-seed the editor from the draft, type more, second write-through/suspend → slot holds the LATEST text, single entry
- [ ] Existing fakePanel discuss tests (deferral, failure paths, template) untouched and green
- [ ] Full suite green — no regression in keys routing or suspend.test.ts:585

## All Needed Context

### Context Completeness Check

Repo fully implemented (1224 tests pre-changeset). This PRP cites S1's helper contract (its PRP, in-flight), the exact current discuss.ts code, the keys routing site, and the test harness patterns. An agent needs this PRP plus `src/panel/discuss.ts`, `src/panel/discuss.test.ts`, `src/panel/panel.ts`, `src/panel/panel.test.ts`.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T2S1/PRP.md
  why: "CONTRACT (parallel): writeThroughCurrentDraft() runs inside suspend() after the resolved-guard — discussInChat inherits it via its single panel.suspend() call"
  critical: "helper stages slot+store for question-id bufferOwner, batchNote+setNote for note owner, skips blur/invalidate/FR-18; S2 must NOT re-implement or duplicate-call it"

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T2S2/research/notes.md
  why: verbatim discuss.ts excerpt, ordering analysis (sync write-through inside suspend vs microtask template write — different targets, no clobber), test-seam decisions

- file: architecture/bug-002-draft-r4.md (same plan dir)
  why: THE research doc for BUG-002 — draft machinery inventory (draftSlots :402, DraftStore seam :126-135), key-routing pipeline, test inventory
  critical: "§6: no existing test asserts draft emptiness after discuss — additive tests only"

- file: src/panel/discuss.ts
  why: "discussInChat :~105-126 — suspend FIRST, then deferred setEditorText; template overwrite of the main editor is DELIBERATE and must keep winning"
  gotcha: "single suspend() call site, no other exit means — the contingency clause should stay dead; if implementation proves otherwise, add the explicit helper call BEFORE suspend"

- file: src/panel/discuss.test.ts
  why: "harness conventions — fakePi(setEditorText) (:92), fakePanel (:81, suspend: vi.fn()), describe layout (:250 discussInChat, :306 wiring)"
  gotcha: "fakePanel tests can't exercise write-through (suspend is mocked) — keep them as-is; the new tests need a REAL InterrogationPanel (see panel.test.ts makeSuspendPanel + text-field.test.ts editor-open seams)"

- file: src/panel/panel.test.ts
  why: "makeSuspendPanel harness (S1's PRP Task 1 extends :1339) — reuse its real-panel construction, done spy, DraftStore stub wiring for the new discuss journey test"

- file: src/panel/keys.ts (:483)
  why: "config intercept `matchesKey(data, b.discuss)` — read-only reference; optionally add one routing assertion that the intercept fires with editor focus (documents WHY this gesture must write through)"
  gotcha: "do not gate the intercept on focus — mid-editing discuss is the intended UX; the fix is write-through, not blocking"

- docfile: PRD h2.2/h3.1 (BUG-002 verbatim, in this PRP's task prompt), h2.5 recommendation bullet 2
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── discuss.ts        # expected: NO change (contingency only)
├── discuss.test.ts   # MODIFY: new real-panel discuss-journey describe block
├── panel.ts          # S1's writeThroughCurrentDraft + suspend() (parallel — do not touch here)
└── panel.test.ts     # reference harness (makeSuspendPanel)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: S1 owns writeThroughCurrentDraft + suspend() — this subtask must NOT modify
//   panel.ts. If a discuss-path gap exists, the fix is a discuss.ts-side explicit call,
//   never a re-edit of suspend().
// CRITICAL: the template write is deferred via `Promise.resolve().then(...)` — in the test,
//   await a microtask flush (await Promise.resolve() or vi.waitFor) before asserting
//   setEditorText was called; the draft assertions are SYNCHRONOUS (staging happens inside
//   suspend() before done(null)).
// GOTCHA: open the editor in WRITE-IN DUTY (✎ Other row accept, or the focusText seam used by
//   text-field.test.ts) so focus === "text" and bufferOwner === "q1" — a plain elaboration
//   duty test is a nice-to-have second case, same mechanism.
// GOTCHA: bufferOwner is the slot key, NOT currentId (EXPLAIN-002) — though for the write-in
//   duty they coincide; assert via the slot the helper writes.
// GOTCHA: use a real DraftStore instance or the panel.test.ts stub — assert BOTH
//   drafts.getDraft('q1') and panel.draftTextFor('q1') (slot + store both populated).
// GOTCHA: setEditorText is optional (`?.`) — the test's fake pi supplies it via vi.fn(); do
//   not assert throw behavior here (already covered by existing discuss tests).
// GOTCHA: don't assert the template CONTENT beyond containing the question prompt — the exact
//   template contract has its own tests (:177 buildDiscussTemplate describe).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION — verify S1 landed
  - rg -n "writeThroughCurrentDraft" src/panel/panel.ts → helper exists and suspend() calls it
  - If not landed (parallel still in flight): write the tests anyway (they will fail — correct
    TDD red), but do NOT implement the helper yourself; coordinate via plan status

Task 1: WRITE FAILING/VERIFYING TESTS FIRST (src/panel/discuss.test.ts, new describe after :306)
  - HARNESS: build a REAL InterrogationPanel per panel.test.ts makeSuspendPanel conventions
    (choice question q1 with options + ✎ Other row reachable; done callback captured);
    DraftStore stub or real instance; fake pi = fakePi(vi.fn()) from the existing helpers
  - TEST discuss_preserves_inflight_write_in_draft:
    1. panel focused on q1, cursor to the Other row, accept → editor open in write-in duty
       (focus "text", bufferOwner "q1")
    2. textField.setText("precious unsaved typing")
    3. expect(discussInChat(pi, panel)).toBe(true)
    4. panel resolved with discuss payload — done(null) called (or await the panel promise → null)
    5. expect(drafts.getDraft("q1")).toBe("precious unsaved typing")          // the R4 money shot
    6. expect(panel.draftTextFor("q1")).toBe("precious unsaved typing")      // slot intact
    7. await Promise.resolve(); expect(pi.ui.setEditorText).toHaveBeenCalledTimes(1)  // handoff intact
  - TEST discuss_empty_buffer_no_slot: empty editor → discussInChat true, handoff ran,
    draftTextFor("q1") === undefined, setDraft never called
  - TEST discuss_no_current_question_untouched (real-panel variant of :273/:284): returns
    false, no suspend, no draft writes
  - TEST discuss_no_double_staging: after test 1's suspend, re-open/re-seed editor from the
    draft (simulated resume), setText("second pass"), trigger another write-through exit
    (e.g. panel.suspend() directly or re-run discuss) → drafts.getDraft("q1") === "second pass",
    draftSlots has exactly one q1 entry
  - RUN npx vitest run src/panel/discuss.test.ts -v — confirm the draft assertions fail pre-fix
    (or pass immediately if S1 already landed — then they are the regression pin)

Task 2: CONTINGENCY CHECK (expected dead branch)
  - Re-read src/panel/discuss.ts: confirm the ONLY exit is panel.suspend() (single call site
    ~:116). If — and only if — any other exit/suspend means exists, insert
    `panel.writeThroughCurrentDraft?.()` (or make it public per S1's contract discussion)
    BEFORE that suspension, with a comment citing R4/BUG-002. Do NOT touch suspend() or the
    deferred template write ordering ("template IS the feature").

Task 3: OPTIONAL routing documentation test (keys.test.ts, additive, cheap)
  - One test: with focus === "text", the keys router still dispatches the discuss binding
    (documents that the gesture fires mid-editing and therefore must write through).
    Follow keys.test.ts existing dispatch-test conventions. SKIP if the router seam makes
    this awkward — the discuss.test.ts coverage is the contract.

Task 4: RUN gates
  - npx vitest run src/panel/discuss.test.ts src/panel/panel.test.ts src/panel/suspend.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The new test's shape (skeleton):
test("discuss gesture writes the in-flight write-in draft through before suspend", async () => {
  const { panel, drafts, done } = makeRealPanelWithDrafts(choiceQ("q1"));
  openWriteInEditor(panel, "q1");                 // Other-row accept seam (text-field.test.ts pattern)
  panel.textField.setText("precious unsaved typing");
  const setEditorText = vi.fn();
  expect(discussInChat(fakePi(setEditorText), panel)).toBe(true);
  expect(done).toHaveBeenCalledWith(null);                        // suspended, discuss payload path
  expect(drafts.getDraft("q1")).toBe("precious unsaved typing");  // R4 — was destroyed pre-fix
  expect(panel.draftTextFor("q1")).toBe("precious unsaved typing");
  await Promise.resolve();                                        // microtask deferral flush
  expect(setEditorText).toHaveBeenCalledTimes(1);                 // template still wins on main editor
});

// PATTERN: draft assertions are synchronous (staging is inside suspend()); the setEditorText
// assertion needs exactly ONE microtask flush — never setTimeout in these tests.
// CRITICAL: if writeThroughCurrentDraft must be called from discuss.ts (dead contingency),
//   do it BEFORE panel.suspend() — order only matters if suspend's resolved-guard could
//   short-circuit, which it can't on a first call.
```

### Integration Points

```yaml
UPSTREAM (contract, parallel):
  - P1.M1.T2.S1: writeThroughCurrentDraft() inside suspend() — the mechanism this item verifies
SIBLINGS:
  - P1.M1.T2.S3 (note-mode swap): owns enterNoteMode symmetric write-through; shares the helper
DOWNSTREAM:
  - P1.M3.T1.S1 regression sweep + P1.M3.T2 README drafts passages (66-68/212/254-255) —
    this subtask ships NO docs by contract
NO CHANGES (expected) to: discuss.ts, panel.ts, keys.ts, draft-store.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/discuss.test.ts -v
npx vitest run src/panel/discuss.test.ts src/panel/panel.test.ts src/panel/suspend.test.ts -v
npm test
```

### Level 3: Behavioral probe (PRD h3.1 repro step 3, discuss variant — the test IS the probe)

```bash
npx vitest run src/panel/discuss.test.ts -t "discuss" -v
# Pre-fix (no S1): draft assertions fail — drafts.getDraft('q1') === undefined.
# Post-fix: 'precious unsaved typing' in slot + store, panel suspended, template delivered.
```

### Level 4: Domain validation

- [ ] `rg -n "writeThroughCurrentDraft|suspend\(\)" src/panel/discuss.ts` — no helper call needed (single suspend path), or the contingency call documented with an R4 comment
- [ ] `git diff --name-only` — src/panel/discuss.test.ts only (+ optional keys.test.ts); NO panel.ts/discuss.ts changes unless the contingency fired
- [ ] Existing discuss fakePanel tests unchanged and green

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] TDD: discuss journey test observed red pre-S1/pre-fix (or pinned green post-S1 with the failing-behavior documented)
- [ ] Draft survives discuss: slot + DraftStore both carry `'precious unsaved typing'`; handoff template still delivered exactly once
- [ ] Empty-buffer, no-current-question, and no-double-staging cases covered
- [ ] S1's files untouched by this subtask; contingency branch either dead or minimal + commented
- [ ] No documentation changes (contract: README swept in P1.M3.T2)

## Anti-Patterns to Avoid

- ❌ Don't modify panel.ts/suspend()/writeThroughCurrentDraft — S1's contract, in-flight in parallel
- ❌ Don't gate or block the discuss key on editor focus — mid-editing discuss is the feature; write-through is the fix
- ❌ Don't reorder discussInChat's suspend-then-deferred-write — the template MUST land after the panel yields the editor
- ❌ Don't assert the template content precisely here — that's buildDiscussTemplate's own describe
- ❌ Don't use fakePanel for the draft tests — its suspend is a vi.fn() and bypasses the write-through
- ❌ Don't add setTimeout-based waiting — one microtask flush suffices for the deferred write
- ❌ Don't ship README/spec edits — P1.M3.T2 owns the docs sweep

---

**Confidence Score**: 9/10 — discuss.ts read in full (single suspend path, verified), S1's helper contract is precise, test harness precedents identified (fakePi + makeSuspendPanel + text-field editor-open seam). The item is verification-shaped by design; the only uncertainty is whether S1 lands before this item starts (Task 0 handles both orderings).

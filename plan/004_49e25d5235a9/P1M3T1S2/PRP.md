# PRP — P1.M3.T1.S2: Delete actions.digit and purge digit-accept comments (DIGIT-OUT-001)

## Goal

**Feature Goal**: Remove the `digit` quick-select action from the actions registry and every digit-accept reference in comments/JSDoc/tests across the panel (DIGIT-OUT-001). After this task, `grep -rn digit src/panel/actions.ts src/panel/short-view.ts src/panel/panel.ts` returns only the `panel.config.digitQuickSelect` type-level fact if any remains (config field itself is S3's target — the :195 READER is gone here), and no code path or doc claims digits can accept an option. ENTER remains the sole accept path; the FR-35/ANSWER-PIN-001 same-value ENTER no-op behavior is untouched and its tests stay green.

**Deliverable**: Edits to `src/panel/actions.ts` (delete `PanelActions.digit` interface member, `digit()` implementation, registry export; reword the digit-citing comments in/around `acceptOptionIndex`), `src/panel/short-view.ts` (:48/:77/:100 comment purges), `src/panel/panel.ts` (:541 JSDoc fix), `src/panel/actions.test.ts` (delete the digit suite :908-967; convert the digit-based ripple/same-value tests :513/:545/:601 to the accept path; flip matcher tests :1780-1791 and :1795-1810), and `src/panel/ripple-confirm.test.ts` (:390-area digit test → inert or accept-based).

**Success Definition**: `npx tsc --noEmit` + `npm test` (vitest) green. Digits are inert at panel level (S1's router already guarantees routing; this task guarantees no action remains and tests assert inertness). FR-35 same-value ENTER no-op tests pass unchanged in behavior (test bodies may be re-pointed from `digit()` to `accept()` only where they referenced the deleted export).

## Why

- h2.74 DIGIT-OUT-001: digit quick-select is "REMOVED entirely… Supersedes every digit-accept reference in the living docs." With hjkl + enter, digits were a redundant second accept path and an accidental-answer footgun on hard-won answers.
- This is step 2 of 3: S1 (in flight, parallel) removes the router branch, `RoutedActions.digit`, and the `defaultRoutedActions` delegate — leaving `actions.digit` with ZERO references. This task deletes the orphan and purges the residue. S3 then deletes the `digitQuickSelect` config field (its last reader — `digit()` at :195 — is destroyed here, unblocking S3).
- Keeping S2 scoped to actions.ts + comments + tests means zero call-site churn: nothing dispatches `digit` anymore.

## What

### Exact edits

**1. `src/panel/actions.ts` — deletions (verified line numbers in current tree)**

- **:73-76 area, `PanelActions` interface** — delete both lines:
  ```ts
  /** Quick-select option n (1-based); out of range or disabled → false. */
  digit(panel: InterrogationPanel, n: number): boolean;
  ```
- **:185-208 area — delete the entire `digit()` function** including its doc block ("Digit quick-select (R5): accept option `n-1` through the SAME path as accept…"):
  ```ts
  export function digit(panel: InterrogationPanel, n: number): boolean { ... }
  ```
  This removes the LAST `panel.config` read in actions.ts (`panel.config.digitQuickSelect` at :195). Do not touch `panel.ts`'s `config` field itself (S3 deletes the config FIELD; other modules may still read config).
- **:910-912 registry** — `panelActions` loses its `digit,` line, leaving `optionUp, optionDown, accept, prevQuestion, nextQuestion, submit`.
- **Comment purges (Mode A rewording — delete only the digit wording, keep the rest)**:
  - :263 `* - false — out-of-range index (opt undefined): not consumed; digit falls` → reword to `* - false — out-of-range index (opt undefined): not consumed; the key falls` (and the next line's "accept/digit return boolean" → "accept returns boolean").
  - :269 `Shared commit path for accept + digit + deep view` → `Shared commit path for accept + deep view`.
  - :273 `no auto-submit; digit inherits for free` → `no auto-submit`.
  - :285 `false (opt undefined — digit's not-consumed fall-through)` → `false (opt undefined — not consumed)`.
  - :288 `Boolean consumers (accept/digit, the PanelActions interface)` → `Boolean consumers (accept, the PanelActions interface)`.
  - :294 `the cursor domain, digits, and deep view can all speak display positions` → `the cursor domain and deep view both speak display positions`.
  - :297 **THE purge site** — `// ANSWER-PIN-001 / FR-D9: enter (or digit) on the ALREADY-RECORDED value` → `// ANSWER-PIN-001 / FR-D9: enter on the ALREADY-RECORDED value` (same-value no-op REMAINS an ENTER behavior — FR-35 as amended by DIGIT-OUT-001).
- **Post-edit invariant**: `grep -n "digit" src/panel/actions.ts` → zero matches.

**2. `src/panel/short-view.ts` — comment purges (D-R13 amendment wording)**

- :48 `Navigation (↑/↓, digit select, enter accept) is P1.M3.T2.S2` → `Navigation (↑/↓, enter accept) is P1.M3.T2.S2`.
- :75-78 (Other-row constant doc): `Fixed label — deliberately NOT configurable and NOT digit-selectable (h2.32/h2.36)` → per the D-R13 amendment: `Fixed label — deliberately NOT configurable and NOT quick-selectable; reachable only via the cursor (h2.32/h2.36, as amended by DIGIT-OUT-001)`.
- :99-101 (displayOptions doc): `the cursor domain, digit quick-select (1..9), and the ★ preselect all speak display positions` → `the cursor domain and the ★ preselect both speak display positions`.
- **Post-edit invariant**: `grep -n digit src/panel/short-view.ts` → zero.

**3. `src/panel/panel.ts` — :541 JSDoc fix**

```ts
  /**
   * Public readonly — actions read digitQuickSelect off it. Config is a
   * read-only input; a config reload constructs a fresh panel.
   */
  readonly config: InterrogatorConfig;
```
→ reword the first line: `Public readonly config — a read-only input; a config reload constructs a fresh panel.` (no action reads `digitQuickSelect` anymore). The FIELD stays (S3 may revisit; keys.ts still uses config for accelerator resolution).

**4. `src/panel/actions.test.ts`**

- :35 — remove `digit,` from the import list.
- **:908-967 — delete the entire `describe("digit — quick-select (R5)")` suite** (7 tests: accepts-and-advances, beyond-option-count noop, never-selects-Other-row, disabled-falls-through, text-question-false, answered-routes-ripple, and its neighbors inside the describe block). Superseded by S1's router inertness tests.
- **Digit-based FR-35/ripple coverage at :513, :545, :601 — RE-POINT, don't delete** (these are ANSWER-PIN-001/FR-18 coverage that must stay green):
  - `test_digit_on_closed_routes_through_the_ripple_seam` (:513) → convert to `accept` with the panel cursor pre-seeded to the different-value option (set the option cursor to index 1 so `accept()` proposes "b"), keeping the seam assertions. If an equivalent accept-based test already exists nearby, delete the duplicate instead.
  - `test_same_value_digit_inherits_inert_no_op` (:545) → same treatment via accept on the recorded option.
  - `test_same_value_digit_on_reasked_reconfirms` (:601) → same.
  - Prefer minimal edits: seed cursor + swap `digit(panel, n)` → `accept(panel)`; keep every assertion.
- **Matcher tests :1780-1791 — flip to inertness** (S1 makes digits unrouted; these currently assert digit ACCEPT via `panel.handleInput("2")`):
  - `test_matcher_digits_quick_select_when_enabled` → rename `test_matcher_digits_are_inert` (or fold the two into one): `panel.handleInput("2")` returns **false**, `state.getQuestion("q1")?.answer` stays `undefined`, `panel.currentId` unchanged, no ripple.
  - `test_matcher_digits_fall_through_when_quick_select_disabled` → same assertion set with `digitQuickSelect: true` config is meaningless now (S1 removed the branch); merge into the single inertness test and delete the disabled-config variant (the config field's remaining behavior is S3's to remove).
- **:1795-1810 seam-consumes test** (`test_matcher_skipped_when_the_keys_seam_consumes_first`): currently sends `"\r"`. Per the split contract it must send `"o"` (the bare overview key, BAREKEYS-001) instead — a non-enter, non-digit printable config key — asserting `keys` seam consumed it before the router/matcher ran and `panel.view` unchanged. Keep the existing seam assertions (`keys).toHaveBeenCalledWith(...)`, status untouched).
- If any test constructs a `PanelActions`-typed object, the deleted member must not appear (excess-property errors).

**5. `src/panel/ripple-confirm.test.ts` :388-395**

- `test_digit_quick_select_on_answered_uses_same_gate` sends `panel.handleInput("2")` expecting the confirm modal. After S1, "2" is inert → the test breaks. Flip it: rename to `test_digit_press_is_inert_during_review` — `panel.handleInput("2")` returns false, `panel.confirmMode` stays null, `state` unchanged (compare serialized before/after). The same-gate-via-accept coverage (different-value accept on an answered ripple parent raises the modal) must already exist elsewhere in this file; if not, add one accept-based case mirroring the deleted assertions (seed cursor to option "b", `handleInput("\r")`, expect confirmMode with victims ["q2","q3"], answer deferred).

### Success Criteria

- [ ] `grep -rn "digit" src/panel/actions.ts src/panel/short-view.ts` → zero matches; `src/panel/panel.ts` matches only where the config FIELD name appears in types (JSDoc no longer names digitQuickSelect).
- [ ] `panelActions` registry exports exactly optionUp/optionDown/accept/prevQuestion/nextQuestion/submit; `PanelActions` interface matches.
- [ ] `npx tsc --noEmit` green with NO unused-export/unused-import suppressions added (digit had zero referents after S1 — deleting it cannot break keys.ts).
- [ ] `npm test` green; FR-35 same-value ENTER no-op tests still present and passing (accept-based).
- [ ] No digit-accept wording survives anywhere in src/ (run `grep -rn "digit" src/` — remaining hits must be only: config field name `digitQuickSelect` in src/config.ts and its own tests, which S3 owns; and router-inertness test NAMES that intentionally reference digits as inert).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact code sites (verified above with current line numbers), the S1 contract (what's already deleted from keys.ts), the FR-35 amendment (same-value no-op stays an ENTER behavior), and the D-R13 rewording for the Other row. All below.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/P1M3T1S1/PRP.md
  why: CONTRACT for the parallel router task — S1 deletes the digit branch, RoutedActions.digit, and the defaultRoutedActions delegate, leaving actions.digit with ZERO references
  critical: keys.ts and keys.test.ts are S1's territory — do NOT edit src/panel/keys.ts or src/panel/keys.test.ts here (except: if a keys.test.ts digit reference survives S1, coordinate rather than duplicate). If S1 hasn't landed yet, this task still typechecks AFTER both land; sequence accordingly (S2 typically lands after S1).

- file: src/panel/actions.ts
  why: the primary edit target — :73-76 interface member, :185-208 implementation, :910-912 registry, :263/:269/:273/:285/:288/:294/:297 comment purge sites (all verified in the current tree)
  pattern: acceptOptionIndex stays byte-identical in LOGIC; only doc comments change
  gotcha: the :195 `panel.config.digitQuickSelect` read is the LAST config read in actions.ts — its deletion is what unblocks S3's config-field removal; don't leave the read behind a comment

- file: src/panel/actions.test.ts
  why: :35 import, :908-967 delete, :513/:545/:601 re-point to accept, :1780-1791 flip to inertness, :1795-1810 seam test → "o"
  pattern: makePanel(state, seams?, config?) helper exists at top of file — reuse for re-pointed tests; cursor seeding: panel exposes the option-cursor field used by accept (check the accept-path tests in the same file for the exact field name, e.g. panel.cursorIndex or a moveOptionCursor helper — mirror them)
  gotcha: FR-35 coverage must SURVIVE the digit deletion — the ANSWER-PIN-001 tests are contract tests, not digit tests that happen to exist

- file: src/panel/ripple-confirm.test.ts
  why: :388-395 digit gate test → inertness flip (or accept-based same-gate replacement)
  pattern: seedRippleChain() + makePanel helpers local to this file

- file: src/panel/short-view.ts
  why: :48/:77/:100 comment purges; :77 needs the D-R13 amendment wording (never digit-selectable → not quick-selectable / reachable only via the cursor)

- file: src/panel/panel.ts
  why: :536-543 — reword the `config` field JSDoc (drop "actions read digitQuickSelect off it")

- file: plan/004_49e25d5235a9/architecture/keys-and-actions.md
  why: §5 documents the actions/keys split and the digit sites this task owns — read for the contract, do not edit (architecture docs are reference)

- file: spec PRD h2.74 (DIGIT-OUT-001) + h2.35 (hotkey table: "digits are inert at panel level") + h2.65/h2.8 FR-35 (same-value ENTER no-op stays)
  why: authoritative rulings; selected content is embedded in the task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  actions.ts            # EDIT: delete digit iface/impl/export + comments
  actions.test.ts       # EDIT: delete suite, re-point 3 tests, flip 2 matcher tests
  short-view.ts         # EDIT: 3 comment purges
  panel.ts              # EDIT: 1 JSDoc fix
  ripple-confirm.test.ts# EDIT: 1 test flip
  keys.ts / keys.test.ts# S1's — DO NOT TOUCH
```

### Desired Codebase tree

```bash
# No files added or removed — deletions and rewording only.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: sequence dependency — S2 assumes S1 landed (digit() unreferenced).
// If implementing before S1 lands, keys.ts still references panelActions.digit
// via defaultRoutedActions; typecheck would fail on the registry deletion.
// Land S1 first or take both deletions in one sitting.
// GOTCHA: the three :513/:545/:601 tests use digit() to exercise the RIPPLE
// SEAM and SAME-VALUE inertness — deleting them outright would silently drop
// FR-35/FR-18/BUG-003 coverage. Re-point to accept() with cursor seeding.
// GOTCHA: matcher tests call panel.handleInput("2") THROUGH the real router
// (no mock) — after S1 the byte falls through unmatched → false. Assert BOTH
// the return value and zero state change (answer undefined, currentId same).
// GOTCHA: don't add vi.fn() stubs for digit in any PanelActions-typed test
// fixture — the member no longer exists; excess properties fail tsc.
// GOTCHA: keep config.digitQuickSelect itself untouched — src/config.ts is
// S3's (P1.M3.T1.S3) file. This task only removes its last actions.ts reader.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY S1 LANDED
  - CHECK: grep -n "digit" src/panel/keys.ts → zero matches (S1's invariant). If nonzero, coordinate — do not edit keys.ts yourself.
  - CHECK: grep -n "panelActions.digit\|\.digit(" src/ -r → only src/panel/actions.ts (impl) + src/panel/actions.test.ts remain.

Task 2: EDIT src/panel/actions.ts
  - DELETE: PanelActions.digit member (:76 + doc line), digit() function + doc (:185-208), registry `digit,` (:912)
  - REWORD: the 7 comment sites listed in "What §1" (:263, :269, :273, :285, :288, :294, :297)
  - INVARIANT: grep digit → zero

Task 3: EDIT src/panel/short-view.ts + src/panel/panel.ts
  - PURGE: :48, :77 (D-R13 amendment wording), :100 in short-view.ts; :541 JSDoc in panel.ts
  - INVARIANT: grep digit → zero in both

Task 4: EDIT src/panel/actions.test.ts
  - REMOVE: `digit,` import (:35)
  - DELETE: describe("digit — quick-select (R5)") :908-967
  - RE-POINT: :513, :545, :601 to accept() with cursor seeding (keep all assertions)
  - FLIP: :1780-1791 → single inertness test (handleInput("2") → false, no state change); delete the disabled-config variant
  - FLIP: :1795-1810 seam test → sends "o", seam consumes, view unchanged
  - RUN: npx vitest run src/panel/actions.test.ts

Task 5: EDIT src/panel/ripple-confirm.test.ts
  - FLIP: :388-395 → digit inert during review (returns false, confirmMode null, serialized unchanged); add/verify an accept-based same-gate case if none exists

Task 6: FULL GATES
  - RUN: npx tsc --noEmit && npm test
  - GREP audit: grep -rn "digit" src/ → only src/config.ts + src/config.test.ts (S3 territory)
```

### Implementation Patterns & Key Details

```ts
// Re-pointed same-value test sketch (mirror the file's existing helpers):
test("test_same_value_enter_on_closed_is_inert_no_op", () => {
  // was test_same_value_digit_inherits_inert_no_op (:545)
  const { panel } = makePanel(state);
  panel.currentId = "q1";
  seedOptionCursor(panel, 0); // recorded value "a" — check the file's accept
                             // tests for the real cursor-seed API/field name
  expect(accept(panel)).toBe(true);
  expect(confirmRipple).toHaveBeenCalledTimes(0);
  // ...keep the remaining original assertions verbatim
});

// Flipped matcher test sketch:
test("test_matcher_digits_are_inert", () => {
  const { panel } = makePanel(seed(BASIC));
  expect(panel.handleInput("2")).toBe(false);
  expect(state.getQuestion("q1")?.answer).toBeUndefined();
  expect(panel.currentId).toBe("q1");
});
```

### Integration Points

```yaml
CONFIG: none (src/config.ts untouched — S3 deletes digitQuickSelect)
KEYS: none (keys.ts untouched — S1's)
UNBLOCKS: P1.M3.T1.S3 (the :195 config reader is gone → clean config field deletion)
DOCS: Mode A comment/JSDoc purge only — no README changes (P1.M4.T2.S1 owns README)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
# Expected: zero errors. No unused-import/unused-export suppressions permitted.
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts -v
npx vitest run                     # full suite
# Expected: all green; FR-35 same-value ENTER no-op tests present and passing.
```

### Level 3: Residue audit

```bash
grep -rn "digit" src/
# Expected: hits ONLY in src/config.ts + src/config.test.ts (the digitQuickSelect
# field, S3's target). src/panel/ zero hits.
grep -rn "digit" src/panel/ | wc -l   # → 0
```

### Level 4: Behavior spot-check (via existing suites)

No manual TUI pass required — S1's router inertness tests + the flipped matcher/ripple tests are the scripted guarantee (a stray digit cannot answer+advance; only enter accepts).

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean; `npm test` all green.
- [ ] `PanelActions` and `panelActions` contain no digit member/export.
- [ ] `grep -rn digit src/panel/` → zero.
- [ ] FR-35 same-value ENTER no-op coverage survives (accept-based, assertions intact).
- [ ] FR-18 ripple same-gate coverage survives (accept-based or verified pre-existing).
- [ ] keys.ts/keys.test.ts/config.ts untouched (S1/S3 territory).
- [ ] No stubs/suppressions added to make typecheck pass.

## Anti-Patterns to Avoid

- ❌ Don't delete the :513/:545/:601 tests outright — they carry FR-35/FR-18 coverage; re-point them.
- ❌ Don't edit keys.ts, keys.test.ts, or config.ts (parallel/sequenced siblings own them).
- ❌ Don't reword FR-35 semantics — same-value ENTER no-op stays; only the "or digit" phrasing dies.
- ❌ Don't leave "// digit" archaeology comments ("formerly digit…") — DIGIT-OUT-001 says purge the references.
- ❌ Don't add ts-ignore/eslint-disable to suppress the deletion's fallout — if something still references digit, S1 hasn't landed; coordinate.

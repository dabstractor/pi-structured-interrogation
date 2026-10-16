# PRP — P1.M4.T2.S1 (bugfix 001): Cursor-row chat targeting — accessor + overview branch in the chat dispatch (BUG-004)

## Goal

**Feature Goal**: Fix BUG-004 (PRD h2.3/h3.3, minor issue 3): in the overview view, pressing `e` (the `keys.chat` binding) must open the side chat on the **cursor-row question** (`ordered[panel.overviewCursor]`), not the background question `panel.currentId` sat on before entering the overview — matching the overview's cursor-row interaction model (↑/↓ move the cursor row, enter jumps to it). Gating `e` out of the overview is the REJECTED alternative (h2.5 recommendation).

**Deliverable**: NEW export `overviewSelectedQuestionId(panel)` in `src/panel/overview.ts` (mirroring `overviewJump`'s read, defensively undefined out-of-range) + a three-line qid resolution change in `routed.onChat` (`src/panel/panel.ts:1150-1152`) + regression tests (panel.test.ts / keys.test.ts additions).

**Success Definition**: PRD repro — panel on q1, `o`, ↓ to q2's row, `e` → `getSidechat()?.questionId === "q2"` (not `"q1"`); cursor on the LAST row works; empty state (no questions) → consumed no-op (nothing opens); from short/deep views `e` still targets `currentId`; esc-from-chat returns to the overview (`chatReturnView` seeded `"overview"`); `panel.currentId` unchanged by the open path; existing keys.test.ts "e dispatches" loop (line 405) stays green; `npm test` + `npm run typecheck` + `bash scripts/verify-keymap-conflicts.sh` green.

## User Persona (if applicable)

**Target User**: pi user scanning the overview list to pick which question to discuss with the model.

**Use Case**: User moves the overview cursor to q5's row and presses `e` — the side chat header shows q5, the chat is bound to q5 (replace-singleton semantics), esc returns to the overview.

**User Journey**: `o` → ↑/↓ to the row of interest → `e` → chat on THAT question → esc → back in the overview at the same cursor row.

**Pain Points Addressed**: Today the chat header shows the wrong (background) question and the singleton record binds to it — silent mis-targeting the elaborate key was already view-gated to avoid (BUG-011 class).

## Why

- PRD h3.3 (BUG-004): "the interaction model is cursor-row-centric… But the chat key dispatch has no overview branch — onChat binds to p.currentId." Runtime-reproduced.
- h2.5 recommendation: "Route the chat key in the overview to the cursor-row question (or gate it out) to match the overview's cursor-row interaction model." The item contract picks the first shape.
- Neighbor precedent: prev/next question-nav keys re-route in the overview (`overviewUp`/`overviewDown`), `overviewJump` reads the cursor row — the chat key joins the same convention.

## What

### Contract (authoritative)

1. **Accessor** — in `src/panel/overview.ts`, next to `overviewJump` (~405-418):
   ```ts
   /**
    * [Mode A] BUG-004: the id of the overview cursor row — the SAME read
    * overviewJump jumps by (`ordered[panel.overviewCursor]`). Defensive:
    * undefined when the cursor is out of range or the list is empty; callers
    * treat undefined as "no target" (consumed no-op).
    */
   export function overviewSelectedQuestionId(panel: InterrogationPanel): string | undefined {
     return panel.state.orderedQuestions()[panel.overviewCursor]?.id;
   }
   ```
2. **Dispatch resolution** — in `routed.onChat` (`src/panel/panel.ts:1150-1152`), replace `const qid = p.currentId;` with:
   ```ts
   // BUG-004: in the overview the cursor ROW is the target — currentId is
   // the background question the panel sat on before entering the list.
   const qid = p.view === "overview" ? overviewSelectedQuestionId(p) : p.currentId;
   ```
   The existing `if (qid === undefined || args.chatRebindDeps === undefined) return;` already yields the consumed no-op for the empty state. Import the accessor into panel.ts. **Do NOT touch `currentId`** in the open path (the currentId setter re-seeds cursor machinery; `applyChatAnswer` already re-seeds it on apply — unchanged).
3. **Return-view**: the existing `chatReturnView` seeding from `p.view` must keep seeing `"overview"` — verify the setView/chat open path below the qid resolution seeds `chatReturnView` from `p.view` BEFORE `setView("chat")` (find via `grep -n "chatReturnView" src/panel/panel.ts`; the seed site is in onChat's setView branch). No change expected — assert it in a test.
4. **keys.ts**: NO dispatch change (`e` already intercepts in the overview; the `bare.chat && editorFocused` tier gate is unrelated). Update ONLY the comment at the `b.chat` block: note the overview targets the cursor row (BUG-004).
5. **Singleton reuse still works**: `record.questionId !== qid` comparison now compares against the cursor-row id — same-question reopen in the overview reuses the record byte-unchanged; different row triggers the (already-landed) abort-before-replace + usage notice from P1.M3.T1.S1 — untouched.

### Success Criteria

- [ ] Overview repro: q1 background, `o`, ↓, `e` → sidechat questionId is the cursor row's id.
- [ ] Last-row edge and empty-state (no questions) covered; empty → no record created.
- [ ] short/deep views: `e` still opens on `currentId` (unchanged).
- [ ] Esc from the chat returns to the overview; `currentId` untouched by the open.
- [ ] keys.test.ts "e dispatches in ${view}" loop green; all gates green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact dispatch/receiver code, the overviewJump read to mirror, the singleton/replace path context, and the test fixtures. All verified in-repo and anchored below.

### Documentation & References

```yaml
- file: src/panel/panel.ts (routed.onChat, lines 1150-1175)
  why: the fix site — `const qid = p.currentId;` at 1151; the existing undefined-guards;
    singleton reuse vs abort-notice-replace (P1.M3.T1.S1's landed BUG-005/007 handling,
    DO NOT duplicate or disturb it); chatReturnView seeding in the setView branch below.
  gotcha: keep the `args.chatRebindDeps === undefined` inert no-op for tests/non-TUI.

- file: src/panel/overview.ts (overviewJump ~405-418, stepOverviewCursor ~363-376)
  why: the read to mirror — `ordered[panel.overviewCursor]` with the ordered.length===0
    flash and q===undefined branches; place the new accessor beside overviewJump.
    stepOverviewCursor deliberately never touches currentId (that's WHY currentId is stale
    in the overview — the defect's root cause).
  gotcha: the accessor must NOT flash, NOT setView, NOT touch currentId — pure read.

- file: src/panel/keys.ts (b.chat block)
  why: comment-only touch — cite BUG-004 and the cursor-row targeting. The tier-2
    `bare.chat && editorFocused` gate and the unconditional dispatch stay as-is.
  gotcha: do NOT add a view gate here — the branch lives in panel.ts's onChat (single
    resolution point, works for host-override keys seams too).

- file: src/panel/keys.test.ts (line 395-407 view loop; makePanel/makeActions/makeRouter)
  why: the suite that must stay green + fixture conventions (DEFAULT_DATA.chat bytes,
    makePanel({view, focus})).

- file: src/panel/panel.test.ts
  why: where the behavior tests live — sidechat fixtures exist around the P1.M3.T1.S1
    tests (search `getSidechat`, `chatRebindDeps`); reuse their fake-port/rebind fixtures
    for the overview repro. Also the existing BUG-004-class overview tests
    (overviewJump etc.) show ordered-questions fixtures.

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/keys-overview.md
  why: the dedicated research doc — confirmed line numbers, the rejected gating
    alternative, guard impact analysis (verify-keymap-conflicts.sh reads config values
    only; no-hardcoded-keys/keymap-guard unaffected).

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M4T1S1/PRP.md
  why: parallel task (sendTurn-refusal buffer preservation) — DISJOINT files except
    panel.ts proximity (sendChatInput vs onChat); no shared lines; don't rebase over it.
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  overview.ts   # MODIFY: + overviewSelectedQuestionId export (+ JSDoc)
  panel.ts      # MODIFY: qid resolution in routed.onChat (~1151) + import
  keys.ts       # MODIFY: comment only (b.chat block)
  *.test.ts     # EXTEND: regression tests
```

### Desired Codebase tree

```bash
src/panel/
  overview.ts    # overviewSelectedQuestionId(panel): string | undefined
  panel.ts       # onChat: view === "overview" ? cursor-row id : currentId
  keys.ts        # comment updated
  panel.test.ts / keys.test.ts  # BUG-004 regressions
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// GOTCHA: the currentId SETTER re-seeds cursorIndex (ANSWER-PIN machinery) —
// do NOT assign currentId in the open path; only overviewJump/apply do that.
// GOTCHA: keep the accessor pure (no flash/setView/mutation) — overviewJump's
// flash branch belongs to jump, not to reads.
// GOTCHA: `args.chatRebindDeps === undefined` must keep short-circuiting BEFORE
// any overview read — the guard order in the existing first line stays.
// GOTCHA: `ordered[panel.overviewCursor]?.id` optional-chains the out-of-range
// case; do not throw (a desynced cursor is a defensive no-op, not an error).
// GOTCHA: don't touch the abort/usage-notice block inside the replace branch —
// P1.M3.T1.S1 owns it and its tests pin it.
```

## Implementation Blueprint

### Data models and structure

No new types — one pure function + one ternary.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD overviewSelectedQuestionId to src/panel/overview.ts
  - mirror overviewJump's read; [Mode A] JSDoc citing BUG-004; pure read
Task 2: MODIFY routed.onChat in src/panel/panel.ts (~1150-1152)
  - ternary qid resolution + import; update the block's leading comment (BUG-004 note);
    verify chatReturnView seeds from p.view (assert, don't change)
Task 3: UPDATE the b.chat comment in src/panel/keys.ts
Task 4: TESTS
  - panel.test.ts (or keys.test.ts, wherever the sidechat fixtures live):
    (1) repro: panel q1 + q2..q4, focus q1; view "overview"; overviewCursor=1 (q2 row);
        drive routed chat ("e" / DEFAULT_DATA.chat) → getSidechat()?.questionId === "q2"
    (2) last row: overviewCursor = count-1 → that question's id
    (3) empty state: no questions, view overview, e → no record, consumed (return true /
        onChat called, nothing opened — assert getSidechat() undefined)
    (4) short view regression: e → questionId === currentId
    (5) same-row reopen: existing record on q2, cursor on q2, e → record reused
        (questionId unchanged, no re-open) — the singleton branch
    (6) chatReturnView: open from overview, exit chat → view back to "overview"
  - keys.test.ts:405 loop unchanged and green
Task 5: GATES
  - npm run typecheck && npm test && bash scripts/verify-keymap-conflicts.sh
```

### Implementation Patterns & Key Details

```ts
// panel.ts — the whole behavioral change
routed.onChat = (p) => {
  // BUG-004: the overview targets the CURSOR ROW; currentId is stale there
  // (stepOverviewCursor never touches it by design).
  const qid = p.view === "overview" ? overviewSelectedQuestionId(p) : p.currentId;
  if (qid === undefined || args.chatRebindDeps === undefined) return;
  // …existing singleton-reuse / abort-notice-replace body unchanged…
```

### Integration Points

```yaml
CONSUMED BY: P1.M6.T1 (README §Keymap/§Side chat) and P1.M6.T1.S2 (ui-spec clause
  "e targets the overview cursor row") — the doc sync, NOT this task.
RELATED (landed, untouched): P1.M3.T1.S1 abort-before-replace protects the replace
  this fix makes easier to trigger; its tests cover the overview-route repro path.
GUARDS: verify-keymap-conflicts.sh / no-hardcoded-keys / keymap-guard unaffected.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/overview.test.ts src/panel/panel.test.ts src/panel/keys.test.ts -v
npm test
```

### Level 3: Integration (scripted)

```bash
bash scripts/verify-keymap-conflicts.sh   # config values only — unaffected, must stay green
```

### Level 4: Domain-specific

```bash
grep -n "overviewSelectedQuestionId" src/panel/overview.ts src/panel/panel.ts  # accessor + sole consumer
grep -n "BUG-004" src/panel/panel.ts src/panel/overview.ts src/panel/keys.ts    # [Mode A] cites
grep -n "currentId" src/panel/panel.ts | sed -n '/1150,1160/p'                 # no assignment added in onChat
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck`, `npm test`, `verify-keymap-conflicts.sh` all green.

### Feature Validation

- [ ] Overview `e` targets the cursor row (repro, last-row, empty-state, same-row reuse).
- [ ] short/deep `e` unchanged; currentId untouched on open; esc returns to overview.

### Code Quality Validation

- [ ] Accessor pure; onChat change is a ternary + comment; abort/notice block untouched.

### Documentation & Deployment

- [ ] [Mode A] JSDoc on the accessor + updated comments in panel.ts/keys.ts; README/ui-spec sync explicitly left to P1.M6.T1(.S2).

## Anti-Patterns to Avoid

- ❌ Don't gate `e` out of the overview — the rejected alternative; target the row instead.
- ❌ Don't set `currentId` in the open path — the setter re-seeds cursor machinery.
- ❌ Don't move the branch into keys.ts — one resolution point in onChat covers host key overrides.
- ❌ Don't flash/throw on out-of-range cursor — defensive undefined, consumed no-op.
- ❌ Don't touch the P1.M3.T1.S1 abort/usage-notice code or its tests.

---

**Confidence Score**: 9/10 — one pure accessor + one ternary at a verified line, with the repro, neighbor precedent (overviewJump/overviewUp), and landed replace-path protection already in place.

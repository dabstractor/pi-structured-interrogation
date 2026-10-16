# BUG-004 research — `e` (keys.chat) in the overview view targets `currentId`, not the cursor row

**Verdict: CONFIRMED.** In `view === "overview"`, pressing `e` opens the side chat on `panel.currentId` (the background question the user left when they pressed `o`), not on the row the overview cursor highlights. The mismatch appears as soon as the user moves the overview cursor, because entering overview seeds the cursor onto the current question's row but cursor movement deliberately never touches `currentId`.

All line numbers below are exact; quotes are verbatim from the repo at this commit.

---

## 1. The dispatch site — keys.ts chat branch has NO overview branch

`src/panel/keys.ts` (642 lines total). Section 4 "config-driven panel-level intercepts" contains the chat branch at **keys.ts:608-612**:

```ts
    if (matchesKey(data, b.chat)) {
      if (bare.chat && editorFocused) return false; // tier 2: must type
      actions.onChat(panel);
      return true;
    }
```

No `panel.view` test anywhere in the branch. Contrast with the two neighboring view-aware config actions, prev/next (**keys.ts:628-631** and **633-636**):

```ts
    if (matchesKey(data, b.prevQuestion)) {
      if (bare.prevQuestion && editorFocused) return false; // tier 2: must type
      if (panel.view === "overview") return overviewUp(panel);
      return actions.prevQuestion(panel);
    }
```

### THE PATTERN TO FOLLOW — fixed `enter` (keys.ts:556-560)

```ts
    if (!editorFocused && matchesKey(data, Key.enter)) {
      if (panel.view === "overview") return overviewJump(panel);
      if (panel.view === "deep") return acceptFromDeep(panel);
      return actions.accept(panel);
    }
```

In overview, `enter` resolves to the **cursor row's** question (`overviewJump`), not `currentId`. The fixed arrows (keys.ts:487, 493, 510, 514) and the config prev/next keys (630, 635) all branch `view === "overview"` → cursor row. `chat` is the ONLY question-targeted action left that ignores the view.

### The elaborate gate (BUG-011) — keys.ts:585-597, for contrast

```ts
    // BUG-011: the embedded editor renders only in the short view (and
    // note mode, a separate focus); focusing it from deep/overview would
    // arm an invisible editor (blind typing, silent stage-1 draft saves).
    // In those views the elaborate key falls through to normal panel
    // handling ...
    if (
      panel.view === "short" &&
      panel.focus !== "note" &&
      matchesKey(data, b.elaborate)
    ) {
      if (bare.elaborate && editorFocused) return false; // tier 2: must type
      actions.onElaborate(panel);
      return true;
    }
```

This gate exists because the elaborate action's target (the embedded editor) *only renders in the short view*. The chat action has no such rendering constraint — the chat view is a standalone view; opening it from overview arms nothing invisible. So the BUG-011 rationale does **not** transfer to `e`.

---

## 2. The open path — panel.ts onChat binds to p.currentId

**panel.ts:1057-1065** (the host-side refinement of the `onChat` seam; `defaultRoutedActions`'s `onChat` at keys.ts is a no-op):

```ts
    routed.onChat = (p) => {
      const qid = p.currentId;
      if (qid === undefined || args.chatRebindDeps === undefined) return;
      const record = getSidechatRecord();
      if (record === undefined || record.questionId !== qid) {
        openSidechatRecord(qid, args.chatRebindDeps); // snapshot NOW, once
      }
      if (p.view !== "chat") p.chatReturnView = p.view; // keep prior on re-open
      p.setView("chat"); // seeds scroll-bottom + chat focus (once-only via no-op)
    };
```

- `panel.ts:1058` — `const qid = p.currentId;` — the bug's crux. It reads the background question id.
- Everything else in the closure is already qid-parametric (`record.questionId !== qid`, `openSidechatRecord(qid, …)`), so retargeting `qid` fixes the whole path.
- The closure already handles re-open reuse, `chatReturnView = p.view` (so esc from a chat opened in overview returns to **overview** — already correct), and the no-deps inert no-op.
- Related host site: `panel.ts:502` reads `currentPanel?.currentId` (a different wiring path, not the key dispatch).

---

## 3. The overview cursor model — stepOverviewCursor never touches currentId

`src/panel/overview.ts` (418 lines). Exported symbols: `OVERVIEW_HEIGHT` (:78), `overviewMarker` (:153), `overviewMootReason` (:170), `OverviewInput` (:182), `OverviewContent` (:204), `buildOverviewContent` (:234), `clampOverviewScroll` (:328), `overviewUp` (:353), `overviewDown` (:358), `overviewJump` (:405). `stepOverviewCursor` is **module-private** (:370).

**overview.ts:353-360**:

```ts
export function overviewUp(panel: InterrogationPanel): boolean {
  return stepOverviewCursor(panel, -1);
}

export function overviewDown(panel: InterrogationPanel): boolean {
  return stepOverviewCursor(panel, 1);
}
```

**overview.ts:361-383** (cursor step, exact contract):

```ts
/**
 * Shared cursor step: mutate `panel.overviewCursor` within
 * `[0, ordered.length - 1]` — group headers are NOT cursor rows —
 * recompute `panel.overviewScroll` via {@link clampOverviewScroll}, and
 * invalidate. NEVER touches `panel.currentId` or `panel.cursorIndex`
 * (h2.29: the ONLY exit-to-question is `enter`/`esc`). Consumed no-op
 * (true) when there is nothing to move onto.
 */
function stepOverviewCursor(panel: InterrogationPanel, delta: number): boolean {
  const count = panel.state.orderedQuestions().length;
  if (count === 0) return true;
  const next = Math.min(count - 1, Math.max(0, panel.overviewCursor + delta));
  ...
}
```

CONFIRMED: cursor movement never writes `currentId`/`cursorIndex`. Pinned by keys.test.ts:1207 (`// currentId untouched — only enter/esc leave the overview list.`).

**overview.ts:405-418** — the ONLY exported reader of the cursor row's question:

```ts
export function overviewJump(panel: InterrogationPanel): boolean {
  const ordered = panel.state.orderedQuestions();
  if (ordered.length === 0) {
    panel.flash("no questions");
    return true;
  }
  const q = ordered[panel.overviewCursor];
  if (q === undefined) return false;
  if (panel.focus === "text") panel.blurTextField();
  panel.currentId = q.id; // setter re-seeds cursorIndex — recorded answer first, else ★ (ANSWER-PIN-001)
  panel.setView("short");
  panel.overviewScroll = 0;
  return true;
}
```

The resolution idiom a fix needs is `panel.state.orderedQuestions()[panel.overviewCursor]` — currently inline in `overviewJump` only.

### Panel-side cursor state (panel.ts)

- **panel.ts:671-677** — `overviewCursor` is a PUBLIC field on `InterrogationPanel`:
  ```ts
  /**
   * Overview cursor — index into orderedQuestions() (NOT into rendered
   * rows; group headers are not cursor targets). Seeded ONCE on the
   * setView("overview") transition to the current question's index
   * (P1.M5.T2.S1 — ctrl+l/esc round-trips stay where you were); moved only
   * by the overview actions (overview.ts), never by renderers.
   */
  overviewCursor = 0;
  ```
- **panel.ts:1534-1543** — `setView("overview")` seeds the cursor to the current question's row (so the initial state is consistent; the bug surfaces only after the user moves the cursor):
  ```ts
    } else if (view === "overview") {
      // Overview entry (P1.M5.T2.S1): seed the cursor to the CURRENT
      // question's row index ...
      const ordered = this.state.orderedQuestions();
      const idx =
        this.currentId !== undefined ? ordered.findIndex((q) => q.id === this.currentId) : -1;
      this.overviewCursor = idx >= 0 ? idx : 0;
      this.overviewScroll = 0;
  ```
- **panel.ts:623-648** — `currentId` setter (private backing `currentIdValue` :613). Assigning it re-seeds `cursorIndex` (ANSWER-PIN-001), re-seeds deep scroll when deep is live, and runs `syncBufferToQuestion(id)` (question-scoped editor buffer write-through). **A fix must NOT "fix" the bug by assigning `panel.currentId = <cursor-row id>` on chat open** — that would fire draft write-through and cursor re-seed side effects the chat open path explicitly avoids (`panel.ts:1051-1053`: "NO suspend, NO editor preload — the main editor is untouched (AC-17.1)"). Compute the qid locally instead.

### Is there an accessor for "the overview-selected question id"? — NO

`grep -rn "cursorQuestionId|selectedQuestionId" src/` → **zero matches**. There is no exported selector; no panel method named `overviewCursor*`/`cursorRow`/`selected*`/`jump*` beyond `overviewJump` itself. `keys.ts` DOES have full access to the panel (every branch reads `panel.view`, and overview actions read `panel.overviewCursor` + `panel.state.orderedQuestions()`), so no access problem exists — only the missing selector/branch.

---

## 4. Existing tests pinning `e` behavior

### Tests that pin dispatch-in-overview (relevant to fix-shape choice)

- **keys.test.ts:397-412** `test_bare_default_letters_dispatch_from_non_editor_focus` — loops `["short", "deep", "overview"]` and asserts:
  ```ts
  expect(route(DEFAULT_DATA.chat, panel), `e dispatches in ${view}`).toBe(true);
  ...
  expect(actions.onChat).toHaveBeenCalledTimes(1);
  ```
  → 'e' **must keep dispatching in overview**. A cursor-row fix passes untouched; a gate-out fix must delete `overview` from this loop (behavior change pinned by a test).
- **keymap-ac.test.ts:251-264** `test_ac1_t_falls_through_outside_the_short_view_bug011_gate_style_a` — asserts `onChat` NOT called for the *elaborate* key in deep/overview, with the explicit comment: `// (d/o/m/e still dispatch there — keys.test.ts owns that half.)` → intent documented: chat dispatches in overview.
- **keys.test.ts:278-279** spot wiring test: `spotRouter.route(DEFAULT_DATA.chat, makePanel());` → `expect(spot.onChat).toHaveBeenCalledTimes(1);` (short view default).
- **keys.test.ts:1387** (chat-view tier test): `expect(route("e", makePanel({ view: "chat", focus: "chat" }))).toBe(false); // tier 2: must type` — unrelated to overview, unaffected.
- **keys.test.ts:1294-1300** `test_ctrl_t_in_overview_view_falls_through_without_dispatching` (BUG-011 gate): `expect(route(DEFAULT_DATA.elaborate, makePanel({ view: "overview" }))).toBe(false);` — the gate's own pin; NOT a pin on 'e'.
- **ac-panel.test.ts** — no onChat-in-overview pinning; tests footer rendering and the `o` toggle (`CTRL_L = "o"`, :96, :449). Unaffected either way.

### Tests that pin the cursor-row pattern for other keys (the convention a fix joins)

- **keys.test.ts:1266-1277** `test_config_prev_next_in_overview_move_cursor_row` — asserts `panel.currentId` stays `"q1"` while `overviewCursor` moves; comment at :1207: `// currentId untouched — only enter/esc leave the overview list.` (A cursor-row chat fix does not violate this — it doesn't write currentId.)
- **keys.test.ts:1285-1296** `test_enter_in_overview_jumps_to_short_form` — `expect(panel.currentId).toBe("q2"); // the selected question` (cursor row = 1 → q2). THE reference assertion that "the selected question" means the cursor row in overview.
- **overview.test.ts** header (:18-19): "overviewUp/Down (domain clamp, currentId/cursorIndex untouched, scroll recompute, empty no-op), overviewJump (short view, currentId, R2 …)"; :491/:531 pin `panel.currentId` outcomes of jump.

### The gap

**No test anywhere asserts WHICH question id a chat opens on from overview.** The bug is unpinned in exactly that dimension — `keys.test.ts` uses spy `onChat` actions (which never see the qid; the qid choice lives in the panel.ts closure), and `ac-panel.test.ts` doesn't test onChat from overview. A fix should add: (a) a keys/overview-level test if a selector is exported, and/or (b) an ac-panel-level test that `handleInput("e")` from `view === "overview"` with `overviewCursor` on q2 opens/creates the record for **q2** while `currentId` stays q1.

---

## 5. Guard scripts / guard tests — would an overview branch for 'e' trip anything?

### scripts/verify-keymap-conflicts.sh

Checks **default accelerator VALUES** only: reads `src/config.ts` DEFAULT_CONFIG and verifies each binding is not on the curated AVOIDED list (ctrl+b, ctrl+shift+b/x/j, shift+down, ctrl+shift+s/w, ctrl+m, ctrl+shift+f/up/down — see the `AVOIDED` array in the script) and not claimed by a live `pi.registerShortcut("<key>"` in extension trees. Bare letters are PANEL-OWNED by construction ("a single printable character can never be a global pi binding, so no built-in conflict is possible by construction"). **An overview branch for the existing `e` binding changes no accelerator value — it cannot trip this script.** Only re-binding defaults would.

### src/no-hardcoded-keys.test.ts (note: repo root, not panel/)

Scans every non-test `.ts` under `src/` (comments stripped, `config.ts` DEFAULT_CONFIG allowlisted) for string literals naming accelerators: `/ctrl\+[a-z0-9]/i`, quote-anchored `alt+`/`super+`, and `shift+tab`. Fixed keys (enter/esc/arrows/digits) are deliberately NOT matched. **An overview branch compares `matchesKey(data, b.chat)` against the resolved binding — no literal appears — no trip.** Constraint to respect: never write `"e"` as a dispatch literal in runtime code; always route through `resolveBindings`/`b.chat`.

### src/keymap-guard.test.ts (actual path; the task brief said src/panel/ — it is src/keymap-guard.test.ts)

Four tests: (1) `test_no_default_key_is_on_a_taken_or_avoided_key` (AVOIDED_KEYS mirror of the script's array); (2) `test_every_default_matches_the_pi_accelerator_grammar`; (3) `test_keys_map_stays_complete_over_all_ten_actions`; (4) `test_guard_list_stays_curated_and_actionable` (≥11 entries, unique). **Adding an overview branch touches none of DEFAULT_CONFIG — no trip.** Shape A adds no new KeyAction, so the ten-action completeness pin is untouched.

### keys.ts module JSDoc ordering contract

The resolution-order list in keys.ts's header documents `chat` in step 4. A fix that branches INSIDE the existing `matchesKey(data, b.chat)` match (or only edits the panel.ts closure) preserves collision ordering — no new match arm is inserted before any other action.

---

## 6. Spec status — ambiguous, leaning cursor-row by convention

- **spec/ui-spec.md:84** (keymap table, the row for `e`): `| side chat | e | keys.chat (renamed from discuss) | non-editor focus — opens on the current question; opening on another question replaces the live chat (singleton) |` — "the current question" is undefined per-view; in overview the user's locus is the cursor row. Compare the arrows rows (:75, :76) which explicitly annotate `overview: cursor row`.
- **spec/ui-spec.md:20** (views list, Overview): `**Overview** (o): full-screen-in-panel list of all questions with markers — … enter jumps; esc returns.` — silent on `e`.
- **spec/product-requirements.md:41** (FR-15): "Per-question side chat (`e` …): a short conversation about ONE question…" — no view-specific target.
- **spec/product-requirements.md:101** (AC-17): "`e` on q3 → the chat view opens on q3" — "on q3" in AC context means the current question (short-view framing); does not address overview.
- **spec/SPEC.md:15** — `e` listed among bare-letter defaults; nothing on targeting.
- **spec/decisions.md:129** (SIDECHAT-001): "`e` becomes an IN-PANEL side chat about the current question…" — same "current question" phrasing.

**Conclusion:** the spec never says the chat must open on `currentId` from overview; it says "current question," which the repo elsewhere resolves view-aware (enter/prev/next → "overview: cursor row"). Shape A aligns with the established convention; Shape B matches no spec text either. Either fix should amend ui-spec.md:84 with an `overview: cursor row` annotation (mirroring :75/:76) for exactness.

---

## 7. Candidate fix shapes

### Shape A — chat targets the overview cursor row (RECOMMENDED)

`e` in overview opens the chat on `orderedQuestions()[overviewCursor].id`; `currentId` untouched. Two sub-variants:

- **A1 (minimal diff, keys.ts untouched):** edit only the panel.ts closure at :1057-1061:
  ```ts
  routed.onChat = (p) => {
    const qid = p.view === "overview" ? overviewSelectedQuestionId(p) : p.currentId;
    ...
  ```
  where `overviewSelectedQuestionId` is a NEW exported selector in overview.ts mirroring overviewJump's read (:411):
  ```ts
  export function overviewSelectedQuestionId(panel: InterrogationPanel): string | undefined {
    return panel.state.orderedQuestions()[panel.overviewCursor]?.id;
  }
  ```
  panel.ts already imports from overview.ts (uses `buildOverviewContent`/`clampOverviewScroll` at :2187/:2197), so no new module edge. Keep the closure's existing `qid === undefined → return` guard for the empty-list/out-of-range cases. Do NOT assign `panel.currentId` (see §3's setter side effects).
- **A2 (branch in keys.ts):** add `if (panel.view === "overview") …` inside the chat match and thread a qid through `RoutedActions.onChat` (signature change `(p, qid?) => void`), with the default no-op and panel.ts closure updated. More surface (interface + default + tests' `makeActions` stub at keys.test.ts:165) for the same behavior; only worth it if dispatch itself must differ (it doesn't — consumption semantics are identical).

Recommended: **A1** + new ac-panel/overview tests pinning the cursor-row target (and `currentId` unchanged).

Interactions verified safe under A1:
- Singleton reuse: `record.questionId !== qid` → replace works with the cursor-row qid unchanged; same-row re-open reuses byte-unchanged (panel.ts:1060-1063).
- `chatReturnView = "overview"` on open (panel.ts:1064) → esc from chat returns to overview with cursor row intact. Consistent.
- SIDECHAT-004 apply-from-chat: routes through ordinary accept seams which set currentId/advance as for any answer — normal path, no overview special-case needed.
- Repeated `e` while in chat view: `p.view !== "chat"` guard keeps chatReturnView stable (panel.ts:1064).

### Shape B — gate `e` out of overview (like elaborate/BUG-011) — NOT recommended

Would wrap the chat match in `panel.view !== "overview" &&` so it falls through (`return false` → inert in overview). Arguments against:
1. **Contradicts pinned intent:** keys.test.ts:405 pins `e dispatches in "overview"`; keymap-ac.test.ts's comment at :256 documents "(d/o/m/e still dispatch there)". Both would need edits.
2. **Wrong precedent:** the elaborate gate exists because its target (embedded editor) renders only in short view (BUG-011, keys.ts:585-588). The chat view is a full standalone view — nothing invisible gets armed from overview.
3. **Loses capability without fixing the mismatch:** the user in overview pressing `e` plausibly wants to discuss the row they're on; gating makes the key dead instead.
4. Spec is equally silent for both shapes, but the repo convention (arrows, prev/next, enter all "overview: cursor row") points at A.

---

## 8. Symbols a fix touches (Shape A1)

| File | Site | Change |
|---|---|---|
| `src/panel/overview.ts` | new export after `overviewDown` (:360) or near `overviewJump` (:405) | `export function overviewSelectedQuestionId(panel: InterrogationPanel): string | undefined` returning `panel.state.orderedQuestions()[panel.overviewCursor]?.id` |
| `src/panel/panel.ts` | :1057-1061 (`routed.onChat` closure) | `const qid = p.view === "overview" ? overviewSelectedQuestionId(p) : p.currentId;` + import |
| `src/panel/keys.ts` | none | chat branch (:608-612) unchanged — already dispatches in overview |
| tests | keys.test.ts unchanged; add overview.test.ts (selector unit) + ac-panel.test.ts or equivalent (cursor-row open, currentId unchanged) | new pins for the previously-unpinned dimension |
| `spec/ui-spec.md` | :84 | annotate `overview: cursor row` (mirroring :75/:76) |

Constraints to respect: no `"e"` literal in runtime code (no-hardcoded-keys + resolveBindings discipline); do not reorder keys.ts match arms; do not mutate `currentId` on the chat-open path; tier-2 forwarding (`bare.chat && editorFocused → return false`) unchanged.

---

## 9. Claim-by-claim scorecard

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `e` in overview opens chat on `currentId`, not the cursor row | CONFIRMED | keys.ts:608-612 (no view branch) + panel.ts:1058 (`const qid = p.currentId;`) |
| 2 | Overview cursor movement never touches currentId | CONFIRMED | overview.ts:361-383 doc + code; keys.test.ts:1207 |
| 3 | `enter` in overview targets the cursor row (pattern to follow) | CONFIRMED | keys.ts:556-560; overview.ts:405-418; keys.test.ts:1285-1296 |
| 4 | prev/next + arrows are view-aware to the cursor row | CONFIRMED | keys.ts:487/493/510/514/630/635; ui-spec:75-76 |
| 5 | No existing accessor for the cursor row's question id | CONFIRMED | grep `cursorQuestionId\|selectedQuestionId` → 0 hits; only inline read at overview.ts:411 |
| 6 | keys.ts can read the overview selection if needed | CONFIRMED | `panel.overviewCursor` public (panel.ts:677), `panel.state.orderedQuestions()` used by overview.ts actions |
| 7 | Tests pin `e` dispatch in overview | CONFIRMED | keys.test.ts:405 (`e dispatches in ${view}`), keymap-ac.test.ts:256 comment |
| 8 | No test pins WHICH qid chat opens on from overview | CONFIRMED | spy `onChat` never sees qid; ac-panel.test.ts has no such case |
| 9 | verify-keymap-conflicts.sh unaffected by an overview branch | CONFIRMED | script checks DEFAULT_CONFIG values only; bare letters panel-owned by construction |
| 10 | no-hardcoded-keys / keymap-guard unaffected | CONFIRMED | §5 above; keymap-guard is at src/keymap-guard.test.ts (not src/panel/) |
| 11 | Spec says chat targets the cursor row in overview | REFUTED (spec is silent/ambiguous) | ui-spec:84 "opens on the current question"; Overview section :20 silent; convention (ui-spec:75-76) leans cursor row |
| 12 | BUG-011 elaborate-gate rationale applies to chat | REFUTED | editor renders only in short view; chat view is standalone — nothing invisible armed |

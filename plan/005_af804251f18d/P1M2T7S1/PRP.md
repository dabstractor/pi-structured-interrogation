# PRP — P1.M2.T7.S1: Delete discuss.ts + discuss.test.ts + host wiring; sweep residual mentions

---
name: "P1.M2.T7.S1 — discuss-in-chat deletion + residual sweep"
description: "Delete the dead discuss-in-chat feature end-to-end: remove src/panel/discuss.ts and src/panel/discuss.test.ts (whole files), reword every stale discuss-era comment in panel.ts / keys.ts / editor-preservation.ts(+test) / suspend.ts / keymap-ac.test.ts, and land the R4 successor pin in editor-preservation.test.ts (opening the chat stages NO drafts, never suspends, never writes the main editor, and never double-stages across a simulated resume). The import + discussInChat host call in panel.ts are ALREADY GONE (P1.M2.T4.S1 landed routed.onChat) — this item deletes the corpse and sweeps the mentions. After this item, `grep -rin discuss src/` hits ONLY: config.ts's coerceKeys legacy alias + its config.test.ts alias suite + three prose leave-sites (compaction.ts:100, tool-schema.ts:45, sidechat-prompt.ts:120). README discuss rows are Mode B — P1.M3.T3, NOT this item. Full suite + typecheck + lint green."
---

## Goal

**Feature Goal**: The per-question side chat (SIDECHAT-001…005) fully replaces discuss-in-chat. The dead discuss engine and its test file are deleted, every residual `discuss` mention in `src/` is reworded away (comments only — zero behavior change), and the one piece of coverage worth keeping (R4/BUG-002: the chat-open gesture must never stage drafts, suspend, or write the main editor, and must never double-stage drafts across a resume) survives as a successor pin in `editor-preservation.test.ts`.

**Deliverable**:
1. Two file deletions: `src/panel/discuss.ts`, `src/panel/discuss.test.ts`.
2. Comment rewords (no code changes) at 10 anchored sites across panel.ts, keys.ts, editor-preservation.ts, editor-preservation.test.ts (one test RENAME), suspend.ts, keymap-ac.test.ts.
3. One new describe block + 2 new tests in `src/panel/editor-preservation.test.ts` (the successor pin), with ported fixtures (`makeDraftsStore`, `slotFor`/`slotCount`, chat-deps doubles).
4. Verification: `npm test`, `npm run typecheck`, `npm run lint`, `scripts/verify-keymap-conflicts.sh` all green; the grep sweep shows only sanctioned survivors.

**Success Definition**: `grep -rin discuss src/` returns exactly: `src/config.ts` alias block (~:216-224), `src/config.test.ts` alias suite (~:257-343), `src/compaction.ts:100` ("discussed" prose), `src/tool-schema.ts:45` ("as discussed" prose), `src/panel/sidechat-prompt.ts:120` ("keep discussing" prose). Suite: 51 test files, 1509 tests (baseline 52 files / 1524 tests − 17 deleted discuss tests + 2 new successor tests), all green. No behavior change anywhere — deletions and comments only, plus new tests.

## User Persona

**Target User**: The TUI answerer using the interrogation panel.

**Use Case**: After this lands, nothing user-visible changes: `e` already opens the in-panel side chat (P1.M2.T4.S1). This item removes the dead code path and its stale documentation so future readers can't mis-learn a handoff mechanism ("suspend + preload the main editor") that no longer exists.

**User Journey**: N/A (internal cleanup — the user journey is unchanged by construction; the PRD's SIDECHAT replacement is already live).

**Pain Points Addressed**: Dead feature code that still compiles and still reads as load-bearing; stale comments that route new contributors (and future AI agents) to a deleted UX; test coverage for a dead gesture masquerading as live R4 protection.

## Why

- The PRD replaced discuss-in-chat with the per-question side chat (SIDECHAT-001…005, h2.38 / h3.9). P1.M2.T4.S1 landed the new open path and severed the host wiring; this item finishes the removal so P1.M3's guards/docs land on a clean surface.
- Binding authority: `plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md` §"Discuss deletion inventory" — the Dies/Stays/verdicts/sweep tables. Every decision below traces to it.
- The R4 draft write-through invariants must NOT lapse when discuss.test.ts dies: the "chat open stages no drafts / no double staging" pin is re-established against the LIVE side-chat gesture (AC-17.1's no-suspend guarantee).
- Final `discuss` grep verification is P1.M3.T3.S2's job; this item makes that grep trivial by cleaning src/ now.

## What

### Behavior contract (exact)

1. **Delete `src/panel/discuss.ts`** (whole file — `buildDiscussTemplate`, `discussFooter`, `discussInChat`). Nothing outside `discuss.test.ts` imports it (verified: `grep -rn "from \"./discuss.js\"" src/` → only the test).
2. **Delete `src/panel/discuss.test.ts`** (whole file, 611 lines). BEFORE deleting, land the successor pin (Task 1) so coverage never lapses. Suite verdicts per the inventory: template-contract suite DIES; suspend+preload suite DIES; router-wiring suite DIES (`e`-dispatch-per-view coverage survives via `keys.test.ts:397` — `expect(route(DEFAULT_DATA.chat, panel), \`e dispatches in ${view}\`).toBe(true)` — leave that file untouched); R4 suite's discuss-era tests DIE, its side-chat-era tail (`test_chord_chat_key_mid_write_opens_chat_without_touching_the_draft`, :575-611) is subsumed by the successor pin.
3. **Successor pin in `src/panel/editor-preservation.test.ts`** — new describe block, e.g. `"side-chat open — draft write-through successor (R4/BUG-002, P1.M2.T7.S1)"`, two tests (spec below in Implementation Blueprint, Task 1).
4. **Comment rewords — zero code/behavior change.** The setEditorText/getEditorText declarations, all consumers, and all fakes SURVIVE untouched (Stays list below). Only JSDoc/comment text mentioning discuss changes.
5. **Out of scope (do NOT touch)**: README discuss rows (:39, :148, :189, :237, :364 — Mode B, P1.M3.T3); the `coerceKeys` alias in config.ts + its config.test.ts suite; the esc break-out flow (FR-14/FR-16); `keys.test.ts`; `tree-nav-repro.test.ts` / `ac-scripted.test.ts` / `ac-panel.test.ts` fakes.

### Success Criteria

- [ ] `src/panel/discuss.ts` and `src/panel/discuss.test.ts` no longer exist; `git status` shows exactly the two deletions + edits to panel.ts, keys.ts, editor-preservation.ts, editor-preservation.test.ts, suspend.ts, keymap-ac.test.ts (+ research/plan files).
- [ ] `grep -rin "discuss" src/` output is EXACTLY the five sanctioned survivors (config.ts alias block; config.test.ts alias suite; compaction.ts:100; tool-schema.ts:45; sidechat-prompt.ts:120). No hits in any panel.ts/keys.ts/editor-preservation*/suspend.ts/keymap-ac.test.ts site.
- [ ] Successor pin green and covering: `e` mid-write opens chat with NO suspend (`done` unresolved), NO main-editor write (`editor.text` unchanged), NO draft staging (`setDraft` never called, no slot), buffer intact; and the two-leg resume flow ends with the store holding the LATEST text in exactly ONE slot.
- [ ] `npm test` → 51 files / 1509 tests, zero failures. `npm run typecheck` clean (this is the dangling-import safety net for the deletion). `npm run lint` clean. `scripts/verify-keymap-conflicts.sh` passes unchanged (no keymap edits).
- [ ] `keys.test.ts` untouched and green (the surviving `e`-dispatch-per-view coverage).

## All Needed Context

### Context Completeness Check

Every sweep site is anchored by its current verbatim text (line numbers listed for orientation only — P1.M2.T6.S1 lands in parallel and WILL shift panel.ts lines after `routed.onChat` ~:1033). The successor pin's fixture requirements are enumerated with their source shapes. The ruling inventory is quoted per-table. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md
  why: THE ruling — §"Discuss deletion inventory" (Dies/Stays/suite verdicts/residual sweep) and §"Suite gates" (npm test / typecheck / lint / scripts/verify-keymap-conflicts.sh; AUTOMATION-POLICY: no live TUI in tests)
  pattern: implement literally; where its line numbers have drifted, re-anchor by symbol/quoted text
  gotcha: inventory says discuss.test.ts is 583 lines — it is 611 now (T4.S1 rewrote the middle suite); the inventory's "panel.ts:74 import / :652-661 host refinement" are ALREADY GONE (removed by P1.M2.T4.S1)

- file: plan/005_af804251f18d/P1M2T7S1/research/notes.md
  why: verified anchors for every claim — the 12-row sweep table with verbatim anchor text, survivor list, successor-pin mechanics (openPanel explicit-opts precedence, chat-deps double shape, writeThroughCurrentDraft focus gate), expected test counts

- file: plan/005_af804251f18d/P1M2T6S1/PRP.md
  why: PARALLEL CONTRACT — T6 wires onApplyConfirm in the panel.ts constructor routed block AFTER routed.onChat (~:1033) and edits resolveSidechatHostSeams (~:486-508); assume it landed exactly as specified
  pattern: anchor all panel.ts edits by quoted comment text, never by line number; do not undo or duplicate its wiring
  gotcha: T6 does not touch any discuss mention — the sweep sites below are disjoint from its edits

- file: src/panel/discuss.test.ts
  why: the file being deleted AND the model for the successor pin — :575-611 test_chord_chat_key_mid_write_opens_chat_without_touching_the_draft (chat-deps double shape, assertions), :443-450 makeDraftsStore (port this), :455-470 makeRealPanel + slotFor/slotCount peek pattern, :547-573 test_discuss_no_double_staging_after_simulated_resume (two-leg resume skeleton)
  pattern: read fully BEFORE deleting; port the fixtures into editor-preservation.test.ts adapted to its openPanel-driven flow

- file: src/panel/editor-preservation.test.ts
  why: successor-pin home — existing helpers makePreservationPi (fake ctx with editor model + setEditorText/getEditorText), optsFor, firstCall, flush, resumeOpenPanel, seedState; the :274-290 test to RENAME; :142-148 comment to reword
  gotcha: this file has NO drafts fixture and never uses handleInput — the new tests introduce both (port from discuss.test.ts); drive panels through the REAL openPanel flow (resumeOpenPanel needs it), not new InterrogationPanel(...)

- file: src/panel/panel.ts
  why: 4 comment rewords — setEditorText JSDoc (~:326-331, inside PiUISurface.ui), pi?: arg JSDoc (~:536-541), routed.onChat comment (~:1017-1021), writeThroughCurrentDraft JSDoc (~:1354-1356). openPanel (:2441+) shows explicit chatRebindDeps/sidechatEngine opts win (:2458-2467) — why the successor test injects doubles
  gotcha: line numbers WILL drift (T6 parallel) — anchor by quoted text; the pi? arg STAYS (openPanel passes it at the constructor call) even though the panel no longer consumes it post-T4 — reword its JSDoc honestly, do not remove the arg

- file: src/panel/keys.ts
  why: 3 comment rewords — RoutedActions interface JSDoc (~:138-140), onChat field JSDoc (~:163-167), default no-op onChat body comment (~:408-413). All three still narrate the dead "routes to discussInChat (./discuss.js)" bridge
  pattern: comment-only edits; the default onChat stays a no-op (panel.ts refines it)

- file: src/panel/editor-preservation.ts
  why: :31-33 finding #2 reword ("S2's discuss-in-chat setEditorText preload survive resume…"); :95-110 restoreEditorTextIfEmpty is the LIVE setEditorText consumer that must keep working (Stays)
  pattern: keep the chained-cycles semantics intact — only drop the discuss attribution

- file: src/panel/suspend.ts + src/panel/keymap-ac.test.ts
  why: suspend.ts :21-22 JSDoc lists "P1.M6.T2.S2 (discuss)" as a consumer — drop it; keymap-ac.test.ts :36-38 comment lists "keys.test.ts / discuss.test.ts /" among remap fixtures — remove discuss.test.ts from the list
  gotcha: keymap-ac.test.ts logic untouched — a comment edit only

- file: src/config.ts + src/config.test.ts
  why: the SANCTIONED SURVIVORS — coerceKeys legacy alias (config.ts ~:216-224) + its alias suite (config.test.ts ~:257-343). Do NOT touch; they are why the final grep still legitimately hits "discuss"
  gotcha: deleting the alias tests would break P1.M1.T1.S2's delivered contract — they stay green

- file: src/panel/keys.test.ts
  why: :397 `e dispatches in ${view}` (short/deep/overview loop) is the surviving e-dispatches-per-view coverage once discuss.test.ts dies — read-only verification that it exists and stays green
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  discuss.ts                     # DELETE (whole file)
  discuss.test.ts                # DELETE (whole file, 611 lines, 17 tests)
  panel.ts                       # MODIFY — 4 comment rewords (no code)
  keys.ts                        # MODIFY — 3 comment rewords (no code)
  editor-preservation.ts         # MODIFY — 1 comment reword (no code)
  editor-preservation.test.ts    # MODIFY — rename 1 test, reword 2 comments, ADD successor describe + 2 tests + ported fixtures
  suspend.ts                     # MODIFY — 1 comment reword (no code)
  keymap-ac.test.ts              # MODIFY — 1 comment reword (no code)
src/config.ts                    # UNTOUCHED (alias survivor)
src/config.test.ts               # UNTOUCHED (alias-suite survivor)
src/panel/keys.test.ts           # UNTOUCHED (e-per-view coverage survivor)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Net: two deletions, six edits, zero additions.
src/panel/           # minus discuss.ts + discuss.test.ts
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: P1.M2.T6.S1 is implemented IN PARALLEL — it edits panel.ts at the
// constructor routed block (after routed.onChat ~:1033) and
// resolveSidechatHostSeams (~:486-508). EVERY panel.ts anchor in this PRP is
// given as QUOTED TEXT for exactly this reason. Find sites with:
//   grep -n "discuss" src/panel/panel.ts
// (expect exactly 4 hits: the setEditorText JSDoc, the pi? JSDoc, the
// onChat comment, the writeThroughCurrentDraft JSDoc).
//
// CRITICAL: DELETE ORDER — land the successor pin FIRST (Task 1), then delete
// discuss.test.ts (Task 2). If you delete first, the suite still passes
// (nothing imports the file) but R4 chat-open coverage silently lapses.
//
// GOTCHA: `e` is INERT unless openPanel gets chat deps. resolveSidechatHostSeams
// returns undefined for fake surfaces (no modelRegistry), and openPanel's
// precedence is `opts.chatRebindDeps ?? derived` — the successor test MUST
// inject explicit chatRebindDeps + sidechatEngine in optsFor(state, {...}).
//
// GOTCHA: writeThroughCurrentDraft (panel.ts ~:1358) stages ONLY when focus is
// "text"/"note" at suspend time. Opening chat mid-write leaves focus "chat"
// (blurChatInput → "options") — the buffer stays put but suspend-from-chat does
// NOT stage it. The no-double-staging test therefore re-claims text focus
// (panel.focusTextField("writein")) before done(null), mirroring the discuss-era
// two-leg test's structure with the chat detour inserted between typing and
// suspend.
//
// GOTCHA: vitest auto-collects src/**/*.test.ts — deleting discuss.test.ts
// removes it from the run; no config edit needed. Expected count arithmetic:
// 1524 − 17 deleted + 2 new = 1509 (if T6 added tests meanwhile, the delta is
// still −17/+2 on top of whatever T6 left — assert the DELTA, not the absolute).
//
// GOTCHA: the em-dash/quote characters in the anchor texts are real UTF-8
// (— and " ") — copy anchor text from the file, not from memory, when editing.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/editor-preservation.test.ts — successor pin BEFORE deletion
  - ADD fixtures near the existing ones (port from discuss.test.ts):
    * makeDraftsStore() — Map-backed { getDraft, setDraft, getNote, setNote } vi.fn double (discuss.test.ts :443-450 shape)
    * slotFor(panel, id) / slotCount(panel) — private draftSlots peek via `panel as unknown as { draftSlots: Map<...> }` (discuss.test.ts :459-469 shape)
    * CHAT_DEPS — the chat-deps double: { chatRebindDeps: { resolveModelSnapshot: () => ({ provider: "test", modelId: "test-model" }), buildSystemPrompt: () => "system prompt", buildBranchSnapshot: () => [] as never }, sidechatEngine: { sendTurn: () => true, abort: () => {} } } (chord-test shape, discuss.test.ts :583-591)
  - ADD describe "side-chat open — draft write-through successor (R4/BUG-002, P1.M2.T7.S1)" with TWO tests (drive everything through the REAL openPanel flow — resumeOpenPanel requires it):
    * test_chat_open_mid_write_stages_no_drafts_no_suspend_no_editor_write:
      - mock = makePreservationPi(); state = seedState(); drafts = makeDraftsStore()
      - openPanel(mock.pi, optsFor(state, { drafts, ...CHAT_DEPS })); await flush()
      - panel = firstCall(mock).component; panel.focusTextField("writein"); panel.textField.setText("precious unsaved typing")
      - expect(panel.handleInput("e")).toBe(true)  // bare BAREKEYS-001 default
      - expect(panel.view).toBe("chat"); expect(panel.focus).toBe("chat")
      - expect(firstCall(mock).resolved).toBe(false)          // AC-17.1: NO suspend
      - expect(mock.editor.text).toBe("")                    // NO main-editor preload write
      - expect(drafts.setDraft).not.toHaveBeenCalled()       // NO staging
      - expect(panel.draftTextFor(<currentId>)).toBeUndefined()
      - expect(panel.textField.getText()).toBe("precious unsaved typing")  // buffer stays put
      - RECOMMENDED extra leg (parity with the dying chord test): repeat the gesture with a remapped chord (config keys: { ...DEFAULT_CONFIG.keys, chat: "ctrl+shift+e" }, handleInput("\u001b[101;6u")) asserting the same invariants mid-edit
    * test_chat_open_no_double_staging_after_simulated_resume:
      - Leg 1: open + type "first pass" (focusTextField("writein")) → handleInput("e") (chat; assert drafts.setDraft NOT called — the gesture itself never stages) → exit chat by reclaiming text focus: panel.focusTextField("writein") → firstCall(mock).done(null) (the ordinary esc break-out suspend) → await flush()
      - expect(drafts.getDraft(<qid>)).toBe("first pass")     // staged exactly once by the suspend write-through
      - Leg 2: expect(resumeOpenPanel(mock.pi)).toBe(true); await flush(); second = the next captured call's component (chat deps persist — resumeOpenPanel spreads lastOpts which stores RESOLVED opts)
      - second.focusTextField("writein"); expect(second.textField.getText()).toBe("first pass")  // re-seeded from the surviving draft, no duplication
      - second.textField.setText("second pass"); second.handleInput("e"); second.focusTextField("writein"); <secondCall>.done(null); await flush()
      - expect(drafts.getDraft(<qid>)).toBe("second pass"); expect(slotCount(second)).toBe(1); expect(slotFor(second, <qid>)).toEqual({ value: <qid>, text: "second pass" })  // latest text, ONE slot — no double staging
      - qid = the state's first open question id (seedState's fixture; read via panel.currentId after open — do NOT hardcode without checking seedState)
  - RENAME test "test_discuss_preload_survives_resume_cycle" (:274) → e.g. "test_post_resolve_editor_write_survives_resume_cycle"; REWORD its inline comments: "suspend (break out to discuss in chat)" → "suspend (esc break-out to the main conversation)"; "S2 discuss.ts discussInChat: the setEditorText write is deferred one microtask AFTER custom() resolves (post-restore) — mirror that here." → keep the deferral semantics, drop the S2/discuss attribution; "S2's flow survives the whole cycle" → "the post-resolve write survives the whole cycle". Test LOGIC unchanged.
  - REWORD the fake-done comment (:142-148): "pi's discuss-style post-resolve writes land AFTER the restore, never before it" → "pi's post-resolve editor writes land AFTER the restore, never before it"
  - NAMING: snake_case test names, no "discuss" substring anywhere new
  - PLACEMENT: fixtures after optsFor; new describe after the existing preservation describes
  - VERIFY: npm test — new tests green, everything else untouched

Task 2: DELETE src/panel/discuss.ts and src/panel/discuss.test.ts
  - Use `git rm src/panel/discuss.ts src/panel/discuss.test.ts` (or delete + let git track)
  - CONFIRM first: grep -rn "from \"./discuss.js\"" src/ → ZERO hits outside the deleted test (verified at research time)
  - RUN npm run typecheck immediately — the dangling-import safety net (vitest would also fail on a missing import)

Task 3: MODIFY src/panel/panel.ts — 4 comment rewords (anchor by quoted text; T6 lands in parallel so lines drift)
  - Site 1, setEditorText JSDoc (currently: "Editor preload (h2.35 legacy discuss handoff) — a sanctioned writer of main-editor text from the panel (discuss.ts; its panel wiring was removed by P1.M2.T4.S1 — the file itself dies in P1.M2.T7.S1)."): reword to name the LIVE consumer — editor-preservation.ts's fallback helpers (restoreEditorTextIfEmpty) are the sanctioned writer; keep the optional-member `?.` guidance sentence as-is
  - Site 2, pi?: PiUISurface arg JSDoc (currently: "...so the host can refine the discuss seam at the router-construction site: keys.ts itself stays UI-free."): reword honestly — surface carrier captured once per openPanel (same pattern as editorFactory), retained for host/test ergonomics; the panel's own seams (chatRebindDeps etc.) carry the live wiring; keys.ts stays UI-free. KEEP the arg and the openPanel pass-through — no code change
  - Site 3, routed.onChat comment (currently ends: "...(AC-17.1; the old discuss handoff call is gone — deleting the engine itself is P1.M2.T7.S1)"): drop the historical parenthetical; keep "NO suspend, NO editor preload — the main editor is untouched (AC-17.1)"
  - Site 4, writeThroughCurrentDraft JSDoc (currently: "Reuse contract: S2 (discuss) and S3 (note-mode swap) call this before their own exits."): drop "S2 (discuss)"; keep the note-mode swap and the suspend() caller references accurate (check live callers before final wording — suspend() and the note-mode path remain)
  - GOTCHA: verify exactly 4 grep hits before editing: grep -n "discuss" src/panel/panel.ts

Task 4: MODIFY src/panel/keys.ts — 3 comment rewords
  - Site 1, RoutedActions interface JSDoc (currently: "...M6 widget; onChat routes to discussInChat until the SIDECHAT view lands — P1.M2.T4.S1)."): → "onChat opens the per-question side chat — host-wired (P1.M2.T4.S1))"
  - Site 2, onChat field JSDoc (currently: "Wired host-side at panel.ts's router-construction site (the closure needs the PiUISurface); still routes to discussInChat until SIDECHAT's own action lands (P1.M2.T4.S1); default no-op."): → "Wired host-side at panel.ts's router-construction site; default no-op." (keep the open-the-side-chat first line)
  - Site 3, default no-op onChat body (currently: "SIDECHAT bridge: still routes to discussInChat (./discuss.js) until the side-chat view lands (P1.M2.T4.S1) and the engine is deleted (P1.M2.T7.S1). Wired host-side — panel.ts refines this seam; ..."): → "Default no-op — panel.ts refines this seam with the open-or-replace path (P1.M2.T4.S1); keys.ts itself stays UI-free." (keep any still-true sentences about the closure/PiUISurface rationale)
  - NO code changes: the default onChat stays a no-op

Task 5: MODIFY src/panel/editor-preservation.ts + src/panel/suspend.ts + src/panel/keymap-ac.test.ts — comment rewords
  - editor-preservation.ts :31-33 (finding #2, currently: "Chained cycles re-snapshot the LIVE editor at each open, so text typed while suspended (side chat) and S2's discuss-in-chat `setEditorText` preload survive resume + subsequent close too."): → keep the chained-cycles semantics, drop the "S2's discuss-in-chat" attribution (e.g. "...so text typed while suspended (side chat) — and any post-resolve `setEditorText` write — survives resume + subsequent close too.")
  - suspend.ts :21-22 (currently: "...the named consumer surface for P1.M6.T1.S2 (/interrogate + global toggle — now the /interrogate invoke command) and P1.M6.T2.S2 (discuss)."): → drop "and P1.M6.T2.S2 (discuss)" — keep the P1.M6.T1.S2 consumer reference
  - keymap-ac.test.ts :36-38 (currently: "S1's deliberate chord-REMAP fixtures (keys.test.ts / discuss.test.ts / ..."): → remove "discuss.test.ts /" from the list; comment-only edit, no test changes

Task 6: VERIFICATION SWEEP + GATES (see Validation Loop) — the sweep is the deliverable's proof
```

### Implementation Patterns & Key Details

```ts
// Successor test A skeleton (Task 1) — the invariants that died with
// discuss.test.ts's chord test + R4 staging assertions, re-pinned against
// the LIVE side-chat gesture. Note every "not" — this is a negative test:
test("test_chat_open_mid_write_stages_no_drafts_no_suspend_no_editor_write", async () => {
  const mock = makePreservationPi();
  const state = seedState();
  const drafts = makeDraftsStore();
  openPanel(mock.pi, optsFor(state, { drafts, ...CHAT_DEPS }));
  await flush();
  const panel = firstCall(mock).component;
  panel.focusTextField("writein");
  panel.textField.setText("precious unsaved typing");

  expect(panel.handleInput("e")).toBe(true);          // bare default, BAREKEYS-001
  expect(panel.view).toBe("chat");                    // the gesture IS the open path
  expect(panel.focus).toBe("chat");
  expect(firstCall(mock).resolved).toBe(false);       // AC-17.1: never suspends
  expect(mock.editor.text).toBe("");                  // never writes the main editor
  expect(drafts.setDraft).not.toHaveBeenCalled();     // never stages drafts
  expect(panel.textField.getText()).toBe("precious unsaved typing"); // buffer stays put
});

// GOTCHA (Task 1, test B): resumeOpenPanel re-opens from lastOpts (RESOLVED
// opts — the injected CHAT_DEPS persist), so the second panel's `e` is live
// too. Stage via the ORDINARY suspend write-through (focus back on text,
// then done(null)) — the chat detour must not affect staging cardinality.
```

### Integration Points

```yaml
NONE — no config, routes, database, or schema changes. The only "integration"
is deletion hygiene: vitest auto-drops deleted test files; tsc catches any
dangling import; the README/Mode-B doc sync is explicitly P1.M3.T3's job.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck     # tsc --noEmit — run IMMEDIATELY after the deletions (Task 2): the dangling-import safety net
npm run lint          # eslint src scripts *.ts — comment edits can still trip rules (max-len etc.); fix what flags
# Expected: both clean. If typecheck errors, a discuss import survived somewhere — grep for it.
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test
# Expected: 51 test files (was 52), 1509 tests if T6 added none (delta on top of
# T6's landed state: −17 deleted discuss tests, +2 successor tests), ALL PASS.
# If the count arithmetic differs, run `npx vitest run src/panel/editor-preservation.test.ts src/panel/keys.test.ts src/config.test.ts -v` and account for every delta before proceeding.

npx vitest run src/panel/editor-preservation.test.ts -v   # successor pin + renamed test green
npx vitest run src/panel/keys.test.ts -v                  # e-per-view coverage green, file untouched
npx vitest run src/config.test.ts -v                      # alias suite green (survivor)
```

### Level 3: Integration Testing (System Validation)

```bash
# THE SWEEP — this item's actual deliverable. Must return EXACTLY the
# sanctioned survivors and nothing else:
grep -rin "discuss" src/
# Expected output (5 sites, no others):
#   src/compaction.ts:100:...discussed...                     (prose — leave)
#   src/tool-schema.ts:45:...as discussed...                  (prose — leave)
#   src/panel/sidechat-prompt.ts:120:...keep discussing...    (prose — leave)
#   src/config.ts:216...224  — the coerceKeys legacy alias block (sanctioned)
#   src/config.test.ts:257...343 — the alias test suite (sanctioned)
#
# ALSO verify the dead symbols are gone:
grep -rn "discussInChat\|buildDiscussTemplate\|discussFooter" src/   # → zero hits
ls src/panel/discuss.ts src/panel/discuss.test.ts 2>&1              # → No such file

# Keymap gate (suite gate per architecture doc; no keymap changed — must pass identically):
scripts/verify-keymap-conflicts.sh
```

### Level 4: Creative & Domain-Specific Validation

```bash
# None — AUTOMATION-POLICY (plan/001): no live TUI sessions in automation.
# The successor pin IS the scripted proof that the user-facing invariants
# (AC-17.1 no-suspend, R4 no-staging) hold after the deletion. Interactive
# checks belong to the human runbook (MANUAL-TUI-AC-RUNBOOK.md), unchanged.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1-3 all pass: `npm test` (51 files, delta −17/+2), `npm run typecheck`, `npm run lint`, `scripts/verify-keymap-conflicts.sh`
- [ ] `grep -rin "discuss" src/` → exactly the 5 sanctioned survivors (config.ts alias, config.test.ts alias suite, compaction.ts:100, tool-schema.ts:45, sidechat-prompt.ts:120)
- [ ] `grep -rn "discussInChat\|buildDiscussTemplate\|discussFooter" src/` → zero hits
- [ ] Both files gone: `src/panel/discuss.ts`, `src/panel/discuss.test.ts`

### Feature Validation

- [ ] Successor pin covers: no suspend on `e`, no main-editor write, no draft staging, buffer intact, no double-staging after simulated resume (one slot, latest text)
- [ ] `test_post_resolve_editor_write_survives_resume_cycle` (renamed) logic unchanged from the old discuss-named test
- [ ] Stays verified untouched: setEditorText/getEditorText declarations + editor-preservation.ts:99 consumer; fakes at tree-nav-repro:76, ac-scripted:977, ac-panel:258, editor-preservation.test:179/312/347/387; esc break-out flow; config.ts alias + alias suite; keys.test.ts
- [ ] Zero behavior change: comment-only edits outside the two deletions and the new tests

### Code Quality Validation

- [ ] New test names contain no "discuss" substring; follow the `test_*_snake_case` convention
- [ ] Ported fixtures follow editor-preservation.test.ts's existing conventions (vi.fn doubles, flush() before resolved-state assertions)
- [ ] No README edits (Mode B — P1.M3.T3's scope, explicitly out of scope here)
- [ ] No edits to plan/ tasks.json / prd_snapshot.md (research-agent boundaries)

### Documentation & Deployment

- [ ] Reworded JSDoc comments remain accurate against LIVE code (re-read each site before finalizing wording — do not copy this PRP's suggested phrasings blindly if the code says otherwise)
- [ ] No new environment variables, config, or dependencies

## Anti-Patterns to Avoid

- ❌ Don't delete discuss.test.ts before landing the successor pin — coverage would silently lapse while the suite stays green
- ❌ Don't "clean up" beyond the inventory: the config alias, alias tests, prose leave-sites, and setEditorText surface are ALL load-bearing survivors — deleting them breaks P1.M1.T1.S2's contract and editor-preservation
- ❌ Don't reword comments by pattern-matching "discuss" alone — re-read each site and keep the still-true semantics (e.g. the post-resolve write ordering, the chained-cycles finding, the reuse contract's live callers)
- ❌ Don't anchor panel.ts edits to line numbers — P1.M2.T6.S1 lands in parallel and shifts them; anchor by quoted text
- ❌ Don't touch README discuss rows — that's Mode B, P1.M3.T3.S1/S2
- ❌ Don't add behavior "while you're in there" — this item is deletions + comments + tests, nothing else

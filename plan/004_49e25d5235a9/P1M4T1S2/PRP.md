# PRP — P1.M4.T1.S2: Scripted AC coverage, keymap-conflict re-verification, and full gates

## Goal

**Feature Goal**: Prove the keymap-trilogy acceptance criteria (delta_prd.md §3, AC-1..AC-6 — NOT the legacy product ACs) with scripted tests wherever P1.M4.T1.S1's flipped suites leave gaps, re-run and (where needed) update `scripts/verify-keymap-conflicts.sh` for the bare-letter default world, record its output for the PR notes, and land the full gate set green.

**Deliverable**: A new test file `src/panel/keymap-ac.test.ts` (delta-AC coverage, Style A/B per AC below), targeted additions to `src/config.test.ts` (schema-absence + compat-alias assertions), a `[Mode A]` comment refresh + (if needed) summary-logic touch in `scripts/verify-keymap-conflicts.sh`, and a recorded re-verification output (commit-message/PR-notes record; README rewrite is P1.M4.T2.S1's). No production `.ts` source changes.

**Success Definition**: All six delta ACs have at least one scripted test asserting exactly the quoted behavior; `bash scripts/verify-keymap-conflicts.sh` exits 0 with every default reported clear (bare letters collide with nothing; ctrl+s/ctrl+g unchanged), its output captured verbatim in the PR notes; `npm test`, `npm run typecheck`, `src/no-hardcoded-keys.test.ts`, `src/keymap-guard.test.ts` all green; zero non-test source files modified.

## User Persona (if applicable)

**Target User**: pi-interrogator maintainer / PR reviewer (this is a verification task).

**Use Case**: Reviewing the keymap-trilogy PR needs machine-checked proof that bare keys, hjkl, and digit removal behave exactly as the 2026-10-12 ruling specifies, plus a recorded conflict re-verification (h2.35's standing demand).

**User Journey**: CI runs the suite → `keymap-ac.test.ts` proves AC-1..AC-5 behaviorally → the conflict script output in the PR notes proves AC-6 → reviewer signs off.

**Pain Points Addressed**: Flipped-but-scattered suites leave AC claims implicit; chord-era conflict script narrative is stale for bare letters.

## Why

- delta_prd.md §3 AC-6 mandates the gates + recorded re-verification; h2.35: "Dev agent must re-verify at build time and record findings in the PR notes."
- h2.53 regression guard: "keymap conflict re-verification (grep installed extensions' registerShortcut + pi keybindings.md) recorded in README" — the script automates it; this task runs and records it.
- P1.M4.T2.S1 consumes the recorded output for the README conflict-section rewrite.

## What

### Coverage contract — AC by AC (add tests ONLY where S1's flips leave none; grep first)

**AC-1 — two-tier dispatch/typing + chords**: in `src/panel/keymap-ac.test.ts`, Style A (`route(data, panelStub)` with vi.fn RoutedActions):
- From non-editor focus (`{focus:"options"}`): `"d"` → onDeep fired & consumed; `"o"` → onOverview; `"t"` → onElaborate (view short); `"m"` → onBatchNote; `"e"` → onDiscuss. One matrix test or five rows.
- Editor focus (`{focus:"text"}`): each of `"d" "o" "t" "m" "e"` → `route` returns **false**, NO action spy fired (the letter types — Style B complement: full panel, `handleInput("d")` with focus text → `textField.handleInput`/editor fake received `"d"` verbatim; follow panel.test.ts editor-focus forwarding pattern).
- `ctrl+s` (`"\u0013"`) from `{focus:"text"}` → onSubmit fired & consumed (Style A); Style B: full panel with mock SubmitDeps (actions.test.ts delivery-mock pattern) asserts the submission actually fires from text focus.
- `ctrl+g` (`"\u0007"`) from `{focus:"text"}` → onExternalEditor fired & consumed; and a Style B end-to-end: mock `node:child_process.spawn` (external-editor.test.ts:24 pattern — `vi.mock("node:child_process")`, fake child records args, exits 0 after "writing"), set `process.env.EDITOR` (with `VISUAL` deleted) to the fake, `await panel.openExternalEditor()` via the routed key path, assert spawn called with the editor command + temp file and the draft replaced on completion. Also assert ctrl+g from options focus does NOT fire (text-focus-only context).

**AC-2 — hjkl fixed aliases**: Style A/B:
- Short view: `"j"`/`"k"` move the option cursor (incl. Other row domain), `"h"`/`"l"` move among questions (full list incl. moot/withdrawn per h2.35 fixed-key notes), clamped at both ends, no wrap.
- Deep view: `"j"`/`"k"` move selection; Overview: move the cursor row. (Per-view matrix mirroring the arrow tests already in panel.test.ts/overview/deep-view suites — if S1's flips already assert hjkl per view (check keys.test.ts and M2.T1.S1's tests), only add what's missing.)
- Editor focus: each of `"h" "j" "k" "l"` → route false / editor receives the byte (types).
- Schema absence: `expect(Object.keys(DEFAULT_CONFIG.keys).join())` contains none of `h/j/k/l` (or stronger: KeyAction-typed assertion that the union has no such members — the Object.keys test is the scripted one).

**AC-3 — digits inert**: Style A: `"1"`..`"9"` from every focus/view stub → route false, zero action calls. Style B: `panel.handleInput("2")` in options focus → returns false/no-op, no answer applied, no advance, no epoch bump; editor focus → editor fake receives `"2"`. Config: `loadConfig({})`/coerce result has NO `digitQuickSelect` key (`expect("digitQuickSelect" in resolved).toBe(false)`) and a settings file containing `digitQuickSelect: true` produces a resolved config without it (silent drop per S3's schema deletion).

**AC-4 — compat alias + rename**: config.test.ts (or keymap-ac): settings `{"keys":{"focusText":"f7"}}` → resolved `keys.elaborate === "f7"` (silent alias, config.ts coerceKeys:195-205); `{"keys":{"elaborate":"f9"}}` → `keys.elaborate === "f9"` AND footer label renders `F9` via `resolveKeyLabels` (config.test.ts:144 label-test pattern); alias precedence: explicit `elaborate` beats `focusText` when both present (verify coerceKeys ordering — the code sets elaborate from focusText only when elaborate is absent/invalid/default; assert that documented rule). Type-level: `KeyAction` union member `focusText` is gone (the completeness guard test already pins the key map; optionally assert a settings `focusText` key still loads without throwing — alias — while the TYPE is absent).

**AC-5 — re-press types; exits are enter/double-esc only**: Style B full panel: enter elaboration via `panel.focusTextField("elaboration")`, then `handleInput("t")` → focus STAYS text, editor fake received `"t"`, no toggle/exit, no state change. Same for note mode (`panel.enterNoteMode()` then `handleInput("m")` → types). Exits: `enter` commits per duty (already two-stage.test.ts territory — verify green, add only a gap test if the letter-repress typing case isn't covered there); double-`esc` within `escExitWindowMs` (default 500) closes the prompt box only (blur to options, no suspend) — S1 kept :385 green; add the m-mode twin if only the t-mode twin exists. Use fake timers (`vi.useFakeTimers`) for the window if the existing esc-pair tests show a pattern; otherwise follow their exact approach.

**AC-6 — gates + record**:
1. `npm test` green; `npm run typecheck` green.
2. `npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts` green.
3. `bash scripts/verify-keymap-conflicts.sh` — exit 0. Update the script where its narrative/logic assumes chords:
   - Refresh the header/exit-summary `[Mode A]` comments: defaults are now bare letters `d/o/t/m/e` + fixed tab/shift+tab + chords ctrl+s/ctrl+g; bare letters collide with nothing BY CONSTRUCTION (the panel owns the whole keyboard while open via custom() raw-input dispatch; no global shortcut is registered — the historical ctrl+shift+q was removed); the AVOIDED list now guards REBINDS onto taken chords, not defaults.
   - Verify the DEFAULT_CONFIG parser still extracts bare-letter values (it greps `action: "accelerator"` lines — letters parse fine; confirm, don't rewrite).
   - If the pi-built-in INFO check chokes on single letters (docs table row matching), fix the matching to treat bare letters as "panel-owned — no built-in conflict possible" rather than failing.
   - Capture the full output verbatim into the PR notes (commit message body or PR description — NOT the README; P1.M4.T2.S1 owns the README section).

### Success Criteria

- [ ] Every delta AC-1..AC-5 behavior quoted above has at least one green scripted assertion; no duplicate suites re-proving what S1's flips already pin (grep-first rule honored).
- [ ] `verify-keymap-conflicts.sh` exits 0; all ten defaults reported clear; output recorded for PR notes.
- [ ] All four gates green (`npm test`, `npm run typecheck`, both guard files).
- [ ] Diff gate: only `*.test.ts` files + `scripts/verify-keymap-conflicts.sh` touched; zero production `.ts` changes; no README/spec edits.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the two simulation styles with their harness locations, the exact seams (openExternalEditor/enterNoteMode/focusTextField, spawn-mock pattern, coerceKeys alias logic, resolveKeyLabels), the guard mechanics and their known gap, and the script's internals. All verified against live code and anchored below.

### Documentation & References

```yaml
- docfile: plan/004_49e25d5235a9/architecture/readme-and-test-flows.md
  why: §2 defines Style A (router-level route(data, panelStub) + vi.fn RoutedActions) and Style B (full panel handleInput / firstCall(mock).component.handleInput) — the only two sanctioned simulation patterns. §5 anomalies list (editor-focus inversion, inline \u0014 sends, letter-vs-hjkl collisions) explains what S1 already flipped so this task greps instead of guessing.
  section: "2. Key-press simulation pattern"

- docfile: plan/004_49e25d5235a9/architecture/config-surface.md
  why: §5 documents both guard tests' mechanics: no-hardcoded-keys (chord-shaped regexes — bare letters can't match; blankDefaultConfigBlock) and keymap-guard (AVOIDED_KEYS ∌ letters; grammar regex passes letters; ALL_ACTIONS rename). Known gap (fixed-key collisions unchecked) is recorded as OUT OF SCOPE — do not extend guards.
  section: "5. Guard-test mechanics"

- docfile: plan/004_49e25d5235a9/architecture/system_context.md
  why: line ~31 records the deliberate guard gap and that AC-6 only requires guards green with the new defaults — cite it, don't "fix" it.
  section: known-gap item 4/5

- file: plan/004_49e25d5235a9/delta_prd.md
  why: §3 is the authoritative AC-1..AC-6 wording this task scripts; §4 non-goals forbid touching state machine/persistence/fixed-key configurability.
  critical: these ACs are NOT the legacy numbered ACs in src/panel/ac-panel.test.ts — new coverage must be labeled against the delta ACs to stay greppable.

- file: plan/004_49e25d5235a9/P1M4T1S1/PRP.md
  why: CONTRACT (parallel, treat as landed): S1 flipped all residual suites to letters/two-tier expectations and its success criteria already include "bare letters forward in editor focus; ctrl+s/ctrl+g still intercept there; digits inert everywhere" — grep S1's landed tests BEFORE writing; add only true gaps. Its file-ownership map (keys.test.ts residuals, excluded :1964/:2769 sites, etc.) prevents collision.
  gotcha: S1's grep gate (`\u0004|\u000c|\u0014|109;6u|101;6u` zero hits) must still pass after your additions — never reintroduce chord bytes for the five letter actions; ctrl+s="\u0013"/ctrl+g="\u0007" stay.

- file: src/panel/keys.ts (READ ONLY)
  why: the behavioral spec — two-tier intercept doc block (lines 18-51), isBareBinding (~218), externalEditor text-focus gate (~565, bare binding forwards at :566), hjkl fixed aliases (exact bare-byte matches in the arrow branches). Your Style A expectations must mirror it exactly.
  gotcha: `t` (elaborate) is short-view gated; `d`/`o`/`m`/`e` fire from deep/overview too.

- file: src/panel/keys.test.ts (READ ONLY + extend only if a gap)
  why: Style A harness — RoutedActions vi.fn registry (~:92-158), DEFAULT_DATA conventions; the landed inversion tests (bare forwards in text focus) are the template for AC-1's matrix.
  gotcha: keys.test.ts was P1.M1.T2.S1's exclusive territory — check its PRP's edit list before adding there; prefer the new keymap-ac.test.ts for new coverage.

- file: src/panel/panel.ts (READ ONLY)
  why: seams for Style B — focusTextField(duty?: "writein"|"elaboration") (~:1188), enterNoteMode() (~:1262), openExternalEditor() (~:1312, reads draft → tui.stop → editInExternalEditor → replace on complete → finally restart TUI), escExitWindowMs double-esc pair handling.
  gotcha: openExternalEditor is async fire-and-forget (`void` from the router) — await it directly in Style B tests.

- file: src/external-editor.test.ts
  why: THE mock pattern for AC-1's ctrl+g leg: vi.mock("node:child_process") with spawnMock recording args and returning a fake child that exits 0 (lines 24-53); env control for $VISUAL/$EDITOR; stdout spy. Reuse verbatim — do not invent a new seam.
  gotcha: delete process.env.VISUAL before asserting $EDITOR precedence so machine-local env can't leak.

- file: src/config.ts
  why: coerceKeys silent focusText→elaborate alias (lines ~195-205 — elaborateValid gate: alias applies only when elaborate is absent/empty/default); KeyAction union (line ~51) with NO focusText/hjkl/digitQuickSelect; DEFAULT_CONFIG.keys letters (lines 108-115); resolveKeyLabels drives footer strings.
  gotcha: the alias fires only when the user has NOT rebound the new name — write the precedence test against the code's exact condition.

- file: scripts/verify-keymap-conflicts.sh
  why: THE conflict re-verification tool — reads in full: AVOIDED list (all chords), live registerShortcut grep across EXT_TREES, pi-built-in INFO check, DEFAULT_CONFIG.keys sed parser (handles bare letters unchanged). Update only comments/summary narrative + the pi-built-in matcher if it mishandles single letters; keep the AVOIDED list intact (it guards rebinds).
  gotcha: exit 0 required; the recorded output goes to the PR notes, NOT the README (P1.M4.T2.S1 owns the README rewrite from your record).

- file: src/config.test.ts + src/panel/two-stage.test.ts + src/panel/panel.test.ts
  why: conventions — config.test.ts full-defaults equality (:42), label tests (:129/:144); two-stage.test.ts:385 esc-pair exit pattern (and :413 reworked); panel.test.ts note-mode suite (:1922-2317, note entry from editor focus via enterNoteMode). Verify-then-fill; don't re-pin.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  panel/keymap-ac.test.ts   # CREATE — delta AC-1/2/3/5 behavioral coverage (Style A + Style B)
  config.test.ts            # MODIFY — AC-3 schema absence + AC-4 alias/label additions (small)
  scripts/verify-keymap-conflicts.sh  # MODIFY — [Mode A] comment refresh, matcher fix if needed
  (all other suites: verify-only — S1 owns the flips)
```

### Desired Codebase tree

```bash
src/panel/keymap-ac.test.ts   # delta-AC-labeled describes: AC-1 two-tier+chords, AC-2 hjkl, AC-3 digits,
                              # AC-5 repress-types/exit-gestures; AC-4 legs may live in config.test.ts
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: grep BEFORE writing — S1's flipped suites + earlier subtasks'
// tests already prove large parts of AC-1/2/5; duplicate suites rot.
// GOTCHA: the five letter actions' BYTES are now "d"/"o"/"t"/"m"/"e" — never
// reintroduce \u0004/\u000c/\u0014/109;6u/101;6u (S1's grep gate). ctrl+s
// "\u0013" and ctrl+g "\u0007" KEEP their bytes (chords by design).
// GOTCHA: bare letters CONSUME from non-editor focus (route true) but FORWARD
// in editor focus (route false + editor receives the byte) — assertion shape
// differs per focus, not just the send.
// GOTCHA: entering editor/note focus from a test must use the direct seams
// (focusTextField("elaboration") / enterNoteMode()) — bare keys can't enter
// from editor focus anymore (that's AC-5's point).
// GOTCHA: ctrl+g fires ONLY from focus === "text" — assert the negative too.
// GOTCHA: external-editor mock — set env BEFORE constructing; delete $VISUAL
// when asserting $EDITOR; fake child must emit exit 0 for the "complete"
// path; await openExternalEditor (async, fire-and-forget at the router).
// GOTCHA: escExitWindowMs double-esc — fake timers or the existing pattern
// from two-stage.test.ts:385; single esc in editor focus FORWARDS to the
// editor (ESC-002), the PAIR closes — don't assert suspend.
// GOTCHA: digitQuickSelect is ABSENT from resolved config even when present
// in settings (silent drop) — assert absence, not an error.
// GOTCHA: the conflict script's known limitation (variable-indirect
// registerShortcut registrations are covered only by the curated AVOIDED
// list) stays — record it in the PR-notes output alongside the run.
// GOTCHA: guard-test gap (no fixed-key/intra-map collision checks) is
// documented out of scope in system_context.md — DO NOT extend the guards.
```

## Implementation Blueprint

### Data models and structure

No production models — test-only task. The only structure is the new suite's organization: one `describe` per delta AC, Style A shared stub factory (`makeStub({focus, view})` + vi.fn RoutedActions registry, mirroring keys.test.ts), Style B panel factory (stub theme/TUI, real InterrogationState with 3+ questions across statuses for hjkl clamping and full-list navigation).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: GAP AUDIT (before writing anything)
  - For each AC-1..AC-5 behavior, grep the flipped suites (keys.test.ts, panel.test.ts,
    two-stage.test.ts, discuss.test.ts, config-surface.test.ts, config.test.ts,
    keymap-guard.test.ts) for existing coverage; list TRUE gaps only. The PRP's
    coverage contract above assumes gaps; the audit corrects it. Record the audit in
    the new file's header comment (AC → covered-by → gap-tests-added).

Task 1: CREATE src/panel/keymap-ac.test.ts
  - Header: delta-AC cross-reference table (audit result), Mode A note that these are
    the 2026-10-12 keymap-trilogy ACs, not the legacy product ACs
  - describe("AC-1 — two-tier dispatch/typing + chords"): Style A matrix (letters ×
    focus/options vs text), ctrl+s/ctrl+g chord interception from text focus, ctrl+g
    negative from options focus; Style B ctrl+s full submission via mock SubmitDeps;
    Style B ctrl+g spawn-mock end-to-end (external-editor.test.ts pattern, env control,
    await, assert replace-on-complete)
  - describe("AC-2 — hjkl fixed aliases"): per-view matrix (short options/questions,
    deep selection, overview cursor row), end clamping both directions no wrap, editor
    focus typing for all four letters, Object.keys(DEFAULT_CONFIG.keys) absence
  - describe("AC-3 — digits inert"): Style A "1".."9" × focus/view → false/zero calls;
    Style B no state change/advance/epoch bump; editor types "2"; config resolution
    drops digitQuickSelect (absent from loadConfig({}) AND from settings containing it)
  - describe("AC-5 — re-press types; exits via enter/double-esc"): focusTextField /
    enterNoteMode then letter press → types, focus unchanged; enter exit; double-esc
    exit (both duties if only one twin exists); single-esc forwards (ESC-002)
  - FOLLOW pattern: keys.test.ts Style A registry + panel.test.ts Style B stubs

Task 2: MODIFY src/config.test.ts (AC-4 legs)
  - ADD: focusText alias test — settings {keys:{focusText:"f7"}} → resolved elaborate "f7"
    (silent, no warn); elaborate drives label (resolveKeyLabels → "F7" footer string);
    alias precedence per coerceKeys' exact condition (rebound elaborate wins; alias applies
    only when elaborate absent/default); explicit elaborate "f9" drives action + label
  - ADD (if audit shows gap): KeyAction/focusText type-gone + settings-with-focusText
    still loads (alias tolerance)

Task 3: MODIFY scripts/verify-keymap-conflicts.sh + RUN + RECORD
  - REFRESH header + exit-summary [Mode A] comments: bare-letter world (d/o/t/m/e collide
    with nothing by construction — panel-owned keyboard, custom() raw-input dispatch, no
    global shortcut registered; ctrl+shift+q historical removal); AVOIDED list now guards
    rebinds; keep the variable-indirect limitation note
  - FIX (only if observed): the pi-built-in INFO matcher if it misclassifies single letters
    — treat bare letters as panel-owned (no built-in conflict possible), never a FAIL
  - RUN: bash scripts/verify-keymap-conflicts.sh → expect exit 0, ten defaults clear
  - RECORD: paste the full output + date + HEAD sha into the PR notes / commit message
    body (P1.M4.T2.S1 consumes it for the README)

Task 4: FULL GATES
  - npm test           # everything green, incl. S1's flipped suites and new file
  - npm run typecheck
  - npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts
  - Re-run S1's grep gate to prove no chord-byte regression:
    grep -rn '\\u0004\|\\u000c\|\\u0014\|109;6u\|101;6u' src --include=*.test.ts
    (allowed only in deliberate guard/alias fixtures if any landed subtask kept one)
```

### Implementation Patterns & Key Details

```ts
// Style A matrix sketch (AC-1):
const cases = [
  ["d", "onDeep"], ["o", "onOverview"], ["t", "onElaborate"],
  ["m", "onBatchNote"], ["e", "onDiscuss"],
] as const;
for (const [key, spy] of cases) {
  it(`${key} dispatches ${spy} from options focus`, () => {
    const { route, actions } = makeRouter({ focus: "options", view: "short" });
    expect(route(key)).toBe(true);            // bare letter CONSUMES here
    expect(actions[spy]).toHaveBeenCalledTimes(1);
  });
  it(`${key} TYPES while editor-focused`, () => {
    const { route, actions } = makeRouter({ focus: "text", view: "short" });
    expect(route(key)).toBe(false);           // forwarded — two-tier rule
    expect(actions[spy]).not.toHaveBeenCalled();
  });
}

// AC-1 ctrl+g end-to-end (spawn-mock, external-editor.test.ts pattern):
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
// fake child: writes "edited text", exit 0 → panel's field replaced, draft slot synced
delete process.env.VISUAL; process.env.EDITOR = "fakeed";
await panel.openExternalEditor();
expect(spawnMock).toHaveBeenCalledWith("fakeed", expect.any(Array), expect.objectContaining({ stdio: "inherit" }));

// AC-3 config absence:
expect("digitQuickSelect" in loadConfig({ files: [] })).toBe(false);
expect("digitQuickSelect" in loadConfig({ global: { digitQuickSelect: true } as never })).toBe(false);

// AC-4 alias (mirror coerceKeys' exact condition at config.ts:195-205):
expect(loadConfig({ global: { keys: { focusText: "f7" } as never }).keys.elaborate).toBe("f7");
```

### Integration Points

```yaml
CONSUMES: keys.ts two-tier router (read-only), panel.ts focus/enterNote/openExternalEditor
  seams (read-only), config.ts coerceKeys alias + resolveKeyLabels (read-only),
  external-editor.ts spawn path (mocked)
CONSUMED BY: P1.M4.T2.S1 (README conflict-section rewrite from the recorded output);
  PR notes (AC-6 record)
DOES NOT TOUCH: any production .ts, README.md, spec/*.md, tasks.json, guard-test scope
  (the known fixed-key-collision gap stays out of scope per system_context.md)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors (test files included)
```

### Level 2: Unit Tests — the deliverable itself

```bash
npx vitest run src/panel/keymap-ac.test.ts -v
npx vitest run src/config.test.ts -v
npm test                              # full suite green
npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

No live pi session; every AC is Style A/B vitest-assertable as specified. Interactive TUI feel-checks belong to the human runbook — not this task.

### Level 4: Domain-specific gates (AC-6)

```bash
bash scripts/verify-keymap-conflicts.sh     # exit 0, all defaults clear — RECORD output
grep -rn '\\u0004\|\\u000c\|\\u0014\|109;6u\|101;6u' src --include=*.test.ts   # no sends
git diff --name-only                         # only *.test.ts + scripts/verify-keymap-conflicts.sh
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` green (incl. S1's flipped suites — no regression).
- [ ] `npm run typecheck` green; both guard suites green.
- [ ] `verify-keymap-conflicts.sh` exit 0; output recorded (date + HEAD sha).
- [ ] Diff gate: no production `.ts`, no README/spec changes.

### Feature Validation

- [ ] AC-1: letters dispatch from options focus and type from editor focus; ctrl+s submits from text focus (full submission path); ctrl+g opens the mocked $EDITOR from text focus only.
- [ ] AC-2: hjkl per-view navigation + clamping + editor typing; absent from config schema.
- [ ] AC-3: digits inert at panel level in every focus/view, type in editor; digitQuickSelect absent from defaults AND silently dropped from settings.
- [ ] AC-4: focusText alias binds elaborate; elaborate drives action + footer label; alias precedence per coerceKeys.
- [ ] AC-5: re-press t/m types while focused; exits are enter / double-esc only (single esc forwards).
- [ ] AC-6: all gates + recorded conflict re-verification.

### Code Quality Validation

- [ ] Gap audit documented in the new suite's header (no duplicate coverage).
- [ ] Style A/B conventions followed exactly (existing harness patterns, no new simulation style).
- [ ] AC labels reference the delta PRD §3 numbering, not the legacy ac-panel numbering.

### Documentation & Deployment

- [ ] [Mode A] comments updated in the conflict script where its logic/narrative changed.
- [ ] Recorded verification output ready for P1.M4.T2.S1 (README) and the PR notes.

## Anti-Patterns to Avoid

- ❌ Don't write coverage without the gap audit — duplicating S1's flips rots the suite.
- ❌ Don't reintroduce chord bytes for the five letter actions (grep gate fails).
- ❌ Don't extend the guard tests into fixed-key collision checking (recorded out of scope).
- ❌ Don't write the README conflict section here — record the output only.
- ❌ Don't edit production sources to make a test pass — if a test fails, the landed behavior contract (keys.ts doc block / PRD h2.35) arbitrates; escalate drift rather than patching src.
- ❌ Don't assert esc suspends from editor focus — single esc forwards (ESC-002); only the pair closes.

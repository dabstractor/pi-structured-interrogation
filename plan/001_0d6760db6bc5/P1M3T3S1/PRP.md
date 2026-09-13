# PRP — P1.M3.T3.S1: Config-driven key dispatch — intercept-before-forward, esc descent

## Goal

**Feature Goal**: Implement `src/panel/keys.ts` exporting `buildKeyRouter(config, actions): KeyHandler` — the single, config-driven raw-key dispatcher for the panel. Given raw terminal input `data` + the panel's current view/focus, it resolves AT MOST ONE action (from the h2.34 action set), invokes the corresponding handler from `P1.M3.T2.S2`'s named-action registry, and returns whether it consumed the input. Everything unmatched forwards (returns `false` → embedded editor when text-focused, else panel default). Panel-level keys are intercepted BEFORE forwarding whenever the panel is open, INCLUDING text focus (h2.34 intercept rule). `esc` descends the view ladder and finally suspends, never destroying state (FR-16). This is the AC-12/R5 remappability core: every bindable key flows from `config.keys.*`, no hardcoded accelerator matching survives.

**Deliverable**: `src/panel/keys.ts` (accelerator validation, `parseAccelerator`, `buildKeyRouter`, esc-descent logic), `src/panel/keys.test.ts`, and a modification to `src/panel/panel.ts` to wire the router through the existing `KeyHandler` seam and remove the superseded S1 built-ins (deep/overview/esc raw-string matching and the T2.S2 TEMPORARY minimal matcher).

**Success Definition**: With a default config, every h2.34 action is reachable via its default accelerator from the panel; remapping any `config.keys.*` entry redirects that action (verified by test with a non-default config); unmatched input returns `false` so it reaches the embedded editor; esc follows the descent ladder (deep→short, overview→short, short→suspend); fixed keys (↑/↓/enter/esc) are honored and NOT remappable; `npm run typecheck` + `npm test` green.

## Why

R5 / commitment 7 / AC-12: ALL hotkeys configurable, no exceptions. The panel owns raw keyboard focus (via `custom()` — questionnaire.ts pattern), so pi's own keybinding layer never sees these keystrokes; only a panel-side router can honor config. The intercept rule (h2.34) is what makes panel shortcuts work even while the user types in the embedded free-text field — without it, `ctrl+s` submit while typing would insert a control char instead of submitting. Esc-descent (FR-16) guarantees the user can always back out of any view without losing anything.

## What

### Dispatch contract

`buildKeyRouter(config: InterrogatorConfig, actions: RoutedActions): KeyHandler` where `RoutedActions` bundles:
- From **P1.M3.T2.S2** (`src/panel/actions.ts`): `optionUp`, `optionDown`, `digit(panel, n)`, `accept`, `prevQuestion`, `nextQuestion`, `submit(panel, deps)`.
- Panel/view mutations performed directly on the `panel` argument: `deep`, `overview`, `focusText`, `batchNote`, `breakOut`, `discuss`, `externalEditor`, `escape` — until their owning modules land, these are **seam callbacks** on `RoutedActions` (`onDeep(panel)`, `onOverview(panel)`, `onFocusText(panel)`, `onBatchNote(panel)`, `onBreakOut(panel)`, `onDiscuss(panel)`, `onExternalEditor(panel)`) with sane in-repo defaults where the behavior already exists (deep/overview view toggles — reuse the exact toggle logic panel.ts has today, including `deepSticky`; `onBreakOut` default = `panel.suspend()`; `escape` = the esc-descent ladder in keys.ts itself).

Resolution order inside the router (order is load-bearing):

1. `matchesKey(data, Key.up)` / `Key.down` → `optionUp`/`optionDown` (**fixed**, h2.34).
2. `matchesKey(data, Key.escape)` → **esc-descent ladder** (fixed):
   - `panel.view === "deep"` → set view short (respect `deepSticky` bookkeeping as panel.ts does today: descending from deep does NOT clear deepSticky — only entering deep sets it; check current panel.ts behavior and mirror it).
   - `panel.view === "overview"` → view = `deepSticky ? "deep" : "short"`.
   - `panel.view === "short"` → `panel.suspend()` (done(null); state and drafts survive — FR-16). Never destructive.
3. `matchesKey(data, Key.enter)` → `actions.accept(panel)` (**fixed**; when `panel.focus === "text"` the two-stage-enter semantics belong to the text field (P1.M4.T1.S2) — the router must NOT intercept enter when text-focused; document this exception in the JSDoc intercept rule: fixed `enter` interception applies only when focus is on options; in text focus, enter forwards so the text field implements its two-stage save).
4. Config-driven panel-level intercepts — checked whenever the panel is open INCLUDING `focus === "text"` (h2.34 intercept rule): `deep`, `overview`, `focusText`, `batchNote`, `submit`, `breakOut`, `discuss`, `externalEditor`, `prevQuestion`, `nextQuestion`. Each bound to `config.keys.<action>` via `matchesKey(data, validatedAccelerator)`. Digits: if `config.digitQuickSelect` and `parseKey(data)` is `"1"`..`"9"` → `actions.digit(panel, n)` (digits are NOT intercepted when text-focused — typing digits in the answer is legitimate; h2.34 scopes quick-select to short-form options focus).
   - Context gating: `externalEditor` only matches when `focus === "text"` (h2.34 "text focus" context) — but matching it earlier is harmless; gate it on text focus to keep the key free elsewhere. `batchNote`/`discuss` fire from any panel view.
5. No match → return `false` (caller: panel forwards to embedded editor when text-focused, else ignores / default nav).

Single-action guarantee: at most ONE handler invocation per input event; first match wins. If two config keys collide (user maps two actions to the same accelerator), the EARLIER entry in a fixed resolution order (the table order above) wins — document in JSDoc.

### Accelerator handling

- `parseAccelerator(s: string): KeyId | undefined` — normalize (trim, lowercase) and VALIDATE against pi-tui's KeyId grammar (modifiers ∈ ctrl/shift/alt/super, final token a base key name from `Key` or a single printable char). Invalid → `undefined`; `buildKeyRouter` falls back to the DEFAULT for that action (`DEFAULT_CONFIG.keys[action]`) and logs one `console.warn`. This keeps a typo in settings.json from bricking the panel.
- Never trust config strings as KeyIds without this validation (a config like `"keys": {"submit": "ctrl+"}` must not throw or match everything).

### Success Criteria

- [ ] Default config: every action in the h2.34 table reachable with its default accelerator (test each with the raw data string it produces).
- [ ] Remapped config (`{"keys": {"submit": "f9"}}`): `f9` submits, `ctrl+s` no longer consumed (AC-12 core).
- [ ] Intercept rule: with `focus === "text"`, `ctrl+s`/`ctrl+d`/`ctrl+l` still intercepted (consumed); `1`–`9`, letters, `enter` forwarded (return false).
- [ ] Esc descent: deep→short, overview→short (or deepSticky), short→`panel.suspend()` called exactly once; repeated esc never throws; state/drafts untouched (FR-16).
- [ ] Fixed keys: arrows/enter/esc dispatch regardless of config; attempts to remap them are impossible by construction (not in `KeyAction` union — already enforced by config.ts).
- [ ] Invalid accelerator in config → default retained, single warn, no crash.
- [ ] `digitQuickSelect: false` → digits return false (forwarded).
- [ ] `externalEditor` only when `focus === "text"`; other contexts forward.
- [ ] Router returns true ONLY when a handler was invoked; never double-dispatches.
- [ ] Mode A JSDoc on the intercept rule and the fixed-key list present in keys.ts.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the KeyHandler seam signature, the panel's view/focus/suspend API, the T2.S2 action surface, the pi-tui `matchesKey`/`Key`/`parseKey` API, the config keys shape, and the h2.34 table semantics. All anchored below.

### Documentation & References

```yaml
- url: (local) node_modules/@earendil-works/pi-tui/dist/keys.d.ts
  why: THE key API. matchesKey(data, keyId), parseKey(data), Key helper (Key.escape/enter/tab/up/down, Key.ctrl("d"), Key.shift("tab"), Key.ctrlShift("q")). KeyId grammar documented in JSDoc — same lowercase "ctrl+shift+x" form as our config strings, so validated config strings cast directly to KeyId.
  critical: config accelerator strings need NO translation — only validation + trim/lowercase.

- file: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts (lines 190-270)
  why: canonical intercept-before-forward pattern: matchesKey(data, Key.escape) checked first (panel intercept), else editor.handleInput(data); refresh(). Generalize this to the full config-driven action set.
  gotcha: also shows Key.shift("tab") matching for shift+tab.

- file: src/panel/panel.ts
  why: KeyHandler seam ALREADY exists: `KeyHandler = (data: string, panel: InterrogationPanel) => boolean` (line ~66), called first in handleInput (line ~241). Fields to use: view ("short"|"deep"|"overview"), focus, deepSticky, suspend(), invalidate(), setView(). The S1 built-ins (deepKey/overviewKey ctrlSequence matching + esc-when-not-short, lines ~243-262) are SUPERSEDED by this task — move that logic into keys.ts defaults and delete from panel.ts. Also delete the T2.S2 TEMPORARY minimal matcher (arrows/digits/enter/tab block) if present in handleInput.
  gotcha: `resolved` guard stays in panel.ts before the seam — never act on a suspended panel. ctrlSequence() helper may become dead code — remove if unused elsewhere.

- file: plan/001_0d6760db6bc5/P1M3T2S2/PRP.md
  why: CONTRACT (parallel implementation — treat as landed): src/panel/actions.ts exports optionUp, optionDown, digit(panel, n: number), accept, prevQuestion, nextQuestion, submit(panel, deps: SubmitDeps) — all (panel) => boolean. Panel gained focus field values incl. "text", set when ✎ affordance is accepted.
  gotcha: submit needs SubmitDeps (sendMessage + isIdle) — RoutedActions must carry them (or a submit(panel) wrapper the panel host provides); do NOT rebuild submit logic in keys.ts.

- file: src/config.ts
  why: InterrogatorConfig.keys: Record<KeyAction, string> with KeyAction = deep|overview|focusText|batchNote|submit|breakOut|discuss|externalEditor|prevQuestion|nextQuestion; DEFAULT_CONFIG has the h2.34 defaults; digitQuickSelect boolean; resolveKeyLabels for display. Arrows/enter/esc deliberately NOT in KeyAction (fixed by design) — do not add them.
  gotcha: config arrives RESOLVED (defaults already merged by loadConfig) — only fall back to DEFAULT_CONFIG.keys on validation failure.

- file: plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md
  why: keymap conflict table — ctrl+shift+m/q/e, ctrl+s/d/l/t/g, digits all FREE (verified against pi defaults + installed extensions). ctrl+shift+q is dual-registered later (panel key + global registerShortcut, P1.M6.T1.S2) — keys.ts owns only the panel half.
  critical: PRD h2.34 requires re-verifying conflicts at build time and recording findings in PR notes.

- file: src/panel/panel.test.ts
  why: existing test pattern for the panel (theme stub, construction, handleInput behavior assertions). Extend/replace the S1 built-in tests with router-based tests.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  config.ts               # keys: Record<KeyAction,string>, digitQuickSelect, DEFAULT_CONFIG
  panel/
    panel.ts              # MODIFY: wire router via keys seam, remove superseded built-ins
    panel.test.ts         # MODIFY: update dispatch tests
    layout.ts             # untouched (footer labels already config-driven)
    short-view.ts         # from S1/S2 (parallel): cursor domain, initialCursorIndex
    actions.ts            # from T2.S2 (parallel): named actions — the router's targets
    actions.test.ts       # from T2.S2
    keys.ts               # CREATE (this task)
    keys.test.ts          # CREATE
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: order is load-bearing — check ESC-descension and arrows BEFORE
// config accelerators so a user remap can never shadow the fixed keys, and
// check arrows before anything ESC-related (arrow sequences start with ESC).
// GOTCHA: matchesKey(data, Key.enter) matches "\r"; esc arrives as "\u001b"
// (and "\u001b\u001b" for alt-heavy terminals — matchesKey handles this).
// GOTCHA: config strings are lowercase pi-form and ALREADY KeyId-compatible;
// only validate + normalize. Unknown/unparseable → default + one warn.
// GOTCHA: digits are printable chars — parseKey(data) returns "1".."9";
// do NOT intercept digits (or letters) when focus==="text" — the user is
// typing an answer. Same for enter in text focus (two-stage enter is M4).
// GOTCHA: panel.focus === "text" still intercepts ctrl+s/d/l/t/g, batchNote,
// discuss, breakOut (h2.34 intercept rule — this is the WHOLE point).
// GOTCHA: suspend() must be called at most once; suspend sets resolved=true
// and done(null) — idempotent, but assert single invocation in tests.
// GOTCHA: keep ONE dispatch per event; if user maps two actions to the same
// key, first-in-resolution-order wins — document, don't error.
// GOTCHA: Key.escape === Key.esc ("esc"); either alias works.
```

## Implementation Blueprint

### Data shapes

```ts
// src/panel/keys.ts
import { Key, matchesKey, parseKey, type KeyId } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig, type KeyAction } from "../config.js";
import type { InterrogationPanel } from "./panel.js";

/** Seam callbacks for actions whose owning module lands later. */
export interface RoutedActions {
  optionUp(p: InterrogationPanel): boolean;
  optionDown(p: InterrogationPanel): boolean;
  digit(p: InterrogationPanel, n: number): boolean;
  accept(p: InterrogationPanel): boolean;
  prevQuestion(p: InterrogationPanel): boolean;
  nextQuestion(p: InterrogationPanel): boolean;
  submit(p: InterrogationPanel): boolean; // host pre-binds SubmitDeps
  onDeep(p: InterrogationPanel): void;        // default: view toggle w/ deepSticky
  onOverview(p: InterrogationPanel): void;    // default: overview toggle
  onFocusText(p: InterrogationPanel): void;   // default: p.focus = "text" (M4 refines)
  onBatchNote(p: InterrogationPanel): void;   // M4.T2.S2 wires; default no-op
  onBreakOut(p: InterrogationPanel): void;    // default: p.suspend() (M6 refines)
  onDiscuss(p: InterrogationPanel): void;     // M6.T2.S2 wires; default no-op
  onExternalEditor(p: InterrogationPanel): void; // M4.T1.S3 wires; default no-op
}

/** Normalize + validate a config accelerator to a pi-tui KeyId. */
export function parseAccelerator(s: string): KeyId | undefined;

/** Resolved, validated binding table: KeyAction → KeyId (defaults on failure). */
export function resolveBindings(config: InterrogatorConfig): Record<KeyAction, KeyId>;

export function buildKeyRouter(
  config: InterrogatorConfig,
  actions: RoutedActions,
): (data: string, panel: InterrogationPanel) => boolean;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/keys.ts — accelerator layer
  - IMPLEMENT: parseAccelerator (trim/lowercase, validate per pi-tui KeyId grammar: modifier tokens ctrl/shift/alt/super + base key from the Key object's names or one printable char), resolveBindings (per-KeyAction with DEFAULT_CONFIG.keys fallback + single console.warn per invalid entry)
  - NAMING: snake-case-free TS; exports exactly as in Data shapes
  - PLACEMENT: src/panel/keys.ts

Task 2: keys.ts — the router + esc descent
  - IMPLEMENT buildKeyRouter following the resolution order in "What" §Dispatch contract: fixed arrows → esc descent → fixed enter (options focus only) → config intercepts (view-scoped: externalEditor gated on focus==="text"; digits gated on digitQuickSelect AND focus!=="text") → return false
  - IMPLEMENT esc-descent ladder inline (deep→short; overview→deepSticky?deep:short; short→panel.suspend()); reuse setView semantics — call panel's public surface, do NOT poke privates (expose/mirror setView if needed via a tiny public method or perform view assignment through existing API; prefer adding a public setView if it is currently private)
  - MODE A JSDoc: (a) the intercept rule (panel-level keys intercepted before the embedded editor, including text focus), (b) the fixed-key list (arrows, enter, esc) and why they're fixed (h2.34), (c) single-dispatch + collision ordering rule

Task 3: MODIFY src/panel/panel.ts — wire + clean
  - INTEGRATE: construct router in the panel host path (index.ts or wherever the panel is opened — pass `keys: buildKeyRouter(config, routedActions)` via InterrogationPanelArgs.keys, which already exists). Provide defaults for the seam callbacks (deep/overview toggles using the current built-in logic incl. deepSticky; onBreakOut = () => panel.suspend())
  - REMOVE: the S1 built-in deepKey/overviewKey/esc matching in handleInput (now dead — router owns it) and the T2.S2 TEMPORARY minimal matcher banner block, if present; keep the resolved guard and the seam call
  - PRESERVE: render cache discipline, dispose, suspend idempotence
  - GOTCHA: if setView is private, make it public (or add `descendTo(view)`) — keys.ts must not duplicate view-toggle state logic in two places

Task 4: CREATE src/panel/keys.test.ts
  - FIXTURES: real InterrogatorConfig (DEFAULT_CONFIG spread) + mutated variants; a fake InterrogationPanel: { view, focus, deepSticky, suspend: vi.fn(), invalidate: vi.fn() } plus vi.fn action spies
  - CASES: (a) default config — for EACH KeyAction, feed the raw terminal data for its default accelerator (e.g. "\t" tab, "\u001b[Z" shift+tab, "\u001b[68~"? NO — verify actual sequences via matchesKey round-trip: construct expected data by asserting matchesKey(data, binding) in the test setup, or use known sequences: "\t", "\u001b[Z", "\r", "\u001b", "\u001b[A"/"\u001b[B", ctrl+s = "\u0013", ctrl+d = "\u0004", ctrl+l = "\u000c", ctrl+t = "\u0014", ctrl+g = "\u0007", digits "1".."9") and assert the right spy fired and router returned true; (b) remapped config (submit→"f9", deep→"ctrl+alt+d") — new key fires, old key returns false; (c) intercept rule: focus==="text" → ctrl+s/d/l/t/g, batchNote, discuss, breakOut, prev/next still consumed; digits/letters/enter forwarded; (d) esc ladder: deep→short, overview→short, overview w/ deepSticky→deep, short→suspend called once, second esc on resolved panel no-ops (returns via resolved guard or false); (e) digitQuickSelect off → "5" returns false; (f) digit beyond options → digit() called and returns its boolean (router honors action result — if action returns false, router still returns true ONLY if it consumed; define: router returns the action's consumed result for option/digit actions, true for one-shot seam actions); (g) invalid accelerator config → default used, warn called once per bad key; (h) externalEditor gated: ctrl+g consumed only when focus==="text"; (i) collision: two actions same key → first in resolution order wins, single dispatch
  - FOLLOW pattern: src/panel/panel.test.ts (stub style), src/config.test.ts (config mutation style)

Task 5: MODIFY src/panel/panel.test.ts (only where built-ins were removed)
  - UPDATE tests asserting the old inline deep/overview/esc handling to go through the router wiring; keep render/structure tests untouched
```

### Implementation Patterns & Key Details

```ts
// Router core (abridged):
const b = resolveBindings(config); // precomputed — never re-parse per keystroke
return function route(data, panel) {
  if (panel.resolved) return false; // defensive; panel.handleInput already guards
  if (matchesKey(data, Key.up)) return actions.optionUp(panel);
  if (matchesKey(data, Key.down)) return actions.optionDown(panel);
  if (matchesKey(data, Key.escape)) { escapeDescend(panel); return true; }
  if (panel.focus !== "text" && matchesKey(data, Key.enter)) return actions.accept(panel);
  // config intercepts — valid in ANY panel state, including text focus:
  if (matchesKey(data, b.deep)) { actions.onDeep(panel); return true; }
  if (matchesKey(data, b.overview)) { actions.onOverview(panel); return true; }
  // ... focusText, batchNote, submit, breakOut, discuss, prev/next ...
  if (panel.focus === "text" && matchesKey(data, b.externalEditor)) { actions.onExternalEditor(panel); return true; }
  if (config.digitQuickSelect && panel.focus !== "text") {
    const k = parseKey(data);
    if (k && k >= "1" && k <= "9") return actions.digit(panel, Number(k));
  }
  return false; // forward to embedded editor / default nav
};

// escapeDescend: deep→short; overview→(deepSticky?deep:short); short→panel.suspend()
// NEVER destroys state (FR-16): suspend() resolves custom() with null only.
```

### Integration Points

```yaml
PANEL (panel.ts):
  - keys seam arg now satisfied by buildKeyRouter; remove superseded built-ins
TEXT FIELD (P1.M4.T1.S2, future): relies on router forwarding enter/digits/letters
  when focus==="text" and on the intercept rule for ctrl-keys
DEEP/OVERVIEW (P1.M5, future): refine onDeep/onOverview defaults into real views
SUSPEND/WIDGET (P1.M6.T1.S1): short-view esc → suspend() is the descent terminus;
  M6.T1.S2 adds the global registerShortcut half of breakOut (dual-registered)
DISCUSS (P1.M6.T2.S2): swaps the onDiscuss no-op default
NO changes to: config.ts (KeyAction union already correct), actions.ts, state.ts, delivery.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts -v
npm test             # full suite green (panel.test.ts updates included)
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

> Never drive a live pi session. All dispatch behavior is assertable in vitest through the fake panel + action spies; default accelerators verified against the raw sequences matchesKey itself accepts (round-trip assertions in test setup).

```bash
npx vitest run src/panel/
```

### Level 4: Domain-specific

- Keymap conflict re-verification (h2.34 mandate): re-grep `registerShortcut` across `~/.pi/agent/extensions` + list pi built-in defaults (docs/keybindings.md in the pi install) for the ten bindable + three fixed keys; RECORD findings in the PR notes (ctrl+b/ctrl+shift+b/x/j, shift+down taken; ctrl+m avoided — sends "\r").
- AC-12 spot check in test (b): remap round-trips — that test IS the remappability acceptance core.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] All h2.34 actions dispatch from config accelerators; defaults work with raw terminal data (test a).
- [ ] Remappability proven: remapped key fires, default key releases (AC-12 core, test b).
- [ ] Intercept rule honored incl. text focus; typing keys forward (test c); Mode A JSDoc present.
- [ ] Esc descent ladder correct; suspend exactly once; nothing destroyed (FR-16, test d).
- [ ] Fixed keys (arrows/enter/esc) not remappable and checked before config keys.
- [ ] Invalid accelerators fall back to defaults with a single warn, no crash (test g).
- [ ] Superseded panel.ts built-ins removed; single dispatch guaranteed (test i).
- [ ] Conflict re-verification findings recorded in PR notes.
- [ ] No modifications outside keys.ts(+test), panel.ts, panel.test.ts, and the panel-host wiring line.

## Anti-Patterns to Avoid

- ❌ Don't hand-roll escape-sequence string comparison — use matchesKey/parseKey from pi-tui.
- ❌ Don't intercept digits/letters/enter when text-focused — the user is typing (M4 depends on forwarding).
- ❌ Don't add arrows/enter/esc to the KeyAction config union — fixed per h2.34.
- ❌ Don't rebuild submit/action logic in keys.ts — route to actions.ts handlers only.
- ❌ Don't re-parse accelerators per keystroke — resolve once in buildKeyRouter.
- ❌ Don't implement deep/overview/text-editor/breakOut-widget internals — seams + defaults only (M4/M5/M6 own them).
- ❌ Don't leave the old S1 built-ins and the router both active — double dispatch bugs.

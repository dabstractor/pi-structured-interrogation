# PRP — P1.M4.T1.S1: Editor composition: getEditorComponent factory + stock fallback

## Goal

**Feature Goal**: Implement `src/panel/text-field.ts` — a `TextField` wrapper around a pi `EditorComponent` that is instantiated ONCE per panel instantiation using the user's composed editor (`ctx.ui.getEditorComponent()(tui, theme, keybindings)`) when available AND `config.editorMode === "composed"`, falling back to the stock pi-tui `Editor` otherwise. The panel hosts it in the 3-line embedded-editor region (h2.29), seeds it from the current draft, forwards unmatched raw input to it after the key router, and manages focus (`focus: "options" | "text"` — not focused by default; `ctrl+t` / `keys.focusText` or the `✎` affordance focuses it).

**Deliverable**: `src/panel/text-field.ts` (+ `src/panel/text-field.test.ts`), plus targeted modifications to `src/panel/panel.ts` (forward `keybindings` + editor factory through `InterrogationPanelArgs`, instantiate + embed the TextField, forward input after the router) — including extending the `PiUISurface` structural pick with `getEditorComponent`. No other files.

**Success Definition**: With `editorMode: "composed"` and a registered `getEditorComponent`, the user's editor component (e.g. pi-vim) is instantiated exactly once per `openPanel` and receives live `tui`/`theme`/`keybindings`; with `editorMode: "stock"` (or no factory), stock `new Editor(tui, editorTheme)` is used; the embedded region renders the editor's lines when the current question is text-focused; unmatched keys reach `editor.handleInput` only while `focus === "text"`; `getText`/`setText`/seed work; `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: pi user being interrogated by an agent (the interrogation panel host).

**Use Case**: User hits `ctrl+t` (or accepts the `✎` affordance) to type a free-text answer with their preferred editor experience (vim modes if they run pi-vim).

**User Journey**: Panel shows question with options → `ctrl+t` → focus moves to embedded editor region (3 lines) seeded with any existing draft → user types (keys routed: config intercepts still fire per h2.34, the rest goes to the editor) → focus returns to options via router/`✎` blur path (two-stage enter semantics are S2 — this task only wires the plumbing).

**Pain Points Addressed**: Embedded editor composition risk (h2.51 row 1) mitigated by `editorMode` flag; users keep vim modes instead of a dumb line input (Q17=A).

## Why

- h2.31: the free-text field composes the user's ACTIVE editor via `ctx.ui.getEditorComponent()(tui, theme, keybindings)` — vim modes work (Q17=A).
- h2.51 risk row 1: embedded-editor double-instance quirks are THE flagged risk; `editorMode: "composed" | "stock"` is the documented escape hatch — the config flag already exists in `src/config.ts`.
- Enables P1.M4.T1.S2 (two-stage enter), P1.M4.T1.S3 (ctrl+g), P1.M4.T2.S2 (batch note reuses this wrapper).

## What

### Selection contract

1. `openPanel` captures `pi.ui.getEditorComponent()` **once per panel instantiation** (i.e., at `openPanel` call time — NOT lazily inside render, NOT per keystroke).
2. The `custom()` factory body (where `tui`, `theme`, `keybindings` are live) instantiates the editor component:
   - If captured factory is defined AND `config.editorMode === "composed"` → `factory(tui, editorTheme, keybindings)`.
   - Else → `new Editor(tui, editorTheme)` from `@earendil-works/pi-tui` (stock fallback).
3. Exactly ONE editor instance per panel lifetime. Suspend/resume (done(null) + reopen) creates a fresh instance on the next `openPanel` — draft re-seeding from the draft store is P1.M4.T2.S1; here, `TextField.seed(text)` exists and the panel calls it with whatever draft text is available via the existing `drafts` seam (may be undefined → seed `""`).

### TextField wrapper contract (`src/panel/text-field.ts`)

```ts
export interface TextFieldArgs {
  editor: EditorComponent;       // composed or stock — see createEditorComponent
  theme: Theme;                  // for editorTheme construction (stock path) + dim prefix rendering
  onInvalidate(): void;          // call after any input/render-state change → panel.requestRender
}
export class TextField {
  readonly editor: EditorComponent;
  focused: boolean;              // mirrors editor.focused; text field NOT focused at construction
  render(width: number): string[];   // exactly 3 lines default (h2.29): prefix each editor line
  handleInput(data: string): void;   // delegate editor.handleInput(data); then onInvalidate()
  getText(): string;              // prefer editor.getExpandedText?.() ?? getText()
  setText(text: string): void;
  seed(text: string): void;       // setText when field is empty/different — idempotent, no history writes
  focus(): void;                  // focused = true; editor.focused = true
  blur(): void;                   // focused = false; editor.focused = false; onInvalidate()
}
export function createEditorComponent(
  factory: EditorFactory | undefined,
  config: InterrogatorConfig,
  tui: TUI, theme: Theme, keybindings: KeybindingsManager,
): EditorComponent; // composed-vs-stock selection, Mode A JSDoc here
export function buildEditorTheme(theme: Theme): EditorTheme; // questionnaire.ts pattern
```

- `render(width)`: `editor.render(width - 2)` prefixed with one column of left margin (follow questionnaire.ts render pattern; `borderColor` accent via theme.fg("accent", ...)). Pad/truncate to a stable line count for layout determinism (the layout's editor region reserves 3 lines default — expose `lineCount()` defaulting 3, or pad in render).
- NEVER call `editor.addToHistory` (h2.31: separate history — full isolation semantics in S2, but this task must not ADD history entries).
- Do NOT set `onSubmit` here (two-stage enter is S2). Setting `onChange` to `onInvalidate` is allowed and useful.

### Panel integration contract

- `InterrogationPanelArgs` gains optional `editorFactory?: EditorFactory | undefined` and `keybindings?: KeybindingsManager`.
- In the constructor (which already runs inside the live `custom()` factory): `createEditorComponent(args.editorFactory, args.config, tui, theme, keybindings)` → `new TextField(...)` stored as a field; NOT focused by default.
- `openPanel`: extend the `custom()` call to forward `_keybindings` (rename to `keybindings`) and pass `editorFactory: pi.ui.getEditorComponent?.()` into panel args. Extend `PiUISurface.ui` with `getEditorComponent?(): EditorFactory | undefined` (structural, optional — keep the pick narrow).
- Input path: in `handleInput`, after the keys seam returns `false` AND `focus === "text"` → `textField.handleInput(data)` (the router already refuses digits/letters/enter interception in text focus — see P1.M3.T3.S1 PRP intercept rule).
- Focus path: keys router's `onFocusText` seam (currently default `p.focus = "text"`) — refine the default (or wire in the host) to also `textField.focus()` + `textField.seed(draftText)` when the current question is a text question or the `✎` affordance slot is active; blur restores `focus = "options"`. Only refine wiring — do not move routing into this file.
- Render path: the panel's short-view editor region (3 lines, h2.29) renders `textField.render(width)` when `focus === "text"` OR the current question `type === "text"` (primary affordance per short-view.ts); otherwise keep the existing affordance-only rendering. Keep changes minimal: if short-view currently has no editor-region hook, add a small seam (`renderTextRegion`) rather than rewriting short-view.

### Success Criteria

- [ ] `editorMode: "composed"` + factory defined → factory called once with live `(tui, theme, keybindings)`; its component is the one embedded.
- [ ] `editorMode: "stock"` OR factory undefined → stock `new Editor(tui, editorTheme)` used; no crash either way.
- [ ] Exactly one editor instantiation per panel lifetime (openPanel → done) — repeated renders/keystrokes never re-instantiate.
- [ ] Not focused at construction (`focus === "options"`, `editor.focused === false`).
- [ ] `ctrl+t` (keys.focusText, via router seam) focuses the text field and seeds the current draft; blur returns focus to options.
- [ ] Unmatched input while `focus === "text"` reaches `editor.handleInput`; while `focus === "options"` it does not.
- [ ] `render(width)` returns a stable line count (3 default) from `editor.render(width - 2)` with prefixing; no history writes ever.
- [ ] `npm run typecheck` + `npm test` green; Mode A JSDoc documents composed-vs-stock selection.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the `EditorFactory`/`EditorComponent` pi types, the stock `Editor` + `EditorTheme` shapes, the questionnaire.ts reference pattern, the panel's existing args/host seams, and the keys-router contract (parallel item). All anchored below.

### Documentation & References

```yaml
- url: (local file) ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: line 62 `type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent`; line 173 `getEditorComponent(): EditorFactory | undefined` on ExtensionUIContext.
  critical: getEditorComponent is on ctx.ui — same object our PiUISurface narrows; it may be undefined (no composed editor registered).

- url: (local file) node_modules/@earendil-works/pi-tui/dist/editor-component.d.ts
  why: THE minimal composed-editor contract: getText/setText/handleInput/onSubmit?/onChange?/addToHistory?(optional)/getExpandedText?()/borderColor?; extends Component (render(width): string[]; focused via Focusable usage in stock Editor).
  critical: everything except getText/setText/handleInput/render is OPTIONAL — the wrapper must feature-detect (getExpandedText?.() ?? getText()) and never assume vim-mode internals.

- url: (local file) node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts
  why: stock fallback `new Editor(tui, theme: EditorTheme, options?)`; EditorTheme { borderColor: (s)=>string, selectList: SelectListTheme }; onSubmit?/onChange?/focused/render(width)/handleInput.

- file: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts (lines 110-210, 266+)
  why: canonical embedded-editor pattern inside custom(): editorTheme construction from panel theme (borderColor via theme.fg("accent", s); selectList sub-entries selectedPrefix/selectedText/description/scrollInfo/noMatch), editor.onSubmit, editor.render(width - 2) with line prefixing in the component's render, intercept-then-editor.handleInput(data) then refresh().
  gotcha: questionnaire uses new Editor directly — our composed path replaces the constructor call, everything else mirrors it.

- file: src/panel/panel.ts
  why: ALL integration seams live here: PiUISurface (~line 116) add getEditorComponent; InterrogationPanelArgs (~line 170) add editorFactory?/keybindings?; PanelFocus already includes "text" (line 61); openPanel's custom() factory (~line 638) currently discards `_keybindings` and constructs InterrogationPanel — forward both; handleInput (~line 327) — forward-to-textField after keys seam returns false and focus==="text".
  gotcha: the keys seam (P1.M3.T3.S1, parallel) owns ctrl+t dispatch — this task only refines the onFocusText default/wiring, never parses keys itself.

- file: plan/001_0d6760db6bc5/P1M3T3S1/PRP.md
  why: CONTRACT (parallel, treat as landed): buildKeyRouter intercepts panel keys (incl. ctrl+s/d/l/t) BEFORE forwarding even in text focus; forwards digits/letters/enter in text focus; RoutedActions.onFocusText(panel) seam default `p.focus = "text"` — refine host wiring to focus()+seed().
  gotcha: do NOT duplicate accelerator parsing; do not intercept enter in text focus (S2 owns two-stage enter).

- file: src/config.ts
  why: `EditorMode = "composed" | "stock"` (~line 29), `editorMode: EditorMode` (~line 89, default "composed"). Read as `config.editorMode` — no config changes needed.
  gotcha: the flag exists ALREADY; this task is its consumer (h2.51 risk mitigation row 1).

- file: src/panel/actions.test.ts + src/panel/panel.test.ts
  why: test conventions: bare stub theme ({fg, bold} cast to Theme), stub TUI, real InterrogationState fixtures, vi.fn() spies, AUTOMATION-POLICY (no live pi session).
  pattern: construct panels directly; fake EditorComponent via a vi.fn-armed literal object implementing the EditorComponent interface.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  config.ts               # editorMode flag exists; NO changes
  panel/
    panel.ts              # MODIFY: PiUISurface + PanelArgs + custom() forwarding + input/render wiring
    panel.test.ts         # MODIFY/extend minimal (focus default, forwarding)
    short-view.ts         # possibly tiny seam for the 3-line text region; prefer no change if panel.render can compose
    layout.ts             # untouched (footer/labels config-driven already)
    actions.ts            # untouched (✎ affordance accept already sets focus="text" seam)
    keys.ts               # P1.M3.T3.S1 (parallel) — untouched by this task
    text-field.ts         # CREATE
    text-field.test.ts    # CREATE
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  text-field.ts           # TextField wrapper + createEditorComponent + buildEditorTheme; Mode A JSDoc
  text-field.test.ts      # composed/stock selection, wrapper delegation, render stability, focus/blur
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: capture getEditorComponent() ONCE per panel instantiation (at openPanel
// time) and call the factory INSIDE the custom() body — tui/theme/keybindings must
// be the LIVE instances pi passed in, not stale captures across suspend/reopen.
// GOTCHA: getEditorComponent may be undefined (no pi-vim etc.) — stock fallback,
// no warn spam (this is a normal state, not an error).
// GOTCHA: EditorComponent's extras (onSubmit/onChange/addToHistory/getExpandedText)
// are OPTIONAL — feature-detect with ?. and ??; never instanceof-check the composed
// component (it need not extend Editor).
// GOTCHA: exactly ONE instantiation per panel lifetime; suspend→reopen = NEW panel
// = NEW editor (drafts survive via the drafts seam, not via the editor instance).
// GOTCHA: never addToHistory — h2.31: text answers have separate history (S2 hardens;
// this task must not introduce entries).
// GOTCHA: do not set onSubmit in this task (two-stage enter is S2); onChange →
// onInvalidate is fine and keeps render live.
// GOTCHA: stock Editor render(width) may return variable line counts — the panel
// layout reserves 3 lines; pad (and let it grow beyond 3 only if the editor does —
// mirror questionnaire.ts which just renders editor lines with prefix).
// GOTCHA: routing precedence is fixed by keys.ts (parallel): panel intercepts fire
// BEFORE editor.handleInput even in text focus (h2.34) — the panel's handleInput
// just forwards what the router returned false for.
// GOTCHA: dispose — if the editor has dispose (Component may), call it from panel
// dispose; check the panel's existing dispose for the pattern.
```

## Implementation Blueprint

### Data models and structure

(See TextField contract in "What" — that IS the data shape; no ORM/pydantic here. Keep `EditorFactory` imported as a TYPE from `@earendil-works/pi-coding-agent` — it re-exports from core extensions types; if not re-exported, define the local structural type `(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent` to avoid the deep import path.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/text-field.ts — selection + wrapper
  - IMPLEMENT buildEditorTheme(theme: Theme): EditorTheme (questionnaire.ts:120-129 pattern — borderColor via theme.fg("accent", s); selectList entries via accent/muted/dim/warning)
  - IMPLEMENT createEditorComponent(factory, config, tui, theme, keybindings): composed iff factory && config.editorMode === "composed"; else new Editor(tui, buildEditorTheme(theme))
  - MODE A JSDoc: composed-vs-stock selection, the editorMode risk mitigation (h2.51 row 1), single-instantiation rule, never-addToHistory
  - IMPLEMENT TextField class per the contract: render(width) prefixing + stable line count, handleInput→editor.handleInput+onInvalidate, getText via getExpandedText?.() ?? getText(), setText, seed, focus/blur
  - NAMING: createEditorComponent, buildEditorTheme, TextField; snake-free TS, vitest suite sibling
  - PLACEMENT: src/panel/text-field.ts

Task 2: MODIFY src/panel/panel.ts — host wiring
  - ADD to PiUISurface.ui: `getEditorComponent?(): EditorFactory | undefined` (keep the pick structural/optional)
  - ADD to InterrogationPanelArgs: `editorFactory?: EditorFactory | undefined; keybindings?: KeybindingsManager`
  - INTEGRATE in constructor: const editor = createEditorComponent(args.editorFactory, args.config, tui, theme, args.keybindings); this.textField = new TextField({ editor, theme, onInvalidate: () => this.invalidate() }); not focused
  - MODIFY openPanel custom() factory: forward keybindings (rename _keybindings) + editorFactory: pi.ui.getEditorComponent?.() into panel args
  - MODIFY handleInput: after keys seam returns false → if focus === "text" { this.textField.handleInput(data); return true; }
  - MODIFY render (short view): render textField lines in the 3-line editor region when focus === "text" or current question type === "text" (seed on first focus instead if simpler — seed via the drafts seam value or "")
  - REFINES: onFocusText wiring (host-side or default in keys.ts is untouched — the panel exposes e.g. `focusTextField()` that sets focus="text", textField.focus(), textField.seed(draftFor(currentId))) and blur path back to "options"; wire into the router's onFocusText seam at the host construction site if keys.ts has landed; otherwise leave the existing seam intact and add the public method (keys.ts default will call it once landed — coordinate: add method now, wiring line guarded)
  - PRESERVE: render cache discipline (invalidate on textField changes), suspend idempotence, dispose (add editor dispose?.() if Component exposes it)

Task 3: CREATE src/panel/text-field.test.ts
  - FIXTURES: fake EditorComponent literal { getText: vi.fn, setText: vi.fn, handleInput: vi.fn, render: vi.fn(() => ["line1","line2","line3"]), focused: false }; fake TUI {} + stub theme; fake KeybindingsManager {}
  - CASES: (a) createEditorComponent — factory defined + editorMode "composed" → factory called once with (tui, theme, keybindings), result used; (b) factory defined + "stock" → factory NOT called, result instanceof Editor; (c) factory undefined + "composed" → stock Editor; (d) TextField delegation: handleInput → editor.handleInput + onInvalidate; getText prefers getExpandedText; setText/seed/blur; focus sets focused on both wrapper and editor; (e) render pads to stable count, prefixes each line, delegates editor.render(width-2); (f) never addToHistory — assert editor.addToHistory was never called across all ops (spy if present)
  - FOLLOW pattern: src/panel/actions.test.ts (stub theme/TUI, vi.fn spies)

Task 4: MODIFY src/panel/panel.test.ts (small)
  - ADD: default construction → panel.focus === "options", textField exists, not focused; input forwarding — keys seam returns false + focus "text" → textField.handleInput called and handleInput returns true; focus "options" → not called; composed wiring via args (editorFactory spy) — factory invoked once during construction with the constructor's tui/theme/keybindings
```

### Implementation Patterns & Key Details

```ts
// Composed-vs-stock (Mode A JSDoc anchor):
export function createEditorComponent(factory, config, tui, theme, keybindings): EditorComponent {
  // MODE A: composed mode embeds the user's ACTIVE editor (pi-vim etc.) via
  // ctx.ui.getEditorComponent() — captured once per panel instantiation by the
  // host, called HERE with the live custom() arguments. editorMode "stock"
  // (h2.51 row 1 mitigation) or an absent factory falls back to the pi-tui
  // Editor so the panel is never hostage to composed-editor quirks.
  if (config.editorMode === "composed" && factory) return factory(tui, buildEditorTheme(theme), keybindings);
  return new Editor(tui, buildEditorTheme(theme));
}

// Panel input path (abridged, inside InterrogationPanel.handleInput, after the keys seam):
if (!consumed && this.focus === "text") { this.textField.handleInput(data); return true; }

// Render path: when focus==="text" || current q.type==="text":
//   this.textField.render(width) replaces/augments the affordance region (3 lines).
```

### Integration Points

```yaml
PANEL (panel.ts):
  - PiUISurface.ui gains getEditorComponent?; InterrogationPanelArgs gains editorFactory?/keybindings?
KEYS (P1.M3.T3.S1, parallel): router forwards enter/digits/letters in text focus
  and calls onFocusText seam → panel.focusTextField(); NO changes to keys.ts by this task
FUTURE M4.T1.S2: sets editor.onSubmit for two-stage enter; may disableSubmit on stock Editor
FUTURE M4.T1.S3: ctrl+g handler reads textField.getText()/setText() for the external round-trip
FUTURE M4.T2.S1/S2: drafts seam feeds seed(); "note" focus reuses TextField for batchNote
NO changes to: config.ts, actions.ts, short-view.ts (unless a render seam is unavoidable —
  prefer composing in panel.render), state.ts, delivery.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/text-field.test.ts -v
npx vitest run src/panel/ -v      # panel tests incl. modified panel.test.ts
npm test                          # full suite green
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

> No live pi session. All behavior (selection, forwarding, focus) is assertable in vitest with fake EditorComponent/factory spies. Interactive TUI verification (vim modes in a real terminal) belongs to the human runbook (MANUAL-TUI-AC-RUNBOOK.md) — note a runbook line there ONLY if adding one is in-repo convention; do not execute it.

### Level 4: Domain-specific

- Confirm composed path type-checks against a `pi-vim`-shaped component (any object satisfying EditorComponent) — the test fake IS this check.
- grep gate: `grep -rn "addToHistory" src/panel/text-field.ts src/panel/panel.ts` → must return nothing (h2.31 history isolation).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] Level 2 tests cover selection matrix (composed/stock × factory present/absent), delegation, render stability, focus/blur, no-history.
- [ ] grep gate: no `addToHistory` in new/modified panel code.

### Feature Validation

- [ ] Factory captured once per openPanel; instantiated inside custom() with live tui/theme/keybindings.
- [ ] `editorMode: "stock"` bypasses the factory entirely; undefined factory is silent.
- [ ] Not focused by default; ctrl+t/✎ path focuses + seeds; blur returns to options.
- [ ] Unmatched input forwarded to the editor ONLY in text focus.
- [ ] Mode A JSDoc on composed-vs-stock selection present in text-field.ts.

### Code Quality Validation

- [ ] Follows existing stub-theme / fake-surface test conventions; single editor instance per panel lifetime.
- [ ] No changes outside text-field.ts(+test), panel.ts, panel.test.ts (short-view.ts only if a render seam was unavoidable).
- [ ] Parallel-item contracts (keys.ts, actions.ts) respected — no routing/duplication drift.

### Documentation & Deployment

- [ ] JSDoc self-documenting; no new config keys (editorMode already shipped in M1).

## Anti-Patterns to Avoid

- ❌ Don't call getEditorComponent inside render/handleInput — capture once per panel instantiation.
- ❌ Don't assume the composed component extends Editor — only the optional EditorComponent surface.
- ❌ Don't parse keys or intercept enter in text-field.ts — routing is keys.ts' job; S2 owns two-stage enter.
- ❌ Don't add history entries or set onSubmit in this task.
- ❌ Don't touch config.ts / keys.ts / actions.ts / state.ts.
- ❌ Don't instantiate a second editor for the batch-note region — M4.T2.S2 reuses this wrapper.

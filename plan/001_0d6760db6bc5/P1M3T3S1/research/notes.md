# Research notes — P1.M3.T3.S1 (keys.ts: config-driven dispatch)

## pi-tui key API (verified in node_modules/@earendil-works/pi-tui/dist/keys.d.ts)

- `matchesKey(data: string, keyId: KeyId): boolean` — raw input data vs. a key-id string.
- `parseKey(data): string | undefined` — parse raw data to a key-id string.
- `Key` helper object: `Key.escape`, `Key.tab`, `Key.enter`, `Key.up`, `Key.down`,
  `Key.ctrl("d")` → `"ctrl+d"`, `Key.shift("tab")` → `"shift+tab"`,
  `Key.ctrlShift("q")` → `"ctrl+shift+q"`. Digits are printable chars: config
  "1".."9" map directly to key-ids "1".."9".
- Supported key-id grammar (from JSDoc): "escape", "tab", "enter", arrows,
  "ctrl+c", "shift+tab", "alt+x", "super+k", combined modifiers
  "shift+ctrl+p" etc. — exactly matches our config accelerator grammar.

## Key-id ↔ config-string mapping strategy

Config strings (h2.52) are lowercase pi form: "ctrl+d", "ctrl+shift+q", "tab",
"shift+tab", "1".."9". These are ALREADY KeyId strings — no translation needed;
just cast validated strings to KeyId and call matchesKey(data, id). Validation:
strip whitespace, lowercase, split on "+", verify modifier tokens ∈
{ctrl,shift,alt,super} and final token is a known base key or printable char;
invalid → keep DEFAULT and (optionally) console.warn.

## Intercept-before-forward pattern (questionnaire.ts:216-227)

Panel owns raw keyboard focus via `custom()`. In input mode: check
`matchesKey(data, Key.escape)` FIRST (panel-level intercept), else
`editor.handleInput(data); refresh();` (forward). Our keys.ts is the
generalization: intercept list from config; everything unmatched forwards.

## Existing seams (src/panel/panel.ts, read at ~line 190-300)

- `KeyHandler = (data: string, panel: InterrogationPanel) => boolean` — already
  defined and called FIRST in `handleInput` (`if (this.keys?.(data, this)) return;`).
  keys.ts exports `buildKeyRouter(config, actions): KeyHandler`.
- Panel currently has S1 built-ins after the seam: deepKey/overviewKey via
  `ctrlSequence()` raw-string helper, and ESC when view !== "short". **This PRP
  replaces those built-ins** — keys.ts supersedes them; remove or delegate.
- `panel.view: PanelView` ("short"|"deep"|"overview"), `panel.focus` (added by
  S1/T2.S2 work), `panel.suspend()` calls `done(null)` (never destroys state).
- `resolved` guard at top of handleInput — never act on suspended panel.

## Actions from P1.M3.T2.S2 (contract, PRP read)

`src/panel/actions.ts` exports: optionUp, optionDown, digit(panel, n), accept,
prevQuestion, nextQuestion, submit(panel, deps). All return boolean consumed.
Panel gained: footerFlash, rippleConfirm seam, focus="text" setting on ✎ accept.

## Esc descent (h2.34, FR-16)

deep → short? Per h2.34 table: "back / suspend: esc, fixed, descends, never
destroys". Descent ladder: deep→short, overview→panel(short), top(short)→
suspend (panel.suspend(), done(null)). Current panel.ts: esc in overview/deep
returns to short — consistent.

## Fixed keys (NOT config, per h2.34)

arrows ↑/↓ (option move), enter (accept), esc (back/suspend). Digits 1-9 are
behind the `digitQuickSelect` toggle (config), not fixed.

## Global dual-registration (ctrl+shift+q)

environment-and-conflicts.md keymap table: ctrl+shift+q/e/m all FREE.
`breakOut` is dual: panel key + `pi.registerShortcut` global — the global half
is P1.M6.T1.S2 territory; keys.ts only handles the panel-side binding.

## Conflict re-verification note (h2.34 tail)

Dev agent must re-verify keymap conflicts at build time and record findings in
PR notes — carry into validation checklist.

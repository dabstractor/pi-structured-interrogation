# BUG-002 & BUG-003 — panel width safety + dead auto-submit flash

## BUG-002 — Other-row label never truncates (src/panel/short-view.ts)

### Facts
- `OTHER_AFFORDANCE = "✎ Other — write your own"` exported at short-view.ts:84.
- `otherLine()` (short-view.ts:279-294) — **no budget param, no truncateVisible**:
```ts
function otherLine(q: Question, optionCount: number, cursorIndex: number,
                   theme: Theme, dimAll: boolean): string {
  const prefix = cursorIndex === optionCount ? CURSOR : BLANK;
  const isWriteInAnswer = q.answer?.custom === true;
  const label = isWriteInAnswer ? theme.fg("success", OTHER_AFFORDANCE) : OTHER_AFFORDANCE;
  const content = `${prefix}${label}`;
  const focused = cursorIndex === optionCount && !dimAll;
  return `${INSET}${focused ? content : theme.fg("dim", content)}`;
}
```
- Caller (short-view.ts:220 inside `renderShortViewOptions`): has `budget =
  Math.max(1, width - INSET.length - RIGHT.length)` (inset 2 + right margin 2) and passes
  it to every sibling — `optionLine(q, opt, i, cursorIndex, theme, budget, dimAll)`,
  `textAffordanceLine(cursorIndex, theme, budget, dimAll)`, `mootLine(q, theme, budget)` —
  but NOT to otherLine. Documented contract above renderShortViewOptions: "Every returned
  line satisfies `visibleWidth ≤ width`."
- Sibling math to mirror (optionLine, ~241-281): `headW = visibleWidth(prefix) +
  visibleWidth(star); label = truncateVisible(opt.label, Math.max(1, budget - headW));`
  textAffordanceLine: `placeholderBudget = Math.max(1, budget - visibleWidth(prefix) -
  visibleWidth("✎ "))` then truncate.
- `truncateVisible(text, maxWidth)` (layout.ts:158-163): sanitize → ≤max returns clean →
  else `truncateToWidth(clean, maxWidth, "…")` ANSI-safe (pi-tui handles ANSI/wide chars;
  pi-tui README:260 "Each line must not exceed width or the TUI will error" — overlong
  elements word-wrap into extra rows).
- Constants: `INSET = "  "` (:71-72), `CURSOR = "▸ "` (:74), `BLANK = "  "` (:77).
- Color AFTER truncation (truncate raw label, then `theme.fg("success", …)`/dim wrap) so
  visible-width math stays clean.

### Fix
Thread `budget` into otherLine (caller passes the same budget), truncate the label with
`Math.max(1, budget - visibleWidth(prefix))`. Keep width-80 output **byte-identical**
(existing pin: short-view.test.ts:299-300 `expect(render(q, 0)).toEqual(["  ▸ ✎ Other —
write your own"])` — 28 visible cols fits 80, so it stays green unchanged).

### Tests
short-view.test.ts:575-586 pattern — `render(q, cursorIndex, theme, width)` helper (:76-78
wraps `renderShortViewOptions({question, cursorIndex, theme, width})`); assert every line
`visibleWidth(line) <= w` for w in ~[10,20,30] and `…` present when truncated.
spec/ui-spec.md:28 row ("Width < 60 cols: option labels truncate with …") already covers
the Other row — it IS an option row (ui-spec.md:35 "synthetic ✎ Other — write your own
row, the LAST row of every choice question's options list"). spec/ is read-only; no spec
edit needed. Footer minimal-form (18-col) overflow noted in PRD is OUT of scope — Other
row is "the unambiguous spec violation".

## BUG-003 — auto-submit flash set after suspend (src/panel/actions.ts)

### Facts
- `maybeAutoSubmit()` tail (actions.ts:1060-1063):
```ts
const shipped = submit(panel, d);
if (shipped) { panel.flash(`submitted — ${pending} answer(s)`); } // verbatim, literal "answer(s)"
```
- `submit()` tail (~951-957): POST-SUBMIT EXIT (FR-3d) → `panel.suspend(); return true;`
- `panel.suspend()` (panel.ts:1639-1644): `if (this.resolved) return;
  this.writeThroughCurrentDraft(); this.resolved = true; this.done(null);` — done(null)
  resolves `ctx.ui.custom()`; pi disposes/unmounts the component (panel.ts:2854 comment).
- `panel.flash()` (panel.ts:1660-1668): sets `footerFlash` + `setTimeout(FLASH_MS)` +
  `this.invalidate()` — but the expiry callback skips invalidate when resolved, and the
  component never repaints post-suspend ⇒ flash is dead code on every auto-submit.
- Moving flash() before submit() alone does NOT make it observable (same synchronous
  turn; invalidate-queued repaint never lands once resolved) — unless a final-frame
  render is explicitly forced; PRD authorizes EITHER "render the flash before suspending
  (a final frame)" OR "route the confirmation through a post-suspend notify".
- **Post-suspend notify channel EXISTS**: `ctx.ui?.notify?.(message)` closure built in
  `resolveSidechatHostSeams` (panel.ts:523-545), returned as `sidechatNotify`
  (panel.ts:598), log-safe swallow on failure. Precedent: sidechat close notices.
- Dozens of existing assertions read the FIELD (`expect(panel.footerFlash?.text).toBe(
  "submitted — N answer(s)")`, e.g. actions.test.ts:2686-2692) — they don't paint, so
  keeping footerFlash set (before or after submit) keeps them green.
- ui-spec.md:57 specifies "footer flashes `submitted — {n} answer(s)` … Then the panel
  suspends itself" — the PRD supersedes for this changeset (observable confirmation via
  final frame OR notify). spec/ read-only.

### Recommended fix
In maybeAutoSubmit: keep setting `panel.footerFlash` (field-level state, tests read it),
and after `submit()` returns shipped, emit the observable confirmation through the notify
channel with the SAME verbatim string `submitted — ${pending} answer(s)`. Wire access:
panel already captures the notify closure (sidechatNotify, panel.ts:598) — expose/reuse
it for actions.ts (e.g. a small panel method delegating to the closure), optional-chained
so hosts without `ui.notify` degrade gracefully (swallow pattern). Alternative (if a
deterministic final-frame paint is achievable via pi-tui's render API — verify in
node_modules/@earendil-works/pi-tui) is equally PRD-compliant; notify is the
deterministic default.

### Tests
actions.test.ts auto-submit pattern (e.g. :2686-2692): answer last open question via
`accept(panel)` → expect delivery once, `panel.footerFlash?.text` verbatim, AND notify
mock called with the verbatim string; suspend/done(null) ordering preserved.

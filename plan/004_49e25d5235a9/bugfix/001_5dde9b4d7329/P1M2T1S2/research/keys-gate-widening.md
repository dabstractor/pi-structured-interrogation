# Research: keys.ts:566 externalEditor gate widening to editorFocused (BUG-002 router side)

## Verified code state

### The gate — src/panel/keys.ts:566 (line numbers current; item cites same)

```ts
// externalEditor is text-focus context (h2.34) — gated so ctrl+g stays
// free in every other context. TIER: its only valid context is editor
// focus, where a bare key must type — a bare remap therefore never
// intercepts (decisions :113-115; keep the chord).
if (panel.focus === "text" && matchesKey(data, b.externalEditor)) {
  if (bare.externalEditor) return false; // tier 2 in its only context
  actions.onExternalEditor(panel);
  return true;
}
```

Change: `if (editorFocused && matchesKey(data, b.externalEditor)) {`. The bare tier-2 guard at
:567 stays UNCHANGED — a bare remap must type in BOTH duties (text and note are both editor
focus). `editorFocused` is already computed at keys.ts:425
(`panel.focus === "text" || panel.focus === "note"`) before step 4 — in scope, no new code.

### Three stale comments to sync to "editor focus (any duty: write-in, elaboration, note)"

1. Module resolution-order JSDoc, keys.ts ~:96: step-4 list contains
   `externalEditor (only when focus === "text")`.
2. Seam interface comment, keys.ts ~:145:
   `/** External editor (text-focus context only). Wired by M4.T1.S3. */`
3. Gate comment, keys.ts :562-564 ("externalEditor is text-focus context (h2.34)…").

### Fall-through today (why the feature is dead in note duty)

panel.ts handleInput:831-834: unmatched router input forwards to `textField.handleInput` when
focus === "text" || "note" — in note focus, \u0007 falls through step-5 (route returns false)
and is forwarded into the TextField where it's harmlessly ignored. No test pins the wrong
forwarding (verified: keys.test.ts has no note-focus externalEditor test).

### Test conventions — src/panel/keys.test.ts

- `DEFAULT_DATA.externalEditor = "\u0007"` fixture at :35 (DEFAULT_CONFIG mirror, :30-38).
- `makePanel({view?, focus?, deepSticky?})` stub factory (:63) — accepts `focus: "note"`.
- `makeActions()` spy factory (:137) with `dispatchCount` (:157); assertions use
  `toHaveBeenCalledTimes(1)` / `not.toHaveBeenCalled()`.
- Target test `test_externalEditor_only_in_text_focus` (:349-357): options-focus negative leg
  (false + not called) + text-focus positive leg (true + called once). REUSE both legs, rename,
  add note-focus leg: `makePanel({ focus: "note" })` → route("\u0007") === true,
  onExternalEditor called exactly once.

### Spec — spec/ui-spec.md:84 (hotkey table)

`| external editor | ctrl+g | keys.externalEditor | editor focus (any duty) — MUST stay
modifier-bearing: its only valid context is editor focus, where a bare key would have to type,
never act (BAREKEYS-001) |` — already any-duty. NO spec edit needed.

### Sibling contract — P1.M2.T1.S1 (in flight, apply side)

openExternalEditor (panel.ts) gains a `bufferOwner === "note"` fork: completed text →
`batchNote` + `drafts.setNote` (mirroring exitNoteMode), never the question slot. Order of
landing: S1 first (dormant-but-correct), then this gate opens it — no corruption window.
Activating the gate is only safe once S1 has landed.

## E2E note (out of scope here)

P1.M2.T1.S3 owns the end-to-end note-duty ctrl+g round-trip (keymap-ac pattern); this item is
router gate + comments + router tests only.

# Research notes — bugfix P1.M2.T1.S1 (BUG-004: duty re-derivation on navigation)

## Verified from architecture/bug-004-textduty.md + live source

- `textDuty: "writein" | "elaboration"` — panel.ts:427, default "elaboration". Assignment sites: focusTextField(duty?) :1100, blurTextField reset :1128, accept-on-Other actions.ts:223, deep-view.ts:482, ctrl+t entry panel.ts:628 via desiredTextDuty.
- Navigation chain (keys.ts step 4, prevQuestion/nextQuestion UNGATED in text focus) → actions.prev/nextQuestion → `panel.currentId = ...` setter (panel.ts:352-363): sets `cursorIndex = initialCursorIndex(q)` (★ preselect) THEN `syncBufferToQuestion(id)`. So inside syncBufferToQuestion, `this.cursorIndex` already points at the NEW question's ★ row and the new q is fetchable — full inputs available, no ordering change needed.
- `syncBufferToQuestion` (panel.ts:985-1019 as documented; current ~:1000-1030 after Wave-1 changes): early-returns for note duty (`bufferOwner === "note"`) and same-question (`bufferOwner === id`); writes outgoing buffer to its draft slot; re-seeds. NO textDuty mention — the bug.
- Enter fork panel.ts:794-803 (current ~:800): `if (this.textDuty === "writein") writeInEnter(this); else this.saveTextDraft();` — duty, not cursor, decides.
- **KEY FINDING**: `panel.ts:73` ALREADY imports `desiredTextDuty` from `./keys.js` (used for the ctrl+t entry at :628). keys.ts→panel.ts is a type-only import, so panel.ts importing the value creates NO runtime cycle. The item contract's "extract into a shared module" is unnecessary — just call `desiredTextDuty(this)`.
- `desiredTextDuty(panel)` (keys.ts:288-296): `q?.type === "text"` → writein; `panel.cursorIndex === (q?.options?.length ?? 0)` (Other row) → writein; else elaboration.
- Duty label: layout.ts renderDutyLabel → "OTHER — this text is the answer" / "EXPLAIN — attaches to your selection"; rendered at panel.ts:1385 — updates automatically once textDuty is fixed (existing invalidate-driven render).
- `writeInEnter` (actions.ts:296-341) commits applyAnswer({value, custom:true}) then blurs (duty reset) — leak only manifests when navigating BEFORE committing.

## Guard conditions for the fix

- Only when `this.focus === "text"` (options-focus navigation has no editor session; note duty already early-returned).
- Placed at the END of syncBufferToQuestion, AFTER `this.bufferOwner = id; this.textField.seed(draft);`.
- Same-question early-return path unaffected. Note: focusTextField calls syncBufferToQuestion then seeds — with the re-derivation at the end, a subsequent `focusTextField(duty)` explicit-duty call still wins (duty param assigned before sync runs? CHECK: focusTextField sets `textDuty = duty` BEFORE calling syncBufferToQuestion — the re-derivation at sync's end would OVERWRITE the explicit duty! Must handle: either re-derive only when duty wasn't just explicitly set, or reorder. SAFEST: in focusTextField, assign the explicit duty AFTER the syncBufferToQuestion call (or have sync skip re-derivation via a flag). Verified current focusTextField body: `this.focus="text"; if(duty!==undefined) this.textDuty=duty; this.syncBufferToQuestion(...); this.textField.seed(...)` → YES, re-derivation would clobber. Fix: move the duty assignment after syncBufferToQuestion in focusTextField, or gate. Document this explicitly in the PRP.

## Tests pinning relevant semantics (none assert navigation preserves duty — no flips, only additions)

- actions.test.ts: :734 accept-Other→writein; :883 blur resets duty (ONLY reset pin); :1878/:1897 auto text-enter cases.
- panel.test.ts: :2256 desiredTextDuty type-check-preference; :2277/:2292/:2311/:2336/:2395 ctrl+t duty family; :443 OTHER label render.
- keys.test.ts: prev/next interception in text focus — navigation behavior unchanged, only duty re-derives; verify these stay green.

## Repro (item contract)

q1 choice (rec a) + q2 choice (rec b); Other-accept q1 (writein) → `handleInput('\x1b[Z')` (shift+tab) → q2, cursorIndex=★ → type → enter → q2 must NOT be answered {value, custom:true}; it is a save+blur (elaboration).

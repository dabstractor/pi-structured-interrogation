# BUG-002 / BUG-003 research — ctrl+g dead in note duty + stale caps references

Repo: `pi-structured-interrogation` @ `/home/dustin/projects/pi-structured-interrogation`. Read-only research; line numbers from the current working tree.

---

## (a) keys.ts routing map — `src/panel/keys.ts` (589 lines)

### Dispatch skeleton (buildKeyRouter, L404–588)

`buildKeyRouter(config, actions)` returns `(data, panel) => boolean` — `true` only when a handler ran. Resolution order (module JSDoc L93–99, mirrored in code):

1. **Fixed arrows** (`Key.up`/`Key.down` + `k`/`j` aliases) — L440–448
2. **Fixed ←/→ + `h`/`l`** — L459–468
3. **Fixed esc** — L476–495
4. **Fixed enter** — L506–511
5. **Config intercepts** (two-tier, BAREKEYS-001) — L513–584: `deep`, `overview`, `elaborate`, `batchNote`, `submit`, `discuss`, `externalEditor`, `prevQuestion`, `nextQuestion`
6. **Step-5 fallback** — L588: `return false;` (forward: `panel.handleInput` hands the byte to the embedded editor when `focus === "text" || "note"`, panel.ts L831–834)

### The focus model

- **L425** (the canonical ESC-002 editor-focus definition):

  ```ts
  const editorFocused = panel.focus === "text" || panel.focus === "note";
  ```

- Module JSDoc **L63–66**: "while the embedded editor holds focus (`focus === "text"` OR `"note"` — the SAME composed editor, pi-vim etc.) …".
- Gates that already treat note as editor focus:
  - arrows L440/L445: `if (!editorFocused && (matchesKey(data, Key.up) || data === "k"))`
  - ←/→ L459: `if (panel.focus !== "text" && panel.focus !== "note")`
  - esc L479: `if (!editorFocused) { escapeDescend(panel); … }` — editor focus falls into the double-esc window / forward
  - enter L506: `if (panel.focus !== "text" && matchesKey(data, Key.enter))` (note-focus enter is intercepted earlier in panel.handleInput, so it never reaches the router)
  - every bare tier-2 guard, e.g. L521: `if (bare.deep && editorFocused) return false; // tier 2: must type`
- Gates that exclude note for *other* reasons (do not copy for BUG-002): the elaborate gate L538–547 requires `panel.view === "short" && panel.focus !== "note"` (BUG-011: no invisible-editor arming; note editor owns the buffer).

### THE BUG-002 GATE — L562–570

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

Line **566** is the only `focus === "text"`-only gate among the config intercepts. Because the gate fails when `focus === "note"`, ctrl+g (\u0007) falls through to step 5 → `return false` → panel.handleInput L831–834 forwards the byte **\u0007 into the text field itself** (`textField.handleInput(data)`) — the note editor swallows a control byte and nothing opens. Contrast the ui-spec hotkey row (spec/ui-spec.md:84): context is "**editor focus (any duty)**".

### The routed action (L376–382)

```ts
    onExternalEditor: (p) => {
      // Wired by M4.T1.S3 (h2.31): fire-and-forget — the router is sync and
      // never awaits … openExternalEditor catches internally …
      void p.openExternalEditor();
    },
```

The `bare.externalEditor` tier guard at L567 stays correct for note duty too ("its only valid context is editor focus" — a bare remap must type in either duty). Also note the seam's interface comment **L145**: `/** External editor (text-focus context only). Wired by M4.T1.S3. */` and the resolution-order JSDoc **L96**: "externalEditor (only when focus === "text")" — both need the same wording fix as L562–564.

**Exact gate change**: L566 becomes

```ts
    if ((panel.focus === "text" || panel.focus === "note") && matchesKey(data, b.externalEditor)) {
```

(equivalently `editorFocused && matchesKey(...)` — `editorFocused` is already in scope from L425). The options-focus negative (`focus === "options"` → not consumed) is preserved.

---

## (b) openExternalEditor routing design + the note-duty change

### Current implementation — `src/panel/panel.ts` L1306–1348

```ts
  async openExternalEditor(): Promise<void> {
    if (this.externalEditorInFlight) return;
    this.externalEditorInFlight = true;
    const draft = this.textField.getText(); // read BEFORE suspending (pi's order)
    this.tui.stop();
    try {
      const result = await editInExternalEditor({
        command: resolveExternalEditorCommand(),
        content: draft,
      });
      if (result.status === "complete") {
        const id = this.currentId;
        this.textField.setText(result.content);
        if (id !== undefined) {
          this.draftSlots.set(id, { value: id, text: result.content });
          this.drafts?.setDraft(id, result.content);
          this.bufferOwner = id; // EXPLAIN-002: buffer now belongs to this question
        }
        this.invalidate();
      }
    } catch {
      // Log-safe swallow …
    } finally {
      this.externalEditorInFlight = false;
      this.tui.start();
      this.tui.requestRender(true);
    }
  }
```

### Why it is wrong in note duty

The seeding side is duty-blind and correct (`this.textField.getText()` — in note mode the SAME TextField holds the note buffer; `enterNoteMode` seeds it, panel.ts L1265–1271). The **apply side is hardwired to the question-draft path**: `draftSlots.set(currentId)`, `drafts?.setDraft(currentId)`, `bufferOwner = currentId`. In note mode (`focus === "note"`, `bufferOwner === "note"`, panel.ts L1269) a completed external edit would:

1. overwrite the **current question's** draft slot + DraftStore draft with note text (data corruption — the note rides into a later answer's `answer.text`),
2. re-scope `bufferOwner` from `"note"` to the question id, so the next `exitNoteMode`/`writeThroughCurrentDraft` writes the note buffer into the question pipeline again,
3. leave `this.batchNote` and `drafts?.setNote()` un-updated, so the note never ships.

### Exact change needed (apply-side fork, mirroring writeThroughCurrentDraft L948–951)

Inside the `if (result.status === "complete")` block, branch on `this.bufferOwner === "note"` (the same discriminator `writeThroughCurrentDraft` uses — it is the panel's canonical note-duty marker; `focus === "note"` is equivalent here because ctrl+g can now only fire in text/note focus and enter/esc-esc are the only note exits):

```ts
      if (result.status === "complete") {
        this.textField.setText(result.content);
        if (this.bufferOwner === "note") {
          // note duty (BUG-002): the completed text is the NOTE — mirror
          // exitNoteMode's write-through, never the question draft slot.
          this.batchNote = result.content;
          this.drafts?.setNote(result.content);
          // bufferOwner stays "note"
        } else {
          const id = this.currentId;
          if (id !== undefined) {
            this.draftSlots.set(id, { value: id, text: result.content });
            this.drafts?.setDraft(id, result.content);
            this.bufferOwner = id; // EXPLAIN-002
          }
        }
        this.invalidate();
      }
```

This matches `exitNoteMode` (L1286–1291: `this.batchNote = text; this.drafts?.setNote(text);`) and `writeThroughCurrentDraft`'s note branch (L948–951). Everything else (re-entrancy guard, stop/start envelope, catch/finally, no blur/focus/commit) is duty-blind and stays as-is. The JSDoc on `openExternalEditor` (L1306–1319, "sync the draft slot + DraftStore seam") should mention the note branch.

---

## (c) Note-duty state model

One composed editor, three duties (panel.ts L436–447): `textDuty: "writein" | "elaboration"` for the answer side; note duty is a separate **focus** state, `focus === "note"`.

- `private bufferOwner: string | "note" | undefined` — **panel.ts L435**. Who owns the editor buffer: a question id or the literal `"note"` (EXPLAIN-002). Set to `"note"` by `enterNoteMode` (L1269), restored to `this.currentId` by `exitNoteMode` (L1297).
- `batchNote = ""` — **panel.ts L465**. Panel-local note copy; written by `exitNoteMode` (L1288) and `writeThroughCurrentDraft` (L950); read at submit as the fallback when no DraftStore seam carries a note (actions.ts L703: `const note = panel.drafts?.getNote() || panel.batchNote;`); cleared after the note ships (actions.ts L763–764: `panel.drafts?.setNote(""); panel.batchNote = "";`).
- DraftStore seam note API — src/draft-store.ts L80–86: `getNote()` / `setNote(text)`. `getNote()` wins over `batchNote` everywhere (store = suspend/resume-safe copy).

### Entry: `m` (keys.elaborate sibling, `keys.batchNote` default `m`)

- keys.ts L548–552: bare tier-2 — `if (bare.batchNote && editorFocused) return false;` then `actions.onBatchNote(panel)`.
- keys.ts L366–371 (default action): open-only, `if (p.focus !== "note") p.enterNoteMode();` (BAREKEYS-001: no re-press close).
- **`enterNoteMode()` — panel.ts L1265–1271**:
  ```ts
  enterNoteMode(): void {
    this.writeThroughCurrentDraft(); // stage the question buffer BEFORE the note seed
    this.focus = "note";
    this.textField.seed(this.drafts?.getNote() || this.batchNote || "");
    this.bufferOwner = "note";
    this.textField.focus();
    this.invalidate();
  }
  ```

### Exits

- **enter** — panel.handleInput L813–821: `if (enter && (this.focus === "text" || this.focus === "note")) { if (this.focus === "note") this.exitNoteMode(); … return true; }` — enter never reaches the editor or the router in note focus.
- **double-esc** — keys.ts esc branch L476–495 → `escExitEditor` L293–297: `if (panel.focus === "note") panel.exitNoteMode(); else panel.exitTextField();`.
- **`exitNoteMode()` — panel.ts L1286–1300**: write-through (`batchNote = text; drafts?.setNote(text)`), then re-scope `bufferOwner = this.currentId`, re-seed the editor from the question's freshest draft, blur.
- **suspend** — `writeThroughCurrentDraft` L944–963 stages the note buffer ungated before resolving.

### Submit (what happens with the note)

actions.ts `submit` (~L690–770): note read at L703, passed to `buildSubmission(...)` at L742 (`note || undefined` → the `NOTE:` line + `details.note` card), cleared AFTER delivery at L762–764. A zero-pending submit ships nothing and holds the note. Render side: panel.ts L1413 passes `mode: this.focus === "note" ? "note" : "text"` for the editor header (renders `NOTE — ships with next submission`, ui-spec:62).

---

## (d) Test patterns for ctrl+g / external editor

Four layers, all vitest:

1. **Router unit (stub panel)** — `src/panel/keys.test.ts`. `makePanel()` builds a `PanelStub` with vi.fn seams incl. `openExternalEditor: vi.fn(async () => {})` (L92–93). `DEFAULT_DATA.externalEditor = "\u0007"` (L35). Patterns:
   - all-actions probe L250–261: each action routed once with `makePanel(action === "externalEditor" ? { focus: "text" } : { focus: "options" })` (L254) — asserts consume + exactly-one dispatch.
   - tier test L317–330: chord consumed in text focus (`route(DEFAULT_DATA.externalEditor, makePanel({ focus: "text" })) === true`, L324).
   - **`test_externalEditor_only_in_text_focus` L349–357** — the test whose name asserts the current (buggy) gate: options focus → `false` + no dispatch (L353), text focus → `true` + dispatch (L356). **Will need rename/extension** (e.g. `_in_editor_focus_any_duty`) plus a `focus: "note"` positive leg; the options-focus negative stays valid.
   - wired-seams test L795–807: `actions.onExternalEditor(panel)` → `panel.openExternalEditor` called once.
2. **Panel unit (module-boundary mock)** — `src/panel/panel.test.ts` L50–57: `vi.mock("../external-editor.js", () => ({ editInExternalEditor: vi.fn(), resolveExternalEditorCommand: vi.fn(() => "stub-editor") }))`. `makeEditorHarness()` L1881–1903: real `InterrogationPanel`, spy `tui` (`stop`/`start`/`requestRender`), spy `drafts` (`getDraft`/`setDraft`/`getNote`/`setNote`), fake editor, `panel.focus = "text"`, current question `q1`. Describe block **L1905–1996**: clean-exit apply order (stop < edit < start; slot + seam sync; focus unchanged), failed edit leaves field untouched but still restarts TUI, rejected promise never escapes + clears the guard, in-flight second call ignored, and **L1985–1996** the end-to-end key probe: `h.panel.handleInput("\u0007")` fires the mocked round-trip with `{command: "stub-editor", content: <typed draft>}` then `await flush()` and asserts `setText`. **A note-duty sibling of L1911–1937 is the natural new test** (enter note mode via `panel.enterNoteMode()`, then assert `drafts.setNote` + `batchNote`, and `setDraft` NOT called).
3. **End-to-end AC (fake spawn)** — `src/panel/keymap-ac.test.ts`: `vi.hoisted` `spawnMock` + `vi.mock("node:child_process", () => ({ spawn: spawnMock }))` (L52–54); real `editInExternalEditor` runs with REAL fs so the temp-dir lifecycle is exercised. `CTRL_G = "\u0007"` (L96). AC-1 test **L313–341**: `vi.stubEnv("VISUAL", "")` + `vi.stubEnv("EDITOR", "fakeed")`, `spawnWrites("edited text\n")`, `vi.spyOn(panel, "openExternalEditor")`, `panel.handleInput(CTRL_G)` → true, then `await spy.mock.results[0]!.value` to await the fire-and-forget; asserts spawn args (`fakeed`, `answer.md`, `stdio: "inherit"`), seeded content, `editor.setText`, `drafts.setDraft("q1", …)`, stop/start envelope, focus unchanged. Negative **L343–354**: options focus → `handleInput(CTRL_G)` false, no spawn. Header table L22–23 documents the coverage map.
4. **Round-trip unit** — `src/external-editor.test.ts`: same `spawnMock` over `node:child_process` (L24) with REAL fs/os/path; helpers `closeWith(content, code)` (writes into the real temp file then emits `close`) and `failToSpawn()` (emits `error`); `resolveExternalEditorCommand` precedence tests L64–84 via `vi.stubEnv("VISUAL"/"EDITOR", …)` incl. empty-string = unset.

Env-var mocking is always `vi.stubEnv` (empty string means unset — machine-local env can't leak); the spawn is always faked at the `node:child_process` boundary, never mocked at `editInExternalEditor` except in panel.test.ts (layer 2).

---

## (e) BUG-003 — stale caps references (full inventory)

Ruling: **CAPS-OUT-001, owner ruling 2026-10-08** — spec/decisions.md:107 ("the caps engine is DELETED — the interrogate tool imposes NO limits on anything … Deleted wholesale: caps.ts … the `interrogator.caps` config block … every truncation/warning they produced"), spec/tool-protocol.md:68–74 ("## No caps (CAPS-OUT-001 …)" — nothing is limited; the former caps engine is deleted), spec/product-requirements.md:53 (FR-23 NO CAPS). The README's own Configuration section already agrees (see below).

### STALE — must change (2)

1. **README.md:113–116** (Model behavior note, §4 bullet):
   > "The goal
   > statement may be updated on any upsert — it is capped at 400 characters and
   > truncated with a warning beyond that — and an upsert sent after completion
   > starts a fresh interrogation …"

   Fix: drop the "capped at 400 characters and truncated with a warning beyond that" clause, e.g. "— it is stored verbatim (CAPS-OUT-001) —". (Contradicts README.md:130 and README.md:153–154, which already state the no-caps ruling; also contradicted by pinning tests tool.test.ts:201/208.)

2. **src/state.ts:324–328** (setGoal JSDoc):
   ```ts
   /**
    * Updates the interrogation goal (agent re-upserts with a changed goal —
    * FR-30). Not a rev/epoch transition. Emits `changed`. No caps/validation
    * here — the 400-char cap (BUG-009) is enforced at the tool call-site
    * (P1.M1.T1.S2).
    */
   ```
   The claimed call-site enforcement does not exist (tool.ts stores the goal verbatim, per tool.ts:201–204 and tool.test.ts:201–216). Fix: replace the last sentence — e.g. "No caps/validation here or anywhere — CAPS-OUT-001 deleted the caps engine; goals of any length are stored verbatim (FR-23)."

### BORDERLINE — judgment call (1)

3. **src/tool.ts:201** — "`state.setGoal(...)` (FR-30; BUG-001/BUG-009); an omitted goal leaves the stored one unchanged. NO CAPS (CAPS-OUT-001, 2026-10-08): nothing truncates the goal …". This is a historical ticket attribution for the setGoal plumbing, immediately followed by the correct NO-CAPS statement — not a claim that caps are enforced. Safe to leave; optionally drop "(BUG-009)" with the state.ts fix for consistency.

### NOT stale — correct references to the deletion (keep; verified for completeness)

- src/tool.ts:70 (guideline history: the self-heal sentence "was removed when CAPS-OUT-001 … deleted the caps engine"), :202–204.
- src/tool-schema.ts:235 ("NO CAPS (CAPS-OUT-001 …): batches of any size …").
- src/config.ts:65 ("NO CAPS (CAPS-OUT-001 …): the former `interrogator.caps` … [block] is deleted").
- Pinning tests: src/tool.test.ts:201 ("create upsert stores the goal VERBATIM — never truncated (CAPS-OUT-001)"), :208 ("reuse upsert stores an over-400-char goal verbatim"), :242, :381; src/tool-schema.test.ts:396 ("no caps (CAPS-OUT-001 — nothing is ever limited)"); src/config.test.ts:100.
- README.md:130 ("Nothing is length-limited or linted — content of any size passes through verbatim (CAPS-OUT-001)") and :153–154 (Configuration sample: "No caps: question count, option count, and text lengths are all unlimited — nothing is truncated or dropped (CAPS-OUT-001)").
- Spec: spec/tool-protocol.md:68–74; spec/decisions.md:107; spec/product-requirements.md:53 (FR-23).
- Unrelated "capped" hits (render budgets, not the caps engine): src/panel/overview.ts:231, src/panel/deep-view.ts:73, src/panel/layout.ts:317, src/renderers.ts:31.
- `plan/**` archives (prd snapshots, transcripts, TEST_RESULTS) mention the old 400-char cap but are frozen historical artifacts — out of scope by convention.

**Verdict: exactly two live stale references** (README.md:114, state.ts:327). No source/test code enforces or asserts a cap anywhere.

---

## (f) Risks

BUG-002:
1. **Comment drift in keys.ts** — three places describe externalEditor as text-focus-only (L96 resolution-order JSDoc, L145 seam interface comment, L562–564 gate comment) plus decisions.md:113–115 / ui-spec:84 wording ("editor focus (any duty)" — already correct). The code fix must update L96/L145/L562–564 or the next reader re-narrows the gate.
2. **Apply-side data corruption if only the gate is widened** — without the panel.ts fork, ctrl+g-in-note would silently write note text into the current question's draft slot and re-scope `bufferOwner`. The two edits are one atomic fix; widening the gate alone is worse than the bug (it weaponizes it).
3. **Test updates required** — `test_externalEditor_only_in_text_focus` (keys.test.ts:349) asserts the old gate by name; panel.test.ts's harness is text-focus-only (needs a note-mode leg asserting `setNote`/`batchNote` and NOT `setDraft`). No existing test asserts the note-focus negative, so nothing else breaks. `grep` found no other test touching ctrl+g in note focus.
4. **`\u0007` forwarding today** — the byte currently reaches `textField.handleInput` in note mode; after the fix it is consumed by the router. No test pins the current (wrong) forwarding behavior.
5. **Minor UX semantic** — an editor round-trip in note duty leaves `focus === "note"` (no blur/commit), matching h2.31 "the text replaces the field"; the note ships on the next submission as before. Consistent with exitNoteMode's write-through, but worth one new AC-style assertion (note-mode round-trip via keymap-ac pattern).

BUG-003:
6. Pure doc/comment edits — zero runtime surface; no tests reference README or the state.ts JSDoc. Only risk is leaving a third stale copy somewhere; the grep above is exhaustive for the live tree (src/, spec/, README.md; plan/ archives excepted).

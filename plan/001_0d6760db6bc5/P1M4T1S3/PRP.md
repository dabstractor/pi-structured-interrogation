# PRP — P1.M4.T1.S3: ctrl+g external editor ($VISUAL/$EDITOR, nano fallback)

## Goal

**Feature Goal**: Implement h2.31's `ctrl+g` external-editor handoff for the free-text field: when the text field is focused and the user presses the configured `keys.externalEditor` accelerator (default `ctrl+g`), pi-interrogator suspends the TUI, seeds a temp file with the current draft, spawns `$VISUAL` → `$EDITOR` → `nano` (win32: `notepad`) with `stdio: "inherit"`, and on clean exit (code 0) replaces the field text with the file contents. Non-zero exit or spawn error → no change. Temp file always cleaned up. Mirrors pi's built-in `app.editor.external` behavior exactly.

**Deliverable**: NEW `src/external-editor.ts` (pure, testable `editInExternalEditor()` — a faithful port of pi's own `dist/modes/interactive/external-editor.js`) + `openExternalEditor()` async method on `InterrogationPanel` (src/panel/panel.ts) + one-line wiring of the existing no-op seam `onExternalEditor` in `src/panel/keys.ts` + tests (`src/external-editor.test.ts`, extend `src/panel/panel.test.ts`).

**Success Definition**: In text focus, ctrl+g (or the rebound accelerator) → `tui.stop()` called, draft written to a temp file under `os.tmpdir()`, child spawned with inherit stdio; editor exits 0 → `tui.start()` + `requestRender`, `textField.setText(readback)` with BOM stripped and one trailing newline dropped, draft slot updated; editor exits non-zero or fails to spawn → field unchanged, TUI restarted; temp dir removed in all paths; second ctrl+g while one is in flight is ignored (re-entrancy guard). Works from note focus too (same code path). `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: pi user whose muscle memory is vim/nvim (externalEditor is nvim in this environment).

**Use Case**: The user is typing a long multi-line answer in the interrogation text field and wants their full editor (modes, macros, clipboard tooling) — presses `ctrl+g`, edits in nvim, saves and quits; the text lands in the field.

**User Journey**: ctrl+t (focus text) → type a bit → ctrl+g → TUI suspends, nvim opens with the draft → `:wq` → panel repaints with the full text; press enter (stage 1 of the two-stage contract, P1.M4.T1.S2) to save the draft.

**Pain Points Addressed**: Composed in-TUI editors can't match a real $EDITOR for long text; the handoff must not corrupt the terminal (TUI must be stopped/resumed) or lose the draft on editor misbehavior.

## Why

- h2.31 (Q17=A): "`ctrl+g` (mirrors `app.editor.external`): opens `$VISUAL`/`$EDITOR` (nano fallback) seeded with the draft via temp file; on clean exit the text replaces the field."
- h2.34: `external editor | ctrl+g | keys.externalEditor | text focus` — key already routed by P1.M3.T3.S1; this task supplies the action behind the seam.
- Architecture verification (plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md:70,78): pi's built-in `ctrl+g` = `app.editor.external` — PRD's mirror claim verified. Our router intercepts ctrl+g only while `panel.focus === "text"` (keys.ts:322-327), which is inside the panel's replace-editor region, so the built-in binding is shadowed exactly where we need it and nowhere else.

## What

### External-editor contract (authoritative)

1. **Command resolution** (JSDoc'd precedence, mirrors pi `settings-manager.js:getExternalEditorCommand()` minus pi-settings, per the item contract): `process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano")`. The command string is split on spaces so `"code --wait"` works: `const [editor, ...editorArgs] = cmd.split(" ")`.
2. **Temp file**: `mkdtempSync(join(tmpdir(), "pi-interrogator-"))` → `join(dir, "answer.md")`; `writeFileSync(path, draft, "utf-8")`. Seed = `panel.textField.getText()` (S1 wrapper: prefers `getExpandedText?.()`).
3. **Spawn**: `spawn(editor, [...editorArgs, filePath], { stdio: "inherit" })`. **NEVER `spawnSync`** — pi's own comment: on Windows, synchronous child_process calls keep libuv's console input read active, racing vim/nvim for the input buffer. Await a Promise over `child.on("error", () => resolve(null))` (editor missing / ENOENT) and `child.on("close", code => resolve(code))`.
4. **TUI suspend**: `tui.stop()` before spawn, `tui.start()` + `tui.requestRender(true)` in a `finally` — pi-tui's TUI exposes both (`dist/tui.d.ts` lines 230-231/330-336). The panel already holds `this.tui`.
5. **Read-back**: exit code 0 → `readFileSync(path, "utf-8")`, strip BOM (`replace(/^\uFEFF/, "")` — pi's `stripBom` util is not exported to extensions, implement locally), drop exactly ONE trailing newline (`.replace(/\n$/, "")`).
6. **Apply**: `textField.setText(content)`; keep focus in the text field (do NOT blur, do NOT arm the advance flag — that's S2's enter contract); sync the draft: `this.draftSlots.set(currentId, {value: currentId, text: content})` and `this.drafts?.setDraft(currentId, content)` (S2's seam — present when S2 lands; use optional chaining so this task is independently shippable); `this.invalidate()`.
7. **Failure**: exit ≠ 0, `error` event (null code), or read error → field unchanged, no exception escapes to the router.
8. **Cleanup**: `finally { try { rmSync(dir, {recursive: true, force: true}) } catch {} }` — best-effort, exactly like pi.
9. **Re-entrancy guard**: a private `externalEditorInFlight` flag; a second ctrl+g while true is a no-op (the TUI is stopped anyway; the guard makes it testable).
10. **Sync router, async action**: the keys router is sync; fire-and-forget with `void panel.openExternalEditor()` — the same pattern pi's extension-editor.js uses (`void this.handleOpenExternalEditor()`).
11. **Scope**: identical path for note focus if reachable (the router gates on `focus === "text"` today — h2.34 lists external editor as text-focus context; do NOT widen the gate).

### Success Criteria

- [ ] ctrl+g in text focus: `tui.stop()` before spawn, `tui.start()`+`requestRender(true)` after (both success and failure).
- [ ] Temp file seeded with the current field text; temp dir removed on every path (finally).
- [ ] Exit 0 → field text replaced (BOM-stripped, one trailing newline dropped); draft slot + DraftStore seam updated; focus stays "text"; `advanceArmed` untouched.
- [ ] Non-zero exit and spawn ENOENT → field text unchanged, no thrown error.
- [ ] Command precedence: `$VISUAL` beats `$EDITOR` beats platform fallback; args in the command string are passed through.
- [ ] In-flight guard: second invocation while running returns immediately.
- [ ] `npm run typecheck` + `npm test` green; `[Mode A]` JSDoc documents the $VISUAL/$EDITOR/nano precedence.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: pi's own external-editor implementation (port target), the TUI stop/start suspend pattern, the existing keys.ts seam + router gate, S1's TextField API, S2's draft-slot contract, and the test conventions. All anchored below.

### Documentation & References

```yaml
- url: (local port target) /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/external-editor.js
  why: pi's own editInExternalEditor — mkdtemp/writeFileSync/spawn(stdio inherit)/await close/stripBom/finally rmSync. PORT THIS FILE (rename prefix to pi-interrogator-, file to answer.md, stripBom inlined).
  critical: the "Do not use spawnSync" comment (Windows console-input race with vim/nvim) must be preserved in the port's JSDoc; child.on("error") resolves null → failure path.

- url: (local) /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/extension-editor.js (lines 73-100)
  why: caller pattern — getText() BEFORE tui.stop(); tui.stop() → await edit → setText on success → finally { tui.start(); tui.requestRender(true) }. Sync handleInput fires it via `void ...`.
  critical: stop the TUI BEFORE spawning, always restart in finally (a crash in edit must not leave the terminal dead).

- url: (local) /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js (lines 626-636)
  why: command precedence reference — configured → VISUAL || EDITOR → win32 notepad : nano. Our version drops the pi-settings leg (we are an extension; env-only per the item contract) and JSDocs $VISUAL/$EDITOR/nano.

- file: src/panel/keys.ts
  why: seam to wire — RoutedActions.onExternalEditor (line 93-94, "M4.T1.S3 wires; default no-op" at line 254); router gate `panel.focus === "text" && matchesKey(data, b.externalEditor)` (lines 322-327); binding default ctrl+g via config.ts:130.
  pattern: change ONLY the defaultRoutedActions body: `onExternalEditor: (p) => { void p.openExternalEditor(); }`.
  gotcha: keys.test.ts:448 asserts the default no-op doesn't throw — a void async call still doesn't throw synchronously; verify that test still passes and extend it.

- file: src/panel/panel.ts
  why: integration host — holds `tui: TUI` (lines 152, 239), `textField` (S1), `focus`, `currentId`, `invalidate()`; S2 (parallel, treat as landed) adds `draftSlots` Map + `drafts` seam + `advanceArmed`.
  gotcha: openExternalEditor must NOT touch focus or advanceArmed (h2.31: "the text replaces the field" — nothing about advancing); the user still presses enter (S2 stage 1) to save-and-blur.

- file: src/panel/text-field.ts (S1, READ-ONLY)
  why: TextField API — getText() (prefers getExpandedText), setText(), focused. Use getText() for the seed and setText() for the apply.
  gotcha: line 245 comment "FUTURE M4.T1.S3: ctrl+g handler reads textField.getText()/setText() for the external round-trip" — that future is now; do not modify the file.

- file: plan/001_0d6760db6bc5/P1M4T1S2/PRP.md
  why: CONTRACT (parallel, treat as landed): draftSlots Map<string,{value,text}>, drafts seam (setDraft/getDraft), advanceArmed two-stage machine, saveTextDraft(). Sync via optional access so order-of-landing doesn't matter: this.draftSlots?.set(...), this.drafts?.setDraft(...).

- file: src/panel/keys.test.ts + src/panel/panel.test.ts
  why: test conventions — stub theme/TUI objects cast to the pi-tui types, vi.fn() spies, fake panel fixtures. keys.test.ts:299-302 already covers the router calling onExternalEditor only in text focus — your work is the ACTION side.

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.31, h2.34)
  why: authoritative wording — ctrl+g mirrors app.editor.external; hotkey table context "text focus".

- url: node:child_process spawn docs — https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
  why: stdio "inherit" semantics; "error" vs "close" events (error fires on spawn failure e.g. ENOENT, close on exit).
  critical: ALWAYS listen to "error" — an unhandled "error" event on a ChildProcess CRASHES the process.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  config.ts               # keys.externalEditor default "ctrl+g" (landed, read-only)
  panel/
    panel.ts              # MODIFY: openExternalEditor() + in-flight guard + draft sync
    keys.ts               # MODIFY: wire onExternalEditor default (one line + JSDoc)
    text-field.ts         # S1 (landed) — READ-ONLY
    panel.test.ts         # EXTEND: openExternalEditor lifecycle tests
external-editor.test.ts   # does not exist yet
```

### Desired Codebase tree

```bash
src/
  external-editor.ts        # CREATE: editInExternalEditor() — pi port, pure & spawn-mockable
  external-editor.test.ts   # CREATE: full unit coverage of the round-trip
  panel/
    panel.ts                # openExternalEditor() async method + guard + [Mode A] JSDoc
    keys.ts                 # onExternalEditor default → void p.openExternalEditor()
    panel.test.ts           # extended: tui stop/start, setText apply, failure no-op, guard
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: NEVER use spawnSync — Windows console-input race with vim/nvim
// (pi's own comment; preserve it). spawn + Promise over "error"/"close".
// CRITICAL: unhandled ChildProcess "error" event crashes Node — the
// `child.on("error", () => resolve(null))` listener is load-bearing.
// GOTCHA: tui.stop() BEFORE spawn, tui.start() in finally — never leave the
// terminal dead if readFileSync throws.
// GOTCHA: stripBom is pi-internal (utils/text.js, not exported) — inline
// `content.replace(/^\uFEFF/, "")` and drop exactly ONE trailing "\n"
// (pi does .replace(/\n$/, "") — one, not /g, so intentional trailing blank
// line survives with one newline eaten).
// GOTCHA: read the text BEFORE tui.stop() (pi's order) — cosmetic, but keeps
// the suspend window minimal and matches the port.
// GOTCHA: the router is sync; fire-and-forget with `void p.openExternalEditor()`.
// Never await inside the router. Errors inside openExternalEditor are caught
// internally (try/finally around the whole body) — nothing rejects unhandled.
// GOTCHA: command strings may contain args ("code --wait") — split(" ") and
// spread; do NOT use shell:true (pi only does that on win32 — copy that).
// GOTCHA: do NOT blur, do NOT arm advanceArmed, do NOT change focus — h2.31
// says the text replaces the field, full stop. Enter afterward is S2's stage 1.
// GOTCHA: S2 may not be merged when this lands — access its additions with
// optional chaining (`this.draftSlots?.set(...)`) or declare-tolerant reads so
// this task compiles and passes tests standalone.
```

## Implementation Blueprint

### Data models and structure

```ts
/** src/external-editor.ts — result shape (mirrors pi's internal API) */
export type ExternalEditorResult =
  | { status: "complete"; content: string }
  | { status: "failed" };

export interface ExternalEditorOptions {
  /** Full command line, e.g. "nvim" or "code --wait". */
  command: string;
  /** Draft seeded into the temp file. */
  content: string;
}

/** Resolve $VISUAL → $EDITOR → platform fallback (h2.31). */
export function resolveExternalEditorCommand(): string;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/external-editor.ts
  - IMPLEMENT resolveExternalEditorCommand(): process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano"); [Mode A] JSDoc stating the precedence
  - IMPLEMENT editInExternalEditor(options): Promise<ExternalEditorResult> — port pi's dist/modes/interactive/external-editor.js: mkdtempSync(join(tmpdir(), "pi-interrogator-")), file "answer.md", writeFileSync, spawn(command.split(" ")[0], [...rest, filePath], {stdio:"inherit", shell: win32}), Promise over error→null / close→code, !==0 or null → {status:"failed"}, else {status:"complete", content: stripBom+one-trailing-newline readback}, finally rmSync recursive+force (try/catch swallowed)
  - JSDoc: cite h2.31, the mirror of app.editor.external, and the no-spawnSync rationale (Windows input race)

Task 2: MODIFY src/panel/panel.ts — openExternalEditor()
  - ADD private externalEditorInFlight = false
  - ADD public async openExternalEditor(): Promise<void>
    [Mode A] JSDoc: ctrl+g mirrors pi's app.editor.external; $VISUAL/$EDITOR/nano
    precedence; clean-exit-only replace (h2.31); no focus/arming changes (S2 owns enter semantics)
  - BODY: guard in-flight → return; const draft = this.textField.getText();
    this.tui.stop(); try { result = await editInExternalEditor({command: resolveExternalEditorCommand(), content: draft});
    if complete: this.textField.setText(result.content); sync drafts (this.draftSlots?.set(currentId, {value: currentId, text: result.content}); this.drafts?.setDraft(currentId, result.content)); this.invalidate(); }
    finally { this.externalEditorInFlight = false; this.tui.start(); this.tui.requestRender(true); }
    — set inFlight=true right after the guard; wrap the ENTIRE body so no path leaves the flag stuck or the TUI stopped
  - GOTCHA: currentId via the panel's existing current-question accessor (see how saveTextDraft/applyAnswer reference it in actions.ts/panel.ts — same source)

Task 3: MODIFY src/panel/keys.ts — wire the default seam
  - REPLACE the no-op at defaultRoutedActions.onExternalEditor (line ~254):
      onExternalEditor: (p) => { void p.openExternalEditor(); },
    with a comment: fire-and-forget (router is sync; pi uses the same `void` pattern in extension-editor.js). The comment "M4.T1.S3 wires" becomes "wired by M4.T1.S3".
  - NOTHING else in keys.ts changes (gate, binding, and ordering are already correct and tested)

Task 4: CREATE src/external-editor.test.ts
  - MOCK child_process: vi.mock("node:child_process", ...) returning a fake spawn that records args and lets each test emit ("close", 0|1) or ("error") + write the file content (use the REAL tmpdir path captured from args)
  - CASES:
    (1) success: writes seed content, spawns `${editor} ${file}` with stdio inherit, close 0 → {status:"complete", content} with BOM and one trailing newline stripped; tmp dir removed afterward
    (2) close 1 → {status:"failed"}; tmp dir still removed
    (3) "error" event (ENOENT) → {status:"failed"}, no crash
    (4) command with args ("code --wait"): editor="code", args ["--wait", file]
    (5) precedence: VISUAL set wins over EDITOR; EDITOR alone works; neither → nano (or notepad on win32 — assert the branch via platform stub or accept nano on linux CI)
  - FOLLOW pattern: any existing src/*.test.ts (vitest, describe/it, vi.mock)

Task 5: EXTEND src/panel/panel.test.ts (or new src/panel/external-editor-panel.test.ts)
  - MOCK ../external-editor.js (vi.mock) to a controllable async fn
  - FIXTURE: panel with stub tui ({stop: vi.fn(), start: vi.fn(), requestRender: vi.fn(), ...}), fake textField ({getText: vi.fn(), setText: vi.fn(), ...}), drafts seam spies, keys seam returning false
  - CASES:
    (1) openExternalEditor: tui.stop called before editInExternalEditor; on complete → setText with content, drafts synced, invalidate called, focus unchanged, advanceArmed (if present) unchanged, tui.start + requestRender(true) called
    (2) failed: setText NOT called, tui.start still called
    (3) editInExternalEditor throws (mock rejects): tui.start still called, no unhandled rejection (void + internal try/finally), in-flight flag cleared
    (4) re-entrancy: start first call (pending promise), call again → second editInExternalEditor NOT invoked
    (5) wire check: driving panel.handleInput with ctrl+g data ("\x07" — verify with parseKey/matchesKey in a keys.test.ts-style test, or extend keys.test.ts:299-302 case to assert the default action calls panel.openExternalEditor via a spy)
```

### Implementation Patterns & Key Details

```ts
// src/external-editor.ts — the load-bearing spawn await (port of pi's)
const exitCode = await new Promise<number | null>((resolve) => {
  const child = spawn(editor, [...editorArgs, filePath], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("error", () => resolve(null)); // load-bearing: unhandled "error" crashes Node
  child.on("close", (code) => resolve(code));
});
if (exitCode !== 0) return { status: "failed" };
return {
  status: "complete",
  content: readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "").replace(/\n$/, ""),
};

// src/panel/panel.ts — suspend/resume envelope (pi's extension-editor pattern)
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
      this.textField.setText(result.content);
      // Draft sync — S2's slot + seam (optional-chained for landing-order independence)
      this.draftSlots?.set(this.currentId, { value: this.currentId, text: result.content });
      this.drafts?.setDraft(this.currentId, result.content);
      this.invalidate();
    }
  } finally {
    this.externalEditorInFlight = false;
    this.tui.start();
    this.tui.requestRender(true);
  }
}
```

### Integration Points

```yaml
KEYS: defaultRoutedActions.onExternalEditor body only (keys.ts ~254) — void p.openExternalEditor()
PANEL: openExternalEditor() + externalEditorInFlight; optional-chained draftSlots/drafts (S2)
TEXT-FIELD (S1, read-only): getText/setText round-trip
FUTURE M4.T2.S1: real DraftStore — this.drafts seam already covers it
FUTURE M4.T2.S2: note-mode text goes through the same textField; the router gate
  stays text-focus-only per h2.34; if note focus ever needs ctrl+g, that task widens the gate
NO changes to: config.ts, actions.ts, text-field.ts, state.ts, index.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/external-editor.test.ts -v
npx vitest run src/panel/ -v
npm test
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

The real nvim round-trip in a live terminal belongs to MANUAL-TUI-AC-RUNBOOK.md (add a line: "ctrl+g → nvim opens with draft → :wq → field updated; :cq → unchanged"). Everything else is vitest-assertable with mocked spawn and stub TUI.

### Level 4: Domain-specific

```bash
grep -n "spawnSync" src/            # must be empty — spawn only
grep -n "VISUAL" src/external-editor.ts src/panel/panel.ts   # precedence JSDoc present
grep -n "Mode A" src/external-editor.ts src/panel/panel.ts   # [Mode A] JSDoc present
grep -rn "on(\"error\"" src/external-editor.ts               # load-bearing listener present
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green (including keys.test.ts:448 default-action smoke).

### Feature Validation

- [ ] ctrl+g (text focus) suspends TUI, seeds temp file with draft, spawns resolved editor with inherit stdio.
- [ ] Clean exit replaces field text (BOM-stripped, one trailing newline dropped); draft slot + seam synced; focus/arming untouched.
- [ ] Non-zero exit / spawn failure: no change, no crash, TUI restarted, temp cleaned.
- [ ] $VISUAL > $EDITOR > nano precedence implemented and JSDoc'd; command args pass through.
- [ ] Re-entrancy guarded; the async action never rejects unhandled (void + try/finally).

### Code Quality Validation

- [ ] Faithful port of pi's external-editor.js (structure + comments), adapted names only.
- [ ] No changes outside src/external-editor.ts(+test), panel.ts, keys.ts one-liner, panel tests.
- [ ] Router gate, bindings, and key-routing order untouched.

### Documentation & Deployment

- [ ] [Mode A] JSDoc on the precedence and the clean-exit-only contract; no new config keys (command is env-driven per h2.31).
- [ ] MANUAL-TUI-AC-RUNBOOK.md note added for the live nvim round-trip (human-only check).

## Anti-Patterns to Avoid

- ❌ Don't use `spawnSync` — Windows console-input race with vim/nvim (pi's documented reason).
- ❌ Don't omit the `child.on("error")` listener — unhandled ChildProcess errors crash the process.
- ❌ Don't restart the TUI outside a `finally` — a failed read must not leave the terminal dead.
- ❌ Don't blur/advance/arm on successful edit — enter semantics belong to S2's two-stage contract.
- ❌ Don't read pi's settings.externalEditor — the contract is env-only ($VISUAL/$EDITOR/nano).
- ❌ Don't make the router async or await inside it — fire-and-forget with `void`.
- ❌ Don't hardcode "nano" without the win32 notepad branch or the env lookups.
- ❌ Don't strip ALL trailing newlines — exactly one, matching pi.

# Research — P1.M7.T5.S2 Config surface validation (R5/AC-12)

## Key findings from codebase analysis

### Existing config-driven infrastructure (all complete)
- `src/config.ts` — `DEFAULT_CONFIG.keys` (10 actions: deep, overview, focusText,
  batchNote, submit, breakOut, discuss, externalEditor, prevQuestion, nextQuestion),
  `loadConfigFrom` (global <agentDir>/settings.json ← project <cwd>/.pi/settings.json
  deep-merge), `resolveKeyLabels()` (line 370) derives display labels from resolved
  config; `labelFor` capitalizes tokens. `parseAccelerator` grammar validation.
- `src/panel/keys.ts` — `resolveBindings()` (falls back to default + console.warn on
  invalid), `buildKeyRouter()` dispatches all 10 configurable actions; fixed keys
  (arrows, esc ladder, enter, digits) correctly NOT configurable per h2.34.
- `src/command.ts:163` — `pi.registerShortcut(config.keys.breakOut as KeyId, …)` uses
  the RAW config accelerator (comment documents "config-rebind path"). NOTE: it passes
  `config.keys.breakOut` verbatim — not the normalized `parseAccelerator` output, so a
  config value like `"Ctrl+Shift+Q"` (uppercase) or with whitespace would be passed
  raw to registerShortcut while keys.ts normalizes. Candidate audit item.
- Display-string consumers (all documented as config-driven):
  - Footer: `src/panel/layout.ts:359-383` `SCREEN_KEYS` + `ACTION_WORDS` + `labels`
    param (caller passes `resolveKeyLabels(config)`).
  - Suspend widget: `src/panel/suspend.ts:82` `${labels.breakOut} to resume
    /interrogate`; line 104 resolves via `resolveKeyLabels(config)`.
  - Dialogs: ripple-confirm (enter/esc — fixed keys, not in keys.*), gate warning
    (`src/panel/gate.ts`), batch-note title (`src/panel/layout.ts:232`) — audit for
    key mentions.
- Existing tests already cover partial remap: `src/panel/keys.test.ts:245`
  "buildKeyRouter — remappability (AC-12 core)" remaps only submit+deep;
  `src/config.test.ts:154,174` tests resolveKeyLabels for default and one rebound.

### Hardcoded key-string grep result (src, non-test)
All literal `ctrl+…` matches outside `config.ts` defaults/JSDoc are in COMMENTS
only (state.ts, tool.ts, delivery.ts, command.ts, panel/*.ts JSDoc). No runtime
hardcoded key label strings found in this pass — but a machine-checked guard test
does not exist yet. That guard is the deliverable.

### Parallel sibling P1.M7.T5.S1 (adaptive rendering)
Adds `src/panel/terminal-budget.ts`; narrow footer shows only `submit` + `deep`
hints — STILL config-resolved labels. No conflict: S2 is validation/guard work.

### Test setup
vitest, `npm test`. Patterns: `configWithKeys` helper in keys.test.ts; fake panel
fixtures throughout panel tests; command.test.ts mocks ExtensionAPI with
registerShortcut spy (verify exact spy name when implementing).

### Keymap conflict table (environment-and-conflicts.md, must re-verify)
Avoid: ctrl+b family (patty-bg-tasks), ctrl+shift+s/w (pi-web-access),
ctrl+shift+f, ctrl+shift+up/down, ctrl+m. Verified-free default: ctrl+shift+q.

### Feeds
README keymap table + conflict re-verification record = P1.M7.T7.S2.

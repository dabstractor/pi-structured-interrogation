# Research — P1.M7.T3.S2: Completion recap card + state entry renderer

## Inputs discovered (exact contracts)

### 1. Completion recap card data — `src/delivery.ts` (P1.M2.T1.S3, live)

`CompletionMessage` (lines ~217–244):
- `customType: "interrogation-completion"`, `display: true`
- `content`: full h2.46 record verbatim (model-visible — renderer must NOT touch)
- `details`: `{ goal: string; groups: CompletionRecapGroup[]; notes: string[]; withdrawnMoot: Array<{id, status: "withdrawn"|"moot", reason}>; completedAt: string (ISO); epoch: number }`

`CompletionRecapGroup`: `{ group: string; questions: CompletionRecapEntry[] }` (first-appearance order).
`CompletionRecapEntry` (~lines 195–212): `{ id, title, answer, star: boolean, freeText?: string (omitted when absent), answeredAt?: string (ISO, omitted when unanswered) }`.

Notes may be `[]`; withdrawnMoot may be `[]`. `freeText` key is OMITTED when absent (use truthiness).

### 2. State mirror entries — `src/persistence.ts` (P1.M7.T1.S1, live)

- `INTERROGATION_STATE_ENTRY_TYPE = "interrogation-state"` (exported const, line 59)
- `InterrogationStateEntryData` (lines 65–76): `{ state: SerializedState; epoch: number; at: string (ISO) }`
- Entries are durable, NOT in LLM context, appended via `pi.appendEntry(type, data)`.

### 3. pi API signatures — plan/001_0d6760db6bc5/architecture/pi-api-validation.md line 50

- `pi.registerEntryRenderer<T>(customType, (entry, { expanded }, theme) => Component)` — note: entry renderer options carry NO `outputPad` (message renderer does).
- `pi.registerMessageRenderer(customType, (message, { expanded, outputPad }, theme) => Component)`
- Entries: user-visible only via entry renderer; restorable via ctx.sessionManager.

### 4. Reference example — entry-renderer pattern

`/home/dustin/projects/pi/packages/coding-agent/examples/extensions/entry-renderer.ts`:
```ts
pi.registerEntryRenderer<StatusCardData>("status-card", (entry, { expanded }, theme) => {
  const data = entry.data ?? { message: "No data", timestamp: Date.now() };
  const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  box.addChild(new Text(`${theme.fg("accent", "[status]")} ${data.message}`, 0, 0));
  if (expanded) box.addChild(new Text(theme.fg("dim", new Date(data.timestamp).toLocaleString()), 0, 0));
  return box;
});
```
`entry.data` is the payload; defensive `??` default required.

### 5. Sibling PRP (P1.M7.T3.S1) — CONTRACT, running in parallel

S1 creates `src/renderers.ts` with `buildSubmissionCard(card, {expanded, outputPad}, theme)` + `registerSubmissionCardRenderer(pi)` and `src/renderers.test.ts`. S2 MUST:
- EXTEND `src/renderers.ts` (add functions, do not restructure S1's)
- Follow S1's established pattern: pure exported build function + thin registration shim, stub-theme tests, `.js` relative imports
- Register both renderers from `src/index.ts` (add `registerCompletionRecapRenderer(pi)` + `registerStateEntryRenderer(pi)` after S1's call)

### 6. h2.36 renderer spec (PRD)

- `interrogation-completion`: recap card — goal, every question with final answer (grouped), timestamps; `expanded` shows withdrawn/moot with reasons.
- `interrogation-state` (registerEntryRenderer): dimmed one-line mirror marker (audit trail; not interactive): `· interrogation state @ epoch {n}`.

### 7. Theme/styling conventions (src/tool.ts renderResult, S1 PRP)

- `theme.fg("dim", ...)`, `theme.fg("toolTitle", theme.bold(...))`, `theme.fg("accent", ...)`
- `new Text(line, 0, 0)` per line; Box+addChild for multi-line
- Timestamps: `new Date(iso).toLocaleString()` per entry-renderer example
- AC-14 (h2.10): recap card appears in transcript at completion.

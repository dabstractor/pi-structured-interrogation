# PRP — Bugfix P1.M1.T1.S5: End-to-end regression — delivered submission (elaboration + write-in) reconstructs with full answer shape

## Goal

**Feature Goal**: Land the PRD-required regression pin for BUG-001 (PRD h2.2/h3.0, Recommendation 1, item 4): a permanent e2e test in a NEW file `src/regression-replay-fidelity.test.ts` that reproduces the exact missed-flush-window scenario end-to-end — real `executeInterrogate` upsert (tool result = reconstruction base), real panel gestures (option accept + committed elaboration on q1, ✎ Other write-in on q2), REAL auto-submit delivery captured off the wire, then reconstruction from a branch `[toolResultEntry(base), submissionEntry(capturedDetails)]` with NO mirror entry (hard kill inside the 2s `STATE_MIRROR_DEBOUNCE_MS` window) — asserting the replayed state carries the FULL answer shape: `q1.answer.text` (elaboration) and `q2.answer.custom` (write-in marker), with value-first resolution (q2's RAW write-in value, not a label).

**Deliverable**: One new test file `src/regression-replay-fidelity.test.ts` (regression-file convention per `src/regression-phantom-submissions.test.ts`) containing a header comment naming BUG-001 + the missed-flush-window reachability, locally-copied fixture/mock helpers, and the e2e test. NO source files modified.

**Success Definition**:
- The e2e test passes green against the S2+S3+S4 fix, and would FAIL against value-only replay (verifiable once via a temporary mutation check, then restored)
- Wire-shape assertions pin the delivered `details.changed` entries carry `text`/`custom` (producers S2/S3)
- Post-replay assertions pin `q1.answer = {value:"alpha", text:"alpha fits the migration plan"}` (no `custom` key) and `q2.answer = {value:"Neither — we use a custom vector store", custom:true}` (no `text` key), fresh `at`, `result.source === "tool-result"`, `result.replayed === 1`, `state.epoch === 2`
- `npm run typecheck` + `npm run lint` + `npm test` all green; ONLY the new test file added (zero diffs elsewhere)

## User Persona

**Target User**: The restarting user whose process died hard (SSH drop / SIGKILL / crash inside the 2s mirror debounce, or an appendEntry failure) — plus every future contributor who must not silently regress restart fidelity.

**Use Case**: The user answered an option question WITH an elaboration and a second question via ✎ Other write-in; auto-submit delivered; the process died before the debounced `interrogation-state` mirror flushed (session_shutdown's synchronous flush never ran). On restart, reconstruction replays the submission delta — and must restore the elaboration and the ✎ marker, not just bare values.

**User Journey**: upsert (2 choice questions) → answer q1 = option + elaboration commit → answer q2 = ✎ Other write-in → auto-submit delivers `interrogation-submission` → hard kill (no mirror entry lands) → restart → `reconstructFromBranch` on `[tool-result base, submission entry]` → full answer shape restored: read surface keeps `elaboration:` lines (TRUST-001), ✎ markers live (WRITEIN-001), caret pins to the ✎ Other row (ANSWER-PIN-001), completion record keeps the elaboration (FR-5), branch state is canonical (FR-27).

**Pain Points Addressed**: user-authored words vanishing from every model-visible surface after a restart; replayed write-ins LOOKING replaced by the first option (caret clamps to row 0); the one-time completion record permanently omitting elaborations and rendering write-ins as plain answers.

## Why

- BUG-001 (PRD h3.0): `replaySubmission` applied only `entry.value`; the DiffEntry carrier had no `text`/`custom`. S2 extended `DiffEntry` + `computeEntries` (merged), S3 extended the panel's synthetic-entry seam, S4 taught `replaySubmission` to apply the fields with strict guards. Each landed with UNIT coverage — but the PRD explicitly demands a regression test replaying a submission carrying an elaborated option answer and a custom write-in (Recommendation 1, item 4), and only an END-TO-END test (real delivery → real reconstruction) pins the whole chain as one contract.
- This is the bugfix changeset's permanent tripwire: it transitively fails if ANY of S2 (carrier), S3 (producer B on the auto-submit path), or S4 (consumer) regresses — a much narrower failure surface than three unit suites whose fixtures could drift independently.
- Feeds P1.M3.T1.S1 (final changeset gate — this file is part of the suite it runs) and P1.M3.T2.S1 (README restart-section sync references the pinned behavior).

## What

Create `src/regression-replay-fidelity.test.ts` with:

1. **Header comment** (regression-file convention): names BUG-001 (PRD h2.2/h3.0 — restart reconstruction loses answer elaborations and write-in markers when replaying submission deltas), the missed-flush-window reachability (2s `STATE_MIRROR_DEBOUNCE_MS`, `src/persistence.ts:62`; hard kill/SSH drop/SIGKILL before session_shutdown's synchronous flush, or appendEntry failure → branch holds only the older tool result + submission entries), and the pinned contracts: FR-27, TRUST-001, WRITEIN-001, ANSWER-PIN-001, FR-5/commitment 2. States that the fix (S2 carrier + S3 producer + S4 consumer) is pinned END-TO-END by this file.
2. **Locally-copied helpers** (they are module-private in their home files — copy, don't import):
   - From `regression-phantom-submissions.test.ts`: `stubTheme`, `fakeEditor()`, `makePiHarness()` (sendMessage `vi.fn` + host-event map; only `pi`/`sendMessage`/`emit` needed).
   - From `reconstruct.test.ts`: `toolResultEntry`, `submissionEntry`, `makeCtx`, `makeHost`, `makeOpts` (verbatim shapes; `submissionEntry`'s inline `changed` element type includes `text?: string; custom?: boolean` — post-S3 the real captured details carry them).
   - `beforeEach`: `setFallbackActive(false); makeHost(); resetState();` (reconstruct.test.ts order — `makeHost()` also resets panel.ts's module-scoped host record between tests).
3. **The e2e test** (full skeleton in Blueprint): upsert two choice questions via the REAL `executeInterrogate` tool path; capture `upsert.details` (the real tool-result envelope `{state, epoch, statusLine, action}` — the reconstruction base candidate); drive a REAL `InterrogationPanel` — q1: accept option + commit an elaboration (`focusTextField("elaboration")` + `textField.setText` + ENTER → `commitTextDraft`); q2: ✎ Other write-in (cursorIndex = options.length → ENTER → `textField.setText(writeInText)` → ENTER → `writeInEnter` commits `{value, custom:true}` and `maybeAutoSubmit` fires SYNCHRONOUSLY); capture the single delivered `interrogation-submission` message off the mocked `sendMessage`; assert the WIRE shape (q1 entry carries `text`, q2 entry carries `custom` + RAW value) and the LIVE pre-kill state; then model the hard kill (`resetState()`; NO mirror entry ever built), reconstruct via `reconstructFromBranch(makeCtx([toolResultEntry(upsert.details), submissionEntry(delivered.details)]), makeOpts(makeHost()))`, and assert the FULL post-replay answer shape.

### Success Criteria

- [ ] `npx vitest run src/regression-replay-fidelity.test.ts` green
- [ ] Wire: delivered `details.changed` q1 entry has `value:"alpha"` AND `text:"alpha fits the migration plan"`; q2 entry has `value:"Neither — we use a custom vector store"` (RAW text — value-first, not the `✎ …` label in `to`) AND `custom:true`
- [ ] Post-replay: `q1.answer.text === "alpha fits the migration plan"`, `"custom" in q1.answer === false`; `q2.answer.custom === true`, `q2.answer.value === "Neither — we use a custom vector store"` (value-first resolution — the RAW write-in text, not a label), `"text" in q2.answer === false`
- [ ] Sanity: `result.source === "tool-result"`, `result.replayed === 1`, `state.epoch === 2` (base epoch 1 + one replayed submission's bump), `typeof q1.answer.at === "string"`
- [ ] No auto-submit before q2's commit: `h.sendMessage` NOT called after q1's accept/elaboration (exactly ONE delivered submission total)
- [ ] Header comment names BUG-001 + missed-flush-window reachability + the five pinned contract IDs
- [ ] `npm run typecheck` + `npm run lint` + `npm test` green; `git status` shows ONLY the new file

## All Needed Context

### Context Completeness Check

Sibling contracts this PRP builds on (treat as implemented exactly as specified): S2 MERGED in the working tree (`DiffEntry` has `text?: string`/`custom?: boolean`, `computeEntries` spreads them — snapshots.ts); S3 extends the panel submit seam in `src/panel/actions.ts` (synthetic entries read `q.answer?.text`/`q.answer?.custom` with the same conditional-spread convention) and its own `actions.test.ts`; S4 adds the two conditional spreads in `replaySubmission` (reconstruct.ts:~439) + extends reconstruct.test.ts helpers. S5 touches NO source file — it only reads the real machinery end-to-end. An implementing agent needs this PRP plus read access to the five files named below; every code block quoted here was read verbatim from the working tree.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug001-submission-replay.md
  why: "§Pipeline (verified end-to-end) is the exact chain this test pins: answer shape → DiffEntry carrier → producer A → producer B (actions.ts seam) → replaySubmission consumer → downstream damage; §'Test harness' documents every helper with line numbers; §'Size/caps risk — CLEARED' guarantees details.changed ships UNTRUNCATED (wire asserts are safe)"
  critical: "§Fix surface item 4 IS this subtask ('Regression test replaying a submission carrying an elaborated option answer + a custom write-in')"

- file: src/regression-phantom-submissions.test.ts
  why: "THE regression-file convention: header comment block naming the incident; makePiHarness (:60-76); makeWalkthrough/panelOf (REAL InterrogationPanel: stubTheme, fakeEditor editorFactory, DraftStore, delivery seam {sendMessage, isIdle, noteSubmissionDelivered}); writeIn helper (:140-160)"
  pattern: "drive the REAL tool path (executeInterrogate) + REAL panel gestures; assert off the recorded sendMessage calls"
  gotcha: "SIDECHAT-001 comment in writeIn: editorFactory builds TWO editors — address the ANSWER editor via panel.textField (setText), never the captured factory editor"

- file: src/reconstruct.test.ts
  why: "Fixtures to copy locally: toolResultEntry :73-88 (role toolResult, toolName interrogate, details.state), submissionEntry :115-136 (type custom_message, customType interrogation-submission, details {...details, card}), makeCtx :175-193 (sessionManager.getBranch; ui.custom NEVER-RESOLVING promise; ui.setWidget vi.fn — SURFACE-002), makeHost :193-199, makeOpts :200-203; beforeEach order :205-210"
  pattern: "makeCtx's ui.custom never-resolving promise = panel 'opens' as keyed widget only; setWidget must be present or widget asserts are vacuous"
  gotcha: "helpers are module-PRIVATE — copy them into the new file; post-S4 the submissionEntry inline type carries text?/custom? — include them in the copy (the captured real details carry them)"

- file: src/panel/actions.test.ts
  why: "Proven gesture sequences to replicate: elaboration commit (:2325-2333 — currentId re-seed → focusTextField('elaboration') → textField.setText → handleInput(\\r) → stageText → commitTextDraft; slot visible via panel.draftTextFor); same-gesture auto-submit attach (:2580-2640 — one sendMessage, epoch 1→2, flash 'submitted — {n} answer(s)', synchronous); commitWriteIn (:2227-2235 — cursorIndex = options.length; accept; panel.textField.setText; handleInput(\\r)); option accept seeds (:2328 — currentId re-seeds cursor to the recorded answer's row — set cursorIndex explicitly)"
  pattern: "makeDeps (:125-129) = { sendMessage, isIdle: () => true } — the ONLY delivery mock"
  gotcha: "auto-submit is transition-gated: answering q1 while q2 is open must NOT deliver — pin with a not-called assert between the gestures"

- file: src/reconstruct.ts
  why: "READ-ONLY. reconstructFromBranch :470 + result contract :214-216 ({source, replayed, opened, fallbackActive, state?}); base selection :491-507 (tool result details.state → source 'tool-result'); replay loop ~:558-570"
  gotcha: "reconstructFromBranch SETS global state (setState) — resetState() before calling it in the test to prove reconstruction (not the walkthrough) produced the answers"

- file: src/tool.ts
  why: "READ-ONLY. executeInterrogate :219 (args, ctx, config); upsert return :342 = { content, details: inlineEnvelope(...) } where inlineEnvelope :177-178 = { state: structuredClone(serialized), epoch, statusLine, action } — upsert.details IS the faithful real tool-result details for the branch base entry"
  gotcha: "ExecutorContext = { mode: 'tui', hasUI: true }"

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S4/PRP.md
  why: "Consumer contract: the exact conditional spreads replaySubmission applies; S4's unit tests pin guards/clearance/legacy — S5 does NOT re-test guards, only the happy-path full-shape e2e"
  gotcha: "S4 also touches reconstruct.test.ts — S5 must NOT edit reconstruct.test.ts (copy helpers instead)"

- file: src/persistence.ts
  why: "READ-ONLY reference for the header comment: STATE_MIRROR_DEBOUNCE_MS = 2000 (:62); INTERROGATION_STATE_ENTRY_TYPE (:59)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── regression-phantom-submissions.test.ts   # regression-file convention + panel walkthrough harness (copy patterns)
├── regression-reask-roundtrip.test.ts       # second regression-* file (naming precedent)
├── reconstruct.test.ts                      # fixtures + ctx/host/opts mocks (copy locally)
├── reconstruct.ts                           # reconstructFromBranch — READ-ONLY
├── tool.ts                                  # executeInterrogate (real tool path) — READ-ONLY
├── delivery.ts                              # SubmissionMessage shape — READ-ONLY
├── panel/actions.ts                         # S3's seam (exercised transitively) — DO NOT TOUCH
└── snapshots.ts                             # S2's carrier (exercised transitively) — DO NOT TOUCH
```

### Desired Codebase tree with files to be added

```bash
src/
└── regression-replay-fidelity.test.ts       # NEW — the BUG-001 e2e regression pin (only file added)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: auto-submit fires SYNCHRONOUSLY inside writeInEnter's committing
//   ENTER (transition-gated completeness) — NO fake timers needed; assert
//   sendMessage was called EXACTLY once right after the gesture.
// GOTCHA: answering q1 (while q2 is still open) must NOT deliver — insert
//   expect(h.sendMessage).not.toHaveBeenCalled() after q1's elaboration
//   commit to pin the transition gate (AUTOSUBMIT-001).
// GOTCHA: currentId SETTER re-seeds cursorIndex to the recorded answer's
//   display row (ANSWER-PIN-001) — always set cursorIndex EXPLICITLY after
//   assigning currentId (q1 accept: row of "alpha" = 0; q2 write-in:
//   options.length = the ✎ Other row).
// GOTCHA (SIDECHAT-001): editorFactory builds TWO editors (answer + chat);
//   set the answer buffer via panel.textField.setText(text) — the typed,
//   proven seam (actions.test.ts commitWriteIn).
// GOTCHA: reconstructFromBranch sets GLOBAL state — call resetState() BEFORE
//   it (after capturing base + delivered message) so the post-replay asserts
//   prove reconstruction, not leftover walkthrough state.
// GOTCHA: makeCtx's ui.custom must return a NEVER-resolving promise
//   (vi.fn(() => new Promise<null>(() => {}))) — reconstruct opens only the
//   keyed suspend widget (SURFACE-002); ui.setWidget must be a vi.fn present.
// GOTCHA: beforeEach must run setFallbackActive(false) + makeHost() +
//   resetState() (reconstruct.test.ts order) — makeHost() resets panel.ts's
//   module-scoped host record; setFallbackActive prevents the fallback path
//   from synthesizing state that masks a reconstruction failure.
// GOTCHA: submissionEntry's fixture adds `card` if absent — pass the REAL
//   captured details through (it already carries changed/epoch/card); do not
//   reconstruct or trim them. details.changed ships UNTRUNCATED by contract.
// GOTCHA: q2's wire `to` is the display summary ("✎ Neither — …"), but the
//   REPLAYED value must be the RAW write-in text via entry.value (value-first
//   resolution, BUG-007) — assert against the raw text, never the label.
// GOTCHA: eslint covers src/ and *.ts at root — the new file must lint clean
//   (no `any`; use `as unknown as SessionEntry` for fixture entries exactly
//   like reconstruct.test.ts does).
```

## Implementation Blueprint

### Data models and structure

No new models — the test exercises existing ones. Shapes it must know:

```ts
// tool result envelope (tool.ts inlineEnvelope :177-178) — upsert.details:
{ state: SerializedState; epoch: number; statusLine: string; action: "upsert" }

// SubmissionMessage (delivery.ts :66-85) — the captured delivery:
{ customType: "interrogation-submission"; content: string; display: true;
  details: { changed: DiffEntry[]; note?: string; epoch: number; card: … } }
// DiffEntry (post-S2): { id; title; prompt?; from; to; editedArchived;
//   value?: string; text?: string; custom?: boolean }

// reconstructFromBranch result (reconstruct.ts :214-216):
{ source: "tool-result" | "mirror-entry" | "none"; replayed: number;
  opened: boolean; fallbackActive: boolean; state?: … }

// Answer (state.ts): { value: string; text?: string; custom?: boolean; at: string }
```

### Implementation Tasks (dependency-ordered)

```yaml
Task 0: PRECONDITION CHECK (siblings landed)
  - src/snapshots.ts DiffEntry declares text?:string / custom?:boolean (S2, merged)
  - src/panel/actions.ts submit seam reads q.answer?.text / q.answer?.custom (S3)
  - src/reconstruct.ts replaySubmission has the two conditional spreads (S4)
  If any is absent, STOP — the e2e will fail for the wrong reason.

Task 1: CREATE src/regression-replay-fidelity.test.ts — scaffolding
  - Header comment (BUG-001, missed-flush window: 2s STATE_MIRROR_DEBOUNCE_MS
    (persistence.ts:62), hard kill/SSH drop/SIGKILL before session_shutdown's
    synchronous flush or appendEntry failure; pins FR-27/TRUST-001/
    WRITEIN-001/ANSWER-PIN-001/FR-5; PRD h2.2/h3.0 Recommendation 1 item 4).
  - Imports (copy the union from the two source files):
      vitest { beforeEach, describe, expect, test, vi, type Mock }
      type { SessionEntry } from "@earendil-works/pi-coding-agent"
      type { Theme } from "@earendil-works/pi-coding-agent"; type { TUI } from "@earendil-works/pi-tui"
      { DEFAULT_CONFIG } from "./config.js"; { DraftStore } from "./draft-store.js"
      { createPanelHost, InterrogationPanel, type InterrogationPanelArgs, type PanelHost } from "./panel/panel.js"
      { setFallbackActive } from "./fallback.js"
      { reconstructFromBranch, type ReconstructionContext, type ReconstructionOptions } from "./reconstruct.js"
      { getState, resetState, type Question } from "./state.js"
      { executeInterrogate, type ExecutorContext } from "./tool.js"
  - Copy helpers: stubTheme + fakeEditor + makePiHarness (phantom file :44-76);
    toolResultEntry/submissionEntry/makeCtx/makeHost/makeOpts (reconstruct.test.ts
    :73-88/:115-136/:175-203, with text?/custom? in submissionEntry's inline type).
  - beforeEach: setFallbackActive(false); makeHost(); resetState();

Task 2: THE E2E TEST — "delivered submission reconstructs with full answer shape"
  Full skeleton (adapt identifiers freely; keep every assert):

  const ENTER = "\r";
  const ELABORATION = "alpha fits the migration plan";
  const WRITE_IN = "Neither — we use a custom vector store";

  function choiceQ(id: string): Question {
    return { id, prompt: `p:${id}`, type: "choice", rev: 1, status: "open",
      options: [{ value: "alpha", label: "Alpha" }, { value: "beta", label: "Beta" }] };
  }

  test("elaboration + write-in survive restart replay (BUG-001 missed-flush window)", () => {
    const h = makePiHarness();

    // (a) REAL tool path — upsert two choice questions; the tool result's
    // details.state is the reconstruction base candidate.
    const upsert = executeInterrogate(
      { goal: "Replay fidelity regression", epoch: 1, questions: [choiceQ("q1"), choiceQ("q2")] },
      { mode: "tui", hasUI: true } satisfies ExecutorContext,
      DEFAULT_CONFIG,
    );
    const baseDetails = upsert.details; // { state, epoch: 1, statusLine, action: "upsert" }

    // REAL panel over the live state.
    const panel = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state: getState()!,
      config: DEFAULT_CONFIG,
      drafts: new DraftStore(),
      editorFactory: () => fakeEditor(),
      delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => {} },
    } as unknown as InterrogationPanelArgs);

    // (b1) q1 = option "alpha" …
    panel.currentId = "q1";
    panel.cursorIndex = 0; // row of "alpha"
    expect(panel.handleInput(ENTER)).toBe(true); // acceptOptionIndex commits {value:"alpha"}
    expect(h.sendMessage).not.toHaveBeenCalled(); // transition gate: q2 open → NO delivery

    // (b2) … with a committed elaboration (FR-18 draft path → commitTextDraft).
    panel.currentId = "q1"; // re-seeds cursor to the recorded answer's row
    panel.focusTextField("elaboration");
    panel.textField.setText(ELABORATION);
    expect(panel.handleInput(ENTER)).toBe(true); // stageText → commitTextDraft
    expect(panel.draftTextFor("q1")).toBe(ELABORATION); // slot staged
    expect(h.sendMessage).not.toHaveBeenCalled(); // still gated

    // (b3) q2 = ✎ Other write-in; the LAST open transition fires
    // maybeAutoSubmit SYNCHRONOUSLY → the auto path's submit() attaches q1's
    // staged elaboration and delivers ONE interrogation-submission.
    panel.currentId = "q2";
    panel.cursorIndex = getState()!.getQuestion("q2")!.options!.length; // ✎ Other row
    expect(panel.handleInput(ENTER)).toBe(true); // → write-in duty, editor focused
    panel.textField.setText(WRITE_IN);
    expect(panel.handleInput(ENTER)).toBe(true); // writeInEnter commits {value, custom:true}

    expect(h.sendMessage).toHaveBeenCalledTimes(1); // the auto-submit — nothing else ever
    const delivered = h.sendMessage.mock.calls[0]![0] as {
      customType: string;
      details: { changed: Array<{ id: string; value?: string; text?: string; custom?: boolean; to: string }>; epoch: number };
    };
    expect(delivered.customType).toBe("interrogation-submission");

    // WIRE shape — pins producers (S2 carrier + S3 submit seam).
    const q1Entry = delivered.details.changed.find((e) => e.id === "q1")!;
    expect(q1Entry.value).toBe("alpha");
    expect(q1Entry.text).toBe(ELABORATION);           // elaboration ON the delta
    expect(q1Entry.custom).toBeUndefined();           // real-option answers stay non-custom
    const q2Entry = delivered.details.changed.find((e) => e.id === "q2")!;
    expect(q2Entry.value).toBe(WRITE_IN);             // RAW write-in text (value-first source)
    expect(q2Entry.custom).toBe(true);                // WRITEIN-001 marker ON the delta

    // LIVE pre-kill state sanity — proves any later loss is a REPLAY property.
    expect(getState()!.getQuestion("q1")!.answer!.text).toBe(ELABORATION);
    expect(getState()!.getQuestion("q2")!.answer!.custom).toBe(true);

    // (c) The hard kill: process dies inside the 2s mirror debounce — NO
    // interrogation-state entry ever lands; session_shutdown never flushes.
    // Branch = tool-result base + the delivered submission, NOTHING else.
    resetState(); // the live state is gone
    const entries: SessionEntry[] = [
      toolResultEntry(baseDetails),      // real tool-result envelope in details
      submissionEntry(delivered.details), // real captured details (changed/epoch/card)
    ];

    // (d) Restart: reconstruct and assert the FULL answer shape.
    const result = reconstructFromBranch(makeCtx(entries), makeOpts(makeHost()));
    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(1);

    const state = getState()!;
    expect(state.epoch).toBe(2); // base 1 + the one replayed submission's bump

    const q1 = state.getQuestion("q1")!;
    expect(q1.answer?.value).toBe("alpha");
    expect(q1.answer?.text).toBe(ELABORATION);        // BUG-001 — was silently dropped
    expect("custom" in q1.answer!).toBe(false);
    expect(typeof q1.answer?.at).toBe("string");      // fresh — `at` never carried

    const q2 = state.getQuestion("q2")!;
    expect(q2.answer?.value).toBe(WRITE_IN);          // value-first: RAW text, not the "✎ …" label
    expect(q2.answer?.custom).toBe(true);             // BUG-001 — was silently dropped
    expect("text" in q2.answer!).toBe(false);         // write-ins never duplicate into text
  });

Task 3: RUN the gates (Validation Loop) — fix the TEST (never the source) on failure
```

### Implementation Patterns & Key Details

```ts
// makeCtx — copy from reconstruct.test.ts:175-193 EXACTLY:
function makeCtx(entries: SessionEntry[]): ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } } {
  const custom = vi.fn(() => new Promise<null>(() => {})); // NEVER resolves (SURFACE-002)
  const setWidget = vi.fn();
  return { mode: "tui", hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { custom, setWidget } } as unknown as ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } };
}
// makeHost/makeOpts — copy from reconstruct.test.ts:193-203:
function makeHost(): PanelHost { return createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} }); }
function makeOpts(host: PanelHost, drafts?: DraftStore): ReconstructionOptions {
  return { config: DEFAULT_CONFIG, host, drafts };
}

// toolResultEntry — the fixture's details is `{ state }`; passing the FULL
// real envelope (`{ state, epoch, statusLine, action }`) is a faithful
// superset: reconstruction reads only details.state for tool-result candidates.
// submissionEntry passes captured details through verbatim — its fixture only
// adds `card` when absent; the real details already carries one.

// FAILURE LOCALIZATION (why both wire and post-replay asserts exist):
//   wire assert fails → a PRODUCER regressed (S2 carrier / S3 submit seam);
//   wire passes but post-replay fails → the CONSUMER regressed (S4 spreads);
//   live-state assert fails → the walkthrough itself broke (panel seams).
```

### Integration Points

```yaml
SOURCE FILES: "NONE — read-only e2e; the ONLY artifact is the new test file"
SIBLING OUTPUTS CONSUMED: "S2 DiffEntry text?/custom? (snapshots.ts); S3 submit-seam spreads
  (panel/actions.ts — exercised transitively by the REAL auto-submit path); S4 replaySubmission
  spreads (reconstruct.ts — exercised transitively by the REAL reconstructFromBranch)"
FEEDS: "P1.M3.T1.S1 final gate (this file joins the suite it runs); P1.M3.T2.S1 README
  restart-section sync (references the pinned behavior)"
DOCS: "none beyond the regression file's explanatory header — README handled at changeset level"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — 0 errors (fixture casts: `as unknown as SessionEntry`)
npm run lint        # eslint src scripts *.ts — 0 errors
```

### Level 2: The New Regression File

```bash
npx vitest run src/regression-replay-fidelity.test.ts -v
# Expected: 1 test green. On failure, use the three-assert layers to localize
# (wire → producers; post-replay → consumer; live-state → walkthrough) and fix
# the TEST, not the source — source regressions mean a sibling PRP was violated.
```

### Level 3: Full Suite (zero regressions)

```bash
npm test   # full suite green; this file must not perturb siblings (it mocks only
           # its own sendMessage/ctx — no module-level vi.mock anywhere)
```

### Level 4: Bites-On-Regression Check (one-time, then RESTORE)

```bash
# Prove the pin actually bites: temporarily comment ONE spread in
# src/reconstruct.ts replaySubmission (the `...(entry.custom === true ...)` line),
# run:  npx vitest run src/regression-replay-fidelity.test.ts
# Expected: FAILS on q2.answer.custom. Then REVERT the mutation immediately
# (git diff src/reconstruct.ts must be empty afterwards) and re-run Level 2 green.
```

## Final Validation Checklist

### Technical Validation

- [ ] Levels 1-3 green: `npm run typecheck`, `npm run lint`, `npm test`
- [ ] Level 4 mutation check performed and fully reverted (`git diff src/` clean except the new test file)
- [ ] `git status`: ONLY `src/regression-replay-fidelity.test.ts` added — zero modifications to any source or sibling test file

### Feature Validation

- [ ] All What-section success criteria asserted and green (wire shape, live pre-kill state, post-replay full shape, source/replayed/epoch sanity)
- [ ] Exactly ONE delivered submission across the whole walkthrough (transition gate pinned between gestures)
- [ ] Header comment names BUG-001, the 2s missed-flush window (STATE_MIRROR_DEBOUNCE_MS), and FR-27/TRUST-001/WRITEIN-001/ANSWER-PIN-001/FR-5

### Code Quality Validation

- [ ] Helpers copied locally (not imported from sibling test files — they are module-private)
- [ ] No `vi.mock` module mocks — only the delivery sendMessage and ctx seams the existing suites mock
- [ ] Fixture-entry casts use the `as unknown as SessionEntry` convention
- [ ] Assertions use exact values (RAW write-in text, not labels; key-absence via `"custom" in answer`)

### Documentation & Deployment

- [ ] No README changes (owned by P1.M3.T2.S1); the file's header IS the doc

## Anti-Patterns to Avoid

- ❌ Don't modify ANY source file — this subtask adds exactly one test file
- ❌ Don't hand-build the submission `changed` entries — the ENTIRE point is the real delivery captured off the wire (unit-style fixtures already exist in reconstruct.test.ts)
- ❌ Don't add a mirror entry or wire real persistence — the missed-flush window is modeled by omission
- ❌ Don't use fake timers or async waits — auto-submit is synchronous in the committing gesture
- ❌ Don't set the write-in buffer via the editorFactory-captured editor (SIDECHAT-001) — use `panel.textField.setText`
- ❌ Don't skip `resetState()` before reconstructFromBranch — leftover walkthrough state would mask a reconstruction failure (vacuous pass)
- ❌ Don't assert `q2.answer.value` against the `to` label — value-first resolution means the RAW write-in text
- ❌ Don't re-test S4's guards/clearance/legacy rows — S4's unit suite owns those; this file pins the happy-path chain end-to-end

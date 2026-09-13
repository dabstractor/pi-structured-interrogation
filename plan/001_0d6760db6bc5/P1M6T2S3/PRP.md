name: "P1.M6.T2.S3 — Main editor draft preservation across suspend/resume"
description: h2.35 verify-in-test obligation (h2.51 risk) — empirically confirm pi's main editor text survives custom() suspend/resume cycles, pin the guarantee in vitest with a fake ctx that emulates the verified runtime semantics, expose the belt-and-braces getEditorText/setEditorText seam, and record the finding for the README limitations section (P1.M7.T7.S1). CONCLUSION FROM RESEARCH: pi preserves natively; NO production snapshot/restore is added (it would clobber side-chat typing).
---

## Goal

**Feature Goal**: The h2.35 claim "main editor text preserved (pi's editor instance persists across custom() sessions; verify in test)" is discharged: the runtime behavior is verified from pi's installed source, pinned by a scripted vitest suite, and the finding is recorded for downstream consumption (AC-4, README limitations). The `getEditorText`/`setEditorText` belt-and-braces seam (pi-api-validation.md:43) is exposed on `PiUISurface` for S2/consumers.

**Deliverable**:
- CREATE `src/panel/editor-preservation.ts` — [Mode A] finding module: source-cited documentation, the exported `EDITOR_PRESERVATION = "native"` constant, and unused-by-design snapshot/restore helpers (`snapshotEditorText`, `restoreEditorTextIfEmpty`) as the documented fallback seam if a future pi regresses.
- CREATE `src/panel/editor-preservation.test.ts` — the scripted empirical check (fake ctx emulating the verified runtime semantics, never a live TUI session — AUTOMATION-POLICY.md).
- EDIT `src/panel/panel.ts` — add ONE optional method `getEditorText?(): string` to `PiUISurface` (after `setWidget`, mirroring S2's parallel `setEditorText?` addition; see Coordination below).
- CREATE `plan/.../research/finding.md` — already written during research (source citations from interactive-mode.js).

**Success Definition**: vitest proves, against a fake ctx implementing exactly the semantics read from `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js` `showExtensionCustom` (snapshot at open, same-instance restore at close): open panel with main editor text T → suspend (`done(null)`) → T intact; text typed while suspended survives a full second suspend/resume cycle; S2's discuss template survives the cycle too. `npx tsc --noEmit` clean; `npx vitest run` fully green.

## User Persona

**Target User**: pi TUI user who breaks out of the interrogation panel (or discuss-in-chats), types/reviews a side-chat message, then resumes — and expects their main editor draft to still be there (AC-4 "main editor draft also intact").
**Use Case**: AC-4 break-out cycle; FR-14/FR-15 suspend flows from P1.M6.T1.S1 / S2.
**User Journey**: open panel (editor held T by pi) → break out (widget appears, editor restored with T) → optionally type side-chat text / trigger discuss-in-chat preload → resume (panel returns, drafts intact) → break out again → editor holds the latest text.
**Pain Points Addressed**: silent draft loss across panel cycles; unverified PRD assumption (h2.51 risk table).

## Why

- h2.35: "main editor text preserved (pi's editor instance persists across custom() sessions; verify in test)" — this item IS that verify step.
- h2.10 AC-4: "main editor draft also intact" after the break-out/resume cycle — this item supplies that guarantee's evidence.
- h2.51 risk table + pi-api-validation.md:75 open question 3 — explicitly assigned here.
- Downstream: P1.M7.T6.S1 (scripted AC pass) cites this suite; P1.M7.T7.S1 README limitations section quotes the finding.

## What

- **Finding (research, already recorded)**: pi's `showExtensionCustom` (interactive-mode.js ~line 2157) snapshots `this.editor.getText()` when `custom()` opens and re-adds the SAME editor instance with `setText(savedText)` when `done()` fires. Chained cycles re-snapshot the live editor each open, so text typed while suspended (side chat, S2's discuss preload) survives too. **Conclusion: native preservation confirmed; add NO production snapshot/restore** — restoring a pre-suspend snapshot would clobber user text typed during the side chat (the exact hazard the item description guards against).
- **Test-fake emulation**: `editor-preservation.test.ts` builds a fake pi whose `ui.custom` implements the same snapshot/restore semantics (with comments citing the runtime source lines), then drives `openPanel` → `done(null)` → resume → `done(null)` and asserts the editor model's text at each step.
- **Belt-and-braces seam**: `PiUISurface.getEditorText?()` added (optional, `?.`-guarded at call sites, exactly like `setWidget`/`setEditorText`). `editor-preservation.ts` exports `snapshotEditorText(pi)` and `restoreEditorTextIfEmpty(pi, snapshot)` — implemented, unit-tested, and deliberately NOT called from the production suspend path; the module doc says a future pi regression flips `EDITOR_PRESERVATION` to `"manual"` and wires them at the suspend choke point.
- **Do NOT modify**: `src/panel/suspend.ts`, `src/panel/keys.ts`, `src/tool.ts`, `src/index.ts`, `src/config.ts`, S2's `src/panel/discuss.ts`(parallel).
- **[Mode A] docs**: module JSDoc quotes h2.35's preserved-text clause and records the finding + caveat; finding cross-referenced for P1.M7.T7.S1.

### Success Criteria

- [ ] Fake-ctx test: open panel with editor text T → `done(null)` suspend → editor text is still T
- [ ] Text typed into the live editor while suspended survives a subsequent resume+suspend cycle (re-snapshot semantics)
- [ ] Discuss-template interplay: text written via `setEditorText` while suspended survives resume+done(null) (protects S2's flow)
- [ ] `restoreEditorTextIfEmpty` never overwrites non-empty editor text (guard test); `snapshotEditorText` returns undefined when seam absent
- [ ] Production suspend path (`openPanel`'s `.then`/`.catch`, `suspendCurrent`) UNCHANGED — no clobbering risk introduced
- [ ] `PiUISurface.getEditorText?` added; existing test fakes (panel.test.ts `makeMockPi`) still typecheck (optional member)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green

## All Needed Context

### Context Completeness Check

Implementer gets: the verified runtime source excerpt with exact behavior, the fake-ctx test pattern to copy (`makeMockPi` in panel.test.ts), exact placement for the one-line interface addition, parallel-item coordination notes, and explicit don'ts. ✅

### Documentation & References

```yaml
- file: node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js
  why: THE empirical evidence — showExtensionCustom (~lines 2157-2210): savedText snapshot at open; restoreEditor() re-adds same this.editor + setText(savedText) at done(); also :1920-1921 (setEditorText/getEditorText impl on ctx.ui)
  pattern: emulate EXACTLY these semantics in the test fake; cite the lines in comments
  gotcha: overlay mode (options.overlay) skips restoreEditor — our openPanel never passes overlay options; keep the fake non-overlay

- file: src/panel/panel.test.ts
  why: makeMockPi (:88-193) — the established fake-ctx pattern (captured custom calls, floating promise, done()); optsFor/firstCall helpers; createPanelHost re-arm convention
  pattern: copy the mock shape into editor-preservation.test.ts, extend with an editor-model {text, setText} that custom() snapshots/restores

- file: src/panel/panel.ts
  why: PiUISurface interface :166-190 (add getEditorText? after setWidget — S2 adds setEditorText? in parallel); openPanel suspend choke points :1195-1235 (.then/.catch) — read-only reference; resumeOpenPanel :1256
  gotcha: module-scoped host record — every test must re-arm via createPanelHost(makeMockLifecycle()) first (panel.test.ts convention)

- file: plan/001_0d6760db6bc5/P1M6T2S3/research/finding.md
  why: the recorded finding (source-cited) this PRP is built on; consume verbatim in editor-preservation.ts JSDoc

- docfile: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: lines 43 (setEditorText/getEditorText confirmed) and 75 (open question 3 — discharged by this item)
  section: UI

- file: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md
  why: hard rule — verification is scripted vitest with fake ctx, NEVER a live TUI session; "observe the panel" steps are forbidden
- file: plan/001_0d6760db6bc5/P1M6T2S2/PRP.md
  why: PARALLEL sibling — adds setEditorText? to PiUISurface and discuss.ts; coordinate the two one-line interface additions (see Coordination)
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  panel.ts        # PiUISurface :166 (EDIT: + getEditorText?); suspend choke points (read-only)
  suspend.ts      # suspend/resume façade (consume, no edits)
  panel.test.ts   # makeMockPi fake-ctx pattern (copy)
editor root: package.json scripts — check via `npx tsc --noEmit` / `npx vitest run`
```

### Desired Codebase tree

```bash
src/panel/
  editor-preservation.ts        # NEW: finding JSDoc + EDITOR_PRESERVATION + snapshot/restore helpers (unused-by-design seam)
  editor-preservation.test.ts   # NEW: fake-ctx empirical suite (snapshot/restore emulation)
  panel.ts                      # EDIT: one optional PiUISurface.getEditorText? member
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: do NOT add production snapshot/restore in openPanel/.then —
// it would overwrite text the user typed during the suspended side chat.
// Native preservation is verified (interactive-mode.js); helpers stay unused.
// CRITICAL: PiUISurface members added for editor text are OPTIONAL (`?.`)
// — test fakes and RPC surfaces omit them; absent seams are silent no-ops.
// CRITICAL: panel host state is module-scoped — re-arm with
// createPanelHost(makeMockLifecycle()) in beforeEach (panel.test.ts pattern).
// CRITICAL: the fake's custom() must NOT resolve its promise until done()
// fires (blocking contract), mirroring panel.test.ts's floating-promise mock.
// GOTCHA: pi's showExtensionCustom skips restore in overlay mode; our fake
// models only the non-overlay path openPanel actually uses.
// GOTCHA: microtask ordering — openPanel's .then runs on promise resolution;
// assertions about the restored editor text must run after awaiting the
// captured custom() promise (use the CustomCall.promise helper).
```

## Implementation Blueprint

### Data / API surface

```ts
// src/panel/editor-preservation.ts
/** [Mode A] Finding (h2.35 verify-in-test): pi's InteractiveMode
 *  showExtensionCustom snapshots editor text at custom()-open and restores
 *  the SAME editor instance (setText(savedText)) at done() — cited:
 *  interactive-mode.js showExtensionCustom. Chained cycles re-snapshot the
 *  live editor, so side-chat typing and the S2 discuss preload survive too.
 *  Fallback if a pi regression drops this: flip to "manual" and call
 *  snapshotEditorText/restoreEditorTextIfEmpty at panel.ts's suspend choke
 *  points. Recorded for README limitations (P1.M7.T7.S1) + AC-4. */
export const EDITOR_PRESERVATION = "native" as const;

export function snapshotEditorText(pi: PiUISurface): string | undefined;
// pi.ui.getEditorText?.() — undefined when the seam is absent.

export function restoreEditorTextIfEmpty(pi: PiUISurface, snapshot: string | undefined): boolean;
// Belt-and-braces ONLY (never called in production today): setEditorText
// iff the current text is empty/whitespace AND the seam exists. Returns
// whether a restore happened. Guard rule per item contract: never clobber.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/panel.ts — PiUISurface
  - ADD after setWidget member (~line 190): `getEditorText?(): string;` with
    JSDoc mirroring setWidget's style (optional; test fakes/RPC omit it;
    every call site guards with `?.`)
  - COORDINATION: sibling S2 adds `setEditorText?(text: string): void` at the
    same spot in parallel — both are one-line optional members; if S2 lands
    first, add yours adjacent, never reformat theirs
  - PRESERVE: no behavior change anywhere in panel.ts

Task 2: CREATE src/panel/editor-preservation.ts
  - IMPLEMENT: EDITOR_PRESERVATION const, snapshotEditorText,
    restoreEditorTextIfEmpty (signatures above)
  - [Mode A] JSDoc: quote h2.35 clause, cite interactive-mode.js lines,
    state the deliberate not-called-in-production decision and the
    regression fallback (flip to "manual", wire at openPanel .then/.catch)
  - IMPORT PiUISurface type-only from ./panel.js (mirrors suspend.ts)
  - NO imports from keys.ts / discuss.ts; no pi runtime imports

Task 3: CREATE src/panel/editor-preservation.test.ts
  - COPY the fake-ctx skeleton from panel.test.ts makeMockPi (:88-193):
    captured CustomCall records, floating promise resolved only by done()
  - EXTEND the fake with an editor model: `editor = { text: "" }` and a
    `custom` that, per call, snapshots `editor.text` on entry and on
    done() executes the non-overlay restore semantics
    (`editor.text = savedText`) — cite interactive-mode.js lines in comments
    (this emulation IS the scripted empirical check)
  - FIXTURES: real InterrogationState seeded like panel.test.ts choiceQ
    (state.test.ts raw primitives), DEFAULT_CONFIG, optsFor-style helper
    (drafts optional); re-arm host via createPanelHost(makeMockLifecycle())
    in beforeEach
  - TESTS (all await the captured custom() promise before asserting):
    1. open panel with editor.text = T → call.done(null) → editor.text === T
    2. suspended: editor.text = T2 (user typed side chat) → resumeOpenPanel
       → second custom call snapshot === T2 → done(null) → editor.text === T2
    3. discuss interplay: while suspended setEditorText(TEMPLATE) (call the
       fake's seam directly or via S2-equivalent write) → resume → done(null)
       → editor.text === TEMPLATE
    4. restoreEditorTextIfEmpty: empty current + snapshot → restores, true;
       non-empty current → no write, false; missing seam → false
    5. snapshotEditorText: returns pi.ui.getEditorText?.() value; undefined
       when seam absent
    6. (test.ts fake uses PiUISurface with getEditorText/setEditorText —
       proves the optional members typecheck on a minimal surface)

Task 4: VERIFY + record
  - npx tsc --noEmit; npx vitest run (full suite — must include S1/S2 tests)
  - research/finding.md already on disk; PRP checklist below records the
    finding for P1.M7.T7.S1 consumption
```

### Implementation Patterns & Key Details

```ts
// Fake custom() restore semantics (the heart of the empirical check):
const savedText = editor.text;                 // interactive-mode.js :2158
const done = (result) => {
  // non-overlay close → restoreEditor() (:2161-2167)
  editor.text = savedText;                     // same-instance setText
  resolve(result);
};

// Belt-and-braces guard (never clobber):
export function restoreEditorTextIfEmpty(pi: PiUISurface, snapshot: string | undefined): boolean {
  const get = pi.ui.getEditorText;
  const set = pi.ui.setEditorText;
  if (get === undefined || set === undefined || snapshot === undefined) return false;
  const current = get.call(pi.ui);
  if (current !== undefined && current.trim() !== "") return false;
  set.call(pi.ui, snapshot);
  return true;
}
```

### Integration Points

```yaml
NO production integration: suspend path (panel.ts openPanel .then/.catch,
suspendCurrent) is intentionally untouched. The only touch on existing code
is the optional PiUISurface.getEditorText member.
DOWNSTREAM:
  - P1.M7.T6.S1 (AC runbook): cites editor-preservation.test.ts for AC-4
  - P1.M7.T7.S1 (README limitations): quote EDITOR_PRESERVATION JSDoc/finding
  - MANUAL-TUI-AC-RUNBOOK.md: human AC-4 pass double-checks live behavior
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit        # zero errors
npx vitest run src/panel/editor-preservation.test.ts   # targeted
```

### Level 2: Unit / Component

```bash
npx vitest run          # FULL suite green — especially panel.test.ts,
                        # suspend-related suites, tool.test.ts (S1 reopen)
```

### Level 3: Integration (scripted only — AUTOMATION-POLICY.md)

No live TUI, no live `interrogate` calls. The fake-ctx suite in Task 3 IS
the integration check (it drives openPanel/resumeOpenPanel/done(null) end to
end against the emulated runtime semantics). Optional source sanity re-check:

```bash
grep -n "savedText" node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js
# expect the snapshot + restoreEditor() block still present
```

### Level 4: Domain-specific

n/a — behavior guarantee covered by the scripted suite; live confirmation
deferred to the human TUI runbook (AC-4), per AUTOMATION-POLICY.md.

## Final Validation Checklist

### Technical
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` fully green (no regressions in S1/S2 suites)
- [ ] Production suspend path untouched (diff shows only the interface member + 2 new files)

### Feature
- [ ] All 6 test scenarios in Task 3 pass
- [ ] Success criteria from "What" all met
- [ ] Finding recorded (research/finding.md) + [Mode A] JSDoc with h2.35 quote and source citation
- [ ] AC-4 evidence chain established (this suite → P1.M7.T6.S1)

### Code Quality
- [ ] Optional seams guarded with `?.`; no runtime imports of pi internals
- [ ] Follows panel.test.ts fake-ctx conventions; tests re-arm the host record
- [ ] No dead-code creep: helpers are exported + tested, non-use is a documented decision

### Documentation
- [ ] Finding available for P1.M7.T7.S1 README limitations section
- [ ] h2.51 / pi-api-validation.md open question 3 discharged

---

## Anti-Patterns to Avoid

- ❌ Don't add production snapshot/restore "for safety" — it clobbers side-chat typing (verified native preservation makes it wrong, not just redundant)
- ❌ Don't run a live pi TUI session or call interrogate for real (AUTOMATION-POLICY.md hard rule)
- ❌ Don't make PiUISurface editor members required — test fakes/RPC break
- ❌ Don't touch S2's discuss.ts or keys.ts while S2 is in flight
- ❌ Don't assert editor text before the captured custom() promise resolves (microtask ordering)

**Confidence Score: 9/10** — the runtime behavior is verified from source, the test pattern exists to copy, and the code delta is tiny; residual risk is only interface-merge friction with parallel S2 (mitigated by the coordination note).

---
name: "P2.M1.T3.S1 — recordRemoteSubmission tail hook + customText-only → custom:true + validation acceptance"
description: "Wire maybeAutoSubmit (from P2.M1.T1.S1) at the tail of the bridge submit pipeline (after step-9 noteSubmissionDelivered AND after the nothing_shippable return), injected via RemoteSubmitDeps/RemoteBridgeOptions and wired from index.ts (panelHost.getPanel() late-binding closure). Map customText-only choice answers to { value: <customText>, custom: true } (WRITEIN-001 bridge/panel parity); text answers carry custom:true like the panel; custom values are NEVER validated against option lists (D-R4 acceptance). Mode A JSDoc on remote-submit.ts."
---

## Goal

**Feature Goal**: AUTOSUBMIT-001 bridge parity (PRD h2.33 "One shared hook", h2.30 "runs `maybeAutoSubmit` at its tail", FR-32, D-R6) + WRITEIN-001 bridge/panel parity (h2.30 Bridge submit mapping, h2.42): a bridge submission that completes the set alongside panel-pending answers ships once through the same pipeline; a `customText`-only bridge submission on a choice question produces the IDENTICAL answer object as the panel's Other-row write-in (`{ value: <text>, custom: true }`).

**Deliverable**:
1. `RemoteSubmitDeps` gains `maybeAutoSubmit?: () => void`; `recordRemoteSubmission` invokes it at TWO tails: after step-9 `noteSubmissionDelivered` (success path) and after the `nothing_shippable` return's conditional `noteSubmissionDelivered` — always AFTER the lifecycle call (h2.44 line-1 ordering).
2. `RemoteBridgeOptions` gains `maybeAutoSubmit?: () => void`, passed through to `recordRemoteSubmission` deps at remote-bridge.ts:343.
3. index.ts wires the hook: late-binding closure over `panelHost.getPanel()` → `maybeAutoSubmit(panel)` (import from `./panel/actions.js`).
4. `RemoteAnswerInput` gains `custom?: boolean`; `recordRemoteSubmission`'s `applyAnswer` spreads it; `mapWireAnswers` sets it per the mapping matrix below.
5. Mode A JSDoc on `recordRemoteSubmission`: tail-hook + WRITEIN-001 parity note.
6. Tests in `src/remote-submit.test.ts` and `src/remote-bridge.test.ts`.

**Success Definition**: `npm run typecheck` + full `npx vitest run` green. New tests prove: (a) a successful bridge submission calls the injected hook exactly once and does NOT double-ship (`sendMessage` count stays at the bridge submission's single call — the flushed pending set makes `maybeAutoSubmit` no-op); (b) the hook also fires on the `nothing_shippable` return; (c) a customText-only choice submission yields `state.getQuestion(id).answer === { value: <customText>, custom: true, at: ... }` — byte-identical to a panel Other-row write-in; (d) a custom value that is NOT in the option list is accepted as-is (never dropped); (e) bridge text answers carry `custom: true` (panel parity, h2.42); (f) `customText` alongside a valid picked value still maps to `answer.text` only (no custom flag).

## User Persona

**Target User**: A user answering an interrogation from their phone (bridge client) while the desktop panel holds earlier answers.

**Use Case**: The user write-ins a free-form answer on the phone; it must reach the model as the exact same `custom: true` answer the desktop panel would have produced, and when that submission completes the question set, everything pending ships once.

**User Journey**: phone submits the last remaining answers → the bridge pipeline ships them → tail `maybeAutoSubmit` runs → set complete + zero pending → no-op (no duplicate submission) — OR set complete with panel-pending answers that were NOT flushed (e.g. answered after the bridge snapshot) → one auto-submit through the panel pipeline.

**Pain Points Addressed**: phone/desktop answer divergence (same input, different `answer` shape); double submissions / missed submissions at completeness from the bridge surface.

## Why

- PRD h2.33 ("One shared hook... runs at the tail of bridge submissions (remote-submit.ts) — a bridge partial submit that completes the set alongside panel-pending answers ships once, through the same pipeline"), h2.30 (Bridge submit mapping — "customText-only submission IS the write-in path and maps to `answer.custom: true` exactly like the panel's Other row (WRITEIN-001 parity)"), h2.42 (custom marker; "the bridge's answer validation accepts custom values as-is"), h2.33 (custom values never checked against option lists), h3.14, h2.60 D-R5/D-R6, h2.10 AC-2a/2c bridge-side.
- Consumes: `maybeAutoSubmit(panel, deps?)` exported from `src/panel/actions.ts:593` (P2.M1.T1.S1 — implemented); `answer.custom` marker in state/diff/render surfaces (P1.M1.T1.S1/P1.M1.T2.* — implemented); gate hold inside `maybeAutoSubmit` (P2.M1.T2.S1 — landing in parallel; the bridge tail inherits it automatically, NO gate logic here).

## What

### Behavior contract

1. **Tail hook injection (remote-submit.ts)** — `recordRemoteSubmission` has NO panel access (pure-data discipline, module header). Extend:
   ```ts
   export interface RemoteSubmitDeps {
     lifecycle?: Pick<Lifecycle, "noteSubmissionDelivered">;
     isIdle?: () => boolean;
     /** P2.M1.T3.S1 — AUTOSUBMIT-001 bridge tail. Invoked AFTER
      * noteSubmissionDelivered on BOTH exit paths (success + nothing_shippable).
      * Injected from index.ts (panel singletons live there); absent → no-op. */
     maybeAutoSubmit?: () => void;
   }
   ```
   Call sites (both AFTER the lifecycle call, preserving h2.44 line-1 ordering):
   - Success tail: after `deps.lifecycle?.noteSubmissionDelivered();` (step 9, before `return { ok: true, msg };`) add `deps.maybeAutoSubmit?.();`.
   - `nothing_shippable` tail: inside the early-return block, after `if (pendingIds.length > 0) deps.lifecycle?.noteSubmissionDelivered();` add `deps.maybeAutoSubmit?.();` before the `return`.
   Do NOT change any other pipeline step. The common case no-ops: step 5 `markSubmitted` already flushed every `answered` → `submitted`, so `maybeAutoSubmit` finds zero pending and returns silently (that IS the "ships once" guarantee — one bridge submission, no duplicate from the hook).

2. **customText parity mapping (remote-bridge.ts `mapWireAnswers`, :365-400)** — `RemoteAnswerInput` gains `custom?: boolean`; mapping matrix:

   | wire input | question type | mapped answer |
   |---|---|---|
   | `values[0]` valid option | choice | `{ id, value: values[0] }` — validated against CURRENT options (D-R4, unchanged) |
   | `values[0]` + `customText` (valid option) | choice | `{ id, value: values[0], text: customText }` — elaboration, NO custom flag (unchanged, :395-397) |
   | `customText` only (values empty/absent) | choice | `{ id, value: customText, custom: true }` — **the write-in path** (NEW) |
   | any value | text | `{ id, value: customText ?? values[0], custom: true }` — panel parity: `writeInEnter`/`reconcileDraftsForSubmit` commit text answers with `custom: true` (actions.ts:305, :410; h2.42) |

   `note` / `optionNotes` stay dropped (unchanged). Edit the `else` branch of the choice validation (:386-388) to add `custom: true` to the constructed `RemoteAnswerInput`, and add `custom: true` to the text-question answer. Update the mapWireAnswers JSDoc (:357-364).

3. **applyAnswer passthrough (remote-submit.ts :~99)** — spread `custom` like `text`:
   ```ts
   state.applyAnswer(answer.id, {
     value: answer.value, at,
     ...(answer.text !== undefined ? { text: answer.text } : {}),
     ...(answer.custom ? { custom: true } : {}),
   });
   ```
   `state.applyAnswer` already persists `custom` with a strict `=== true` guard (state.ts:558).

4. **Validation acceptance** — custom values are recorded AS-IS, never checked against option lists (already true for freeform; h2.42: "the bridge's answer validation accepts custom values as-is"). No code change beyond the flag — lock it with an explicit test. `values[0]` on choice questions still validates against CURRENT option values (D-R4 unchanged — invalid picks still drop).

5. **index.ts wiring (:98)**:
   ```ts
   const remoteBridge = createRemoteBridge(pi, {
     config, lifecycle,
     maybeAutoSubmit: () => {
       const panel = panelHost.getPanel(); // late-binding: panelHost assigned below
       if (panel !== undefined) maybeAutoSubmit(panel);
     },
   });
   ```
   `panelHost` is declared ~:146 (AFTER the bridge) — the arrow closure evaluates it at CALL time, the same late-binding pattern as `onCompleted: () => remoteBridge.completeAll()` (:87). Import `maybeAutoSubmit` from `"./panel/actions.js"`. When the panel is closed/suspended, `getPanel()` returns undefined → no-op (safe). `maybeAutoSubmit` also no-ops without `panel.delivery` (P2.M1.T1.S1 contract) — double-safe.

6. **Bridge-side invariants preserved**: submissions still trigger exactly ONE model reply, bump epoch once (inside `buildSubmission` — never from the hook), fire `noteSubmissionDelivered`, `emitSubmitResult(true)` + `completeFlow` + resurface unchanged (remote-bridge.ts:343-352).

## Success Criteria

- [ ] Hook invoked once on BOTH exit paths, always after `noteSubmissionDelivered`.
- [ ] Successful bridge submission → exactly ONE `sendMessage` total (hook no-ops; no double-ship).
- [ ] customText-only choice answer byte-identical to panel write-in: `{ value, custom: true, at }`.
- [ ] Custom value not in option list accepted; invalid non-custom `values[0]` still dropped.
- [ ] Bridge text answers carry `custom: true`.
- [ ] Valid `values[0]` + customText still maps to `text` elaboration without custom flag.
- [ ] Full suite green; P2.M1.T2.S1's gate-hold logic untouched (it lives inside `maybeAutoSubmit`).

## All Needed Context

### Context Completeness Check

Validated: all seams identified with exact line anchors, both test harnesses exist, the consumed `maybeAutoSubmit` signature and no-op contracts are quoted from the implemented P2.M1.T1.S1 code.

### Documentation & References

```yaml
- file: src/remote-submit.ts
  why: the function under modification — 9-step ordering contract in the module header; RemoteSubmitDeps (:68), RemoteAnswerInput (:60), applyAnswer loop (:97-101), step-9 tail (:~131), nothing_shippable tail (:~121)
  pattern: deps are narrow Pick<> injections; pure-data discipline — NO panel imports here
  gotcha: never reorder pipeline steps; buildSubmission alone snapshots + bumps epoch

- file: src/remote-bridge.ts
  why: mapWireAnswers (:365-400) mapping matrix; recordRemoteSubmission call site (:343); RemoteBridgeOptions (:200-206)
  pattern: parseWireAnswer (:172-183) already extracts customText; JSDoc on mapWireAnswers (:357-364) needs the custom-flag update
  gotcha: `custom` local var (:378) treats "" as absent — keep that; freeform-on-choice branch (:386-388) is the write-in seam

- file: src/index.ts
  why: wiring site (:98) — createRemoteBridge before panelHost (:~146); late-binding closure precedent (:87 onCompleted)
  pattern: pass maybeAutoSubmit closure that resolves panelHost.getPanel() at call time

- file: src/panel/panel.ts
  why: PanelHost.getPanel(): InterrogationPanel | undefined (:137+) — the sanctioned live-panel accessor

- file: src/panel/actions.ts
  why: CONSUMED export maybeAutoSubmit(panel, deps?) (:593); panel-parity custom commits — writeInEnter (:305 custom: true), reconcileDraftsForSubmit text branch (:406-412 custom: true)
  gotcha: DO NOT modify actions.ts in this item; P2.M1.T2.S1 edits it in parallel — expect line drift, anchor by name

- file: src/state.ts
  why: applyAnswer persists custom with strict === true guard (:558); text-answer custom:true comment (:52)

- file: src/remote-submit.test.ts, src/remote-bridge.test.ts
  why: existing harnesses — fixtures, fake pi sendMessage, seeded state; follow their describe/test naming style
  gotcha: remote-bridge tests drive the full event path (emit submit → recordRemoteSubmission); remote-submit tests call it directly with hand-built deps — use the direct harness for the tail-hook spy tests

- prd: h2.33 (shared hook, tail contract), h2.30 (bridge submit mapping — customText-only = write-in), h2.42 (custom marker, as-is validation), h3.14 (bridge submit flow), h2.60 D-R5/D-R6, h2.10 AC-2a/2c
```

### Current Codebase tree (relevant slice)

```bash
src/
  remote-submit.ts       # MODIFY — deps field, custom spread, 2 tail calls, JSDoc
  remote-bridge.ts       # MODIFY — mapWireAnswers custom flags + JSDoc, RemoteBridgeOptions passthrough
  index.ts               # MODIFY — wire maybeAutoSubmit closure (+1 import)
  remote-submit.test.ts  # MODIFY — tail-hook + custom passthrough tests
  remote-bridge.test.ts  # MODIFY — WRITEIN parity mapping tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the tail hook MUST run AFTER noteSubmissionDelivered on both
// paths — the h2.44 line-1 contract fires first, always.
// CRITICAL: no double-ship — markSubmitted (step 5) flushes ALL answered →
// submitted BEFORE either tail, so the hook's zero-pending no-op is the
// correctness mechanism, not an accident. Never re-add pending capture here.
// GOTCHA: panelHost is created AFTER createRemoteBridge in index.ts — the
// closure must not destructure it eagerly (follow the :87 onCompleted pattern).
// GOTCHA: maybeAutoSubmit(panel) with no deps falls back to panel.delivery;
// when getPanel() is undefined (closed/suspended) skip entirely.
// GOTCHA: "" customText is absent customText (:378) — an "empty write-in"
// still drops (value === "" check at :389).
// GOTCHA: epoch bumps ONLY inside buildSubmission (delivery.ts) — the hook
// calls panel submit() which routes through it; never bump from the bridge.
// GOTCHA: P2.M1.T2.S1 lands gate-hold INSIDE maybeAutoSubmit in parallel —
// bridge tail inherits it; do not gate-check in bridge code.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/remote-submit.ts
  - ADD `custom?: boolean` to RemoteAnswerInput (with JSDoc: "WRITEIN-001 — customText-only write-in, never validated against option lists")
  - ADD `maybeAutoSubmit?: () => void` to RemoteSubmitDeps (JSDoc per contract §1)
  - SPREAD custom in the applyAnswer call (verbatim snippet in contract §3)
  - ADD `deps.maybeAutoSubmit?.();` at BOTH tails (contract §1)
  - UPDATE module-header ordering contract: note the step-9 tail + nothing_shippable tail both run the hook (Mode A doc)

Task 2: MODIFY src/remote-bridge.ts — mapWireAnswers
  - choice + customText-only: `{ id, value: custom, custom: true }`
  - text: `{ id, value: custom ?? wire.values?.[0], custom: true }`
  - UPDATE mapWireAnswers JSDoc (:357-364) with the new matrix
  - UPDATE RemoteBridgeOptions with `maybeAutoSubmit?: () => void`; pass through at the recordRemoteSubmission call (:343)

Task 3: MODIFY src/index.ts
  - IMPORT maybeAutoSubmit from "./panel/actions.js"
  - ADD the late-binding closure to createRemoteBridge opts (contract §5)

Task 4: MODIFY src/remote-submit.test.ts — new describe("recordRemoteSubmission — tail hook + custom parity")
  - hook fires once on success path (vi.fn() deps.maybeAutoSubmit; assert called after lifecycle noteSubmissionDelivered — order via invocationCallOrder)
  - hook fires on nothing_shippable path (identical re-selection scenario)
  - no double-ship: successful submission with seeded pending → sendMessage exactly 1, epoch +1 once
  - custom passthrough: input {id, value:"my own text", custom:true} → state answer {value, custom:true, at}
  - empty customText-only still drops (value "" guard)

Task 5: MODIFY src/remote-bridge.test.ts — new describe("mapWireAnswers — WRITEIN-001 parity")
  - customText-only on choice → answer.custom === true, value === customText, rendered ✎ path downstream (assert state answer object)
  - custom value NOT in option list accepted (never dropped)
  - invalid values[0] without customText still dropped (D-R4 unchanged)
  - valid values[0] + customText → text elaboration, custom undefined
  - text question via values[0] AND via customText → value correct, custom === true
  - note/optionNotes still dropped

Task 6: VALIDATE — npm run typecheck; npx vitest run src/remote-submit.test.ts src/remote-bridge.test.ts -v; full npx vitest run
```

### Integration Points

```yaml
NONE new (no schema/config/state changes):
  - the hook seam is the optional deps field — absent in existing callers = no-op, all current tests stay green
  - downstream: AC-2a/2c bridge-side assertions (P4.M1.T1.S1 sweep) may consume these paths
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/remote-submit.test.ts -v
npx vitest run src/remote-bridge.test.ts -v
npx vitest run   # full suite — remote-compat / fallback / panel suites must stay green
```

### Level 3: Behavioral spot-checks (headless)

```bash
npx vitest run src/remote-submit.test.ts -t "tail hook" -v
grep -n "maybeAutoSubmit?.()" src/remote-submit.ts   # exactly 2 call sites
grep -n "custom: true" src/remote-bridge.ts          # write-in + text branches
grep -n "maybeAutoSubmit" src/index.ts               # 1 import + 1 closure wiring
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] Hook runs at exactly 2 tails, always after `noteSubmissionDelivered`; absent deps → zero behavior change.
- [ ] Successful bridge submission: exactly one `sendMessage`, one epoch bump — no double-ship.
- [ ] customText-only choice → `{ value, custom: true }` byte-identical to panel write-in (compare test fixtures).
- [ ] Custom values accepted as-is; invalid `values[0]` still dropped against CURRENT options.
- [ ] Bridge text answers carry `custom: true`; elaboration mapping unchanged; note/optionNotes still dropped.
- [ ] Mode A JSDoc updated (module header ordering contract + mapWireAnswers matrix).
- [ ] No edits to src/panel/actions.ts, no gate logic, no epoch/snapshot calls outside buildSubmission.

## Anti-Patterns to Avoid

- ❌ Don't import panel code into remote-submit.ts — the hook is injected, not reached.
- ❌ Don't reorder the pipeline or move markSubmitted — the zero-pending no-op after flush is load-bearing.
- ❌ Don't fire the hook before noteSubmissionDelivered.
- ❌ Don't add gate-hold logic here (P2.M1.T2.S1 owns it inside maybeAutoSubmit).
- ❌ Don't validate custom values against option lists, and don't start validating values[0] against STALE options (CURRENT only, D-R4).
- ❌ Don't set custom:true on the elaboration path (valid option + customText → text only).

---

**Confidence Score**: 9/10 — both tails identified with exact anchors, the no-double-ship mechanism (markSubmitted flush) verified in source, panel-parity custom semantics confirmed in actions.ts:305/:410, wiring seam (PanelHost.getPanel + late-binding closure precedent) verified in index.ts:87/:98/:146, and both test harnesses exist with conventions to follow.

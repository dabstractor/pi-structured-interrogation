---
name: "P3.M2.T1.S1 — Capture-on-edit wiring: full expanded string for all five editor duties (Local input recovery)"
description: "Wire the capture seam designed in plan/006_45773b259b06/architecture/input-recovery.md (produced by P3.M1.T1.S1 — read that note FIRST; if absent, its PRP + research/findings.md are the contract). Create src/input-capture.ts: an inert capture coordinator with a pluggable sink. Wrap-and-chain the composed editor's onChange inside TextField (src/panel/text-field.ts :124-136 installs onChange only-if-undefined today — chain, never replace): every buffer mutation (keystrokes AND paste) calls capture(getExpandedText(), currentKey). Inject per-duty key context {branchId, questionId|'-', field ∈ writein|elaboration|note|sidechat-composer} at the five duty sites (panel.ts duty tracking ~:803-811; sidechat.ts:109 composer). Each write record carries {session, branch, questionId?, field, text, seq} with per-key monotonic seq (incidental empties never mint; delete-to-empty does). Pacing: 250ms trailing debounce + 1000ms max dirty age — progress during continuous typing, NEVER idle/blur/shutdown-only. Saving NEVER advances/commits/queues/submits/sends/resends/calls a model. Sink is in-memory capture + emit in THIS item; durable atomic fs persistence is P3.M2.T1.S2. Unit tests per duty: capture fires on edit and paste; string byte-exact (multiline, Unicode, edge whitespace)."
---

## Goal

**Feature Goal**: Every editor edit (including paste) in ALL five editor duties — write-in (Other), text answer, elaboration, batch note, side-chat composer — is captured as its FULL expanded string, keyed to its originating session/branch/question/field, with per-key monotonic ordering and bounded pacing, before Enter. The capture pipeline exists and is unit-tested end-to-end at the memory boundary; durability (atomic file writes) attaches in P3.M2.T1.S2.

**Deliverable**: 
1. `src/input-capture.ts` (new) — the `InputCaptureStore` coordinator: key shape, seq minting, pacing timers, pluggable sink, explicit no-side-effects contract.
2. `src/panel/text-field.ts` (modified) — the wrap-and-chain onChange capture hook + a per-instance capture-key setter.
3. Duty-site key injection in `src/panel/panel.ts` (write-in/elaboration/note duties) and `src/panel/sidechat.ts` (composer).
4. `src/input-capture.test.ts` + additions in `src/panel/text-field.test.ts` — per-duty capture tests, byte-exact string tests, paste tests, no-side-effects tests.

**Success Definition**: `npm test` green (including sidechat-cache-isolation.test.ts and editor-preservation.test.ts untouched-pass), `npm run typecheck` + `npm run lint` clean. Fake-timer tests prove: (a) capture fires for each of the five duties on plain edits; (b) paste (a single multi-line buffer mutation via setText/paste) captures the full expanded string; (c) restored/emitted text is byte-exact for multiline + Unicode + leading/trailing whitespace; (d) continuous typing produces flushes without idle (≥2 flushes inside a long typing burst under fake timers); (e) capture triggers no answer/submit/send/model call.

## User Persona

**Target User**: The interrogation user who types a long answer (or side-chat prompt), then pi crashes / the machine hibernates / the process is killed before Enter.

**Use Case**: Half-typed write-in or composer text must survive abrupt termination — core commitment 6 ("drafts are sacred") extended past graceful suspend/resume.

**User Journey**: user types/pastes into any of the five editors → every edit is captured locally within bounded time → hard-kill → (P3.M3) restart reopens the field with the exact string restored.

**Pain Points Addressed**: ask_user-style total draft loss; placeholder/preview-only capture that loses newlines/Unicode; drafts that only save on blur/suspend (which never comes before a crash).

## Why

- Binding spec: `spec/state-and-persistence.md` §Local input recovery (:133-149) — "**Capture on edit, before Enter.** Whenever the editor receives an edit (including paste), save its full expanded string locally … Restore the exact string, including newlines, Unicode and leading/trailing whitespace … Do not save a paste placeholder or display preview. Saving must progress during continuous typing; do not wait indefinitely for idle, send, blur, suspend or shutdown." Plus the "Drafts are not answers or messages" bullet (no advance/commit/queue/submit/send/resend/model call).
- SPEC.md core commitment 6: drafts are sacred; the shipped DraftStore is memory-only (Q6=B) — this delta supersedes it for input recovery.
- Architecture note `plan/006_45773b259b06/architecture/input-recovery.md` (P3.M1.T1.S1) resolves ALL mechanism decisions — captureSeams, pacing numbers, ordering/seq minting, keying, failure semantics. This PRP operationalizes its captureSeams + pacing + ordering sections verbatim; the note is the authority where this PRP and it disagree.
- Downstream: P3.M2.T1.S2 consumes the sink seam for atomic fs persistence; P3.M3.T1.* consumes the keying for restore/seeding.

## What

### Behavior

1. **The seam** (TextField, all instances): after the existing `editor.onChange` install-if-undefined at text-field.ts :124-136, capture wraps-and-chains: `const prev = editor.onChange; editor.onChange = () => { prev?.(); capture(); }` — the composed factory's callback (pi-vim's) is NEVER dropped. Capture reads the FULL expanded text via `editor.getExpandedText?.() ?? editor.getText()` — never the display preview or a paste placeholder.
2. **Key context**: each TextField instance carries a mutable `captureKey: { branchId, questionId | "-", field }` (field ∈ `"writein" | "elaboration" | "note" | "sidechat-composer"`). The panel sets it whenever the buffer's ownership changes (EXPLAIN-002 write-through switches, duty changes); sidechat sets it once at composer construction. Capture uses the key CURRENT at edit time.
3. **Write record**: `{ session, branch, questionId?, field, text, seq }` — per-key monotonic seq minted ONLY after real user input (initialization/view-change/send-cleanup seeding writes carry no seq ⇒ never captured); a deliberate deletion-to-empty IS a real edit (mints seq, captures `""`).
4. **Pacing**: on first unsaved edit, arm a 250ms trailing debounce AND a 1000ms max-dirty-age timer; whichever fires first flushes the current expanded text to the sink; re-arm per flush. Accelerator flushes (suspend, navigation write-through, send cleanup) MAY flush early but are never the sole trigger. Timers cancellable idempotently (shutdown hook in S2 wires this; the store exposes `dispose()` now).
5. **No side effects**: the capture path calls NOTHING but text reading + the sink. Forbidden targets (audit in tests): `applyAnswer`, submit pipeline (`buildSubmission`/`deliverSubmission`/`maybeAutoSubmit`), `sendMessage`/`steer`, `modelRuntime.streamSimple`, panel advance/focus change.

### Success Criteria

- [ ] All five duties capture on edit and paste with correct keys (unit test per duty).
- [ ] Byte-exact round-trip: emitted `text` equals the editor's `getExpandedText()` for multiline, Unicode (e.g. `あé…`), leading/trailing whitespace, and empty-string-after-typing.
- [ ] Continuous typing flushes repeatedly under fake timers with no idle gap (max dirty age fires).
- [ ] Incidental empty seeding does not mint seq / does not emit; delete-to-empty does.
- [ ] sidechat-cache-isolation.test.ts, editor-preservation.test.ts, text-field.test.ts (existing cases) stay green unchanged.
- [ ] `grep` audit: input-capture.ts imports nothing from state.ts applyAnswer paths, delivery.ts, sidechat-engine.ts, panel actions beyond key setters.

## All Needed Context

### Context Completeness Check

Validated: binding spec section read in full (:133-149 incl. acceptance cases 1-5; case 1/2 halves are S1's test targets, durability/cross-branch halves belong to S2/S3); sibling PRP (P3.M1.T1.S1) + its research/findings.md read — all seam anchors (text-field.ts :124-136, panel.ts :3031 + :803-811, sidechat.ts:109, getBranch :259-260); existing test harness conventions in src/panel/text-field.test.ts and sidechat-cache-isolation.test.ts.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: THE design contract (captureSeams, pacing, ordering, keying, failureSemantics sections) —
    read FIRST; if it does not exist yet, plan/006_45773b259b06/P3M1T1S1/PRP.md + research/findings.md
    carry the same resolutions
  gotcha: the note is authoritative over this PRP on mechanism details

- file: spec/state-and-persistence.md
  why: §Local input recovery :133-149 — binding requirements + acceptance cases 1-5 (READ-ONLY)
  gotcha: never edit spec/

- file: src/panel/text-field.ts
  why: THE seam. createEditorComponent (:42-98), feature-detection of getExpandedText/onChange
    (:112-136); TextField installs onChange only-if-undefined — the wrap-and-chain hook extends
    this WITHOUT removing the existing install (both must run)
  pattern: follow the module's feature-detect style (optional chaining, no assumptions about
    the composed editor); editor-preservation.test.ts constrains editor lifecycle behavior
  gotcha: getExpandedText may be ABSENT on the stock Editor — fall back to getText();
    onChange may be absent on the stock editor too — then capture chains onto nothing but
    must still be installed (stock editor benefits equally)

- file: src/panel/panel.ts
  why: editorFactory captured once per openPanel (:3031 `pi.ui.getEditorComponent?.()`);
    buffer-ownership/duty tracking comment ~:803-811 says which question/duty the TextField
    buffer holds — the captureKey setter call sites go exactly there (duty switches, question
    navigation write-throughs)
  gotcha: do NOT couple the capture store to panel internals — the panel only SETS keys on the
    TextField; the TextField pushes to the store

- file: src/panel/sidechat.ts
  why: composer construction (:109 imports createEditorComponent/TextField) — set
    captureKey {questionId, field:"sidechat-composer"} at construction
  gotcha: SIDECHAT-002 — capture records INPUT ONLY; never the ephemeral conversation; nothing
    here may write the session file (sidechat-cache-isolation.test.ts is the guard)

- file: src/draft-store.ts
  why: the inertness template — "Deliberately inert" doc block; mirror its posture in
    input-capture.ts (no events, no panel coupling, no fs in THIS item)
  gotcha: do not modify DraftStore; input capture is a PARALLEL system until P3.M3 unifies
    seeding (draft > answer > blank)

- file: src/reconstruct.ts
  why: sessionManager.getBranch typing (:259-260) + branch semantics (:17-25) — branchId
    derivation (newest entry id on the branch walk); the panel/sidechat already hold ctx/PiUISurface
  gotcha: branchId must be recomputed on session_tree (retarget) — the key setter sites in
    panel.ts must re-set the key on retarget; a stale branchId means cross-branch clobber (case 3)

- file: src/panel/sidechat-cache-isolation.test.ts
  why: guard test that must stay green — proves capture touches no session-file/cache path
  pattern: reuse its fake-editor/pi harness shapes for the new capture tests

- file: src/panel/text-field.test.ts
  why: existing TextField test conventions (fake EditorComponent shapes, feature-detect matrix
    with/without getExpandedText/onChange) — extend rather than reinvent
```

### Current Codebase tree (relevant slice)

```bash
src/panel/text-field.ts           # MODIFY — wrap-and-chain capture hook + captureKey setter
src/panel/panel.ts                # MODIFY — key injection at duty/ownership switch sites
src/panel/sidechat.ts             # MODIFY — composer key injection at :109 construction
src/draft-store.ts                # READ-ONLY — inertness template
src/reconstruct.ts                # READ-ONLY — branchId derivation
```

### Desired Codebase tree

```bash
src/input-capture.ts              # CREATE — InputCaptureStore: keys, seq minting, pacing, sink seam
src/input-capture.test.ts         # CREATE — per-duty capture, byte-exactness, pacing, seq rules, no-side-effects
src/panel/text-field.ts           # seam + captureKey
src/panel/text-field.test.ts      # EXTEND — onChange chaining (prev callback still fires), capture keying
src/panel/panel.ts                # duty-site key setters (writein/elaboration/note)
src/panel/sidechat.ts             # composer key setter
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: NEVER replace the composed editor's onChange — wrap-and-chain
// (text-field.ts:130-136's warning is the precedent; pi-vim's own callback must keep firing).
// CRITICAL: paste is a plain buffer mutation — onChange covers it; NO separate paste event.
// GOTCHA: expanded text only — getExpandedText?.() ?? getText(); the display preview is
// forbidden (spec: "Do not save a paste placeholder or display preview").
// GOTCHA: seq minting — incidental empties (init seeding, view-change re-seed, send cleanup)
// must NOT mint; only edits AFTER the buffer's first real user mutation do. Deleting-to-empty
// after typing DOES mint and captures "".
// GOTCHA: pacing uses fake-timer-testable setTimeout only (vi.useFakeTimers); no
// process-level timers, no setInterval.
// GOTCHA: this store performs NO fs in S1 — the sink seam receives records; S2 attaches the
// atomic file writer. Keep the sink async-friendly (void-returning, try/catch-isolated).
// GOTCHA: branchId goes stale after /tree — retarget must re-set captureKey or capture writes
// under the wrong branch (cross-branch restore is case 3's violation).
// GOTCHA: first fs user is S2, not here — input-capture.ts must not import node:fs.
```

## Implementation Blueprint

### Data models

```ts
// src/input-capture.ts
export type CaptureField = "writein" | "elaboration" | "note" | "sidechat-composer";
export interface CaptureKey { branchId: string; questionId: string | "-"; field: CaptureField; }
export interface CaptureRecord extends CaptureKey {
  session: string;        // session identity from the same context as branchId
  questionId?: string;
  text: string;           // FULL expanded string, byte-exact
  seq: number;            // per-key monotonic; minted only on real edits
}
export interface CaptureSink { (record: CaptureRecord): void; }  // sync, must not throw upward
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/input-capture.ts
  - IMPLEMENT: InputCaptureStore class — per-key seq counters (Map), pacing (250ms trailing
    debounce + 1000ms max-dirty-age per dirty key), sink seam (constructor-injected,
    default: no-op), dispose() (cancel timers idempotently)
  - API: setKeyDirty(key, getText: () => string) — the TextField calls this on every onChange;
    forceFlush(key?) — accelerators; latest(key) — in-memory last record (test surface)
  - SEQ RULE: first setKeyDirty for a key after a seeding write mints nothing until a real
    edit; implement as: TextField marks seeded state, only onChange-invoked setKeyDirty mints
  - FOLLOW pattern: draft-store.ts inert doc block + module JSDoc citing spec :133-149 and the
    architecture note
  - NAMING: input-capture.ts, PascalCase types, no panel/state imports

Task 2: MODIFY src/panel/text-field.ts — the seam
  - ADD: public captureKey: CaptureKey | undefined + captureStore: InputCaptureStore | undefined
    (static/injected — prefer constructor-optional or setter, keeping existing call sites compiling)
  - ADD: in createEditorComponent/TextField init, AFTER the existing install-if-undefined
    onChange: wrap-and-chain so capture runs on EVERY mutation:
      const prevOnChange = editor.onChange;
      editor.onChange = () => { prevOnChange?.(); onInvalidate(); maybeCapture(); };
    (the existing :124-136 install composes — restructure minimally so both the invalidate
    callback and capture chain; the stock-editor no-onChange case still installs capture)
  - CAPTURE BODY: store?.setKeyDirty(captureKey, () => editor.getExpandedText?.() ?? editor.getText())
  - GOTCHA: never call capture when captureKey is undefined (test fakes) — no-op, not throw

Task 3: MODIFY src/panel/panel.ts — three duty sites
  - AT the buffer-ownership switch points (~:803-811 comment block; question navigation
    write-through per EXPLAIN-002; duty changes writein/elaboration/note; retargetState):
    set textField.captureKey = { branchId, questionId: currentId ?? "-", field: currentDuty }
  - WIRE the store: create ONE InputCaptureStore per extension (index.ts or panel factory —
    wherever DraftStore is created; pass down alongside it)
  - PRESERVE: all existing draft write-through behavior (DraftStore untouched)

Task 4: MODIFY src/panel/sidechat.ts — composer site
  - AT composer construction (:109 area): set captureKey { branchId, questionId, field:
    "sidechat-composer" } on the shared TextField machinery instance
  - GOTCHA: input only — no conversation capture, no session-file writes (isolation guard)

Task 5: CREATE src/input-capture.test.ts
  - PER-DUTY (5 describes): fake editor with onChange+getExpandedText; set key; fire onChange
    (a) typed edit → flush (fake timers advance 250ms) → sink record with correct key/text
    (b) paste: single setText mutation inserting multiline text → record text is byte-exact
        expanded string, no placeholder
  - BYTE-EXACT cases: "  leading\nline2\t", "あé…🜂", trailing spaces, "" after typed text
  - PACING: 50 keystrokes at 50ms intervals → ≥2 flushes before idle (1000ms max age fires);
    no flush waits for blur/suspend (never simulated)
  - SEQ: incidental seeding (no onChange) mints nothing; delete-to-empty mints and saves ""
  - NO-SIDE-EFFECTS: sink spy only; assert no applyAnswer/submit/send/model symbols were ever
    imported or invoked (structural: the module's import graph is capture-only — assert via
    a store constructed with a recording sink and a fake panel context, all spies untouched)
  - STALE-KEY: setKeyDirty under key A then key switch → records carry the key current at edit time

Task 6: EXTEND src/panel/text-field.test.ts
  - CHAINING: an editor whose factory pre-installs onChange → BOTH the factory callback and
    capture fire (spy both); no-onChange editor → capture still installed
  - KEYING: captureKey undefined → no capture, no throw

Task 7: VALIDATE
  - npm test && npm run typecheck && npm run lint
  - npx vitest run src/panel/sidechat-cache-isolation.test.ts src/panel/editor-preservation.test.ts
    # both green, untouched
```

### Implementation Patterns & Key Details

```ts
// The seam (text-field.ts) — chain, never replace:
const prevOnChange = editor.onChange;
const fireCapture = () => {
  if (captureStore === undefined || captureKey === undefined) return;
  captureStore.setKeyDirty(captureKey, () => editor.getExpandedText?.() ?? editor.getText());
};
if (editor.onChange === undefined) {
  editor.onChange = () => { onInvalidate(); fireCapture(); };
} else {
  const prev = editor.onChange;
  editor.onChange = () => { prev(); onInvalidate(); fireCapture(); };
}

// Pacing (input-capture.ts) — fake-timer friendly:
private arm(key: string) {
  if (this.debounces.has(key)) return;              // trailing debounce already armed
  this.debounces.set(key, setTimeout(() => this.flush(key), 250));
  if (!this.maxAge.has(key))
    this.maxAge.set(key, setTimeout(() => this.flush(key), 1000)); // bounded dirty age
}
```

### Integration Points

```yaml
UPSTREAM: architecture/input-recovery.md (P3.M1.T1.S1) — design authority; TextField/panel/sidechat seams shipped
DOWNSTREAM:
  - P3.M2.T1.S2 attaches the atomic fs sink (tmp+fsync+rename, seq>=durable.seq guard) to this
    store's sink seam; P3.M2.T1.S3 adds retirement (deliberate discard / replacement / handoff)
    as store methods — leave those OUT of S1
  - P3.M3.T1.* consume latest(key) + keying for seeding/session-start restore
OUT OF SCOPE: fs/durability (S2), retirement (S3), restore/seeding (P3.M3), blank rejection
  (P3.M4 — capture saves "" freely; rejection is applyAnswer's), README/spec docs
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck && npm run lint
```

### Level 2: Unit Tests

```bash
npx vitest run src/input-capture.test.ts -v
npx vitest run src/panel/text-field.test.ts -v
npx vitest run src/panel/sidechat-cache-isolation.test.ts src/panel/editor-preservation.test.ts
npm test   # full suite green
```

### Level 3: Boundary check

```bash
git diff --name-only
# Expected: src/input-capture.ts(+test), src/panel/text-field.ts(+test), src/panel/panel.ts, src/panel/sidechat.ts ONLY
grep -n "node:fs\|applyAnswer\|sendMessage\|streamSimple" src/input-capture.ts   # no matches
grep -n "openPanel\|maybeAutoOpen" src/input-capture.ts                          # no matches
```

## Final Validation Checklist

- [ ] All five duties capture edits and pastes with correct `{session, branch, questionId?, field, text, seq}` records.
- [ ] Byte-exact expanded strings (multiline, Unicode, edge whitespace, typed-empty).
- [ ] Pacing: bounded dirty age flushes during continuous typing; no idle/blur/shutdown dependence.
- [ ] Seq minting rules hold (incidental empty ≠ edit; delete-to-empty = edit).
- [ ] Wrap-and-chain proven: composed factory's onChange still fires (test with spy).
- [ ] No side effects: capture path invokes only the sink; audit test passes.
- [ ] DraftStore, isolation guards, editor-preservation tests untouched and green.
- [ ] `npm test`, typecheck, lint green; diff confined to the five listed files.

## Anti-Patterns to Avoid

- ❌ Don't replace or drop the composed editor's onChange — chain it.
- ❌ Don't capture display previews or placeholders — expanded text only.
- ❌ Don't add fs/durability/retirement here — S2/S3 own those; keep the sink seam clean.
- ❌ Don't couple the capture store to panel/state internals — keys in, records out.
- ❌ Don't gate saves on idle, blur, suspend, or shutdown — bounded max dirty age is the requirement.
- ❌ Don't touch spec/, README.md, or DraftStore semantics.

---

**Confidence Score**: 8/10 — all seams pre-researched with exact anchors (text-field.ts :124-136, panel.ts :3031/:803-811, sidechat.ts:109) and the sibling architecture-note PRP resolves every mechanism; residual risk: (1) the note itself is still in flight — read it first and defer to it; (2) exact panel.ts duty-switch call sites may have drifted — locate via the buffer-ownership comment block, not line numbers.

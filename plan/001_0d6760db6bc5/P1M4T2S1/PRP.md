# PRP — P1.M4.T2.S1: Draft store — per-question slots + survival guarantees (R4)

## Goal

**Feature Goal**: Implement the R4 "drafts are sacred" commitment (h2.45, h2.0 commitment 6): a `DraftStore` living in **extension memory** (outside the panel component) holding `{questionId → {value, text}}` slots plus the batch note, surviving question navigation, view toggles, agent upserts (including merge-rule-2 answer resets and rev bumps), and suspend/resume re-instantiation. Drafts are destroyed ONLY by submission (text answers ship, then slots are dropped) or explicit user clear. Not persisted across restarts (documented limitation, Q6=B).

**Deliverable**: NEW `src/draft-store.ts` — `DraftStore` class implementing the existing `src/panel/panel.ts:70-76` `DraftStore` seam (`getDraft`/`setDraft`/`getNote`/`setNote`) plus `setDraftEntry`, `hasDraft`, `clearDraft(id, {explicit})`, `clearAll({explicit})`, `shipDrafts(ids?)`; `src/draft-store.test.ts`; one-line integration in `src/panel/actions.ts` `submit()` (`shipDrafts` after `buildSubmission`); construction + wiring in `src/index.ts` (one instance per extension activation, passed as `drafts` to every `openPanel`).

**Success Definition**: Two panel instances sharing one store see the same drafts (suspend/resume simulation); `upsertQuestion`, `epoch-bumped`, `questions-upserted`, view switches, and question navigation never remove a slot; `submit()` with a non-empty diff ships & drops exactly the changed ids' drafts; `clearDraft(id)` without `{explicit:true}` is a no-op; `clearDraft(id, {explicit:true})` removes it; `getNote()/setNote()` round-trip; `[Mode A]` JSDoc enumerating the full survival matrix. `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: pi user answering an interrogation panel while the agent re-asks questions or the user suspends to chat.

**Use Case**: User types a long text answer to Q3, navigates to Q7, agent upserts Q3 with changed options (answer reset, ⟳ marker), user suspends the panel to ask the agent something, resumes — Q3's typed draft is still there when they revisit.

**User Journey**: type in text field (enter stage-1 saves via seam) → navigate away → revisit → field re-seeded from store → submit → text answers ship, slots for shipped questions are gone; explicit clear (UI path, later task) removes a single slot on demand.

**Pain Points Addressed**: The ask_user extension loses drafts on tab switches — disqualifying (h2.0 commitment 6, hard-won lesson). This task makes that failure structurally impossible: survival is achieved by the store living outside every component that gets destroyed.

## Why

- h2.45 (R4): "Panel-local `{questionId → {value, text}}` + `batchNote`. Preserved across navigation, view toggles, upserts, suspend/resume. Flushed into state on submit; cleared on submit or explicit clear. **Not** written to any persistent layer."
- h2.0 commitment 6: drafts survive navigation, agent re-asks, suspend/resume, view toggles; never destroyed except by explicit user action (and per h2.45, submit).
- h2.21 merge rule 2: "answer reset, status `reasked`, rev-bump; panel draft *preserved* (surfaces when the user revisits)" — `src/merge.ts:17-19` already guarantees the state engine never touches drafts; this store simply must not react to state events either.
- The seam is already consumed: panel seeds from `this.drafts?.getDraft(currentId)` (panel.ts:438-440), P1.M4.T1.S2's `saveTextDraft()`/`saveNote()` write through it, P1.M4.T1.S3's external editor syncs it, P1.M6.T1.S1's resume re-instantiation will receive it via `openPanel` options.

## What

### DraftStore contract (authoritative)

1. **Location & lifetime**: constructed once in `src/index.ts` at extension activation, held in a closure variable of the extension function, passed as `drafts` in every `openPanel(...)` call. Because the panel component (and its S2-local `draftSlots` mirror) is destroyed on suspend/re-instantiation but the store is not, drafts survive suspend/resume by construction.
2. **Storage**: `private slots = new Map<string, {value: string, text: string}>()` keyed by questionId; `private note = ""`.
3. **Seam methods** (satisfy `panel.ts`'s `DraftStore` interface exactly):
   - `getDraft(questionId): string | undefined` → `slots.get(id)?.text`
   - `setDraft(questionId, text: string): void` → upsert slot with `{value: questionId, text}` (the `{value,text}` shape per the item contract; value = the question id itself, matching S2's `draftSlots.set(questionId, {value: question.id, text})`).
   - `getNote(): string` / `setNote(text: string): void` → batch note (R3). NOTE-mode UI + delivery wiring is P1.M4.T2.S2; this task only stores it.
4. **Extended API**:
   - `setDraftEntry(questionId, entry: {value: string, text: string}): void` — full-shape upsert.
   - `hasDraft(questionId): boolean` → slot exists AND `text !== ""` — ✎-marker data for the short view (layout.ts:204 today marks state answers; draft-presence data is supplied here, rendering use lands with panel view tasks).
   - `clearDraft(questionId, opts?: {explicit?: boolean}): boolean` — returns whether it was removed. **Default is NO-OP**: without `opts?.explicit === true` nothing is cleared (safety default — "never destroyed except by explicit user action"). Explicit clear may remove an empty-text slot too.
   - `clearAll(opts?: {explicit?: boolean}): void` — same explicit gate, clears slots (note is kept — the note is R3's own lifecycle, T2.S2).
   - `shipDrafts(ids?: string[]): Map<string, {value: string, text: string}>` — submit flush: remove and return the entries for `ids` (all slots when omitted). Called by the panel submit path; the returned entries are the shipped text answers' provenance record (text itself ships from state via `buildSubmission`).
5. **Survival matrix** (must be the `[Mode A]` JSDoc, verbatim coverage):
   - navigation between questions → **preserve** (no clearing on question change, ever)
   - short/deep/overview view toggles → **preserve**
   - upserts, incl. merge rule 2 answer reset + rev bump, merge rule 4 withdraw → **preserve** (no subscription to `questions-upserted`/`changed`/`epoch-bumped`; preservation is by omission — see merge.ts:17-19)
   - suspend/resume re-instantiation → **preserve** (store lives in extension memory, outside the panel component)
   - submit → **destroy** shipped questions' slots only (`shipDrafts(diff.changed)` in actions.ts submit)
   - explicit user clear → **destroy** that slot (`clearDraft(id, {explicit: true})`)
   - restart → **lost** (documented limitation, Q6=B; nothing writes the store to any persistent layer — do NOT add it to persistence.ts, which is P1.M7.T1 and per h2.45 excludes drafts)
6. **Submit flush ordering** (consumed by P1.M2.T1.S1's ordering): in `src/panel/actions.ts` `submit()`, AFTER `buildSubmission(...)` succeeds (the message is built from state, not drafts, so post-build deletion is failure-safe) and BEFORE/AFTER `deliverSubmission` (adjacent line): `panel.drafts?.shipDrafts(diff.changed)` — where `diff.changed` is the already-computed array of changed question ids. The zero-pending early-return path (`panel.flash("nothing to submit")`) must NOT touch drafts.

### Success Criteria

- [ ] Survival: navigation, view toggles, upserts (incl. rule 2), suspend/resume (simulated by two panel instances sharing one store) all preserve slots.
- [ ] Submit flush: `shipDrafts(diff.changed)` called in actions.ts submit; only changed ids dropped; zero-pending path leaves drafts untouched.
- [ ] `clearDraft(id)` (no opts) is a no-op returning false; `{explicit: true}` removes.
- [ ] Seam compliance: an instance satisfies `DraftStore` from panel.ts:70-76 (assign to that interface type in a test).
- [ ] Restart-loss documented in `[Mode A]` JSDoc; nothing in the store touches disk.
- [ ] `npm run typecheck` + `npm test` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact existing seam, the parallel S2/S3 write-paths, the submit integration point, the extension wiring location, and the survival-by-omission rationale. All anchored below — no other files need reading.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: THE seam — `export interface DraftStore` (lines 67-76): getDraft/setDraft/getNote/setNote;
    `OpenPanelOptions.drafts?: DraftStore` (~96-98); constructor stores it (line 253, 286);
    field seeding reads `this.drafts?.getDraft(this.currentId)` (438-440); openPanel forwards
    `drafts: opts.drafts` (line 673).
  pattern: implement the interface exactly; extra public methods (hasDraft/clearDraft/shipDrafts)
    are structurally fine.
  gotcha: the panel host NEVER constructs a DraftStore (comment at line 67) — construction
    belongs to src/index.ts.

- file: src/panel/actions.ts
  why: SUBMIT INTEGRATION — `submit()` at line 294: computes `diff = computeDiff(pre, panel.state.serialize())`,
    zero-pending early return with flash (~298-300), then `const msg = buildSubmission(panel.state, diff);`
    and `deliverSubmission(...)`. Insert `panel.drafts?.shipDrafts(diff.changed)` after buildSubmission.
  pattern: named-function exports + `panelActions` registry at the bottom — do not restructure.
  gotcha: buildSubmission performs takeSnapshot + bumpEpoch EXACTLY once (comment lines 288-290) —
    do not add any snapshot/epoch logic around shipDrafts; it is a pure map operation.

- file: src/index.ts
  why: WIRING — extension entry `interrogatorExtension(pi: ExtensionAPI)` (line 35). Create
    `const drafts = new DraftStore();` in the extension closure and pass `drafts` in every
    openPanel call site (find via `grep -n "openPanel" src/index.ts src/panel/panel.ts`; if
    index.ts does not yet call openPanel directly, follow the PanelHost/openPanel indirection
    the scaffold exposes and wire the option where options are assembled).
  pattern: closure-held singletons are the established extension-memory pattern (state singleton
    per getState()).
  gotcha: one instance per ACTIVATION survives suspend/resume; creating it inside openPanel or
    the panel constructor would defeat the whole feature.

- file: src/merge.ts
  why: PROOF of preservation-by-omission — lines 17-19: "Drafts (R4, FR-21) live entirely
    panel-side: nothing in this module reads, writes, or clears draft state." Merge rule 2
    preserves drafts by never touching them. The store mirrors this: subscribe to NOTHING.

- file: src/state.ts
  why: event surface (StateEvents lines 139-147: changed / questions-upserted / epoch-bumped /
    completed-cleared). There is no per-question rev-bump event; the item's "questionRevBumped"
    is the plan-level name for merge-rule bumps that land inside questions-upserted. The store
    must NOT react to any of these events — preservation is by omission.
  gotcha: even `completed-cleared` must not clear drafts here (completion record wiring and
    end-of-session teardown belong to lifecycle/completion tasks; explicit clearAll exists for
    those callers).

- file: src/completion.ts
  why: `CompletionTriggerOptions.getBatchNotes?: () => string[]` (lines 56-58) — comment says
    "draft store in P1.M4.T2.S2". DO NOT wire it in this task; T2.S2 owns note delivery. This
    task only guarantees `getNote()` returns what `setNote()` stored.

- file: plan/001_0d6760db6bc5/P1M4T1S2/PRP.md
  why: CONTRACT (parallel, treat as landed): panel-local `draftSlots` Map is a MIRROR only;
    the seam (`this.drafts?.setDraft/getDraft/setNote`) is the cross-instance source of truth.
    Refocus seeding reads `draftSlots.get(id)?.text ?? this.drafts?.getDraft(id) ?? ""`.
  gotcha: after suspend/resume the panel-local mirror is empty but the store is not — seeding
    falls through to the store. That is the survival mechanism working; do not "fix" it.

- file: plan/001_0d6760db6bc5/P1M4T1S3/PRP.md
  why: CONTRACT (parallel, treat as landed): external editor writes via
    `this.draftSlots?.set(...)` + `this.drafts?.setDraft(...)` — both hit our store; no changes
    needed on our side.

- file: src/panel/panel.test.ts
  why: test conventions — stub DraftStore objects with vi.fn() (lines ~740, 767); reuse the
    real class there only if convenient.

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.45, h2.0, h2.21)
  why: authoritative survival matrix wording — quote it in the [Mode A] JSDoc.

- file: plan/001_0d6760db6bc5/P1M4T2S1/research/notes.md
  why: this item's research digest (seam lines, survival analysis, integration points).
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  index.ts                # extension entry — ADD: construct + wire DraftStore
  panel/
    panel.ts              # READ-ONLY: DraftStore interface + openPanel option already exist
    actions.ts            # MODIFY: one line — shipDrafts in submit()
    panel.test.ts         # READ-ONLY (existing stubs keep passing)
  draft-store.ts          # does not exist yet
```

### Desired Codebase tree

```bash
src/
  draft-store.ts          # CREATE: DraftStore class — survival matrix JSDoc + API
  draft-store.test.ts     # CREATE: full unit coverage incl. suspend/resume simulation
  index.ts                # MODIFY: closure-held instance → openPanel({drafts})
  panel/
    actions.ts            # MODIFY: submit() flush line (+ extend actions.test.ts)
    actions.test.ts       # EXTEND: shipDrafts called on submit, untouched on zero-pending
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: survival is ACHIEVED BY WHERE THE INSTANCE LIVES, not by any
// preservation code. Construct it once per extension activation (closure in
// index.ts). Any construction inside the panel/panel-host path silently
// reintroduces the ask_user draft-loss bug this task exists to kill.
// CRITICAL: subscribe to NO state events. Preservation-by-omission: merge.ts
// never touches drafts (its own JSDoc, lines 17-19) and neither do we.
// GOTCHA: clearDraft defaults to NO-OP. The signature is
// clearDraft(id, opts?: {explicit?: boolean}) — without explicit:true it must
// return false and change nothing. Accidental draft destruction is THE
// disqualifying failure mode (commitment 6).
// GOTCHA: shipDrafts goes AFTER buildSubmission in submit() — the submission
// message is built from STATE (diff), not drafts, so post-build deletion is
// safe on every path; placing it before buildSubmission would also be
// harmless but after is provably correct.
// GOTCHA: the zero-pending branch ("nothing to submit" flash) must NOT ship
// or clear anything — no diff means nothing shipped, drafts stay.
// GOTCHA: do NOT persist the store anywhere (no fs, no persistence.ts hook).
// h2.45: restart loses drafts BY DESIGN (Q6=B). Add a code comment saying so
// next to the class JSDoc.
// GOTCHA: keep the batch note out of clearAll's default behavior — the note
// has its own lifecycle (R3, P1.M4.T2.S2). clearAll({explicit:true}) clears
// slots; add a separate explicit clearNote() if desired (optional).
// GOTCHA: hasDraft(id) must treat an empty-text slot as ABSENT ("" text =
// user cleared the field) — the ✎ marker must not light for empty drafts.
```

## Implementation Blueprint

### Data models and structure

```ts
/** src/draft-store.ts */
export interface DraftEntry {
  /** The chosen option value; for free-text answers this is the question id. */
  value: string;
  /** The typed-but-unsubmitted text. */
  text: string;
}

export interface ClearOptions {
  /** R4: drafts are destroyed ONLY by explicit user action (or submit). */
  explicit?: boolean;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/draft-store.ts
  - IMPLEMENT class DraftStore with: slots Map<string, DraftEntry>; note string
  - SEAM methods matching panel.ts:67-76 verbatim: getDraft(id): string|undefined,
    setDraft(id, text): void (upserts {value: id, text}), getNote(): string, setNote(text): void
  - EXTENDED: setDraftEntry(id, entry), hasDraft(id) (slot && text !== ""),
    clearDraft(id, opts?): boolean, clearAll(opts?): void, shipDrafts(ids?): Map<string, DraftEntry>
  - [Mode A] JSDoc on the class: enumerate the survival matrix verbatim
    (navigation/toggles/upserts incl. rule-2 reset + rev bump/suspend-resume = preserve;
    submit ships+destroys shipped ids; explicit clear destroys one; restart loses — Q6=B,
    by design, nothing here touches disk). Cite h2.45, h2.0 commitment 6, h2.21 rule 2.
  - NAMING: file src/draft-store.ts, class DraftStore (collides with the panel.ts
    interface name only on import — import it as `type DraftStore as IDraftStore` or rely on
    structural typing in index.ts: `const drafts: DraftStore = new DraftStoreImpl()` —
    pick one and be consistent; recommend exporting the class as `DraftStore` and importing
    the interface with an alias where both are needed)
  - NO EventEmitter, NO subscriptions, NO fs — pure in-memory Map wrapper

Task 2: MODIFY src/panel/actions.ts — submit flush
  - FIND: submit() (~line 294); the line `const msg = buildSubmission(panel.state, diff);`
  - ADD immediately after it: `panel.drafts?.shipDrafts(diff.changed);` with a one-line
    comment: "R4/h2.45: text drafts ship with the answers, then their slots are destroyed.
    After buildSubmission (message built from state) so every path is failure-safe."
  - PRESERVE: zero-pending early return untouched; snapshot/epoch logic untouched (owned by
    buildSubmission); panelActions registry untouched
  - GOTCHA: `panel.drafts` is typed as the panel.ts interface which lacks shipDrafts — either
    widen the interface in panel.ts with the extended methods as OPTIONAL
    (`shipDrafts?(ids?): ...; hasDraft?(id): boolean; clearDraft?(id, opts?): boolean;`) or
    cast at the call site. PREFER widening panel.ts's DraftStore interface (small, additive,
    optional members keep existing test stubs valid) — document this in the PRP diff note.

Task 3: MODIFY src/index.ts — construction + wiring
  - ADD `const drafts = new DraftStore();` inside interrogatorExtension's closure (per-session,
    per-activation instance)
  - PASS `drafts` in every openPanel(...) options assembly (locate call sites with
    `grep -rn "openPanel(" src/`; if the scaffold routes options through a helper/host object,
    add it there once)
  - JSDoc: one store per activation = suspend/resume survival (panel instances are
    disposable; the store is not); restart loses drafts by design (Q6=B)

Task 4: CREATE src/draft-store.test.ts
  - CASES (vitest, describe/it, follow any existing src/*.test.ts):
    (1) seam compliance: `const s: DraftStore = new DraftStoreImpl()` where DraftStore is
        panel.ts's interface (type-level check)
    (2) setDraft/getDraft round-trip; getDraft of unknown id → undefined
    (3) setDraftEntry stores the full {value,text}; getDraft returns .text
    (4) hasDraft: true with non-empty text; false for unknown id; false for ""-text slot
    (5) clearDraft(id) → false, slot intact; clearDraft(id, {explicit:true}) → true, removed
    (6) clearAll analog: default no-op; explicit clears slots; note survives clearAll
    (7) shipDrafts(["a","c"]) returns exactly those entries and removes only them
    (8) shipDrafts() (no ids) returns and clears everything
    (9) getNote/setNote round-trip; default ""
    (10) SURVIVAL simulation: emit-equivalent — after arbitrary setDraft/setNote, call
         upsertQuestion-style state churn is irrelevant; instead simulate suspend/resume:
         create store, setDraft, then a SECOND consumer reading the same instance sees the
         draft (trivially true; the meaningful assertion lives in Task 5)
    (11) restart-loss: nothing to test at unit level — assert the class has no fs imports
         via a grep in Level 4 instead

Task 5: EXTEND src/panel/actions.test.ts + a small integration test
  - SUBMIT: submit with non-empty diff → drafts.shipDrafts called with diff.changed (mock
    DraftStore with vi.fn); zero-pending → shipDrafts NOT called
  - SUSPEND/RESUME (the R4 money test): build two fake "panel sessions" sharing one real
    store: session1 sets draft "q1"→"typed text"; session2 (fresh panel-like fixture, same
    store instance) getDraft("q1") === "typed text"; then shipDrafts(["q1"]) → getDraft
    undefined, entry returned
  - FOLLOW pattern: existing actions.test.ts fixtures (fake panel, stub state with
    serialize()/takeSnapshot equivalents — reuse its existing submit fixtures wholesale and
    just add the drafts spy)

Task 6: VALIDATE
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// src/draft-store.ts — the load-bearing shape
/**
 * [Mode A] DraftStore — R4 "drafts are sacred" (h2.45; h2.0 commitment 6).
 *
 * Survival matrix:
 * | Event                              | Drafts      |
 * |------------------------------------|-------------|
 * | question navigation                | preserved   |
 * | short/deep/overview view toggles   | preserved   |
 * | upsert (merge rule 1/2/4, rev bump)| preserved   |  ← merge.ts never touches drafts;
 * |                                    |             |    this store subscribes to nothing
 * | suspend/resume (panel re-created)  | preserved   |  ← store lives in extension memory
 * | submit (text answers ship)         | DESTROYED (shipped ids only, via shipDrafts) |
 * | explicit user clear                | DESTROYED (that id, via clearDraft {explicit}) |
 * | process restart                    | LOST — by design (Q6=B); never written to disk |
 */
export class DraftStoreImpl /* or DraftStore; see Task 1 naming note */ {
  private readonly slots = new Map<string, DraftEntry>();
  private noteText = "";

  getDraft(id: string): string | undefined {
    return this.slots.get(id)?.text;
  }

  setDraft(id: string, text: string): void {
    this.setDraftEntry(id, { value: id, text });
  }

  clearDraft(id: string, opts?: ClearOptions): boolean {
    if (opts?.explicit !== true) return false; // R4: only explicit user action destroys
    return this.slots.delete(id);
  }

  shipDrafts(ids?: string[]): Map<string, DraftEntry> {
    const shipped = new Map<string, DraftEntry>();
    const targets = ids ?? [...this.slots.keys()];
    for (const id of targets) {
      const entry = this.slots.get(id);
      if (entry) {
        shipped.set(id, entry);
        this.slots.delete(id);
      }
    }
    return shipped;
  }
  // ...setDraftEntry, hasDraft, clearAll, getNote/setNote
}

// src/panel/actions.ts — the one-line submit integration
const msg = buildSubmission(panel.state, diff);
panel.drafts?.shipDrafts(diff.changed); // R4: ship then destroy; message built from state above
deliverSubmission(deps, msg, { isIdle: deps.isIdle });
```

### Integration Points

```yaml
PANEL: panel.ts DraftStore interface gains OPTIONAL members (shipDrafts?, hasDraft?,
  clearDraft?) so actions.ts can call them without casts; existing test stubs stay valid
  (optional members). Keep the 4 required members exactly as-is.
INDEX: closure-held instance passed to every openPanel({drafts})
SUBMIT: actions.ts submit() — shipDrafts(diff.changed) after buildSubmission
FUTURE M4.T2.S2: batch-note UI + NOTE: delivery; getNote/setNote already here;
  completion.ts getBatchNotes wiring belongs to that task
FUTURE M6.T1.S1: suspend/resume passes the same store (already via openPanel options)
FUTURE M7.T1.S1: persistence.ts MUST NOT serialize this store (h2.45)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/draft-store.test.ts -v
npx vitest run src/panel/actions.test.ts -v
npm test
```

### Level 3: Integration (scripted)

```bash
# Debug-command smoke (P1.M2.T3): upsert → (panel-side draft write is UI-only, so the
# scripted check is the unit-level money test in Task 5) — verify the existing debug
# commands still pass untouched:
npm test src/tool.test.ts src/debug-commands.test.ts
```

### Level 4: Domain-specific

```bash
grep -rn "fs\b\|writeFile\|readFile\|persist" src/draft-store.ts   # must be empty — no disk, ever
grep -n "Mode A" src/draft-store.ts                                 # survival-matrix JSDoc present
grep -rn "shipDrafts" src/panel/actions.ts src/index.ts src/draft-store.ts  # wired
grep -rn "\.on(" src/draft-store.ts                                 # must be empty — no subscriptions
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green (existing panel.test.ts stubs unaffected).

### Feature Validation

- [ ] Survival matrix holds: navigation/toggles/upserts(incl. rule 2 + rev bump)/suspend-resume preserve; submit destroys shipped ids only; explicit clear destroys one; restart loses by design.
- [ ] Suspend/resume money test passes (two consumers, one store).
- [ ] Zero-pending submit leaves drafts untouched.
- [ ] `clearDraft` without `{explicit:true}` is a no-op.

### Code Quality Validation

- [ ] Store constructed once per extension activation in index.ts, never inside panel/host paths.
- [ ] No state-event subscriptions; no filesystem access; no changes to merge.ts/state.ts semantics.
- [ ] panel.ts interface changes are additive-optional only.

### Documentation & Deployment

- [ ] `[Mode A]` JSDoc on the class enumerates the full survival matrix with h2.45/h2.0/h2.21 citations and the Q6=B restart limitation.

## Anti-Patterns to Avoid

- ❌ Don't construct the store inside the panel, panel host, or openPanel — that reintroduces draft loss on suspend/resume (the disqualifying ask_user bug).
- ❌ Don't subscribe to state events to "manage" drafts — preservation is by omission; every subscription is a chance to accidentally clear.
- ❌ Don't make `clearDraft`/`clearAll` destructive by default — explicit gate is the safety contract.
- ❌ Don't ship/clear drafts in the zero-pending submit branch.
- ❌ Don't persist drafts to disk "for safety" — h2.45 forbids it (Q6=B documented limitation).
- ❌ Don't wire the batch note into completion/delivery — that is P1.M4.T2.S2's contract.
- ❌ Don't change the 4 required seam member signatures in panel.ts — S2/S3 panel code and tests depend on them.

---

**Confidence Score**: 9/10 — the seam, integration point, and survival mechanism are all verified in the shipped code (panel.ts:67-76/438-440, actions.ts:294-313, merge.ts:17-19); the only mild uncertainty is the index.ts openPanel wiring detail (call-site indirection), for which an exact grep instruction is provided.

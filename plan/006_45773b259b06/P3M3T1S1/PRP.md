---
name: "P3.M3.T1.S1 — Editor seeding rules: newer draft > recorded answer > blank; intentional empty preserved (Local input recovery)"
description: "CREATE src/input-restore.ts (pure seed ladder {newer recovery draft > exact recorded answer.value > blank} + ancestry-gated draft lookup over DurableInputStore.latest()) and src/input-restore.test.ts. MODIFY src/panel/panel.ts: replace the draft-only seed at the three seeding sites (focusTextField entry, EXPLAIN-002 syncBufferToQuestion re-scope — ✎ Other accept flows through them from actions.ts) with a duty-aware ladder helper seedTextFor(id, duty); answer fallback gated to duty===\"writein\" && answer.custom===true (custom:true covers ✎ write-ins AND type:\"text\" answers — option values NEVER seed Other); durable-vs-answer freshness via savedAt > answer.at (strict; deliberate \"\" preserved); phantom-draft guard so an un-edited answer seed never becomes a slot/draft. Thread a narrow durableInputs read dep through index.ts → maybeAutoOpen → panel (same chain as inputCapture). draftTextFor, the syncBufferToQuestion write-through existing-check, consumeCommittedBuffer, text-field.ts, actions.ts stay UNTOUCHED (verify). Consumed by P3.M3.T1.S2 (session-start restore + composer) and P3.M5.T1.S1 (final gate)."
---

## Goal

**Feature Goal**: Opening the ✎ Other editor or a text-answer editor (and the EXPLAIN-002 question-change re-scope) seeds the buffer by one deterministic ladder: the user's newer matching recovery draft → otherwise the exact recorded write-in/text `answer.value` → otherwise blank. A deliberate deletion-to-empty (in-memory slot `""` or durable `{text:"", seq}`) is treated as the newest edit and preserves the empty editor — never the previous answer text. An option value is never seeded into the Other editor. No seeding or discarding path mutates answers, retires recovery values, or resurrects a discarded draft.

**Deliverable**:
1. `src/input-restore.ts` (new) — pure, panel-free ladder `recoverySeedText(...)` + ancestry-gated `latestDraftOnLineage(...)` (scan of `DurableInputStore.latest()` over the current walk's entry ids; sibling-branch records excluded).
2. `src/input-restore.test.ts` (new) — every ladder rule as a pure unit test, incl. the never-seed-Other-with-option-value invariant.
3. `src/panel/panel.ts` (modify) — private `seedTextFor(id, duty)` used by `focusTextField` and `syncBufferToQuestion`; phantom-draft guard; new optional `durableInputs` dep.
4. Wiring: `src/index.ts` + `maybeAutoOpen` chain pass the existing `durableInputs` instance (narrow read type) to the panel.
5. Panel-level tests (extend `src/panel/panel.test.ts` or a sibling test file using its harness): per-rule behavior at the real seeding sites.

**Success Definition**: `npm test`, `npm run typecheck`, `npm run lint` green; S1/S2/S3 tests, sidechat-cache-isolation, editor-preservation, no-hardcoded-keys untouched-green; every ladder rule scripted including: committed ✎/text answer re-opened → exact `answer.value` seeded; option-answered question's Other editor → NEVER seeded with the option value; delete-to-empty + blur + re-open → blank editor wins over the recorded answer; durable draft on a sibling branch → ignored; a seeded answer text never mints a capture record and never becomes a phantom draft after un-edited navigation.

## User Persona (if applicable)

**Target User**: The interrogation user re-opening an answered question to edit it — and the crash-recovery user whose pre-crash draft must outrank the older committed answer.

**Use Case**: Re-open ✎ Other on a question answered with a write-in: the editor pre-fills with the committed text so the edit starts from the answer (today it pre-fills blank). Re-open after a crash: the half-typed recovery draft appears, not the older answer.

**User Journey**: question answered via Other/text → user re-enters the editor (✎ row enter, ctrl+t, or question navigation while text-focused) → buffer pre-fills: newest draft if one exists (deliberate blank included), else the exact recorded answer text, else blank → user edits or abandons; abandoning changes no answer.

**Pain Points Addressed**: committed-write-in re-edits starting from blank (retyping); crash-recovered drafts losing to stale answers; option ids leaking into write-in editors; a seeded answer silently becoming a "changed" draft.

## Why

- Binding spec: `spec/state-and-persistence.md` §Local input recovery, "Re-edit and commit" bullet + acceptance case 5 (reopen limbs) — READ-ONLY.
- `spec/ui-spec.md:46` — EXPLAIN-002 amendment: re-seed from the freshest draft, "for Other/text re-edits, fall back to the corresponding recorded answer" (replaces the old blank-when-none rule).
- Upstream contracts (landed): `src/input-capture.ts` (CaptureKey — branchId is the RAW walk-tip entry id), `src/input-durability.ts` (`latest(DurableKeyQuery) → DurableValue | undefined`; `undefined` = never-captured OR tombstoned; `{text:"", seq}` = deliberate empty), S3 retirement (tombstone anti-resurrection; `applyChatAnswer` retires nothing; esc stages, never clears).
- Design authority: `plan/006_45773b259b06/architecture/input-recovery.md` — consumers map assigns this item the seeding ladder; the ancestry restore rule it lists under P3.M3.T1.S2 is REQUIRED here for field-open reads (exact-branchId misses grown tips) and is exported for S2 to reuse.
- Downstream: P3.M3.T1.S2 (session-start restore, composer) consumes `src/input-restore.ts` exports; P3.M5.T1.S1 runs the final acceptance gate.

## What

### Behavior

1. **The ladder** (pure function, panel-free, unit-testable): for `(questionId, duty ∈ {"writein","elaboration"})` with inputs `{slotText?, seamText?, durableValue?, answer?, answerEligible}` —
   a. `slotText !== undefined` → it (a panel-local stage-1/write-through slot; `""` = deliberate empty, preserved);
   b. `seamText !== undefined` → it (DraftStore seam, same semantics);
   c. `durableValue !== undefined`:
      - no answer OR `!answerEligible` → `durableValue.text` (deliberate `""` included);
      - answer eligible → `durableValue.text` iff `durableValue.savedAt` exists and is strictly newer than `answer.at` (ISO string compare); otherwise fall through to (d) — ties/missing savedAt resolve to the recorded answer (ANSWER-PIN conservatism).
   d. `answerEligible && answer !== undefined` → `answer.value` verbatim (untrimmed);
   e. otherwise `""`.
2. **answerEligible** is computed by the caller: `duty === "writein" && answer?.custom === true`. `custom: true` marks BOTH ✎ write-ins and `type:"text"` answers (state.ts:42-54) — option answers never qualify. Elaboration duty never seeds from the answer.
3. **Ancestry-gated durable lookup**: candidates for `{questionId, field}` are accepted only when their `CaptureKey.branchId` (capture-time walk tip) is one of the CURRENT `branchReader.getBranch()` entry ids. Across differing branchIds order by `savedAt` (ISO), tie → later position in the walk; `seq` is per-key and NOT comparable across tips (within one branchId `latest()` already returns the newest). Tombstoned/never-captured keys yield no candidate. Sibling-branch records are invisible by construction.
4. **Seeding sites** (panel.ts): `focusTextField` (entry; explicit `duty` param wins, else current `textDuty`) and `syncBufferToQuestion` (question-change re-scope; compute `desiredTextDuty(this)` BEFORE seeding when `focus === "text"`, else current `textDuty`; keep the existing post-seed duty tail). The ✎ Other accept and text-question entry sites in actions.ts (:216-218, :224-227) need NO change — they pre-set `textDuty = "writein"` and call `focusTextField`.
5. **Intentional empty preserved**: a deliberate `""` at any draft tier beats the recorded answer — the re-opened editor is blank, not the prior answer text (acceptance case 5 reopen limb).
6. **Non-resurrection**: seeds flow only through `TextField.seed/setText` (capture-suppressed — text-field.ts:230-253, already shipped; the seeded answer text must never mint a capture record or overwrite a deliberate durable `""`); reads use only `durable.latest()` (completed saves, tombstone-aware) — never the capture store's in-memory pending state. Discard (blur-back without commit) mutates no answer; S3's tombstone + drop-pending-dirty own the write side — this item only consumes them.
7. **Phantom-draft guard**: when the answer tier produced the seed, mark `{owner, text}`; the `syncBufferToQuestion` write-through and `stageText` skip the slot/seam write when the buffer still byte-equals that un-edited seed and no real draft exists (`freshestDraftFor(owner) === ""`). Any user edit breaks byte-equality → normal write-through. Clear the mark on owner change and in `consumeCommittedBuffer` (S3's site).
8. **Unchanged on purpose**: `draftTextFor` (submit reconciliation) and the sync write-through's `existing` check stay DRAFT-ONLY tiers; `consumeCommittedBuffer`'s `seed("")` stays (S3); note duty stays question-agnostic (sync early-return); side-chat composer and session-start restore are P3.M3.T1.S2.

### Success Criteria

- [ ] Re-open ✎ Other on a `custom:true`-answered question with no drafts → editor seeds exact `answer.value` (acceptance case 5 limb).
- [ ] Re-open Other on an option-answered question → never the option value (invariant test at ladder AND panel level).
- [ ] Text question (`type:"text"`) with recorded answer → `answer.value` seeded (custom gate covers it).
- [ ] Durable recovery draft newer than the answer (`savedAt > at`) → draft wins, byte-exact; deliberate durable `""` newer → blank editor; answer newer (e.g. model-authored `applyChatAnswer` after an old draft) → `answer.value`.
- [ ] Question-change re-scope while text-focused lands on an answered Other/text question with no drafts → answer text seeded (EXPLAIN-002 amendment).
- [ ] Durable record whose branchId is NOT on the current walk (sibling branch) → ignored.
- [ ] Seeding never mints capture (ladder seed then flush → no durable write); un-edited answer seed never becomes a slot/draft (phantom guard).
- [ ] `draftTextFor`, write-through `existing` check, consumeCommittedBuffer, text-field.ts, actions.ts behaviorally unchanged; all pre-existing tests green untouched.

## All Needed Context

### Context Completeness Check

Validated: binding spec bullets + acceptance case 5 + ui-spec EXPLAIN-002 amendment read in full; landed S1/S2 source APIs verified (`input-capture.ts` keying docblock, `input-durability.ts` latest/lookup/DurableValue); S3 PRP consumed as in-flight contract (tombstone semantics, retire sites, applyChatAnswer-retires-nothing, esc-stages); all seeding sites read with anchors (focusTextField, syncBufferToQuestion, actions.ts :216-227, freshestDraftFor, consumeCommittedBuffer, exitTextField/stageText); panel wiring chain (index.ts:166-179 → maybeAutoOpen:3317 → panel deps :282/:665 → setCapture :1251 → branchReader :1713-1724) verified; QuestionAnswer shape incl. the `custom:true`-for-text-answers comment (state.ts:42-54) verified; test-harness conventions located (panel.test.ts EXPLAIN-002 blocks :1710/:2125/:2452, input-durability.test.ts). Full detail: `plan/006_45773b259b06/P3M3T1S1/research/findings.md`.

### Documentation & References

```yaml
- file: spec/state-and-persistence.md
  why: §Local input recovery "Re-edit and commit" bullet + acceptance case 5 — the binding
    ladder, the never-seed-option rule, the intentional-empty rule, the no-resurrection rule
  gotcha: READ-ONLY — never edit spec/

- file: spec/ui-spec.md
  why: :46 EXPLAIN-002 amendment — the re-scope seeding rule this item implements
    ("fall back to the corresponding recorded answer" replaces blank-when-none)
  gotcha: READ-ONLY

- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: design authority — consumers map (this item = the seeding ladder), keying/ancestry
    restore matching ("accept candidates whose branchTipId is ancestor-or-equal of the
    CURRENT tip"), ordering (seq per-key; never timestamps WITHIN the store)
  gotcha: the cross-entity draft-vs-answer comparison uses savedAt vs answer.at — this is
    NOT the in-store ordering the note forbids timestamps for; document the ≤1s flush lag

- file: src/input-durability.ts
  why: the durable read surface — latest(DurableKeyQuery)/DurableValue; undefined-vs-{text:""}
    distinction; session-less query scans by unique branchId. DO NOT MODIFY (S3 in flight);
    the ancestry scan wraps latest() calls from input-restore.ts
  gotcha: DurableKeyQuery REQUIRES branchId — pass each walk entry id separately; tombstoned
    keys return undefined (S3) so they drop out of the scan automatically

- file: src/input-capture.ts
  why: CaptureKey/CaptureField shapes; branchId = RAW walk-tip entry id at capture time
    (docblock) — the ancestry set is just the current walk's entry ids
  gotcha: do not read the capture store's in-memory latest() for seeding — completed
    durable saves only

- file: plan/006_45773b259b06/P3M2T1S3/PRP.md
  why: the retirement CONTRACT — retire sites, tombstone anti-resurrection, applyChatAnswer
    retires nothing, esc stages never clears, consumeCommittedBuffer owns seed("")
  gotcha: S3 lands FIRST (sequential plan) — verify its shipped shapes before consuming

- file: src/panel/panel.ts
  why: the seeding sites — focusTextField (~:2060), syncBufferToQuestion (~:1982, with the
    write-through existing-check that must stay draft-only), freshestDraftFor, draftTextFor,
    consumeCommittedBuffer (~:1803), exitTextField/stageText (~:1621), capture wiring
    (:1249-1252), branchReader/captureBranchId (:1713-1724), deps interfaces (:282/:665)
  pattern: seedTextFor mirrors freshestDraftFor's shape but takes the duty and consults
    input-restore.ts; locate sites by content (comments cite EXPLAIN-002/focusTextField),
    line numbers drift
  gotcha: syncBufferToQuestion seeds BEFORE its duty tail re-derivation — compute the duty
    first (desiredTextDuty when focus === "text") so the ladder gate is correct

- file: src/panel/actions.ts
  why: :216-218 / :224-227 — text-question entry and ✎ Other accept pre-set
    textDuty="writein" then call focusTextField (seeding flows through the panel); writeInEnter
    exits (:422-530) and consumeCommittedBuffer are S3's — do not touch
  gotcha: expected UNTOUCHED by this item; verify by grep that no other direct seed call exists

- file: src/panel/text-field.ts
  why: seed/setText capture suppression (:230-253) — the load-bearing anti-resurrection
    property that keeps ladder seeds from minting captures. Expected UNTOUCHED
  gotcha: never seed via a path that bypasses setText (e.g. editor.setText directly)

- file: src/state.ts
  why: QuestionAnswer {value, at: string(ISO), custom?} — :52 comment: type:"text" answers
    ALSO carry custom:true; the single gate duty==="writein" && custom===true implements
    "never seed Other with an option value"

- file: src/index.ts
  why: wiring — durableInputs constructed :166, inputCapture threaded :167-179 into
    maybeAutoOpen; thread durableInputs through the SAME chain (panel.ts:3317 signature)
  gotcha: panel gets a NARROW read dep (Pick<DurableInputStore, "latest">-shaped) — panels
    are disposable, the store is extension-lifetime

- file: src/panel/panel.test.ts
  why: panel harness (createPanelHost, makeMockLifecycle) + the EXPLAIN-002 test blocks
    (:1710, :2125, :2452) — extend the pattern for the ladder tests

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format
  why: ISO-8601 extended strings (Date.toISOString output) compare chronologically as
    plain strings — the savedAt vs answer.at comparison; same-clock, same-format assumption
    documented in code
```

### Current Codebase tree (relevant slice)

```bash
src/input-capture.ts            # S1 — CaptureKey/field shapes (READ-ONLY here)
src/input-durability.ts         # S2 — DurableInputStore.latest read surface (READ-ONLY here; S3 editing)
src/panel/panel.ts              # seeding sites + write-through + deps + branchReader
src/panel/actions.ts            # Other accept / text entry → focusTextField (untouched)
src/panel/text-field.ts         # capture-suppressed seed/setText (untouched)
src/index.ts                    # durableInputs :166 → maybeAutoOpen wiring
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/input-restore.ts            # CREATE — pure ladder recoverySeedText + ancestry-gated
                                 #   latestDraftOnLineage over DurableInputStore.latest();
                                 #   exported for P3.M3.T1.S2 (session-start/composer reuse)
src/input-restore.test.ts       # CREATE — every ladder rule as pure unit tests
src/panel/panel.ts              # MODIFY — seedTextFor at the two seeding sites, phantom guard,
                                 #   durableInputs dep threading
src/index.ts                    # MODIFY — pass durableInputs into maybeAutoOpen/panel chain
src/panel/panel.ts maybeAutoOpen signature  # MODIFY — +durableInputs param (last, optional)
src/panel/panel.test.ts         # EXTEND — ladder behavior at the real seeding sites (or a
                                 #   sibling test file reusing its harness helpers)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: answerEligible = duty === "writein" && answer?.custom === true — custom:true
// covers ✎ write-ins AND type:"text" answers (state.ts:52). An option answer NEVER seeds
// the Other editor; elaboration duty NEVER seeds from the answer at all.
// CRITICAL: exact-branchId latest() MISSES live-session drafts — the walk tip grows as turns
// append; capture keys used the tip AT EDIT TIME. The ancestry scan over walk entry ids is
// mandatory, not an optimization.
// CRITICAL: seq is per-canonical-key — two candidates with different branchIds have
// INDEPENDENT counters; order cross-branch candidates by savedAt (ISO), tie → later in walk.
// GOTCHA: savedAt is flush-time (≤1s after the keystrokes); answer.at is commit time. The
// strict savedAt > at comparison is only load-bearing where no handoff retire happened
// (applyChatAnswer — model-authored, retires nothing); handoff windows are tombstoned and
// the kill-between-commit-and-retire case leaves draft text byte-identical to the answer.
// GOTCHA: undefined durable = never captured OR tombstoned; {text:"", seq} = DELIBERATE
// empty — it wins over the answer ("preserve the empty editor"), never treated as absent.
// GOTCHA: seed ONLY through TextField.seed/setText (captureSuppressed) — a seed that minted
// a capture would overwrite a deliberate durable "" with the answer text (resurrection).
// GOTCHA: keep draftTextFor and the sync write-through existing-check on the DRAFT-ONLY
// tiers — answer fallback there would re-ship committed answers at submit and corrupt the
// absent-draft discipline ("empty slot = absent draft").
// GOTCHA: S3 is landing additive changes to input-durability.ts/input-capture.ts — this item
// adds NO method there (ancestry scan calls latest() from outside); expect S3's shapes.
// GOTCHA: ISO strings compare chronologically only in the same format/timezone — both
// savedAt and answer.at are Date.toISOString() output (Z, ms precision); document the
// assumption next to the comparison.
// GOTCHA: eslint unused vars need leading underscore; vitest fake timers for capture pacing
// assertions; panel tests use createPanelHost/makeMockLifecycle (panel.test.ts).
```

## Implementation Blueprint

### Data models and structure

```ts
// src/input-restore.ts — pure, no panel imports, no node:fs
import type { CaptureField, CaptureKey } from "./input-capture.js";
import type { DurableValue } from "./input-durability.js";

/** Narrow read surface the panel receives (DurableInputStore satisfies it). */
export interface DurableRead {
  latest(query: { branchId: string; questionId?: string | "-"; field: CaptureField }): DurableValue | undefined;
}

/** The recorded answer, narrowed to what the ladder needs. */
export interface SeedAnswer { value: string; at: string; custom?: boolean }

export interface SeedInputs {
  slotText: string | undefined;   // draftSlots.get(q)?.text — undefined = absent ("" = deliberate)
  seamText: string | undefined;   // drafts.getDraft(q) — same semantics
  durable: DurableValue | undefined; // ancestry-resolved recovery record (may be {text:""})
  answer: SeedAnswer | undefined;    // recorded answer, any status
  answerEligible: boolean;           // duty === "writein" && answer.custom === true (caller)
}

/** The ladder — spec :140 "Re-edit and commit". Returns the seed string verbatim. */
export function recoverySeedText(inputs: SeedInputs): string;

/**
 * Newest recovery record for {questionId, field} whose capture tip is on the CURRENT walk
 * (ancestor-or-equal): per walk entry id, latest({branchId: id, questionId, field});
 * best by savedAt (ISO, missing treated as oldest), tie → later position in the walk.
 * walk = branchReader.getBranch() entries (oldest→newest; newest = leaf).
 */
export function latestDraftOnLineage(
  durable: DurableRead, walkIds: readonly string[],
  key: { questionId: string; field: Extract<CaptureField, "writein" | "elaboration"> },
): DurableValue | undefined;

/** Caller-side gate — keep the option-value invariant in ONE place (re-exported for tests). */
export function answerSeedEligible(duty: "writein" | "elaboration", answer: SeedAnswer | undefined): boolean;
// = duty === "writein" && answer?.custom === true
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY contract inputs (read pass)
  - READ shipped src/input-durability.ts + src/input-capture.ts APIs; READ S3's landed
    retire/tombstone (S3 lands FIRST — plan order); confirm latest() tombstone behavior
  - GREP src/panel/actions.ts for any direct textField.seed call beyond focusTextField
    (expected: none — the two Other/text entry sites route through focusTextField)

Task 1: CREATE src/input-restore.ts
  - IMPLEMENT: recoverySeedText (ladder What §1), latestDraftOnLineage (ancestry scan,
    savedAt ordering, walk-position tie-break), answerSeedEligible
  - PURE: no panel/state imports, no fs, no events; JSDoc cites spec :140 + ui-spec :46 +
    the architecture note's ancestry rule + the savedAt flush-lag tolerance
  - NAMING: input-restore.ts; exported names exactly as in the data model (P3.M3.T1.S2
    consumes them)

Task 2: CREATE src/input-restore.test.ts
  - LADDER GROUPS (pure): slot wins (incl. deliberate ""); seam wins when slot absent;
    durable wins when no in-memory tiers (incl. deliberate "" over absent answer);
    durable-vs-answer: savedAt > at → draft; savedAt < at → answer.value (applyChatAnswer
    shape); tie AND missing savedAt → answer; no answer → draft always
    ANSWER GATE GROUPS: custom:true write-in seeded; custom:true text answer seeded;
    option answer (custom unset) NEVER seeded → falls to blank; elaboration duty NEVER
    seeds from answer (drafts still eligible)
    ANCESTRY GROUP: candidate branchId in walk → accepted; sibling-branch id → ignored;
    savedAt ordering across two accepted candidates; tie → later walk position; empty walk
    → undefined; {text:"", seq} flows through as a deliberate empty
    INVARIANT: for ALL option-valued answers the returned seed ≠ answer.value unless it
    independently came from a draft tier (property-style loop over the option gate cases)

Task 3: MODIFY src/panel/panel.ts — the ladder at the seeding sites
  - ADD optional dep `durableInputs?: DurableRead` to BOTH panel deps interfaces (:282-adjacent
    options and :665-adjacent construction params; mirror the inputCapture docblock pattern)
  - ADD private seedTextFor(id: string | undefined, duty: "writein" | "elaboration"): string:
    slot = draftSlots.get(id)?.text; seam = drafts?.getDraft(id); durable =
    durableInputs ? latestDraftOnLineage(durableInputs, walkIds(), {questionId: id,
    field: duty === "writein" ? "writein" : "elaboration"}) : undefined; answer =
    state.getQuestion(id)?.answer narrowed to SeedAnswer; return recoverySeedText({...})
    — walkIds(): try branchReader.getBranch().map(e=>e.id), catch → [] (hostile-surface
    pattern of captureBranchId :1717-1724)
  - SITE focusTextField: replace `this.textField.seed(this.freshestDraftFor(this.currentId))`
    with `this.textField.seed(this.seedTextFor(this.currentId, duty ?? this.textDuty))`
    (the explicit param wins; the actions.ts pre-set textDuty covers the omitted case);
    set answerSeed mark when the answer tier produced the text
  - SITE syncBufferToQuestion: compute `const seedDuty = this.focus === "text" ?
    desiredTextDuty(this) : this.textDuty;` BEFORE the seed (cursor already re-seeded by the
    currentId setter); replace `const draft = this.freshestDraftFor(id);
    this.textField.seed(draft)` with seedTextFor(id, seedDuty); KEEP the existing
    post-seed `textDuty = desiredTextDuty(this)` tail unchanged
  - PHANTOM GUARD: private answerSeed: {owner: string; text: string} | undefined; set at
    both seed sites ONLY when the answer tier won (seedTextFor can return the source tier);
    in the sync write-through and stageText: skip the draftSlots.set/setDraft (and
    saveTextDraft stage) when answerSeed matches {owner, text byte-equal} AND
    freshestDraftFor(owner) === ""; clear answerSeed on owner change and in
    consumeCommittedBuffer
  - PRESERVE: the write-through existing-check (freshestDraftFor stays draft-only),
    draftTextFor (draft-only), consumeCommittedBuffer's seed(""), note-duty early-return,
    freshestDraftFor itself (still used by existing-check/draftTextFor)
  - DO NOT touch actions.ts / text-field.ts (Task 0 verified no direct seed sites)

Task 4: WIRE src/index.ts + maybeAutoOpen
  - maybeAutoOpen signature (panel.ts:3317): append optional `durableInputs?: DurableRead`
    (LAST — existing call sites compile; the inputCapture precedent note)
  - index.ts :175-179: pass `durableInputs` (constructed :166) as the new last arg; the
    panel construction path threads it into deps alongside inputCapture

Task 5: PANEL TESTS (extend src/panel/panel.test.ts or a sibling file reusing its harness)
  - GROUP re-open committed answers: custom write-in → editor text === answer.value;
    type:"text" answered → answer.value; option-answered → Other editor NOT the option
    value (blank absent drafts)
  - GROUP re-scope (EXPLAIN-002 amendment): navigate while text-focused onto an answered
    Other/text question with no drafts → buffer seeded answer.value (extend the existing
    EXPLAIN-002 test block pattern :1710+)
  - GROUP durable tier (fake durableInputs object returning canned DurableValues; branch
    stub via branchReader): newer draft wins byte-exact; deliberate durable "" → blank
    editor despite recorded answer; sibling-branch branchId (not in walk) → ignored
  - GROUP anti-resurrection: seed from answer → advance fake timers past flush window →
    capture store recorded NOTHING (captureSuppressed path); un-edited navigation after
    answer seeding → draftSlots/drafts unchanged (phantom guard); blur-back without commit
    → state answers unchanged (discard leaves the recorded answer intact)
  - GROUP unchanged seams: draftTextFor returns undefined for an answered question with no
    draft; existing write-through discipline tests still green

Task 6: VALIDATE
  - npm test && npm run typecheck && npm run lint
  - npx vitest run src/input-restore.test.ts src/panel/panel.test.ts
    src/input-durability.test.ts src/input-capture.test.ts src/panel/sidechat-cache-isolation.test.ts
    src/panel/editor-preservation.test.ts   # all green
```

### Implementation Patterns & Key Details

```ts
// The ladder — pure, total, no early returns hidden behind casts:
export function recoverySeedText(i: SeedInputs): string {
  if (i.slotText !== undefined) return i.slotText;        // deliberate "" preserved
  if (i.seamText !== undefined) return i.seamText;
  if (i.durable !== undefined) {
    const newerThanAnswer =
      i.answer !== undefined && i.answerEligible
        ? (i.durable.savedAt !== undefined && i.durable.savedAt > i.answer.at) // strict; tie → answer
        : true;                                             // no opponent → draft wins ("" included)
    if (newerThanAnswer) return i.durable.text;            // deliberate "" preserved
  }
  if (i.answerEligible && i.answer !== undefined) return i.answer.value; // verbatim, untrimmed
  return "";
}

// Ancestry scan — walk ids ARE the branchId vocabulary (raw tip entry ids):
export function latestDraftOnLineage(durable, walkIds, key): DurableValue | undefined {
  let best: DurableValue | undefined; let bestAt = "";
  for (const id of walkIds) {                              // oldest → newest
    const v = durable.latest({ branchId: id, questionId: key.questionId, field: key.field });
    if (v === undefined) continue;                         // never captured OR tombstoned
    const at = v.savedAt ?? "";                            // missing savedAt = oldest
    if (best === undefined || at >= bestAt) { best = v; bestAt = at; } // >= : later walk pos wins ties
  }
  return best;
}

// Panel seed site (syncBufferToQuestion tail) — duty BEFORE seed:
this.bufferOwner = id;
const seedDuty = this.focus === "text" ? desiredTextDuty(this) : this.textDuty;
const seeded = this.seedTextFor(id, seedDuty);             // {text, tier} — mark answerSeed on tier === "answer"
this.textField.seed(seeded.text);                          // captureSuppressed — never mints
if (this.focus === "text") { this.textDuty = desiredTextDuty(this); } // unchanged tail

// Phantom guard (write-through + stageText share it):
private stageOwnerText(id: string, text: string): void {   // call instead of raw setDraft
  if (this.answerSeed?.owner === id && this.answerSeed.text === text
      && this.freshestDraftFor(id) === "") return;         // un-edited answer seed — absent draft
  this.draftSlots.set(id, { value: id, text });
  this.drafts?.setDraft(id, text);
}
```

### Integration Points

```yaml
UPSTREAM:
  - DurableInputStore.latest() — the ONLY durable read; no method added (S3 owns that file
    concurrently; ancestry logic lives in input-restore.ts)
  - InputCaptureStore — untouched this item; captureSuppressed seeding already shipped
  - S3 retirement — consumed: tombstone ⇒ latest() undefined ⇒ answer tier; handoff retire
    sites already delete slots/clear seams (consumeCommittedBuffer)

WIRING:
  - index.ts: pass durableInputs (extension-lifetime, constructed :166) into
    maybeAutoOpen → panel deps, exactly like inputCapture; panel is disposable

DOWNSTREAM (design for, do NOT implement):
  - P3.M3.T1.S2 consumes latestDraftOnLineage + recoverySeedText for session-start restore
    (FR-28) and the side-chat composer; P3.M5.T1.S1 scripts acceptance case 5 end-to-end

OUT OF SCOPE: session-start restore/composer (S2), blank rejection at applyAnswer (P3.M4),
  note-duty seeding, README/spec docs (P3.M5.T1.S2), config keys
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck && npm run lint
# Expected: zero errors. Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/input-restore.test.ts -v      # every ladder rule, pure
npx vitest run src/panel/panel.test.ts -v        # seeding sites + guards
# Full suite:
npm test
# Expected: all green, including untouched S1/S2/S3 suites and guard tests.
```

### Level 3: Boundary & Guard Checks

```bash
git diff --name-only
# Expected EXACTLY: src/input-restore.ts(+test), src/panel/panel.ts,
#   src/panel/panel.test.ts (or new sibling test file), src/index.ts
grep -n "applyAnswer\|setStatus\|retire\|clearDraft" src/input-restore.ts   # no matches (inert)
grep -n "node:fs\|import.*panel" src/input-restore.ts                      # no matches (pure)
git diff src/panel/actions.ts src/panel/text-field.ts src/input-durability.ts src/input-capture.ts
# Expected: empty (untouched)
npx vitest run src/panel/sidechat-cache-isolation.test.ts src/panel/editor-preservation.test.ts src/no-hardcoded-keys.test.ts
# green, untouched
```

### Level 4: Domain-Specific Validation (acceptance-casing)

```bash
# Case 5 reopen limbs (panel harness or manual script of the same steps):
#  1. commit a write-in; re-open ✎ Other → editor shows the exact committed value
#  2. delete the buffer to empty; blur WITHOUT commit; re-open → BLANK editor
#     (newer edit wins; the recorded answer unchanged in state)
#  3. option-answered question; re-open ✎ Other → NOT the option value
#  4. canned durable draft with savedAt > answer.at → draft text seeded byte-exact;
#     branchId not in walk → ignored (sibling branch)
# Optional manual spot-check with a real DurableInputStore on a tmpdir:
npx tsx -e 'import {DurableInputStore} from "./src/input-durability.js"; import {latestDraftOnLineage, recoverySeedText} from "./src/input-restore.js"; const d=new DurableInputStore({dir:"/tmp/seed-check"}); d.write({session:"s",branchId:"t1",questionId:"q",field:"writein",text:"draft",seq:1}); console.log(latestDraftOnLineage(d,["t1"],{questionId:"q",field:"writein"}), recoverySeedText({slotText:undefined,seamText:undefined,durable:{text:"draft",seq:1,savedAt:d.latest({branchId:"t1",questionId:"q",field:"writein"})?.savedAt},answer:{value:"old",at:"2000-01-01T00:00:00.000Z",custom:true},answerEligible:true}));'
# Expected: the draft value, not "old"
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; `npm test`, `npm run typecheck`, `npm run lint` green.
- [ ] Ladder unit tests cover every rule incl. deliberate-empty, tie/missing-savedAt, option gate.
- [ ] Panel tests cover both seeding sites (entry + re-scope), ancestry gate, capture suppression, phantom guard.
- [ ] Boundary checks: diff confined to the four declared files; actions.ts/text-field.ts/input-durability.ts/input-capture.ts untouched.

### Feature Validation

- [ ] All "What" §1-8 behaviors implemented and test-covered; success criteria boxes all pass.
- [ ] Case-5 reopen limbs scripted green (exact value; newer blank edit wins; option value never).
- [ ] Discard (blur-back) leaves the recorded answer intact; no delayed save or seed resurrects a discarded draft (tombstone-aware reads; capture-suppressed seeds).

### Code Quality Validation

- [ ] input-restore.ts is pure/inert (no panel/state/fs imports; no answer mutation surface).
- [ ] draftTextFor / existing-check / consumeCommittedBuffer semantics unchanged.
- [ ] Naming/placement match the desired tree; no new config keys.

### Documentation & Deployment

- [ ] JSDoc cites spec :140, ui-spec :46, the architecture note, and the savedAt flush-lag tolerance.
- [ ] No new env vars; no UI surface changes beyond seeded editor text.

## Anti-Patterns to Avoid

- ❌ Don't seed the writein editor from a non-custom answer — `custom === true` is the gate, `answer.value` of an option answer must never appear as editor text.
- ❌ Don't conflate `latest() === undefined` with `{text:""}` — deliberate empty beats the answer; absent falls through.
- ❌ Don't use exact-branchId lookups — the walk tip grows; only the ancestry scan sees live-session drafts.
- ❌ Don't compare `seq` across branchIds — independent counters; savedAt + walk position order cross-branch candidates.
- ❌ Don't extend the answer fallback to `draftTextFor`, the write-through existing-check, or elaboration duty.
- ❌ Don't add methods to input-durability.ts/input-capture.ts (S3 in flight) or touch actions.ts/text-field.ts.
- ❌ Don't seed through any path that mints a capture (only `TextField.seed/setText`), and don't let an un-edited answer seed become a phantom draft.
- ❌ Don't implement blank rejection here — capture saves "" freely; rejection lives at applyAnswer (P3.M4).

---

**Confidence Score**: 9/10 — every mechanism verified against landed source (branchId = raw tip id; custom:true covers text answers; capture suppression shipped; S1/S2/S3 contracts read as PRPs + code); the ancestry scan and phantom guard are the only designed-here elements, both resolved in findings.md §4. Residual risk: S3's shipped tombstone shape drift (Task 0 verifies), and panel.ts line drift (locate by content).

---
name: "P1.M1.T6.S2 — ApplyDecision contract + pendingConfirm state with autoApply bypass"
description: "EDIT src/panel/sidechat.ts (pure leaf store, zero pi imports): the ApplyDecision union ({seam:\"acceptOptionIndex\", optionIndex: DISPLAY position} | {seam:\"writeIn\", text: VERBATIM}), pure `toApplyDecision(parsed, question)` mapping ParsedAnswer (P1.M1.T6.S1) through an inlined D-R13 display-order mirror, store composer `settleApplyDecision(record, replyText, question, autoApply)` (parse → map → pendingConfirm bookkeeping: set iff decision && !autoApply; cleared on autoApply and on no-decision — latest reply governs; returns the decision as immediately-applyable under autoApply), `clearPendingConfirm(record)` decline seam, and the `pendingConfirm?: ApplyDecision` field on SidechatRecord. EDIT src/panel/sidechat-engine.ts: two OPTIONAL deps — `answerContext?: (questionId) => { question, autoApply } | undefined` and `onAutoApply?: (decision) => void` — wired at the ONE freeze site (after usage tally) so a completed reply settles its answer decision without the engine ever touching the apply seams (panel-view-integration.md: engine produces, panel routes). EXTEND both test files. Four files, additive only. Consumed by P1.M2.T1.S2 (confirm row) and P1.M2.T6.S1 (single routing consumer)."
---

## Goal

**Feature Goal**: Close the engine side of SIDECHAT-004: when a completed side-chat reply carries an applicable answer block (T6.S1's `ParsedAnswer`), the system produces a routing-ready `ApplyDecision` naming the ordinary apply seam (option index for the display domain, or verbatim write-in text), maintains `pendingConfirm` confirm-state on the singleton record when confirmation is required (`sideChatAutoApply: false`, the default), and exposes the decision as immediately-applyable when `sideChatAutoApply: true` — with the engine never calling `acceptOptionIndex` or the write-in commit path itself (it is UI-free; the panel routes, per panel-view-integration.md).

**Deliverable**:
1. EDIT `src/panel/sidechat.ts` — `ApplyDecision` type; pure `toApplyDecision(parsed, question)`; store composer `settleApplyDecision(record, replyText, question, autoApply)`; decline seam `clearPendingConfirm(record)`; `pendingConfirm?: ApplyDecision` field on `SidechatRecord`. Mode A doc comments; zero pi imports preserved.
2. EDIT `src/panel/sidechat-engine.ts` — `SidechatAnswerContext` type + two optional `SidechatEngineDeps` members (`answerContext`, `onAutoApply`); freeze-site wiring (single block, after the usage tally).
3. EXTEND `src/panel/sidechat.test.ts` — new describe block (decision mapping both seams, display-order vectors, pendingConfirm set/skipped per autoApply, supersede/decline clears, reset/discard lifecycle).
4. EXTEND `src/panel/sidechat-engine.test.ts` — freeze-site wiring rows (settle fires with context, callback only under autoApply, inert without deps, stale question, abort untouched).

**Success Definition**: `npx vitest run src/panel/sidechat.test.ts` and `npx vitest run src/panel/sidechat-engine.test.ts` green (existing rows unregressed); `npx vitest run src/panel/`, `npm test`, `npm run typecheck`, `npm run lint` clean; walls hold (`grep @earendil src/panel/sidechat.ts` empty; banned-API names absent even in comments; `actions.ts` unimported by both edited modules); `git diff --stat` touches exactly the four files.

## User Persona (if applicable)

**Target User**: The pi user side-chatting about one interrogation question (SIDECHAT-001) with `sideChatAutoApply` at its default `false`.

**Use Case**: The side model's completed reply ends in a valid ` ```answer ` block; instead of the user retyping the answer into the panel, the panel offers the confirm row `apply ★ sqlite? · enter = yes · esc = no`; `enter` applies through the ordinary seams exactly as a hand-made selection would. Users who opt into `sideChatAutoApply: true` skip the confirm entirely.

**User Journey**: reply settles → engine freeze site fires `settleApplyDecision` → manual: `record.pendingConfirm` set → (M2.T1.S2) confirm row renders → (M2.T6.S1) `enter` routes the decision through `acceptOptionIndex`/write-in; `esc` calls `clearPendingConfirm`. Auto: decision returned → engine fires `onAutoApply` → (M2.T6.S1's binding) applies immediately, no confirm state ever exists.

**Pain Points Addressed**: losing the converged answer between chat and panel (retyping); mistrust of silent model-side writes (confirm is the default; autoApply is an explicit opt-in); provenance fear (decision only NAMES the seams — application goes through the exact user-path machinery, byte-identical, no marker).

## Why

- Spec authority: sidechat-contracts.md §SIDECHAT-004 — "`sideChatAutoApply: true` (default false) bypasses the confirm"; "`enter` applies through the ORDINARY seams… BYTE-IDENTICAL to user-made answers"; "`esc` declines, keeps the chat open". panel-view-integration.md §Open/replace/discard — "the engine must never touch them directly (it is UI-free) — it produces a decision, the panel routes it"; "no new answer path may be added".
- Upstream is ready: T6.S1 (landing immediately before this task) provides `parseAnswerBlock` + `ParsedAnswer` in sidechat.ts; T5.S2's freeze site (sidechat-engine.ts route(), ~L266–284) is the ONE place a completed reply's canonical text exists, already liveness-guarded, already abort-rollback-correct; config carries `sideChatAutoApply` (default false, config.ts:97/134/257).
- Downstream dependents: P1.M2.T1.S2 renders the confirm row off `record.pendingConfirm`; P1.M2.T6.S1 is the single routing consumer — it binds `answerContext`/`onAutoApply` at the engine-creation site and routes decisions through `acceptOptionIndex` (actions.ts:268–331) / the write-in commit path (actions.ts:384–518); M2.T5.S1's discard hooks rely on `discard()`/`resetChat()` naturally clearing confirm state (record replacement).
- DOCS: none — internal contract (Mode A doc comments only); README coverage is M3.T3.S1.

## What

**The contract being implemented** (item + SIDECHAT-004 + panel-view-integration.md, consolidated):

```ts
// sidechat.ts
export type ApplyDecision =
  | { seam: "acceptOptionIndex"; optionIndex: number }  // DISPLAY position (D-R13 domain — acceptOptionIndex maps display→option at its single seam)
  | { seam: "writeIn"; text: string };                   // the parsed text, VERBATIM (untrimmed)

export function toApplyDecision(parsed: ParsedAnswer, question: Question): ApplyDecision | undefined;
//  kind "value" → display index of the byte-matched option; kind "text" → {seam:"writeIn", text} verbatim;
//  kind "none" → undefined; value not found in the display order (unreachable via settle; defensive) → undefined.

export function settleApplyDecision(
  record: SidechatRecord, replyText: string, question: Question, autoApply: boolean,
): ApplyDecision | undefined;
//  decision = toApplyDecision(parseAnswerBlock(replyText, (question.options ?? []).map(o => o.value)), question)
//  decision && !autoApply → record.pendingConfirm = decision; return decision   (confirm state)
//  decision &&  autoApply → record.pendingConfirm = undefined; return decision  (immediately-applyable)
//  no decision            → record.pendingConfirm = undefined; return undefined (latest reply governs)

export function clearPendingConfirm(record: SidechatRecord): void;  // the esc/decline seam (M2.T6.S1 calls)

// SidechatRecord gains: pendingConfirm?: ApplyDecision  (after streamingText)

// sidechat-engine.ts
export interface SidechatAnswerContext { question: Question; autoApply: boolean; }
// SidechatEngineDeps gains (both OPTIONAL — absent deps = byte-identical T5 behavior):
//   answerContext?: (questionId: string) => SidechatAnswerContext | undefined;
//   onAutoApply?: (decision: ApplyDecision) => void;
// Freeze site (route(), inside `if (message !== undefined)`, AFTER the usage tally):
//   ctx = deps.answerContext?.(record.questionId); if undefined → skip (stale/unknown question = no-op);
//   decision = settleApplyDecision(record, frozenText, ctx.question, ctx.autoApply);
//   if (decision !== undefined && ctx.autoApply && deps.onAutoApply) deps.onAutoApply(decision);
```

**State-transition rules (pinned)**:
- `pendingConfirm` is set ONLY by `settleApplyDecision` with a decision under manual mode; cleared by: a later reply's settle (whether it yields a new decision — replace — or none — supersede-clear), `clearPendingConfirm` (decline), `resetChat`/record replacement (fresh record), `discard` (singleton gone).
- An aborted turn never settles → an earlier reply's `pendingConfirm` survives ("the turn never happened").
- `openOrReplace` same-question reuse returns the record byte-unchanged → `pendingConfirm` survives an `e` toggle (the confirm row persists while the chat is open).
- autoApply + no `onAutoApply` dep bound: decision computes, nothing stores it, nothing fires — safe no-op (engine tests without the dep behave exactly as T5 landed).

### Success Criteria

- [ ] `toApplyDecision({kind:"value", value:"sqlite"}, q)` where q.options = [postgres, sqlite], no recommendation → `{seam:"acceptOptionIndex", optionIndex:1}`; with `recommendation:"sqlite"` → `optionIndex:0` (D-R13 display order)
- [ ] `toApplyDecision({kind:"text", text:" padded "}, textQ)` → `{seam:"writeIn", text:" padded "}` (verbatim)
- [ ] `toApplyDecision({kind:"none", reason:any}, q)` → `undefined`
- [ ] Manual settle of a reply containing a valid block → `record.pendingConfirm` deep-equals the decision AND the return equals it; autoApply settle of the same reply → `pendingConfirm` `undefined`, return still the decision
- [ ] pendingConfirm set, then a later no-decision reply settles → cleared; then `clearPendingConfirm` on a set record → cleared
- [ ] Engine: freeze with `answerContext` (manual, valid block) → record.pendingConfirm set after settle; with `autoApply:true` + `onAutoApply` spy → spy called ONCE with the decision, pendingConfirm absent; without deps → nothing set, no throw; `answerContext` returning `undefined` → no-op; aborted turn → no settle, prior pendingConfirm untouched
- [ ] sidechat.ts and sidechat-engine.ts add NO imports of `src/panel/actions.ts` and NO `@earendil` imports into sidechat.ts

## All Needed Context

### Context Completeness Check

This PRP carries: the full ApplyDecision contract with the display-position subtlety (D-R13) explained, the verbatim-text rule, the complete pendingConfirm transition table, the exact freeze-site insertion point with before/after ordering, the dep-injection shapes the panel will bind in M2.T6.S1, the inlined-mirror justification (pi-import wall vs single-sourced ordering), collision anchors against the parallel-landed T6.S1 edits, and runnable gates. An implementer needs only this document plus the four named files.

### Documentation & References

```yaml
- file: src/panel/sidechat.ts
  why: "THE store — types + functions join here; classifyChatCommand/openOrReplace/resetChat/discard are the placement precedents; SidechatRecord gains one field"
  pattern: "record-based mutators (record param, caller owns the singleton identity); Mode A doc comments citing contract ids + subtask ids; module-scope `let current` singleton"
  gotcha: "ZERO pi imports is load-bearing (M3.T1 guard). Import ONLY `type Question` from ../state.js (state.ts verified pi-free). NEVER import displayOptions from short-view.ts (it pulls pi-tui)."

- file: src/panel/sidechat-engine.ts
  why: "the settle seam — route()'s freeze block (~L266–284) is where the completed reply's canonical text exists; SidechatEngineDeps (L89–93) is the injection-bag precedent the two new optional deps extend"
  pattern: "deps bag: everything ctx-flavored arrives injected (port/registry/notify today); settle()'s liveness guard already excludes dead/replaced records before route runs"
  gotcha: "engine already has callers? NO — createSidechatEngine has zero call sites (panel binding is P1.M2.T6.S1's job). Do NOT instantiate it anywhere."

- file: src/panel/short-view.ts (L95–116, displayOptions)
  why: "the D-R13 authority — recommended-first (if recommendation byte-matches an option), rest in state order; acceptOptionIndex (actions.ts:268) speaks DISPLAY positions, so the decision's optionIndex must be computed in this order"
  pattern: "READ ONLY — mirror the 6-line ordering inline in sidechat.ts as a module-local helper, doc-cross-referenced to displayOptions as the authority, pinned by test vectors"
  gotcha: "do NOT import it (pi imports); do NOT reorder by label — value byte-match only"

- file: src/panel/actions.ts (L268–331 acceptOptionIndex; L384–518 write-in commit region)
  why: "the seams the decision NAMES — read the L268 D-R13 comment and the write-in region's post-commit ordering to understand WHY optionIndex is display-domain and why provenance must stay byte-identical"
  pattern: "READ ONLY — the seam names in ApplyDecision are routing labels for M2.T6.S1; this task never imports actions.ts"
  gotcha: "the ONLY sanctioned apply seams (panel-view-integration.md) — engine/store touching them directly is the violation this contract exists to prevent"

- file: src/state.ts (L32–39 QuestionOption; ~L60–76 Question)
  why: "the Question/QuestionOption shapes toApplyDecision consumes — options?: QuestionOption[] (optional — text questions have none), recommendation?: string, QuestionOption.value is the answer-echo field"
  pattern: "type-only import (`import type { Question }`) — state.ts is pi-free, verified"
  gotcha: "options is OPTIONAL: always `(question.options ?? [])` — a bare .map on a text question throws"

- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  section: "§SIDECHAT-004 — answer protocol + indistinguishable provenance"
  why: "binding: autoApply default false bypasses confirm; enter = ordinary seams; esc declines, chat stays open; byte-identical, no marker, no new answer path"

- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  section: "§Open/replace/discard wiring (Apply path bullet)"
  why: "binding: the two seams + their line ranges; 'engine produces a decision, the panel routes it' — the sentence that fixes onAutoApply as an injected callback, not engine routing"

- file: plan/005_af804251f18d/P1M1T6S1/PRP.md
  why: "the IMMEDIATE upstream contract — ParsedAnswer/AnswerBlockRejection shapes settleApplyDecision consumes; its insertion anchors (types after SidechatNotice, function after classifyChatCommand) define the collision map; its 'parseAnswerBlock has exactly ONE reference' gate EXPIRES when this task lands (settleApplyDecision is the second sanctioned reference)"

- file: plan/005_af804251f18d/P1M1T6S2/research/notes.md
  why: "full research record: verified codebase facts, the five design decisions with alternatives, collision map, gate deltas"
```

### Current Codebase tree (relevant slice)

```bash
src/
├── state.ts                    # Question/QuestionOption — pi-free; type-only import source
└── panel/
    ├── sidechat.ts             # pure leaf store — EDIT (types, 3 functions, 1 record field)
    ├── sidechat.test.ts        # EDIT: new describe block (T6.S1 lands its own in parallel-then-merge)
    ├── sidechat-engine.ts      # EDIT: SidechatAnswerContext + 2 optional deps + freeze-site wiring
    ├── sidechat-engine.test.ts # EDIT: freeze-site wiring rows (T6.S1 does NOT touch this file)
    ├── short-view.ts           # READ ONLY (displayOptions — the D-R13 authority, pi-imported, unimportable)
    └── actions.ts              # READ ONLY (the named seams; never imported by this task's files)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Four edits:
# src/panel/sidechat.ts          — ApplyDecision + toApplyDecision (pure) + settleApplyDecision
#                                   (store composer) + clearPendingConfirm + SidechatRecord.pendingConfirm
# src/panel/sidechat.test.ts     — "toApplyDecision / settleApplyDecision — ApplyDecision contract,
#                                   pendingConfirm, autoApply bypass (SIDECHAT-004)" describe (~12 rows)
# src/panel/sidechat-engine.ts   — SidechatAnswerContext + answerContext/onAutoApply deps + freeze-site call
# src/panel/sidechat-engine.test.ts — freeze-site wiring rows (~6 rows)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: optionIndex is a DISPLAY position, not a state index. actions.acceptOptionIndex does
#   displayOptions(q)[optionIndex] (D-R13: recommended first, rest in state order). A decision built
#   from question.options order would apply the WRONG ROW whenever a recommendation exists. Mirror
#   displayOptions' ordering inline (sidechat.ts cannot import it — pi-tui transitively) and pin the
#   reorder with test vectors (options [a,b,c] + recommendation c → indexes c:0, a:1, b:2).

# CRITICAL: the write-in text is carried VERBATIM. T6.S1 returns the parsed text untrimmed; this
#   task forwards it byte-identically. Trimming here would break the byte-identical-provenance rule
#   (SIDECHAT-004 owner ruling) and desync from what the confirm row shows vs what gets committed.

# CRITICAL: sidechat.ts stays ZERO-pi-import (`grep -n "@earendil" src/panel/sidechat.ts` empty).
#   The ONLY new import allowed is `import type { Question } from "../state.js"` (state.ts verified
#   pi-free). The five banned SIDECHAT-005 API names appear NOWHERE — not even in comments.

# CRITICAL: the engine/store NEVER import src/panel/actions.ts. ApplyDecision's seam strings are
#   ROUTING LABELS for M2.T6.S1 ("engine produces a decision, the panel routes it"). Any direct call
#   to acceptOptionIndex/writeIn from sidechat*.ts is the architectural violation.

# CRITICAL: a no-decision reply CLEARS a previously set pendingConfirm (supersede). The model's
#   LATEST reply governs — the same species as T6.S1's last-block-wins-no-fallback. A stale confirm
#   row surviving a superseding reply would apply an answer the model retracted.

# CRITICAL: settle uses ONLY the just-frozen reply's text (the single message the freeze site just
#   pushed), never the whole transcript and never record.streamingText (cleared by then anyway).
#   parseAnswerBlock itself scans ONE reply for the LAST block — feeding it the transcript would
#   resurrect answers from earlier turns.

# GOTCHA: options is optional on Question — `(question.options ?? [])` everywhere; a text question's
#   value form already dies in parse (byte-match vs empty set → value-mismatch → none), so
#   toApplyDecision never sees a value for a text question via the settle path.

# GOTCHA: insertion anchors (T6.S1 lands in the same files immediately before this task):
#   sidechat.ts types → after the ChatUsage interface (T6.S1 anchors after SidechatNotice);
#   sidechat.ts functions → after formatChatCloseNotice (file tail; T6.S1 anchors after
#   classifyChatCommand); SidechatRecord field → after streamingText (T6.S1 never touches the
#   interface). Anchor on CONTENT, never line numbers.

# GOTCHA: both new engine deps are OPTIONAL and default-undefined — every existing engine test must
#   pass byte-identical without changes. Do not make answerContext required or fire onAutoApply
#   outside the (decision && autoApply) condition.

# GOTCHA: autoApply arrives INJECTED (via SidechatAnswerContext), never read from config inside
#   sidechat.ts/sidechat-engine.ts — config.ts imports @earendil and would breach the wall; the
#   injected-port testability rule (SidechatRebindDeps precedent) applies.

# GOTCHA: settleApplyDecision takes the RECORD as a parameter (mutating record.pendingConfirm) — it
#   does NOT call get(). The engine passes the live record (identity === the singleton) after
#   settle()'s liveness guard; record-param style matches the module's existing mutators.
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/panel/sidechat.ts — additions (Mode A doc comments on each):

/** SIDECHAT-004 apply routing decision. NAMES the ordinary seam the panel's
 *  single routing consumer (P1.M2.T6.S1) drives — this module (and the
 *  engine) never call the seams themselves: the engine produces a decision,
 *  the panel routes it (panel-view-integration.md §Open/replace/discard).
 *  "acceptOptionIndex" carries a DISPLAY position (D-R13 recommended-first
 *  order — actions.acceptOptionIndex maps display→option at its single seam);
 *  "writeIn" carries the parsed text VERBATIM (byte-identical provenance —
 *  SIDECHAT-004 owner ruling: no marker, no normalization, anywhere). */
export type ApplyDecision =
  | { seam: "acceptOptionIndex"; optionIndex: number }
  | { seam: "writeIn"; text: string };

// SidechatRecord — one field appended after streamingText:
  /** The confirmable answer decision from the LAST settled reply (P1.M1.T6.S2,
   *  SIDECHAT-004): set only when a reply produced a decision AND
   *  !sideChatAutoApply; cleared by a superseding reply (any outcome), the
   *  decline seam (clearPendingConfirm — P1.M2.T6.S1's esc), and record
   *  replacement (resetChat/discard). Aborted turns never settle, so an
   *  earlier reply's decision survives them. Absent = nothing to confirm. */
  pendingConfirm?: ApplyDecision;
```

```typescript
// src/panel/sidechat-engine.ts — additions:

/** Everything the freeze-site answer settle needs, resolved by the panel
 *  binder (P1.M2.T6.S1) per question: the live Question (options for the
 *  byte-match + display order) and the sideChatAutoApply flag (injected —
 *  config is never read inside the engine; injected-port rule). */
export interface SidechatAnswerContext {
  question: Question;
  autoApply: boolean;
}

// SidechatEngineDeps gains (both optional — absent = T5 behavior, byte-identical):
  /** SIDECHAT-004 answer settle seam (P1.M1.T6.S2): called with the record's
   *  questionId at the freeze site; undefined = unknown/stale question → the
   *  settle is skipped (no decision, no state change). */
  answerContext?: (questionId: string) => SidechatAnswerContext | undefined;
  /** Fired at the freeze site iff a decision was produced AND autoApply is
   *  on — the "immediately-applyable" exposure the panel's single routing
   *  consumer binds (it must NOT fire under manual mode: pendingConfirm on
   *  the record is that mode's exposure). */
  onAutoApply?: (decision: ApplyDecision) => void;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/sidechat.ts — types + field + three functions
  - IMPORT: `import type { Question } from "../state.js";` (the ONLY new import; type-only)
  - INSERT ApplyDecision after the ChatUsage interface (content anchor; NOT a line number)
  - APPEND `pendingConfirm?: ApplyDecision` to SidechatRecord after the streamingText field
    (T6.S1 never touches this interface — no collision)
  - IMPLEMENT after formatChatCloseNotice (file tail — T6.S1 anchors its function after
    classifyChatCommand; zero overlap):

      // Module-local D-R13 mirror (recommended-first, rest in state order) — a VERBATIM
      // sibling of short-view.ts displayOptions, which this module cannot import
      // (pi-tui transitive import would breach the zero-pi wall). displayOptions is the
      // authority: if D-R13 ordering ever changes, BOTH change (test vectors pin it).
      function displayOptionValues(q: Question): readonly string[] { … }

      export function toApplyDecision(parsed: ParsedAnswer, question: Question): ApplyDecision | undefined {
        // kind "value"  → const optionValues = displayOptionValues(question);
        //                 const optionIndex = optionValues.indexOf(parsed.value);
        //                 optionIndex === -1 → undefined (defensive; unreachable via settle)
        //                 else → { seam: "acceptOptionIndex", optionIndex }
        // kind "text"   → { seam: "writeIn", text: parsed.text }   // VERBATIM — no trim
        // kind "none"   → undefined
      }

      export function settleApplyDecision(record, replyText, question, autoApply): ApplyDecision | undefined {
        // 1) const parsed = parseAnswerBlock(replyText, (question.options ?? []).map(o => o.value));
        // 2) const decision = toApplyDecision(parsed, question);
        // 3) record.pendingConfirm = decision !== undefined && !autoApply ? decision : undefined;
        //    (supersede-clear: ANY later reply's settle overwrites — set, replace, or clear)
        // 4) return decision;
      }

      export function clearPendingConfirm(record: SidechatRecord): void {
        record.pendingConfirm = undefined;   // the decline seam — P1.M2.T6.S1's esc calls this
      }

  - DOC: Mode A comments citing SIDECHAT-004 (sidechat-contracts.md), panel-view-integration.md
    §Open/replace/discard ("engine produces, panel routes"), D-R13 display order, the verbatim
    rule, consumers (P1.M2.T1.S2 renders pendingConfirm; P1.M2.T6.S1 routes)
  - HEADER: append the answer settle to the Consumers list paragraph
  - RUN: npm run typecheck

Task 2: EXTEND src/panel/sidechat.test.ts — the contract suite
  - DESCRIBE "toApplyDecision / settleApplyDecision — ApplyDecision contract, pendingConfirm,
    autoApply bypass (SIDECHAT-004, P1.M1.T6.S2)" (descriptive-sentence test names, file style;
    import from ./sidechat.js; use resetSidechatForTests()/openOrReplace() to mint records —
    or buildFresh-shaped literals if simpler: the record param needs no singleton for direct
    function calls, but prefer real records via openOrReplace for lifecycle rows)
  - ROWS:
    1. value → display index, no recommendation: options [a,b,c] → {seam:"acceptOptionIndex", optionIndex:1} for "b"
    2. value → display index WITH recommendation: options [a,b,c], recommendation "c" → "c"→0, "a"→1, "b"→2
       (three asserts, one test — the D-R13 reorder pin)
    3. recommendation referencing a value NOT in options → NO reorder (mirror displayOptions' guard)
    4. text → {seam:"writeIn", text:" padded "} VERBATIM (assert the spaces)
    5. none (each reason) → undefined
    6. defensive: {kind:"value", value:"zzz"} vs options [a,b] → undefined
    7. settle manual: reply '```answer\n{"value":"sqlite"}\n```' + options [postgres,sqlite] +
       autoApply false → return {seam:"acceptOptionIndex",optionIndex:1} AND
       record.pendingConfirm toEqual the same object
    8. settle autoApply: same inputs, autoApply true → return the decision,
       record.pendingConfirm toBeUndefined() (no confirm state — bypass)
    9. settle writeIn: '{"text":"use streaming"}' on a text question (options undefined) →
       {seam:"writeIn",…}; pendingConfirm set (manual)
    10. supersede-clear: manual settle (decision) → pendingConfirm set; settle again with a
        no-block reply → pendingConfirm toBeUndefined, return undefined
    11. decline: set via manual settle → clearPendingConfirm(record) → toBeUndefined
    12. lifecycle: openOrReplace record → settle manual → resetChat → new record's pendingConfirm
        toBeUndefined; discard → get() undefined (confirm state dies with the record)
    13. abort-simulation: settle is NEVER called for aborted turns (engine contract) — this row
        lives in the engine file; here just assert settleApplyDecision itself is pure w.r.t.
        identical inputs producing identical outputs across two calls (idempotent given state)
  - MODE A comments citing SIDECHAT-004 + P1.M1.T6.S2 at the describe head
  - RUN: npx vitest run src/panel/sidechat.test.ts

Task 3: EDIT src/panel/sidechat-engine.ts — deps + freeze-site wiring
  - IMPORT: `import type { Question } from "../state.js";` and extend the ./sidechat.js import
    with settleApplyDecision (+ ApplyDecision type if referenced in the dep signature)
  - ADD SidechatAnswerContext + the two optional SidechatEngineDeps members (blueprint above)
  - WIRE inside route()'s `if (message !== undefined)` block, AFTER the usage-tally lines
    (capture `const frozenText` once — reuse for both the messages.push and the settle so the
    settled text is byte-identical to the frozen row):

      if (deps.answerContext !== undefined) {
        const ctx = deps.answerContext(record.questionId);
        if (ctx !== undefined) {
          const decision = settleApplyDecision(record, frozenText, ctx.question, ctx.autoApply);
          if (decision !== undefined && ctx.autoApply && deps.onAutoApply !== undefined) {
            deps.onAutoApply(decision);
          }
        }
      }

  - DOC: Mode A comment on the block citing SIDECHAT-004 + panel-view-integration.md
    ("engine produces a decision, the panel routes it") + P1.M1.T6.S2 + the stale-question no-op
  - RUN: npm run typecheck

Task 4: EXTEND src/panel/sidechat-engine.test.ts — freeze-site wiring rows
  - FOLLOW the existing deps-bag pattern (fakePort/fakeRegistry/notify at L182–184;
    engineOverRecord helper at L307); reuse existing stream fixtures (doneStream / assistantReply)
  - ROWS:
    1. manual: answerContext → {question with options [a,b] + rec, autoApply:false}, port yields
       a reply ending in a valid ```answer block → after settle: record.pendingConfirm set (the
       display-indexed decision)
    2. autoApply: same but autoApply:true + onAutoApply spy → spy called EXACTLY once with the
       decision; record.pendingConfirm toBeUndefined
    3. autoApply with NO onAutoApply dep → no throw; pendingConfirm absent (decision evaporates —
       documented no-op until the panel binds the callback)
    4. no answerContext dep at all → record.pendingConfirm never set (T5 behavior byte-identical)
    5. stale question: answerContext returns undefined → no settle, no throw, pendingConfirm
       untouched
    6. aborted turn (existing abort fixture pattern): record with a prior manual pendingConfirm →
       abort mid-stream → rollback leaves pendingConfirm INTACT (no settle on the aborted turn)
  - MODE A comments citing P1.M1.T6.S2
  - RUN: npx vitest run src/panel/sidechat-engine.test.ts

Task 5: VALIDATE walls + gates
  - npx vitest run src/panel/ ; npm test ; npm run typecheck ; npm run lint
  - grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/sidechat.ts src/panel/sidechat-engine.ts || echo CLEAN
  - grep -n "actions" src/panel/sidechat.ts src/panel/sidechat-engine.ts || echo CLEAN   # no apply-seam import
  - grep -rn "parseAnswerBlock" src/ --include="*.ts" | grep -v "\.test\.ts"
    # exactly TWO hits now: the definition (T6.S1) + settleApplyDecision's call (this task —
    # T6.S1's one-hit gate EXPIRES here by design)
  - git diff --stat   # exactly: sidechat.ts, sidechat.test.ts, sidechat-engine.ts, sidechat-engine.test.ts
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the D-R13 display-order mirror (single-sourced semantics, duplicated text):
function displayOptionValues(question: Question): readonly string[] {
  const options = question.options ?? [];               // options is OPTIONAL — never bare .map
  if (question.recommendation === undefined) return options.map((o) => o.value);
  const rec = options.find((o) => o.value === question.recommendation);
  if (rec === undefined) return options.map((o) => o.value);   // dangling rec → NO reorder (mirror)
  return [rec, ...options.filter((o) => o !== rec)].map((o) => o.value);
}

// CRITICAL: byte-identity through the whole chain — parseAnswerBlock matched parsed.value with
//   === against question.options values; indexOf(parsed.value) over the display permutation of
//   the SAME array therefore always hits (=== is transitive over identical strings). -1 is only
//   reachable when toApplyDecision is called directly with mismatched inputs → undefined.

// PATTERN — the settle composer (store side; record-param, never get()):
export function settleApplyDecision(
  record: SidechatRecord,
  replyText: string,
  question: Question,
  autoApply: boolean,
): ApplyDecision | undefined {
  const optionValues = (question.options ?? []).map((o) => o.value);   // declared order — match domain
  const decision = toApplyDecision(parseAnswerBlock(replyText, optionValues), question);
  // One write, both branches: set (manual) or clear (autoApply bypass / no decision / supersede).
  record.pendingConfirm = decision !== undefined && !autoApply ? decision : undefined;
  return decision;   // autoApply's "immediately-applyable" exposure — the engine hands it to onAutoApply
}

// GOTCHA: settle must be idempotent per state — calling it twice with the same inputs converges
//   (the second call re-derives and re-assigns the same decision). No date, no randomness.
```

### Integration Points

```yaml
RUNTIME: engine has NO instantiation site yet (verified) — nothing calls the new deps until
  P1.M2.T6.S1 binds them at the engine-creation site in the panel. All four edits are inert wiring.
CONSUMED NEXT:
  - P1.M2.T1.S2: renders the confirm row from `sidechat.get()?.pendingConfirm` (footer-height,
    ripple-confirm family: `apply ★ <value-or-text>? · enter = yes · esc = no`)
  - P1.M2.T6.S1: the single routing consumer — binds answerContext (displayOptions-owning side,
    reads config.sideChatAutoApply) + onAutoApply (applies the decision through
    actions.acceptOptionIndex / the write-in commit path); esc calls clearPendingConfirm
  - P1.M2.T5.S1: discard hooks rely on discard()/resetChat() clearing confirm state structurally
SEQUENCING: hard-depends on P1.M1.T6.S1 (parseAnswerBlock + ParsedAnswer in sidechat.ts) —
  sequential landing; only RESEARCH ran in parallel. T6.S1's insertion anchors
  (types after SidechatNotice, function after classifyChatCommand) do not collide with this
  task's (types after ChatUsage, functions after formatChatCloseNotice, field on SidechatRecord).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck     # tsc --noEmit strict — catches union/param-type slips (readonly string[] vs string[], optional options)
npm run lint
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/sidechat.test.ts -v          # new describe + all existing rows (T6.S1's parser rows included if landed)
npx vitest run src/panel/sidechat-engine.test.ts -v   # new wiring rows + all T5 rows unregressed
```

### Level 3: Neighbor & Full Suite

```bash
npx vitest run src/panel/    # whole panel tree green
npm test                     # full suite — the final gate
```

### Level 4: Purity & Scope Walls (domain-specific)

```bash
grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN                                   # M3.T1 guard surface
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
  src/panel/sidechat.ts src/panel/sidechat-engine.ts || echo CLEAN                       # SIDECHAT-005 (comments included)
grep -n "actions" src/panel/sidechat.ts src/panel/sidechat-engine.ts || echo CLEAN        # apply seams UNTOUCHED by engine/store
grep -rn "parseAnswerBlock" src/ --include="*.ts" | grep -v "\.test\.ts"                  # exactly TWO hits (def + settle call)
grep -rn "createSidechatEngine" src/ --include="*.ts" | grep -v sidechat-engine           # still ZERO callers (M2 binds later)
git diff --stat    # exactly the four files
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: typecheck + lint clean
- [ ] Level 2: both edited suites green, existing rows unregressed
- [ ] Level 3: `npx vitest run src/panel/` and `npm test` green
- [ ] Level 4: all six greps as specified; diff = exactly 4 files

### Feature Validation

- [ ] All Success Criteria vectors pass (display-order mapping with and without recommendation; verbatim text; set/skip per autoApply; supersede + decline clears; lifecycle)
- [ ] Engine rows: onAutoApply fires ONLY under (decision && autoApply); no-deps behavior byte-identical to T5; stale question and abort paths no-op/untouched
- [ ] Nothing applies an answer anywhere — no actions.ts import, no confirm row, no notice (all consumers are M2 tasks)

### Code Quality Validation

- [ ] sidechat.ts remains zero-pi-import (Question is a type-only import from pi-free state.ts)
- [ ] Mode A doc comments cite SIDECHAT-004, panel-view-integration.md, D-R13, P1.M1.T6.S2, consumers
- [ ] Only ApplyDecision, toApplyDecision, settleApplyDecision, clearPendingConfirm (+ SidechatAnswerContext in the engine) exported; the D-R13 mirror is module-local
- [ ] T6.S1's regions in sidechat.ts/.test.ts untouched; T6.S1's parser rows unregressed

### Documentation & Deployment

- [ ] Mode A only — no README/spec/config changes (M3.T3.S1 owns Mode B); no new config surface (sideChatAutoApply already exists, default false)

## Anti-Patterns to Avoid

- ❌ Don't compute optionIndex from `question.options` order — D-R13 display order (recommended-first) or the wrong row gets applied
- ❌ Don't import displayOptions from short-view.ts into sidechat.ts — pi-tui transitively breaches the zero-pi wall; mirror it module-locally and pin with vectors
- ❌ Don't trim/normalize the write-in text — VERBATIM end-to-end (byte-identical provenance, SIDECHAT-004 owner ruling)
- ❌ Don't let a no-decision reply leave a stale pendingConfirm — every settle overwrites (latest reply governs)
- ❌ Don't fire onAutoApply under manual mode — pendingConfirm is that mode's exposure; the callback is the autoApply bypass's exposure ONLY
- ❌ Don't make the new engine deps required, don't instantiate the engine, don't bind the deps in the panel — M2.T6.S1 owns every consumer
- ❌ Don't call or import acceptOptionIndex / the write-in path from sidechat*.ts — the decision NAMES seams, the panel ROUTES them
- ❌ Don't read config inside sidechat.ts/sidechat-engine.ts — autoApply arrives injected (config.ts is not pi-free)
- [x-never] Don't settle from `record.streamingText` or the whole transcript — only the just-frozen single reply's text
- ❌ Don't spell the five banned SIDECHAT-005 API names even in comments
- ❌ Don't add pendingConfirm to ChatMessage or notices — it is record-level state with exactly one home

---

**Confidence Score: 9/10** — the contract is fully pinned (union shapes, the display-position subtlety with the D-R13 mirror justified against the verified pi-import wall, the complete pendingConfirm transition table, exact freeze-site insertion with before/after ordering, optional-dep injection matching the landed SidechatEngineDeps precedent, and runnable gates including the parseAnswerBlock two-hit expectation). Residual 1/10: the inlined D-R13 mirror could drift if displayOptions' ordering ever changes (mitigated by cross-referenced docs + reorder test vectors) and the parallel-landing merge with T6.S1 in shared files (mitigated by disjoint content anchors and additive-only scope).

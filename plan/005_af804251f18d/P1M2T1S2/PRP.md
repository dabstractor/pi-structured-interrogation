---
name: "P1.M2.T1.S2 — chat-view: in-view notices, answer confirm row, inert notice (SIDECHAT-001 render module, part 2)"
description: "Extend src/panel/chat-view.ts (from P1.M2.T1.S1) with three render pieces: (a) a transient in-view notice row (latest SidechatNotice — auth errors, dispatch errors) plus an answer-block rejection notice row; (b) the footer-height answer confirm row `apply ★ {preview}? · enter = yes · esc = no` rendered INSTEAD of the footer hints while pendingConfirm exists (ripple-confirm renderConfirmFooter family); (c) a one-line inert banner when modelSnapshot is the empty marker. Requires one minimal store extension: SidechatRecord.lastRejection?: AnswerBlockRejection written by settleApplyDecision (same one-write/supersede pattern as pendingConfirm) so the view can render the malformed-block reason. Pure module; all rows respect the terminal budget ladder. Consumers: P1.M2.T3.S1 (enter/esc routing), P1.M2.T6.S1 (apply)."
---

## Goal

**Feature Goal**: The side-chat view surfaces everything the engine record knows beyond the transcript: engine failures (auth/dispatch notices), answer-protocol outcomes (confirm row for a pending apply; rejection notice for a malformed/inapplicable block), and the inert no-model state — each as compact in-view rows that never block the panel.

**Deliverable**: Modified `src/panel/chat-view.ts` + `src/panel/chat-view.test.ts` (new describe blocks); one-line store extension in `src/panel/sidechat.ts` (`lastRejection` field + `settleApplyDecision` write) + matching test additions in `src/panel/sidechat.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; byte-exact tests for: latest-notice row placement/content; all five rejection-reason texts (one row each, only when no pendingConfirm); confirm row replacing the footer with option-value preview and write-in text preview; inert banner under the header when `modelSnapshot.provider === ""`; budget degradations (notice row drops before footer statics; confirm row always survives — it is the view's active decision state). S1's existing tests pass unmodified-or-trivially-extended (slice fields are additive).

## User Persona

**Target User**: TUI user mid-side-chat.

**Use Case**: The side model replies with an answer block → the footer becomes `apply ★ sqlite? · enter = yes · esc = no` (user presses enter to apply through the ordinary seams — wiring in P1.M2.T6.S1). The model replies with a malformed block → one-line notice explains why, chat stays open. Provider auth breaks → one-line error notice. No model seam → the chat opens inert with a banner instead of silently doing nothing.

**User Journey**: press `e` → chat opens (or inert banner) → exchange → settled reply with valid block → confirm row at the footer → enter/esc → back to the normal footer.

**Pain Points Addressed**: SIDECHAT-004's "malformed → in-view notice, chat stays open" currently has no visual; engine failures are invisible; the inert record silently no-ops (INERT_NOTICE only fires on send). Also closes the design gap that settleApplyDecision discarded the AnswerBlockRejection reason.

## Why

- sidechat-contracts.md §SIDECHAT-004: "malformed → in-view notice, chat stays open" and "Inline confirm row (footer-height, ripple-confirm family): `apply ★ sqlite? · enter = yes · esc = no`". §UX details: "no model seam… → chat view opens INERT with a one-line notice; the panel never blocks."
- sidechat.ts's AnswerBlockRejection JSDoc: "the enum IS the notice API" — it exists precisely so P1.M2.T1.S2 maps each value to notice text.
- ripple-confirm.ts sets the styling/placement precedent: a confirm state REPLACES the footer line (`renderConfirmFooter`), it does not stack under it.
- P1.M2.T3.S1 (routing) and P1.M2.T6.S1 (apply) both key off `record.pendingConfirm`; the confirm row's visibility is what tells the user (and the tests) those keys are live.
- The close/usage flash deliberately does NOT become a row — it goes through ctx.ui.notify (P1.M1.T5.S3 consumer, `formatChatCloseNotice`); never render usage in-view.

## What

### 1. Store extension — `src/panel/sidechat.ts` (minimal, additive)

Add to `SidechatRecord` (after `pendingConfirm?`):

```ts
/** P1.M2.T1.S2 render input: why the LAST settled reply's answer block was
 * inapplicable (AnswerBlockRejection), or undefined when the last settle
 * produced a decision (or no block path at all). Supersede semantics mirror
 * pendingConfirm exactly — the model's LATEST reply governs; cleared by a
 * decision-bearing reply, record replacement (resetChat/discard), and reset
 * alongside pendingConfirm by clearPendingConfirm's caller path. */
lastRejection?: AnswerBlockRejection;
```

In `settleApplyDecision` (:586), extend the one-write tail:

```ts
const parsed = parseAnswerBlock(replyText, optionValues);
const decision = toApplyDecision(parsed, question);
record.pendingConfirm = decision !== undefined && !autoApply ? decision : undefined;
record.lastRejection = decision === undefined && parsed.kind === "none" ? parsed.reason : undefined;
return decision;
```

- `clearPendingConfirm` (:608): also clear `lastRejection`? NO — the decline seam only retracts the offer; but the row must disappear when the user declines a… (decision: clearing both is wrong only if decline should keep showing the rejection — it shouldn't; a decline is the user acting on the offer, after which neither row is relevant). DECISION: `clearPendingConfirm` clears BOTH fields (one-line addition; the confirm row and the rejection notice are alternative renderings of the same last-settle outcome — once the user declines/exits either, neither shows).
- `resetChat`/`discard`/replacement already drop the whole record — no edits.
- Add tests to `src/panel/sidechat.test.ts`: rejection set on "none", cleared by a subsequent decision-bearing settle, cleared by clearPendingConfirm, preserved across an aborted turn (aborts never settle — same as pendingConfirm).

### 2. View slice extension — `chat-view.ts` ChatViewState / ChatViewQuestion

Extend the S1 slices additively (S1's fields unchanged):

```ts
export interface ChatViewState {
  messages: ChatMessage[];
  streamState: ChatStreamState;
  notices: SidechatNotice[];        // latest wins (view shows only the newest)
  pendingConfirm?: ApplyDecision;
  lastRejection?: AnswerBlockRejection;
  modelSnapshot: ModelSnapshot;     // inert marker = {provider:"", modelId:""}
}
export interface ChatViewQuestion {
  id: string;
  prompt: string;
  options?: Array<{ value: string }>;  // display order — preview for acceptOptionIndex index
}
```

All types type-imported from `./sidechat.js`. Import `ApplyDecision`, `AnswerBlockRejection`, `ModelSnapshot`, `SidechatNotice`.

### 3. Render pieces (placement pinned; see research file)

Layout order: header → [inert banner] → transcript window → [notice rows] → blank padding → footer (or confirm row).

**(a) Inert banner** — when `modelSnapshot.provider === ""`: one dim row directly under the header, ALWAYS (even with zero messages — an inert chat with an empty transcript is exactly the empty/edge state):

```
no side chat model available — check sideChatModel in your config and provider auth
```

Byte-identical to the engine's `INERT_NOTICE` constant? That constant is module-private in sidechat-engine.ts — do NOT import the engine (view stays pure); duplicate the string in chat-view.ts with a comment pinning it to sidechat-engine.ts:183 (`INERT_NOTICE`). Width-truncate via truncateVisible.

**(b) Transient notice row** — the LATEST `notices` entry (append-only store, latest-wins rendering), one row directly above the blank padding line:

```
! {notice.text, truncateVisible to width-2}
```

Older notices are not rows (they remain in the transcript history conceptually; the store keeps them for debugging). The row drops FIRST under the narrow budget (before `/clear`).

**(c) Rejection notice row** — when `lastRejection` is set (and pendingConfirm absent — they're mutually exclusive by the one-write settle): one row, same slot as (b) (if both a latest-notice AND a rejection exist, render the rejection row immediately ABOVE the notice row — the rejection is the most recent settle outcome; the notice is engine noise). Fixed text map (exported const, one line each):

```ts
export const ANSWER_REJECTION_NOTICES: Record<AnswerBlockRejection, string> = {
  "no-block": "no answer block in the reply — ask the side model to conclude with a fenced ```answer block",
  "malformed-json": "answer block is not valid JSON — ask the side model to retry",
  "unknown-shape": "answer block must be exactly {\"value\": …} or {\"text\": …}",
  "value-mismatch": "answer value does not match any option — ask the side model to pick from the list",
  "empty-text": "answer text is empty — ask the side model to retry",
};
```

(Prefix each with `! ` like (b); keep every line single, truncated to width.)

**(d) Confirm row** — when `pendingConfirm` exists it REPLACES the footer hint line entirely (ripple-confirm family — a confirm state owns the footer slot):

```
apply ★ {preview}? · enter = yes · esc = no
```

- `{preview}` for `seam:"acceptOptionIndex"`: `question.options[optionIndex].value` (display order — the same array `toApplyDecision` indexed via `displayOptionValues`; guard: index out of bounds → fall back to `#{index}` and never crash).
- `{preview}` for `seam:"writeIn"`: `truncateVisible(text)` (visible-truncated to the remaining width; no quotes added).
- The `★` is the spec's literal mark (SIDECHAT-004 example `apply ★ sqlite?`) — it precedes the preview verbatim; it is NOT the recommended-option star logic.
- Budget: the confirm row NEVER degrades away — it is the view's active decision state (safety-critical like `esc abort`); under tiny budgets it stays as the sole footer line.

### 4. Budget integration

Follow S1's ladder (terminal-budget.ts consts). Priority when squeezed: footer statics drop first (S1), then the binding-name line (S1), then the transient notice row (b), then the rejection row (c) — NO, reverse: the rejection row is the settle outcome the user must see to understand why nothing applies; the engine-notice row (b) drops before it. Inert banner (a) and confirm row (d) are always rendered (both are state, not decoration). Window shrinkage under tiny budgets absorbs the row count exactly as S1 does (`max(1, rows - 4)` — with extra rows the window yields lines first, floor 1).

### 5. Doc block (Mode A)

Extend chat-view.ts's S1 header doc block: name the three pieces, the confirm-row-replaces-footer rule, the latest-wins notice rule, the empty-snapshot inert marker, the ANSWER_REJECTION_NOTICES contract ("the enum IS the notice API"), and the consumers (P1.M2.T3.S1 routes enter/esc off pendingConfirm; P1.M2.T6.S1 applies). Update sidechat.ts's `lastRejection`/`clearPendingConfirm` JSDoc.

### 6. Explicitly OUT of scope

- Enter/esc routing off the confirm row (P1.M2.T3.S1) and apply/decline (P1.M2.T6.S1).
- The close/usage flash (ctx.ui.notify consumer — P1.M1.T5.S3, already landed; never a row).
- Chat input, key routing, PanelView wiring (S2/S3/S4 of M2.T2-T4), discard hooks, non-TUI guards.
- Any theme/ANSI styling beyond plain strings (the panel seam themes later).

### Success Criteria

- [ ] Latest engine notice renders one row above the padding line; drops under narrow budget
- [ ] All five rejection texts render (only when lastRejection set and no pendingConfirm); outlives the engine-notice row under squeeze
- [ ] Confirm row replaces the footer: `apply ★ sqlite? · enter = yes · esc = no` byte-exact; write-in preview truncates; never degrades away
- [ ] Inert banner renders under the header when modelSnapshot.provider === "" (empty transcript case included)
- [ ] settleApplyDecision maintains lastRejection with the pinned supersede semantics; clearPendingConfirm clears both
- [ ] Pure module; labels still only from resolvedKeys; typecheck + full suite green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact record fields and their JSDoc'd semantics, the empty-snapshot inert marker definition, the five-value rejection enum with meanings, the confirm-row spec string and its ripple-confirm placement precedent, the store-extension diff (including the clearPendingConfirm decision), the placement/budget priority order, and the enumerated tests. No guessing.

### Documentation & References

```yaml
- file: src/panel/sidechat.ts
  why: |
    SidechatRecord (:221-254 — notices, pendingConfirm, modelSnapshot), SidechatNotice (:154),
    ApplyDecision (:139-142 — INDEX not value), ModelSnapshot (:144), AnswerBlockRejection
    (:179-192 — the enum IS the notice API), settleApplyDecision (:586 — the one-write tail to
    extend), clearPendingConfirm (:608), toApplyDecision/displayOptionValues (:542).
  gotcha: acceptOptionIndex carries an option INDEX; the preview needs question.options in
    DISPLAY order — pass options through ChatViewQuestion

- file: src/panel/sidechat-engine.ts
  why: INERT_NOTICE (:183-184 — the banner text, byte-pinned; duplicate, don't import — the
    engine module must stay out of the pure view), the inert dispatch path (:410-413), where
    notices are pushed (:287) — confirms latest-wins rendering is faithful
  gotcha: NEVER import sidechat-engine.ts from chat-view.ts (purity; the engine pulls pi-ai)

- file: src/panel/ripple-confirm.ts (:13-14, :265) + renderConfirmFooter
  why: THE precedent — a confirm state REPLACES the footer line (`⚠ Invalidates … — enter=keep,
    esc=cancel`), never stacks under it

- file: src/panel/chat-view.ts (arriving from P1.M2.T1.S1 — CONTRACT)
  why: buildChatContent/CHAT_VIEW_HEIGHT/clampChatScroll/ChatViewState skeleton, the S1 budget
    ladder, the documented S2 extension seam in its doc block
  gotcha: extend the slices additively; S1's tests must keep passing (new fields are required
    props — update S1's fixtures minimally if the slice makes them mandatory; prefer optional
    fields where honest, required where the piece always renders)

- file: src/panel/sidechat.test.ts
  why: settle/clearPendingConfirm test conventions to extend for lastRejection

- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  why: §SIDECHAT-004 (confirm row string, malformed → in-view notice), §UX details (inert
    one-line notice, never blocks), §SIDECHAT-005 (usage NEVER in-view)

- file: plan/005_af804251f18d/prd_snapshot.md (h2.38 Side chat, h2.41 Empty/edge states, FR-15)
  why: spec-pinned visual details — this item implements, does not re-design

- file: plan/005_af804251f18d/P1M2T1S1/PRP.md
  why: sibling contract — the render skeleton this extends; its OUT-of-scope names this item
```

### Current Codebase tree

```bash
src/panel/ sidechat.ts sidechat-prompt.ts sidechat-engine.ts deep-view.ts overview.ts layout.ts terminal-budget.ts ripple-confirm.ts (+ tests)
# src/panel/chat-view.ts + chat-view.test.ts arriving from P1.M2.T1.S1 (parallel)
```

### Desired Codebase tree

```bash
src/panel/chat-view.ts        # MODIFIED — slices + 3 render pieces + ANSWER_REJECTION_NOTICES
src/panel/chat-view.test.ts   # MODIFIED — new describes
src/panel/sidechat.ts         # MODIFIED — lastRejection field + settle/clear writes + JSDoc
src/panel/sidechat.test.ts    # MODIFIED — lastRejection semantics tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM ".js" import suffixes; type-only imports where possible.
// chat-view.ts must stay PURE: no panel.ts, no pi imports, no sidechat-engine.ts import.
// pendingConfirm and lastRejection are mutually exclusive by construction (one-write settle) —
//   render order: confirm row (replaces footer) ELSE rejection row; never both.
// ApplyDecision.seam "acceptOptionIndex" is an INDEX into display-order options — guard OOB.
// The ★ in `apply ★ {preview}?` is a literal spec mark, not the recommendation star logic.
// Key labels still only via resolvedKeys (no-hardcoded-keys.test.ts) — none of the new rows
//   reference keys (enter/esc wording is fixed spec text, like ripple-confirm's footer).
// Latest-wins for notices: record.notices is append-only; the VIEW shows only the newest entry.
// S1's blank padding line stays ABOVE the footer/confirm row (locked padding rule).
```

## Implementation Blueprint

### Data models and structure

Covered in What §1-2: `SidechatRecord.lastRejection?: AnswerBlockRejection` + the extended `ChatViewState`/`ChatViewQuestion` slices + `ANSWER_REJECTION_NOTICES` map. No other types.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK
  - If src/panel/chat-view.ts is absent (S1 in flight), create the S1 skeleton per
    plan/005_af804251f18d/P1M2T1S1/PRP.md first — do not weaken it. Locate S1's render
    pipeline (header → window → padding → footer) and the budget helpers by reading the file.

Task 1: STORE EXTENSION — src/panel/sidechat.ts
  - ADD lastRejection to SidechatRecord (What §1 wording); EXTEND settleApplyDecision's
    one-write tail; EXTEND clearPendingConfirm to clear both fields; update JSDoc.
  - ADD sidechat.test.ts cases: rejection set on none / cleared by decision settle / cleared
    by clearPendingConfirm / survives an aborted turn (aborts never settle).

Task 2: TDD FAILING-FIRST — src/panel/chat-view.test.ts new describes
  - notices: latest-notice row content+placement; older notices not rendered; drops under
    narrow budget.
  - rejections: one test per enum value (byte-exact row); mutual exclusion with pendingConfirm;
    survives budget squeeze past the engine-notice row.
  - confirm row: option-value preview; writeIn truncated preview; REPLACES the footer (no
    `enter send` hint while present); survives tiny budget; OOB optionIndex fallback `#{i}`.
  - inert: banner under header with empty transcript; absent when provider non-empty.
  - Update S1's fixtures for the widened slices (additive fields) — S1's assertions unchanged.

Task 3: RENDER — src/panel/chat-view.ts
  - Extend slices; add inertBanner(), noticeRow(), rejectionRow(), confirmRow(preview)
    helpers; weave into buildChatContent per the placement/budget order (What §3-4);
    export ANSWER_REJECTION_NOTICES; duplicate INERT_NOTICE text with a pin comment.
  - Extend the Mode A doc block.

Task 4: GATES — npm test + npm run typecheck; verify no pi/engine imports in chat-view.ts
  (grep; the M3.T1 cache-isolation guard will scan these modules).
```

### Implementation Patterns & Key Details

```ts
// Footer slot decision (the ONLY placement subtlety):
const footerLine = chat.pendingConfirm !== undefined
  ? confirmRow(chat.pendingConfirm, question, width)   // replaces hints entirely
  : chatHintString(chat, question, resolvedKeys, budget); // S1's function

function confirmRow(d: ApplyDecision, q: ChatViewQuestion, width: number): string {
  const preview =
    d.seam === "writeIn"
      ? truncateVisible(d.text, Math.max(1, width - FIXED_LEN))
      : q.options?.[d.optionIndex]?.value ?? `#${d.optionIndex}`; // OOB guard, never crash
  return `apply ★ ${preview}? · enter = yes · esc = no`; // spec string, byte-exact
}
```

### Integration Points

```yaml
STORE: settleApplyDecision gains one write — no signature change; all existing callers
  (sidechat-engine.ts :333) untouched and unaffected (return value unchanged).
CONSUMERS: P1.M2.T3.S1 routes enter/esc when pendingConfirm is set (its visibility = the
  routing contract); P1.M2.T6.S1 applies via acceptOptionIndex/writeIn and calls
  clearPendingConfirm (which now also clears lastRejection — the row pair retires together).
GUARDS: the M3.T1 cache-isolation scanner will grep chat-view.ts — keep it free of
  sendMessage/registerTool/etc. (it will be, by purity).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit        # npm run typecheck — zero errors
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/chat-view.test.ts src/panel/sidechat.test.ts -v
npm test                # full suite — S1's chat-view tests still green (fixtures widened additively)
```

### Level 3: Integration Testing (System Validation)

Deferred by design: the view has no runtime surface until P1.M2.T4.S1 wires the PanelView "chat" branch. The confirm row's live behavior (enter applies through the ordinary seams) is P1.M2.T6.S1's AC.

### Level 4: Creative & Domain-Specific Validation

Optional headless render probe once S4 exists: build a record with pendingConfirm via settleApplyDecision, render through the panel, assert the frame shows the confirm row; then inert record (empty modelSnapshot) → banner. Until then, Level 2's pure tests are the gate.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` fully green

### Feature Validation

- [ ] Latest-notice row, five rejection texts, confirm row (both seams), inert banner — all byte-tested
- [ ] Confirm row replaces the footer and never degrades away; notice rows respect the drop order
- [ ] settleApplyDecision/clearPendingConfirm maintain lastRejection per the pinned semantics

### Code Quality Validation

- [ ] chat-view.ts remains pure (no panel.ts / pi / sidechat-engine imports — grep-verified)
- [ ] Slices extended additively; S1 tests untouched except fixture widening
- [ ] No key-label literals; enter/esc wording is fixed spec text (ripple-confirm precedent)

### Documentation & Deployment

- [ ] Mode A doc block extended (three pieces, placement rules, consumers)
- [ ] No new config keys; INERT_NOTICE duplication pinned by comment

---

## Anti-Patterns to Avoid

- ❌ Don't stack the confirm row under the footer — it REPLACES it (ripple-confirm family)
- ❌ Don't render usage/close flashes in-view — ctx.ui.notify is their only channel (SIDECHAT-005)
- ❌ Don't import sidechat-engine.ts or pi modules into chat-view.ts — purity is load-bearing
- ❌ Don't re-parse the reply at render time — the store owns the rejection (lastRejection)
- ❌ Don't render older notices as rows — latest-wins only
- ❌ Don't change settleApplyDecision's signature or return value — engine callers are landed
- ❌ Don't drop the inert banner or confirm row under any budget — both are state, not decoration

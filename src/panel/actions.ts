/**
 * src/panel/actions.ts — named panel actions (P1.M3.T2.S2).
 *
 * MODE A CONTRACT — KEYS-FREE BY DESIGN: every handler here is key-agnostic.
 * Nothing in this module parses accelerator strings, reads config.keys, or
 * maps raw terminal bytes — actions take `(panel)` (plus args) and express
 * INTENT (move the cursor, accept, navigate, submit). Key binding is owned
 * exclusively by keys.ts (P1.M3.T3.S1); the minimal matcher living in
 * panel.ts handleInput until then is explicitly TEMPORARY and removable
 * without touching this file.
 *
 * Every mutation path calls panel.invalidate() (cursor/currentId changes do
 * not touch state, so the state "changed" subscription alone is not enough).
 * applyAnswer also emits "changed" (double invalidate is harmless — cache
 * drop is idempotent and requestRender is coalesced by the TUI).
 *
 * Hard requirement R1 (FR-9): prevQuestion/nextQuestion traverse ALL
 * questions — open, answered, re-asked, moot, withdrawn, closed — with no
 * status filtering and no wrap (explicit navigation clamps). Wrap belongs
 * ONLY to the accept-advance algorithm below (Q14=A: enter = accept +
 * advance).
 */
import { evaluateDependsOn } from "../depends-on.js";
import { buildSubmission, deliverSubmission } from "../delivery.js";
import { markSubmitted } from "../merge.js";
import {
  answerSummary,
  computeDiff,
  submissionBaselineOf,
  transcriptPrompt,
  UNANSWERED_SUMMARY,
} from "../snapshots.js";
import type { Question, QuestionAnswer, SerializedState } from "../state.js";
import { countUnansweredGate, gateGroupNames } from "./gate.js";
import type { InterrogationPanel } from "./panel.js";
import { beginWriteInConfirm, rippleVictims } from "./ripple-confirm.js";
import { clampChatScroll } from "./chat-view.js";
import { displayOptions } from "./short-view.js";
import {
  clearPendingConfirm,
  discard as discardSidechatRecord,
  formatChatCloseNotice,
  get as getSidechatRecord,
  type ApplyDecision,
} from "./sidechat.js";

// ------------------------------------------------------------------- types

/**
 * Ripple-confirm seam — invoked by accept BEFORE re-answering an already
 * answered/submitted question (AC-13 editing path). P1.M5.T4.S1 swaps the
 * panel's default (always-true no-op) for the real confirmation flow; the
 * invocation point is the contract, not the default implementation.
 * Return false vetoes the edit (no applyAnswer, no advance).
 */
export type RippleConfirmFn = (
  panel: InterrogationPanel,
  questionId: string,
  proposed: { value: string; at: string },
) => boolean;

/**
 * Narrow delivery surface for submit — structurally satisfies
 * deliverSubmission's `Pick<ExtensionAPI, "sendMessage">` (unknown-typed
 * params accept any message/options shape). The panel host wires the real
 * pi surface via InterrogationPanelArgs.delivery; tests pass vi.fn() mocks.
 */
export interface SubmitDeps {
  sendMessage: (msg: unknown, opts: unknown) => void;
  isIdle: () => boolean;
  /**
   * h2.44 line 1 (lifecycle.ts caller contract): called right after a REAL
   * delivery so the auto-close engine resets its per-run flags for the
   * settle that answers this submission. Optional: the zero-pending early
   * return never delivers, so it never calls this.
   */
  noteSubmissionDelivered?: () => void;
}

/** The named action surface consumed by keys.ts (P1.M3.T3.S1). */
export interface PanelActions {
  optionUp(panel: InterrogationPanel): boolean;
  optionDown(panel: InterrogationPanel): boolean;
  accept(panel: InterrogationPanel): boolean;
  prevQuestion(panel: InterrogationPanel): boolean;
  nextQuestion(panel: InterrogationPanel): boolean;
  submit(panel: InterrogationPanel, deps: SubmitDeps): boolean;
}

// ----------------------------------------------------------- advance core

/**
 * Statuses counted as "unanswered" for accept-advance (h2.38: `answered` is
 * the PENDING state — it HAS an answer awaiting submission; `submitted` is
 * flushed). moot/withdrawn/closed are never advance targets.
 */
const UNANSWERED_STATUSES: readonly string[] = ["open", "reasked"];

/**
 * Advance algorithm (Mode A — THE contract for post-accept movement):
 *
 * Scan `ordered` starting at `fromIndex + 1` through the END of the array,
 * then WRAP to index 0 and continue forward through `fromIndex` inclusive
 * (a full cycle — the scan terminates after exactly `ordered.length` steps,
 * never past the starting index). Return the id of the first question whose
 * status is "unanswered" — `open` or `reasked` (h2.38: `answered` is the
 * pending state and `submitted` is flushed; moot/withdrawn/closed are never
 * advance targets). If no question qualifies in the entire cycle, return
 * `undefined` and the caller STAYS on the current question (all answered,
 * or only moot/withdrawn/closed remain).
 *
 * Callers: accept invokes this AFTER applyAnswer, so the current question's
 * fresh `answered` status excludes it in practice; the inclusive wrap is
 * belt-and-braces for the "fromIndex itself is the last unanswered question"
 * degenerate call. `fromIndex` out of range (including -1) is normalized
 * modulo the array length defensively.
 */
export function nextUnanswered(
  ordered: Array<{ id: string; status: string }>,
  fromIndex: number,
): string | undefined {
  const n = ordered.length;
  if (n === 0) return undefined;
  const start = ((fromIndex % n) + n) % n;
  for (let step = 1; step <= n; step++) {
    const q = ordered[(start + step) % n];
    if (q !== undefined && UNANSWERED_STATUSES.includes(q.status)) return q.id;
  }
  return undefined;
}

/**
 * Cursor domain size for a question (S1 contract): choice questions own
 * 0..options.length (last index = the synthetic ✎ Other write-in row,
 * WRITEIN-001); text questions
 * own {0} (the primary affordance). Tolerant of choice questions with
 * undefined options (renders the ✎ affordance only).
 */
export function cursorDomainSize(q: Question): number {
  if (q.type === "text") return 1;
  return (q.options?.length ?? 0) + 1;
}

// ------------------------------------------------------------------ reads

/** The focused question, or undefined when no question context exists. */
function currentQuestion(panel: InterrogationPanel): Question | undefined {
  return panel.currentId !== undefined ? panel.state.getQuestion(panel.currentId) : undefined;
}

/**
 * Pending-answer diff baseline — now a thin delegation to snapshots.ts's
 * {@link submissionBaselineOf} (extracted with no behavior change).
 */
export function submissionBaseline(panel: InterrogationPanel): SerializedState {
  return submissionBaselineOf(panel.state);
}

// ---------------------------------------------------------------- actions

/**
 * Move the option cursor up one index, clamping at 0 (no wrap — the cursor
 * domain is a flat list, h2.29). No-op at the boundary; consumed whenever a
 * question context exists.
 */
export function optionUp(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) return false;
  if (panel.cursorIndex > 0) {
    panel.cursorIndex--;
    panel.invalidate();
  }
  return true;
}

/**
 * Move the option cursor down one index, clamping at the top of the cursor
 * domain (option count, or 0 for text questions — the ✎ affordance is the
 * last index on choice questions). No-op at the boundary.
 */
export function optionDown(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) return false;
  const max = cursorDomainSize(q) - 1;
  if (panel.cursorIndex < max) {
    panel.cursorIndex++;
    panel.invalidate();
  }
  return true;
}

/**
 * Accept the current cursor position (Q14=A: enter = accept + advance).
 * Context-dependent:
 * - No question context → false.
 * - moot/withdrawn → consumed no-op (R1 keeps them navigable, not editable).
 * - Text question → WRITE-IN duty: textDuty="writein" + focusTextField
 *   (BUG-008 — the ✎ affordance + "enter accept" footer are the advertised
 *   entry); enter in that duty commits via writeInEnter (byte-identical
 *   re-commit inert — ANSWER-PIN-001).
 * - Cursor on the ✎ Other row (index options.length) → WRITE-IN duty:
 *   textDuty="writein" + focusTextField (seeded from the freshest draft);
 *   enter in that duty COMMITS the buffer as the answer via writeInEnter
 *   (WRITEIN-001, Q14 parity; byte-identical re-commit inert —
 *   ANSWER-PIN-001).
 * - Cursor on an option → acceptOptionIndex (same-value re-commit inert —
 *   ANSWER-PIN-001; ripple seam on edit, commit, advance).
 */
export function accept(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) return false;
  if (q.status === "moot" || q.status === "withdrawn") return true;
  if (q.type === "text") {
    // BUG-008 / FR-12: the ✎ affordance + "enter accept" footer are the
    // advertised entry — open the WRITE-IN editor (the draft IS the answer
    // on text questions; enter inside commits via writeInEnter).
    panel.textDuty = "writein";
    panel.focusTextField(); // seeds freshest draft; sync re-derives writein (BUG-004 fix)
    return true;
  }
  const optionCount = q.options?.length ?? 0;
  if (panel.cursorIndex >= optionCount) {
    // ✎ Other row (WRITEIN-001): the editor becomes the WRITE-IN surface —
    // enter commits the buffer as the answer (writeInEnter), not a draft.
    // focusTextField still seeds the freshest draft (R4 revisit restore).
    panel.textDuty = "writein";
    panel.focusTextField();
    return true;
  }
  // Boolean boundary coercion (Mode A): every outcome except false is
  // consumed — the PanelActions interface stays boolean.
  return acceptOptionIndex(panel, q, panel.cursorIndex) !== false;
}

/**
 * [Mode A] Three-outcome accept signal (ANSWER-PIN-001 / FR-D9, seam doc
 * panel-ui-seams.md:17) — the deep-view consumer (acceptFromDeep) must
 * distinguish "nothing happened because the recorded answer was re-entered"
 * from "nothing happened because the ripple seam vetoed the edit":
 * - "noop"   — same-value re-commit: INERT (no applyAnswer, no answer.at
 *   rewrite, no seam, no moot recompute, no auto-submit) but the Q14 advance
 *   ALREADY RAN inside acceptOptionIndex; deep view lands per deepSticky
 *   (DEEP-STICKY-ADVANCE: stays deep while sticky, else short).
 * - "accept" — real commit applied (ripple passed or not applicable); advance
 *   already ran; deep view lands per deepSticky (stays deep while sticky).
 * - "veto"   — the ripple-confirm seam refused the edit (answered/submitted
 *   question, different value); NOTHING applied, NO advance; deep view stays
 *   open so the user re-decides in the pane they are reading.
 * - false    — out-of-range index (opt undefined): not consumed; the key falls
 *   through. Boolean for call-site compatibility (accept returns boolean).
 */
export type AcceptOutcome = "noop" | "accept" | "veto" | false;

/**
 * Shared commit path for accept + deep view. Same-value re-commit
 * FIRST (ANSWER-PIN-001 / FR-D9): a non-custom recorded answer whose value
 * byte-equals the proposed option is an INERT NO-OP that advances (Q14
 * rhythm) — no ripple seam, no applyAnswer (answer.at is never rewritten),
 * no moot recompute, no auto-submit. Otherwise:
 * route answered/submitted/closed edits through the ripple-confirm seam
 * FIRST (AC-13 — a veto skips everything), applyAnswer (status →
 * answered, the pending state per h2.38), then advance. BUG-003/FR-18:
 * closed (archived) questions carry recorded answers too (FR-2 — answers
 * editable even archived), so their different-value edits invalidate
 * dependents exactly like answered/submitted edits and route through the
 * same seam; same-value re-commits remain inert no-ops (ANSWER-PIN-001
 * runs first, and it already covers closed).
 *
 * Returns an {@link AcceptOutcome} (Mode A): "noop" (same-value, advance
 * already ran), "accept" (committed, advance already ran), "veto" (the seam
 * refused — nothing applied, no advance), or false (opt undefined — not
 * consumed). Only the return SHAPE changed; commit logic,
 * seam ordering, and advance placement are byte-identical. Boolean
 * consumers (accept, the PanelActions interface) coerce with
 * `!== false` — the outcome strings are truthy, never return them raw.
 */
export function acceptOptionIndex(panel: InterrogationPanel, q: Question, optionIndex: number): AcceptOutcome {
  // D-R13 (2026-09-30): optionIndex is a DISPLAY position (recommended-first
  // order — displayOptions); the mapping lives HERE, the single seam, so
  // cursor domain and deep view both speak display positions.
  const opt = displayOptions(q)[optionIndex];
  if (opt === undefined) return false;
  // ANSWER-PIN-001 / FR-D9: enter on the ALREADY-RECORDED value
  // on a SETTLED question (answered/submitted/closed — statuses the user's
  // own commit produced) is an inert no-op that advances — never a
  // re-proposal. Checked BEFORE the ripple seam: a same-value re-commit is
  // not a change (FR-18), so no modal, no applyAnswer (no fresh answer.at),
  // no evaluateDependsOn, no maybeAutoSubmit. REASKED EXCEPTION (BUG-001,
  // PRD h2.1/h3.0): a rule-1 re-ask flips status to "reasked" while KEEPING
  // the answer — the lifecycle marker, not the user, created that hybrid —
  // so a same-value enter there is a RE-CONFIRMATION commit, not a no-op:
  // it falls through to applyAnswer (re-marks answered(pending) with a
  // fresh answer.at — diff-invisible: the answer signature in snapshots.ts
  // is value+text only, never at), evaluateDependsOn, and maybeAutoSubmit,
  // letting the re-ask → re-confirm → settle → completion loop close.
  // Without the exclusion the question is stuck reasked forever: it counts
  // unanswered everywhere, ctrl+s says "nothing to submit", and completion
  // (FR-5) is permanently blocked unless the user changes their answer.
  // Still non-custom only: a write-in answer (custom) whose text
  // byte-equals an option value is a different-KIND commit (it would flip
  // the custom flag) and routes through the seam like any edit (write-in
  // reasked parity belongs to writeInEnter, not this path).
  const recorded = q.answer;
  if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value && q.status !== "reasked") {
    advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
    return "noop";
  }
  const proposed = { value: opt.value, at: new Date().toISOString() };
  // AUTOSUBMIT-003 commit context: open/reasked pre-commit = this accept can
  // be the last-unanswered TRANSITION; answered/submitted = an edit.
  const wasUnanswered = q.status === "open" || q.status === "reasked";
  // BUG-003 / FR-18 / Q39=B: closed (archived) questions still carry recorded
  // answers — a different-value edit invalidates dependents exactly like an
  // answered/submitted edit, so it routes through the same seam. Status-list
  // form (NOT answer-presence): keeps the reasked re-confirmation
  // (P1.M1.T2.S1) seam-free by construction — answer-presence would capture
  // the reasked hybrid and need explicit exemptions. Same-value re-commits
  // never reach here (the ANSWER-PIN-001 no-op above already covers closed).
  if (q.status === "answered" || q.status === "submitted" || q.status === "closed") {
    if (!panel.confirmRippleEdit(q.id, proposed)) return "veto"; // seam vetoed — nothing applied, no advance
  }
  panel.state.applyAnswer(q.id, proposed);
  // FR-17 / AC-6 (P1.M5.T4.S1): instant-local moot re-derivation after
  // EVERY panel-side apply — ripple victims grey out with reasons
  // immediately, not just at snapshot/delivery time. Exactly once per
  // commit, always AFTER applyAnswer and BEFORE the advance (freshly
  // mootered questions must not be advance targets).
  evaluateDependsOn(panel.state);
  advanceAfterAccept(panel);
  // WRITEIN-002 re-bind (BUG-001, direct/zero-victim path): re-stage the
  // superseded write-in's text as an ordinary draft — guards live in the
  // helper; the modal path (FR-18 victims > 0) is ripple-confirm.ts, S2.
  // ORDERING (verified by the :2277 regression): this MUST follow
  // advanceAfterAccept — the advance's syncBufferToQuestion write-through
  // honors the consumed (seeded-"") buffer as a delete-to-empty over any
  // existing slot and would wipe a pre-advance staging; staging AFTER the
  // write-through (and BEFORE maybeAutoSubmit, whose same-gesture delivery
  // must find the slot staged) is the only order that survives. The
  // helper's commitTextDraft is currentId-agnostic (EXPLAIN-003 re-seed
  // no-ops once the advance moved off the question).
  stageSupersededWriteIn(panel, q.id, recorded, proposed.value);
  maybeAutoSubmit(panel, undefined, { wasUnanswered, questionId: q.id }); // AUTOSUBMIT-001/003 — transition-gated completeness check
  return "accept";
}

/**
 * [Mode A] WRITEIN-002 supersede re-bind (BUG-001, adjudicated "restore";
 * decisions.md ruling "WRITEIN-002 supersede re-bind restored (BUG-001)" —
 * P1.M1.T1.S1): when a committed write-in answer is superseded by a real
 * option, the user's words must survive as `answer.text` (AC-2b/R4), not
 * vanish. consumeCommittedBuffer's consume-at-commit (the VAL-002 fix)
 * stays — the slot is re-created ONLY here, at supersede time, from the
 * recorded answer's value, and ONLY when no user-held draft exists (a
 * deliberate delete-to-empty "" slot is defined and wins — guard 4 compares
 * against undefined, never truthiness). The staged slot is an ordinary
 * role-less draft; reconcileDraftsForSubmit attaches it as `answer.text` at
 * the next submit — no reconcile/submit/panel changes. Stages DRAFTS ONLY:
 * never mutates answer state; the caller captures the PRE-apply recorded
 * answer and passes it as `superseded`.
 *
 * Guards, in order: (1) custom-only — the ANSWER-PIN-001 inert branch makes
 * every apply behind a custom:true answer a genuine supersede, so no
 * value-change check is needed; (2) non-whitespace — no ✎ draft for
 * degenerate write-ins; (3) no kind-flip — staging when value equals the
 * new option value would render "Alpha — Alpha" at submit; (4) user-draft
 * wins via the public seam. Staging goes through {@link commitTextDraft}
 * (never the private slot map) — its blur is harmless in accept context
 * (focus is already "options") and its EXPLAIN-003 cursor re-seed cannot
 * fire from an accept gesture.
 *
 * DO NOT call from applyWriteInConfirm (write-in → write-in edits):
 * reconcileDraftsForSubmit skips custom answers, so staging there is pure
 * ✎-marker noise. Call sites land in P1.M1.T3.S1 (acceptOptionIndex) and
 * P1.M1.T3.S2 (applyConfirmedEdit).
 */
export function stageSupersededWriteIn(
  panel: InterrogationPanel,
  questionId: string,
  superseded: QuestionAnswer | undefined,
  newValue: string,
): void {
  if (superseded === undefined || superseded.custom !== true) return; // 1: only write-ins re-bind
  const text = superseded.value;
  if (text.trim() === "") return; // 2: degenerate — no ✎ for whitespace
  if (text === newValue) return; // 3: kind-flip — never "Alpha — Alpha"
  if (panel.draftTextFor(questionId) !== undefined) return; // 4: user-held draft wins (incl. delete-to-empty "")
  panel.commitTextDraft(questionId, text);
}

/**
 * [Mode A] Write-in enter (WRITEIN-001, FR-D1, Q14 parity): in write-in
 * duty, enter COMMITS the buffer as the answer — applyAnswer({ value: text,
 * custom: true }) → evaluateDependsOn → advanceAfterAccept — mirroring
 * {@link acceptOptionIndex}'s post-commit sequence exactly (h2.42 answer
 * shape: value holds the user's own text, custom: true marks the write-in;
 * no option is selected). EMPTY buffer: save the draft + blur back to
 * options, NO commit (nothing answered — h2.32) via the shared
 * commitTextDraft tail (draft slot + DraftStore seam + cursor re-seed —
 * ANSWER-PIN-001: the recorded answer's row when one exists, else the ★
 * preselect; supersedes EXPLAIN-003's re-seed-to-★ clause, h2.65 ruling
 * 5) with arming explicitly off. BYTE-IDENTICAL buffer FIRST (a
 * byte-identical write-in re-commit — a recorded custom write-in, or any
 * recorded value on text questions — is an inert no-op: consume + advance
 * + blur only; no modal, applyAnswer, moot recompute, or auto-submit —
 * ANSWER-PIN-001 / FR-D9). FR-18 ripple routing (h2.35,
 * P1.M2.T2.S2): a commit on an ANSWERED/SUBMITTED question whose ripple has
 * victims defers into the keep/cancel modal via beginWriteInConfirm — NOT
 * confirmRippleEdit (that is the choice seam: it stashes kind "choice" and
 * drops the custom marker); zero victims commit directly. The deferred
 * commit is owned by applyWriteInConfirm (modal enter); esc reverts via
 * cancelWriteInConfirm. Binding decisions: emptiness is a TRIM gate but the
 * commit is the RAW
 * buffer (whitespace the user typed is theirs; multi-line values keep
 * their newlines); blur happens AFTER the advance so advanceAfterAccept's
 * currentId setter (cursor ★ reset) wins on the repainted view, and
 * blurTextField also resets textDuty to "elaboration". Consumed by:
 * two-stage removal (P1.M2.T4.S1 must not break it — a plain
 * commit-at-enter with no arming stages, WRITEIN-001), draft role binding (P1.M2.T5.S1),
 * deep-view Other selection (P1.M2.T6.S1 reuses the accept() pair),
 * maybeAutoSubmit (P2.M1.T1.S1 hooks after the commit tail).
 */
export function writeInEnter(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) {
    panel.blurTextField();
    return true;
  }
  const text = panel.textField.getText();
  if (text.trim().length === 0) {
    // Empty: draft write-through + blur, no commit (R4) — reuse the
    // existing save tail (draftSlots + DraftStore seam + cursor re-seed —
    // ANSWER-PIN-001: recorded answer first, ★ only while unanswered),
    // explicitly NOT a commit.
    panel.commitTextDraft(q.id, text);
    return true;
  }
  // ANSWER-PIN-001 / FR-D9: a byte-identical write-in re-commit is an inert
  // no-op that advances — never a re-proposal. Checked BEFORE the
  // ripple-victims branch: a same-value re-commit is not a change (FR-18),
  // so no keep/cancel modal, no applyAnswer (no fresh answer.at), no moot
  // recompute, no auto-submit. Two-clause match: choice questions require a
  // recorded WRITE-IN (custom === true) — an option answer whose value
  // byte-equals the buffer text is a different-KIND commit (it would flip
  // custom OFF) and routes through the normal paths; text questions match on
  // value alone (fallback answers[] records text answers without the custom
  // flag — same kind either way). Byte-identical = strict === on the RAW
  // buffer; whitespace-differing text is a real edit. VAL-002 parity: the
  // buffer still "became" the answer, so consume it — otherwise the advance's
  // syncBufferToQuestion write-through stages the identical text into q's
  // draft slot, where a later option accept would ship it as bogus
  // elaboration (answer.text).
  //
  // REASKED EXCEPTION (BUG-001 editor twin, PRD h2.1/h3.0 — parity with
  // acceptOptionIndex above): a rule-1 re-ask flips status to "reasked"
  // while KEEPING the answer — the lifecycle marker, not the user, created
  // that hybrid — so a byte-identical enter there is a RE-CONFIRMATION
  // commit, not a no-op: it falls past this branch to the direct-commit
  // exit (the FR-18 gate below already skips reasked — seam-free),
  // re-marking answered(pending) with a fresh answer.at (diff-invisible:
  // the answer signature in snapshots.ts is value+text only, never at),
  // letting the re-ask → re-confirm → settle → completion loop close.
  // Without the exclusion the question is stuck reasked forever: it counts
  // unanswered everywhere, ctrl+s says "nothing to submit", and completion
  // (FR-5) is permanently blocked unless the user retypes a different
  // answer. Settled statuses (answered/submitted/closed carrying the
  // identical write-in/text) stay inert — the no-op remains their contract.
  const recorded = q.answer;
  if (
    recorded !== undefined &&
    recorded.value === text &&
    (recorded.custom === true || q.type === "text") &&
    q.status !== "reasked" // BUG-001: reasked + kept answer → re-confirmation, never inert
  ) {
    panel.consumeCommittedBuffer(q.id); // BEFORE advance: kill the write-through source
    advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
    panel.blurTextField(); // AFTER advance (commit-tail parity): editor closes, duty resets
    return true;
  }
  // FR-18 / h2.35 (+ BUG-003): a write-in commit on an answered/submitted/
  // closed question with ripple victims routes through the SAME keep/cancel
  // modal as option edits (P1.M2.T2.S2) — the commit is DEFERRED to
  // applyWriteInConfirm; enter applies, esc reverts. BUG-003 (Q39=B): closed
  // (archived) questions still carry recorded answers (FR-2: answers
  // editable even archived), so a different-text write-in commit invalidates
  // dependents exactly like answered/submitted edits and must never silently
  // moot them. Ordering is load-bearing: the byte-identical no-op ABOVE
  // already treats closed as settled, so same-value re-commits on closed
  // stay inert; the explicit status-list form (never answer-presence) keeps
  // the reasked re-confirmation seam-free by construction (BUG-001).
  // Zero victims → direct commit (createRippleConfirm semantics; the modal
  // only exists when something would be invalidated).
  const status = q.status;
  if (
    (status === "answered" || status === "submitted" || status === "closed") &&
    rippleVictims(panel, q.id).length > 0
  ) {
    beginWriteInConfirm(panel, text);
    return true; // consumed — nothing applied yet
  }
  // KIND PRESERVATION (BUG-001 editor twin): a byte-identical reasked
  // re-confirm keeps the RECORDED answer's kind — a choice write-in
  // re-commits custom:true; a fallback-shaped plain text answer re-commits
  // plain with the custom key ABSENT (never custom:false — downstream
  // checks are === true), which the unconditional custom:true below would
  // silently flip into a write-in. Every other commit (fresh answers,
  // different-text edits, option→write-in flips) keeps custom:true: a
  // panel-typed text answer IS a write-in (WRITEIN-001).
  const isReconfirm = status === "reasked" && recorded !== undefined && recorded.value === text;
  const answer: QuestionAnswer = { value: text, at: new Date().toISOString() };
  if (!isReconfirm) {
    answer.custom = true; // panel-typed text is a write-in (WRITEIN-001)
  } else if (recorded.custom === true) {
    answer.custom = true; // re-confirm keeps the recorded write-in kind
  }
  // else: plain re-commit — custom stays absent.
  panel.state.applyAnswer(q.id, answer);
  // FR-17: same once-per-commit placement as acceptOptionIndex — AFTER the
  // apply, BEFORE the advance (fresh moots must not be advance targets).
  evaluateDependsOn(panel.state);
  // VAL-002: the buffer text just BECAME the answer — consume it so the
  // advance's draft write-through can never copy committed text into q's
  // draft slot (a later option accept would ship it as a bogus elaboration
  // of the new choice). Must precede advanceAfterAccept: the currentId
  // setter's syncBufferToQuestion write-through fires inside it.
  panel.consumeCommittedBuffer(q.id);
  advanceAfterAccept(panel); // Q14 parity: currentId → next unanswered; its cursor seed is the ★ preselect (target is unanswered — ANSWER-PIN-001)
  panel.blurTextField(); // resets textDuty to "elaboration"
  maybeAutoSubmit(panel, undefined, { wasUnanswered: status === "open" || status === "reasked", questionId: q.id }); // AUTOSUBMIT-001/003, direct-commit exit ONLY (never the empty-buffer or deferred exits)
  return true;
}

/**
 * [Mode A] SIDECHAT-004 apply routing (P1.M2.T6.S1, core commitment 9):
 * route the side chat's {@link ApplyDecision} VERBATIM through the two
 * ordinary answer seams — a chat-proposed answer is INDISTINGUISHABLE from
 * a user-made one in every model-facing record BY CONSTRUCTION
 * (architecture ruling, panel-view-integration.md §Open/replace/discard:
 * "no new answer path may be added").
 *
 * - Seam "acceptOptionIndex": {@link acceptOptionIndex} with the decision's
 *   DISPLAY optionIndex — the SAME arguments a keyboard accept produces
 *   (the display→option mapping lives inside the seam, D-R13; never re-map
 *   here). Its entire chain runs untouched: ANSWER-PIN same-value no-op,
 *   FR-18 confirmRippleEdit veto, applyAnswer, evaluateDependsOn,
 *   advanceAfterAccept, stageSupersededWriteIn, maybeAutoSubmit.
 * - Seam "writeIn": seed the write-in buffer with the decision's RAW text
 *   (no trim — the parser already rejected whitespace-only via its
 *   "empty-text" rule, and trimming would break byte-identical provenance)
 *   and invoke {@link writeInEnter} — byte-for-byte the keyboard commit's
 *   argument sequence (buffer content + enter). Its chain runs untouched:
 *   byte-identical no-op, reasked re-confirm, FR-18 victims →
 *   beginWriteInConfirm deferral, direct-commit tail.
 *
 * Target question: the module sidechat record's questionId. When the live
 * panel sits elsewhere, `panel.currentId` is assigned FIRST — the setter is
 * the sanctioned re-entry (ANSWER-PIN cursor re-seed + buffer-scoping
 * write-through), so the editor holds the target question's buffer before
 * any commit. Missing record or a question gone from state → consumed
 * `true`, nothing done.
 *
 * Deliberately NOT here (each owned elsewhere): answer construction,
 * markers, timestamps (the seams own all of it). The state `changed` hook
 * (P1.M2.T5.S1, BUG-002 transition semantics) owns the close for REAL
 * writes — it fires synchronously inside applyAnswer/evaluateDependsOn,
 * BEFORE this function's tail runs.
 *
 * [PRD BUG-003 / P1.M2.T2.S1] Consume tail (post-sequence ONLY): when the
 * offer survived the seam alive (`getSidechatRecord() === record` — object
 * identity, airtight across hook generations), `pendingConfirm` is retired:
 * the row was consumed either way (applied, no-op'd, or deferred into an
 * FR-18 modal), so a stuck `apply ★` row can never re-no-op forever. And
 * when the record survived with NO modal pending and the question is
 * already terminal-for-chat (the ANSWER-PIN same-value no-op edge — the
 * seam wrote nothing, so the `changed` hook can never fire), the tail
 * mirrors the hook's exact close ordering: abort if streaming FIRST, read
 * usage, discard, close the view to {@link InterrogationPanel.chatReturnView}
 * (fallback "short"), notify ONCE. Exactly-once holds because every later
 * entry finds `getSidechatRecord() === undefined` and the top guard
 * consumes it. Post-sequence clearing does NOT race the no-op (the fear
 * behind the old refusal): the no-op already COMPLETED — nothing further
 * fires from the seam — and a veto that defers into an FR-18 modal keeps
 * the chat open (confirmMode non-null), deferring the close to that
 * modal's own apply tail. Under the transition-aware hook (parallel
 * P1.M2.T1.S1) an answered→answered DIFFERENT-value direct write also
 * leaves the record alive — this terminal branch closes it identically:
 * every scenario is closed by exactly one owner (hook / deferred tail /
 * consume path).
 *
 * NEVER fires on its own: the panel's confirm-row branch and the engine's
 * onAutoApply binding are the only callers.
 */
export function applyChatAnswer(panel: InterrogationPanel, decision: ApplyDecision): boolean {
  const record = getSidechatRecord();
  const state = panel.state;
  if (record === undefined || state.getQuestion(record.questionId) === undefined) return true;
  if (panel.currentId !== record.questionId) panel.currentId = record.questionId; // setter re-seeds + scopes buffer

  // Seam arguments BYTE-IDENTICAL to the keyboard commit's — provenance by
  // construction (core commitment 9); only the control flow is restructured
  // so both seams flow through the consume tail below.
  let outcome: boolean;
  if (decision.seam === "writeIn") {
    panel.textField.setText(decision.text); // RAW — the keyboard commit's "arguments"
    outcome = writeInEnter(panel);
  } else {
    const q = state.getQuestion(record.questionId);
    outcome = q !== undefined ? acceptOptionIndex(panel, q, decision.optionIndex) !== false : true;
  }

  // [PRD BUG-003 / P1.M2.T2.S1] Consume tail — see the JSDoc §Contract.
  // Identity (live === record), not a field check, is what discriminates:
  // a real write discarded the record inside the seam → live is undefined
  // → tail no-ops (the hook already closed everything).
  const live = getSidechatRecord();
  if (live === record) {
    // The offer was consumed either way (applied, no-op'd, or deferred into
    // an FR-18 modal) — retire the confirm row.
    clearPendingConfirm(live);
    const q = state.getQuestion(record.questionId);
    const terminal = q !== undefined && panel.terminalForChat(q.status);
    // The no-op case ONLY: the seam wrote nothing (record still alive — the
    // 'changed' hook never fired) and no FR-18 modal is pending (a veto
    // defers the real write; the modal's tail owns the close). Mirror the
    // hook's ordering exactly (panel.ts onChanged).
    if (terminal && panel.confirmMode === null) {
      if (live.streamState === "streaming") live.abortController.abort(); // FIRST — a second turn may be in flight
      const usage = live.usage; // read BEFORE discard
      discardSidechatRecord();
      if (panel.view === "chat") {
        // chatReturnView is never "chat" by its seeding rule — belt-and-braces.
        panel.setView(panel.chatReturnView !== "chat" ? panel.chatReturnView : "short");
      }
      panel.sidechatNotify?.(formatChatCloseNotice(usage)); // once — get() is now undefined
    }
  }
  return outcome;
}

/**
 * Move to the next unanswered question (nextUnanswered — forward scan with
 * wrap); when none remains (all answered, or only moot/withdrawn/closed),
 * STAY on the current question. Assigning currentId re-seeds cursorIndex
 * via the panel's own setter (ANSWER-PIN-001/FR-35: a recorded answer
 * owns the caret; ★ preselect only while unanswered — the nextUnanswered
 * target is unanswered by construction, so its seed is the ★ when a
 * recommendation exists, else display row 0).
 */
function advanceAfterAccept(panel: InterrogationPanel): void {
  const ordered = panel.state.orderedQuestions();
  const from = ordered.findIndex((q) => q.id === panel.currentId);
  const nextId = nextUnanswered(ordered, from);
  if (nextId !== undefined) panel.currentId = nextId;
  panel.invalidate();
}

/**
 * Previous question (R1/FR-9): ±1 over orderedQuestions() with NO status
 * filtering — open, answered, reasked, moot, withdrawn, closed are all
 * navigable — clamped at the ends (wrap belongs only to advance). Cursor
 * re-seeds via the currentId setter on every change (ANSWER-PIN-001: a
 * recorded answer owns the caret — R1 navigation reaches answered
 * questions, so the caret follows their recorded answers, not the ★).
 */
export function prevQuestion(panel: InterrogationPanel): boolean {
  return stepQuestion(panel, -1);
}

/** Next question — same R1 contract as prevQuestion, +1 direction. */
export function nextQuestion(panel: InterrogationPanel): boolean {
  return stepQuestion(panel, 1);
}

function stepQuestion(panel: InterrogationPanel, delta: number): boolean {
  const ordered = panel.state.orderedQuestions();
  if (ordered.length === 0) return false;
  const idx = ordered.findIndex((q) => q.id === panel.currentId);
  if (idx === -1) return false;
  const next = Math.min(ordered.length - 1, Math.max(0, idx + delta));
  if (next !== idx) {
    panel.currentId = ordered[next].id; // setter re-seeds cursorIndex — recorded answer first, else ★ (ANSWER-PIN-001)
    panel.invalidate();
  }
  return true;
}

/**
 * Submit-time draft reconciliation (NEW-002 / NEW-003 — h2.45 "destroyed
 * only by submission — text answers ship", R4; role binding per WRITEIN-002,
 * h2.32/h2.48 "draft role follows the selection"): fold the user's typed
 * drafts into state BEFORE the pending set and diff are computed, so a
 * ctrl+s delivers everything the user actually typed. Draft slots are
 * ROLE-LESS `{value, text}` — each slot's role is bound HERE, from the
 * CURRENT selection, at flush time:
 *
 * - `type:"text"` questions (open or reasked): the draft IS the answer —
 *   `applyAnswer({ value, custom: true })` (h2.42: the value is user-typed
 *   free text, not an option value). There is no other apply affordance in
 *   the TUI (stage-1 enter only saves the draft; answers[] is ignored in
 *   TUI mode). Re-asks included deliberately: the user's re-typed text
 *   (stage-1 enter on the editor) is the text-question counterpart of a
 *   choice re-accept — without it a re-asked text question could NEVER be
 *   re-answered and would block completion forever. An ANSWERED/SUBMITTED
 *   text question is SKIPPED: its answer already committed at enter
 *   (writeInEnter), and a later-held draft edit routes through the FR-18
 *   confirm modal and also commits at enter — there is no held case to
 *   flush, so nothing is attached here.
 * - Choice questions, answered from a REAL option (`answer.custom !==
 *   true`): the draft is an elaboration of the chosen option — attach it
 *   as `answer.text` on the pending (answered) set only, value unchanged.
 *   Spreading the CURRENT answer re-binds superseded write-ins: a write-in
 *   later superseded by an option accept replaced the answer with the
 *   option's value and cleared `custom`, and the supersede path
 *   (acceptOptionIndex's stageSupersededWriteIn call; the FR-18 modal twin
 *   lands in ripple-confirm.ts, P1.M1.T3.S2) explicitly RE-STAGES the
 *   superseded write-in's value as an ordinary role-less draft — the old
 *   "slot text was KEPT (R4 — accept never touches the draft store)" claim
 *   was a half-truth once VAL-002's consumeCommittedBuffer began deleting
 *   the slot at commit, so the re-stage is the KEPT-text mechanism, and a
 *   user-held draft always wins (helper guard 4). This branch then attaches
 *   the staged text as elaboration at the next ctrl+s.
 * - Choice questions, answered from a committed write-in
 *   (`answer.custom === true`): SKIPPED — the write-in already shipped its
 *   value at commit (writeInEnter); attaching the slot text as
 *   `answer.text` would duplicate the write-in into the elaboration field.
 * - Choice questions, open or reasked: held elaboration — ships nothing.
 *   Preserved drafts on re-asked questions are NEVER shipped (BUG-008: an
 *   agent rule-2 reset must not be overridden without explicit user
 *   re-affirmation, which for choice is re-accept).
 *
 * Empty/whitespace-only drafts are skipped (an empty slot is an absent
 * draft — the same rule as DraftStore.hasDraft). applyAnswer is the
 * sanctioned raw primitive (no ripple — this folds the user's OWN typed
 * text into their OWN pending answer; values are never changed here).
 */
function reconcileDraftsForSubmit(panel: InterrogationPanel): void {
  for (const q of panel.state.orderedQuestions()) {
    const text = panel.draftTextFor(q.id);
    if (text === undefined || text.trim() === "") continue;
    if (q.type === "text") {
      if (q.status === "open" || q.status === "reasked") {
        // WRITEIN-002: the draft IS the answer, now carrying the custom
        // marker (h2.42) — it is user-typed text, not an option value.
        panel.state.applyAnswer(q.id, {
          value: text,
          custom: true,
          at: new Date().toISOString(),
        });
      }
      continue;
    }
    if (
      q.status === "answered" &&
      q.answer !== undefined &&
      q.answer.custom !== true // a write-in's draft already IS answer.value — never also attach as text
    ) {
      panel.state.applyAnswer(q.id, { ...q.answer, text });
    }
  }
}

/**
 * Submit: flush answers pending since the last submission. The baseline is
 * the latest snapshot (or the empty pre-first-snapshot baseline); the diff
 * against the live serialize() describes exactly the pending set — the
 * panel submit itself performs NO mutation (answers were already applied by
 * accept).
 *
 * - Zero PENDING (nothing answered) → footer flash "nothing to submit"
 *   (h2.37) and NOTHING else: no snapshot, no epoch bump, no delivery — and
 *   a held batch note stays held (R3: it ships with the NEXT submission).
 *   BUG-008: a diff consisting solely of agent-caused re-ask resets ships
 *   nothing (no pending ids → still the zero path).
 * - BUG-002 (D-R6 bridge parity): pending (answered) ids ARE user shipments
 *   even when the answer-signature diff is empty or fully filtered — the
 *   canonical rule-2 re-ask + same-value re-answer loop. Synthetic card
 *   entries (computeEntries shape, answerSummary `to`) keep k, the content
 *   line, and details.changed consistent.
 * - BUG-008 (h2.2 Issue 8): the model-visible delta lists ONLY user
 *   shipments, and text drafts ship ONLY for ids the user actually shipped
 *   (R4/commitment 6). Agent rule-2 re-ask resets (answer → undefined on
 *   content change) DO appear in the raw diff — computeDiff is status-blind
 *   (answer signatures only) — so submit filters them out of the card passed
 *   to buildSubmission and never ships their preserved drafts.
 * - Otherwise → buildSubmission (which performs takeSnapshot + bumpEpoch
 *   itself, EXACTLY once — callers must never snapshot/bump around it) with
 *   the held batch note as the model-visible `NOTE:` line + `details.note`
 *   (h2.32/R3), then deliverSubmission (exactly one sendMessage; idle probe
 *   picks the triggerTurn vs steer branch), then the note is CLEARED
 *   (h2.32 "cleared after shipping") — only a real delivery clears it.
 * - POST-SUBMIT EXIT (2026-10-04 user directive, FR-3d): after the note
 *   clearing, the panel SUSPENDS itself (done(null) — the SAME h2.35 esc
 *   suspend contract: pi restores + refocuses the main editor, state and
 *   drafts survive, the host's floating .then arms the suspend widget). A
 *   real submission is a turn-ending gesture: the diff card in the
 *   transcript is the confirmation, and the ball is in the agent's court —
 *   the panel must not sit on the same question waiting for esc (the
 *   stale-focus trap: an upsert while OPEN only invalidates in place and
 *   never advances focus). The next surfacing is the agent's move: a
 *   questions-upserted event leaving unanswered questions reopens the
 *   panel (SURFACE-001 / handleUpserted, focused on the first upserted
 *   active question), `{reopen:true}` resumes it, `/interrogate` opens it.
 *   The zero-shipped early return above NEVER suspends — nothing shipped
 *   means the user keeps working. maybeAutoSubmit's post-submit flash
 *   still fires (it can only paint pre-restore frames; it is the
 *   auto-path's test-observable receipt — the card and the widget are the
 *   real confirmation surfaces).
 */
export function submit(panel: InterrogationPanel, deps: SubmitDeps): boolean {
  // NEW-002/NEW-003 (h2.45): typed drafts ship with the submission — text
  // answers become the recorded answer, ✎ elaborations attach as answer.text
  // — BEFORE the baseline/diff/pending set below are read.
  reconcileDraftsForSubmit(panel);
  const pre = submissionBaseline(panel);
  const diff = computeDiff(pre, panel.state.serialize());
  // BUG-008: the user-shipped set is the pending (answered) ids, read BEFORE
  // markSubmitted below flips their statuses. The diff is status-blind
  // (answer signatures only), so after an agent rule-2 re-ask the baseline
  // snapshot still holds the OLD answer while live state has it reset — q1
  // then shows up in diff.changed as `old answer → (unanswered)` (the
  // "(unanswered)" literal is snapshots.ts's module-private UNANSWERED const)
  // even though the user shipped nothing for it.
  const pendingIds = panel.state.orderedQuestions().filter((q) => q.status === "answered").map((q) => q.id);
  // BUG-008 (b): drop agent-caused resets from the model-visible delta — an
  // entry the user did NOT ship whose answer went to "(unanswered)" is by
  // construction the agent's own merge-rule-2 reset (merge.ts). The
  // `pendingIds.includes(e.id) ||` disjunct is load-bearing: a genuinely
  // pending id must never be dropped even if its `to` ever renders as
  // "(unanswered)". editedArchived (AC-13) entries carry a real answer and
  // stay. buildSubmission derives k from changed.length, so the shipped card
  // and its content line stay consistent.
  const userChanged = diff.changed.filter(
    (e) => pendingIds.includes(e.id) || !(e.to === "(unanswered)"),
  );
  // BUG-002 re-key (D-R6 parity): the early return keys on the PENDING set,
  // not the diff — a rule-2 re-ask followed by a same-value re-answer
  // produces an empty answer-signature diff while a genuine user shipment
  // sits pending. Zero pending is the only "nothing to submit" path; the
  // pending>0 empty-diff case falls through and ships below.
  if (pendingIds.length === 0) {
    // WRITEIN-002 held-elaboration discoverability: a draft-only choice
    // question is the classic "why won't my partial submission ship" trap —
    // the slot's role binds to the CURRENT selection (WRITEIN-002), and an
    // unanswered choice has none, so the draft stays HELD and ships nothing
    // (h2.39). Count AFTER reconcileDraftsForSubmit (it ran first, above):
    // text drafts have already become answers, so only open/reasked CHOICE
    // questions with a non-empty slot can be "awaiting an option or Other".
    const heldDrafts = panel.state
      .orderedQuestions()
      .filter(
        (q) =>
          q.type !== "text" &&
          (q.status === "open" || q.status === "reasked") &&
          (panel.draftTextFor(q.id)?.trim() ?? "") !== "",
      ).length;
    // Verbatim h2.39 template — "question(s)" is literal, no pluralization.
    panel.flash(
      heldDrafts > 0
        ? `nothing to submit — ${heldDrafts} question(s) have drafts awaiting an option or Other`
        : "nothing to submit",
    );
    return true; // held note stays held — nothing user-shipped (R3)
  }
  // Soft-gate submit warning (P1.M5.T3.S1, Q32=B / h2.56): DISPLAY-ONLY.
  // Count unanswered gate-group questions; when config.gateWarnings is on
  // and n > 0, arm the panel's dismissible footer warning. The submission
  // then proceeds through the EXISTING path completely unchanged — the
  // warning never gates, vetoes, or delays anything (h2.56). Set BEFORE
  // deliverSubmission so it survives even if delivery throws in a future
  // host; invalidate defensively so the line shows even without change
  // events. The zero-pending early-return above shows NO warning (nothing
  // was submitted).
  const ordered = panel.state.orderedQuestions();
  const unansweredGate = countUnansweredGate(ordered, gateGroupNames(ordered));
  if (unansweredGate > 0 && panel.config.gateWarnings) {
    panel.gateWarning = { count: unansweredGate, kind: "submit" };
    panel.invalidate();
  }
  // R3 (h2.32): the batch note rides the NEXT submission. Store wins (the
  // suspend/resume-safe copy, P1.M4.T2.S1); the panel field is the
  // pre-store fallback for tests/seams without a DraftStore.
  const note = panel.drafts?.getNote() || panel.batchNote;
  // h2.38 ctrl+s transition (FR-3c): every pending (answered) id is
  // submitted at this epoch — the flush merge.ts documents ("the ctrl+s
  // submit flush applies this to all pending (answered) ids before the
  // epoch bump"). WITHOUT this, the h2.44 close pass (which archives only
  // status "submitted" ids after agent_settled) would never fire and
  // completion could never trigger (AC-3 / AC-14). Runs AFTER the
  // zero-pending early return: with nothing pending there is nothing to
  // flush, while the pending set ships even when the diff is empty
  // (BUG-002/D-R6 parity). The diff above is status-blind (answer
  // signatures only), so the flush cannot change it. (pendingIds was
  // captured ABOVE the early return — before this flush mutates statuses.)
  if (pendingIds.length > 0) markSubmitted(panel.state, pendingIds);
  // BUG-008 (b) + BUG-002: pass the card listing exactly the shipped ids —
  // user-diff entries first, then a synthesized entry for every pending id
  // the empty/filtered diff lacks (dedupe by id) — so buildSubmission's k,
  // the "Submitted {k}:" line, and details.changed stay consistent
  // ({ ...diff } spread keeps epoch and any other card fields). Synthesized
  // entries mirror computeEntries' FULL DiffEntry shape — value plus the
  // elaboration text and the write-in custom marker (BUG-001 producer B:
  // reconstruction replays submission deltas, so value-only entries lost
  // the user's words and ✎ marker); `from` is the
  // UNANSWERED sentinel because the baseline contributed no diff-visible
  // prior for the re-answered value. buildSubmission still performs its own
  // takeSnapshot + bumpEpoch exactly once — never reorder around it.
  const shippedIds = new Set(userChanged.map((e) => e.id));
  const augmented = [
    ...userChanged,
    ...pendingIds
      .filter((id) => !shippedIds.has(id))
      .map((id) => {
        const q = panel.state.getQuestion(id)!; // ids came from orderedQuestions
        const title = q.title ?? q.prompt ?? id;
        const prompt = transcriptPrompt(q.prompt, title); // FULL-TRANSCRIPT-001 mirror
        return {
          id,
          title,
          ...(prompt !== undefined ? { prompt } : {}),
          from: UNANSWERED_SUMMARY,
          to: answerSummary(q),
          editedArchived: false,
          value: q.answer?.value,
          ...(q.answer?.text !== undefined && q.answer.text !== "" ? { text: q.answer.text } : {}),
          ...(q.answer?.custom === true ? { custom: true } : {}),
        };
      }),
  ];
  const msg = buildSubmission(panel.state, { ...diff, changed: augmented }, note || undefined);
  // BUG-008 (a) / R4-h2.45: text drafts ship ONLY for ids the user actually
  // shipped (pendingIds ∩ hasDraft) — never for diff.changed ids, which can
  // include agent rule-2 resets whose preserved drafts must survive. hasDraft
  // is optional on the store seam: when absent, ship the full user-shipped
  // set (?? true) — shipDrafts is a no-op for ids without slots either way.
  // Still placed AFTER buildSubmission (the message is built from state, not
  // drafts) so every path is failure-safe; the early-return above never
  // reaches this.
  panel.drafts?.shipDrafts?.(pendingIds.filter((id) => panel.drafts?.hasDraft?.(id) ?? true));
  // SubmitDeps satisfies Pick<ExtensionAPI, "sendMessage"> structurally
  // (unknown-typed params accept any message/options shape).
  deliverSubmission(deps, msg, { isIdle: deps.isIdle });
  // h2.44 line 1 (lifecycle.ts caller contract, "immediately after
  // deliverSubmission"): a submission shipped — reset the engine's
  // per-run flags for the settle that answers it.
  deps.noteSubmissionDelivered?.();
  // h2.32 "cleared after shipping": note clearing happens AFTER delivery —
  // the zero-pending early-return above never reaches this, so a note with
  // nothing else to submit is held, never dropped.
  if (note) {
    panel.drafts?.setNote("");
    panel.batchNote = "";
  }
  // POST-SUBMIT EXIT (FR-3d, 2026-10-04 user directive): a real delivery
  // ends the panel session — suspend (done(null), the esc contract) backs
  // out to the normal prompt instead of parking on the current question.
  // The host then sits in "suspended", which is exactly what arms the
  // SURFACE-001 gated reopen when the agent's answering turn upserts more
  // questions. Suspend also runs the R4 write-through, so a buffer still
  // in the editor when ctrl+s fired (submit is intercept-before-forward)
  // survives as a draft rather than being lost to the close.
  panel.suspend();
  return true;
}

/**
 * [Mode A] AUTOSUBMIT-001 completeness hook (PRD h2.33, FR-3/h2.8, AC-2c,
 * M8 h2.51) — THE one shared auto-submit seam, called at the tail of every
 * panel answer-commit path (never from cancel/draft paths):
 *
 * - Completeness predicate (nextUnanswered parity, actions.ts): count the
 *   statuses accept-advance treats as unanswered — `open`/`reasked` only;
 *   moot/withdrawn/closed NEVER block a firing. Zero unanswered AND at
 *   least one pending (`answered`, h2.38) → fire; otherwise silent no-op
 *   (incomplete set: no submit, no flash; zero pending: no submit, NO
 *   flash — the "nothing to submit" flash belongs to explicit submits).
 * - One firing = ONE call into the EXISTING {@link submit} pipeline —
 *   reconcile → baseline/diff → BUG-008 filter → gate check →
 *   markSubmitted → buildSubmission (takeSnapshot + bumpEpoch, h2.41: the
 *   epoch bumps on every auto-submitted firing because each firing IS a
 *   full submission) → deliverSubmission → noteSubmissionDelivered. No
 *   pipeline step is reimplemented here; the held batch note rides (R3).
 * - The pending count `n` is captured BEFORE submit runs — submit's
 *   markSubmitted flush flips `answered` → `submitted`, so reading after
 *   would report 0. The flash fires only after submit returns true, so a
 *   zero-shipped early-return inside submit can never flash a lie.
 * - Footer flash verbatim `submitted — {n} answer(s)` (literal "answer(s)",
 *   h2.33; matches the "question(s)" precedent). panel.flash never stacks
 *   (h2.37) — the auto-submit flash replaces any live flash, intended.
 * - Deps: explicit `deps` wins; otherwise falls back to `panel.delivery`.
 *   Neither present (headless/test panels) → no-op, never throws.
 *
 * AUTOSUBMIT-002 gate hold (P2.M1.T2.S1, h2.33/FR-D5/AC-2d; reordered for
 * the BUG-001 fix): the unanswered-gate count (countUnansweredGate) is
 * computed BEFORE the completeness return, so the canonical flow — the
 * gate question itself still open while the user commits later-group
 * answers — arms the hold: n > 0 with pending > 0 ⇒ WITHHOLD (no submit,
 * no flash) and, when `config.gateWarnings` is on, arm the non-expiring
 * `kind: "hold"` footer line (gateHoldLine) carrying the config-resolved
 * submit label (panel.labels.submit — never a hardcoded chord). The
 * pending > 0 guard keeps zero-pending calls silent; an ordinary non-gate
 * skip still never warns (h2.58) — n === 0 there, so the completeness
 * return below fires silently. ctrl+s remains the deliberate override:
 * the unchanged {@link submit} path delivers anyway and overwrites the
 * hold line with the legacy submit-time warning (kind: "submit",
 * "later answers may shift"). `config.gateWarnings` off ⇒ silent withhold
 * (the display toggle governs both gate strings).
 *
 * Consumed by: AC-9
 * pending-ship (P3.M2.T2.S1) — the optional `deps` param is their seam.
 */
export function maybeAutoSubmit(
  panel: InterrogationPanel,
  deps?: SubmitDeps,
  commit?: { wasUnanswered: boolean; questionId?: string },
): void {
  const d = deps ?? panel.delivery;
  if (d === undefined) return; // no delivery surface (e.g. headless tests) — no-op
  const ordered = panel.state.orderedQuestions();
  const unanswered = ordered.filter(
    (q) => q.status === "open" || q.status === "reasked",
  ).length; // same statuses nextUnanswered skips; moot/withdrawn/closed never count
  const pending = ordered.filter((q) => q.status === "answered").length;
  // AUTOSUBMIT-002 gate hold (P2.M1.T2.S1, h2.33/FR-D5; BUG-001 reorder):
  // computed BEFORE the completeness return so the canonical flow — the
  // gate question itself still open while the user commits later-group
  // answers — arms the hold. The pending > 0 guard keeps zero-pending
  // calls silent (nothing committed = nothing to hold); an ordinary
  // non-gate skip still never warns (h2.58) because n === 0 there and the
  // completeness return below fires silently. config.gateWarnings off ⇒
  // silent withhold (the display toggle governs both gate strings). No
  // flash on the hold path — the hold line itself is the notice. The
  // deliberate override is the unchanged submit path: it delivers and
  // overwrites the hold line with the legacy submit-time warning (h2.56
  // soft gate — never a hard block).
  const gate = gateGroupNames(ordered);
  const n = countUnansweredGate(ordered, gate);
  if (n > 0 && pending > 0) {
    if (panel.config.gateWarnings) {
      panel.gateWarning = { count: n, kind: "hold", submitLabel: panel.labels.submit };
      panel.invalidate();
    }
    return; // no submit, no flash — the named override key ships now instead
  }
  if (unanswered > 0) return; // ordinary non-gate skip — silent (h2.58)
  if (pending === 0) return; // no-op on zero pending — NO flash, NO submit call
  // AUTOSUBMIT-003 (2026-09-30 interrogation): completeness alone no
  // longer fires — the bug-premature-fill experience made every EDIT of a
  // complete set re-ship the full group. The auto-submit trigger is now
  // (a) the TRANSITION — this commit answered the last remaining
  // unanswered question (commit.wasUnanswered; zero open/reasked remain,
  // checked above), ANYWHERE in the list — or (b) an edit commit ON the
  // last sequential ANSWERABLE question while the set is already complete
  // (the review-flow exit: finish at the end of the list and it ships;
  // fix an early answer and it waits for the manual submit). Last
  // ANSWERABLE, not literal last row — moot/withdrawn tails can never be
  // committed and the archived-edit flow (AC-13) must keep firing.
  // commit === undefined (probe/direct call) → never auto-submits.
  if (commit === undefined) return;
  if (!commit.wasUnanswered) {
    const lastAnswerable = [...ordered]
      .reverse()
      .find((q) => q.status !== "moot" && q.status !== "withdrawn");
    if (commit.questionId === undefined || lastAnswerable?.id !== commit.questionId) return;
  }
  // One firing = one full submission (h2.41: epoch bumps per firing).
  const shipped = submit(panel, d);
  if (shipped) {
    panel.flash(`submitted — ${pending} answer(s)`); // verbatim, literal "answer(s)"
  }
}

/** The named-action registry — keys.ts (P1.M3.T3.S1) binds keys to these. */
export const panelActions: PanelActions = {
  optionUp,
  optionDown,
  accept,
  prevQuestion,
  nextQuestion,
  submit,
};

// ------------------------------------------------- chat transcript scrolling

/**
 * Scroll the side-chat transcript up one line (SIDECHAT-001, P1.M2.T3.S1) —
 * the fixed ↑/↓ chat-view branch's action, mirroring overviewUp/overviewDown.
 * Moves the panel-owned `chatScrollOffset` clamped through
 * `clampChatScroll` against the render-fed transcript size
 * (`panel.chatTranscriptLines` — totalLines from the render state, per
 * chat-view.ts's "clamp it through clampChatScroll before storing").
 * ROUTING ONLY: mutates the offset + invalidates; never touches the
 * sidechat record. Returns true (consumed) so the router stops.
 */
export function chatScrollUp(panel: InterrogationPanel): boolean {
  panel.chatScrollOffset = clampChatScroll(panel.chatTranscriptLines, panel.chatScrollOffset - 1);
  panel.invalidate();
  return true;
}

/** Scroll the side-chat transcript down one line (see {@link chatScrollUp}). */
export function chatScrollDown(panel: InterrogationPanel): boolean {
  panel.chatScrollOffset = clampChatScroll(panel.chatTranscriptLines, panel.chatScrollOffset + 1);
  panel.invalidate();
  return true;
}

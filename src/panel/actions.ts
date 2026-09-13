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
import { buildSubmission, deliverSubmission } from "../delivery.js";
import { computeDiff } from "../snapshots.js";
import type { Question, SerializedState } from "../state.js";
import { countUnansweredGate, gateGroupNames } from "./gate.js";
import type { InterrogationPanel } from "./panel.js";
import { initialCursorIndex } from "./short-view.js";

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
}

/** The named action surface consumed by keys.ts (P1.M3.T3.S1). */
export interface PanelActions {
  optionUp(panel: InterrogationPanel): boolean;
  optionDown(panel: InterrogationPanel): boolean;
  /** Quick-select option n (1-based); out of range or disabled → false. */
  digit(panel: InterrogationPanel, n: number): boolean;
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
 * 0..options.length (last index = the ✎ explain affordance); text questions
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
 * Pending-answer diff baseline: the latest snapshot's state ("answered since
 * the LAST submission"), or a fresh empty baseline before the first
 * snapshot exists. The empty baseline is safe: computeDiff compares answer
 * signatures, and a question missing from `prev` with no answer in `next`
 * has signature `undefined` on BOTH sides — so only genuinely ANSWERED
 * questions surface as pending. buildSubmission then takes a NEW snapshot +
 * bumps epoch, making this baseline fresh for the next submit.
 */
export function submissionBaseline(panel: InterrogationPanel): SerializedState {
  const snaps = panel.state.snapshots;
  const last = snaps[snaps.length - 1];
  if (last !== undefined) return last.state;
  return { goal: "", epoch: 0, order: [], questions: {}, completed: false };
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
 * Digit quick-select (R5): accept option `n-1` (1-based) through the SAME
 * path as accept — ripple seam on answered/submitted, moot/withdrawn no-op,
 * advance after commit. Requires config.digitQuickSelect. Out of range
 * (`n-1` past the option count — the ✎ affordance is NOT digit-selectable),
 * on text questions, or with quick-select disabled → no-op returning false
 * so the key can fall through to other bindings.
 */
export function digit(panel: InterrogationPanel, n: number): boolean {
  if (!panel.config.digitQuickSelect) return false;
  if (!Number.isInteger(n) || n < 1 || n > 9) return false;
  const q = currentQuestion(panel);
  if (q === undefined || q.type !== "choice") return false;
  if (n - 1 >= (q.options?.length ?? 0)) return false;
  if (q.status === "moot" || q.status === "withdrawn") return true;
  return acceptOptionIndex(panel, q, n - 1);
}

/**
 * Accept the current cursor position (Q14=A: enter = accept + advance).
 * Context-dependent:
 * - No question context → false.
 * - moot/withdrawn → consumed no-op (R1 keeps them navigable, not editable).
 * - Text question → consumed no-op (field composition is P1.M4.T1.S2).
 * - Cursor on the ✎ affordance (index options.length) → set focus="text"
 *   and stop — the editor is P1.M4.T1.S2; this is the seam.
 * - Cursor on an option → acceptOptionIndex (ripple seam on edit, commit,
 *   advance).
 */
export function accept(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) return false;
  if (q.status === "moot" || q.status === "withdrawn") return true;
  if (q.type === "text") return true;
  const optionCount = q.options?.length ?? 0;
  if (panel.cursorIndex >= optionCount) {
    // ✎ explain affordance — hand focus to the text editor (M4.T1.S2).
    panel.focus = "text";
    panel.invalidate();
    return true;
  }
  return acceptOptionIndex(panel, q, panel.cursorIndex);
}

/**
 * Shared commit path for accept + digit: route answered/submitted edits
 * through the ripple-confirm seam FIRST (AC-13 — a veto skips everything),
 * applyAnswer (status → answered, the pending state per h2.38), then
 * advance.
 */
export function acceptOptionIndex(panel: InterrogationPanel, q: Question, optionIndex: number): boolean {
  const opt = q.options?.[optionIndex];
  if (opt === undefined) return false;
  const proposed = { value: opt.value, at: new Date().toISOString() };
  if (q.status === "answered" || q.status === "submitted") {
    if (!panel.confirmRippleEdit(q.id, proposed)) return true; // seam vetoed
  }
  panel.state.applyAnswer(q.id, proposed);
  advanceAfterAccept(panel);
  return true;
}

/**
 * Move to the next unanswered question (nextUnanswered — forward scan with
 * wrap); when none remains (all answered, or only moot/withdrawn/closed),
 * STAY on the current question. Assigning currentId re-seeds cursorIndex to
 * the ★ recommendation preselect via the panel's own setter.
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
 * resets to the ★ preselect via the currentId setter on every change.
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
    panel.currentId = ordered[next].id; // setter re-seeds cursorIndex (R2)
    panel.invalidate();
  }
  return true;
}

/**
 * Submit: flush answers pending since the last submission. The baseline is
 * the latest snapshot (or the empty pre-first-snapshot baseline); the diff
 * against the live serialize() describes exactly the pending set — the
 * panel submit itself performs NO mutation (answers were already applied by
 * accept).
 *
 * - Zero pending → footer flash "nothing to submit" (h2.37) and NOTHING
 *   else: no snapshot, no epoch bump, no delivery — and a held batch note
 *   stays held (R3: it ships with the NEXT submission).
 * - Otherwise → buildSubmission (which performs takeSnapshot + bumpEpoch
 *   itself, EXACTLY once — callers must never snapshot/bump around it) with
 *   the held batch note as the model-visible `NOTE:` line + `details.note`
 *   (h2.32/R3), then deliverSubmission (exactly one sendMessage; idle probe
 *   picks the triggerTurn vs steer branch), then the note is CLEARED
 *   (h2.32 "cleared after shipping") — only a real delivery clears it.
 */
export function submit(panel: InterrogationPanel, deps: SubmitDeps): boolean {
  const pre = submissionBaseline(panel);
  const diff = computeDiff(pre, panel.state.serialize());
  if (diff.changed.length === 0) {
    panel.flash("nothing to submit");
    return true; // held note stays held — nothing shipped (R3)
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
    panel.gateWarning = { count: unansweredGate };
    panel.invalidate();
  }
  // R3 (h2.32): the batch note rides the NEXT submission. Store wins (the
  // suspend/resume-safe copy, P1.M4.T2.S1); the panel field is the
  // pre-store fallback for tests/seams without a DraftStore.
  const note = panel.drafts?.getNote() || panel.batchNote;
  const msg = buildSubmission(panel.state, diff, note || undefined);
  // R4/h2.45: text drafts ship with the answers, then their slots are
  // destroyed. Placed AFTER buildSubmission (the message is built from
  // state, not drafts) so every path is failure-safe; the zero-pending
  // early-return above never reaches this.
  panel.drafts?.shipDrafts?.(diff.changed.map((c) => c.id));
  // SubmitDeps satisfies Pick<ExtensionAPI, "sendMessage"> structurally
  // (unknown-typed params accept any message/options shape).
  deliverSubmission(deps, msg, { isIdle: deps.isIdle });
  // h2.32 "cleared after shipping": note clearing happens AFTER delivery —
  // the zero-pending early-return above never reaches this, so a note with
  // nothing else to submit is held, never dropped.
  if (note) {
    panel.drafts?.setNote("");
    panel.batchNote = "";
  }
  return true;
}

/** The named-action registry — keys.ts (P1.M3.T3.S1) binds keys to these. */
export const panelActions: PanelActions = {
  optionUp,
  optionDown,
  digit,
  accept,
  prevQuestion,
  nextQuestion,
  submit,
};

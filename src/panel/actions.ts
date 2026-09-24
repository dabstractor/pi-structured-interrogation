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
import { computeDiff, submissionBaselineOf } from "../snapshots.js";
import type { Question, SerializedState } from "../state.js";
import { countUnansweredGate, gateGroupNames } from "./gate.js";
import type { InterrogationPanel } from "./panel.js";
import { beginWriteInConfirm, rippleVictims } from "./ripple-confirm.js";
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
 * {@link submissionBaselineOf} (FR-32: the remote phone-submission pipeline
 * shares the EXACT baseline semantics; extracted with no behavior change).
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
 * Digit quick-select (R5): accept option `n-1` (1-based) through the SAME
 * path as accept — ripple seam on answered/submitted, moot/withdrawn no-op,
 * advance after commit. Requires config.digitQuickSelect. Out of range
 * (`n-1` past the option count — the ✎ Other write-in row is NOT
 * digit-selectable, h2.36: quick-select covers REAL options only),
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
 * - Cursor on the ✎ Other row (index options.length) → WRITE-IN duty:
 *   textDuty="writein" + focusTextField (seeded from the freshest draft);
 *   enter in that duty COMMITS the buffer as the answer via writeInEnter
 *   (WRITEIN-001, Q14 parity).
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
    // ✎ Other row (WRITEIN-001): the editor becomes the WRITE-IN surface —
    // enter commits the buffer as the answer (writeInEnter), not a draft.
    // focusTextField still seeds the freshest draft (R4 revisit restore).
    panel.textDuty = "writein";
    panel.focusTextField();
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
  // FR-17 / AC-6 (P1.M5.T4.S1): instant-local moot re-derivation after
  // EVERY panel-side apply — ripple victims grey out with reasons
  // immediately, not just at snapshot/delivery time. Exactly once per
  // commit, always AFTER applyAnswer and BEFORE the advance (freshly
  // mootered questions must not be advance targets).
  evaluateDependsOn(panel.state);
  advanceAfterAccept(panel);
  maybeAutoSubmit(panel); // P2.M1.T1.S1 — AUTOSUBMIT-001 completeness check
  return true;
}

/**
 * [Mode A] Write-in enter (WRITEIN-001, FR-D1, Q14 parity): in write-in
 * duty, enter COMMITS the buffer as the answer — applyAnswer({ value: text,
 * custom: true }) → evaluateDependsOn → advanceAfterAccept — mirroring
 * {@link acceptOptionIndex}'s post-commit sequence exactly (h2.42 answer
 * shape: value holds the user's own text, custom: true marks the write-in;
 * no option is selected). EMPTY buffer: save the draft + blur back to
 * options, NO commit (nothing answered — h2.32) via the shared
 * commitTextDraft tail (draft slot + DraftStore seam + EXPLAIN-003 ★
 * re-seed) with arming explicitly off. FR-18 ripple routing (h2.35,
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
    // existing save tail (draftSlots + DraftStore seam + EXPLAIN-003
    // cursor re-seed to ★), explicitly NOT a commit.
    panel.commitTextDraft(q.id, text);
    return true;
  }
  // FR-18 / h2.35: a write-in commit on an answered/submitted question with
  // ripple victims routes through the SAME keep/cancel modal as option edits
  // (P1.M2.T2.S2) — the commit is DEFERRED to applyWriteInConfirm; enter
  // applies, esc reverts. Zero victims → direct commit (createRippleConfirm
  // semantics; the modal only exists when something would be invalidated).
  const status = q.status;
  if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {
    beginWriteInConfirm(panel, text);
    return true; // consumed — nothing applied yet
  }
  panel.state.applyAnswer(q.id, { value: text, custom: true, at: new Date().toISOString() });
  // FR-17: same once-per-commit placement as acceptOptionIndex — AFTER the
  // apply, BEFORE the advance (fresh moots must not be advance targets).
  evaluateDependsOn(panel.state);
  advanceAfterAccept(panel); // Q14 parity: currentId → next unanswered, cursor → ★ preselect
  panel.blurTextField(); // resets textDuty to "elaboration"
  maybeAutoSubmit(panel); // P2.M1.T1.S1 — AUTOSUBMIT-001, direct-commit exit ONLY (never the empty-buffer or deferred exits)
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
 *   Spreading the CURRENT answer re-binds superseded write-ins for free: a
 *   write-in later superseded by an option accept replaced the answer with
 *   the option's value and cleared `custom`, while the slot text was KEPT
 *   (R4 — accept never touches the draft store), so this branch attaches
 *   the kept text as elaboration at the next ctrl+s.
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
 * - Zero user-shipped change → footer flash "nothing to submit" (h2.37) and
 *   NOTHING else: no snapshot, no epoch bump, no delivery — and a held batch
 *   note stays held (R3: it ships with the NEXT submission). BUG-008: a diff
 *   consisting solely of agent-caused re-ask resets ships nothing.
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
  if (diff.changed.length === 0 || userChanged.length === 0) {
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
    panel.gateWarning = { count: unansweredGate };
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
  // completion could never trigger (AC-3 / AC-14). Runs AFTER the early
  // return: a submit with nothing user-shipped flushes nothing. The
  // diff above is status-blind (answer signatures only), so the flush
  // cannot change it. (pendingIds was captured ABOVE the early return —
  // before this flush mutates statuses.)
  if (pendingIds.length > 0) markSubmitted(panel.state, pendingIds);
  // BUG-008 (b): pass the FILTERED card so both the "Submitted {k}:" line
  // and details.changed list only user shipments ({ ...diff } spread keeps
  // epoch and any other card fields). buildSubmission still performs its own
  // takeSnapshot + bumpEpoch exactly once — never reorder around it.
  const msg = buildSubmission(panel.state, { ...diff, changed: userChanged }, note || undefined);
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
 * Consumed by: gate-hold withholding (P2.M1.T2.S1 wraps this call site),
 * the remote-submit bridge tail (P2.M1.T3.S1), and AC-9 pending-ship
 * (P3.M2.T2.S1) — the optional `deps` param is their seam. Gate-hold
 * logic itself deliberately lives NOT here.
 */
export function maybeAutoSubmit(panel: InterrogationPanel, deps?: SubmitDeps): void {
  const d = deps ?? panel.delivery;
  if (d === undefined) return; // no delivery surface (e.g. headless tests) — no-op
  const ordered = panel.state.orderedQuestions();
  const unanswered = ordered.filter(
    (q) => q.status === "open" || q.status === "reasked",
  ).length; // same statuses nextUnanswered skips; moot/withdrawn/closed never count
  if (unanswered > 0) return;
  const pending = ordered.filter((q) => q.status === "answered").length;
  if (pending === 0) return; // no-op on zero pending — NO flash, NO submit call
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
  digit,
  accept,
  prevQuestion,
  nextQuestion,
  submit,
};

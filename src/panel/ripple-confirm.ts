/**
 * src/panel/ripple-confirm.ts — FR-18 / Q39=B invalidation ripple confirm
 * (P1.M5.T4.S1).
 *
 * [Mode A] FORCED ACCEPT/CANCEL CONTRACT (h2.57): when the user commits an
 * answer change to an answered/submitted question whose transitive
 * `dependsOn` ripple would invalidate other answered/submitted questions,
 * the default {@link createRippleConfirm} seam VETOES the edit
 * synchronously (no applyAnswer, no advance, no draft writes) and stashes
 * a modal {@link RippleConfirmState} on the panel. The DEFERRED COMMIT is
 * owned by the confirm flow, never by the original accept path:
 *
 * - The footer is replaced by `renderConfirmFooter(victims, …)`:
 *   `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`.
 * - `enter` = keep: panel.handleInput routes to {@link applyConfirmedEdit} /
 *   {@link applyTextConfirm}, which perform the deferred commit EXACTLY
 *   ONCE and NEVER re-invoke the seam (the seam fires once per user
 *   gesture — a re-invocation would loop forever). applyConfirmedEdit runs
 *   `evaluateDependsOn` immediately after applyAnswer (FR-17: victims grey
 *   out as moot with reasons instantly, AC-6) and then advances via the
 *   shared `nextUnanswered` primitive (h2.38 accept-advance algorithm).
 * - `esc` = cancel: a GUARANTEED zero-state-change path — no applyAnswer,
 *   no setStatus, no snapshot, no epoch bump, no draft write; only the
 *   option cursor is restored (panel VIEW state, not state): to the
 *   recorded answer's option when findable, else the pre-edit
 *   `priorCursorIndex`. The user stays on the same question.
 * - While the mode is set, handleInput consumes every other key as a
 *   no-op (modal — the user must decide).
 *
 * Zero victims (ripple empty, or every ripple id open/moot/withdrawn/
 * closed) → the seam returns true and the accept path applies directly —
 * byte-identical to pre-task behavior. Open/reasked edits never reach the
 * seam (the accept path gates on answered/submitted). No drill-down in
 * v1: the confirm footer is the only surface.
 *
 * The text stage-1 save (two-stage enter, h2.31) shares the same gate:
 * saving a draft on an answered/submitted question with ripple victims
 * defers the save ({@link beginTextConfirm}); enter completes it with
 * stage-1 semantics ({@link applyTextConfirm} — draft slots + DraftStore
 * seam + blur + arm, NEVER an applyAnswer: stage-1 saves do not touch
 * state), esc restores the recorded answer's text into the editor and
 * keeps text focus ({@link cancelTextConfirm}). The editor-exit gestures
 * (ctrl+t toggle / double-esc, ESC-002) run the same gate with `arm: false`
 * — backing out of the editor saves the draft but never arms the one-shot
 * advance (a back-out is not an answer gesture).
 *
 * The write-in commit gate (h2.35, P1.M2.T2.S2) shares the same modal: in
 * write-in duty ({@link writeInEnter}), committing the buffer on an
 * answered/submitted question with ripple victims defers the commit
 * ({@link beginWriteInConfirm} — kind "writein"); enter applies it
 * ({@link applyWriteInConfirm} — the {value, custom: true, at} answer, then
 * evaluateDependsOn → advance → blur); esc re-seeds the editor from the
 * recorded answer with ZERO state change ({@link cancelWriteInConfirm}).
 * Write-in commits are plain commits — no `arm` (the two-stage machinery is
 * scheduled for removal, P1.M2.T4.S1).
 *
 * enter/esc are FIXED keys (keys.ts Mode A) — the footer copy hardcodes
 * them; there is deliberately no config surface (AC-12 unaffected).
 */
import { computeRipple, evaluateDependsOn } from "../depends-on.js";
import { nextUnanswered, type RippleConfirmFn } from "./actions.js";
import type { InterrogationPanel } from "./panel.js";

/**
 * Modal confirm state for a pending answer edit (FR-18 / Q39=B). Public on
 * the panel (`panel.confirmMode`) so renderers and tests can inspect it;
 * mutated ONLY by this module's flow (stash → enter/esc clears it).
 */
export interface RippleConfirmState {
  /** The question being edited. */
  questionId: string;
  /** Choice: a deferred applyAnswer payload. */
  proposed?: { value: string; at: string };
  /**
   * Which gated flow stashed the mode: an option accept ("choice"), a text
   * stage-1 save ("text"), or a deferred write-in commit on an
   * answered/submitted question ("writein", P1.M2.T2.S2).
   */
  kind: "choice" | "text" | "writein";
  /** Text: the staged stage-1 payload (deferred draft save). Write-in: the
   *  staged commit payload (deferred write-in commit on an
   *  answered/submitted question — h2.35). `text` carries the buffer; the
   *  applied payload is { value: text, custom: true, at: now } (h2.42). No
   *  `arm` — write-in commits are plain commits (the two-stage machinery is
   *  being removed, P1.M2.T4.S1); no `proposed` — reuse `text`. */
  text?: string;
  /**
   * Text: whether the deferred commit arms the one-shot advance flag
   * (ESC-002). Stage-1 enter saves arm (h2.31 two-stage contract); the
   * editor-exit gestures (ctrl+t toggle / double-esc) pass false — backing
   * out of the editor is not an answer gesture. Default true (undefined
   * reads as armed, the pre-ESC-002 behavior).
   */
  arm?: boolean;
  /** Answered/submitted ripple ids, in computeRipple BFS order (footer copy). */
  victims: string[];
  /** esc restore fallback when the recorded answer's option is not findable. */
  priorCursorIndex: number;
}

/** Statuses whose questions count as confirm-worthy victims (h2.57). */
const VICTIM_STATUSES: readonly string[] = ["answered", "submitted"];

/**
 * The answered/submitted ripple closure of `questionId` — the FR-18 victim
 * set for the confirm copy. computeRipple (pure, transitive, cycle-safe,
 * BFS order, excludes `questionId`) filtered to CURRENT victim statuses;
 * computed BEFORE any apply so post-apply statuses cannot pollute the
 * filter. Open/moot/withdrawn/closed ripple ids are not victims (an open
 * question just becomes askable/unaskable silently; withdrawn/closed are
 * terminal — SKIP_EVALUATION semantics).
 */
export function rippleVictims(panel: InterrogationPanel, questionId: string): string[] {
  return computeRipple(panel.state, questionId).filter((id) => {
    const q = panel.state.getQuestion(id);
    return q !== undefined && VICTIM_STATUSES.includes(q.status);
  });
}

/**
 * The panel's default RippleConfirmFn (FR-18): zero victims → true (apply
 * directly, exactly the pre-task behavior); otherwise stash the modal
 * choice-confirm state on the panel and return false (veto — the accept
 * path commits NOTHING; the deferred commit is owned by the confirm flow
 * via handleInput's enter branch → {@link applyConfirmedEdit}).
 */
export function createRippleConfirm(): RippleConfirmFn {
  return (panel, questionId, proposed) => {
    const victims = rippleVictims(panel, questionId);
    if (victims.length === 0) return true;
    panel.confirmMode = {
      questionId,
      kind: "choice",
      proposed,
      victims,
      priorCursorIndex: panel.cursorIndex,
    };
    panel.invalidate();
    return false;
  };
}

/**
 * Confirm-enter for a choice edit (the deferred commit). Clears the mode
 * FIRST, then mirrors acceptOptionIndex's tail EXACTLY ONCE — never
 * re-invoking the seam: applyAnswer (status → answered), evaluateDependsOn
 * (FR-17: victims flip to moot with h2.29 reasons instantly — one `changed`
 * per flip through the panel's existing subscription), then the standard
 * accept-advance via the exported nextUnanswered primitive (stays put when
 * nothing unanswered remains). When the edit was triggered from the deep
 * view the apply happens IN PLACE — the view stays deep (documented v1;
 * deep-view's veto branch already keeps the user there).
 */
export function applyConfirmedEdit(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  panel.confirmMode = null;
  if (cm === null || cm.kind !== "choice" || cm.proposed === undefined) return;
  panel.state.applyAnswer(cm.questionId, cm.proposed);
  evaluateDependsOn(panel.state); // FR-17/AC-6: instant moot greying
  const ordered = panel.state.orderedQuestions();
  const from = ordered.findIndex((q) => q.id === panel.currentId);
  const nextId = nextUnanswered(ordered, from);
  if (nextId !== undefined) panel.currentId = nextId; // setter re-seeds cursor (R2)
  panel.invalidate();
}

/**
 * Confirm-esc for a choice edit — the guaranteed zero-state-change path.
 * NO state mutation of any kind: no applyAnswer, no setStatus, no
 * snapshot, no epoch. Restores the option cursor to the recorded answer's
 * option (the pre-edit selection) when its value is still among the
 * options, else the stashed priorCursorIndex; the user stays on the same
 * question. Only panel view state moves (cursor + render cache).
 */
export function cancelConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  if (cm === null) return;
  panel.confirmMode = null;
  if (cm.kind === "choice") {
    const q = panel.state.getQuestion(cm.questionId);
    const recorded = q?.answer?.value;
    let cursor = cm.priorCursorIndex;
    if (recorded !== undefined) {
      const found = (q?.options ?? []).findIndex((o) => o.value === recorded);
      if (found >= 0) cursor = found;
    }
    panel.cursorIndex = cursor;
  }
  panel.invalidate();
}

/**
 * Text stage-1 gate entry (called by panel.saveTextDraft when the current
 * question is answered/submitted with a recorded answer AND the ripple has
 * victims): stash the staged text as a text-pending confirm. The slot
 * write, DraftStore write, blur, and (unless `arm: false`) the arming are
 * ALL deferred to {@link applyTextConfirm} — nothing is saved until the
 * user decides.
 */
export function beginTextConfirm(
  panel: InterrogationPanel,
  text: string,
  opts?: { arm?: boolean },
): void {
  const id = panel.currentId;
  if (id === undefined) return;
  panel.confirmMode = {
    questionId: id,
    kind: "text",
    text,
    arm: opts?.arm !== false,
    victims: rippleVictims(panel, id),
    priorCursorIndex: panel.cursorIndex,
  };
  panel.invalidate();
}

/**
 * Confirm-enter for a text stage-1 save: complete the DEFERRED save with
 * exact stage-1 semantics via the panel's shared commit tail — draft slot
 * + DraftStore seam write of the STASHED text, blur back to options, arm
 * the one-shot advance flag. Never applies an answer to state (stage-1
 * saves never do — h2.31), so no evaluateDependsOn here.
 */
export function applyTextConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  panel.confirmMode = null;
  if (cm === null || cm.kind !== "text" || cm.text === undefined) return;
  panel.commitTextDraft(cm.questionId, cm.text, { arm: cm.arm !== false });
}

/**
 * Confirm-esc for a text stage-1 save: restore the editor to the recorded
 * answer's text (the same read layout.ts's ✎ marker uses: `value` for text
 * questions, `answer.text` for choice elaborations) via the idempotent
 * seed, and KEEP text focus — no draft write, no blur, no arming. Nothing
 * was written yet (the save was deferred), so there is nothing to undo.
 */
export function cancelTextConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  if (cm === null) return;
  panel.confirmMode = null;
  if (cm.kind === "text") {
    const q = panel.state.getQuestion(cm.questionId);
    const recorded =
      q === undefined || q.answer === undefined
        ? ""
        : q.type === "text"
          ? q.answer.value
          : (q.answer.text ?? "");
    panel.textField.seed(recorded);
  }
  panel.invalidate();
}

/**
 * [Mode A] Write-in commit gate entry (FR-18 × WRITEIN-001, h2.35,
 * P1.M2.T2.S2): called by writeInEnter when the current question is
 * answered/submitted AND rippleVictims is non-empty. h2.35 ripple sentence
 * (verbatim): "On committing an answer change to an *answered* question in
 * the panel (the moment `enter` finalizes — option accept, write-in commit,
 * or a text/write-in re-commit on an answered question), if `dependsOn`
 * ripple (transitive closure) hits answered/submitted questions: footer
 * becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep,
 * esc=cancel`; `esc` reverts the edit; `enter` applies — and the applied
 * commit then runs the auto-submit check like any other. No drill-down in
 * v1." Stashes the buffer as a writein-pending confirm; the editor STAYS
 * FOCUSED in write-in duty behind the modal (modal keys are consumed by
 * handleInput's confirmMode branch — the editor never sees them). Nothing
 * is applied until {@link applyWriteInConfirm}; the victims are computed
 * HERE, once, before any apply (statuses shift after applies).
 */
export function beginWriteInConfirm(panel: InterrogationPanel, text: string): void {
  const id = panel.currentId;
  if (id === undefined) return;
  panel.confirmMode = {
    questionId: id,
    kind: "writein",
    text,
    victims: rippleVictims(panel, id),
    priorCursorIndex: panel.cursorIndex,
  };
  panel.invalidate();
}

/**
 * Confirm-enter for a write-in commit (the deferred apply). Clears the mode
 * FIRST, then mirrors writeInEnter's commit tail EXACTLY ONCE — never
 * re-invoking the gate: applyAnswer({ value: text, custom: true, at })
 * (h2.42: a hand-written answer ships BY ITSELF with the custom marker),
 * evaluateDependsOn (FR-17/AC-6: victims flip to moot instantly),
 * accept-advance via nextUnanswered (Q14 parity; stays put when nothing
 * unanswered remains), then blurTextField (resets textDuty to
 * "elaboration"). P2.M1.T1.S1 hooks maybeAutoSubmit after this tail — the
 * APPLIED path is the auto-submit trigger (h2.35: "the applied commit then
 * runs the auto-submit check like any other"); do not implement it here.
 */
export function applyWriteInConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  panel.confirmMode = null;
  if (cm === null || cm.kind !== "writein" || cm.text === undefined) return;
  panel.state.applyAnswer(cm.questionId, {
    value: cm.text,
    custom: true,
    at: new Date().toISOString(),
  });
  evaluateDependsOn(panel.state);
  const ordered = panel.state.orderedQuestions();
  const from = ordered.findIndex((entry) => entry.id === panel.currentId);
  const nextId = nextUnanswered(ordered, from);
  if (nextId !== undefined) panel.currentId = nextId; // setter re-seeds cursor (R2)
  panel.blurTextField(); // AFTER advance (S1's ordering: advance's cursor reset wins), resets duty
  panel.invalidate();
}

/**
 * Confirm-esc for a write-in commit — the guaranteed zero-state-change
 * path (AC-7). NO state mutation (no applyAnswer, no draft write, no
 * snapshot). Reverts the EDIT: re-seed the editor from the recorded answer
 * (cancelTextConfirm's read pattern — answer.value for text questions and
 * custom write-ins, answer.text for choice elaborations) and KEEP write-in
 * focus (the user stays in the editor they were typing in; textDuty is
 * untouched — still "writein").
 */
export function cancelWriteInConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  panel.confirmMode = null;
  if (cm === null || cm.kind !== "writein") return;
  const q = panel.state.getQuestion(cm.questionId);
  const recorded =
    q === undefined || q.answer === undefined
      ? ""
      : q.type === "text" || q.answer.custom === true
        ? q.answer.value
        : (q.answer.text ?? "");
  panel.textField.seed(recorded);
  panel.invalidate();
}

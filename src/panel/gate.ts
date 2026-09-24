/**
 * src/panel/gate.ts — soft-gate helpers (P1.M5.T3.S1 + P2.M1.T2.S1):
 * gate-group detection, unanswered-gate counting, the TWO gate footer strings
 * (submit-time warning + commit-time hold), and the gate-aware initial-focus
 * picker.
 *
 * [Mode A] CONTRACT — SOFT GATE vs COMMIT GATING (Q32=B, h2.56, FR-9/R1):
 *
 * - SOFT gate (this task): a question flagged `gate: true` marks its
 *   effective group as the GATE GROUP — a group-level attribute computed
 *   from membership (the exact rule behind the overview `▲` mark,
 *   P1.M5.T2.S1). Soft gating expresses itself as FOCUS + DIM + WARN only:
 *   the panel opens on the gate group's first answerable question (FR-1),
 *   non-gate groups render visually dimmed while remaining fully
 *   navigable/answerable (R1 — display gating, NEVER a lock), and a
 *   `ctrl+s` submit with unanswered gate questions still delivers while a
 *   dismissible footer warning surfaces.
 * - COMMIT-time gate HOLD (P2.M1.T2.S1, AUTOSUBMIT-002, h2.33/FR-D5/AC-2d):
 *   the auto-submit hook (maybeAutoSubmit, actions.ts) WITHHOLDS its firing
 *   while gate-group questions remain unanswered and instead arms the
 *   non-expiring {@link gateHoldLine} — a DIFFERENT string from the
 *   submit-time warning BY DESIGN (h2.33): it names the config-resolved
 *   submit key as the deliberate override (never a hardcoded chord, h2.52).
 *   The override itself is the unchanged ctrl+s path: submit() delivers
 *   anyway and overwrites the hold line with {@link gateWarningLine}.
 *   Two strings, two moments: {@link gateHoldLine} = commit-time (explains a
 *   WITHHELD auto-submit, fires BEFORE anything ships);
 *   {@link gateWarningLine} = submit-time (rides a delivered partial:
 *   "later answers may shift"). Keep them distinct — do not unify.
 * - COMMIT gating — blocking, delaying, or vetoing a submission until the
 *   foundations are answered — is explicitly REJECTED by h2.56: the first
 *   upsert always carries ALL questions (the anti-loss anchor), so blocking
 *   would either trap the user or void that guarantee. The submit action
 *   (actions.ts) consumes {@link countUnansweredGate} for the warning count
 *   ONLY; the delivery path is byte-identical whether or not gates are
 *   unanswered.
 *
 * Consumption map (who calls what):
 * - panel.ts: {@link pickGateInitialQuestionId} (constructor initial focus),
 *   {@link gateGroupNames} + {@link effectiveGroup} (buildLines dimming),
 *   {@link gateWarningLine} + {@link gateHoldLine} (footerNoticeLine picks
 *   the string by the gateWarning payload's `kind` via
 *   layout.renderGateWarningLine — one shared notice slot).
 * - actions.ts: {@link countUnansweredGate} + {@link gateGroupNames}
 *   (submit() submit-time warning count, display-only; maybeAutoSubmit
 *   commit-time hold count + withholding, P2.M1.T2.S1).
 * - overview.ts (P1.M5.T2.S1): {@link gateGroupNames} is the shared home of
 *   the gate-group detection its `▲` header mark uses — one rule, one home.
 * - deep-view.ts (P1.M5.T1.S1): integration seam — the short view's dim
 *   flag composes there later via these same helpers (a dimmed non-gate
 *   question in deep view SHOULD also be dim); this module exports the
 *   pieces, the view owns its render.
 *
 * Purity: (Question[], GateGroups, …) → values. No pi imports beyond the
 * state types, no state mutation, no I/O, no key handling, no rendering.
 */
import { UNGROUPED_LABEL, type Question } from "../state.js";

/** The set of effective group names that carry at least one `gate: true` question. */
export type GateGroups = ReadonlySet<string>;

/**
 * Effective group key for bucketing: `q.group ?? UNGROUPED_LABEL` — the
 * exact discipline of state.groupSummaries(), so the ungrouped bucket is a
 * gate-eligible group like any other.
 */
export function effectiveGroup(q: Question): string {
  return q.group ?? UNGROUPED_LABEL;
}

/**
 * Gate-group detection (group-level attribute from membership): ANY question
 * with `gate === true` marks its effective group as a gate group. Never
 * treat an individual non-gate member of a gate group as "not gate" —
 * membership, not the per-question flag, is what downstream rendering asks.
 * Order-independent; an empty input yields an empty set.
 */
export function gateGroupNames(ordered: Question[]): GateGroups {
  const names = new Set<string>();
  for (const q of ordered) {
    if (q.gate === true) names.add(effectiveGroup(q));
  }
  return names;
}

/**
 * Count of gate-group questions with NO answer — the `n` in the submit
 * warning `⚠ {n} foundational unanswered — later answers may shift`.
 * Unanswered = `q.answer === undefined` and the question is neither
 * `withdrawn` nor `moot` (both terminal-until-re-upsert: they stay visible
 * but are never answerable, Q34=A). answered/submitted questions carry
 * answers by construction and don't count; an open question the user simply
 * hasn't reached does.
 */
export function countUnansweredGate(ordered: Question[], gate: GateGroups): number {
  let count = 0;
  for (const q of ordered) {
    if (!gate.has(effectiveGroup(q))) continue;
    if (q.answer === undefined && q.status !== "withdrawn" && q.status !== "moot") count++;
  }
  return count;
}

/**
 * The SUBMIT-TIME warning text, WITHOUT inset or theme wrapping (layout.ts
 * renderGateWarningLine owns presentation): `⚠ {n} foundational unanswered
 * — later answers may shift`. Armed by submit() (actions.ts) AFTER a real
 * delivery when `config.gateWarnings` is on — it rides a delivered partial
 * and only cautions about later shifts; it NEVER withholds anything. This
 * is the legacy P1.M5.T3.S1 string: byte-identical since introduction.
 *
 * Two moments by design (h2.33): this line speaks AFTER shipping a partial;
 * the commit-time counterpart {@link gateHoldLine} explains a WITHHELD
 * auto-submit and names the override key instead. Do not unify them.
 */
export function gateWarningLine(count: number): string {
  return `⚠ ${count} foundational unanswered — later answers may shift`;
}

/**
 * The COMMIT-TIME hold text (P2.M1.T2.S1, AUTOSUBMIT-002 / FR-D5 verbatim),
 * WITHOUT inset or theme wrapping: `⚠ {n} foundational unanswered — answer
 * them or {submitLabel} to submit now`. Armed by maybeAutoSubmit (actions.ts)
 * when it WITHHOLDS the auto-submit because gate-group questions remain
 * unanswered — the visible reason for the withholding (FR-D5) and the map
 * out of it: keep answering, or press the named key to ship now (the
 * unchanged submit path delivers; soft gate, h2.56 — the hold never blocks
 * the manual override).
 *
 * `submitLabel` is the config-resolved display label (resolveKeyLabels via
 * panel.labels.submit) — NEVER a hardcoded chord (h2.52 keymap guard).
 * Deliberately a DIFFERENT string from the submit-time
 * {@link gateWarningLine} ("later answers may shift"): two strings, two
 * moments (h2.33) — this one fires BEFORE anything ships, that one AFTER a
 * delivered partial.
 */
export function gateHoldLine(count: number, submitLabel: string): string {
  return `⚠ ${count} foundational unanswered — answer them or ${submitLabel} to submit now`;
}

/**
 * Initial-focus ladder (FR-1), consumed by the panel constructor:
 *
 * 1. Explicit `focusQuestionId` (agent override) wins over everything —
 *    when it exists in `ordered`.
 * 2. Gate group declared: the FIRST gate-group question in `ordered` order
 *    that is answerable (not `withdrawn`, not `moot`).
 * 3. Gate group declared but every member withdrawn/moot: the gate group's
 *    FIRST question (still focused there; dimming still applies to others).
 * 4. No gate declared (or none reachable): today's ladder verbatim — first
 *    status-"open" question, else the first question — so a no-gate panel
 *    behaves exactly as before {@link pickGateInitialQuestionId} existed.
 *
 * Returns undefined only when `ordered` is empty (mirrors the old ladder).
 */
export function pickGateInitialQuestionId(
  ordered: Question[],
  gate: GateGroups,
  focusQuestionId: string | undefined,
): string | undefined {
  if (focusQuestionId !== undefined && ordered.some((q) => q.id === focusQuestionId)) {
    return focusQuestionId;
  }
  if (gate.size > 0) {
    const gateQs = ordered.filter((q) => gate.has(effectiveGroup(q)));
    const answerable = gateQs.find((q) => q.status !== "withdrawn" && q.status !== "moot");
    if (answerable !== undefined || gateQs.length > 0) return (answerable ?? gateQs[0]).id;
  }
  const firstOpen = ordered.find((q) => q.status === "open");
  return (firstOpen ?? ordered[0])?.id;
}

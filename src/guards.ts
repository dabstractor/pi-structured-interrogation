/**
 * src/guards.ts — rev/epoch stale guards for the interrogate upsert/answers
 * paths (P1.M1.T3.S2; AC-8, PRD h2.10/h2.19/h2.22/h2.39/h3.8).
 *
 * Pure read-only layer between parsing (tool-schema.ts, S1) and the
 * executors (P1.M1.T3.S4/S5): given the live InterrogationState and the
 * parsed action, decide whether the caller's view is fresh enough to
 * proceed. On staleness it THROWS — it never returns a rejection object.
 *
 * WHY THROWING IS THE CONTRACT (Mode A): pi sets `isError` on a tool result
 * ONLY when `execute` throws (plan/001_0d6760db6bc5/architecture/
 * pi-api-validation.md:21; extensions.md:2068). There is no isError field a
 * tool result can carry. The thrown StaleError message is therefore the
 * model's ONLY healing signal — it must carry the current rev/epoch, the
 * current question text, and the delta digest so the model can re-apply
 * against current state without a separate read (AC-8: "Stale upsert →
 * rejected; result contains current text/rev and delta digest; model
 * re-applies successfully").
 *
 * Guard matrix (h2.22 / h2.39 / h3.8):
 * - `read` / `reopen`: NEVER guarded — pull refresh is always allowed, in
 *   TUI and non-TUI alike (there is no mode parameter; guards are identical
 *   everywhere).
 * - `record` (answers): epoch-only. Answers never bump rev (h2.39), so
 *   there is no per-question rev check. A missing epoch on answers is a
 *   required-param violation (plain Error), not staleness.
 * - `upsert`: per-question rev guard on EXISTING ids only (new ids need no
 *   rev — the schema makes rev optional precisely for new questions),
 *   reported in agent-supplied array order (first stale id wins, one throw
 *   per call); then the session-epoch guard when the caller sent one.
 *   Schema-level presence requirements are S1's domain — guards check
 *   CONSISTENCY, not presence.
 *
 * Message variants (exact shapes, single spaces after periods):
 * - Combined: `STALE: {id} is at rev {n} (you sent {m}); session epoch is
 *   {e} (you sent {x}). Current {id}: {text}. Changes since epoch {x}:
 *   {delta}. Re-apply against current state.`
 * - Rev-only (epoch matched or absent): `STALE: {id} is at rev {n} (you
 *   sent {m}). Current {id}: {text}. Re-apply against current state.`
 * - Epoch-only (all revs fresh): `STALE: session epoch is {e} (you sent
 *   {x}). Changes since epoch {x}: {delta}. Re-apply against current
 *   state.`
 *
 * Purity: no state mutation, no events, no UI, no pi imports. Imports are
 * type-only from ./state.js and ./tool-schema.js plus `digestSince` from
 * ./snapshots.js, so this module stays unit-testable without an extension
 * context.
 */
import type { InterrogationState } from "./state.js";
import { digestSince } from "./snapshots.js";
import type { ParsedAction } from "./tool-schema.js";

/** Typed telemetry payload carried by {@link StaleError}. */
export interface StaleErrorDetails {
  /** First stale question id (rev failures only; absent for epoch-only). */
  id?: string;
  /** Rev the caller sent (undefined when the upsert omitted rev). */
  sentRev?: number;
  /** Rev currently in state for {@link StaleErrorDetails.id}. */
  currentRev?: number;
  /** Epoch the caller sent. */
  sentEpoch?: number;
  /** Session epoch at guard time. */
  currentEpoch?: number;
  /** Raw `digestSince(state, sentEpoch)` output — `""` when nothing changed. */
  digest?: string;
}

/**
 * Thrown by {@link assertFresh} when a caller's rev/epoch view is stale.
 *
 * Mode A contract: pi sets `isError` on the tool result ONLY when `execute`
 * throws (pi-api-validation.md:21, extensions.md:2068). Never return an
 * isError field — the rejection message is the model's only healing signal,
 * so it must carry current state (current rev/epoch, current question text,
 * delta digest). Executors (P1.M1.T3.S4/S5) simply let this propagate out
 * of `execute`; the message is the exact h3.8-shaped string built by
 * {@link buildStaleMessage}, and {@link StaleErrorDetails} is for
 * tests/telemetry only — the model never sees it.
 */
export class StaleError extends Error {
  override readonly name = "StaleError";

  constructor(
    message: string,
    readonly details: StaleErrorDetails,
  ) {
    super(message);
  }
}

/** Render inputs for {@link buildStaleMessage} (kept flat for tests). */
export interface StaleMessageParts {
  /** Question id — its presence selects the rev clause. */
  id?: string;
  /** Rev the caller sent (renders as `none` when omitted). */
  sentRev?: number;
  /** Current rev in state. */
  currentRev?: number;
  /** Epoch the caller sent — its presence (with currentEpoch) selects the epoch clause. */
  sentEpoch?: number;
  /** Session epoch at guard time. */
  currentEpoch?: number;
  /** Current question text for the `Current {id}:` line (verbatim, no cap). */
  prompt?: string;
  /** `digestSince` output; `""` renders `(none)`. Omit → no digest clause. */
  digest?: string;
}

/**
 * Render the h3.8-shaped STALE message. Exported for tests; {@link
 * assertFresh} is the production caller. Clause selection:
 *
 * - rev clause (requires `id` + `currentRev`): `{id} is at rev {n} (you
 *   sent {m})` — `{m}` renders as `none` when the caller omitted rev.
 * - epoch clause (requires `sentEpoch` + `currentEpoch`): `session epoch is
 *   {e} (you sent {x})`.
 * - With both clauses they join with `"; "`. A rev clause also appends
 *   `Current {id}: {text}.`; an epoch clause appends `Changes since epoch
 *   {x}: {delta}.` where `digest === ""` renders `(none)`. Always ends with
 *   `Re-apply against current state.` — single spaces throughout.
 */
export function buildStaleMessage(parts: StaleMessageParts): string {
  const hasRev = parts.id !== undefined && parts.currentRev !== undefined;
  const hasEpoch = parts.sentEpoch !== undefined && parts.currentEpoch !== undefined;

  const clauses: string[] = [];
  if (hasRev) {
    clauses.push(`${parts.id} is at rev ${parts.currentRev} (you sent ${parts.sentRev ?? "none"})`);
  }
  if (hasEpoch) {
    clauses.push(`session epoch is ${parts.currentEpoch} (you sent ${parts.sentEpoch})`);
  }

  let message = `STALE: ${clauses.join("; ")}.`;
  if (hasRev) message += ` Current ${parts.id}: ${parts.prompt ?? ""}.`;
  if (hasEpoch && parts.digest !== undefined) {
    const delta = parts.digest === "" ? "(none)" : parts.digest;
    message += ` Changes since epoch ${parts.sentEpoch}: ${delta}.`;
  }
  return `${message} Re-apply against current state.`;
}

/**
 * Stale guard for the interrogate action paths (h2.22/h2.39/h3.8).
 *
 * Mode A contract: pi sets `isError` on the tool result ONLY when `execute`
 * throws (extensions.md:2068). Never return an isError field — the
 * rejection message is the model's only healing signal, so it must carry
 * current state. This function therefore returns silently on success and
 * THROWS on staleness; executors (P1.M1.T3.S4/S5) call it before mutating
 * and let the error propagate.
 *
 * Behavior by action:
 * - `read` / `reopen`: never guarded (h2.22) — returns immediately.
 * - `record`: answers are epoch territory (h2.39), so no per-question rev
 *   check. Missing epoch → plain `Error("answers requires epoch: …")`
 *   (required-param violation, not staleness). Wrong epoch → epoch-only
 *   {@link StaleError} with the `digestSince` delta.
 * - `upsert`: for each incoming question in agent-supplied order, an id
 *   already in state must carry its current `rev` (missing rev = stale).
 *   The FIRST stale id throws — combined h3.8 message when the caller's
 *   epoch (if sent) also mismatches, rev-only variant otherwise. After all
 *   revs pass, a sent-but-mismatched epoch throws the epoch-only variant.
 *   New ids need no rev; an absent caller epoch skips the epoch clause.
 *
 * Pure: reads state only — no mutation, no events, no UI.
 *
 * @throws StaleError when the caller's rev/epoch view is stale
 * @throws Error (plain, non-STALE shape) when `record` omits epoch
 */
export function assertFresh(state: InterrogationState, parsed: ParsedAction): void {
  if (parsed.action === "read" || parsed.action === "reopen") return; // never guarded (h2.22)

  if (parsed.action === "record") {
    if (parsed.epoch === undefined) {
      throw new Error("answers requires epoch: include the epoch from your last read/result");
    }
    if (parsed.epoch !== state.epoch) throw epochStale(state, parsed.epoch);
    return;
  }

  // upsert — rev guard first, in incoming array order; first mismatch wins.
  for (const q of parsed.questions) {
    const current = state.getQuestion(q.id);
    if (current === undefined) continue; // new ids need no rev
    if (q.rev === current.rev) continue;
    const sentEpoch = parsed.epoch;
    if (sentEpoch !== undefined && sentEpoch !== state.epoch) {
      // Combined h3.8 failure: rev AND epoch both stale.
      const digest = digestSince(state, sentEpoch);
      throw new StaleError(
        buildStaleMessage({
          id: q.id,
          sentRev: q.rev,
          currentRev: current.rev,
          sentEpoch,
          currentEpoch: state.epoch,
          prompt: current.prompt,
          digest,
        }),
        {
          id: q.id,
          sentRev: q.rev,
          currentRev: current.rev,
          sentEpoch,
          currentEpoch: state.epoch,
          digest,
        },
      );
    }
    // Rev-only failure (epoch matched or absent): no epoch clause, no digest.
    throw new StaleError(
      buildStaleMessage({
        id: q.id,
        sentRev: q.rev,
        currentRev: current.rev,
        prompt: current.prompt,
      }),
      { id: q.id, sentRev: q.rev, currentRev: current.rev },
    );
  }

  // upsert — epoch guard (every rev passed; caller sent a mismatched epoch).
  const sentEpoch = parsed.epoch;
  if (sentEpoch !== undefined && sentEpoch !== state.epoch) throw epochStale(state, sentEpoch);
}

/** Epoch-only StaleError: session epoch mismatch with digestSince delta. */
function epochStale(state: InterrogationState, sentEpoch: number): StaleError {
  const digest = digestSince(state, sentEpoch);
  return new StaleError(
    buildStaleMessage({ sentEpoch, currentEpoch: state.epoch, digest }),
    { sentEpoch, currentEpoch: state.epoch, digest },
  );
}

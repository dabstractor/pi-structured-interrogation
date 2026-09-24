/**
 * src/reconstruct.ts — state reconstruction from the session branch
 * (P1.M7.T1.S2; h2.41 algorithm, h2.43 branch-relativity, h3.11 restart
 * flow, FR-28 auto-open).
 *
 * [Mode A] — the full reconstruction algorithm:
 *
 * Fired on BOTH `session_start` (every reason: startup|reload|new|resume|fork
 * — pi's session REPLACEMENT flows) and `session_tree` (MID-SESSION `/tree`
 * branch navigation; by the time it fires, the handler's
 * `ctx.sessionManager` already reflects the NEW leaf — the event payload is
 * ignored entirely and the ctx branch is walked). Old in-memory state is
 * always discarded: branch-relativity (h2.43) means the destination
 * branch's history is the only truth, and `resetState()` at the TOP of every
 * run guarantees no state is ever cached across `session_shutdown`.
 *
 * 1. RAW BRANCH WALK — `ctx.sessionManager.getBranch()`, deliberately NOT
 *    `buildContextEntries()`. h2.41's pseudocode names buildContextEntries,
 *    but that list is compaction-projected: after a /compact the interrogate
 *    tool result (storage layer 2, the canonical `details.state` envelope)
 *    leaves LLM context while still living in the session file. The item
 *    contract (and pi semantics — getBranch is the documented "walk from
 *    entry to root, all entry types" read) override the pseudocode: the raw
 *    branch keeps compacted-away entries reachable, which is the entire
 *    point of layer 2 (Q37 residue).
 * 2. BASE SELECTION, in priority order:
 *      a. The LAST `message` entry with role "toolResult", toolName
 *         "interrogate" and a `details.state` envelope (FR-27 canonical,
 *         written by tool.ts on every result). Later occurrences win; any
 *         submission deltas before the last occurrence are already baked
 *         into its state.
 *      b. Else the NEWEST `interrogation-state` custom entry (storage layer
 *         3 mirror, P1.M7.T1.S1) whose payload deserializes — tried
 *         newest-first so one corrupt entry degrades to the previous one
 *         instead of crashing session_start.
 *      c. Else: no state. The singleton stays reset; no panel, no fallback
 *         flag; any suspended-host residue (stale reminder widget /
 *         stale lastOpts.state from the previous branch) is dropped.
 * 3. DELTA REPLAY (best-effort): every `interrogation-submission` custom
 *    MESSAGE entry (the pi.sendMessage transport shape — lands as
 *    `type: "custom_message"`, not the `pi.appendEntry` "custom" shape; both
 *    are read defensively) positioned AFTER the base entry. Answers are
 *    applied through the installed state's real mutation methods so
 *    `changed` fires; each replayed submission that changed something bumps
 *    the epoch exactly once (h3.6: one submission = one bump). CAVEAT:
 *    entries replay VALUE-FIRST — DiffEntry.value is the raw answer.value
 *    (P1.M2.T2.S1), with a legacy fallback to `to` (the label-preferred
 *    display summary) for history written before the field existed; answer
 *    `at` timestamps are not carried. On real restarts the base (tool
 *    result or mirror) already contains the true values; deltas only bridge the gap
 *    AFTER the base (e.g. a submission whose post-submit mirror flush never
 *    landed). The "(unanswered)" sentinel is skipped (an answer CLEARANCE
 *    cannot be replayed from a display summary) and unknown ids are
 *    skipped, never thrown.
 *    - Tool-result base: pure position filter (entry index > base index).
 *    - Mirror base: epoch filter — a submission with details.epoch ≥
 *      base.epoch post-bumps to base.epoch+1, i.e. is NOT yet contained in
 *      the mirrored snapshot (a mirror at epoch E contains exactly the
 *      submissions with details.epoch ≤ E−1), so the correct filter is
 *      "not older than the base epoch". Older submissions are already in
 *      the mirror.
 * 4. MOOT RECOMPUTE — `evaluateDependsOn(state)` exactly once, after
 *    install + replay (idempotent; h2.29 reasons re-derived — reasons are
 *    never persisted).
 * 5. SURFACING — split strictly by origin (BUG: tree navigation used to
 *    ride the FR-28 auto-open and popped the panel in the user's face on
 *    every `/tree` hop onto a branch with interrogation history, even when
 *    the panel was suspended or the user never had it open):
 *      - `session-start` (a fresh session runtime — restart/resume/fork):
 *        SURFACE-002 (FR-28 / FR-D7): the FR-28 panel auto-open is
 *        DISABLED ENTIRELY — session_start NEVER opens the panel.
 *        Reconstruction's ONLY UI act is the suspend widget line:
 *        `updateSuspendWidget(ctx, state)` — the helper owns the
 *        hasResumableQuestions gate (set when resumable questions exist,
 *        clear otherwise) and is a no-op on surfaces without a widget
 *        slot. The panel returns only via the allow-list: `/interrogate`
 *        (closed-host-with-live-state path), an agent upsert leaving
 *        unanswered questions, or {reopen:true}. NO drafts are restored
 *        (FR-28, Q6=B): restart loses drafts, never reconstructs them —
 *        reconstruction never touches the DraftStore. Non-TUI: the module
 *        fallback flag is set —
 *        {@link isFallbackActive} is the contract the interrogate tool
 *        executor (h2.26 digest decision, later milestone) consumes to pick
 *        digest-vs-panel mode after a restart. `onRestored` (FR-34) fires
 *        BEFORE any local UI act so a conformant remote client re-renders
 *        after the restart — only the local panel is suppressed, remote
 *        surfaces are not.
 *      - `session-tree` (mid-session `/tree` navigation): SILENT. The state
 *        singleton is installed (later tool reads, `/interrogate` resumes,
 *        and the completion path must reflect the branch the user is on
 *        NOW), but NO surface ever appears: no panel open, no reopen of a
 *        suspended host, no FR-34 `onRestored` bridge emission (re-emitting
 *        would pop remote clients exactly the way the panel popped). A
 *        panel that is STILL OPEN at navigation time is suspended — it can
 *        never keep rendering the abandoned branch's questions — and the
 *        host's stored references are retargeted (`retargetState`) onto the
 *        fresh state + current surface so the NEXT deliberate resume
 *        (`/interrogate`, a model upsert while suspended, `{reopen:true}`)
 *        rehydrates branch-correctly. The user's next surfacing action is
 *        theirs to make. A branch with NO interrogation state tears every
 *        residue down (open panel suspended first, then widget + resume
 *        record disposed) — navigating to an interrogation-free branch must
 *        not leave a stale reminder advertising a foreign branch's questions.
 *        The non-TUI fallback flag is still recomputed — it is a digest
 *        decision input, not a surface, and the tool executor on the new
 *        branch must keep emitting the right result shape.
 *
 * This module is READ-ONLY toward persistence: the mirror owns writing
 * (S1), this module only consumes entries. Reconstruction via setState
 * emits no `changed` by itself; replay mutations may — the S1 mirror then
 * re-attaches on the next tool_execution_end and appends a fresh entry
 * (harmless audit append). Not implemented here: the mirror itself
 * (P1.M7.T1.S1), compaction instructions (M7.T2.S1), entry renderers
 * (M7.T3).
 */
import type {
  ExtensionAPI,
  SessionEntry,
  SessionStartEvent,
  SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import type { SubmissionMessage } from "./delivery.js";
import { isNonTui } from "./fallback.js";
import { evaluateDependsOn } from "./depends-on.js";
import type { DraftStore, PanelHost, PiUISurface } from "./panel/panel.js";
import { updateSuspendWidget } from "./panel/suspend.js";
import {
  INTERROGATION_STATE_ENTRY_TYPE,
  type InterrogationStateEntryData,
} from "./persistence.js";
import {
  InterrogationState,
  resetState,
  setState,
  type InterrogationState as LiveState,
  type SerializedState,
} from "./state.js";

/**
 * The custom MESSAGE type of interrogation submissions (delivery.ts
 * SubmissionMessage.customType). Local literal with a sync-reference
 * comment — delivery.ts owns the canonical shape; there is no exported
 * runtime constant to import.
 */
const SUBMISSION_ENTRY_TYPE = "interrogation-submission";

/**
 * Display sentinel snapshots.ts uses for a missing answer on either diff
 * side. Duplicated by design (snapshots.ts keeps it module-private); THIS
 * comment is the sync reference — a DiffEntry with `to` equal to this
 * marker represents an answer CLEARANCE, which replay cannot express from
 * a display summary, so it is skipped.
 */
const UNANSWERED_SUMMARY = "(unanswered)";

/** Where the reconstructed base state came from. */
export type ReconstructSource = "tool-result" | "mirror-entry" | "none";

/**
 * Which event triggered the run — the ONLY input that splits surfacing
 * behavior (module JSDoc step 5). `session-start` (pi's session replacement
 * flows: startup|reload|new|resume|fork) never auto-opens the panel
 * (SURFACE-002) — state installs silently and the suspend widget line is
 * set when resumable questions exist; `session-tree` (mid-session `/tree`
 * navigation) is always silent — state reconstructs, surfaces never move.
 */
export type ReconstructionOrigin = "session-start" | "session-tree";

/** Result of one {@link reconstructFromBranch} run. */
export interface ReconstructResult {
  /** Which storage layer supplied the base state. */
  source: ReconstructSource;
  /** Number of submission entries replayed onto the base. */
  replayed: number;
  /**
   * Whether the TUI auto-open path actually opened the panel — ALWAYS
   * false under SURFACE-002 (session-start never opens; the field stays
   * for the P3.M2.T2.S1 test contract).
   */
  opened: boolean;
  /** Whether the non-TUI fallback flag was set by this run. */
  fallbackActive: boolean;
}

/**
 * Options for {@link reconstructFromBranch} / {@link createReconstruction}
 * — the factory-closure dependencies index.ts already holds.
 */
export interface ReconstructionOptions {
  /** Shared interrogator config (loaded once in the factory). */
  config: InterrogatorConfig;
  /** Panel host (phase source + residue cleanup for empty branches). */
  host: PanelHost;
  /**
   * The factory's ONE DraftStore — held for the deliberate resume paths
   * (`/interrogate` etc.). NEVER read or written by reconstruction itself
   * (FR-28, Q6=B).
   */
  drafts?: DraftStore;
  /**
   * FR-34 (remote bridge surface): invoked once per run with the restored
   * state whenever the branch yielded a non-empty interrogation — BEFORE
   * the mode split, so BOTH the TUI auto-open and the non-TUI fallback
   * paths see it. index.ts routes it to remote-bridge's emitFlow
   * (`ask:resume`) so a conformant client re-renders the question set
   * after a restart even when no desktop panel exists (rpc daemon). The
   * hook must not throw into reconstruction (bridge handlers stay
   * defensive); emitFlow gates on live questions + config internally.
   */
  onRestored?: (state: InterrogationState) => void;
}

/**
 * Narrow structural context for reconstruction: what pi actually hands the
 * `session_start`/`session_tree` handler (`ExtensionContext`), reduced to
 * the surface this module touches. `ctx` IS a PiUISurface — the same
 * per-event carrier every other panel entry point uses (the ExtensionAPI
 * root has no `ui`).
 */
export interface ReconstructionContext extends PiUISurface {
  /** Run mode: "tui" | "rpc" | "json" | "print" (h2.26 guard input). */
  mode?: string;
  /** Whether dialog-capable UI is available (h2.26 guard input). */
  hasUI?: boolean;
  /** Read-only session manager — only the raw branch is read. */
  sessionManager: {
    getBranch(fromId?: string): SessionEntry[];
  };
}

// ------------------------------------------------------- fallback flag (h2.26)

let fallbackActive = false;

/**
 * Whether the non-TUI digest fallback is active for the CURRENT branch —
 * i.e. the last reconstruction found a non-empty interrogation state in a
 * non-TUI run. Consumed by the interrogate tool executor's digest decision
 * (h2.26, later milestone): true ⇒ answer input arrives via chat, so upsert
 * results carry the RELAY_INSTRUCTION digest. Recomputed on every
 * reconstruction run; never meaningful across a run that found no state.
 */
export function isFallbackActive(): boolean {
  return fallbackActive;
}

/** Set/clear the non-TUI fallback flag (reconstruction owns every write). */
export function setFallbackActive(value: boolean): void {
  fallbackActive = value;
}

// ------------------------------------------------------------------ scanning

interface WalkResult {
  /** Raw `details.state` of the LAST interrogate tool result carrying one. */
  toolState: unknown;
  /** Branch index of that tool-result entry (position filter anchor). */
  toolIndex: number;
  /** All mirror entries in walk order (newest = last). */
  mirrors: Array<{ index: number; data: unknown }>;
  /** All submission entries in walk order. */
  submissions: Array<{ index: number; details: SubmissionMessage["details"] }>;
}

/** Tolerant `details` read for a submission entry (either pi entry shape). */
function submissionDetails(entry: SessionEntry): SubmissionMessage["details"] | undefined {
  if (entry.type === "custom_message") {
    if (entry.customType !== SUBMISSION_ENTRY_TYPE) return undefined;
    return entry.details as SubmissionMessage["details"] | undefined;
  }
  // Defensive: the PRP-era sketch assumed the pi.appendEntry ("custom")
  // shape for submissions; real transports produce "custom_message". Read
  // both so hand-persisted sessions of either shape replay.
  if (entry.type === "custom") {
    if (entry.customType !== SUBMISSION_ENTRY_TYPE) return undefined;
    const data = entry.data as { details?: SubmissionMessage["details"] } | undefined;
    return data?.details;
  }
  return undefined;
}

/** Single pass over the raw branch, collecting every candidate in order. */
function walkBranch(branch: SessionEntry[]): WalkResult {
  const result: WalkResult = { toolState: undefined, toolIndex: -1, mirrors: [], submissions: [] };
  branch.forEach((entry, index) => {
    if (entry.type === "message") {
      const msg = entry.message as { role?: string; toolName?: string; details?: unknown };
      if (msg.role !== "toolResult" || msg.toolName !== "interrogate") return;
      const details = msg.details as { state?: unknown } | undefined;
      if (details === undefined || details.state === undefined || details.state === null) return;
      result.toolState = details.state; // LAST occurrence wins (FR-27)
      result.toolIndex = index;
      return;
    }
    if (entry.type === "custom" && entry.customType === INTERROGATION_STATE_ENTRY_TYPE) {
      result.mirrors.push({ index, data: entry.data });
      return;
    }
    const details = submissionDetails(entry);
    if (details !== undefined) result.submissions.push({ index, details });
  });
  return result;
}

/**
 * Tolerant deserialize wrapper: deserialize is designed to never throw on
 * untrusted input, but a hostile getter/proxy payload still could — a
 * failure must degrade to the next candidate, never crash session_start.
 */
function tryDeserialize(data: unknown): LiveState | undefined {
  try {
    return InterrogationState.deserialize(data);
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------- replay

/**
 * Apply one submission's changed entries. Returns true when at least one
 * answer actually applied (which entitles the caller to one epoch bump —
 * h3.6: one submission, one bump).
 */
function replaySubmission(state: LiveState, details: SubmissionMessage["details"]): boolean {
  const changed = Array.isArray(details?.changed) ? details.changed : [];
  let applied = 0;
  for (const entry of changed) {
    const id = entry?.id;
    if (typeof id !== "string" || state.getQuestion(id) === undefined) continue;
    // Value-first resolution (BUG-007): `value` is the RAW post-change
    // answer.value (DiffEntry.value, snapshots.ts — P1.M2.T2.S1), so replay
    // restores canonical values even when the option label differs. Legacy
    // history written before that field existed carries no `value` — fall
    // back to `to`, the label-preferred display summary (best-effort: may
    // restore a label when labels differ). `at` timestamps are not carried
    // in deltas either. See module JSDoc.
    const raw = entry.value;
    const resolved = typeof raw === "string" && raw !== "" ? raw : entry.to;
    // The sentinel check applies to the RESOLVED value: it skips answer
    // CLEARANCES (`to` sentinel) and guards a hypothetical legacy entry
    // whose `value` is unset while `to` is the sentinel.
    if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;
    state.applyAnswer(id, { value: resolved, at: new Date().toISOString() });
    applied++;
  }
  if (applied > 0) state.bumpEpoch();
  return applied > 0;
}

// ------------------------------------------------------------------- engine

/**
 * Reconstruct the interrogation state from the CURRENT branch of
 * `ctx.sessionManager` and install it as the session singleton (full
 * algorithm in the module JSDoc).
 *
 * Safe to call on any branch, any mode, any number of times: every run
 * starts from `resetState()` (h2.43 — never cached across shutdown) and
 * every entry access is guarded, so a malformed session file degrades to
 * "no state" instead of crashing the event.
 *
 * @param ctx    the handler's ExtensionContext (structurally narrowed)
 * @param opts   shared config + panel host + the factory DraftStore
 * @param origin which event fired the run — "session-start" (NEVER opens
 *               the panel under SURFACE-002: silent install + suspend
 *               widget line; the default keeps direct callers on the
 *               historical restart contract) or "session-tree" (silent:
 *               state only, NEVER a surface — see module JSDoc step 5)
 */
export function reconstructFromBranch(
  ctx: ReconstructionContext,
  opts: ReconstructionOptions,
  origin: ReconstructionOrigin = "session-start",
): ReconstructResult {
  // h2.43: discard ALL prior in-memory state before looking at the branch —
  // also invalidates the fallback flag; recomputed below.
  resetState();
  setFallbackActive(false);

  const walk = walkBranch(ctx.sessionManager.getBranch());

  // Base selection, priority order (module JSDoc step 2).
  let source: ReconstructSource = "none";
  let state: LiveState | undefined;
  if (walk.toolState !== undefined) {
    state = tryDeserialize(walk.toolState);
    if (state !== undefined) source = "tool-result";
  }
  if (state === undefined) {
    for (let i = walk.mirrors.length - 1; i >= 0; i--) {
      const mirror = walk.mirrors[i] as { index: number; data: unknown };
      const data = mirror.data as InterrogationStateEntryData | undefined;
      if (data === undefined || data.state === undefined || data.state === null) continue;
      state = tryDeserialize(data.state);
      if (state !== undefined) {
        source = "mirror-entry";
        break;
      }
    }
  }
  if (state === undefined) {
    // No interrogation traces on this branch (step 2c): drop any residue of
    // a suspended host from the previous branch (stale reminder widget +
    // stale lastOpts.state) so nothing stale stays resumable.
    if (origin === "session-tree") {
      // Tree navigation onto an interrogation-free branch is a full
      // teardown: an open panel descends (suspend — it renders a dead
      // branch's questions), then the widget + resume record go too.
      if (opts.host.isOpen()) opts.host.suspend();
      opts.host.dispose();
    } else if (!isNonTui(ctx.mode ?? "tui", ctx.hasUI ?? true) && !opts.host.isOpen()) {
      opts.host.dispose();
    }
    return { source: "none", replayed: 0, opened: false, fallbackActive: false };
  }

  // Install BEFORE replay so mutations fire `changed` on the live singleton.
  setState(state);

  // Delta replay (module JSDoc step 3).
  let replayed = 0;
  for (const submission of walk.submissions) {
    if (source === "tool-result") {
      if (submission.index <= walk.toolIndex) continue; // already in the base
    } else {
      // Mirror base: position-free epoch filter (module JSDoc step 3).
      const epoch = submission.details?.epoch;
      if (typeof epoch !== "number" || epoch < state.epoch) continue;
    }
    if (replaySubmission(state, submission.details)) replayed++;
  }

  // Moot recompute — exactly once per run (module JSDoc step 4).
  evaluateDependsOn(state);

  const nonEmpty = state.orderedQuestions().length > 0;
  if (!nonEmpty) {
    // E.g. a completed interrogation (questions cleared, completed flag
    // restored for exactly-once). State stays installed; no surface.
    if (origin === "session-tree") {
      // Same full teardown as the no-traces branch: a completed interrogation
      // has nothing to resume, so no reminder may linger after navigation.
      if (opts.host.isOpen()) opts.host.suspend();
      opts.host.dispose();
    } else if (!isNonTui(ctx.mode ?? "tui", ctx.hasUI ?? true) && !opts.host.isOpen()) {
      opts.host.dispose();
    }
    return { source, replayed, opened: false, fallbackActive: false };
  }

  // Non-TUI: the digest fallback flag only — no surface exists to move.
  // Recomputed on BOTH origins: it is a tool-result shape decision input,
  // not a popup, and the branch the user is on NOW decides it.
  if (isNonTui(ctx.mode ?? "tui", ctx.hasUI ?? true)) {
    setFallbackActive(true);
    // FR-34 (restart only): a fresh runtime re-renders on conformant remote
    // clients. Deliberately NOT fired on session-tree — re-emitting would
    // surface the question set on remote clients the same way the panel
    // popped on tree navigation.
    if (origin === "session-start") opts.onRestored?.(state);
    return { source, replayed, opened: false, fallbackActive: true };
  }

  if (origin === "session-tree") {
    // SILENT branch-follow (module JSDoc step 5): never open, never reopen.
    // Retarget FIRST (sync) so the suspend's async landing spots — the
    // reminder widget reads lastOpts.state in the custom() .then — render
    // the CURRENT branch's counts, and a later deliberate resume rehydrates
    // from the fresh state on the CURRENT surface.
    opts.host.retargetState(state, ctx);
    if (opts.host.isOpen()) opts.host.suspend();
    return { source, replayed, opened: false, fallbackActive: false };
  }

  // FR-34: restored with live content on a fresh runtime — hand the state
  // to the remote bridge surface. Remote clients STILL re-render after a
  // restart: only the local panel surface is suppressed (SURFACE-002).
  opts.onRestored?.(state);

  // SURFACE-002 (FR-28 / FR-D7): session_start NEVER opens the panel.
  // Reconstruction's ONLY UI act is the suspend widget line — set directly
  // via suspend.ts's helper (hasResumableQuestions gate + exact h2.3 string).
  // The panel returns only via the allow-list: /interrogate (closed-host-
  // with-live-state path), an agent upsert leaving unanswered questions, or
  // {reopen:true}. Drafts are not restored either way (FR-28, Q6=B) — no
  // DraftStore is touched here.
  updateSuspendWidget(ctx, state);
  return { source, replayed, opened: false, fallbackActive: false };
}

/**
 * Subscribe reconstruction to BOTH branch-truth events: `session_start`
 * (every reason — startup|reload|new|resume|fork; SURFACE-002: silent
 * install + suspend widget line, NEVER a panel) and `session_tree`
 * (mid-session `/tree` branch navigation; ctx already
 * reflects the new leaf — SILENT: state only, never a surface). Event
 * payloads are ignored — the ctx branch is the only input; the ORIGIN is
 * the only thing the two subscriptions disagree on.
 *
 * ONE instance per extension activation, created in the index.ts factory
 * after the panel host + drafts exist. No dispose seam: subscriptions die
 * with the extension runtime (same posture as the S1 mirror).
 */
export function createReconstruction(
  pi: Pick<ExtensionAPI, "on">,
  opts: ReconstructionOptions,
): void {
  const run = (
    event: SessionStartEvent | SessionTreeEvent,
    ctx: ReconstructionContext,
    origin: ReconstructionOrigin,
  ): void => {
    void event;
    reconstructFromBranch(ctx, opts, origin);
  };
  pi.on("session_start", (event, ctx) => run(event, ctx, "session-start"));
  pi.on("session_tree", (event, ctx) => run(event, ctx, "session-tree"));
}

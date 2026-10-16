/**
 * src/panel/sidechat.ts — the SIDECHAT-002 store (P1.M1.T3.S1): the ONE
 * side-chat-in-memory singleton record plus its get/openOrReplace/discard
 * lifecycle. Pure leaf module: ZERO pi imports, zero UI, zero ctx — the
 * M3.T1 cache-isolation banned-API guard is satisfied by construction.
 *
 * SIDECHAT-002 contracts (sidechat-contracts.md:35-47, verbatim authority):
 * - Exactly ONE chat lives in extension memory. Opening on another question
 *   REPLACES it wholesale — no confirmation, no carry-over of messages,
 *   usage, snapshots, or stream state. The API has no confirm surface at
 *   all; there are exactly two exits: replacement and discard.
 * - Survives panel suspend/resume via MODULE memory: `done(null)` kills the
 *   panel instance and `resumeOpenPanel` rebuilds it from `lastOpts`
 *   (panel-view-integration.md §Suspend), so anything stored on the panel
 *   dies with it. Module scope is the only zero-code way to make "survives
 *   suspend" true. Pi restart loses the chat silently — NO session-file
 *   writes of any kind; the chat lives in NONE of the three storage layers
 *   (state-and-persistence.md §Side chat, h2.51). No persistence exists
 *   here by construction: no InterrogationState fields, no tool-result
 *   details, no custom entries, no renderers.
 * - `discard()` is a plain in-memory delete. It does NOT call
 *   `abortController.abort()` — aborting an in-flight stream, in the right
 *   order, is the CALLER's contract (P1.M2.T5.S1 discard hooks). Aborting
 *   here would double-abort or abort the wrong controller after a
 *   replacement.
 *
 * SIDECHAT-003 extension (sidechat-contracts.md:49-58): `systemPrompt` and
 * `branchSnapshot` live ON the record (beyond SIDECHAT-002's field list)
 * because the snapshot is frozen ONCE at creation — opening on another
 * question re-invokes the builders, but a mid-chat refresh never re-reads
 * the branch. The builders are therefore invoked ONLY when a record is
 * CREATED (same-question reuse returns the existing record untouched).
 * The snapshot's producer is `takeBranchSnapshot`
 * (panel/branch-snapshot.ts, P1.M1.T4.S1): the main session's FULL
 * `getBranch()` replay as pi-ai `Message[]`, read once at creation.
 * Mid-chat submissions in the main panel leave the snapshot STALE —
 * accepted v1 (sidechat-contracts.md); a `/clear`/`/new` reset is the
 * only sanctioned refresh.
 *
 * SIDECHAT-005 Mode A contract (P1.M1.T5.S1): the side chat talks to models
 * ONLY through nested, injected model calls (the port lives in
 * panel/sidechat-engine.ts) — NEVER through the main session's conversation
 * surface. The five SIDECHAT-005-banned mutation APIs (message-send /
 * user-message-send / active-tools / tool-registration / model-switch) appear
 * NOWHERE in this module set, not even in comments — the M3.T1 guard greps
 * the file set and must stay clean, so the ban list is described, never
 * spelled, here. Model-resolution contract (SIDECHAT-003, engine-owned):
 * `config.sideChatModel` ("provider/model-id") → registry find hit wins →
 * unset/blank/malformed/unknown notifies ONCE and falls back to the session
 * model (else first available) → nothing resolvable yields an INERT record
 * (empty model snapshot marker) that opens inert and dispatches nothing.
 *
 * `notices` (P1.M1.T5.S1): append-only, non-fatal engine events the view
 * renders — `auth` (the model port threw synchronously; pi-ai throws when
 * provider auth is missing) and `error` (inert/invalid dispatch refusals).
 * The panel NEVER blocks on an engine failure: every failure path appends a
 * notice and settles the record back to `"idle"`.
 *
 * Consumers (all inject their builders — no config/ctx knowledge here):
 * T3.S2 reset commands, T4.S1/S2 branch builders, T5.S1 model resolution
 * (the deps bag is their injection seam), M2.T4.S1 open path,
 * M2.T5.S1 discard hooks. `ChatStreamState` is open to extension by T5.S2
 * (finer states) — never narrowed.
 */

/** One chat turn. Assistant stop-reason/usage live on the record's tally,
 * not per-message; T5's loop owns freezing turns into this shape. */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
}

/** Stream lifecycle of the record. Start "idle"; T5.S2 may EXTEND the union. */
export type ChatStreamState = "idle" | "streaming";

/** Running token/cost tally for the chat. Zeroed at creation; T5.S3 accumulates. */
export interface ChatUsage {
  input: number;
  output: number;
  totalCost: number;
}

/** Opaque model identity frozen at creation (T5.S1's builder produces it). */
export interface ModelSnapshot {
  provider: string;
  modelId: string;
}

/** Non-fatal engine event surfaced to the view (P1.M1.T5.S1). `auth`: the
 * model port threw synchronously (pi-ai throws when provider auth is
 * missing); `error`: dispatch refused (e.g. an inert record opened with no
 * resolvable model). Append-only, oldest first; failures land here and the
 * record settles back to `"idle"` — the panel never blocks. */
export interface SidechatNotice {
  kind: "auth" | "error";
  text: string;
  at: string;
}

/** Frozen context-branch snapshot. Real runtime shape: pi-ai `Message[]`,
 * produced ONCE at creation by `takeBranchSnapshot`
 * (panel/branch-snapshot.ts) and injected via
 * {@link SidechatRebindDeps.buildBranchSnapshot}. Held opaque as
 * `readonly unknown[]` — zero pi imports in this module is load-bearing
 * (M3.T1 cache-isolation guard); consumers needing the Messages read the
 * producer module instead. */
export type BranchSnapshot = readonly unknown[];

/** Injected builder bag, invoked ONLY when a record is created (never on
 * same-question reuse — SIDECHAT-003's frozen-snapshot rule). Keeping the
 * builders behind arguments keeps config/model/branch knowledge OUT of this
 * module (injected-port testability rule; nested-llm-and-snapshot-seams.md). */
export interface SidechatRebindDeps {
  resolveModelSnapshot: () => ModelSnapshot;
  buildSystemPrompt: () => string;
  buildBranchSnapshot: () => BranchSnapshot;
}

/** The single side-chat record. `systemPrompt`/`branchSnapshot` extend
 * SIDECHAT-002's list to carry the SIDECHAT-003 once-at-creation freeze;
 * `notices` (T5.S1) adds the engine's non-fatal event log. */
export interface SidechatRecord {
  questionId: string;
  messages: ChatMessage[];
  streamState: ChatStreamState;
  abortController: AbortController;
  modelSnapshot: ModelSnapshot;
  systemPrompt: string;
  branchSnapshot: BranchSnapshot;
  usage: ChatUsage;
  /** Non-fatal engine notices (auth throws, inert-dispatch refusals), oldest first. */
  notices: SidechatNotice[];
}

// Module scope is LOAD-BEARING: the panel instance dies on suspend, so only
// module memory makes "survives suspend, dies on restart" true with zero
// persistence code (state.ts singleton discipline).
let current: SidechatRecord | undefined;

/** The live side-chat record, or undefined before the first open / after discard. */
export function get(): SidechatRecord | undefined {
  return current;
}

/**
 * Open the side chat on `questionId` — or replace the existing one
 * wholesale (SIDECHAT-002: no confirmation, no carry-over; the API has no
 * confirm surface by design).
 *
 * - Same questionId → the existing record is returned BYTE-UNCHANGED and
 *   the builders are NOT invoked (SIDECHAT-003: never re-read the branch
 *   mid-chat).
 * - Different questionId (or no record) → a fresh record is built — each
 *   builder invoked EXACTLY once, empty messages, `"idle"` stream state,
 *   fresh AbortController, zeroed usage — and replaces the old record
 *   wholesale. The old record's controller is NOT aborted (caller's job).
 */
export function openOrReplace(questionId: string, deps: SidechatRebindDeps): SidechatRecord {
  if (current !== undefined && current.questionId === questionId) return current; // reuse: NO rebind
  current = buildFresh(questionId, deps);
  return current;
}

/**
 * The ONE record-creation path — shared by {@link openOrReplace}'s
 * different-question branch and {@link resetChat} so the two can never
 * diverge on what "fresh" means: each builder invoked EXACTLY once, empty
 * messages, `"idle"` stream state, fresh AbortController, zeroed usage.
 * Internal (not exported); assigns nothing — callers own the singleton.
 */
function buildFresh(questionId: string, deps: SidechatRebindDeps): SidechatRecord {
  return {
    questionId,
    messages: [],
    streamState: "idle",
    abortController: new AbortController(),
    modelSnapshot: deps.resolveModelSnapshot(), // exactly once per creation
    systemPrompt: deps.buildSystemPrompt(),
    branchSnapshot: deps.buildBranchSnapshot(),
    usage: { input: 0, output: 0, totalCost: 0 },
    notices: [], // T5.S1: every record creation path gets the empty log
  };
}

/**
 * Classify an input as a side-chat slash command (SIDECHAT-002,
 * sidechat-contracts.md:45-46): byte-exact match of the FIRST
 * whitespace-delimited token against `/clear` or `/new` — the two are
 * aliases for the same reset (classify distinguishes only so callers
 * could differ later). Everything else is an ordinary message: `null` for
 * the contract's four exemplars — a `/usr/bin` path (`/usr/bin/env`), a
 * prefix (`/clearance`), a mid-sentence token (`see /clear below`), a
 * markdown heading (`## /clear`) — and also for case variants (`/Clear`)
 * and empty/whitespace-only input (no whitespace-delimited token at all).
 * Pure: no trimming beyond whitespace splitting, no case-folding, no prefix
 * or substring matching — those are all bugs, not leniency.
 */
export function classifyChatCommand(input: string): "/clear" | "/new" | null {
  // The FIRST whitespace-delimited TOKEN: leading whitespace separates
  // tokens rather than forming one, so the scan skips empty split segments
  // ("  /clear" tokenizes to "/clear"; "" and "  " tokenize to nothing).
  const first = input.split(/\s+/).find((tok) => tok !== "") ?? "";
  if (first === "/clear") return "/clear";
  if (first === "/new") return "/new";
  return null;
}

/**
 * The `/clear` + `/new` reset (SIDECHAT-002:45): discard the record's
 * messages AND usage and REBIND FRESH to the CURRENT question — a new
 * branch snapshot + system prompt + model resolution via the injected
 * builders, fresh AbortController, `"idle"` stream state. Deliberately
 * bypasses {@link openOrReplace}'s same-question reuse: per SIDECHAT-003
 * (sidechat-contracts.md:49-58) the snapshot is frozen at creation, so a
 * reset is the ONLY sanctioned mid-chat snapshot refresh — it must re-run
 * the builders even when `questionId` is unchanged (a reset is a rebuild,
 * never a reuse). Works whether or not a record exists (a first-ever
 * `/clear` legally creates it). Caller-owns-abort: the old record's
 * in-flight stream is NOT aborted here, same rule as {@link discard}
 * (mid-stream abort ordering is P1.M2.T5.S1). The engine never touches
 * the view — "view stays open" holds by construction (this module has no
 * view code); re-rendering is the caller's (P1.M2.T3.S1).
 *
 * @returns the new fresh record (also installed as the singleton).
 */
export function resetChat(questionId: string, deps: SidechatRebindDeps): SidechatRecord {
  current = buildFresh(questionId, deps);
  return current;
}

/**
 * Discard the record — plain in-memory delete (`current = undefined`).
 * Deliberately does NOT abort the controller: mid-stream abort ordering is
 * the CALLER's contract (P1.M2.T5.S1); doing it here would double-abort or
 * abort the wrong controller after a replacement.
 */
export function discard(): void {
  current = undefined;
}

/** Test-only seam: module-scope reset for vitest beforeEach (state.ts `resetState` precedent). */
export function resetSidechatForTests(): void {
  current = undefined;
}

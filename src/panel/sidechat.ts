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
 * Streaming consumption (P1.M1.T5.S2, SIDECHAT-001/002/005): while a turn
 * is in flight the engine accumulates the reply into `streamingText` — the
 * VIEW's polling buffer (P1.M2.T1.S1 renders the streaming cursor off it;
 * the engine renders nothing). It is refreshed from every stream event's
 * cumulative `partial` and cleared on EVERY settle. `done` freezes the
 * assistant ChatMessage (canonical text from `done.message`, `stopReason`
 * recorded). An aborted turn rolls back FULLY — the user turn is POPPED
 * ("the turn never happened"), no assistant record, no notice, zero usage
 * residue. Only completed replies ever enter `messages`, so the answer
 * parser (P1.M1.T6.S1) structurally never sees partial text.
 *
 * Consumers (all inject their builders — no config/ctx knowledge here):
 * T3.S2 reset commands, T4.S1/S2 branch builders, T5.S1 model resolution
 * (the deps bag is their injection seam), M2.T4.S1 open path,
 * M2.T5.S1 discard hooks (fire `formatChatCloseNotice(record.usage)` on
 * every close/discard path). `ChatStreamState` is open to extension by
 * T5.S2 (finer states) — never narrowed.
 */

/** Terminal stop reasons for assistant ChatMessages (P1.M1.T5.S2).
 * Hand-written pi-free string union — ZERO pi imports in this module is
 * load-bearing (M3.T1 cache-isolation guard). "pending" is deliberately
 * omitted: records freeze TERMINAL outcomes only, never an in-flight one. */
export type ChatStopReason = "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** One chat turn. Assistant rows carry the terminal `stopReason`
 * (P1.M1.T5.S2); usage lives on the record's tally (T5.S3's accumulation,
 * fed by the frozen rows' source messages — not stored per-message here). */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
  stopReason?: ChatStopReason;
}

/** Stream lifecycle of the record. Start "idle"; T5.S2 may EXTEND the union. */
export type ChatStreamState = "idle" | "streaming";

/** Running token/cost tally for the chat: zeroed at creation and on every
 * reset, accumulated per COMPLETED turn at the engine's freeze site
 * (P1.M1.T5.S3). Aborted turns ("the turn never happened"), error turns
 * (never freeze) and replaced/dead records (liveness guard precedes the
 * freeze) contribute nothing — structurally, with no compensation logic.
 * The ONLY usage home in the module set (SIDECHAT-005): read by
 * `formatChatCloseNotice`, never by anything else. */
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
 * `notices` (T5.S1) adds the engine's non-fatal event log;
 * `streamingText` (T5.S2) adds the in-flight display buffer. */
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
  /** The VIEW's polling buffer (P1.M1.T5.S2): the in-flight reply's text,
   * refreshed from every stream event's cumulative `partial` while
   * `streamState === "streaming"` (P1.M2.T1.S1 renders the cursor off it);
   * cleared on EVERY settle. Display-only — frozen assistant messages take
   * their canonical text from the stream's done message, never from here. */
  streamingText: string;
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
    streamingText: "", // T5.S2: the display buffer starts (and restarts) empty
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

/**
 * The spec-pinned compact close notice (ui-spec §Side chat "Usage & close",
 * verbatim: `chat closed · 12.4K in · 3.1K out · $0.07`), fed by the
 * record's `ChatUsage` tally. Pure: ChatUsage (plain numbers) in → string
 * out, zero pi imports, zero side effects — the engine translates the
 * nested pi-ai usage into these numbers; this module never sees a pi type.
 *
 * Humanization rules (pinned byte-exact): tokens < 1000 → plain digits
 * ("0", "999"); ≥ 1000 → one decimal via `(n / 1000).toFixed(1)` with a
 * trailing ".0" stripped (1000 → "1K", never "1.0K"; 12499 → "12.5K";
 * no "M" tier — side chats are short). Cost ALWAYS two decimals via
 * toFixed(2) ("$0.00", "$1.20", never "$1.2"); accumulated-fp noise is
 * absorbed by this display-only rounding, deliberately no cent-rounding
 * arithmetic. Separator is ` · ` (space, U+00B7, space).
 *
 * NOT fired anywhere in this module — the discard/close hooks (P1.M2.T5.S1)
 * own every close path that shows it.
 */
export function formatChatCloseNotice(usage: ChatUsage): string {
  const tokens = (n: number): string =>
    n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `chat closed · ${tokens(usage.input)} in · ${tokens(usage.output)} out · $${usage.totalCost.toFixed(2)}`;
}

/** Test-only seam: module-scope reset for vitest beforeEach (state.ts `resetState` precedent). */
export function resetSidechatForTests(): void {
  current = undefined;
}

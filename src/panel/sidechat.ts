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

/** Frozen context-branch snapshot. The real shape lands with P1.M1.T4.S1;
 * this module only freezes and holds it — never interprets it. */
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
 * SIDECHAT-002's list to carry the SIDECHAT-003 once-at-creation freeze. */
export interface SidechatRecord {
  questionId: string;
  messages: ChatMessage[];
  streamState: ChatStreamState;
  abortController: AbortController;
  modelSnapshot: ModelSnapshot;
  systemPrompt: string;
  branchSnapshot: BranchSnapshot;
  usage: ChatUsage;
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
  current = {
    questionId,
    messages: [],
    streamState: "idle",
    abortController: new AbortController(),
    modelSnapshot: deps.resolveModelSnapshot(), // exactly once per creation
    systemPrompt: deps.buildSystemPrompt(),
    branchSnapshot: deps.buildBranchSnapshot(),
    usage: { input: 0, output: 0, totalCost: 0 },
  };
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

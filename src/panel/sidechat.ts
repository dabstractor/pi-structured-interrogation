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
 * T5.S2 (finer states) — never narrowed. T6.S2 adds the answer settle
 * (`settleApplyDecision`/`clearPendingConfirm`): the store PRODUCES
 * `ApplyDecision`s and maintains `record.pendingConfirm` — it never routes
 * a decision into an apply seam itself; the panel's single routing consumer
 * (P1.M2.T6.S1) does ("the engine produces a decision, the panel routes
 * it", panel-view-integration.md §Open/replace/discard).
 *
 * Answer protocol (SIDECHAT-004): `parseAnswerBlock` (P1.M1.T6.S1) is the
 * pure parser of a COMPLETED reply's fenced ```answer blocks — its
 * `ParsedAnswer`/`AnswerBlockRejection` unions are consumed by
 * P1.M1.T6.S2 (ApplyDecision/pendingConfirm at the settle seam),
 * P1.M2.T1.S2 (the per-reason in-view notice) and P1.M2.T6.S1 (apply
 * through the ordinary accept seams). T6.S2 consumes it at its settle seam
 * (`settleApplyDecision`) — the parser's only other sanctioned reference in
 * the module set.
 */

import type { Question } from "../state.js";

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

/** SIDECHAT-004 apply routing decision (P1.M1.T6.S2). NAMES the ordinary
 * seam the panel's single routing consumer (P1.M2.T6.S1) drives — this
 * module (and the engine) never call the seams themselves: the engine
 * produces a decision, the panel routes it (panel-view-integration.md
 * §Open/replace/discard: "no new answer path"). "acceptOptionIndex"
 * carries a DISPLAY position (D-R13 recommended-first order — the panel's
 * option-accept seam maps display→option at its single seam), so the index
 * is computed in display order, never `options` state order;
 * "writeIn" carries the parsed text VERBATIM (byte-identical provenance —
 * SIDECHAT-004 owner ruling: no marker, no normalization, anywhere).
 * Consumed by P1.M2.T1.S2 (the confirm row renders off
 * `SidechatRecord.pendingConfirm`) and P1.M2.T6.S1 (routing: enter applies
 * through the named seam; esc declines via `clearPendingConfirm`). */
export type ApplyDecision =
  | { seam: "acceptOptionIndex"; optionIndex: number }
  | { seam: "writeIn"; text: string };

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

/** Why a completed side-chat reply carried no applicable answer block
 * (P1.M1.T6.S1, SIDECHAT-004). Stable string enum: P1.M2.T1.S2 maps each
 * value to its in-view notice text — the enum IS the notice API, so the
 * five values must never be renamed or reordered away.
 *
 * - "no-block": zero valid fenced ```answer blocks anywhere in the reply
 *   (including a wrong info string — `json`, `ANSWER`, `answer json` — or
 *   an UNTERMINATED final block at EOF, which is not a block at all, not
 *   a malformed one).
 * - "malformed-json": the LAST block's body fails strict JSON.parse
 *   (single quotes, trailing commas, prose). NO fallback to an earlier
 *   valid block — the model's LATEST intent governs.
 * - "unknown-shape": the body parses but is not EXACTLY one
 *   {value: string} xor one {text: string} — arrays, null, scalars, both
 *   keys, extra keys, or a non-string value.
 * - "value-mismatch": {value: string} that byte-matches (===) no entry of
 *   `optionValues`. An options-less (text) question passes an empty array,
 *   so ANY value form mismatches it naturally — no question-type param.
 * - "empty-text": {text: string} whose text is empty or whitespace-only. */
export type AnswerBlockRejection =
  | "no-block"
  | "malformed-json"
  | "unknown-shape"
  | "value-mismatch"
  | "empty-text";

/** SIDECHAT-004 parse outcome (ui-spec §Side chat "Answer protocol" +
 * sidechat-contracts.md §SIDECHAT-004). "value" ⇒ apply via the option
 * seam (T6.S2 resolves the display index; M2.T6.S1 applies it);
 * "text" ⇒ apply via the write-in commit seam, the string carried
 * VERBATIM (no trim — apply ships it byte-identically, provenance stays
 * indistinguishable); "none" ⇒ in-view notice, chat stays open.
 * Consumed by P1.M1.T6.S2 (ApplyDecision/pendingConfirm). */
export type ParsedAnswer =
  | { kind: "value"; value: string }
  | { kind: "text"; text: string }
  | { kind: "none"; reason: AnswerBlockRejection };

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
  /** SIDECHAT-004 confirm state (P1.M1.T6.S2): the apply decision from the
   * LAST settled reply, present ONLY under manual mode (a reply produced a
   * decision AND !sideChatAutoApply). Cleared by a superseding reply's settle
   * (any outcome — the latest reply governs), the decline seam
   * (`clearPendingConfirm` — P1.M2.T6.S1's esc), and record replacement
   * (resetChat/discard — it dies with the record). Aborted turns never
   * settle, so an earlier reply's decision survives them ("the turn never
   * happened"). Absent = nothing to confirm. */
  pendingConfirm?: ApplyDecision;
  /** P1.M2.T1.S2 render input: why the LAST settled reply's answer block was
   * inapplicable ({@link AnswerBlockRejection}), or undefined when the last
   * settle produced a decision (or no block path at all). Supersede semantics
   * mirror pendingConfirm exactly — the model's LATEST reply governs; set by
   * a none-settle (even under the autoApply bypass — nothing was applied, so
   * the user needs the why), cleared by a decision-bearing settle, by
   * {@link clearPendingConfirm} (a decline/exit retires the confirm and
   * rejection rows together), and by record replacement
   * (resetChat/discard — it dies with the record). Aborted turns never
   * settle, so it survives them. Mutually exclusive with pendingConfirm by
   * construction (one-write settle). */
  lastRejection?: AnswerBlockRejection;
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

// Fence grammar for the answer protocol (P1.M1.T6.S1, SIDECHAT-004) —
// backticks ONLY, ≥3; the info string is EXACTLY `answer`, case-sensitive
// with trailing spaces/tabs tolerated (`answer json`, `ANSWER`, `answers`
// are NOT blocks — the mirror prompt, panel/sidechat-prompt.ts §"## Answer
// protocol", teaches the model one canonical form, and this parser is its
// strict inverse). A close fence is ≥3 backticks alone.
const ANSWER_OPEN_FENCE = /^(`{3,})answer[ \t]*$/;
const ANSWER_CLOSE_FENCE = /^`{3,}[ \t]*$/;

/**
 * Parse a COMPLETED side-chat reply for its answer block (SIDECHAT-004,
 * sidechat-contracts.md §SIDECHAT-004; ui-spec §Side chat "Answer
 * protocol"): scan the reply's lines top-to-bottom for fenced ```answer
 * blocks (opening fence = ≥3 backticks + info string EXACTLY `answer`,
 * case-sensitive, trailing spaces OK; body; closing fence ≥3 backticks),
 * take the LAST valid block — position-agnostic, trailing prose after it
 * is fine, and last-block-wins is ABSOLUTE: a malformed last block yields
 * "malformed-json" even when an earlier one was valid, NO fallback (the
 * model's LATEST intent governs; silently applying a superseded earlier
 * answer is the worst failure mode this parser exists to prevent) — then
 * strict-JSON-parse its body and gate the shape.
 *
 * Shape gate (exact-key-set, never lenient): the parsed body must be a
 * non-null non-array plain object with EXACTLY one own key — {value:
 * string} or {text: string}. Arrays, null, scalars, both keys, extra keys
 * ({"value":"x","why":"z"}) and non-string values ({"value":42}) are all
 * "unknown-shape". JSON.parse is already strict (comments, trailing
 * commas, single quotes all throw) — there is NO hand-rolled JSON
 * sniffing; pretty-printed multi-line JSON parses fine.
 *
 * Matching: {value} must BYTE-MATCH (=== via Array.includes — no
 * case-folding, no trimming, no normalization of any kind) an entry of
 * `optionValues` (callers pass question.options.map(o => o.value)); an
 * options-less (text) question passes [], so any value form mismatches —
 * the empty array encodes the question type, and no question-type
 * parameter exists by design. {text} is valid when trim() !== "" but is
 * returned VERBATIM (" padded " stays " padded ") — the apply side
 * (P1.M2.T6.S1) ships it byte-identically through the write-in seam;
 * trimming here would corrupt provenance indistinguishability.
 *
 * Purity contract: arguments in → union out. No engine state, no record
 * reads, no singleton, no time, no randomness — identical inputs give
 * deep-identical outputs, and the module's ZERO-pi-imports rule
 * (M3.T1 cache-isolation guard) holds by construction. The input is
 * FROZEN text only (the engine's settle path — P1.M1.T5.S2 — freezes
 * just completed replies into `record.messages`), so a partial stream
 * structurally never reaches this parser; no completeness check exists
 * or belongs here. Unterminated final block at EOF (a reply cut by
 * stop=length mid-fence) is NOT "malformed-json" — it is not a block at
 * all ⇒ "no-block"; the notice path handles it.
 *
 * Consumers: P1.M1.T6.S2 (ApplyDecision/pendingConfirm, invoked at the
 * settle seam), P1.M2.T1.S2 (per-`AnswerBlockRejection` in-view notice),
 * P1.M2.T6.S1 (confirm-row apply through the ordinary accept seams).
 * Definition-only in the module set until T6.S2 lands.
 *
 * @param replyText the frozen text of ONE completed assistant reply.
 * @param optionValues the target question's option values (byte-match
 *   universe; [] = text question).
 */
export function parseAnswerBlock(
  replyText: string,
  optionValues: readonly string[],
): ParsedAnswer {
  // 1) Collect every valid block's body: open fence → body lines → close
  //    fence. An unterminated block (EOF before a closing fence) is
  //    discarded entirely — not a block, not malformed.
  const lines = replyText.split("\n");
  const bodies: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (ANSWER_OPEN_FENCE.test(lines[i])) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !ANSWER_CLOSE_FENCE.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) bodies.push(body.join("\n")); // closed → valid; EOF → discarded
    }
    i++;
  }

  // 2) Zero valid blocks anywhere → no-block.
  if (bodies.length === 0) return { kind: "none", reason: "no-block" };

  // 3) The LAST block governs — absolute, no fallback to earlier blocks.
  const last = bodies[bodies.length - 1];

  // 4) Strict JSON — JSON.parse IS the validation layer; any throw is
  //    malformed-json. (Single quotes, trailing commas, comments throw.)
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return { kind: "none", reason: "malformed-json" };
  }

  // 5) Exact-key-set shape gate: non-null, non-array plain object whose
  //    own keys are EXACTLY {value} or EXACTLY {text}, string-valued.
  const isObj = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  const keys = isObj ? Object.keys(parsed as Record<string, unknown>) : [];
  const value = isObj ? (parsed as Record<string, unknown>)["value"] : undefined;
  const text = isObj ? (parsed as Record<string, unknown>)["text"] : undefined;

  // 6) {value: v} — byte-match against optionValues; === strictness IS the
  //    feature ("Sqlite" ≠ "sqlite"; " sqlite" ≠ "sqlite").
  if (keys.length === 1 && keys[0] === "value" && typeof value === "string") {
    return optionValues.includes(value)
      ? { kind: "value", value }
      : { kind: "none", reason: "value-mismatch" };
  }

  // 7) {text: t} — validity checks trim(), the payload stays VERBATIM.
  if (keys.length === 1 && keys[0] === "text" && typeof text === "string") {
    return text.trim() !== "" ? { kind: "text", text } : { kind: "none", reason: "empty-text" };
  }

  // Everything else — arrays, scalars, null, empty object, both keys,
  // extra keys, non-string values — is unknown-shape, never a lenient parse.
  return { kind: "none", reason: "unknown-shape" };
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

// Module-local D-R13 mirror (P1.M1.T6.S2, SIDECHAT-004): a question's
// option values in DISPLAY order — recommended option FIRST (only when
// `recommendation` byte-matches an option value; a dangling recommendation
// reorders NOTHING), the rest in state order. A verbatim sibling of
// short-view.ts's displayOptions, which this module cannot import (short-view
// pulls pi-tui, breaching the zero-pi wall — M3.T1 guard). displayOptions is
// the single authority: if D-R13 ordering ever changes, BOTH change — the
// reorder test vectors in sidechat.test.ts pin the agreement.
function displayOptionValues(question: Question): readonly string[] {
  const options = question.options ?? []; // options is OPTIONAL — never bare .map
  if (question.recommendation === undefined) return options.map((o) => o.value);
  const rec = options.find((o) => o.value === question.recommendation);
  if (rec === undefined) return options.map((o) => o.value); // dangling rec → NO reorder (mirror)
  return [rec, ...options.filter((o) => o !== rec)].map((o) => o.value);
}

/**
 * Map a parsed answer (P1.M1.T6.S1's {@link ParsedAnswer}) to the
 * routing-ready apply decision for `question` (SIDECHAT-004, P1.M1.T6.S2).
 * Pure: arguments in → union out; no record reads, no singleton, no time,
 * no randomness.
 *
 * - kind "value" → the DISPLAY position (D-R13 recommended-first order —
 *   see {@link displayOptionValues}) of the byte-matched option, as
 *   {seam:"acceptOptionIndex", optionIndex}. The display domain is
 *   load-bearing: the panel's ordinary option-accept seam maps
 *   display→option, so a state-order index would apply the WRONG ROW
 *   whenever a recommendation exists.
 * - kind "text"  → {seam:"writeIn", text} with the parsed text carried
 *   VERBATIM — no trim, no normalization anywhere (byte-identical
 *   provenance, SIDECHAT-004 owner ruling).
 * - kind "none"  → undefined (the in-view notice path owns it — P1.M2.T1.S2).
 * - kind "value" matching no option → undefined (defensive: unreachable via
 *   {@link settleApplyDecision}, which pre-matched the value against the
 *   declared order; a direct caller with mismatched inputs gets undefined
 *   instead of a wrong-row decision).
 *
 * The decision NAMES an ordinary apply seam; this module never calls the
 * seams — the panel routes it (P1.M2.T6.S1). Consumers: P1.M2.T1.S2 renders
 * the confirm row off `SidechatRecord.pendingConfirm`; P1.M2.T6.S1 routes
 * the decision.
 */
export function toApplyDecision(
  parsed: ParsedAnswer,
  question: Question,
): ApplyDecision | undefined {
  if (parsed.kind === "value") {
    const optionIndex = displayOptionValues(question).indexOf(parsed.value);
    return optionIndex === -1 ? undefined : { seam: "acceptOptionIndex", optionIndex };
  }
  if (parsed.kind === "text") return { seam: "writeIn", text: parsed.text }; // VERBATIM — no trim
  return undefined; // kind "none"
}

/**
 * The settle seam for a COMPLETED side-chat reply (SIDECHAT-004,
 * P1.M1.T6.S2): parse `replyText`'s answer block against `question`'s
 * option values, map it to an {@link ApplyDecision}, and maintain
 * `record.pendingConfirm` — the confirm-state bookkeeping.
 *
 * `replyText` must be the just-frozen text of the ONE completed reply being
 * settled (the engine's freeze site passes the exact string it pushed into
 * `record.messages`) — never the whole transcript and never
 * `streamingText` (cleared by settle time anyway): the parser's
 * last-block-wins scan is per-reply, and feeding it more would resurrect
 * answers from earlier turns.
 *
 * State transitions (pinned — the model's LATEST reply governs):
 * - decision && !autoApply (manual, the default) → `record.pendingConfirm`
 *   is SET to the decision (replacing any earlier one); returns the decision.
 * - decision && autoApply (the opt-in bypass) → `record.pendingConfirm` is
 *   CLEARED (no confirm state ever exists); returns the decision — the
 *   caller's "immediately-applyable" exposure (the engine hands it to its
 *   onAutoApply seam).
 * - no decision → `record.pendingConfirm` is CLEARED (supersede: a reply
 *   without an applicable block RETRACTS an earlier reply's offer);
 *   returns undefined.
 *
 * The same one-write tail maintains `record.lastRejection` (P1.M2.T1.S2
 * render input) with mirrored supersede semantics: a "none" parse records
 * its {@link AnswerBlockRejection} reason (under BOTH autoApply modes —
 * nothing was applied either way), any decision-bearing settle clears it,
 * and the two fields are mutually exclusive by construction. Aborted turns
 * never settle, so the last settled outcome persists across them.
 *
 * Record-param style (the module's mutator convention): the caller passes
 * the live record — the engine passes the singleton after its liveness
 * guard — this function never touches module state itself. `autoApply`
 * arrives INJECTED (never read from config here: config.ts imports pi and
 * this module's zero-pi wall is load-bearing; the injected-port
 * testability rule). Idempotent per state: identical inputs re-derive and
 * re-assign the same decision (no date, no randomness).
 */
export function settleApplyDecision(
  record: SidechatRecord,
  replyText: string,
  question: Question,
  autoApply: boolean,
): ApplyDecision | undefined {
  const optionValues = (question.options ?? []).map((o) => o.value); // declared order — match domain
  const parsed = parseAnswerBlock(replyText, optionValues);
  const decision = toApplyDecision(parsed, question);
  // One write, both branches: set (manual, decision exists) or clear
  // (autoApply bypass / no decision / supersede — EVERY settle overwrites
  // whatever an earlier reply left behind).
  record.pendingConfirm = decision !== undefined && !autoApply ? decision : undefined;
  // Paired write (P1.M2.T1.S2): the view's rejection row reads this instead
  // of re-parsing the reply. Mirrors pendingConfirm's supersede rule.
  record.lastRejection = decision === undefined && parsed.kind === "none" ? parsed.reason : undefined;
  return decision; // autoApply's immediately-applyable exposure — the engine hands it to onAutoApply
}

/**
 * The decline seam (SIDECHAT-004, P1.M1.T6.S2): clear the confirm-state
 * pair — `record.pendingConfirm` AND `record.lastRejection` (P1.M2.T1.S2:
 * the confirm row and the rejection notice are alternative renderings of
 * the same last-settle outcome; once the user declines/exits either, neither
 * shows) — touching nothing else. The chat stays open and the settled
 * replies stay in `record.messages`. P1.M2.T6.S1's esc key calls this;
 * P1.M2.T1.S2's rows disappear with the fields. Record-param style (see
 * {@link settleApplyDecision}).
 */
export function clearPendingConfirm(record: SidechatRecord): void {
  record.pendingConfirm = undefined;
  record.lastRejection = undefined;
}

/** Test-only seam: module-scope reset for vitest beforeEach (state.ts `resetState` precedent). */
export function resetSidechatForTests(): void {
  current = undefined;
}

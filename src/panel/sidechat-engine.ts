/**
 * src/panel/sidechat-engine.ts — the SIDECHAT-003/005 engine halves
 * (P1.M1.T5.S1): WHICH model a side chat runs on (resolveSideChatModel +
 * modelSnapshotFromModel) and HOW a turn is dispatched (createSidechatEngine's
 * sendTurn/abort state machine over an INJECTED nested-call port).
 *
 * Design invariants (nested-llm-and-snapshot-seams.md + T5.S1 PRP):
 * - NO ctx anywhere: the model-call port, the registry (narrowed to
 *   {find, getAvailable}), and notify are INJECTION arguments. Unit tests
 *   pass fakes; the M3.T1 cache-isolation guard's five banned main-session
 *   mutation APIs (message-send / user-message-send / active-tools /
 *   tool-registration / model-switch) appear NOWHERE here — not even in
 *   comments — so the grep wall stays clean by construction.
 * - The chat is MULTI-TURN (SIDECHAT-003): ONE stable sessionId per record
 *   identity (own replayed-prefix cache across turns, provider-default cache
 *   retention). Compaction's one-shot no-cache option + fresh-id-per-call
 *   pattern is the explicit ANTI-pattern here — never copy it into this
 *   module (the Level-4 grep wall checks for that token too).
 * - The port is streamSimple-shaped:
 *   (model, context, {signal, sessionId}) => AssistantMessageEventStream |
 *   Promise<AssistantMessage>. pi-ai throws SYNCHRONOUSLY on missing auth —
 *   the invocation is wrapped; EVERY failure path appends a SidechatNotice
 *   and settles the record back to "idle" (the panel never blocks).
 * - STREAM CONSUMPTION (P1.M1.T5.S2): every event's cumulative `partial`
 *   refreshes record.streamingText — the VIEW's polling buffer (P1.M2.T1.S1
 *   renders the cursor; the engine renders nothing). Terminal routing
 *   (SIDECHAT-002/003): `done` freezes the assistant ChatMessage from
 *   done.message's canonical content with its stop reason; aborted — an
 *   error{reason:"aborted"} event OR a terminal "aborted" stop reason —
 *   rolls the turn back FULLY (pop the user entry, no assistant record, no
 *   notice, zero usage residue: "the turn never happened"); every other
 *   failure appends a notice and KEEPS the user turn (the chat stays
 *   usable). Only completed replies ever enter record.messages, so the
 *   T6.S1 parser structurally never sees partial text.
 * - Frozen context (SIDECHAT-003): the branch snapshot is cast through
 *   branch-snapshot.ts's BranchSnapshotMessages type and NEVER re-read
 *   mid-chat — this module has no session knowledge at all.
 *
 * Wiring boundaries: the production port binding (streamSimplePort) is
 * exported but UNWIRED — the open path is P1.M2.T4.S1, sendTurn/abort key
 * routing is P1.M2.T3.S1. Usage tallying is T5.S3; answer-block parsing is
 * T6.S1; mid-stream close hooks call abort() through this exact seam
 * (P1.M2.T5.S1).
 */
import { randomUUID } from "node:crypto";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  StopReason,
} from "@earendil-works/pi-ai";
// streamSimple is a STANDALONE provider-neutral pi-ai export (the compat
// subpath), NOT a ModelRegistry method — this module is the only side-chat
// file allowed to hold a pi VALUE import (sidechat.ts stays pi-import-free;
// M3.T1 guard).
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { InterrogatorConfig } from "../config.js";
import type { BranchSnapshotMessages } from "./branch-snapshot.js";
import {
  get as getRecord,
  type ChatMessage,
  type ChatStopReason,
  type ModelSnapshot,
  type SidechatRecord,
} from "./sidechat.js";

/** The nested model-call port: streamSimple-shaped. A fake-able seam —
 * production binds {@link streamSimplePort}; tests script streams/promises/
 * throws. Never the ctx registry, never the session conversation surface. */
export type SidechatModelPort = (
  model: Model<Api>,
  context: Context,
  options: { signal: AbortSignal; sessionId: string },
) => AssistantMessageEventStream | Promise<AssistantMessage>;

/** The narrow registry surface the engine needs — structurally satisfiable
 * by the live ctx.modelRegistry at the M2.T4.S1 wiring point, but held as
 * an injection argument so the engine never imports ctx. */
export interface SidechatRegistryPort {
  find(provider: string, modelId: string): Model<Api> | undefined;
  getAvailable(): Model<Api>[];
}

/** Injection bag for {@link createSidechatEngine} — everything ctx-flavored
 * arrives here, keeping the engine unit-testable and M3.T1-guard-clean. */
export interface SidechatEngineDeps {
  port: SidechatModelPort;
  registry: SidechatRegistryPort;
  notify: (message: string) => void;
}

/**
 * Resolve WHICH model the side chat runs on (SIDECHAT-003, h2.80):
 *
 * 1. `config.sideChatModel` set + parseable ("provider/model-id", split on
 *    the FIRST "/") + a registry find hit → that Model<Api>, notify untouched.
 * 2. Set but malformed (no slash / empty halves) or unknown id → notify ONCE
 *    and fall back to the session model, else the first available registry
 *    model (compaction.ts:121-126 fallback order).
 * 3. Unset/blank → the session model directly (NO notify — absent-vs-set
 *    detection matters; config.ts:95 is deliberately not in DEFAULT_CONFIG).
 * 4. Nothing resolvable at all → `undefined`: the caller maps it through
 *    {@link modelSnapshotFromModel} to the empty inert marker and the chat
 *    opens inert (P1.M2.T1.S2) instead of crashing or blocking.
 */
export function resolveSideChatModel(
  config: Pick<InterrogatorConfig, "sideChatModel">,
  registry: SidechatRegistryPort,
  sessionModel: Model<Api> | undefined,
  notify: (message: string) => void,
): Model<Api> | undefined {
  const raw = config.sideChatModel;
  if (raw !== undefined && raw.trim() !== "") {
    // FIRST "/" only: provider ids never contain one; anything after is the id.
    const slash = raw.indexOf("/");
    const provider = slash > 0 ? raw.slice(0, slash) : "";
    const modelId = slash > 0 && slash < raw.length - 1 ? raw.slice(slash + 1) : "";
    const found = provider !== "" && modelId !== "" ? registry.find(provider, modelId) : undefined;
    if (found !== undefined) return found;
    // Silent typos are the failure mode this notify exists for — exactly once.
    notify(
      `side chat model '${raw}' not found — using ${
        sessionModel !== undefined ? "the session model" : "the first available model"
      }`,
    );
  }
  // Unset/blank OR override missed: session model, else first available.
  return sessionModel ?? registry.getAvailable()[0];
}

/**
 * Freeze a resolved Model<Api> into the record's opaque snapshot — and map
 * "nothing resolvable" to the EMPTY marker `{provider:"", modelId:""}`:
 * the P1.M2.T1.S2 inert signal the view reads and {@link createSidechatEngine}
 * refuses to dispatch on.
 */
export function modelSnapshotFromModel(model: Model<Api> | undefined): ModelSnapshot {
  return model !== undefined
    ? { provider: model.provider, modelId: model.id }
    : { provider: "", modelId: "" };
}

/**
 * Production port binding: the provider-neutral streamSimple pi-ai export.
 * Exported but UNWIRED — P1.M2.T4.S1 owns the call site. Deliberately does
 * NOT pass any one-shot cache option: default retention + the engine's
 * stable per-record sessionId (see module header).
 */
export const streamSimplePort: SidechatModelPort = (model, context, options) =>
  streamSimple(model, context, options);

const INERT_NOTICE =
  "no side chat model available — check sideChatModel in your config and provider auth";

/** Materialize a ChatMessage as a pi-ai Message for context assembly. */
function toPiMessage(m: ChatMessage): Message {
  if (m.role === "user") {
    return { role: "user", content: [{ type: "text", text: m.text }], timestamp: Date.parse(m.at) };
  }
  // Assistant turns are re-materialized as text-only Messages (metadata is
  // not round-tripped through ChatMessage — stopReason/usage stay frozen on
  // the record side); the T6.S1 parser reads the frozen rows, not these.
  return {
    role: "assistant",
    content: [{ type: "text", text: m.text }],
    timestamp: Date.parse(m.at),
  } as unknown as AssistantMessage;
}

/** Join a message content's text parts — the ONLY text extractor in this
 * module: the streaming buffer reads event.partial.content through it,
 * freeze reads done.message.content through it (P1.M1.T5.S2). */
function joinTextParts(content: AssistantMessage["content"]): string {
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * The side-chat turn engine (SIDECHAT-003/005): drives the singleton
 * record's `streamState` idle→streaming→idle over the injected port.
 *
 * - `sendTurn(text)`: false on no live record or already-streaming (no
 *   queueing, no double-controller — the esc rung aborts instead,
 *   P1.M2.T3.S1). Otherwise: append the user turn, store a FRESH
 *   AbortController on the record (replaced EVERY turn; P1.M2.T5.S1 owns
 *   mid-stream hooks), mark streaming, re-derive the Model<Api> from the frozen
 *   snapshot via the injected registry (empty snapshot → inert refusal:
 *   turn recorded, error notice, idle, no dispatch), assemble the frozen
 *   Context (SIDECHAT-003 snapshot FIRST, then turns; never tools), invoke
 *   the port, and hand the result to the async settle consumer
 *   (P1.M1.T5.S2's full stream consumption).
 * - `abort()`: signals the record's LIVE controller (no-op without a
 *   record; replacement/discard deliberately never abort — SIDECHAT-002).
 *
 * Terminal routing (P1.M1.T5.S2 — {@link route}; every terminal lands
 * "idle" with `streamingText` cleared, so no path strands "streaming"):
 * - done with stop|length|toolUse|deferred → FREEZE the assistant row from
 *   done.message's canonical content + its stop reason; buffer cleared.
 * - aborted (error{reason:"aborted"} event, a terminal "aborted" stop
 *   reason on the done message, or the promise branch) → FULL ROLLBACK:
 *   pop THIS turn's user entry (reference-checked), no assistant row, NO
 *   notice (esc is deliberate), zero usage residue for T5.S3.
 * - any other error (error event with a non-aborted reason, done with
 *   stopReason "error", stream closed early, unexpected throw) → error
 *   notice, user turn KEPT — the chat stays usable.
 * - a synchronous port throw (pi-ai's missing-auth behavior) → auth
 *   notice + idle (unchanged from S1).
 * A reply landing after the record was replaced/discarded touches nothing
 * (SIDECHAT-002).
 */
export function createSidechatEngine(deps: SidechatEngineDeps): {
  sendTurn(text: string): boolean;
  abort(): void;
} {
  // Stable-per-record sessionId state (SIDECHAT-003 own prefix cache):
  // regenerated ONLY when the singleton record object changes (open /
  // wholesale replace / reset / discard-then-reopen) — NEVER per turn.
  let lastRecord: SidechatRecord | undefined;
  let sessionId = randomUUID();
  const sessionIdFor = (record: SidechatRecord): string => {
    if (lastRecord !== record) {
      lastRecord = record;
      sessionId = randomUUID();
    }
    return sessionId;
  };

  /** Terminal router (P1.M1.T5.S2; the whole task in one function — see the
   * createSidechatEngine docblock's routing table). Settles FIRST (idle +
   * cleared buffer) so no path can strand "streaming", then routes by stop
   * reason. */
  function route(
    record: SidechatRecord,
    turnUser: ChatMessage,
    stopReason: StopReason | undefined,
    message: AssistantMessage | undefined,
    rawReason?: unknown,
  ): void {
    record.streamingText = ""; // the display buffer NEVER survives a settle
    record.streamState = "idle";
    // SIDECHAT-002/003 (P1.M1.T5.S2): aborted = "the turn never happened".
    // Pop THIS turn's user entry (reference-checked: only the tail we
    // appended at dispatch) so the next Context rebuild carries no dangling
    // unanswered user turn past the snapshot; leave no assistant record, no
    // notice (esc is deliberate silence), nothing for T5.S3 to tally. This
    // asymmetry with the error paths (they KEEP the user turn so the
    // failure stays visible and the chat stays usable) is the contract.
    if (stopReason === "aborted" || rawReason === "aborted") {
      if (record.messages[record.messages.length - 1] === turnUser) record.messages.pop();
      return;
    }
    if (stopReason === "error") {
      // Failed replies NEVER freeze: notice only, user turn kept.
      record.notices.push({
        kind: "error",
        text: message?.errorMessage ?? String(rawReason ?? "stream error"),
        at: new Date().toISOString(),
      });
      return;
    }
    if (message !== undefined) {
      // stop|length|toolUse|deferred → FREEZE from done.message content
      // (canonical), never from the display buffer. Usage untouched here —
      // T5.S3 tallies it, fed by what this freeze records.
      record.messages.push({
        role: "assistant",
        text: joinTextParts(message.content),
        at: new Date().toISOString(),
        stopReason: stopReason as ChatStopReason,
      });
    }
  }

  /** Consume the port result to its terminal (P1.M1.T5.S2). The stream is
   * an AsyncIterable: a terminal event ENDS iteration; `result()` is the
   * promise-fallback for callers without iteration and is never called on
   * the event path. The whole consumption is wrapped so an unexpected
   * throw cannot strand "streaming". */
  async function settle(
    record: SidechatRecord,
    result: ReturnType<SidechatModelPort>,
    turnUser: ChatMessage,
  ): Promise<void> {
    try {
      if (result instanceof Promise) {
        // Promise-port branch: no events → the buffer stays ""; route the
        // resolved AssistantMessage by its stop reason through the same table.
        const message = await result;
        if (getRecord() !== record) return; // replaced/discarded mid-flight
        route(record, turnUser, message.stopReason, message, message.stopReason);
        return;
      }
      for await (const event of result) {
        if (getRecord() !== record) return; // dead record is never touched (SIDECHAT-002)
        // Every non-terminal event carries the cumulative response-so-far
        // `partial` — refresh the view's polling buffer from it, NEVER from
        // the delta payload field (version-proof against delta naming).
        if ("partial" in event) record.streamingText = joinTextParts(event.partial.content);
        if (event.type === "done") {
          route(record, turnUser, event.message.stopReason, event.message, event.reason);
          return;
        }
        if (event.type === "error") {
          // The event's `reason` is authoritative for error events
          // ("aborted" | "error"); the error AssistantMessage only supplies
          // the notice text (its errorMessage) — never its stop reason.
          route(
            record,
            turnUser,
            event.reason === "aborted" ? "aborted" : "error",
            event.error,
            event.reason,
          );
          return;
        }
      }
      // Stream closed without a terminal → same contract as any other error.
      if (getRecord() !== record) return;
      route(record, turnUser, "error", undefined, "stream ended before a reply");
    } catch (err) {
      // Unexpected throw mid-iteration → settle, never strand "streaming".
      if (getRecord() !== record) return;
      route(record, turnUser, "error", undefined, err);
    }
  }

  function sendTurn(text: string): boolean {
    const record = getRecord();
    if (record === undefined) return false; // SIDECHAT-002: no chat → nothing to send
    if (record.streamState !== "idle") return false; // no queueing, no double-controller
    // Capture THIS turn's user entry by reference — the abort rollback pops
    // exactly this object, and only if it is still the tail (P1.M1.T5.S2).
    const turnUser: ChatMessage = { role: "user", text, at: new Date().toISOString() };
    record.messages.push(turnUser);
    record.abortController = new AbortController(); // fresh EVERY turn
    record.streamingText = ""; // the view's polling buffer restarts every turn
    record.streamState = "streaming";
    // Re-derive the Model<Api> from the FROZEN snapshot via the injected registry —
    // never ctx, never a mid-chat re-resolution (SIDECHAT-003 freeze).
    const model = deps.registry.find(record.modelSnapshot.provider, record.modelSnapshot.modelId);
    if (model === undefined) {
      // Inert record (empty snapshot marker): turn recorded, no dispatch,
      // error notice + idle — the panel never blocks (P1.M2.T1.S2).
      record.notices.push({ kind: "error", text: INERT_NOTICE, at: new Date().toISOString() });
      record.streamState = "idle";
      return true;
    }
    // Frozen context (SIDECHAT-003): snapshot FIRST, then the live turns.
    // NEVER tools (SIDECHAT-005: nested chat carries no tool surface).
    const context: Context = {
      systemPrompt: record.systemPrompt,
      messages: [
        ...(record.branchSnapshot as BranchSnapshotMessages),
        ...record.messages.map(toPiMessage),
      ],
    };
    let result: ReturnType<SidechatModelPort>;
    try {
      result = deps.port(model, context, {
        signal: record.abortController.signal,
        sessionId: sessionIdFor(record),
      });
    } catch (err) {
      // pi-ai throws SYNCHRONOUSLY on missing auth: notice + idle, never a block.
      record.notices.push({ kind: "auth", text: String(err), at: new Date().toISOString() });
      record.streamState = "idle";
      return true;
    }
    void settle(record, result, turnUser); // full stream consumption (P1.M1.T5.S2)
    return true;
  }

  function abort(): void {
    // Signal the LIVE controller only. Replacement/discard never abort here
    // (SIDECHAT-002); mid-stream ordering hooks are P1.M2.T5.S1.
    const record = getRecord();
    if (record !== undefined) record.abortController.abort();
  }

  return { sendTurn, abort };
}

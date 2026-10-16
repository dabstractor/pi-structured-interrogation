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
 * - Frozen context (SIDECHAT-003): the branch snapshot is cast through
 *   branch-snapshot.ts's BranchSnapshotMessages type and NEVER re-read
 *   mid-chat — this module has no session knowledge at all.
 *
 * Wiring boundaries: the production port binding (streamSimplePort) is
 * exported but UNWIRED — the open path is P1.M2.T4.S1, sendTurn/abort key
 * routing is P1.M2.T3.S1. Streaming-delta/stop-reason consumption is
 * refined by T5.S2 (this task owns the settle LIFECYCLE only); usage
 * tallying is T5.S3; answer-block parsing is T6.S1.
 */
import { randomUUID } from "node:crypto";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
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
  type ModelSnapshot,
  type SidechatNotice,
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
  // S1 skeleton: assistant turns are re-materialized as text-only Messages
  // (metadata is not round-tripped through ChatMessage); T5.S2 freezes full
  // AssistantMessages instead of this approximation.
  return {
    role: "assistant",
    content: [{ type: "text", text: m.text }],
    timestamp: Date.parse(m.at),
  } as unknown as AssistantMessage;
}

/** Join an AssistantMessage's text parts (the S1 reply text). */
function textOf(message: AssistantMessage): string {
  return message.content
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
 *   the port, and hand the result to the async settle skeleton.
 * - `abort()`: signals the record's LIVE controller (no-op without a
 *   record; replacement/discard deliberately never abort — SIDECHAT-002).
 *
 * Settle skeleton (T5.S2 refines; S1 owns lifecycle): stream `done` →
 * freeze the joined assistant reply + idle; stream `error`/async rejection
 * → idle with NO assistant message; a SYNCHRONOUS port throw (pi-ai's
 * missing-auth behavior) → auth notice + idle. A reply landing after the
 * record was replaced/discarded touches nothing (SIDECHAT-002).
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

  async function settle(
    record: SidechatRecord,
    result: ReturnType<SidechatModelPort>,
  ): Promise<void> {
    let reply: string | undefined;
    try {
      if (result instanceof Promise) {
        reply = textOf(await result);
      } else {
        for await (const event of result) {
          if (event.type === "done") {
            reply = textOf(event.message);
            break;
          }
          if (event.type === "error") break; // aborted|error → idle, NO assistant message
        }
      }
    } catch {
      reply = undefined; // async rejection after dispatch → settle idle (S2 refines notice wiring)
    }
    if (getRecord() !== record) return; // replaced/discarded mid-flight — the dead record is never touched
    record.streamState = "idle";
    if (reply !== undefined) {
      record.messages.push({ role: "assistant", text: reply, at: new Date().toISOString() });
    }
  }

  function sendTurn(text: string): boolean {
    const record = getRecord();
    if (record === undefined) return false; // SIDECHAT-002: no chat → nothing to send
    if (record.streamState !== "idle") return false; // no queueing, no double-controller
    record.messages.push({ role: "user", text, at: new Date().toISOString() });
    record.abortController = new AbortController(); // fresh EVERY turn
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
    void settle(record, result); // lifecycle skeleton; T5.S2 refines consumption
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

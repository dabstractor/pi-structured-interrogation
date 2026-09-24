/**
 * src/remote-bridge.ts — Remote bridge surface: pi-ask bridge contract
 * speaker (FR-31..34; spec/decisions.md §Remote bridge surface, D-R1..D-R7;
 * spec/ui-spec.md §Remote bridge).
 *
 * WHAT THIS BUYS: pi-ask documents a `pi.events` contract for local bridges
 * (docs/remote-events.md in the @eko24ive/pi-ask package: "Use this for
 * local bridges: status cards, desktop helpers, or approval UIs"). By
 * speaking that contract — event names and payload shapes VERBATIM — the
 * interrogator's question set renders on ANY conformant client with zero
 * bespoke integration; remote-pi's app is the concrete one today (its
 * `extension_ui_bridge.ts` subscribes to these channels and translates them
 * into `extension_ui_request` frames its Flutter client renders as a
 * full-screen question form). pi-ask is NOT a dependency of this extension;
 * the channel names below are copied with citation and are stable public
 * contract. Emission is inert when no client listens — the contract has no
 * runtime detection and no acks-of-existence, and we add none (D-R1).
 *
 * CHANNELS (mirrored from remote-events.md; consumed by remote-pi's
 * extension_ui_bridge.ts):
 * - `@eko24ive/pi-ask:started`    {version:1, flowId, source, title?, questions[], createdAt}
 * - `@eko24ive/pi-ask:submit`     {version:1, requestId, flowId, response:
 *                                 {kind:"answer", mode?, answers: Record<qid, {values?, customText?, note?, optionNotes?}>}
 *                                 | {kind:"cancel"}}
 * - `@eko24ive/pi-ask:submit-result` {version:1, requestId, flowId, ok:true | ok:false+error+message}
 * - `@eko24ive/pi-ask:completed`  {version:1, flowId, source, completedAt}
 *
 * FLOW RULES (D-R2/D-R6): flowIds are namespaced `itg:<rand>:<seq>` so
 * stray submits are attributable; every emission completes the previous
 * flow first (a new flow replaces the client surface; in-modal progress is
 * expendable — draft sacredness is a panel commitment, not a bridge one).
 * A submit acks `submit-result` then completes the flow — including
 * internal errors: a throw from the submission pipeline emits an
 * `internal_error` NACK and completes the flow, so a remote client never
 * hangs without an ack (BUG-007; state may stay half-mutated — the next
 * upsert resurface heals the surface, D-R6);
 * `kind:"cancel"` = defer (ack + complete, zero state change, zero model
 * message — recovery is the model's next upsert/reopen, or bridge-side
 * replay on reconnect for unresolved flows). `remote.resurface` (default
 * true) re-emits the remaining questions after a partial submission — the
 * bridge analogue of the panel staying open.
 *
 * CROSS-TALK (D-R2, bounded + accepted): a co-installed pi-ask subscribes
 * to `:submit` unconditionally and NACKs our flowIds with `flow_not_found`
 * (one transient client-side warning; our own `:completed` still resolves
 * the flow). We reciprocate: submits for flowIds we did not mint are
 * IGNORED silently — pi-ask owns nacking its own flows, and a second nack
 * would double-warn.
 *
 * BRIDGE SUBMIT PIPELINE (D-R5): answers ride the SAME submission machinery
 * as a panel `ctrl+s` (remote-submit.ts): apply → baseline diff → BUG-008
 * user-shipped filter → markSubmitted → buildSubmission (takeSnapshot +
 * bumpEpoch exactly once) → deliverSubmission → lifecycle.
 * noteSubmissionDelivered(). Bridge answers are user shipments: they MUST
 * trigger a model reply, never the chat-fallback recordAnswers path.
 *
 * Pure-data discipline (h2.13): this module touches pi ONLY through the
 * narrow `Pick<ExtensionAPI, "events" | "sendMessage">` surface; no UI, no
 * panel imports, no direct state-singleton writes (mutation goes through
 * remote-submit.ts entry points).
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import type { Lifecycle } from "./lifecycle.js";
import { recordRemoteSubmission, type RemoteAnswerInput } from "./remote-submit.js";
import { getState, type InterrogationState, type Question, type SerializedState } from "./state.js";

// ----------------------------------------------------- pi-ask event contract

/** Copied VERBATIM from pi-ask's public contract (docs/remote-events.md; consumed by remote-pi's extension_ui_bridge.ts). */
export const PI_ASK_STARTED = "@eko24ive/pi-ask:started";
/** Copied VERBATIM — bridge client answers arrive on this channel. */
export const PI_ASK_SUBMIT = "@eko24ive/pi-ask:submit";
/** Copied VERBATIM — per-request ack/nack; ok:false surfaces as a client-side warning. */
export const PI_ASK_SUBMIT_RESULT = "@eko24ive/pi-ask:submit-result";
/** Copied VERBATIM — resolves/dismisses the client surface. */
export const PI_ASK_COMPLETED = "@eko24ive/pi-ask:completed";

/** FlowId namespace (D-R2): recognizable prefix so stray submits are attributable and never collide with pi-ask flowIds. */
const FLOW_ID_PREFIX = "itg:";

/** Sources we emit, per pi-ask's RemoteAskSource union. */
export type RemoteFlowSource = "tool" | "ask:replay" | "ask:resume";

// ------------------------------------------------------------ wire shaping

/**
 * One option as a conformant client renders it (pi-ask AskOption subset;
 * D-R3): `label` carries the `" ★"` suffix on the recommended option (no
 * native star in the wire), `description` carries the ramification prose —
 * the exact "what changes, effort, risk" text the deep-view contract demands.
 */
export interface RemoteAskOption {
  value: string;
  label: string;
  /** Option ramification (optional — absent when the model sent none). */
  description?: string;
}

/** One question as a conformant client renders it (pi-ask AskQuestion subset; D-R3). */
export interface RemoteAskQuestion {
  id: string;
  /** `title ?? ""` — ALWAYS an explicit string; an omitted label makes remote-pi's bridge duplicate the whole prompt into it. */
  label: string;
  /** `prompt + "\n\n" + description` when present — the bridge-side reader is exactly the standalone reader the deep-view contract targets; never truncated. */
  prompt: string;
  /** Choice and text questions are both single-select on the wire; text questions carry `options: []` (clients still show their free-text field). */
  type: "single";
  /** Always false — `required` is advisory-only in conformant clients and our gating is display-only anyway. */
  required: boolean;
  options: RemoteAskOption[];
}

/** Title soft cap for the flow (D-R3: `goal || "Interrogation"`, ~80 chars). */
const TITLE_CAP = 80;

/** Statuses included in a flow (D-R3): unanswered only — bridge clients cannot edit past answers in v1 (the panel keeps that role). */
const LIVE_STATUSES: ReadonlySet<Question["status"]> = new Set(["open", "reasked"]);

/**
 * Live (askable) questions of a state, in display order — status
 * open/reasked. Exported: index.ts's reconstruction hook (FR-34) and tests
 * share the exact predicate with {@link toAskQuestions}.
 */
export function liveQuestions(state: SerializedState): Question[] {
  const out: Question[] = [];
  for (const id of state.order) {
    const q = state.questions[id];
    if (q !== undefined && LIVE_STATUSES.has(q.status)) out.push(q);
  }
  return out;
}

/**
 * Map a state's live questions onto the pi-ask wire shape (D-R3, pure):
 * - prompt → `prompt + "\n\n" + description` (never truncated);
 * - title → `label` (`""` when absent — never omitted);
 * - type → `"single"` for both choice and text (text = `options: []`);
 * - option label gets `" ★"` when `value === question.recommendation`;
 * - option ramification → `description`.
 * Defensive drops (schema-violating residue): options with empty value or
 * label, and questions with an empty prompt or no renderable options.
 */
export function toAskQuestions(state: SerializedState): RemoteAskQuestion[] {
  const out: RemoteAskQuestion[] = [];
  for (const q of liveQuestions(state)) {
    if (q.prompt.trim() === "") continue;
    const options: RemoteAskOption[] = [];
    for (const opt of q.options ?? []) {
      if (opt.value === "" || opt.label === "") continue;
      const option: RemoteAskOption = { value: opt.value, label: opt.label };
      // ★ suffix marks the recommendation — the wire has no native star.
      if (opt.value === q.recommendation) option.label = `${opt.label} ★`;
      if (opt.ramification !== undefined) option.description = opt.ramification;
      options.push(option);
    }
    if (q.type === "choice" && options.length === 0) continue; // unrenderable choice
    out.push({
      id: q.id,
      label: q.title ?? "",
      prompt: q.description !== undefined ? `${q.prompt}\n\n${q.description}` : q.prompt,
      type: "single",
      required: false,
      options,
    });
  }
  return out;
}

// ------------------------------------------------------------ submit parsing

/** One bridge answer as parsed from the wire (pi-ask RemoteAskAnswer subset; D-R4). */
interface WireAnswer {
  values?: string[];
  customText?: string;
}

/** Narrow `unknown` → WireAnswer (note/optionNotes accepted and dropped). */
function parseWireAnswer(v: unknown): WireAnswer | null {
  if (typeof v !== "object" || v === null) return null;
  const w = v as { values?: unknown; customText?: unknown };
  const values = Array.isArray(w.values) ? w.values.filter((s): s is string => typeof s === "string") : undefined;
  const customText = typeof w.customText === "string" ? w.customText : undefined;
  if (values === undefined && customText === undefined) return null;
  return { values, customText };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ------------------------------------------------------------ the bridge

/** Narrow pi surface this module touches (delivery.ts discipline). */
type BridgePi = Pick<ExtensionAPI, "events" | "sendMessage">;

/** Minimal events-bus view (ExtensionAPI["events"] is structurally this). */
interface EventBus {
  on(event: string, handler: (data: unknown) => void): () => void;
  emit(event: string, data: unknown): void;
}

/** Options for {@link createRemoteBridge}. */
export interface RemoteBridgeOptions {
  config: InterrogatorConfig;
  /** Lifecycle for the h2.44 caller contract (noteSubmissionDelivered after delivery). */
  lifecycle?: Pick<Lifecycle, "noteSubmissionDelivered">;
  /** AUTOSUBMIT-001 bridge tail (P2.M1.T3.S1, h2.33): the shared hook, run by
   * recordRemoteSubmission at BOTH exit tails (always after the lifecycle
   * call). Injected from index.ts (panel singletons live there); absent →
   * no-op. */
  maybeAutoSubmit?: () => void;
  /** State source; defaults to the state.ts singleton (injectable for tests). */
  getState?: () => InterrogationState | undefined;
}

/** One registered flow. */
interface ActiveFlow {
  source: RemoteFlowSource;
  createdAt: number;
}

/** The bridge handle {@link emitFlow} returns: null when nothing was emitted. */
export interface RemoteBridge {
  /** Emit a started flow for the state's live questions (completing any previous flow). Returns the flowId or null. */
  emitFlow(state: InterrogationState, source: RemoteFlowSource): string | null;
  /** Complete every outstanding flow (completion hook / teardown). */
  completeAll(): void;
  /** Unsubscribe + complete all outstanding flows (session_shutdown). */
  dispose(): void;
}

/**
 * Create the remote bridge-surface speaker (index.ts wiring; FR-31..34).
 *
 * Emission guards (D-R7): `config.remote.enabled` off → emitFlow returns
 * null and submits are ignored; no live questions → nothing emitted; a
 * pi without a usable events bus → inert (defensive — remote-pi requires
 * one, and pi always provides it).
 *
 * Submit handling order (every branch defensive, never throws into the
 * emitter — a listener error would poison the shared bus):
 * malformed → silent; foreign flowId → silent (pi-ask's business);
 * `itg:`-prefixed unknown/completed flow → `flow_not_found` NACK;
 * cancel → ACK + completed, zero state mutation, zero model messages
 * (D-R6 defer semantics); answer → D-R4 mapping against CURRENT state →
 * remote-submit.ts pipeline → ACK + completed (+ resurface when configured
 * and live questions remain) — an internal throw from that pipeline emits
 * an `internal_error` NACK + completed instead (BUG-007: the client never
 * hangs without an ack; no rollback, no resurface — the next upsert
 * re-emits). Zero recordable answers → `invalid_answer`
 * NACK; when the question set changed underneath, a fresh flow re-renders
 * the client with current options.
 */
export function createRemoteBridge(pi: BridgePi, opts: RemoteBridgeOptions): RemoteBridge {
  const eventsRaw = (pi as { events?: EventBus }).events;
  // Assign to a freshly-typed const so the narrowed type survives closures.
  const events: EventBus | undefined =
    eventsRaw !== undefined && typeof eventsRaw.on === "function" && typeof eventsRaw.emit === "function"
      ? eventsRaw
      : undefined;

  const flows = new Map<string, ActiveFlow>();
  let seq = 0;
  let unsubSubmit: (() => void) | undefined;

  if (events !== undefined && opts.config.remote.enabled) {
    unsubSubmit = events.on(PI_ASK_SUBMIT, (raw) => {
      try {
        handleSubmit(raw);
      } catch {
        // Never poison the shared bus — a listener throw would break pi-ask's
        // listener too. Last-resort bus guard only: the answer path below
        // acks internal_error itself (BUG-007) — what can still land here is
        // a throw from the malformed-input early paths (no parsed
        // requestId/flowId to nack with) or from an emit itself.
      }
    });
  }

  function emitCompleted(flowId: string, flow: ActiveFlow): void {
    events?.emit(PI_ASK_COMPLETED, {
      version: 1,
      flowId,
      source: flow.source,
      completedAt: Date.now(),
    });
  }

  function completeFlow(flowId: string): void {
    const flow = flows.get(flowId);
    if (flow === undefined) return;
    flows.delete(flowId);
    emitCompleted(flowId, flow);
  }

  function emitSubmitResult(
    requestId: string,
    flowId: string,
    ok: true | { error: "flow_not_found" | "invalid_answer" | "internal_error"; message: string },
  ): void {
    const payload: Record<string, unknown> = { version: 1, requestId, flowId, ok: ok === true };
    if (ok !== true) {
      payload.error = ok.error;
      payload.message = ok.message;
    }
    events?.emit(PI_ASK_SUBMIT_RESULT, payload);
  }

  function handleSubmit(raw: unknown): void {
    if (!isRecord(raw) || raw.version !== 1) return; // malformed → silent (pi-ask owns nacking)
    const flowId = raw.flowId;
    const requestId = raw.requestId;
    if (typeof flowId !== "string" || typeof requestId !== "string") return;
    if (!flows.has(flowId)) {
      if (!flowId.startsWith(FLOW_ID_PREFIX)) return; // foreign flow — pi-ask's business
      emitSubmitResult(requestId, flowId, {
        error: "flow_not_found",
        message: "Interrogation flow is not active.",
      });
      return;
    }
    const response = raw.response;
    if (!isRecord(response)) return;

    if (response.kind === "cancel") {
      // D-R6 defer: ACK, resolve the flow, keep state, no model noise.
      emitSubmitResult(requestId, flowId, true);
      completeFlow(flowId);
      return;
    }
    if (response.kind !== "answer" || !isRecord(response.answers)) return;

    const state = (opts.getState ?? getState)();
    if (state === undefined) {
      emitSubmitResult(requestId, flowId, {
        error: "flow_not_found",
        message: "Interrogation flow is not active.",
      });
      return;
    }

    // D-R4 mapping against CURRENT state (a re-ask may have changed options).
    const answers = mapWireAnswers(state, response.answers);
    if (answers.applied.length === 0) {
      emitSubmitResult(requestId, flowId, {
        error: "invalid_answer",
        message: answers.dropped.length > 0
          ? `No recordable answers (dropped: ${answers.dropped.join(", ")}).`
          : "No recordable answers.",
      });
      // Question set changed underneath → re-render the client with the
      // current options so a retry is possible against fresh values.
      emitFlow(state, "ask:replay");
      return;
    }

    try {
      recordRemoteSubmission(pi, state, answers.applied, {
        lifecycle: opts.lifecycle,
        maybeAutoSubmit: opts.maybeAutoSubmit,
      });
    } catch {
      // BUG-007 (FR-32/D-R6): an unexpected internal throw (applyAnswer
      // listener, diff, delivery, injected hook) must never leave the
      // client hanging without an ack. Emit an internal_error NACK and
      // tear the flow down. NO rollback — snapshots/epoch are append-only,
      // so state may stay half-mutated (documented worst case); the next
      // upsert resurface heals the surface. Skip the ok-ack and the
      // resurface — re-emission happens on the next upsert.
      emitSubmitResult(requestId, flowId, {
        error: "internal_error",
        message:
          "Internal error during submission. State may be partially applied; a later upsert resurfaces live questions.",
      });
      completeFlow(flowId);
      return;
    }
    // nothing_shippable = every applied answer already matched the pending
    // set (identical re-selection): ACCEPTED with no model delta — same
    // semantics as the panel's "nothing to submit" flash.
    emitSubmitResult(requestId, flowId, true);
    completeFlow(flowId);
    if (opts.config.remote.resurface && liveQuestions(state.serialize()).length > 0) {
      emitFlow(state, "ask:replay");
    }
  }

  /**
   * D-R4 wire → RemoteAnswerInput against CURRENT state, with the
   * WRITEIN-001 custom-marker matrix (h2.30/h2.42 — bridge answers match
   * the panel's commit shapes byte-for-byte):
   *
   * | wire input                        | question | mapped answer |
   * |---|---|---|
   * | `values[0]` valid option          | choice   | `{ value }` — validated against CURRENT options (D-R4; the client derived them from OUR emission — possibly stale after a re-ask) |
   * | `values[0]` valid + `customText`  | choice   | `{ value, text: customText }` — elaboration, NO custom flag |
   * | `customText` only (values absent) | choice   | `{ value: customText, custom: true }` — THE write-in path, identical to the panel's Other row; never checked against option lists |
   * | any                               | text     | `{ value: customText ?? values[0], custom: true }` — panel parity (writeInEnter / reconcileDraftsForSubmit commit text answers with `custom: true`) |
   *
   * `""` customText is absent customText — an empty write-in still drops.
   * Custom values are NEVER validated against option lists (h2.42: the
   * bridge's answer validation accepts custom values as-is); `note` and
   * `optionNotes` stay dropped; terminal statuses (moot/withdrawn/closed)
   * and unknown ids drop.
   */
  function mapWireAnswers(
    state: InterrogationState,
    rawAnswers: Record<string, unknown>,
  ): { applied: RemoteAnswerInput[]; dropped: string[] } {
    const applied: RemoteAnswerInput[] = [];
    const dropped: string[] = [];
    for (const [id, rawAnswer] of Object.entries(rawAnswers)) {
      const wire = parseWireAnswer(rawAnswer);
      const q = state.getQuestion(id);
      if (wire === null || q === undefined || !isRecordable(q)) {
        dropped.push(id);
        continue;
      }
      const custom = wire.customText !== undefined && wire.customText !== "" ? wire.customText : undefined;
      let value: string | undefined;
      if (q.type === "text") {
        value = custom ?? wire.values?.[0];
      } else {
        const picked = wire.values?.[0];
        if (picked !== undefined && (q.options ?? []).some((o) => o.value === picked)) {
          value = picked;
        } else if (picked === undefined && custom !== undefined) {
          value = custom; // freeform on a choice question — recorded as given
        }
      }
      if (value === undefined || value === "") {
        dropped.push(id);
        continue;
      }
      const answer: RemoteAnswerInput = { id, value };
      if (q.type === "text") {
        // WRITEIN-001 panel parity: the panel's text commits (writeInEnter /
        // reconcileDraftsForSubmit) always carry custom: true — the bridge
        // maps identically (h2.42).
        answer.custom = true;
      } else if (value === wire.values?.[0]) {
        if (custom !== undefined) {
          answer.text = custom; // elaboration alongside a valid picked value
        }
      } else {
        // customText-only on a choice question IS the write-in path — the
        // exact answer object the panel's Other row commits. Recorded AS
        // GIVEN: never validated against option lists (h2.42/D-R4).
        answer.custom = true;
      }
      applied.push(answer);
    }
    return { applied, dropped };
  }

  /** moot/withdrawn/closed are terminal-until-re-upsert (h2.38; same rule as fallback.ts). */
  function isRecordable(q: Question): boolean {
    return q.status !== "moot" && q.status !== "withdrawn" && q.status !== "closed";
  }

  function emitFlow(state: InterrogationState, source: RemoteFlowSource): string | null {
    if (!opts.config.remote.enabled || events === undefined) return null;
    const questions = toAskQuestions(state.serialize());
    if (questions.length === 0) {
      // Nothing askable — retire any outstanding flow instead of leaving a
      // client stuck on a stale question set.
      completeAllFlows();
      return null;
    }
    // D-R6: every emission completes the previous flow first — a new flow
    // replaces the client surface with the newest question set.
    completeAllFlows();
    const flowId = `${FLOW_ID_PREFIX}${randomUUID()}:${++seq}`;
    const goal = state.serialize().goal;
    const title = (goal === "" ? "Interrogation" : goal).slice(0, TITLE_CAP);
    flows.set(flowId, { source, createdAt: Date.now() });
    events.emit(PI_ASK_STARTED, { version: 1, flowId, source, title, questions, createdAt: Date.now() });
    return flowId;
  }

  function completeAllFlows(): void {
    for (const [flowId, flow] of [...flows]) {
      flows.delete(flowId);
      emitCompleted(flowId, flow);
    }
  }

  return {
    emitFlow,
    completeAll: completeAllFlows,
    dispose(): void {
      unsubSubmit?.();
      unsubSubmit = undefined;
      completeAllFlows();
    },
  };
}

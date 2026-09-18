/**
 * src/remote-compat.test.ts — plan §5.2: contract-compatibility proof
 * against remote_pi's REAL production bridge
 * (~/src/remote_pi/pi-extension/src/extension_ui_bridge.ts), loaded
 * in-process via dynamic import (its runtime imports are type-only).
 *
 * Drives the interrogator bridge end-to-end through the actual consumer of
 * the pi-ask contract: emitFlow → the real bridge broadcasts a conformant
 * `extension_ui_request`; a simulated client response through
 * `bridge.respond` (rich ask envelope, then the degraded no-envelope label
 * path) round-trips into recorded answers. Skips gracefully when the
 * remote_pi checkout is absent (CI portability).
 */
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { createRemoteBridge, PI_ASK_SUBMIT_RESULT } from "./remote-bridge.js";
import { createInterrogationState, resetState, setState, type InterrogationState } from "./state.js";

const REMOTE_PI_BRIDGE = "/home/dustin/src/remote_pi/pi-extension/src/extension_ui_bridge.ts";

/** Fixture: one choice question (q1, options a/b, recommend a) + one text (q2). */
function compatState(): InterrogationState {
  const state = createInterrogationState("Compat goal");
  state.upsertQuestion({
    id: "q1",
    title: "Pick one",
    prompt: "Which option?",
    type: "choice",
    options: [
      { value: "a", label: "Alpha", ramification: "First letter." },
      { value: "b", label: "Beta", ramification: "Second letter." },
    ],
    recommendation: "a",
    rev: 1,
    status: "open",
  });
  state.upsertQuestion({ id: "q2", prompt: "Free text?", type: "text", rev: 1, status: "open" });
  return state;
}

type Handler = (data: unknown) => void;

class FakeBus {
  private handlers = new Map<string, Set<Handler>>();
  emitted: { event: string; data: unknown }[] = [];

  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  emit(event: string, data: unknown): void {
    this.emitted.push({ event, data });
    for (const h of this.handlers.get(event) ?? []) h(data);
  }
}

interface RealBridgeHandle {
  respond(msg: unknown): void;
  pendingRequests(): unknown[];
  dispose(): void;
}

describe.skipIf(!existsSync(REMOTE_PI_BRIDGE))(
  "pi-ask contract compat: remote_pi's real extension_ui_bridge (in-process)",
  () => {
    test("emitFlow → conformant extension_ui_request; respond → recorded; degraded label path works", async () => {
      const { createExtensionUiBridge } = (await import(REMOTE_PI_BRIDGE)) as {
        createExtensionUiBridge: (pi: unknown, broadcast: (msg: unknown) => void) => RealBridgeHandle;
      };

      const bus = new FakeBus();
      const sent: unknown[] = [];
      const broadcasts: Array<Record<string, unknown>> = [];
      const pi = {
        events: bus,
        sendMessage: (msg: unknown) => void sent.push(msg),
      };

      // The interrogator (producer) + remote_pi's REAL bridge (consumer).
      const interrogator = createRemoteBridge(pi as never, { config: DEFAULT_CONFIG });
      const real = createExtensionUiBridge(pi, (msg) => void broadcasts.push(msg as Record<string, unknown>));

      const state = compatState();
      setState(state);
      const flowId = interrogator.emitFlow(state, "tool");
      expect(flowId).not.toBeNull();

      // ── 1. The real bridge translated our started event into a wire frame.
      expect(broadcasts).toHaveLength(1);
      const req = broadcasts[0]!;
      expect(req.type).toBe("extension_ui_request");
      expect(req.id).toBe(flowId);
      expect(req.method).toBe("select"); // first question has options
      expect(req.options).toEqual(["Alpha ★", "Beta"]); // first question's option LABELS
      const ask = req.ask as Record<string, unknown>;
      expect(ask.flow_id).toBe(flowId);
      expect(ask.title).toBe("Compat goal");
      const questions = ask.questions as Array<Record<string, unknown>>;
      expect(questions.map((q) => q.id)).toEqual(["q1", "q2"]);
      expect(questions[0]!.label).toBe("Pick one"); // explicit title → label
      expect(questions[1]!.label).toBe(""); // absent title → explicit empty string
      const q1Options = questions[0]!.options as Array<Record<string, string>>;
      expect(q1Options.find((o) => o.value === "a")!.label).toBe("Alpha ★");
      expect(q1Options.find((o) => o.value === "a")!.description).toBe("First letter.");

      // Replay-on-reconnect contract: the pending request is queued for
      // session_sync replay while the flow awaits an answer.
      expect(real.pendingRequests()).toHaveLength(1);

      // ── 2. Rich path: the client answers via the ask envelope.
      real.respond({
        type: "extension_ui_response",
        id: flowId,
        ask: {
          flow_id: flowId,
          kind: "answer",
          mode: "submit",
          answers: {
            q1: { values: ["a"] },
            q2: { customText: "because reasons" },
          },
        },
      });

      // Our submit-result ok:true rode the bus (the real bridge's
      // submit-result listener returns early on ok — no warning broadcast).
      const results = bus.emitted
        .filter((e) => e.event === PI_ASK_SUBMIT_RESULT)
        .map((e) => e.data as Record<string, unknown>);
      expect(results.some((r) => r.ok === true)).toBe(true);
      expect(state.getQuestion("q1")!.answer?.value).toBe("a");
      expect(state.getQuestion("q2")!.answer?.value).toBe("because reasons");
      expect(sent).toHaveLength(1); // one submission delta delivered
      // The real bridge also dismissed the flow (completed → notify with the
      // same id) and replayed nothing further.
      const notify = broadcasts.find(
        (b) => b.type === "extension_ui_request" && b.method === "notify" && b.id === flowId,
      );
      expect(notify).toBeDefined();
      expect(real.pendingRequests()).toHaveLength(0);

      // ── 3. Degraded path: a strict client answers by LABEL with no envelope.
      const state2 = compatState();
      setState(state2);
      const flow2 = interrogator.emitFlow(state2, "ask:replay")!;
      expect(flow2).not.toBe(flowId);
      real.respond({ type: "extension_ui_response", id: flow2, value: "Beta" });
      expect(state2.getQuestion("q1")!.answer?.value).toBe("b"); // label → VALUE mapping
      const results2 = bus.emitted
        .filter((e) => e.event === PI_ASK_SUBMIT_RESULT)
        .map((e) => e.data as Record<string, unknown>);
      expect(results2.some((r) => r.ok === true && r.flowId === flow2)).toBe(true);

      interrogator.dispose();
      real.dispose();
      resetState();
    });
  },
);

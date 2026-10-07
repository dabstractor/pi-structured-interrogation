/**
 * REGRESSION SUITE — re-ask round-trip (BUG-001 + BUG-002 repro journeys).
 *
 * The two release blockers were composition failures: each unit fix worked
 * in isolation, but the re-ask → re-confirm → submission → settle →
 * completion loop wedged ("nothing to submit" / no completion injection).
 * This suite pins the COMPOSITION over the four M1 fixes (T1.S1 submit
 * pendingIds fall-through, T1.S2 maybeAutoSubmit empty-diff transition,
 * T2.S1 acceptOptionIndex reasked exclusion, T2.S2 writeInEnter exclusion)
 * using ONLY public seams: real executeInterrogate + real lifecycle event
 * bus + real InterrogationPanel accept/submit + a captured sendMessage.
 * No src module is mocked (the regression-phantom-submissions discipline).
 *
 * Scenario mapping (PRD repro steps):
 * - Scenario A = PRD h2.1/h3.0 (BUG-001): answer → submit (epoch 2) →
 *   rule-1 re-ask (same options, new prompt — answer KEPT) → same-value
 *   ENTER re-confirm (the T2.S1 exclusion: never inert for reasked) →
 *   second submission (epoch 3, via T1.S1's pendingIds flush despite the
 *   empty answer-signature diff) → agent_settled closes → the FR-5
 *   completion record is injected EXACTLY once and state clears.
 * - Scenario B = PRD h2.2/h3.1 (BUG-002): rule-2 re-ask (changed options)
 *   RESETS the answer → fresh re-accept → auto-submits with NO ctrl+s
 *   (T1.S2 transition) → epoch 3 → settle → completion exactly once.
 *
 * Trigger mechanics (deviation note, verified against the landed code):
 * with a single-question set EVERY accept is "the commit that answered the
 * last unanswered question", so each submission fires via the
 * AUTOSUBMIT-003 transition inside the ENTER — a subsequent ctrl+s ships
 * nothing (asserted: the wedge is provably absent and nothing double-
 * ships). The PRP's step scripts had ctrl+s as the trigger; the observable
 * fingerprints (delivery counts, customTypes, content, epochs, statuses,
 * one completion, cleared state) are exactly as specified.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "./config.js";
import { createCompletionTrigger } from "./completion.js";
import { DraftStore } from "./draft-store.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel/panel.js";
import { getState, resetState } from "./state.js";
import { executeInterrogate, type ExecutorContext } from "./tool.js";
import type { InterrogateParamsValue } from "./tool-schema.js";

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

const ENTER = "\r";
const CTRL_S = "\u0013";

function fakeEditor() {
  let text = "";
  return {
    getText: () => text,
    setText: (t: string) => {
      text = t;
    },
    handleInput: vi.fn(),
    render: () => ["e1", "e2", "e3"],
    focused: false,
    focus: vi.fn(),
    blur: vi.fn(),
    invalidate: vi.fn(),
  };
}

/**
 * pi harness: host-event subscriptions captured; sendMessage recorded.
 * EXTENDED vs the model test: `emit` passes a payload through to the
 * handlers — tool_execution_start/end need toolCallId/toolName/args/isError.
 */
function makePiHarness() {
  const sendMessage = vi.fn();
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const on = vi.fn((event: string, handler: (e: unknown) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {};
  });
  const pi = { on, sendMessage } as unknown as Pick<ExtensionAPI, "on" | "sendMessage">;
  const emit = (event: string, payload: Record<string, unknown> = {}): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload });
  };
  return { pi, sendMessage, on, emit };
}

function tuiCtx(): ExecutorContext {
  return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };
}

beforeEach(() => {
  resetState();
});

// ------------------------------------------------------------------ fixtures

/** Labels === values so the digest renders the bare fingerprint `q1: a`. */
function opts(...values: string[]) {
  return values.map((v) => ({ value: v, label: v }));
}

interface SentMessage {
  customType: string;
  content: string;
}

/** All shipped submission messages, in order (the hard delivery fingerprint). */
function deliveries(h: ReturnType<typeof makePiHarness>): SentMessage[] {
  return h.sendMessage.mock.calls.map((c) => c[0] as SentMessage).filter((m) => m.customType === "interrogation-submission");
}

function completions(h: ReturnType<typeof makePiHarness>): SentMessage[] {
  return h.sendMessage.mock.calls.map((c) => c[0] as SentMessage).filter((m) => m.customType === "interrogation-completion");
}

function q1Status(): string | undefined {
  return getState()!.getQuestion("q1")?.status;
}

function makeWalkthrough() {
  const h = makePiHarness();
  let lifecycle: Lifecycle;
  lifecycle = createLifecycle(h.pi, {
    onAfterClosePass: createCompletionTrigger(h.pi, {
      lifecycle: { dismissPanel: () => lifecycle.dismissPanel() },
      ctx: { isIdle: () => true },
    }),
  });

  let editor: ReturnType<typeof fakeEditor> | undefined;
  const panelOf = () => {
    const state = getState()!;
    return new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state,
      config: DEFAULT_CONFIG,
      drafts: new DraftStore(),
      editorFactory: () => {
        editor = fakeEditor();
        return editor;
      },
      delivery: {
        sendMessage: h.sendMessage,
        isIdle: () => true,
        noteSubmissionDelivered: () => lifecycle.noteSubmissionDelivered(),
      },
    } as unknown as InterrogationPanelArgs);
  };
  return { h, panelOf };
}

/**
 * Simulate the HOST's tool events around a real re-ask upsert:
 * executeInterrogate emits NO tool events, but the lifecycle's rule-1
 * re-ask flip keys on tool_execution_start/end correlation by toolCallId
 * (start stashes args; end flips touched `submitted` ids to `reasked`).
 * Mismatched ids = silent no-op — this wrapper is the one non-obvious
 * mechanic in the suite.
 */
let toolCallSeq = 0;
function reaskHost(
  h: ReturnType<typeof makePiHarness>,
  upsertArgs: InterrogateParamsValue,
): void {
  const toolCallId = `tc-${++toolCallSeq}`;
  h.emit("tool_execution_start", { toolCallId, toolName: "interrogate", args: upsertArgs });
  executeInterrogate(upsertArgs, tuiCtx(), DEFAULT_CONFIG);
  h.emit("tool_execution_end", { toolCallId, toolName: "interrogate", result: undefined, isError: false });
}

// ----------------------------------------------------- Scenario A (rule-1)

describe("rule-1 re-ask: same-value re-confirm completes the loop (BUG-001)", () => {
  test("re-ask keeps the answer → same-value ENTER re-confirms → second submission (epoch 3) → settle → completion once", () => {
    const { h, panelOf } = makeWalkthrough();

    // Step 1 — upsert q1 (epoch 1), accept 'a'. Single-question set: the
    // accept IS the last-unanswered transition, so submission 1 auto-fires
    // (epoch 2, status submitted); a manual ctrl+s adds nothing.
    executeInterrogate(
      { goal: "Loop", questions: [{ id: "q1", prompt: "p1?", type: "choice", options: opts("a", "b") }] },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    expect(getState()!.epoch).toBe(1);
    const panel = panelOf();
    panel.currentId = "q1";
    expect(panel.cursorIndex).toBe(0); // seeds to row 0 = 'a'
    panel.handleInput(ENTER);
    expect(q1Status()).toBe("submitted");
    expect(getState()!.epoch).toBe(2);
    expect(getState()!.getQuestion("q1")!.answer?.value).toBe("a");
    expect(deliveries(h)).toHaveLength(1);
    expect(deliveries(h)[0]!.content).toContain("q1: a");
    panel.handleInput(CTRL_S); // nothing pending — no double-ship, no wedge
    expect(deliveries(h)).toHaveLength(1);

    // Step 2 — rule-1 re-ask: same options, new prompt, rev+epoch echoed
    // (assertFresh would StaleError otherwise). Answer is KEPT.
    reaskHost(h, {
      epoch: 2,
      questions: [{ id: "q1", prompt: "p2?", type: "choice", options: opts("a", "b"), rev: 1 }],
    });
    expect(q1Status()).toBe("reasked");
    expect(getState()!.getQuestion("q1")!.answer?.value).toBe("a");
    expect(getState()!.epoch).toBe(2);
    expect(deliveries(h)).toHaveLength(1);

    // Step 3 — remount; the recorded 'a' owns the caret; same-value ENTER
    // re-confirms (T2.S1 reasked exclusion — NOT an inert no-op) and the
    // transition auto-ships submission 2 despite the empty answer diff
    // (T1.S1 pendingIds flush): epoch 3.
    const panel2 = panelOf();
    panel2.currentId = "q1";
    expect(panel2.cursorIndex).toBe(0); // caret pinned to the recorded 'a' row
    panel2.handleInput(ENTER);
    expect(q1Status()).toBe("submitted"); // re-confirm committed → shipped
    expect(getState()!.epoch).toBe(3);
    expect(getState()!.getQuestion("q1")!.answer?.value).toBe("a");
    expect(deliveries(h)).toHaveLength(2);
    expect(deliveries(h)[1]!.customType).toBe("interrogation-submission");
    expect(deliveries(h)[1]!.content).toContain("state epoch 3");

    // Step 4 — a further ctrl+s ships NOTHING (already submitted): the
    // "nothing to submit" state exists only when there is truly nothing
    // pending — the wedge is impossible.
    panel2.handleInput(CTRL_S);
    expect(deliveries(h)).toHaveLength(2);
    expect(getState()!.epoch).toBe(3);

    // Step 5 — settle: close pass archives q1 → completion fires EXACTLY
    // once (the FR-5 record is the LAST sendMessage) → state cleared.
    h.emit("agent_settled");
    const comps = completions(h);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.content).toContain("INTERROGATION COMPLETE");
    expect(h.sendMessage.mock.calls).toHaveLength(3); // sub1 + sub2 + completion
    expect(getState()!.getQuestion("q1")).toBeUndefined(); // clearForCompletion ran
    expect(getState()!.orderedQuestions()).toEqual([]);
    expect(getState()!.epoch).toBe(3); // epoch survives the clear (h2.43)
  });
});

// ----------------------------------------------------- Scenario B (rule-2)

describe("rule-2 re-ask: re-answer auto-submits and completes (BUG-002)", () => {
  test("changed options reset the answer → fresh re-accept auto-submits (no ctrl+s) → completion once", () => {
    const { h, panelOf } = makeWalkthrough();

    // Step 1 — seed q1 with options [a,b,c]; accept 'a' → auto submission 1.
    executeInterrogate(
      { goal: "Loop", questions: [{ id: "q1", prompt: "p1?", type: "choice", options: opts("a", "b", "c") }] },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    expect(getState()!.epoch).toBe(1);
    const panel = panelOf();
    panel.currentId = "q1";
    expect(panel.cursorIndex).toBe(0);
    panel.handleInput(ENTER); // accept 'a' → transition auto-ships
    expect(q1Status()).toBe("submitted");
    expect(getState()!.epoch).toBe(2);
    expect(deliveries(h)).toHaveLength(1);
    expect(deliveries(h)[0]!.content).toContain("q1: a");

    // Step 2 — rule-2 re-ask: CHANGED options [a,b,d] reset the answer
    // (merge deletes it — stays undefined until re-answered), status reasked.
    reaskHost(h, {
      epoch: 2,
      questions: [{ id: "q1", prompt: "p1?", type: "choice", options: opts("a", "b", "d"), rev: 1 }],
    });
    expect(q1Status()).toBe("reasked");
    expect(getState()!.getQuestion("q1")!.answer).toBeUndefined();
    expect(getState()!.getQuestion("q1")!.rev).toBe(2);
    expect(getState()!.epoch).toBe(2);
    expect(deliveries(h)).toHaveLength(1);

    // Step 3 — remount: no recorded answer → fresh seed at row 0 ('a').
    // The re-accept is a FRESH accept, and with zero unanswered remaining it
    // AUTO-SUBMITS — no ctrl+s anywhere in this scenario.
    const panel2 = panelOf();
    panel2.currentId = "q1";
    expect(panel2.cursorIndex).toBe(0);
    panel2.handleInput(ENTER); // re-accept 'a' → auto submission 2 (T1.S2 path)
    expect(q1Status()).toBe("submitted");
    expect(getState()!.epoch).toBe(3);
    expect(getState()!.getQuestion("q1")!.answer?.value).toBe("a");
    expect(deliveries(h)).toHaveLength(2);
    expect(deliveries(h)[1]!.content).toContain("state epoch 3");

    // Step 4 — settle: close → completion EXACTLY once → cleared.
    h.emit("agent_settled");
    const comps = completions(h);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.content).toContain("INTERROGATION COMPLETE");
    expect(h.sendMessage.mock.calls).toHaveLength(3);
    expect(getState()!.getQuestion("q1")).toBeUndefined();
    expect(getState()!.orderedQuestions()).toEqual([]);
    expect(getState()!.epoch).toBe(3);
  });
});

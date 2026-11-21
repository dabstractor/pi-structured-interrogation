/**
 * src/panel/retirement-sidechat.test.ts — acceptance case 4-send-half +
 * write-in handoff-seam retirement + the composed behavioral no-side-effects
 * audit (P3.M2.T1.S3; spec state-and-persistence.md :139 "A refused or
 * failed send or aborted turn leaves the prompt recoverable for manual
 * retry without overwriting newer typing"; acceptance case 4 :145-149; the
 * commit half of case 4 is P3.M3/P3.M5's).
 *
 * Harness: the ac-sidechat.test.ts pattern — a DIRECT-constructed real
 * panel + REAL engine over an injected fake port (the seams openPanel's
 * host binder would build), extended with the input-recovery composition:
 * the shared InputCaptureStore (sink → durable write, onRetire → durable
 * retire over a tmpdir — the index.ts wiring shape) passed via
 * `inputCapture`, and a fake sessionManager on `pi` (the panel's live
 * branchReader). The engine's settle handler mirrors the production
 * resolveSidechatHostSeams shape BYTE-FOR-BYTE via the exported
 * retireChatCaptureOnSettle decision — the tested shape IS the shipped
 * shape.
 *
 * REAL timers throughout (the engine's stream consumption/settle is
 * asynchronous; the flash clock runs); capture pacing uses the store's
 * forceFlush accelerator instead of timer advancement — the sanctioned
 * flush-before-send seam (captureSeams: "Capture on edit, before Enter").
 *
 * THE HAZARD UNDER TEST (research §2): engine sendTurn returns TRUE on
 * three failed-dispatch paths — so retirement is gated on the SETTLE
 * outcome (clean completion only), never on the send's boolean.
 */
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import { InputCaptureStore, type CaptureKey } from "../input-capture.js";
import { DurableInputStore } from "../input-durability.js";
import {
  InterrogationPanel,
  retireChatCaptureOnSettle,
  sidechatSettleObservation,
  type InterrogationPanelArgs,
} from "./panel.js";
import { resetSidechatForTests, type SidechatRebindDeps } from "./sidechat.js";
import {
  createSidechatEngine,
  type SidechatEngineDeps,
  type SidechatModelPort,
  type SidechatRegistryPort,
} from "./sidechat-engine.js";
import { submit, type SubmitDeps } from "./actions.js";

const ENTER = "\r";
const ESCAPE = "\u001b";
const CHAT_KEY = "c"; // DEFAULT_CONFIG.keys.chat
const BRANCH_ID = "branch-1";

// ------------------------------------------------------------------ fixtures

/** Fresh temp dir per test, removed in afterEach (config.test.ts fixture). */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  resetSidechatForTests(); // the singleton is module memory — never leak
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-interrogator-retire-panel-"));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  resetSidechatForTests();
});

/** Identity theme (panel.test.ts stubTheme). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
} as unknown as InterrogationPanelArgs["theme"];

function textQ(id: string, overrides: Partial<Question> = {}): Question {
  return { id, prompt: `prompt:${id}`, type: "text", rev: 1, status: "open", ...overrides };
}

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    ...overrides,
  };
}

function fakePanelEditor(): EditorComponent & { setText: Mock } {
  let text = "";
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["e1", "e2", "e3"]),
    focused: false,
  } as unknown as EditorComponent & { setText: Mock };
}

function panelArgsFor(state: InterrogationState, extra: Partial<InterrogationPanelArgs> = {}): InterrogationPanelArgs {
  return {
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    editorFactory: () => fakePanelEditor(),
    ...extra,
  };
}

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------- fake model port machinery (ac-sidechat clones)

let seq = 0;

function fakeModel(provider: string, id: string): Model<Api> {
  seq += 1;
  return {
    id,
    name: `${provider}/${id} #${seq}`,
    api: "anthropic-messages",
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

function fakeRegistry(models: Model<Api>[]): SidechatRegistryPort {
  return {
    find: vi.fn((provider, modelId) => models.find((m) => m.provider === provider && m.id === modelId)),
    getAvailable: vi.fn(() => models),
  };
}

function assistantReply(text: string, stopReason: "stop" | "aborted" = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "prov",
    model: "mdl-1",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/** Completed stream: done + end — settle() freezes the reply. */
function doneStream(text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message: assistantReply(text) });
  stream.end();
  return stream;
}

/** Test-controlled stream: hold the settle loop open (mid-stream refuse /
 * abort states), then finish with a chosen terminal. */
function gatedStream(): {
  stream: AssistantMessageEventStream;
  finishWith: (event: AssistantMessageEvent) => void;
} {
  const queue: AssistantMessageEvent[] = [];
  const waiters: Array<() => void> = [];
  let ended = false;
  const wake = (): void => {
    const w = waiters.shift();
    if (w !== undefined) w();
  };
  const stream = {
    async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
      while (true) {
        while (queue.length === 0 && !ended) await new Promise<void>((r) => waiters.push(r));
        if (queue.length > 0) {
          yield queue.shift() as AssistantMessageEvent;
          continue;
        }
        break;
      }
    },
  } as unknown as AssistantMessageEventStream;
  return {
    stream,
    finishWith: (event) => {
      queue.push(event);
      ended = true;
      wake();
    },
  };
}

// ------------------------------------------------------------------- harness

const CHAT_CAP: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "sidechat-composer" };

/** Capture `text` under `k` and flush it through the composed sink NOW
 * (the accelerator seam — capture-before-send). Returns the durable value
 * check helper inputs. */
function captureAndFlush(capture: InputCaptureStore, k: CaptureKey, text: string): void {
  capture.setKeyDirty(k, () => text);
  capture.forceFlush(k);
}

interface Harness {
  state: InterrogationState;
  panel: InterrogationPanel;
  capture: InputCaptureStore;
  durable: DurableInputStore;
  port: Mock;
  finishers: Array<(event: AssistantMessageEvent) => void>;
  dir: string;
  retired: CaptureKey[];
}

/**
 * Direct-constructed real panel + REAL engine over an injected port, with
 * the input-recovery composition wired exactly like index.ts (sink →
 * durable.write, onRetire → durable.retire{explicit}) and the settle
 * handler mirroring resolveSidechatHostSeams production shape.
 */
function makeHarness(opts: {
  state?: InterrogationState;
  port?: SidechatModelPort;
} = {}): Harness {
  const state = opts.state ?? (() => {
    const s = createInterrogationState("retirement harness");
    s.upsertQuestion(textQ("q1"));
    s.upsertQuestion(choiceQ("q2"));
    return s;
  })();
  const dir = tmpDir();
  const durable = new DurableInputStore({ dir });
  const retired: CaptureKey[] = [];
  const capture = new InputCaptureStore({
    sink: (record) => {
      durable.write(record);
    },
    session: () => "sess-1",
    seedSeq: (k) => durable.lastSeq(k),
    onRetire: (k) => {
      retired.push(k);
      durable.retire(k, { explicit: true });
    },
  });
  const panelRef: { current: InterrogationPanel | undefined } = { current: undefined };
  const finishers: Array<(event: AssistantMessageEvent) => void> = [];
  const port = (opts.port ?? vi.fn(() => doneStream("ok"))) as unknown as Mock;
  const engine = createSidechatEngine({
    port: port as unknown as SidechatModelPort,
    // PRODUCTION SHAPE (resolveSidechatHostSeams): observation + retire
    // decision — via the SAME exported function the factory uses.
    onSettle: (stopReason) => {
      sidechatSettleObservation(panelRef.current);
      retireChatCaptureOnSettle(stopReason, panelRef.current);
    },
    registry: fakeRegistry([fakeModel("prov", "mdl-1")]),
    notify: vi.fn(),
  } satisfies SidechatEngineDeps);
  const rebindDeps: SidechatRebindDeps = {
    resolveModelSnapshot: () => ({ provider: "prov", modelId: "mdl-1" }),
    buildSystemPrompt: () => "SYS",
    buildBranchSnapshot: () => [] as never,
  };
  const panel = new InterrogationPanel(
    panelArgsFor(state, {
      sidechatEngine: engine,
      chatRebindDeps: rebindDeps,
      sidechatNotify: vi.fn(),
      inputCapture: capture,
      pi: {
        sessionManager: {
          getBranch: () => [{ id: BRANCH_ID }],
          getSessionId: () => "sess-1",
        },
      } as unknown as InterrogationPanelArgs["pi"],
    }),
  );
  panelRef.current = panel;
  return { state, panel, capture, durable, port, finishers, dir, retired };
}

function chatFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
}

function openChat(h: Harness): void {
  h.panel.currentId = "q1";
  expect(h.panel.handleInput(CHAT_KEY)).toBe(true);
  expect(h.panel.view).toBe("chat");
}

// ------------------------------------------------- case 4 — send-half halves

describe("acceptance case 4-send-half — chat retirement rides the settle, never the send", () => {
  test("clean completion retires the chat key: file gone, no resurrection, no duplicate send", async () => {
    const h = makeHarness();
    openChat(h);
    captureAndFlush(h.capture, CHAT_CAP, "recover me");
    expect(chatFiles(h.dir)).toHaveLength(1); // prompt durably saved pre-send
    expect(h.durable.latest(CHAT_CAP)?.text).toBe("recover me");

    h.panel.chatField.setText("recover me");
    h.panel.handleInput(ENTER); // sendChatInput → sendTurn accepted
    expect(h.port).toHaveBeenCalledTimes(1);
    expect(h.panel.chatField.getText()).toBe(""); // composer cleared on accept
    expect(chatFiles(h.dir)).toHaveLength(1); // NOT retired ahead of the settle

    await flush(); // stream consumption + settle routing
    // The settle routed "stop" — a CLEAN completion: the handoff happened,
    // NOW the recovery value retires (architecture note §retirement #3).
    expect(chatFiles(h.dir)).toEqual([]);
    expect(h.durable.latest(CHAT_CAP)).toBeUndefined();
    expect(h.retired).toEqual([CHAT_CAP]);

    // NO resurrection: a straggler write at/below the retired seq is dead.
    expect(h.durable.write({ ...CHAT_CAP, session: "sess-1", text: "recover me", seq: 1 })).toBe(
      "ignored-stale",
    );
    expect(chatFiles(h.dir)).toEqual([]);

    // Re-typing the SAME text after the handoff re-captures ABOVE the
    // tombstone (seq counter preserved, lastValue gate cleared) — the
    // composer is capturable again, normally.
    captureAndFlush(h.capture, CHAT_CAP, "recover me");
    expect(chatFiles(h.dir)).toHaveLength(1);
    expect(h.durable.latest(CHAT_CAP)?.seq).toBe(2);
    expect(h.port).toHaveBeenCalledTimes(1); // still exactly one send
  });

  test("REFUSE (streamState busy): sendTurn false → composer + capture intact, no duplicate send", async () => {
    let finish: ((event: AssistantMessageEvent) => void) | undefined;
    const port = vi.fn(() => {
      const g = gatedStream();
      finish = g.finishWith;
      return g.stream;
    }) as unknown as SidechatModelPort;
    const h = makeHarness({ port });
    openChat(h);

    // Turn 1: accepted, stream held open (streaming).
    h.panel.chatField.setText("first prompt");
    h.panel.handleInput(ENTER);
    expect(h.port).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.panel.chatField.getText()).toBe("");

    // The user types a SECOND prompt mid-stream and presses enter →
    // REFUSED (no queueing): flash, buffer survives, capture stands.
    captureAndFlush(h.capture, CHAT_CAP, "second prompt");
    expect(chatFiles(h.dir)).toHaveLength(1);
    h.panel.chatField.setText("second prompt");
    h.panel.handleInput(ENTER);
    expect(h.port).toHaveBeenCalledTimes(1); // NO duplicate send
    expect(h.panel.chatField.getText()).toBe("second prompt"); // buffer intact
    expect(h.durable.latest(CHAT_CAP)?.text).toBe("second prompt"); // recoverable

    // Turn 1 aborts (esc) — "aborted" routes a settle, retires NOTHING:
    expect(h.panel.abortChatStream()).toBe(true);
    finish?.({ type: "error", reason: "aborted", error: assistantReply("par", "aborted") });
    await flush();
    expect(h.durable.latest(CHAT_CAP)?.text).toBe("second prompt"); // STILL recoverable
    expect(chatFiles(h.dir)).toHaveLength(1);
    expect(h.retired).toEqual([]); // refuse AND abort both retired nothing
    expect(h.panel.chatField.getText()).toBe("second prompt");
  });

  test("FAIL (synchronous port/auth throw): sendTurn true but NO settle → prompt recoverable", async () => {
    const port = vi.fn(() => {
      throw new Error("No API key for provider: prov"); // pi-ai sync auth throw
    }) as unknown as SidechatModelPort;
    const h = makeHarness({ port });
    openChat(h);
    captureAndFlush(h.capture, CHAT_CAP, "my failed prompt");

    h.panel.chatField.setText("my failed prompt");
    h.panel.handleInput(ENTER); // sendTurn returns TRUE (failed-dispatch path)
    await flush(); // any stray settle would retire — none must route
    expect(h.port).toHaveBeenCalledTimes(1);
    // The composer was cleared by the accept, but the RECOVERY VALUE STANDS:
    expect(h.durable.latest(CHAT_CAP)?.text).toBe("my failed prompt");
    expect(chatFiles(h.dir)).toHaveLength(1);
    expect(h.retired).toEqual([]); // a failed send retires NOTHING (spec :139)
    const record = h.panel.view === "chat" ? undefined : undefined;
    void record;
  });

  test("ABORT mid-stream: turn popped, settle routes 'aborted' → nothing retires", async () => {
    const port = vi.fn(() => {
      const g = gatedStream();
      h.finishers.push(g.finishWith);
      return g.stream;
    }) as unknown as SidechatModelPort;
    const h = makeHarness({ port });
    openChat(h);
    captureAndFlush(h.capture, CHAT_CAP, "aborted prompt");
    h.panel.chatField.setText("aborted prompt");
    h.panel.handleInput(ENTER);
    await flush(); // mid-stream: turn recorded, buffer held open
    expect(h.durable.latest(CHAT_CAP)?.text).toBe("aborted prompt");

    expect(h.panel.abortChatStream()).toBe(true); // the esc streaming rung
    h.finishers[0]?.({ type: "error", reason: "aborted", error: assistantReply("par", "aborted") });
    await flush(); // settle routes "aborted" — the turn never happened
    expect(h.durable.latest(CHAT_CAP)?.text).toBe("aborted prompt"); // recoverable
    expect(chatFiles(h.dir)).toHaveLength(1);
    expect(h.retired).toEqual([]); // abort retires NOTHING
    expect(h.port).toHaveBeenCalledTimes(1); // no duplicate send
  });
});

// ------------------------------------------- write-in / note handoff seams

describe("retirement fires at exactly the write-in handoff seams — nowhere else", () => {
  test("direct commit exit retires exactly once, AFTER applyAnswer", () => {
    const h = makeHarness();
    const state = h.state;
    const applySpy = vi.spyOn(state, "applyAnswer");
    const WRITEIN: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "writein" };
    captureAndFlush(h.capture, WRITEIN, "my typed answer");
    expect(chatFiles(h.dir)).toHaveLength(1);

    h.panel.currentId = "q1";
    h.panel.focusTextField("writein");
    h.panel.textField.setText("my typed answer");
    h.panel.handleInput(ENTER); // writeInEnter direct commit

    expect(applySpy).toHaveBeenCalledTimes(1); // the handoff ran ONCE
    expect(state.getQuestion("q1")?.answer?.value).toBe("my typed answer");
    expect(h.retired).toEqual([WRITEIN]); // retired EXACTLY once, after it
    expect(chatFiles(h.dir)).toEqual([]); // recovery value gone
  });

  test("byte-identical inert exit retires (the buffer still became the answer)", () => {
    const h = makeHarness();
    const state = h.state;
    state.applyAnswer("q1", { value: "recorded", at: "2026-01-01T00:00:00.000Z" }); // type:text
    const WRITEIN: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "writein" };
    captureAndFlush(h.capture, WRITEIN, "recorded");
    expect(chatFiles(h.dir)).toHaveLength(1);

    h.panel.currentId = "q1";
    h.panel.focusTextField("writein");
    h.panel.textField.setText("recorded");
    h.panel.handleInput(ENTER); // byte-identical → inert commit + consume

    expect(h.retired).toEqual([WRITEIN]);
    expect(chatFiles(h.dir)).toEqual([]);
    expect(state.getQuestion("q1")?.answer?.value).toBe("recorded"); // unchanged value
  });

  test("empty-buffer enter rejects in-editor retires nothing; esc exit stages, never retires", () => {
    const h = makeHarness();
    const WRITEIN: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "writein" };
    captureAndFlush(h.capture, WRITEIN, "typed but not committed");
    expect(chatFiles(h.dir)).toHaveLength(1);

    h.panel.currentId = "q1";
    h.panel.focusTextField("writein");
    h.panel.textField.setText("");
    // P3.M4.T1.S1: a blank enter is REJECTED and stays in the editor — no
    // write-through (a DRAFT, not a handoff), so certainly no retirement.
    h.panel.handleInput(ENTER);
    expect(h.retired).toEqual([]);
    expect(chatFiles(h.dir)).toHaveLength(1); // recovery value stands
    expect(h.panel.focus).toBe("text"); // still editing — the rejection never exits

    h.panel.textField.setText("esc staged draft");
    h.panel.handleInput(ESCAPE); // exitTextField — STAGES the draft
    expect(h.retired).toEqual([]);
    expect(chatFiles(h.dir)).toHaveLength(1); // never retires on esc
    expect(h.durable.latest(WRITEIN)?.text).toBe("typed but not committed");
  });

  test("ripple deferral retires nothing at beginWriteInConfirm; the APPLY retires", () => {
    const state = createInterrogationState("ripple retire");
    state.upsertQuestion(textQ("q1", { status: "answered" }));
    state.applyAnswer("q1", { value: "a", at: "2026-01-01T00:00:00.000Z" });
    state.upsertQuestion(choiceQ("q2", { status: "answered", dependsOn: [{ id: "q1", equals: "a" }] }));
    state.applyAnswer("q2", { value: "a", at: "2026-01-01T00:00:00.000Z" });
    const h = makeHarness({ state });
    const WRITEIN: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "writein" };
    captureAndFlush(h.capture, WRITEIN, "different text");
    expect(chatFiles(h.dir)).toHaveLength(1);

    h.panel.currentId = "q1";
    h.panel.focusTextField("writein");
    h.panel.textField.setText("different text");
    h.panel.handleInput(ENTER); // answered + victims → FR-18 modal (deferral)
    expect(h.panel.confirmMode?.kind).toBe("writein");
    expect(h.retired).toEqual([]); // NOTHING applied yet — nothing retired
    expect(chatFiles(h.dir)).toHaveLength(1);

    h.panel.handleInput(ENTER); // modal enter → applyWriteInConfirm → consume
    expect(state.getQuestion("q1")?.answer?.value).toBe("different text");
    expect(h.retired).toEqual([WRITEIN]); // retired at the APPLY seam
    expect(chatFiles(h.dir)).toEqual([]);
  });

  test("submit retires shipped drafts (both roles) + the shipped note; HELD drafts never retire", () => {
    const h = makeHarness();
    const WRITEIN_Q1: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "writein" };
    const ELAB_Q1: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "elaboration" };
    const ELAB_Q2: CaptureKey = { branchId: BRANCH_ID, questionId: "q2", field: "elaboration" };
    const NOTE: CaptureKey = { branchId: BRANCH_ID, questionId: "-", field: "note" };
    captureAndFlush(h.capture, WRITEIN_Q1, "typed text answer");
    captureAndFlush(h.capture, ELAB_Q1, "elab typed then discarded");
    captureAndFlush(h.capture, ELAB_Q2, "held rationale");
    captureAndFlush(h.capture, NOTE, "batch note text");
    expect(chatFiles(h.dir)).toHaveLength(4);

    // Drafts: q1 (text) ships as its answer; q2 (choice, open) is HELD.
    h.panel.commitTextDraft("q1", "typed text answer");
    h.panel.commitTextDraft("q2", "held rationale");
    h.panel.batchNote = "batch note text";
    const sendMessage = vi.fn();
    const deps = { sendMessage, isIdle: () => true } as unknown as SubmitDeps;
    expect(submit(h.panel, deps)).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1); // the handoff happened

    // Shipped: q1's writein + elaboration keys retire; the note ships and
    // retires. HELD: q2's elaboration NEVER retires (nothing handed off).
    expect(chatFiles(h.dir)).toHaveLength(1);
    expect(h.durable.latest(WRITEIN_Q1)).toBeUndefined();
    expect(h.durable.latest(ELAB_Q1)).toBeUndefined();
    expect(h.durable.latest(NOTE)).toBeUndefined();
    expect(h.durable.latest(ELAB_Q2)?.text).toBe("held rationale"); // stands
    expect(h.retired).toEqual([WRITEIN_Q1, ELAB_Q1, NOTE]);
  });
});

// ------------------------------------------------------ behavioral audit

describe("behavioral no-side-effects audit — capture flush + retire mutate nothing", () => {
  test("capture setKeyDirty/forceFlush/retire on a live panel: state byte-identical, zero sends, zero applies", () => {
    const h = makeHarness();
    const applySpy = vi.spyOn(h.state, "applyAnswer");
    const delivery = { sendMessage: vi.fn(), isIdle: () => true };
    h.panel.currentId = "q1";

    const before = h.state.serialize();
    const WRITEIN: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "writein" };
    const ELAB: CaptureKey = { branchId: BRANCH_ID, questionId: "q1", field: "elaboration" };
    const NOTE: CaptureKey = { branchId: BRANCH_ID, questionId: "-", field: "note" };

    // The full inert surface: capture (edit + flush), retirement (explicit
    // AND non-explicit), at panel level AND store level — none of it may
    // advance, commit, queue, submit, or send anything (spec :139).
    h.capture.setKeyDirty(WRITEIN, () => "some text");
    h.capture.forceFlush();
    h.capture.retire(WRITEIN); // non-explicit: full no-op
    h.panel.retireCapture("q1", ["writein", "elaboration"]);
    h.capture.setKeyDirty(ELAB, () => "elab text");
    h.capture.forceFlush(ELAB);
    h.panel.retireCapture("q1", ["elaboration"]);
    h.panel.retireCapture("-", ["note"]);
    h.capture.retire(NOTE, { explicit: true });
    void delivery;

    const after = h.state.serialize();
    expect(after).toEqual(before); // NO InterrogationState mutation
    expect(applySpy).not.toHaveBeenCalled(); // no answer application
    expect(h.port).toHaveBeenCalledTimes(0); // no send, no model call
    expect(h.state.epoch).toBe(before.epoch ?? h.state.epoch); // no snapshot/epoch bump
  });
});

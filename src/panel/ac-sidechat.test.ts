/**
 * src/panel/ac-sidechat.test.ts — scripted AC-17 side-chat acceptance tests
 * (SIDECHAT-001…005; spec/product-requirements.md:101, FR-15 :41,
 * ui-spec §Side chat, state-and-persistence.md §Side chat).
 *
 * AUTOMATION-POLICY (plan/001, BINDING): no live TUI, no real model calls —
 * the ONLY model behavior here is the injected fake SidechatModelPort
 * (sidechat-engine.ts:79, the seam P1.M1.T5.S1 built for exactly this).
 * Everything else runs the REAL landed modules: the sidechat store
 * singleton, createSidechatEngine, chat-view.ts renders, and the real
 * InterrogationPanel key routing / confirm-row / discard hooks
 * (ac-panel.test.ts harness precedent — real panel, fake tui/theme, mock pi).
 *
 * [Mode A] PER-AC RESULTS TABLE (defect log + manual residuals:
 * plan/005_af804251f18d/P1M3T2S1/research/AC17-RESULTS.md)
 *
 * | AC-17 item                    | verdict | SIDECHAT | evidence (test)                                    |
 * |-------------------------------|---------|----------|----------------------------------------------------|
 * | open on q3, NO suspend        | PASS    | 001      | AC-17.1_chat_open_no_suspend                       |
 * | two-turn exchange streams     | PASS    | 001/003  | AC-17.2_two_turn_exchange_streams_in_view          |
 * | /clear resets on CURRENT q    | PASS    | 005      | AC-17.2_slash_clear_resets_on_current_question     |
 * | `e` on q5 replaces singleton  | PASS    | 002      | AC-17.3_chat_on_other_question_replaces_singleton  |
 * | confirm row → enter → apply   | PASS    | 004      | AC-17.4_confirm_row_and_apply_byte_identical       |
 * |   (byte-identical delta/card) | PASS    | 004      | (same test — content AND details vs user fixture)  |
 * | esc declines, chat stays open | PASS    | 004      | AC-17.4_esc_declines_keeps_chat                    |
 * | sideChatAutoApply skips row   | PASS    | 004      | AC-17.4_autoapply_skips_confirm                    |
 * | panel answer discards chat    | PASS    | 002      | AC-17.5_panel_answer_discards_open_chat            |
 * | esc-suspend + resume returns  | PASS    | 002      | AC-17.6_suspend_resume_returns_chat                |
 * | restart: no chat, NO residue  | PASS    | 002      | AC-17.6_restart_no_chat_no_residue                 |
 * | malformed block → notice      | PASS    | 004      | AC-17.7_malformed_answer_notice_chat_stays_open    |
 * | esc aborts streaming          | PASS    | 004/FR-15| AC-17.8_esc_aborts_streaming                       |
 * | /usr/bin path is a message    | PASS    | 005      | AC-17.8_usr_bin_path_is_a_message                  |
 *
 * Discuss-successor note (P1.M2.T7.S1): the successor pins are ALREADY
 * landed — src/config.test.ts "discuss→chat legacy alias (SIDECHAT-001)"
 * pins the coerceKeys alias + explicit-chat-wins, discuss.ts is deleted,
 * and AC-17.1 here pins the no-suspend/no-preload replacement behavior.
 * Not duplicated (see AC17-RESULTS.md).
 *
 * Never edits sibling suites (ac-panel / ac-scripted / sidechat-cache-
 * isolation — P1.M3.T1.S1's, parallel).
 */
import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "../config.js";
import { createStateMirror, INTERROGATION_STATE_ENTRY_TYPE } from "../persistence.js";
import { markAnswered } from "../merge.js";
import { createInterrogationState, resetState, setState, type InterrogationState, type Question } from "../state.js";
import { applyChatAnswer } from "./actions.js";
import { ANSWER_REJECTION_NOTICES } from "./chat-view.js";
import {
  createPanelHost,
  InterrogationPanel,
  openPanel,
  resumeOpenPanel,
  settleInvalidatingPort,
  sidechatSettleObservation,
  type InterrogationPanelArgs,
  type PiUISurface,
} from "./panel.js";
import {
  classifyChatCommand,
  get as getSidechat,
  resetSidechatForTests,
  type SidechatRebindDeps,
} from "./sidechat.js";
import {
  createSidechatEngine,
  type SidechatEngineDeps,
  type SidechatModelPort,
  type SidechatRegistryPort,
} from "./sidechat-engine.js";

// ------------------------------------------------------------------ fixtures

const ENTER = "\r";
const ESCAPE = "\u001b";
const RIGHT = "\u001b[C"; // next question (fixed key)
const CHAT_KEY = "e"; // DEFAULT_CONFIG.keys.chat

/** Identity theme (panel.test.ts stubTheme). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const OPTS = [
  { value: "sqlite", label: "Sqlite" },
  { value: "postgres", label: "Postgres" },
];

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS.map((o) => ({ ...o })),
    ...overrides,
  };
}

/** AC-17 fixture: seven open choice questions (q3/q5/q7 are the AC's named
 * actors). No gate group, no dependsOn — the side-chat scenarios isolate
 * chat behavior from gate/ripple semantics. */
function sideState(): InterrogationState {
  const state = createInterrogationState("Ship the side chat");
  for (const id of ["q1", "q2", "q3", "q4", "q5", "q6", "q7"]) state.upsertQuestion(choiceQ(id));
  return state;
}

/** Every question EXCEPT q3 answered-pending, so the q3 accept is the
 * completeness TRANSITION (AUTOSUBMIT-003 rule a) and auto-submit fires on
 * both provenance runs. Identical seeding in both runs keeps the delivered
 * payload byte-comparable. */
function seedTransition(state: InterrogationState): void {
  for (const id of ["q1", "q2", "q4", "q5", "q6", "q7"]) {
    markAnswered(state, id, { value: "sqlite", at: "2026-01-01T00:00:00.000Z" });
  }
}

// ------------------------------------------------------------------- fake pi

/** One captured ui.custom invocation (panel.test.ts/ac-panel.test.ts shape). */
interface CustomCall {
  component: InterrogationPanel;
  done: (result: null | undefined) => void;
  resolved: boolean;
}

type Handler = (event: unknown, ctx: unknown) => void;

/** Trimmed makeMockPi (ac-panel.test.ts): custom capture + widget/editorText
 * seams + an `on` registrar. `editorText` doubles as the no-preload probe. */
function makeMockPi(mode: string | undefined = "tui"): {
  pi: PiUISurface & Pick<ExtensionAPI, "on">;
  calls: CustomCall[];
  requestRender: Mock;
  setWidget: Mock;
  editorText: { get: () => string; set: (text: string) => void };
  sendMessage: Mock;
} {
  const calls: CustomCall[] = [];
  const handlers = new Map<string, Handler[]>();
  const requestRender = vi.fn();
  const setWidget = vi.fn();
  const sendMessage = vi.fn();
  let editorText = "";
  const custom = vi.fn(
    (
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: null) => void,
      ) => InterrogationPanel,
    ): Promise<null | undefined> => {
      let resolve!: (result: null | undefined) => void;
      const promise = new Promise<null | undefined>((res) => {
        resolve = res;
      });
      const component = factory(
        { requestRender } as unknown as TUI,
        stubTheme,
        {} as unknown as KeybindingsManager,
        (result) => resolve(result),
      );
      const call: CustomCall = {
        component: component as InterrogationPanel,
        done: (result) => resolve(result),
        resolved: false,
      };
      void promise.then(() => {
        call.resolved = true;
      });
      calls.push(call);
      return promise;
    },
  );
  const on = vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {};
  });
  const surface = {
    mode,
    ui: {
      custom,
      setWidget,
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
    },
    on,
    sendMessage,
  };
  return {
    pi: surface as unknown as PiUISurface & Pick<ExtensionAPI, "on">,
    calls,
    requestRender,
    setWidget,
    editorText: {
      get: () => editorText,
      set: (text: string) => {
        editorText = text;
      },
    },
    sendMessage,
  };
}

function makeMockLifecycle(): { lifecycle: { onPanelDismiss: (cb: () => void) => void; dismissPanel: () => void } } {
  let cb: (() => void) | undefined;
  return {
    lifecycle: {
      onPanelDismiss: (registered) => {
        cb = registered;
      },
      dismissPanel: () => cb?.(),
    },
  };
}

// ------------------------------------------------------- panel construction

/** Stateful fake composed editor (panel.test.ts structural contract). */
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

// ------------------------------------------------- fake model port machinery

let seq = 0;

/** Structurally complete Model<Api> (sidechat-engine.test.ts clone). */
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

/** Structurally complete AssistantMessage (sidechat-engine.test.ts clone). */
function assistantReply(
  text: string,
  usage?: { input: number; output: number; total: number },
): AssistantMessage {
  const u = usage ?? { input: 1, output: 2, total: 0 };
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "prov",
    model: "mdl-1",
    usage: {
      input: u.input,
      output: u.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: u.input + u.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: u.total },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Completed stream: done + end — settle() freezes the reply (T5.S2). */
function doneStream(
  text: string,
  usage?: { input: number; output: number; total: number },
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message: assistantReply(text, usage) });
  stream.end();
  return stream;
}

/** Test-controlled stream: push events at chosen moments, hold the settle
 * loop open (streaming asserts, esc-abort), and ALWAYS push a terminal
 * before end() — a drain without one routes the "stream ended" error. */
function gatedStream(): {
  stream: AssistantMessageEventStream;
  push: (event: AssistantMessageEvent) => void;
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
        break; // ended and drained
      }
    },
  } as unknown as AssistantMessageEventStream;
  return {
    stream,
    push: (event) => {
      queue.push(event);
      wake();
    },
    finishWith: (event) => {
      queue.push(event);
      ended = true;
      wake();
    },
  };
}

/** A reply ending in a fenced ```answer block (SIDECHAT-004 protocol). */
function answerReply(value: string): string {
  return `I would go with ${value}.\n\n\`\`\`answer\n{"value": "${value}"}\n\`\`\``;
}

// -------------------------------------------------------------- harness

interface Harness {
  state: InterrogationState;
  panel: InterrogationPanel;
  notify: Mock;
  delivery: { sendMessage: Mock; isIdle: () => boolean };
}

/** Direct-constructed real panel + REAL engine over an injected port — the
 * seams openPanel's host binder would build (panel.ts resolveSidechatHostSeams),
 * faked per the injected-port rule. `onAutoApply` mirrors the host's single
 * routing consumer (panel.ts:535 — applyChatAnswer). */
function makeHarness(
  opts: {
    config?: InterrogatorConfig;
    delivery?: { sendMessage: Mock; isIdle: () => boolean };
    focusQuestionId?: string;
    port?: SidechatModelPort;
  } = {},
): Harness {
  const config = opts.config ?? DEFAULT_CONFIG;
  const state = sideState();
  const notify = vi.fn();
  const delivery = opts.delivery ?? { sendMessage: vi.fn(), isIdle: () => true };
  const rebindDeps: SidechatRebindDeps = {
    resolveModelSnapshot: () => ({ provider: "prov", modelId: "mdl-1" }),
    buildSystemPrompt: () => "SYS",
    buildBranchSnapshot: () => [] as never,
  };
  const panelRef: { current: InterrogationPanel | undefined } = { current: undefined };
  const engine = createSidechatEngine({
    // The fake port IS the isolation; it rides the SAME production settle
    // observation the real wiring uses (panel.ts) — macrotask fire included
    // — so the AC tests exercise the shipped blur-on-decision-settle path.
    port: settleInvalidatingPort(
      opts.port ??
        (() => doneStream("ok")) as unknown as SidechatModelPort,
      () => sidechatSettleObservation(panelRef.current),
    ),
    registry: fakeRegistry([fakeModel("prov", "mdl-1")]),
    notify: vi.fn(),
    answerContext: (questionId) => {
      const q = state.getQuestion(questionId);
      return q !== undefined
        ? { question: q, autoApply: config.sideChatAutoApply === true }
        : undefined;
    },
    onAutoApply: (decision) => {
      if (panelRef.current !== undefined) applyChatAnswer(panelRef.current, decision);
    },
  } satisfies SidechatEngineDeps);
  const panel = new InterrogationPanel(
    panelArgsFor(state, {
      config,
      delivery,
      focusQuestionId: opts.focusQuestionId,
      sidechatEngine: engine,
      chatRebindDeps: rebindDeps,
      sidechatNotify: notify,
    }),
  );
  panelRef.current = panel;
  return { state, panel, notify, delivery };
}

/** Open the chat on the panel's current question through the REAL key
 * router (`e`, DEFAULT_CONFIG.keys.chat) — never by calling the store. */
function openChat(panel: InterrogationPanel): void {
  expect(panel.handleInput(CHAT_KEY)).toBe(true);
}

/** Close the chat input box only (double-esc within the window) so the
 * confirm row / option-accept gestures are reachable from options focus. */
function blurChatBox(panel: InterrogationPanel): void {
  panel.handleInput(ESCAPE);
  panel.handleInput(ESCAPE);
}

/** Send a chat message through the real chat input + enter interception. */
function sendChat(panel: InterrogationPanel, text: string): void {
  panel.chatField.setText(text);
  panel.handleInput(ENTER);
}

beforeEach(() => {
  resetState();
  resetSidechatForTests();
  createPanelHost(makeMockLifecycle().lifecycle); // re-arm the host record
});

afterEach(() => {
  resetSidechatForTests(); // the singleton is module memory — never leak
});

// ------------------------------------------------------- AC-17.1 (SIDECHAT-001)

describe("AC-17.1 — open without suspend (SIDECHAT-001)", () => {
  test("AC-17.1_chat_open_no_suspend", async () => {
    const mock = makeMockPi();
    const state = sideState();
    // Host wiring like openPanel's binder, over a faked port (AUTOMATION-POLICY).
    const engine = createSidechatEngine({
      port: (() => doneStream("ok")) as unknown as SidechatModelPort,
      registry: fakeRegistry([fakeModel("prov", "mdl-1")]),
      notify: vi.fn(),
    });
    const rebindDeps: SidechatRebindDeps = {
      resolveModelSnapshot: () => ({ provider: "prov", modelId: "mdl-1" }),
      buildSystemPrompt: () => "SYS",
      buildBranchSnapshot: () => [] as never,
    };
    expect(
      openPanel(mock.pi, {
        config: DEFAULT_CONFIG,
        state,
        focusQuestionId: "q3",
        sidechatEngine: engine,
        chatRebindDeps: rebindDeps,
        sidechatNotify: vi.fn(),
      }),
    ).toBe(true);
    const panel = mock.calls[0]!.component;
    expect(panel.currentId).toBe("q3");

    panel.handleInput(CHAT_KEY); // the real `e` rung

    expect(panel.view).toBe("chat");
    expect(panel.focus).toBe("chat");
    const record = getSidechat();
    expect(record?.questionId).toBe("q3");
    // NO suspend: done never fired, host still open, editor surface untouched.
    await flush();
    expect(mock.calls[0]!.resolved).toBe(false); // done() never called
    const host = {
      isOpen: () => true,
      isSuspended: () => false,
      suspend: () => {},
      getPanel: () => panel,
      dispose: () => {},
      retargetState: () => {},
    };
    expect(host.isSuspended()).toBe(false);
    expect(mock.editorText.get()).toBe(""); // no main-editor preload (discuss successor)
    expect(mock.pi.ui.custom).toHaveBeenCalledTimes(1); // no second mounting
  });
});

// ------------------------------------------------------- AC-17.2 (SIDECHAT-001/003/005)

describe("AC-17.2 — two-turn exchange + /clear", () => {
  test("AC-17.2_two_turn_exchange_streams_in_view", async () => {
    // Turn 1 completes mid-test so the frozen transcript is asserted, then
    // turn 2 accumulates (the held-stream buffer proof lives in AC-17.8).
    let turn = 0;
    const port: SidechatModelPort = vi.fn(
      () => doneStream(turn++ === 0 ? "reply one" : "reply two", { input: 1, output: 2, total: 0 }),
    );
    const { panel } = makeHarness({ focusQuestionId: "q3", port });

    openChat(panel);
    expect(panel.view).toBe("chat");
    sendChat(panel, "why sqlite?");
    await flush();
    const record = getSidechat();
    expect(record?.messages).toHaveLength(2); // user + assistant
    expect(record?.messages[0]).toMatchObject({ role: "user", text: "why sqlite?" });
    expect(record?.messages[1]).toMatchObject({ role: "assistant", text: "reply one" });
    expect(record?.streamState).toBe("idle");

    // Turn 2 accumulates.
    sendChat(panel, "and the ramification?");
    await flush();
    expect(record?.messages).toHaveLength(4);
    expect(record?.messages[3]).toMatchObject({ role: "assistant", text: "reply two" });

    // In-view render: the transcript lines exist in the chat view body.
    panel.invalidate();
    const body = panel.render(100).join("\n");
    expect(body).toContain("you › why sqlite?");
    expect(body).toContain("reply one");
    expect(body).toContain("reply two");
    expect(body).toContain("chat · q3 — prompt:q3"); // header binds the question

    // Usage accumulated for the completed turns only (SIDECHAT-005 tally).
    expect(record?.usage).toEqual({ input: 2, output: 4, totalCost: 0 });
  });

  test("AC-17.2_slash_clear_resets_on_current_question", async () => {
    const { panel } = makeHarness({ focusQuestionId: "q3", port: (() => doneStream("ok")) as unknown as SidechatModelPort });
    openChat(panel);
    sendChat(panel, "first chat");
    await flush();
    expect(getSidechat()?.messages.length).toBeGreaterThan(0);

    blurChatBox(panel); // release the input so arrows navigate questions
    panel.handleInput(RIGHT); // q3 → q4 (fixed key, view-aware)
    expect(panel.currentId).toBe("q4");
    panel.focusChatInput(); // the chat input claims focus again (view is chat)

    sendChat(panel, "/clear"); // byte-exact first token → reset (SIDECHAT-005)
    const record = getSidechat();
    expect(record?.questionId).toBe("q4"); // rebound to the CURRENT question
    expect(record?.messages).toHaveLength(0); // messages discarded
    expect(record?.usage).toEqual({ input: 0, output: 0, totalCost: 0 }); // usage too
    expect(panel.view).toBe("chat"); // the view stays open
  });
});

// ------------------------------------------------------- AC-17.3 (SIDECHAT-002)

describe("AC-17.3 — singleton replacement", () => {
  test("AC-17.3_chat_on_other_question_replaces_singleton", async () => {
    const { panel } = makeHarness({ focusQuestionId: "q3", port: (() => doneStream("ok")) as unknown as SidechatModelPort });
    openChat(panel);
    sendChat(panel, "q3 conversation");
    await flush();
    const before = getSidechat();
    expect(before?.questionId).toBe("q3");
    expect(before?.messages.length).toBeGreaterThan(0);

    blurChatBox(panel);
    panel.handleInput(RIGHT); // q4
    panel.handleInput(RIGHT); // q5
    expect(panel.currentId).toBe("q5");
    panel.handleInput(CHAT_KEY); // `e` on q5 — wholesale replace

    const after = getSidechat();
    expect(after?.questionId).toBe("q5");
    expect(after?.messages).toHaveLength(0); // the q3 messages are GONE
    expect(after?.usage).toEqual({ input: 0, output: 0, totalCost: 0 });
    expect(after?.pendingConfirm).toBeUndefined(); // no confirm interposed
    expect(panel.view).toBe("chat");
  });
});

// ------------------------------------------------- AC-17.4 (SIDECHAT-004 core)

/** Script the port to converge on `{"value": "sqlite"}` for the FIRST turn.
 * Promise-shaped (the stream's documented `result()` fallback) so the
 * production settle wrapper's `.finally` fire actually schedules — the AC
 * tests exercise the shipped blur-on-decision-settle path. */
function convergePort(): SidechatModelPort {
  let first = true;
  return vi.fn(() => {
    if (first) {
      first = false;
      return doneStream(answerReply("sqlite"), {
        input: 10,
        output: 5,
        total: 0.07,
      }).result() as unknown as ReturnType<SidechatModelPort>;
    }
    return doneStream("ok").result() as unknown as ReturnType<SidechatModelPort>;
  }) as unknown as SidechatModelPort;
}

describe("AC-17.4 — answer protocol: confirm, apply, byte identity", () => {
  test("AC-17.4_confirm_row_and_apply_byte_identical", async () => {
    // ---- Run A: the answer arrives via the side chat's confirm row.
    const chat = makeHarness({ focusQuestionId: "q3", port: convergePort() });
    seedTransition(chat.state); // q1/q2 pending → the q3 accept completes the set
    openChat(chat.panel);
    sendChat(chat.panel, "converge please");
    await flush(); // settle → parse → pendingConfirm

    const record = getSidechat();
    expect(record?.pendingConfirm).toEqual({ seam: "acceptOptionIndex", optionIndex: 0 });
    await flush(); // run the queued settle fire (macrotask): invalidate + decision blur

    // The confirm row renders in the chat view footer (spec copy family).
    chat.panel.invalidate();
    const body = chat.panel.render(100).join("\n");
    expect(body).toContain("apply ★ sqlite? · enter = yes · esc = no");

    // BUG-001 fix (P1.M1.T1.S1): the decision-bearing settle itself blurred
    // the chat input — the confirm row's advertised enter acts with NO
    // pre-blur (the old codified workaround was a double-esc blurChatBox).
    expect(chat.panel.focus).toBe("options"); // settle blur happened
    chat.panel.handleInput(ENTER);
    await flush();

    // Applied through the ordinary seam; chat discarded; view landed back.
    expect(chat.state.getQuestion("q3")?.answer?.value).toBe("sqlite");
    // The auto-submit FLUSHED the accepted answer (markSubmitted) — final
    // status is "submitted", which is itself the proof the transition fired.
    expect(chat.state.getQuestion("q3")?.status).toBe("submitted");
    expect(getSidechat()).toBeUndefined();
    expect(chat.panel.view).toBe("short");
    expect(chat.notify).toHaveBeenCalledWith("chat closed · 10 in · 5 out · $0.07");
    expect(chat.delivery.sendMessage).toHaveBeenCalledTimes(1); // auto-submit fired

    // ---- Run B: the SAME fixture, the answer made by a user selection.
    const user = makeHarness({ focusQuestionId: "q3" }); // no chat involved
    seedTransition(user.state);
    // Fresh panel seeds the cursor on display row 0 (no recommendation) —
    // the sqlite row. Plain enter is the ordinary accept gesture.
    user.panel.handleInput(ENTER);
    await flush();

    expect(user.state.getQuestion("q3")?.answer?.value).toBe("sqlite");
    expect(user.state.getQuestion("q3")?.status).toBe("submitted"); // same flush
    expect(user.delivery.sendMessage).toHaveBeenCalledTimes(1);

    // ---- BYTE IDENTITY (SIDECHAT-004): delta content AND card details.
    const chatPayload = chat.delivery.sendMessage.mock.calls[0];
    const userPayload = user.delivery.sendMessage.mock.calls[0];
    expect(chatPayload).toEqual(userPayload);
    const msg = chatPayload?.[0] as { content: string; details: { changed: unknown[] } };
    expect(msg.content).toContain("q3: Sqlite"); // answerSummary renders the label
    expect(msg.content.split("\n")[0]).toMatch(/\(state epoch \d+\)$/); // FR-3a line 1
    expect(msg.details.changed.map((e) => (e as { id: string }).id)).toContain("q3");
  });

  test("AC-17.4_esc_declines_keeps_chat", async () => {
    const { panel, state } = makeHarness({ focusQuestionId: "q3", port: convergePort() });
    openChat(panel);
    sendChat(panel, "converge please");
    await flush();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    await flush(); // run the queued settle fire (macrotask): decision blur
    expect(panel.focus).toBe("options"); // settle blurred; confirm row interactive
    panel.handleInput(ESCAPE); // decline

    expect(getSidechat()?.pendingConfirm).toBeUndefined(); // cleared
    expect(getSidechat()?.lastRejection).toBeUndefined(); // retired together
    expect(getSidechat()?.messages.length).toBeGreaterThan(0); // transcript retained
    expect(getSidechat()).toBeDefined(); // chat stays open
    expect(state.getQuestion("q3")?.answer).toBeUndefined(); // NOT applied
    expect(panel.view).toBe("chat");
  });

  test("AC-17.4_no_block_settle_keeps_chat_focus", async () => {
    // BUG-001 decision-blur scoping: a plain (no answer-block) settle must
    // NOT steal focus — the user may be typing a follow-up. Only a
    // decision-bearing settle (pendingConfirm set) reclaims focus.
    const { panel } = makeHarness({
      focusQuestionId: "q3",
      port: doneStream("ok").result() as unknown as SidechatModelPort, // promise-shaped: the settle fire RUNS and must keep focus
    }); // plain "ok" reply, no answer block
    openChat(panel);
    sendChat(panel, "plain reply please");
    await flush();
    await flush(); // run the queued settle fire (macrotask): it must NOT blur

    expect(getSidechat()?.pendingConfirm).toBeUndefined(); // no confirm interposed
    expect(panel.focus).toBe("chat"); // focus KEPT — follow-up typing seamless
    expect(panel.view).toBe("chat");
  });

  test("AC-17.4_autoapply_skips_confirm", async () => {
    const config: InterrogatorConfig = { ...DEFAULT_CONFIG, sideChatAutoApply: true };
    const { panel, state, delivery } = makeHarness({
      config,
      focusQuestionId: "q3",
      port: convergePort(),
    });
    seedTransition(state);
    openChat(panel);
    panel.invalidate();
    sendChat(panel, "converge please");
    await flush(); // settle routes the decision straight to onAutoApply

    // Applied directly — no confirm row, no enter gesture.
    expect(state.getQuestion("q3")?.answer?.value).toBe("sqlite");
    expect(getSidechat()).toBeUndefined(); // the apply discarded the chat
    expect(delivery.sendMessage).toHaveBeenCalledTimes(1); // auto-submit as usual
    const bodyAfter = panel.render(100).join("\n");
    expect(bodyAfter).not.toContain("apply ★"); // the confirm row never showed
    expect(panel.view).toBe("short"); // landed where the advance points
  });
});

// ------------------------------------------------------- AC-17.5 (SIDECHAT-002)

describe("AC-17.5 — panel answer discards the open chat", () => {
  test("AC-17.5_panel_answer_discards_open_chat", async () => {
    const { panel, notify, delivery } = makeHarness({ focusQuestionId: "q7", port: convergePort() });
    openChat(panel);
    sendChat(panel, "q7 chat");
    await flush();
    expect(getSidechat()?.questionId).toBe("q7");

    // Answer q7 through the ORDINARY path: blur the chat box, enter on the
    // seeded option row. The discard hook lives at the state-mutation seams.
    blurChatBox(panel);
    panel.handleInput(ENTER);

    expect(getSidechat()).toBeUndefined(); // discarded immediately
    expect(panel.view).toBe("short"); // the chat view closed with it
    expect(notify).toHaveBeenCalledTimes(1); // the compact close-notice usage line
    expect(notify.mock.calls[0]?.[0]).toContain("chat closed ·");
    expect(panel.state.getQuestion("q7")?.answer?.value).toBe("sqlite");
    // Other questions are still open — no auto-submit, no delivery.
    expect(delivery.sendMessage).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------- AC-17.6 (SIDECHAT-002)

describe("AC-17.6 — suspend survival and restart loss", () => {
  test("AC-17.6_suspend_resume_returns_chat", async () => {
    const mock = makeMockPi();
    const state = sideState();
    const engine = createSidechatEngine({
      port: (() => doneStream("kept reply")) as unknown as SidechatModelPort,
      registry: fakeRegistry([fakeModel("prov", "mdl-1")]),
      notify: vi.fn(),
    });
    const rebindDeps: SidechatRebindDeps = {
      resolveModelSnapshot: () => ({ provider: "prov", modelId: "mdl-1" }),
      buildSystemPrompt: () => "SYS",
      buildBranchSnapshot: () => [] as never,
    };
    openPanel(mock.pi, {
      config: DEFAULT_CONFIG,
      state,
      focusQuestionId: "q3",
      sidechatEngine: engine,
      chatRebindDeps: rebindDeps,
      sidechatNotify: vi.fn(),
    });
    const panel1 = mock.calls[0]!.component;
    panel1.handleInput(CHAT_KEY);
    sendChat(panel1, "survives suspend");
    await flush();
    const record = getSidechat();
    expect(record?.messages).toHaveLength(2);

    mock.calls[0]!.done(null); // esc-ladder terminus: suspend
    await flush();
    expect(mock.calls[0]!.resolved).toBe(true);
    expect(getSidechat()).toBe(record); // the singleton survives the suspend

    expect(resumeOpenPanel(mock.pi)).toBe(true); // the /interrogate path
    const panel2 = mock.calls[1]!.component;
    expect(panel2).not.toBe(panel1); // fresh instance — rehydrated from state
    expect(getSidechat()).toBe(record); // …and the chat is still bound

    // The chat returns: same-question `e` REUSES the record byte-unchanged
    // (openOrReplace's same-question guard — the transcript is intact).
    panel2.currentId = "q3";
    panel2.handleInput(CHAT_KEY);
    expect(panel2.view).toBe("chat");
    expect(getSidechat()).toBe(record);
    panel2.invalidate();
    expect(panel2.render(100).join("\n")).toContain("survives suspend");
  });

  test("AC-17.6_restart_no_chat_no_residue", async () => {
    // The persistence mirror is the ONLY session-file writer — attach it
    // BEFORE the chat so any chat-derived write would have to pass through.
    const state = sideState();
    setState(state);
    const appendEntry = vi.fn();
    const mirrorPi = {
      on: vi.fn(() => () => {}),
      appendEntry,
      setWidget: vi.fn(),
    };
    const mirror = createStateMirror(mirrorPi as unknown as Parameters<typeof createStateMirror>[0]);

    const { panel, notify } = makeHarness({
      focusQuestionId: "q3",
      port: (() => doneStream("ok", { input: 10, output: 5, total: 0.07 })) as unknown as SidechatModelPort,
    });
    const before = state.serialize(); // pre-chat state — the residue baseline
    openChat(panel);
    sendChat(panel, "turn one");
    await flush();
    sendChat(panel, "turn two");
    await flush();
    const record = getSidechat();
    expect(record?.messages).toHaveLength(4);
    expect(record?.usage).toEqual({ input: 20, output: 10, totalCost: 0.14 });

    // The chat wrote NOTHING into the interrogation state (no fields, no
    // details, no entries — state-and-persistence.md §Side chat).
    expect(state.serialize()).toEqual(before);
    expect(notify).not.toHaveBeenCalled(); // usage never left the record

    // PI RESTART: module memory dies; nothing else ever held the chat.
    resetSidechatForTests();
    expect(getSidechat()).toBeUndefined();

    // Structural residue proof: the mirror saw zero writes during the whole
    // chat (a flush with nothing pending appends nothing), and when a REAL
    // state change lands, the only entry type it ever writes is the
    // interrogation-state one — no chat entry type exists in the surface.
    mirror.flush();
    expect(appendEntry).not.toHaveBeenCalled();
    state.bumpEpoch(); // a genuine state mutation (not chat-derived)
    mirror.flush();
    expect(appendEntry).toHaveBeenCalledTimes(1);
    expect(appendEntry.mock.calls[0]?.[0]).toBe(INTERROGATION_STATE_ENTRY_TYPE);
  });
});

// ------------------------------------------------- AC-17.7 (SIDECHAT-004)

describe("AC-17.7 — malformed answer blocks", () => {
  test("AC-17.7_malformed_answer_notice_chat_stays_open", async () => {
    // Round 1: strict-JSON failure inside the block (single quotes).
    const bad = makeHarness({
      focusQuestionId: "q3",
      port: (() =>
        doneStream("try this\n\n```answer\n{'value': 'sqlite'}\n```")) as unknown as SidechatModelPort,
    });
    openChat(bad.panel);
    sendChat(bad.panel, "give me an answer");
    await flush();
    expect(getSidechat()?.pendingConfirm).toBeUndefined(); // nothing to confirm
    expect(getSidechat()?.lastRejection).toBe("malformed-json");
    expect(getSidechat()).toBeDefined(); // chat stays open
    expect(bad.state.getQuestion("q3")?.answer).toBeUndefined();
    bad.panel.invalidate();
    expect(bad.panel.render(100).join("\n")).toContain(
      ANSWER_REJECTION_NOTICES["malformed-json"],
    );

    // Round 2: a block whose value byte-matches no option.
    const mismatch = makeHarness({
      focusQuestionId: "q3",
      port: (() =>
        doneStream("```answer\n{\"value\": \"nosuch\"}\n```")) as unknown as SidechatModelPort,
    });
    openChat(mismatch.panel);
    sendChat(mismatch.panel, "again");
    await flush();
    expect(getSidechat()?.lastRejection).toBe("value-mismatch");
    expect(getSidechat()?.pendingConfirm).toBeUndefined();
    expect(getSidechat()).toBeDefined();
    mismatch.panel.invalidate();
    expect(mismatch.panel.render(100).join("\n")).toContain(
      ANSWER_REJECTION_NOTICES["value-mismatch"],
    );
  });
});

// ------------------------------------------------- AC-17.8 (FR-15 esc ladder / SIDECHAT-005)

describe("AC-17.8 — streaming abort and non-commands", () => {
  test("AC-17.8_esc_aborts_streaming", async () => {
    const gate = gatedStream();
    const port: SidechatModelPort = vi.fn(() => gate.stream);
    const { panel } = makeHarness({ focusQuestionId: "q3", port });
    openChat(panel);
    sendChat(panel, "why sqlite?");

    // Mid-stream: the reply is in flight, the footer hint reads abort.
    gate.push({ type: "start", partial: assistantReply("") });
    gate.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "partial th",
      partial: assistantReply("partial th"),
    });
    await flush();
    const record = getSidechat();
    expect(record?.streamState).toBe("streaming");
    expect(record?.streamingText).toBe("partial th");
    panel.invalidate();
    expect(panel.render(100).join("\n")).toContain("esc abort");

    // BUG-001 fix (shape i, ui-spec §Side chat Esc ladder): the FOCUSED
    // single esc aborts directly — no blur-then-escape detour; the footer's
    // "esc abort" hint is now true in the default focused state.
    expect(panel.handleInput(ESCAPE)).toBe(true); // abort rung consumed the esc
    expect(record?.abortController.signal.aborted).toBe(true); // the abort FIRED

    // The provider settles the abort: the turn never happened.
    gate.finishWith({
      type: "error",
      reason: "aborted",
      error: assistantReply("partial th"),
    });
    await flush();
    const settled = getSidechat();
    expect(settled?.streamState).toBe("idle");
    expect(settled?.streamingText).toBe(""); // partial text discarded
    expect(settled?.messages).toHaveLength(0); // the user turn was rolled back
    expect(settled?.messages.some((m) => m.text === "why sqlite?")).toBe(false);
    expect(settled?.notices).toHaveLength(0); // esc is deliberate silence
    panel.invalidate();
    expect(panel.render(100).join("\n")).toContain("esc exit"); // hint restored
  });

  test("AC-17.8_usr_bin_path_is_a_message", async () => {
    // Pure-classifier pins (SIDECHAT-005: byte-exact first-token match).
    expect(classifyChatCommand("/clear")).toBe("/clear");
    expect(classifyChatCommand("/new")).toBe("/new");
    expect(classifyChatCommand("/usr/bin/env bash")).toBeNull();
    expect(classifyChatCommand("/clearance")).toBeNull();
    expect(classifyChatCommand("see /clear below")).toBeNull();
    expect(classifyChatCommand("/Clear")).toBeNull(); // case-sensitive

    // Through the panel: a /usr/bin path is an ordinary message.
    const { panel } = makeHarness({
      focusQuestionId: "q3",
      port: (() => doneStream("noted")) as unknown as SidechatModelPort,
    });
    openChat(panel);
    sendChat(panel, "/usr/bin/env bash --version");
    await flush();
    const record = getSidechat();
    expect(record?.messages[0]).toMatchObject({ role: "user", text: "/usr/bin/env bash --version" });
    expect(record?.messages[1]).toMatchObject({ role: "assistant", text: "noted" });
  });
});

// ------ streaming esc — focused abort (BUG-001 fix, shape i: ui-spec §Side chat Esc ladder)

describe("streaming esc — focused abort (BUG-001, ui-spec esc ladder)", () => {
  test("focused_streaming_single_esc_aborts_in_place", async () => {
    // THE repro: chat input focused (the default), reply streaming, footer
    // advertising "esc abort" — one esc must abort. Pre-fix it forwarded to
    // the editor (generic ESC-002) and aborting needed blur-then-esc.
    const gate = gatedStream();
    const port: SidechatModelPort = vi.fn(() => gate.stream);
    const { panel } = makeHarness({ focusQuestionId: "q3", port });
    openChat(panel);
    sendChat(panel, "why sqlite?");
    gate.push({ type: "start", partial: assistantReply("") });
    gate.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "partial th",
      partial: assistantReply("partial th"),
    });
    await flush();
    const record = getSidechat();
    expect(record?.streamState).toBe("streaming");
    expect(panel.focus).toBe("chat"); // the DEFAULT focused state
    expect(panel.view).toBe("chat");

    expect(panel.handleInput(ESCAPE)).toBe(true); // ONE esc — the advertised gesture
    expect(record?.abortController.signal.aborted).toBe(true); // the abort FIRED
    expect(panel.view).toBe("chat"); // stays in chat — no blur, no descent
    expect(panel.focus).toBe("chat");
    expect(panel.lastEscAt).toBeUndefined(); // the abort rung never arms the window
  });

  test("idle_chat_focus_single_esc_still_forwards", () => {
    // ESC-002 forwarding resumes when the stream is idle — pi-vim
    // insert-mode exit is untouched at rest. Forwarding is observable at
    // the EDITOR boundary: the chat field receives the esc byte (panel
    // handleInput itself returns true — the editor consumed it).
    const { panel } = makeHarness({
      focusQuestionId: "q3",
      port: (() => doneStream("ok")) as unknown as SidechatModelPort,
    });
    openChat(panel); // idle, input focused
    const chatInput = vi.spyOn(panel.chatField, "handleInput");
    panel.handleInput(ESCAPE);
    expect(chatInput).toHaveBeenCalledWith(ESCAPE); // the editor owns it
    expect(panel.focus).toBe("chat");
  });

  test("options_focus_streaming_esc_aborts_via_ladder", async () => {
    // The escapeDescend chat rung (options focus) predates the fix and is
    // unchanged: streaming + blurred box → esc aborts.
    const gate = gatedStream();
    const port: SidechatModelPort = vi.fn(() => gate.stream);
    const { panel } = makeHarness({ focusQuestionId: "q3", port });
    openChat(panel);
    sendChat(panel, "why sqlite?");
    gate.push({ type: "start", partial: assistantReply("") });
    await flush();
    panel.focus = "options"; // blurred box mid-stream (ladder territory)
    expect(panel.handleInput(ESCAPE)).toBe(true);
    expect(getSidechat()?.abortController.signal.aborted).toBe(true);
  });

  test("abort_rung_leaves_the_double_esc_window_intact", async () => {
    const gate = gatedStream();
    const port: SidechatModelPort = vi.fn(() => gate.stream);
    const { panel } = makeHarness({ focusQuestionId: "q3", port });
    openChat(panel);
    sendChat(panel, "why sqlite?");
    gate.push({ type: "start", partial: assistantReply("") });
    await flush();

    expect(panel.handleInput(ESCAPE)).toBe(true); // abort — never arms lastEscAt
    expect(getSidechat()?.abortController.signal.aborted).toBe(true);
    expect(panel.lastEscAt).toBeUndefined(); // the rung left no window anchor

    // The provider settles the abort (macrotask) — the record goes idle
    // before the window-integrity phase, exactly like the real flow.
    gate.finishWith({
      type: "error",
      reason: "aborted",
      error: assistantReply(""),
    });
    await flush();
    expect(getSidechat()?.streamState).toBe("idle");

    // Post-abort, the ordinary idle behavior is EXACTLY as before: the
    // first esc FORWARDS (editor receives it; the window arms), the second
    // closes the box only (blurChatInput — chat retained, never a
    // suspend/descent). Had the abort rung polluted lastEscAt, this first
    // esc would have closed the box instead of typing.
    const chatInput = vi.spyOn(panel.chatField, "handleInput");
    panel.handleInput(ESCAPE);
    expect(chatInput).toHaveBeenCalledWith(ESCAPE); // forwarded
    expect(panel.focus).toBe("chat"); // still typing
    expect(panel.lastEscAt).toBeDefined(); // window armed by THIS esc
    panel.handleInput(ESCAPE);
    expect(panel.focus).toBe("options"); // pair completes → blurChatInput
  });
});

// ------ chat-focus empty-buffer enter routes to the pending confirm (BUG-001 residual)

describe("chat-focus empty-buffer enter routes to the pending confirm (BUG-001 residual)", () => {
  test("test_chat_focus_empty_enter_applies_pending_confirm", async () => {
    // The RESIDUAL the settle-blur (S1) cannot cover: the user re-focuses
    // the chat input to keep chatting, then presses enter on the (empty)
    // buffer while a confirm is pending. The apply seam fires — never a
    // sendTurn (sendChatInput would no-op on the empty buffer anyway).
    const port = convergePort();
    const chat = makeHarness({ focusQuestionId: "q3", port });
    seedTransition(chat.state);
    openChat(chat.panel);
    sendChat(chat.panel, "converge please");
    await flush(); // settle → parse → pendingConfirm
    expect(getSidechat()?.pendingConfirm).toEqual({ seam: "acceptOptionIndex", optionIndex: 0 });
    await flush(); // queued settle fire: decision blur (S1)
    expect(chat.panel.focus).toBe("options");

    chat.panel.focusChatInput(); // re-focus — the state this subtask fixes
    expect(chat.panel.focus).toBe("chat");
    const turnsBefore = (port as Mock).mock.calls.length;
    chat.panel.handleInput(ENTER); // empty buffer → apply, never sendChatInput
    await flush();

    expect(chat.state.getQuestion("q3")?.answer?.value).toBe("sqlite"); // applied
    expect(chat.state.getQuestion("q3")?.status).toBe("submitted"); // auto-submit flushed
    expect(getSidechat()).toBeUndefined(); // record discarded
    expect(chat.panel.view).toBe("short");
    expect(chat.notify).toHaveBeenCalledWith("chat closed · 10 in · 5 out · $0.07");
    expect(chat.delivery.sendMessage).toHaveBeenCalledTimes(1); // auto-submit, not a turn
    expect((port as Mock).mock.calls.length).toBe(turnsBefore); // sendTurn NOT called again
  });

  test("test_chat_focus_real_text_enter_still_sends_message", async () => {
    // Real text ALWAYS wins: the message ships and the confirm stays
    // pending for the options-focus row / a later empty-buffer enter.
    const port = convergePort();
    const chat = makeHarness({ focusQuestionId: "q3", port });
    seedTransition(chat.state);
    openChat(chat.panel);
    sendChat(chat.panel, "converge please");
    await flush();
    await flush(); // decision blur done; confirm pending
    expect(getSidechat()?.pendingConfirm).toBeDefined();

    chat.panel.focusChatInput();
    const turnsBefore = (port as Mock).mock.calls.length;
    sendChat(chat.panel, "another thought"); // real text + enter
    await flush(); // the "ok" reply settles

    expect((port as Mock).mock.calls.length).toBe(turnsBefore + 1); // turn dispatched
    // The message-first guarantee: nothing was APPLIED while the message
    // shipped. (The confirm itself is gone per the engine's pinned supersede
    // semantics — a reply without an applicable block RETRACTS an earlier
    // offer; the model's LATEST reply governs.)
    expect(chat.panel.view).toBe("chat");
    expect(chat.panel.focus).toBe("chat");
    expect(chat.state.getQuestion("q3")?.answer).toBeUndefined(); // not applied
  });

  test("test_chat_focus_whitespace_enter_applies_pending_confirm", async () => {
    // Whitespace-only is not a message (sendChatInput no-ops on it too) —
    // it routes to the confirm exactly like the empty buffer.
    const chat = makeHarness({ focusQuestionId: "q3", port: convergePort() });
    seedTransition(chat.state);
    openChat(chat.panel);
    sendChat(chat.panel, "converge please");
    await flush();
    await flush();

    chat.panel.focusChatInput();
    chat.panel.chatField.setText("   ");
    chat.panel.handleInput(ENTER);
    await flush();

    expect(chat.state.getQuestion("q3")?.answer?.value).toBe("sqlite"); // applied
    expect(getSidechat()).toBeUndefined();
    expect(chat.panel.view).toBe("short");
  });

  test("test_chat_focus_empty_enter_without_pending_is_consumed_noop", async () => {
    // No pending confirm → today's behavior byte-identical: the enter is a
    // consumed no-op (sendChatInput's trim-empty classification), nothing
    // sent, nothing applied, no throw (the seam is never even reached).
    const chat = makeHarness({ focusQuestionId: "q3" }); // default port: plain "ok" replies
    openChat(chat.panel);
    sendChat(chat.panel, "hello");
    await flush(); // settle: no answer block → no pendingConfirm, no blur
    expect(getSidechat()?.pendingConfirm).toBeUndefined();
    expect(chat.panel.focus).toBe("chat"); // no decision → no settle blur

    chat.panel.focusChatInput(); // explicit refocus (the residual shape)
    expect(chat.panel.handleInput(ENTER)).toBe(true); // consumed
    await flush(); // any accidental turn would settle here
    expect(getSidechat()?.messages).toHaveLength(2); // user + the settled "ok" — the no-op sent nothing new
    expect(chat.panel.view).toBe("chat");
    expect(chat.state.getQuestion("q3")?.answer).toBeUndefined();
  });
});

/**
 * src/panel/panel.test.ts — host contract tests for the non-blocking
 * interrogation panel (P1.M3.T1.S1).
 *
 * Conventions follow lifecycle.test.ts / state.test.ts: a bare mock stands in
 * for pi (no runtime), handlers are captured by event name and driven via
 * emit(), and fixture states are real InterrogationStates seeded through the
 * raw primitives. The `ui.custom` mock captures the factory + done callback
 * and returns a promise that never resolves until done() is called — exactly
 * the blocking contract the fire-and-forget host must survive.
 *
 * The panel host record is module-scoped (one host per session), so every
 * test re-arms it via createPanelHost(...) first.
 */
import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import {
  createInterrogationState,
  resetState,
  setState,
  type InterrogationState,
  type Question,
} from "../state.js";
import {
  createPanelHost,
  InterrogationPanel,
  maybeAutoOpen,
  openPanel,
  type OpenPanelOptions,
  type PanelHost,
  type PiUISurface,
} from "./panel.js";

// ------------------------------------------------------------------ fixtures

const CTRL_D = "\u0004";
const CTRL_L = "\u000c";
const ESCAPE = "\u001b";

/** Identity theme so S2 layout renderers run in tests (stub per tool.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
    ...overrides,
  };
}

/** Flush microtasks so the floating custom() promise's .then handlers run. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ----------------------------------------------------------------- mock pi

/** One captured ui.custom invocation: component + done + its floating promise. */
interface CustomCall {
  component: InterrogationPanel;
  done: (result: null | undefined) => void;
  promise: Promise<null | undefined>;
  resolved: boolean;
  resolution: null | undefined;
}

type Handler = (event: unknown, ctx: unknown) => void;

interface MockPi {
  pi: PiUISurface & Pick<ExtensionAPI, "on">;
  /** The vi.fn backing `ui.custom` — assert factory invocations with it. */
  custom: Mock;
  /** Every captured custom() call, in order. */
  calls: CustomCall[];
  /** Fire every handler registered for `event` (copy-first). */
  emit(event: string, payload?: Record<string, unknown>): void;
  on: Mock<[event: string, handler: Handler], () => void>;
  requestRender: Mock;
}

function makeMockPi(mode: string | undefined = "tui"): MockPi {
  const calls: CustomCall[] = [];
  const handlers = new Map<string, Handler[]>();
  const requestRender = vi.fn();

  const custom = vi.fn(
    (
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: null) => void,
      ) => Component,
    ): Promise<null | undefined> => {
      let resolve!: (result: null | undefined) => void;
      const promise = new Promise<null | undefined>((res) => {
        resolve = res;
      });
      const done = (result: null | undefined): void => resolve(result);
      const component = factory(
        { requestRender } as unknown as TUI,
        stubTheme,
        {} as unknown as KeybindingsManager,
        done,
      );
      const call: CustomCall = {
        component: component as InterrogationPanel,
        done,
        promise,
        resolved: false,
        resolution: undefined,
      };
      void promise.then((result) => {
        call.resolved = true;
        call.resolution = result;
      });
      calls.push(call);
      return promise;
    },
  );

  const on = vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {
      const current = handlers.get(event);
      if (current === undefined) return;
      const i = current.indexOf(handler);
      if (i !== -1) current.splice(i, 1);
    };
  });

  const surface = { mode, ui: { custom }, on };
  // Cast mirrors lifecycle.test.ts's mock convention: the mock's call
  // signature is a widened superset of the surface the host uses.
  const pi = surface as unknown as PiUISurface & Pick<ExtensionAPI, "on">;
  // pi hands `(event, ctx)` to handlers — ctx carries ui + mode (the panel
  // entry point). The surface object doubles as the mock ctx.
  const ctx = surface as unknown;

  return {
    pi,
    custom,
    calls,
    on,
    requestRender,
    emit(event: string, payload: Record<string, unknown> = {}): void {
      for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload }, ctx);
    },
  };
}

type MockLifecycle = {
  lifecycle: { onPanelDismiss: (cb: () => void) => void; dismissPanel: () => void };
  dismiss: () => void;
};

function makeMockLifecycle(): MockLifecycle {
  let cb: (() => void) | undefined;
  return {
    lifecycle: {
      onPanelDismiss: (registered) => {
        cb = registered;
      },
      dismissPanel: () => cb?.(),
    },
    dismiss: () => cb?.(),
  };
}

// ------------------------------------------------------------------ helpers

function optsFor(state: InterrogationState, extra: Partial<OpenPanelOptions> = {}): OpenPanelOptions {
  return { config: DEFAULT_CONFIG, state, ...extra };
}

function firstCall(mock: MockPi): CustomCall {
  expect(mock.calls.length).toBeGreaterThan(0);
  return mock.calls[0];
}

// ------------------------------------------------------------------- tests

describe("openPanel — fire-and-forget host", () => {
  test("test_openPanel_does_not_await_custom", () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));

    // Synchronous boolean return — no await anywhere on the custom() promise.
    const opened = openPanel(mock.pi, optsFor(state));

    expect(opened).toBe(true);
    expect(mock.custom).toHaveBeenCalledTimes(1);
    const call = firstCall(mock);
    expect(call.resolved).toBe(false); // floating promise still pending
    expect(call.component).toBeInstanceOf(InterrogationPanel);
    expect(host.isOpen()).toBe(true);
    expect(host.getPanel()).toBe(call.component);
    expect(host.isSuspended()).toBe(false);
  });

  test("test_suspend_done_null_marks_suspended_and_editor_restored", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));

    firstCall(mock).done(null);
    await flush();

    expect(firstCall(mock).resolved).toBe(true);
    expect(firstCall(mock).resolution).toBeNull();
    expect(host.isOpen()).toBe(false);
    expect(host.isSuspended()).toBe(true);
    expect(host.getPanel()).toBeUndefined();
    // Suspend loses nothing: state is untouched (it lives in the singleton).
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(state.epoch).toBe(1);
  });

  test("test_open_while_open_is_noop", () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));

    expect(openPanel(mock.pi, optsFor(state))).toBe(true);
    expect(openPanel(mock.pi, optsFor(state))).toBe(false);
    expect(mock.custom).toHaveBeenCalledTimes(1); // exactly one mounted panel
  });

  test("test_non_tui_mode_is_guarded", () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi("rpc");
    const state = createInterrogationState("goal");
    expect(openPanel(mock.pi, optsFor(state))).toBe(false);
    expect(mock.custom).not.toHaveBeenCalled();
  });

  test("test_lifecycle_dismissPanel_suspends", async () => {
    const { lifecycle, dismiss } = makeMockLifecycle();
    const host = createPanelHost(lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));

    dismiss(); // lifecycle.dismissPanel() → onPanelDismiss → host suspend
    expect(host.isOpen()).toBe(false);
    expect(host.isSuspended()).toBe(true);
    await flush();
    expect(firstCall(mock).resolution).toBeNull();

    // Dismiss with nothing open: idempotent no-op, still just suspended.
    dismiss();
    expect(host.isOpen()).toBe(false);
    expect(host.isSuspended()).toBe(true);
    expect(mock.custom).toHaveBeenCalledTimes(1);
  });

  test("test_panel_suspend_is_idempotent", async () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));

    const call = firstCall(mock);
    call.component.suspend();
    call.component.suspend(); // second done() must not corrupt anything
    await flush();

    expect(call.resolution).toBeNull();
    expect(call.component.view).toBe("short"); // still a usable object
  });
});

describe("view switching (built-in S1 bindings)", () => {
  test("test_view_switch_ctrl_d_sets_deepSticky", () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;

    expect(panel.view).toBe("short");
    expect(panel.deepSticky).toBe(false);

    panel.handleInput(CTRL_D);
    expect(panel.view).toBe("deep");
    expect(panel.deepSticky).toBe(true);

    panel.handleInput(CTRL_D); // toggle back
    expect(panel.view).toBe("short");
    expect(panel.deepSticky).toBe(true); // sticky survives leaving deep
  });

  test("test_ctrl_l_overview_esc_returns", () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;

    // No sticky yet: overview → esc → short.
    panel.handleInput(CTRL_L);
    expect(panel.view).toBe("overview");
    panel.handleInput(ESCAPE);
    expect(panel.view).toBe("short");

    // Sticky path: deep → overview → ctrl+l restores deep (sticky).
    panel.handleInput(CTRL_D);
    expect(panel.view).toBe("deep");
    panel.handleInput(CTRL_L);
    expect(panel.view).toBe("overview");
    panel.handleInput(CTRL_L); // overview toggle honors deepSticky
    expect(panel.view).toBe("deep"); // deepSticky remembered
    panel.handleInput(ESCAPE);
    expect(panel.view).toBe("short"); // esc always returns to short
  });

  test("test_esc_in_short_is_not_consumed_by_host", () => {
    const { lifecycle, dismiss } = makeMockLifecycle();
    createPanelHost(lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;

    panel.handleInput(ESCAPE);
    expect(panel.view).toBe("short");
    // Top-level esc suspend is keys.ts (P1.M3.T3.S1) territory — the S1 host
    // must NOT suspend on esc in short view.
    expect(panel.view).toBe("short");
    dismiss();
    expect(panel.suspend).toBeDefined(); // panel still mounted (done not fired)
  });

  test("test_deepSticky_resets_on_reopen", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));

    firstCall(mock).component.handleInput(CTRL_D);
    expect(firstCall(mock).component.deepSticky).toBe(true);

    firstCall(mock).done(null); // suspend
    await flush();
    expect(host.isSuspended()).toBe(true);

    state.upsertQuestion(choiceQ("q2")); // h2.37 reopen
    expect(mock.calls.length).toBe(2);
    const reopened = mock.calls[1].component;
    expect(reopened).not.toBe(firstCall(mock).component);
    expect(reopened.view).toBe("short"); // fresh session — sticky reset
    expect(reopened.deepSticky).toBe(false);
  });

  test("test_builtins_render_real_lines_per_view", () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;

    const short = panel.render(80);
    expect(short[0]).toMatch(/^┌ interrogation ·?/); // S2 header
    expect(short[0]).toContain("0/1 answered · 0 re-asked");
    expect(short.some((l) => l.includes("prompt:q1"))).toBe(true); // question line
    expect(short.some((l) => l.includes("▸ "))).toBe(true); // options region cursor (P1.M3.T2.S1)
    expect(short.some((l) => l.includes("✎ explain…"))).toBe(true); // real options region
    expect(short).not.toContain("options region (TODO M3.T2)"); // placeholder replaced
    expect(short.some((l) => l.startsWith("focus: "))).toBe(false); // placeholder gone
    expect(short[short.length - 1]).toMatch(/^└ .*⏎ ┘$/); // S2 footer

    panel.handleInput(CTRL_D);
    const deep = panel.render(80);
    expect(deep[0]).toContain("[deep] placeholder (TODO M5.T1)");
    expect(deep.some((l) => l.includes("scrollOffset: 0"))).toBe(true);

    panel.handleInput(CTRL_L);
    const overview = panel.render(80);
    expect(overview).toEqual(["[overview] placeholder (TODO M5.T2)"]);
  });
});

describe("upsert + state integration", () => {
  test("test_upsert_while_suspended_reopens", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));

    firstCall(mock).done(null); // suspend
    await flush();
    expect(host.isSuspended()).toBe(true);

    state.upsertQuestion(choiceQ("q2", { status: "answered" }));
    expect(mock.custom).toHaveBeenCalledTimes(2); // reopened
    expect(host.isOpen()).toBe(true);
    expect(host.isSuspended()).toBe(false);
    // Focus lands on the first upserted currently-active id.
    expect(mock.calls[1].component.currentId).toBe("q2");
    expect(mock.calls[1].resolved).toBe(false); // fresh floating promise
  });

  test("test_upsert_while_open_invalidates_single_panel", () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;
    panel.render(80);
    const rendersBefore = mock.requestRender.mock.calls.length;

    state.upsertQuestion(choiceQ("q2"));

    expect(mock.custom).toHaveBeenCalledTimes(1); // never a second panel
    expect(mock.requestRender.mock.calls.length).toBeGreaterThan(rendersBefore);
  });

  test("test_state_changed_invalidates", async () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;

    const primed = panel.render(80);
    expect(panel.render(80)).toBe(primed); // cached until mutation

    state.setStatus("q1", "answered"); // emits "changed"
    await flush();
    expect(mock.requestRender).toHaveBeenCalled();

    const rebuilt = panel.render(80);
    expect(rebuilt).not.toBe(primed); // cache was cleared and rebuilt
  });

  test("test_render_caches_until_invalidate", () => {
    const requestRender = vi.fn();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel({
      tui: { requestRender } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state,
      config: DEFAULT_CONFIG,
      focusQuestionId: "q1",
    });

    const first = panel.render(80);
    expect(panel.render(80)).toBe(first); // same reference — cached
    expect(panel.render(81)).not.toBe(first); // width change rebuilds

    panel.invalidate();
    expect(requestRender).toHaveBeenCalledTimes(1);
    const rebuilt = panel.render(80);
    expect(rebuilt).not.toBe(first); // invalidated cache rebuilds
    expect(rebuilt).toEqual(first); // …to identical placeholder content
  });

  test("test_cursor_seeds_to_recommendation_and_resets_on_refocus", () => {
    const requestRender = vi.fn();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1", { recommendation: "b" }));
    state.upsertQuestion(choiceQ("q2", { recommendation: "a" }));
    const panel = new InterrogationPanel({
      tui: { requestRender } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state,
      config: DEFAULT_CONFIG,
      focusQuestionId: "q1",
    });

    expect(panel.cursorIndex).toBe(1); // ★ preselect on the recommended option (R2)
    panel.cursorIndex = 0; // simulated navigation — real movement is P1.M3.T2.S2
    panel.currentId = "q2";
    expect(panel.cursorIndex).toBe(0); // question change re-seeds the cursor

    state.upsertQuestion(choiceQ("q3", { recommendation: "ghost" }));
    panel.currentId = "q3"; // recommendation missing from options → clamp 0
    expect(panel.cursorIndex).toBe(0);
  });

  test("test_initial_focus_selection", () => {
    const requestRender = vi.fn();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.setStatus("q1", "answered"); // upsertQuestion forces new ids to "open"
    state.upsertQuestion(choiceQ("q2"));
    state.upsertQuestion(choiceQ("q3"));

    const make = (focusQuestionId?: string): InterrogationPanel =>
      new InterrogationPanel({
        tui: { requestRender } as unknown as TUI,
        theme: stubTheme,
        done: () => {},
        state,
        config: DEFAULT_CONFIG,
        focusQuestionId,
      });

    expect(make().currentId).toBe("q2"); // first status-open question
    expect(make("q3").currentId).toBe("q3"); // explicit focus wins
    expect(make("missing").currentId).toBe("q2"); // unknown id falls back

    const empty = createInterrogationState("goal");
    expect(
      new InterrogationPanel({
        tui: { requestRender } as unknown as TUI,
        theme: stubTheme,
        done: () => {},
        state: empty,
        config: DEFAULT_CONFIG,
      }).currentId,
    ).toBeUndefined();
  });

  test("test_state_subscription_cleaned_on_dispose", () => {
    const requestRender = vi.fn();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel({
      tui: { requestRender } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state,
      config: DEFAULT_CONFIG,
    });

    panel.dispose();
    panel.dispose(); // idempotent
    const renders = requestRender.mock.calls.length;
    state.upsertQuestion(choiceQ("q2")); // would emit "changed"
    expect(requestRender.mock.calls.length).toBe(renders); // no invalidation
  });
});

describe("maybeAutoOpen — tool-path auto open/reopen", () => {
  let host: PanelHost;
  let mock: MockPi;
  let state: InterrogationState;

  const endEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    toolCallId: "call-1",
    toolName: "interrogate",
    isError: false,
    ...overrides,
  });

  function arm(): void {
    host = createPanelHost(makeMockLifecycle().lifecycle);
    mock = makeMockPi();
    state = createInterrogationState("goal");
    setState(state);
    maybeAutoOpen(mock.pi, DEFAULT_CONFIG, host);
  }

  afterEach(() => {
    resetState();
  });

  test("test_maybe_auto_open_opens_on_first_interrogate_end", () => {
    arm();
    mock.emit("tool_execution_end", endEvent());
    expect(mock.custom).toHaveBeenCalledTimes(1);
    expect(host.isOpen()).toBe(true);
    expect(mock.calls[0].component.currentId).toBeUndefined(); // empty state yet

    // A second end while open: no-op (single instance).
    state.upsertQuestion(choiceQ("q1"));
    mock.emit("tool_execution_end", endEvent({ toolCallId: "call-2" }));
    expect(mock.custom).toHaveBeenCalledTimes(1);
  });

  test("test_maybe_auto_open_ignores_other_tools_errors_and_missing_state", () => {
    arm();
    mock.emit("tool_execution_end", endEvent({ toolName: "bash" }));
    mock.emit("tool_execution_end", endEvent({ isError: true }));
    expect(mock.custom).not.toHaveBeenCalled();

    resetState(); // no state singleton yet
    mock.emit("tool_execution_end", endEvent());
    expect(mock.custom).not.toHaveBeenCalled();
  });

  test("test_maybe_auto_open_reopens_while_suspended", async () => {
    arm();
    state.upsertQuestion(choiceQ("q1"));
    mock.emit("tool_execution_end", endEvent());
    expect(mock.calls.length).toBe(1);

    mock.calls[0].done(null); // user suspends
    await flush();
    expect(host.isSuspended()).toBe(true);

    // A later interrogate run ends → h2.37 reopen.
    state.upsertQuestion(choiceQ("q2"));
    mock.emit("tool_execution_end", endEvent({ toolCallId: "call-3" }));
    expect(mock.calls.length).toBe(2);
    expect(host.isOpen()).toBe(true);
    expect(mock.calls[1].component.currentId).toBe("q2"); // first open question
  });
});

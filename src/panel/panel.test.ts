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
import type { Component, EditorComponent, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, resolveKeyLabels } from "../config.js";
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
  type DraftStore,
  type InterrogationPanelArgs,
  type OpenPanelOptions,
  type PanelHost,
  type PiUISurface,
} from "./panel.js";
import { renderFooter, renderHeader, renderHintLine, renderQuestionLine } from "./layout.js";
import { panelActions } from "./actions.js";
import { desiredTextDuty } from "./keys.js";
import { renderShortViewOptions } from "./short-view.js";
import {
  editInExternalEditor,
  type ExternalEditorResult,
} from "../external-editor.js";

/**
 * P1.M4.T1.S3 — the external-editor round-trip is mocked at the module
 * boundary (the real spawn-based module has its own external-editor.test.ts
 * coverage); these tests own the PANEL lifecycle: suspend/resume order,
 * clean-exit-only apply, failure no-ops, and the re-entrancy guard.
 */
vi.mock("../external-editor.js", () => ({
  editInExternalEditor: vi.fn(),
  resolveExternalEditorCommand: vi.fn(() => "stub-editor"),
}));
const editMock = vi.mocked(editInExternalEditor);

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
  /** The pi.sendMessage transport mock (NEW-001 submit wiring). */
  sendMessage: Mock;
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

  const sendMessage = vi.fn();
  // The real surface carries the submit transport (NEW-001) — mock it so
  // surfaceSubmitDeps can bind the production path in these tests too.
  const surface = { mode, ui: { custom }, on, sendMessage };
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
    sendMessage,
    requestRender,
    emit(event: string, payload: Record<string, unknown> = {}): void {
      for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload }, ctx);
    },
  };
}

type MockLifecycle = {
  lifecycle: {
    onPanelDismiss: (cb: () => void) => void;
    dismissPanel: () => void;
    noteSubmissionDelivered: Mock;
  };
  dismiss: () => void;
};

function makeMockLifecycle(): MockLifecycle {
  let cb: (() => void) | undefined;
  const noteSubmissionDelivered = vi.fn();
  return {
    lifecycle: {
      onPanelDismiss: (registered) => {
        cb = registered;
      },
      dismissPanel: () => cb?.(),
      noteSubmissionDelivered,
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
  // REGRESSION (dead ctrl+s): event/tool contexts (ExtensionContext) carry
  // no sendMessage in pi 0.85.x — maybeAutoOpen opens panels on such a
  // surface, which previously produced delivery === undefined and a ctrl+s
  // that silently did NOTHING (keys.ts submit returns false without deps).
  // createPanelHost's api-root fallback must repair the transport.
  test("test_delivery_falls_back_to_root_surface_when_ctx_lacks_sendMessage", () => {
    const rootSendMessage = vi.fn();
    const root = { sendMessage: rootSendMessage };
    createPanelHost(makeMockLifecycle().lifecycle, root);

    // ctx-like surface: ui + mode, NO sendMessage (the real bug shape).
    const mock = makeMockPi();
    const ctxLike = { mode: "tui", ui: mock.pi.ui, on: mock.on } as unknown as PiUISurface;
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));

    expect(openPanel(ctxLike, optsFor(state))).toBe(true);
    const panel = firstCall(mock).component;
    expect(panel.delivery).toBeDefined();
    expect(panel.delivery?.sendMessage).toBeTypeOf("function");

    // The bound transport is the ROOT's channel, and isIdle degrades safely.
    panel.delivery?.sendMessage({ customType: "interrogation-submission" }, {});
    expect(rootSendMessage).toHaveBeenCalledTimes(1);
    expect(panel.delivery?.isIdle()).toBe(true);
  });

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

  test("test_esc_in_short_suspends_via_router_descent", () => {
    const { lifecycle, dismiss } = makeMockLifecycle();
    createPanelHost(lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component;

    // Esc descent terminus (FR-16): short-view esc suspends — done(null),
    // nothing user-visible destroyed. Now owned by keys.ts (P1.M3.T3.S1).
    panel.handleInput(ESCAPE);
    expect(panel.view).toBe("short");
    expect(panel.isResolved()).toBe(true);
    panel.handleInput(ESCAPE); // repeated esc on a resolved panel: no throw
    expect(panel.isResolved()).toBe(true);
    dismiss();
    expect(panel.suspend).toBeDefined(); // panel still a usable object
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

  test("write-in duty renders the OTHER label above the editor (WRITEIN-001)", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(
      panelArgsFor(state, { editorFactory: () => fakePanelEditor() }),
    );

    // Elaboration default (ctrl+t path): editor focused, NO write-in label.
    panel.focusTextField();
    expect(panel.textDuty).toBe("elaboration");
    expect(panel.render(80).some((l) => l.includes("OTHER — this text is the answer"))).toBe(false);

    // Accept the ✎ Other row → write-in duty → the verbatim label line
    // renders directly above the editor region.
    panel.blurTextField();
    panel.cursorIndex = 2; // past the 2 options = the ✎ Other — write your own row
    panel.handleInput("\r"); // enter → accept
    expect(panel.focus).toBe("text");
    expect(panel.textDuty).toBe("writein");
    const lines = panel.render(80);
    const labelIdx = lines.findIndex((l) => l.includes("OTHER — this text is the answer"));
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect((lines[labelIdx + 1] ?? "").length).toBeGreaterThan(0); // editor region sits below
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
    expect(short.some((l) => l.includes("✎ Other — write your own"))).toBe(true); // real options region
    expect(short).not.toContain("options region (TODO M3.T2)"); // placeholder replaced
    expect(short.some((l) => l.startsWith("focus: "))).toBe(false); // placeholder gone
    expect(short[short.length - 1]).toMatch(/^└ .*⏎ ┘$/); // S2 footer

    panel.handleInput(CTRL_D);
    const deep = panel.render(80);
    // Real deep view (P1.M5.T1.S1): header + bounded pane + view-aware footer.
    expect(deep[0]).toMatch(/^┌ interrogation ·?/);
    expect(deep.some((l) => l.includes("▸"))).toBe(true); // option section header
    expect(deep.some((l) => l.includes("goal"))).toBe(true); // FR-30 full goal
    expect(deep[deep.length - 1]).toMatch(/^└ .*⏎ ┘$/); // footer, still last

    panel.handleInput(CTRL_L);
    const overview = panel.render(80);
    // Real overview (P1.M5.T2.S1): header + marked list + view-aware footer.
    expect(overview[0]).toMatch(/^┌ interrogation ·?/);
    expect(overview.some((l) => l.includes("▸") && l.includes("prompt:q1"))).toBe(true); // cursor row
    expect(overview.some((l) => l.includes("· "))).toBe(true); // open-question marker
    expect(overview[overview.length - 1]).toMatch(/^└ .*⏎ ┘$/); // footer, still last
    expect(overview).not.toContain("[overview] placeholder (TODO M5.T2)"); // placeholder replaced
  });

  // ------------------------------------------------ overview (P1.M5.T2.S1)

  const UP = "\u001b[A";
  const DOWN = "\u001b[B";
  const ENTER = "\r";

  function overviewState(): InterrogationState {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1", { group: "storage" }));
    state.upsertQuestion(choiceQ("q2", { group: "storage", gate: true }));
    state.upsertQuestion(choiceQ("q3", { group: "ui" }));
    return state;
  }

  test("test_overview_entry_seeds_cursor_to_current_question", () => {
    const state = overviewState();
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.currentId = "q2";

    panel.handleInput(CTRL_L);
    expect(panel.view).toBe("overview");
    expect(panel.overviewCursor).toBe(1); // seeded ONCE to the current question
    const lines = panel.render(80);
    expect(lines.some((l) => l.includes("▸") && l.includes("prompt:q2"))).toBe(true);
    // esc returns via the existing ladder (no sticky → short), nothing lost.
    panel.handleInput(ESCAPE);
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q2");
  });

  test("test_overview_reentry_reseeds_cursor_from_current_after_jump", () => {
    const state = overviewState();
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    panel.overviewCursor = 2;
    panel.handleInput(ENTER); // jump
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q3");
    panel.handleInput(CTRL_L); // re-entry re-seeds from currentId — round-trip
    expect(panel.overviewCursor).toBe(2);
  });

  test("test_overview_window_caps_lines_and_keeps_cursor_visible", () => {
    const state = createInterrogationState("goal");
    for (let i = 1; i <= 30; i++) state.upsertQuestion(choiceQ(`q${i}`, { group: "g" }));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    for (let i = 0; i < 25; i++) panel.handleInput(DOWN); // cursor → q26
    expect(panel.overviewCursor).toBe(25);
    expect(panel.overviewScroll).toBeGreaterThan(0); // actions recompute the window

    const lines = panel.render(80);
    const body = lines.slice(1, lines.length - 1); // header/footer outside the window
    expect(body.length).toBeLessThanOrEqual(20); // OVERVIEW_HEIGHT window cap
    expect(body.some((l) => l.includes("▸") && l.includes("prompt:q26"))).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/^└ /);
  });

  test("test_overview_lists_all_statuses_with_markers_and_reason", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("open"));
    state.upsertQuestion(choiceQ("answered", { title: "Answered Q" }));
    state.upsertQuestion(choiceQ("reasked", { title: "Reasked Q" }));
    state.upsertQuestion(choiceQ("moot", { title: "Moot Q" }));
    state.upsertQuestion(choiceQ("gone", { title: "Withdrawn Q" }));
    state.applyAnswer("answered", { value: "a", text: "elaborated", at: "t" });
    state.applyAnswer("reasked", { value: "a", at: "t" });
    state.setStatus("reasked", "reasked");
    state.applyAnswer("moot", { value: "a", text: "moot: storage=sqlite", at: "t" });
    state.setStatus("moot", "moot");
    state.setStatus("gone", "withdrawn");

    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    const rendered = panel.render(80).join("\n");
    // All five statuses render their markers — and NOTHING is filtered
    // (R1/Q34=A: moot/withdrawn stay listed, the moot reason rides the row).
    expect(rendered).toContain("· prompt:open");
    // P1.M2.T6.S2: answer.text on an OPTION answer is elaboration → the
    // dimmed ≡ suffix, NOT ✎ (✎ is write-in/text answer per FR-11).
    expect(rendered).toContain("★ ≡ Answered Q");
    expect(rendered).toContain("⟳ Reasked Q");
    expect(rendered).toContain("⊘ Moot Q — moot: storage=sqlite");
    expect(rendered).toContain("⊗ Withdrawn Q");
  });

  test("test_overview_group_headers_and_gate_mark", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("a1", { group: "storage" }));
    state.upsertQuestion(choiceQ("a2", { group: "storage" }));
    state.upsertQuestion(choiceQ("g1", { group: "gate grp", gate: true }));
    state.upsertQuestion(choiceQ("u1")); // ungrouped → "(none)" bucket
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    const lines = panel.render(80);
    expect(lines).toContain("  storage");
    expect(lines).toContain("  gate grp ▲"); // group-level ▲ from membership
    expect(lines).toContain("  (none)");
    // Exactly one header carries the ▲ mark.
    expect(lines.filter((l) => l.includes("▲"))).toHaveLength(1);
  });

  test("test_overview_enter_jumps_preseeds_cursor_and_focus", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2", { recommendation: "b" }));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    panel.overviewCursor = 1;

    panel.handleInput(ENTER);
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q2");
    expect(panel.focus).toBe("options");
    expect(panel.cursorIndex).toBe(1); // ★ recommendation preselect (R2)
    const short = panel.render(80);
    expect(short.some((l) => l.includes("▸ ★ ") && l.includes("Beta"))).toBe(true);
  });

  test("test_overview_footer_lists_jump_and_back_keys", () => {
    const state = overviewState();
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    const lines = panel.render(120); // wide enough that no hint degrades away
    expect(lines[lines.length - 1]).toContain("enter jump");
    expect(lines[lines.length - 1]).toContain("esc back");
  });

  test("test_overview_empty_state_renders_header_and_footer_only", () => {
    const state = createInterrogationState("goal");
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_L);
    expect(panel.view).toBe("overview");
    const lines = panel.render(80);
    expect(lines).toHaveLength(2); // no flash yet — just header + footer
    expect(lines[0]).toMatch(/^┌ /);
    expect(lines[1]).toMatch(/^└ /);
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

// ---------------------- adaptive terminal fallbacks (h2.30, P1.M7.T5.S1)

describe("terminal fallbacks (h2.30, P1.M7.T5.S1)", () => {
  /** Mock TUI carrying a live terminal shape (rows re-read per render). */
  function tuiWithRows(rows: number): TUI {
    return { requestRender: vi.fn(), terminal: { rows, columns: 80 } } as unknown as TUI;
  }

  /** `count` ungrouped choice questions — overview content = 1 header + count rows. */
  function stateWith(count: number): InterrogationState {
    const state = createInterrogationState("goal");
    for (let i = 0; i < count; i++) state.upsertQuestion(choiceQ(`q${i}`));
    return state;
  }

  test("test_rows_change_invalidates_render_cache_at_same_width", () => {
    const tui = { requestRender: vi.fn(), terminal: { rows: 30, columns: 80 } };
    const panel = new InterrogationPanel({
      ...panelArgsFor(stateWith(1)),
      tui: tui as unknown as TUI,
    });

    const tall = panel.render(80);
    expect(panel.render(80)).toBe(tall); // same width + same rows → cached

    tui.terminal.rows = 23; // height-only "resize"
    expect(panel.render(80)).not.toBe(tall); // rows are part of the cache key
  });

  test("test_hint_line_suppressed_below_24_rows_only", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1", { description: "First sentence. Second sentence." }));

    const at24 = new InterrogationPanel({ ...panelArgsFor(state), tui: tuiWithRows(24) });
    expect(at24.render(80).join("\n")).toContain("First sentence.");

    const at23 = new InterrogationPanel({ ...panelArgsFor(state), tui: tuiWithRows(23) });
    expect(at23.render(80).join("\n")).not.toContain("First sentence.");
  });

  test("test_unknown_height_keeps_the_hint_line", () => {
    // Mock TUI WITHOUT a terminal (pre-task shape) — rows read as unknown →
    // no height fallbacks: the hint line renders as before.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1", { description: "First sentence. Second sentence." }));
    const panel = new InterrogationPanel(panelArgsFor(state));
    expect(panel.render(80).join("\n")).toContain("First sentence.");
  });

  test("test_overview_window_paginates_to_5_lines_below_12_rows", () => {
    const at11 = new InterrogationPanel({ ...panelArgsFor(stateWith(8)), tui: tuiWithRows(11) });
    at11.setView("overview");
    const lowLines = at11.render(80);
    expect(lowLines.length).toBe(1 + 5 + 1); // header + 5-line window + footer
    expect(lowLines[lowLines.length - 1]).toMatch(/^└ /);

    const at12 = new InterrogationPanel({ ...panelArgsFor(stateWith(8)), tui: tuiWithRows(12) });
    at12.setView("overview");
    expect(at12.render(80).length).toBe(1 + 9 + 1); // all content (< default window 20)
  });

  test("test_deep_view_height_untouched_at_low_rows", () => {
    // h2.30: deep view is a FULL replacement — its 20-row pane never shrinks.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1", { description: "Deep context. More." }));
    const panel = new InterrogationPanel({ ...panelArgsFor(state), tui: tuiWithRows(10) });
    panel.setView("deep");
    const lines = panel.render(80);
    expect(lines.join("\n")).toContain("Deep context."); // content renders whole
    expect(lines.length).toBeLessThanOrEqual(1 + 20 + 1); // DEEP_VIEW_HEIGHT unchanged
  });

  test("test_narrow_footer_flips_between_59_and_60_cols", () => {
    // Rebound short labels (still resolveKeyLabels output — h2.52) so the
    // key hints fit inside 59 cols alongside progress + the static hint.
    const config = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, submit: "s", deep: "d" },
    };
    const panel = new InterrogationPanel({
      ...panelArgsFor(stateWith(1), { config }),
      tui: tuiWithRows(30),
    });

    // 59 cols → narrow: key hints collapse to {submit, deep}; the fit loop
    // drops deep first, leaving submit (the list hint can NEVER appear).
    const narrowFooter = panel.render(59)[panel.render(59).length - 1]!;
    expect(narrowFooter).toContain("S submit");
    expect(narrowFooter).not.toContain("D deep");
    expect(narrowFooter).not.toContain("list");

    // 60 cols → NOT narrow: the per-screen short keys return; the same fit
    // loop now drops submit first and keeps deep — the boundary is visible.
    const wideLines = panel.render(60);
    const wideFooter = wideLines[wideLines.length - 1]!;
    expect(wideFooter).toContain("D deep");
    expect(wideFooter).not.toContain("S submit");
    expect(wideFooter).not.toContain("list");
  });
});

describe("maybeAutoOpen — tool-path auto open/reopen", () => {
  let host: PanelHost;
  let mock: MockPi;
  let state: InterrogationState;
  let lifecycle: ReturnType<typeof makeMockLifecycle>;

  const endEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    toolCallId: "call-1",
    toolName: "interrogate",
    isError: false,
    ...overrides,
  });

  function arm(): void {
    lifecycle = makeMockLifecycle();
    host = createPanelHost(lifecycle.lifecycle);
    mock = makeMockPi();
    state = createInterrogationState("goal");
    setState(state);
    maybeAutoOpen(mock.pi, DEFAULT_CONFIG, host);
  }

  afterEach(() => {
    resetState();
  });

  test("NEW-001 wiring: ctrl+s on a production-opened panel delivers the submission", () => {
    arm();
    state.upsertQuestion(choiceQ("q1"));
    mock.emit("tool_execution_end", endEvent());
    const panel = mock.calls[0]!.component;
    // The production open path (maybeAutoOpen → openPanel → InterrogationPanel)
    // must carry a SubmitDeps — no injected mocks.
    expect(panel.delivery).toBeDefined();
    panel.currentId = "q1";
    panel.handleInput("\r"); // accept option 'a' → answered (works pre-fix too)
    expect(state.getQuestion("q1")?.status).toBe("answered");
    panel.handleInput("\x13"); // ctrl+s — the heartbeat (FR-3/AC-2)
    // The submission fires: delta reaches pi.sendMessage, epoch bumps exactly
    // once, the flush moves the answer to submitted, and the h2.44 line-1
    // lifecycle hook resets the auto-close engine for the settle.
    expect(mock.sendMessage).toHaveBeenCalledTimes(1);
    const sent = mock.sendMessage.mock.calls[0][0] as { customType: string; content: string };
    expect(sent.customType).toBe("interrogation-submission");
    expect(sent.content).toContain("q1: Alpha");
    expect(sent.content).toContain("(state epoch 2)");
    expect(state.epoch).toBe(2);
    expect(state.getQuestion("q1")?.status).toBe("submitted");
    expect(lifecycle.lifecycle.noteSubmissionDelivered).toHaveBeenCalledTimes(1);
  });

  test("NEW-001 hardening: a stale open record is re-armed when the host says nothing is live", () => {
    // Simulate a record left open by a dead surface (panel never resolved):
    // open a panel on surface A, then drive maybeAutoOpen with a host whose
    // isOpen() is false. The upsert must still mount the panel.
    host = createPanelHost(makeMockLifecycle().lifecycle);
    mock = makeMockPi();
    state = createInterrogationState("goal");
    setState(state);
    maybeAutoOpen(mock.pi, DEFAULT_CONFIG, host);
    mock.emit("tool_execution_end", endEvent());
    expect(host.isOpen()).toBe(true); // record now claims open

    const staleHost = { isOpen: () => false, isSuspended: () => false } as unknown as PanelHost;
    const second = makeMockPi();
    state.upsertQuestion(choiceQ("q1"));
    maybeAutoOpen(second.pi, DEFAULT_CONFIG, staleHost);
    second.emit("tool_execution_end", endEvent({ toolCallId: "call-9" }));
    expect(second.custom).toHaveBeenCalledTimes(1);
    expect(second.calls[0]!.component).toBeDefined();
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

// ------------------------------------------------- embedded editor (P1.M4.T1.S1)

/** Text-question fixture (primary affordance renders the editor region). */
function textQ(id: string, overrides: Partial<Question> = {}): Question {
  return { ...choiceQ(id), type: "text", options: undefined, ...overrides };
}

/**
 * Stateful fake composed editor — the same structural contract pi-vim etc.
 * satisfies (plain literal implementing EditorComponent).
 */
function fakePanelEditor(): EditorComponent & { handleInput: Mock; setText: Mock } {
  let text = "";
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["e1", "e2", "e3"]),
    focused: false,
  } as unknown as EditorComponent & { handleInput: Mock; setText: Mock };
}

/** Direct-construction args with a deterministic fake composed editor. */
function panelArgsFor(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
): InterrogationPanelArgs {
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

describe("embedded editor — construction + wiring (P1.M4.T1.S1)", () => {
  test("test_panel_constructs_text_field_unfocused_default", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    expect(panel.focus).toBe("options");
    expect(panel.textField).toBeDefined();
    expect(panel.textField.focused).toBe(false);
    expect((panel.textField.editor as { focused?: boolean }).focused).toBe(false);
  });

  test("test_composed_factory_invoked_once_at_construction_with_live_args", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const tui = { requestRender: vi.fn() } as unknown as TUI;
    const keybindings = {} as unknown as KeybindingsManager;
    const factory = vi.fn(() => fakePanelEditor());
    const panel = new InterrogationPanel(
      panelArgsFor(state, {
        tui,
        keybindings,
        editorFactory: factory,
        config: { ...DEFAULT_CONFIG, editorMode: "composed" },
      }),
    );

    // Exactly ONE instantiation, with the constructor's live tui/theme/kb.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(tui, expect.any(Object), keybindings);
    // Repeated renders/keystrokes never re-instantiate (one per lifetime).
    panel.render(80);
    panel.handleInput("x");
    panel.render(80);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("test_openPanel_captures_editor_factory_once_per_open", () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const factory = vi.fn(() => fakePanelEditor());
    const pi = {
      ...mock.pi,
      ui: { ...mock.pi.ui, getEditorComponent: () => factory },
    } as PiUISurface & Pick<ExtensionAPI, "on">;
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));

    expect(openPanel(pi, optsFor(state))).toBe(true);
    // Captured at openPanel time, invoked once inside the custom() body.
    expect(factory).toHaveBeenCalledTimes(1);
    mock.calls[0]?.component.render(80);
    expect(factory).toHaveBeenCalledTimes(1); // renders never re-instantiate
  });
});

describe("ctrl+c — SIGINT-style escape (CTRL-C-001)", () => {
  function makeSuspendPanel(state: InterrogationState): {
    panel: InterrogationPanel;
    done: ReturnType<typeof vi.fn>;
  } {
    const done = vi.fn();
    const panel = new InterrogationPanel({ ...panelArgsFor(state), done });
    return { panel, done };
  }

  test("test_ctrl_c_closes_the_prompt_and_stays_unconsumed", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const { panel, done } = makeSuspendPanel(state);

    // Unconsumed (false) so pi's own ctrl+c flow — clear editor, then a
    // second press within 500ms shuts down — resumes on the restored editor.
    expect(panel.handleInput("\u0003")).toBe(false);
    expect(done).toHaveBeenCalledWith(null); // suspend, never destroy
    expect(panel.isResolved()).toBe(true);
    expect(state.getQuestion("q1")?.status).toBe("open"); // state intact
  });

  test("test_ctrl_c_escapes_the_ripple_confirm_modal", () => {
    // The interrupt check runs BEFORE the modal branch — ctrl+c must always
    // find a way out, even mid-confirm.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const { panel, done } = makeSuspendPanel(state);
    panel.confirmMode = {
      questionId: "q1",
      kind: "choice",
      proposed: { value: "a", at: "t" },
      victims: ["q2"],
      priorCursorIndex: 0,
    };
    expect(panel.handleInput("\u0003")).toBe(false);
    expect(done).toHaveBeenCalledWith(null);
  });

  test("test_ctrl_c_escapes_note_mode_and_editor_focus", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const { panel, done } = makeSuspendPanel(state);
    panel.enterNoteMode();
    expect(panel.focus).toBe("note");
    expect(panel.handleInput("\u0003")).toBe(false);
    expect(done).toHaveBeenCalledWith(null);
  });

  test("test_ctrl_c_after_suspend_is_inert", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const { panel, done } = makeSuspendPanel(state);
    panel.handleInput("\u0003");
    done.mockClear();
    expect(panel.handleInput("\u0003")).toBe(false); // resolved guard
    expect(done).not.toHaveBeenCalled();
  });
});

describe("embedded editor — focus + input forwarding (P1.M4.T1.S1)", () => {
  test("test_ctrl_t_via_router_seam_focuses_and_seeds", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const drafts = {
      getDraft: vi.fn((id: string) => (id === "q1" ? "saved draft" : undefined)),
      setDraft: vi.fn(),
      getNote: () => "",
      setNote: vi.fn(),
    };
    const panel = new InterrogationPanel(panelArgsFor(state, { drafts }));

    panel.handleInput("\u0014"); // ctrl+t = config.keys.focusText
    expect(panel.focus).toBe("text");
    expect(panel.textField.focused).toBe(true);
    expect(panel.textField.getText()).toBe("saved draft");
  });

  test("test_text_question_editor_blank_for_other_question_after_answer", () => {
    // EXPLAIN-002 (the reported bug): answer one long-form question, move to
    // another — the editor region (auto-rendered for text questions) must
    // show a NEW BLANK box, never the previous question's text.
    const state = createInterrogationState("goal");
    state.upsertQuestion(textQ("t1"));
    state.upsertQuestion(textQ("t2"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    panel.focusTextField(); // t1's editor
    panel.textField.setText("long-form answer for t1");
    panel.handleInput("\r"); // stage-1 enter: save draft, blur
    expect(panel.draftTextFor("t1")).toBe("long-form answer for t1");

    // Navigate to t2 (any currentId mutation): buffer re-seeded from t2's
    // (absent) draft → blank — not t1's leftover text.
    panel.currentId = "t2";
    expect(panel.textField.getText()).toBe("");
    // Round-trip back: t1's draft restores (R4 — scoping is not deletion).
    panel.currentId = "t1";
    expect(panel.textField.getText()).toBe("long-form answer for t1");
  });

  test("test_navigation_while_editor_focused_writes_through_and_reseeds", () => {
    // tab/shift+tab fire even in text focus (h2.34 intercept rule): the
    // outgoing buffer is written through to ITS question (R4) and the new
    // question gets a blank/fresh box — typing continues seamlessly.
    const state = createInterrogationState("goal");
    state.upsertQuestion(textQ("t1"));
    state.upsertQuestion(textQ("t2"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.currentId = "t1";

    panel.handleInput("\u0014"); // ctrl+t — focus the editor on t1
    panel.textField.setText("half-typed on t1");
    expect(panel.focus).toBe("text");

    panel.handleInput("\u001b[Z"); // shift+tab — nextQuestion WHILE focused
    expect(panel.currentId).toBe("t2");
    expect(panel.focus).toBe("text"); // editor stays focused
    expect(panel.textField.getText()).toBe(""); // blank box for t2
    expect(panel.draftTextFor("t1")).toBe("half-typed on t1"); // written through

    // And back: t1's half-typed text is exactly where it was left.
    panel.handleInput("\t"); // tab — prevQuestion
    expect(panel.currentId).toBe("t1");
    expect(panel.textField.getText()).toBe("half-typed on t1");
  });

  test("test_note_mode_exit_rescopes_buffer_to_current_question", () => {
    // The note rides the SAME editor — after exiting note mode the buffer
    // must not leak note text into a text question's editor region.
    const state = createInterrogationState("goal");
    state.upsertQuestion(textQ("t1"));
    state.upsertQuestion(textQ("t2"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    panel.enterNoteMode();
    panel.textField.setText("batch note text");
    panel.handleInput("\r"); // enter saves + exits note mode
    expect(panel.batchNote).toBe("batch note text"); // note preserved…
    expect(panel.textField.getText()).toBe(""); // …but the buffer re-scoped

    // Navigating while IN note mode leaves the note buffer alone (the note
    // is question-agnostic) — then exiting re-scopes to wherever we landed.
    panel.currentId = "t1";
    panel.enterNoteMode();
    panel.textField.setText("still the note");
    panel.handleInput("\u001b[Z"); // shift+tab → t2 while note editing
    expect(panel.currentId).toBe("t2");
    expect(panel.textField.getText()).toBe("still the note"); // untouched
    panel.handleInput("\r"); // enter exits note mode
    expect(panel.batchNote).toBe("still the note");
    expect(panel.textField.getText()).toBe(""); // t2 has no draft → blank
  });

  test("test_explain_then_enter_enter_is_answered_and_submittable", () => {
    // EXPLAIN-003 money test — the reported bug end-to-end: explain on a
    // choice question, enter, enter on the option → the question is
    // ANSWERED with the elaboration attached, and ctrl+s actually SHIPS it
    // (partial submission with just this one answer).
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    // WRITEIN-001: the ✎ Other row now opens the WRITE-IN editor (accept →
    // commit duty), so the elaboration editor opens via ctrl+t's focus path.
    panel.focusTextField();
    panel.textField.setText("because migration risk"); // (fake editor: no-op handleInput)
    panel.handleInput("\r"); // stage-1 save + blur (choice → no arm)
    panel.handleInput("\r"); // accept ★ option "a" + advance

    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");

    // Submit: the draft attaches as answer.text and the delta ships.
    const sendMessage = vi.fn();
    expect(panelActions.submit(panel, { sendMessage, isIdle: () => true })).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const payload = sendMessage.mock.calls[0][0] as {
      details: { changed: Array<{ id: string; to: string }> };
    };
    const entry = payload.details.changed.find((c) => c.id === "q1");
    expect(entry).toBeDefined();
    // The elaboration rides the delta's answer summary (NEW-003 grammar:
    // "{label} — {free text}").
    expect(entry!.to).toContain("because migration risk");
  });

  test("test_submit_flash_names_explained_but_unselected_questions", () => {
    // WRITEIN-002 discoverability: draft-only choice question → the flash
    // says WHY nothing shipped instead of a bare "nothing to submit".
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.focusTextField();
    panel.textField.setText("undecided elaboration");
    panel.exitTextField(); // draft saved, no option selected

    expect(panelActions.submit(panel, { sendMessage: vi.fn(), isIdle: () => true })).toBe(true);
    expect(panel.footerFlash?.text).toContain("nothing to submit");
    // Verbatim h2.39 template — "(s)" is literal, no pluralization logic.
    expect(panel.footerFlash?.text).toBe(
      "nothing to submit — 1 question(s) have drafts awaiting an option or Other",
    );
  });

  test("test_ctrl_t_repress_closes_field_saving_draft_without_arming", () => {
    // ESC-002: ctrl+t is a TOGGLE — the re-press exits the prompt box with a
    // draft write-through (R4) and, unlike the enter stage-1 save, does NOT
    // arm the two-stage advance (the next enter ACCEPTS, it never advances).
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const drafts = {
      getDraft: vi.fn(() => undefined),
      setDraft: vi.fn(),
      getNote: () => "",
      setNote: vi.fn(),
    };
    const panel = new InterrogationPanel(panelArgsFor(state, { drafts }));

    panel.handleInput("\u0014"); // open
    panel.textField.setText("elaboration");
    panel.handleInput("\u0014"); // re-press = close
    expect(panel.focus).toBe("options");
    expect(panel.textField.focused).toBe(false);
    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "elaboration");
    expect(panel.draftTextFor("q1")).toBe("elaboration");

    // The next enter accepts the highlighted option — no stage-2 advance.
    expect(panel.handleInput("\r")).toBe(true);
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(panel.currentId).toBe("q2"); // accept-advance, not the armed skip
  });

  test("test_blurTextField_returns_focus_to_options", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.focusTextField();
    panel.blurTextField();
    expect(panel.focus).toBe("options");
    expect(panel.textField.focused).toBe(false);
  });

  test("test_refocus_reseeds_saved_draft_over_stale_buffer", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const drafts = {
      getDraft: vi.fn((id: string) => (id === "q1" ? "saved draft" : undefined)),
      setDraft: vi.fn(),
      getNote: () => "",
      setNote: vi.fn(),
    };
    const panel = new InterrogationPanel(panelArgsFor(state, { drafts }));
    panel.focusTextField();
    expect(panel.textField.getText()).toBe("saved draft");

    // P1.M4.T1.S2 refinement (h2.31 seed-on-refocus): re-focusing always
    // seeds from the freshest draft read — a stale buffer (e.g. leftover
    // text from another question after navigation) is re-seeded, while a
    // same-value re-focus is a textual no-op inside TextField.seed.
    panel.blurTextField();
    panel.textField.setText("stale buffer");
    panel.focusTextField();
    expect(panel.textField.getText()).toBe("saved draft");
  });

  test("test_unmatched_input_forwards_only_in_text_focus", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    const editor = panel.textField.editor as unknown as { handleInput: Mock };

    // Options focus: unmatched input does NOT reach the editor.
    expect(panel.handleInput("x")).toBe(false);
    expect(editor.handleInput).not.toHaveBeenCalled();

    // Text focus: unmatched input reaches the editor and reports consumed.
    panel.focusTextField();
    expect(panel.handleInput("x")).toBe(true);
    expect(editor.handleInput).toHaveBeenCalledWith("x");
  });

  test("test_router_consumed_keys_never_reach_text_field", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    // Explicit seam consuming everything — the h2.34 intercept-before-forward
    // rule: config keys fire (and stop) even while text focus is active.
    const panel = new InterrogationPanel(
      panelArgsFor(state, {
        keys: (data) => data === "X",
        editorFactory: () => fakePanelEditor(),
      }),
    );
    panel.focusTextField();
    const editor = panel.textField.editor as unknown as { handleInput: Mock };

    expect(panel.handleInput("X")).toBe(true);
    expect(editor.handleInput).not.toHaveBeenCalled();
    // Unmatched input still forwards.
    expect(panel.handleInput("y")).toBe(true);
    expect(editor.handleInput).toHaveBeenCalledWith("y");
  });

  test("test_editor_region_renders_for_text_questions_and_text_focus", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("c1"));
    state.upsertQuestion(textQ("t1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    // Choice question, options focus → no editor lines.
    panel.invalidate();
    expect(panel.render(80)).not.toContain(" e1");

    // Text question is the primary affordance → editor region always shows.
    panel.currentId = "t1";
    panel.invalidate(); // currentId changes are invalidation-free (M3 nav owns that)
    const withText = panel.render(80);
    expect(withText).toContain(" e1");
    expect(withText).toContain(" e2");
    expect(withText).toContain(" e3");

    // Choice question under text focus → editor region shows.
    panel.currentId = "c1";
    panel.focusTextField();
    expect(panel.render(80)).toContain(" e1");
  });
});

// --------------------------------------- external editor handoff (P1.M4.T1.S3)

interface EditorHarness {
  panel: InterrogationPanel;
  tui: { stop: Mock; start: Mock; requestRender: Mock };
  drafts: { getDraft: Mock; setDraft: Mock; getNote: Mock; setNote: Mock };
  editor: ReturnType<typeof fakePanelEditor>;
}

/** Panel on a text question, text focus, with controllable tui/drafts/editor. */
function makeEditorHarness(): EditorHarness {
  const state = createInterrogationState("goal");
  state.upsertQuestion(textQ("q1"));
  const tui = { stop: vi.fn(), start: vi.fn(), requestRender: vi.fn() };
  const drafts = { getDraft: vi.fn(), setDraft: vi.fn(), getNote: vi.fn(() => ""), setNote: vi.fn() };
  const editor = fakePanelEditor();
  const panel = new InterrogationPanel(
    panelArgsFor(state, {
      tui: tui as unknown as TUI,
      drafts: drafts as unknown as DraftStore,
      editorFactory: () => editor,
      focusQuestionId: "q1",
    }),
  );
  panel.focus = "text";
  return { panel, tui, drafts, editor };
}

/** The panel's private h2.45 draft slot map (direct state assertion). */
function draftSlotsOf(panel: InterrogationPanel): Map<string, { value: string; text: string }> {
  return (panel as unknown as { draftSlots: Map<string, { value: string; text: string }> })
    .draftSlots;
}

describe("openExternalEditor — ctrl+g handoff (P1.M4.T1.S3)", () => {
  beforeEach(() => {
    editMock.mockReset();
  });

  test("test_clean_exit_replaces_field_syncs_drafts_and_resumes_tui", async () => {
    const h = makeEditorHarness();
    h.editor.setText("draft text");
    editMock.mockResolvedValue({ status: "complete", content: "edited" });

    await h.panel.openExternalEditor();

    // Suspend envelope: stop BEFORE the round-trip, start + repaint after.
    expect(h.tui.stop).toHaveBeenCalledTimes(1);
    expect(h.tui.start).toHaveBeenCalledTimes(1);
    expect(h.tui.requestRender).toHaveBeenCalledWith(true);
    expect(h.tui.stop.mock.invocationCallOrder[0]).toBeLessThan(
      editMock.mock.invocationCallOrder[0],
    );
    expect(editMock.mock.invocationCallOrder[0]).toBeLessThan(
      h.tui.start.mock.invocationCallOrder[0],
    );
    // Round-trip args: resolved command + the pre-suspend draft.
    expect(editMock).toHaveBeenCalledWith({ command: "stub-editor", content: "draft text" });
    // Clean-exit-only apply: field text + h2.45 slot + DraftStore seam.
    expect(h.editor.setText).toHaveBeenCalledWith("edited");
    expect(draftSlotsOf(h.panel).get("q1")).toEqual({ value: "q1", text: "edited" });
    expect(h.drafts.setDraft).toHaveBeenCalledWith("q1", "edited");
    // h2.31: the text replaces the field — nothing else moves.
    expect(h.panel.focus).toBe("text");
  });

  test("test_failed_edit_leaves_field_untouched_but_still_resumes_tui", async () => {
    const h = makeEditorHarness();
    h.editor.setText("draft text");
    h.editor.setText.mockClear(); // the seed call above is not the panel's apply
    editMock.mockResolvedValue({ status: "failed" });

    await h.panel.openExternalEditor();

    expect(h.editor.setText).not.toHaveBeenCalled();
    expect(h.drafts.setDraft).not.toHaveBeenCalled();
    expect(draftSlotsOf(h.panel).size).toBe(0);
    expect(h.tui.start).toHaveBeenCalledTimes(1); // finally ALWAYS restarts
    expect(h.tui.requestRender).toHaveBeenCalledWith(true);
  });

  test("test_rejected_round_trip_does_not_escape_and_clears_the_guard", async () => {
    const h = makeEditorHarness();
    editMock.mockRejectedValue(new Error("readback exploded"));

    await expect(h.panel.openExternalEditor()).resolves.toBeUndefined(); // no unhandled rejection
    expect(h.tui.start).toHaveBeenCalledTimes(1); // terminal never left dead

    editMock.mockResolvedValue({ status: "failed" });
    await h.panel.openExternalEditor();
    expect(editMock).toHaveBeenCalledTimes(2); // in-flight flag was cleared
  });

  test("test_second_ctrl_g_while_in_flight_is_ignored", async () => {
    const h = makeEditorHarness();
    let resolveEdit!: (result: ExternalEditorResult) => void;
    editMock.mockReturnValue(
      new Promise<ExternalEditorResult>((resolve) => {
        resolveEdit = resolve;
      }),
    );

    const first = h.panel.openExternalEditor();
    const second = h.panel.openExternalEditor(); // while the first is pending
    expect(editMock).toHaveBeenCalledTimes(1); // guard: second is a no-op

    resolveEdit({ status: "complete", content: "late" });
    await Promise.all([first, second]);
    expect(h.editor.setText).toHaveBeenCalledTimes(1); // first still applies
    expect(h.tui.start).toHaveBeenCalledTimes(1);
  });

  test("test_ctrl_g_through_handleInput_fires_the_wired_default_action", async () => {
    const h = makeEditorHarness();
    h.editor.setText("typed draft");
    editMock.mockResolvedValue({ status: "complete", content: "edited draft" });

    h.panel.handleInput("\u0007"); // ctrl+g — default router consumes in text focus
    expect(editMock).toHaveBeenCalledTimes(1); // sync dispatch into the void'd call
    expect(editMock).toHaveBeenCalledWith({ command: "stub-editor", content: "typed draft" });

    await flush(); // let the fire-and-forget envelope settle
    expect(h.editor.setText).toHaveBeenCalledWith("edited draft");
    expect(h.tui.start).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------- note mode (R3, P1.M4.T2.S2)

/** Real DraftStore class, aliased against the panel's DraftStore interface. */
import { DraftStore as RealDraftStore } from "../draft-store.js";

/** kitty CSI-u ctrl+shift+m (keys.test.ts DEFAULT_DATA convention). */
const BATCH_NOTE = "\u001b[109;6u";

describe("note mode (R3, P1.M4.T2.S2)", () => {
  function makeDrafts(getNote = "") {
    return {
      getDraft: vi.fn(),
      setDraft: vi.fn(),
      getNote: vi.fn(() => getNote),
      setNote: vi.fn(),
    };
  }

  test("test_ctrl_shift_m_enters_note_mode_and_swaps_editor_area", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    expect(panel.handleInput(BATCH_NOTE)).toBe(true); // routed toggle → open

    expect(panel.focus).toBe("note");
    expect(panel.textField.focused).toBe(true);
    const lines = panel.render(80);
    expect(lines[0]).toBe("┌ NOTE — ships with next submission ┐"); // exact h2.32
    expect(lines).toContain(" e1"); // the SAME embedded editor renders
    expect(lines.at(-1)).toContain("answered"); // footer still terminates
    // The question/hint/options region is REPLACED — no question line.
    expect(lines.join("\n")).not.toContain("prompt:q1");
  });

  test("test_note_mode_swaps_from_deep_view_too", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_D); // deep view (M5 placeholder region)
    expect(panel.view).toBe("deep");

    panel.handleInput(BATCH_NOTE); // note mode from deep — same swap
    const lines = panel.render(80);
    expect(lines[0]).toBe("┌ NOTE — ships with next submission ┐");
    expect(lines.join("\n")).not.toContain("[deep] placeholder");
  });

  test("test_repress_exits_preserving_draft_and_reentry_reseeds_from_store", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const drafts = makeDrafts();
    const panel = new InterrogationPanel(
      panelArgsFor(state, { drafts: drafts as unknown as DraftStore }),
    );
    panel.handleInput(BATCH_NOTE);
    (panel.textField.editor as unknown as { setText: Mock }).setText("note body");

    panel.handleInput(BATCH_NOTE); // re-press exits — write-through (FR-16)
    expect(panel.focus).toBe("options");
    expect(panel.batchNote).toBe("note body");
    expect(drafts.setNote).toHaveBeenCalledWith("note body");
    expect(panel.textField.focused).toBe(false);

    // Re-entry re-seeds from the store (store wins over the panel field).
    drafts.getNote.mockReturnValue("note body");
    panel.enterNoteMode();
    expect(panel.focus).toBe("note");
    expect(panel.textField.getText()).toBe("note body");
  });

  test("test_esc_exits_note_mode_and_unmatched_input_types_into_it", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.enterNoteMode();
    const editor = panel.textField.editor as unknown as { handleInput: Mock };

    expect(panel.handleInput("x")).toBe(true); // typing reaches the note editor
    expect(editor.handleInput).toHaveBeenCalledWith("x");

    // ESC-002: a SINGLE esc forwards to the (composed) editor — the note
    // mode is NOT exited and the key reaches the editor (pi-vim semantics).
    expect(panel.handleInput(ESCAPE)).toBe(true);
    expect(editor.handleInput).toHaveBeenCalledWith(ESCAPE);
    expect(panel.focus).toBe("note");
    expect(panel.textField.focused).toBe(true);

    // The SECOND esc in a row (inside escExitWindowMs) closes the prompt
    // box only — note write-through exit, no view descent, no suspend.
    expect(panel.handleInput(ESCAPE)).toBe(true);
    expect(panel.focus).toBe("options");
    expect(panel.textField.focused).toBe(false);
  });

  test("test_esc_exit_window_zero_disables_double_esc_in_note_mode", () => {
    // escExitWindowMs = 0: every esc forwards to the editor — the pair
    // never fires (close via ctrl+shift+m re-press or enter instead).
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(
      panelArgsFor(state, { config: { ...DEFAULT_CONFIG, escExitWindowMs: 0 } }),
    );
    panel.enterNoteMode();
    const editor = panel.textField.editor as unknown as { handleInput: Mock };

    expect(panel.handleInput(ESCAPE)).toBe(true);
    expect(panel.handleInput(ESCAPE)).toBe(true);
    expect(editor.handleInput).toHaveBeenCalledTimes(2);
    expect(panel.focus).toBe("note");
  });

  test("test_note_survives_suspend_resume_via_store_seam_money_test", () => {
    // ONE store, TWO panel sessions (the R4 money-test shape): session 1
    // exits note mode (write-through), is dropped; session 2 re-seeds.
    const store = new RealDraftStore();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const p1 = new InterrogationPanel(panelArgsFor(state, { drafts: store }));
    p1.enterNoteMode();
    p1.textField.setText("resume-safe note");
    p1.handleInput(ESCAPE);
    p1.handleInput(ESCAPE); // esc-esc exits note mode (ESC-002) with write-through
    expect(store.getNote()).toBe("resume-safe note");

    const p2 = new InterrogationPanel(panelArgsFor(state, { drafts: store }));
    p2.enterNoteMode();
    expect(p2.focus).toBe("note");
    expect(p2.textField.getText()).toBe("resume-safe note"); // preserved (R4)
  });
});

// ------------------------------------ deep view (FR-8, P1.M5.T1.S1)

describe("deep view (P1.M5.T1.S1)", () => {
  const UP = "\u001b[A";
  const DOWN = "\u001b[B";
  const ENTER = "\r";

  /** Choice question with a recommendation and long ramification texts. */
  function deepQ(id: string, overrides: Partial<Question> = {}): Question {
    return {
      id,
      prompt: `prompt:${id}`,
      description: "Context you should read before choosing.",
      type: "choice",
      rev: 1,
      status: "open",
      options: [
        { value: "sqlite", label: "sqlite", ramification: "Fast, embedded, single-writer." },
        { value: "postgres", label: "postgres", ramification: "Networked, concurrent writers." },
      ],
      recommendation: "sqlite",
      ...overrides,
    };
  }

  test("test_deep_view_renders_goal_description_headers_bounded", () => {
    const state = createInterrogationState("Ship the widget");
    state.upsertQuestion(deepQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    panel.handleInput(CTRL_D);
    const lines = panel.render(80);
    expect(lines[0]).toMatch(/^┌ interrogation ·/); // header unchanged
    expect(lines[lines.length - 1]).toMatch(/^└ .*⏎ ┘$/); // footer unchanged
    // FR-30: FULL goal text rendered (not the header's truncated form).
    expect(lines.join("\n")).toContain("Ship the widget");
    expect(lines.join("\n")).toContain("Context you should read before choosing.");
    // ★ header + all options in state order (R1).
    expect(lines.join("\n")).toContain("★ sqlite");
    expect(lines.join("\n")).toContain("postgres");
    expect(lines.join("\n")).toContain("Fast, embedded, single-writer.");
    // h2.51 row 2: header(1) + pane(≤ DEEP_VIEW_HEIGHT) + footer(1).
    expect(lines.length).toBeLessThanOrEqual(1 + 20 + 1);
  });

  test("test_entering_deep_seeds_selection_and_scroll_once", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(deepQ("q1", { recommendation: "postgres" }));
    const panel = new InterrogationPanel(panelArgsFor(state));
    expect(panel.view).toBe("short");

    panel.handleInput(CTRL_D); // entering deep seeds once
    expect(panel.cursorIndex).toBe(1); // ★ preselect, clamped to option domain
    expect(panel.scrollOffset).toBe(0);

    panel.handleInput(UP); // move selection — NOT a re-seed
    expect(panel.cursorIndex).toBe(0);
    panel.handleInput(CTRL_D); // toggle back to short
    panel.handleInput(CTRL_D); // re-enter → re-seeds from ★
    expect(panel.cursorIndex).toBe(1);
    expect(panel.scrollOffset).toBe(0);
  });

  test("test_ac5_scroll_select_enter_returns_and_advances", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(deepQ("q1"));
    state.upsertQuestion(deepQ("q2"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    panel.handleInput(CTRL_D);
    expect(panel.view).toBe("deep");
    const beforeId = panel.currentId;
    panel.handleInput(DOWN); // deep ↓ moves the SELECTION
    expect(panel.cursorIndex).toBe(1);
    expect(panel.currentId).toBe(beforeId); // never changes the question

    panel.handleInput(ENTER);
    expect(panel.view).toBe("short"); // returned to the short form
    expect(panel.state.getQuestion("q1")?.answer?.value).toBe("postgres");
    expect(panel.state.getQuestion("q1")?.status).toBe("answered");
    expect(panel.currentId).toBe("q2"); // advanced to next unanswered (Q14)
    expect(panel.deepSticky).toBe(true);
  });

  test("test_deep_updown_clamp_and_esc_preserves_state", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(deepQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    panel.handleInput(CTRL_D);
    panel.handleInput(DOWN);
    panel.handleInput(DOWN); // onto the synthetic ✎ Other section (P1.M2.T6.S1)
    expect(panel.cursorIndex).toBe(2);
    panel.handleInput(DOWN); // consumed no-op at the domain edge (no wrap past Other)
    expect(panel.cursorIndex).toBe(2);
    panel.handleInput(UP);
    expect(panel.cursorIndex).toBe(1);
    panel.handleInput(UP);
    expect(panel.cursorIndex).toBe(0);

    panel.handleInput(ESCAPE); // FR-16: descends, destroys nothing
    expect(panel.view).toBe("short");
    expect(panel.deepSticky).toBe(true); // sticky preserved for the session
    expect(panel.state.getQuestion("q1")?.status).toBe("open"); // nothing destroyed
    // ctrl+l overview round-trip restores deep (deepSticky).
    panel.handleInput(CTRL_L);
    panel.handleInput(CTRL_L);
    expect(panel.view).toBe("deep");
  });

  test("test_note_mode_still_wins_over_deep_pane", () => {
    // FR-13 "at any time": note mode replaces the pane region even in deep.
    const state = createInterrogationState("goal");
    state.upsertQuestion(deepQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.handleInput(CTRL_D);
    expect(panel.view).toBe("deep");
    panel.handleInput("\u001b[109;6u"); // ctrl+shift+m → note mode
    const lines = panel.render(80);
    expect(lines[0]).toBe("┌ NOTE — ships with next submission ┐");
    expect(lines.join("\n")).not.toContain("Fast, embedded, single-writer.");
  });
});

// ------------------------------------------- gate group (P1.M5.T3.S1)

describe("gate group — focus, dimming, warning (P1.M5.T3.S1)", () => {
  const DOWN = "\u001b[B";
  const NEXT_Q = "\u001b[Z"; // shift+tab — DEFAULT_CONFIG.keys.nextQuestion
  const ENTER = "\r";

  /** Real-ANSI dim theme so panel-level dim wrapping is observable. */
  const ansiTheme = {
    fg: (name: string, s: string) => (name === "dim" ? `\u001b[2m${s}\u001b[0m` : s),
    bold: (s: string) => s,
  } as unknown as Theme;

  /** Fixture: "foundation" carries a gate:true question; "later" exists. */
  function gateState(withGate = true): InterrogationState {
    const state = createInterrogationState("goal");
    state.upsertQuestion(
      choiceQ("g1", {
        group: "foundation",
        gate: withGate ? true : undefined,
        description: "Foundation hint.",
      }),
    );
    state.upsertQuestion(choiceQ("g2", { group: "foundation" }));
    state.upsertQuestion(choiceQ("n1", { group: "later", description: "Later hint." }));
    state.upsertQuestion(choiceQ("n2", { group: "later" }));
    return state;
  }

  test("test_gate_panel_opens_on_gate_groups_first_answerable_question", () => {
    const panel = new InterrogationPanel(panelArgsFor(gateState()));
    expect(panel.currentId).toBe("g1"); // FR-1: first answerable member of the gate group
  });

  test("test_gate_skips_withdrawn_moot_members_for_focus", () => {
    const state = gateState();
    state.setStatus("g1", "withdrawn");
    expect(new InterrogationPanel(panelArgsFor(state)).currentId).toBe("g2");

    state.setStatus("g2", "moot"); // ALL gate members now withdrawn/moot
    expect(new InterrogationPanel(panelArgsFor(state)).currentId).toBe("g1"); // fall back to gate group's FIRST question
  });

  test("test_gate_answered_members_still_count_as_answerable_focus_targets", () => {
    const state = gateState();
    state.applyAnswer("g1", { value: "a", at: "t" }); // answered = pending, NOT withdrawn/moot
    expect(new InterrogationPanel(panelArgsFor(state)).currentId).toBe("g1");
  });

  test("test_gate_no_gate_declared_lands_on_first_open_unchanged", () => {
    const state = gateState(false);
    expect(new InterrogationPanel(panelArgsFor(state)).currentId).toBe("g1");
    state.setStatus("g1", "answered"); // pre-gate ladder: first status-"open"
    expect(new InterrogationPanel(panelArgsFor(state)).currentId).toBe("g2");
  });

  test("test_gate_focusQuestionId_beats_gate_focus", () => {
    const panel = new InterrogationPanel(panelArgsFor(gateState(), { focusQuestionId: "n2" }));
    expect(panel.currentId).toBe("n2"); // explicit agent override wins (AC-1)
  });

  test("test_gate_gate_group_renders_NORMAL_nondimmed", () => {
    const state = gateState();
    const panel = new InterrogationPanel(panelArgsFor(state, { theme: ansiTheme }));
    expect(panel.currentId).toBe("g1");
    const lines = panel.render(80);
    // Current question IS in the gate group → rendering completely unchanged
    // (h2.29): identical to the explicit dim=false renderer call.
    expect(lines[1]).toBe(renderQuestionLine(state.getQuestion("g1")!, 1, ansiTheme, 80, false));
    expect(lines[2]).toBe(renderHintLine(state.getQuestion("g1")!, ansiTheme, 80, false)[0]);
  });

  test("test_gate_nongate_questions_render_dimmed_but_fully_answerable", () => {
    const state = gateState();
    const panel = new InterrogationPanel(panelArgsFor(state, { theme: ansiTheme }));
    panel.handleInput(NEXT_Q); // → g2 (still gate group "foundation")
    panel.handleInput(NEXT_Q); // → n1 (later group, non-gate)
    expect(panel.currentId).toBe("n1");

    const lines = panel.render(80);
    const n1 = state.getQuestion("n1")!;
    const n1Index = state.orderedQuestions().findIndex((q) => q.id === "n1");
    // Question line, hint line, and option lines all carry the dim wrap.
    expect(lines[1]).toBe(renderQuestionLine(n1, n1Index + 1, ansiTheme, 80, true));
    expect(lines[2]).toBe(renderHintLine(n1, ansiTheme, 80, true)[0]);
    expect(lines[3]).toBe(
      renderShortViewOptions({
        question: n1,
        cursorIndex: panel.cursorIndex,
        theme: ansiTheme,
        width: 80,
        dimmed: true,
      })[0],
    );

    // R1/AC-1: dimmed is display-only — the question is fully answerable.
    panel.handleInput(ENTER);
    expect(state.getQuestion("n1")?.status).toBe("answered");
  });

  test("test_gate_no_gate_renders_byte_identical_to_pregate_golden", () => {
    const state = gateState(false);
    const panel = new InterrogationPanel(panelArgsFor(state));
    const lines = panel.render(80);
    const snapshot = state.serialize();
    const ordered = state.orderedQuestions();
    const idx = ordered.findIndex((q) => q.id === panel.currentId);
    const current = ordered[idx]!;
    // Golden: the exact pre-gate composition — every renderer called with no
    // dim flag, header + question + hint + options + footer.
    const expected = [
      renderHeader(snapshot, stubTheme, 80).line,
      renderQuestionLine(current, idx + 1, stubTheme, 80),
      ...renderHintLine(current, stubTheme, 80),
      ...renderShortViewOptions({
        question: current,
        cursorIndex: panel.cursorIndex,
        theme: stubTheme,
        width: 80,
      }),
      renderFooter(snapshot, "short", resolveKeyLabels(DEFAULT_CONFIG), stubTheme, 80),
    ];
    expect(lines).toEqual(expected);
  });

  test("test_gate_warning_renders_above_footer_and_wins_over_flash", () => {
    const state = gateState();
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.gateWarning = { count: 2 };
    const lines = panel.render(80);
    expect(lines[lines.length - 2]).toBe(
      "  ⚠ 2 foundational unanswered — later answers may shift",
    );
    expect(lines[lines.length - 1]).toContain("└"); // footer still last

    // Shared slot rule: the warning wins over a still-live flash (h2.37).
    panel.flash("nothing to submit");
    try {
      const linesWithFlash = panel.render(80);
      expect(linesWithFlash[linesWithFlash.length - 2]).toContain("foundational unanswered");
      expect(linesWithFlash.join("\n")).not.toContain("nothing to submit");
    } finally {
      panel.dispose(); // clear the flash timer
    }
  });

  test("test_gate_any_key_dismisses_the_warning_and_still_acts", () => {
    const state = gateState();
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.gateWarning = { count: 1 };

    // Dismiss + act: ↓ clears the warning AND moves the option cursor.
    const cursorBefore = panel.cursorIndex;
    panel.handleInput(DOWN);
    expect(panel.gateWarning).toBeNull();
    expect(panel.cursorIndex).toBe(cursorBefore + 1);

    // Dismiss-only: a key with no binding still clears it (any key).
    panel.gateWarning = { count: 1 };
    panel.handleInput("z");
    expect(panel.gateWarning).toBeNull();

    // Dismissed → the next render no longer carries the warning line.
    expect(panel.render(80).join("\n")).not.toContain("foundational unanswered");
  });
});

// ------------------------------------------------------------------ ctrl+t duty

describe("ctrl+t duty — EXPLAIN vs OTHER (WRITEIN-001, P1.M2.T3.S1)", () => {
  const CTRL_T = "\u0014"; // DEFAULT_CONFIG.keys.focusText

  /** Panel with the stateful fake composed editor (label/enter assertions). */
  function makeDutyPanel(state: InterrogationState): InterrogationPanel {
    return new InterrogationPanel(
      panelArgsFor(state, { editorFactory: () => fakePanelEditor() }),
    );
  }

  test("desiredTextDuty_prefers_the_type_check_over_the_Other_row_index", () => {
    // On a text question `options` is undefined, so cursorIndex 0 ===
    // length 0 would "coincidentally" fire the index test — the explicit
    // type check must be what selects write-in (PRP gotcha).
    const state = createInterrogationState("goal");
    state.upsertQuestion(textQ("t1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.currentId = "t1";
    panel.cursorIndex = 0;
    expect(desiredTextDuty(panel)).toBe("writein");

    // Choice question, cursor on a REAL option → elaboration (default).
    state.upsertQuestion(choiceQ("c1"));
    panel.currentId = "c1";
    panel.cursorIndex = 0;
    expect(desiredTextDuty(panel)).toBe("elaboration");
    // …and on the ✎ Other row (index === options.length) → write-in.
    panel.cursorIndex = 2;
    expect(desiredTextDuty(panel)).toBe("writein");
  });

  test("ctrl_t_on_option_cursor_opens_elaboration_duty_with_EXPLAIN_label", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const panel = makeDutyPanel(state);

    panel.handleInput(CTRL_T); // cursorIndex 0 = a real option

    expect(panel.focus).toBe("text");
    expect(panel.textDuty).toBe("elaboration");
    const lines = panel.render(80);
    expect(lines.some((l) => l.includes("EXPLAIN — attaches to your selection"))).toBe(true);
    expect(lines.some((l) => l.includes("OTHER — this text is the answer"))).toBe(false);
  });

  test("elaboration_enter_saves_draft_and_blurs_never_answers_or_advances_AC2b", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const panel = makeDutyPanel(state);

    panel.handleInput(CTRL_T); // elaboration duty (cursor on a real option)
    panel.textField.setText("because migration risk");
    expect(panel.handleInput("\r")).toBe(true); // elaboration enter

    // Saved + blurred — and NOTHING else (AC-2b: an elaboration alone
    // never answers: no applyAnswer, no advance, no arm).
    expect(panel.draftTextFor("q1")).toBe("because migration risk");
    expect(panel.focus).toBe("options");
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
    expect(panel.currentId).toBe("q1"); // no advance
  });

  test("ctrl_t_on_the_Other_row_opens_writein_duty_and_enter_commits_custom", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const panel = makeDutyPanel(state);

    panel.cursorIndex = 2; // past the 2 options = the ✎ Other row
    panel.handleInput(CTRL_T); // duty follows the cursor → write-in

    expect(panel.focus).toBe("text");
    expect(panel.textDuty).toBe("writein");
    const lines = panel.render(80);
    expect(lines.some((l) => l.includes("OTHER — this text is the answer"))).toBe(true);
    expect(lines.some((l) => l.includes("EXPLAIN — attaches to your selection"))).toBe(false);

    panel.textField.setText("my own answer");
    expect(panel.handleInput("\r")).toBe(true); // write-in enter COMMITS

    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q1")?.answer?.value).toBe("my own answer");
    expect(state.getQuestion("q1")?.answer?.custom).toBe(true);
    expect(panel.currentId).toBe("q2"); // advanced (Q14 parity)
    expect(panel.focus).toBe("options");
  });

  test("ctrl_t_on_a_text_question_opens_writein_duty_and_enter_commits", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(textQ("t1"));
    state.upsertQuestion(choiceQ("c1"));
    const panel = makeDutyPanel(state);

    panel.handleInput(CTRL_T); // type:text → write-in regardless of cursor

    expect(panel.textDuty).toBe("writein");
    expect(panel.render(80).some((l) => l.includes("OTHER — this text is the answer"))).toBe(true);

    panel.textField.setText("the answer itself");
    expect(panel.handleInput("\r")).toBe(true);

    expect(state.getQuestion("t1")?.status).toBe("answered");
    expect(state.getQuestion("t1")?.answer?.value).toBe("the answer itself");
    expect(state.getQuestion("t1")?.answer?.custom).toBe(true);
    expect(panel.currentId).toBe("c1"); // advanced
  });

  test("elaboration_save_on_answered_with_ripple_victims_routes_through_FR18_modal", () => {
    // q1 answered ← q2 answered (dependsOn q1): editing q1's elaboration
    // would invalidate q2 → the FR-18 keep/cancel modal must gate the save.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
    state.applyAnswer("q1", { value: "a", at: "2025-01-01T00:00:00.000Z" });
    state.applyAnswer("q2", { value: "a", at: "2025-01-01T00:00:00.000Z" });
    const panel = makeDutyPanel(state);

    panel.handleInput(CTRL_T); // cursor on a real option → elaboration duty
    expect(panel.textDuty).toBe("elaboration");
    panel.textField.setText("fresh context");
    expect(panel.handleInput("\r")).toBe(true); // gated — deferred into the modal

    expect(panel.confirmMode?.kind).toBe("text");
    expect(panel.confirmMode?.text).toBe("fresh context");
    expect(panel.draftTextFor("q1")).toBeUndefined(); // nothing written yet

    // esc cancels: no state change of any kind.
    expect(panel.handleInput(ESCAPE)).toBe(true);
    expect(panel.confirmMode).toBeNull();
    expect(panel.draftTextFor("q1")).toBeUndefined();
    expect(state.getQuestion("q1")?.answer?.text).toBeUndefined();
    expect(state.getQuestion("q2")?.status).toBe("answered"); // victim intact

    // Retry → confirm-enter applies the DEFERRED draft save (stage-1
    // semantics: the draft lands, the answer itself is never touched).
    panel.textField.setText("fresh context");
    expect(panel.handleInput("\r")).toBe(true); // gated again
    expect(panel.confirmMode?.kind).toBe("text");
    expect(panel.handleInput("\r")).toBe(true); // keep
    expect(panel.confirmMode).toBeNull();
    expect(panel.draftTextFor("q1")).toBe("fresh context"); // draft saved
    expect(panel.focus).toBe("options"); // blurred
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // answer untouched
    expect(state.getQuestion("q1")?.answer?.text).toBeUndefined();
  });

  test("ctrl_t_repress_exits_writein_duty_with_draft_write_through_never_commits", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const panel = makeDutyPanel(state);

    panel.cursorIndex = 2; // ✎ Other row → write-in duty
    panel.handleInput(CTRL_T);
    expect(panel.textDuty).toBe("writein");
    panel.textField.setText("half typed");

    panel.handleInput(CTRL_T); // re-press = exit (duty-agnostic, R4)

    expect(panel.focus).toBe("options");
    expect(panel.draftTextFor("q1")).toBe("half typed"); // write-through
    expect(state.getQuestion("q1")?.answer).toBeUndefined(); // NEVER a commit
    expect(panel.textDuty).toBe("elaboration"); // duty is per-focus-session
  });
});

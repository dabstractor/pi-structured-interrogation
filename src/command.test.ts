/**
 * Unit tests for src/command.ts (P1.M6.T1.S2).
 *
 * Follows debug-commands.test.ts stubbing conventions (fake pi recording
 * registerCommand/registerShortcut calls; handlers invoked directly with a
 * stub ctx) and panel.test.ts's host-fixture approach (createPanelHost +
 * real InterrogationState seeded through the raw primitives; a `ui.custom`
 * mock returning a promise that never resolves until done()).
 *
 * suspendPanel/resumePanel are mocked AT THE S1 SEAM (panel/suspend.ts) with
 * spies that DELEGATE to the real implementations — so tests both assert
 * "P1.M6.T1.S2 consumed S1" (call counts / carrier identity) and exercise
 * the real host phase transitions (suspend → isSuspended, resume → open).
 *
 * Coverage: toggle matrix through both surfaces (suspend when open, resume
 * when suspended with live questions, exact h2.37 empty-state notify when
 * closed/no state/with args, the BUG-005 answered/submitted/reasked-pending
 * resume rows, the terminal-only dead-panel edge), the non-TUI mode guard,
 * config-rebound shortcut key registration, shortcut handler toggling,
 * double-press idempotency (AC-4 cycle safety), and the REAL index.ts
 * onReopen factory hook driven through a captured registerTool execute
 * (BUG-005 resume half: answered/submitted/reasked reopen, terminal-only /
 * post-completion / missing-resume-surface no-state).
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import interrogatorExtension from "./index.js";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { interrogateToggleAction, registerInterrogateCommand } from "./command.js";
import { createPanelHost, openPanel, type OpenPanelOptions, type PanelHost } from "./panel/panel.js";
import { createInterrogationState, getState, resetState, setState, type InterrogationState, type Question } from "./state.js";

// ------------------------------------------------- S1 seam mock (delegating)

/**
 * Spy on the S1 exports WITHOUT reimplementing them: each vi.fn forwards to
 * the actual module, so real suspend/resume behavior still runs and tests
 * can assert consumption (call counts + the surface carrier identity).
 */
vi.mock("./panel/suspend.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./panel/suspend.js")>();
  return {
    ...actual,
    suspendPanel: vi.fn((host: PanelHost) => actual.suspendPanel(host)),
    resumePanel: vi.fn(
      (pi: Parameters<typeof actual.resumePanel>[0]) => actual.resumePanel(pi),
    ),
  };
});
import { resumePanel, suspendPanel } from "./panel/suspend.js";

// ------------------------------------------------------------------ fixtures

/** Open choice question (panel.test.ts's fixture shape). */
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

/** EXACT h2.37/h2.3 strings (duplicated here so a drift fails the test). */
const EMPTY_MESSAGE = "No active interrogation — ask the agent to interrogate you";
const NON_TUI_MESSAGE = "The interrogation panel requires TUI mode";

interface CustomCall {
  promise: Promise<null | undefined>;
  done: (result: null | undefined) => void;
}

/**
 * Minimal PiUISurface stand-in: ui.custom captures the factory (invoked, as
 * pi would) and returns a never-resolving-until-done promise — the blocking
 * contract openPanel's fire-and-forget host must survive. No setWidget:
 * PiUISurface.setWidget is optional and suspend.ts guards it.
 */
function makeSurfacePi(mode: string = "tui"): {
  surface: { mode: string; ui: { custom: Mock; notify?: NotifyFn } };
  calls: CustomCall[];
  custom: Mock;
} {
  const calls: CustomCall[] = [];
  const custom = vi.fn(
    (
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: null | undefined) => void,
      ) => Component,
    ): Promise<null | undefined> => {
      let resolve!: (result: null | undefined) => void;
      const promise = new Promise<null | undefined>((res) => {
        resolve = res;
      });
      factory({} as unknown as TUI, {} as unknown as Theme, {} as unknown as KeybindingsManager, (r) => resolve(r));
      calls.push({ promise, done: (r) => resolve(r) });
      return promise;
    },
  );
  return { surface: { mode, ui: { custom } }, calls, custom };
}

type NotifyFn = ReturnType<typeof vi.fn>;

/**
 * Command/shortcut ctx stub: same shape as the surface (ctx.ui IS the
 * PiUISurface carrier) plus a notify recorder. `mode` is only honored by
 * the COMMAND handler (the shortcut never branches on it).
 */
function makeCtx(mode: string | undefined = "tui"): {
  ctx: ExtensionCommandContext;
  notify: NotifyFn;
  calls: CustomCall[];
} {
  const notify = vi.fn();
  const { surface, calls } = makeSurfacePi(mode);
  surface.ui.notify = notify; // ctx.ui.notify is the real notify surface
  const ctx = { ...surface, mode } as unknown as ExtensionCommandContext;
  return { ctx, notify, calls };
}

interface MockLifecycle {
  lifecycle: { onPanelDismiss: (cb: () => void) => void; dismissPanel: () => void };
}

function makeMockLifecycle(): MockLifecycle {
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

interface CapturedCommand {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface CapturedShortcut {
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void>;
}

interface Harness {
  host: PanelHost;
  config: InterrogatorConfig;
  commands: Map<string, CapturedCommand>;
  shortcuts: Map<string, CapturedShortcut>;
  invokeCommand(args: string, ctx: ExtensionCommandContext): Promise<void>;
  invokeShortcut(ctx: ExtensionContext): Promise<void>;
}

/** Fresh host + registration capture. The host record is module-scoped, so
 * every harness re-arms it via createPanelHost (panel.test.ts convention). */
function makeHarness(config: InterrogatorConfig = DEFAULT_CONFIG): Harness {
  const host = createPanelHost(makeMockLifecycle().lifecycle);
  const commands = new Map<string, CapturedCommand>();
  const shortcuts = new Map<string, CapturedShortcut>();
  const pi = {
    registerCommand: vi.fn((name: string, def: CapturedCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn((key: string, def: CapturedShortcut) => {
      shortcuts.set(key, def);
    }),
  } as unknown as Pick<ExtensionAPI, "registerCommand" | "registerShortcut">;

  registerInterrogateCommand(pi as ExtensionAPI, config, host);

  return {
    host,
    config,
    commands,
    shortcuts,
    invokeCommand(args, ctx) {
      return commands.get("interrogate")!.handler(args, ctx);
    },
    invokeShortcut(ctx) {
      const [def] = [...shortcuts.values()];
      return def!.handler(ctx);
    },
  };
}

/** Open the panel through the REAL openPanel on a surface pi (phase "open"). */
function openOnSurface(state: InterrogationState, config: InterrogatorConfig = DEFAULT_CONFIG): CustomCall[] {
  const { surface, calls } = makeSurfacePi();
  openPanel(surface as Parameters<typeof openPanel>[0], { config, state } satisfies OpenPanelOptions);
  return calls;
}

// --------------------------------------------------------------------- suite

describe("registerInterrogateCommand — registration surface", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_command_registered_named_interrogate", () => {
    const { commands } = makeHarness();
    const def = commands.get("interrogate");
    expect(def).toBeDefined();
    expect(typeof def!.handler).toBe("function");
    expect(def!.description).toContain("Toggle");
  });

  test("test_shortcut_registered_with_config_key", () => {
    const { shortcuts } = makeHarness(DEFAULT_CONFIG);
    expect([...shortcuts.keys()]).toEqual([DEFAULT_CONFIG.keys.breakOut]);
    expect([...shortcuts.keys()]).toEqual(["ctrl+shift+q"]);
  });

  test("test_shortcut_rebind_registers_raw_rebound_key", () => {
    // R5/AC-12: the shortcut key follows the RAW config value — registerShortcut
    // receives it verbatim (never the display label from resolveKeyLabels).
    const rebound: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, breakOut: "ctrl+alt+x" },
    };
    const { shortcuts } = makeHarness(rebound);
    expect([...shortcuts.keys()]).toEqual(["ctrl+alt+x"]);
  });
});

describe("interrogateToggleAction — decision table", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_toggle_matrix_all_four_rows", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));

    // Row 1: open host → suspendPanel → "suspended"
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    openOnSurface(state);
    expect(host.isOpen()).toBe(true);
    const surface = makeSurfacePi();
    expect(interrogateToggleAction(host, surface.surface as never, state)).toBe("suspended");
    expect(host.isSuspended()).toBe(true);

    // Row 2: suspended ∧ open>0 → resumePanel → "resumed"
    expect(interrogateToggleAction(host, surface.surface as never, state)).toBe("resumed");
    expect(host.isOpen()).toBe(true);

    // Row 3 (BUG-005 flip, h2.2/h3.4 repro): suspended ∧ answered-pending
    // (0 open) → "resumed" — the panel resurfaces so the user can ctrl+s.
    interrogateToggleAction(host, surface.surface as never, state); // suspend again
    const answered = createInterrogationState("goal");
    answered.upsertQuestion(choiceQ("q1"));
    answered.applyAnswer("q1", { value: "a", at: new Date().toISOString() }); // open → answered
    setState(answered);
    expect(interrogateToggleAction(host, surface.surface as never, answered)).toBe("resumed");
    expect(host.isOpen()).toBe(true);

    // Row 3b: submitted-only is live too (BUG-005 set) → "resumed".
    interrogateToggleAction(host, surface.surface as never, answered); // suspend again
    const submitted = createInterrogationState("goal");
    submitted.upsertQuestion(choiceQ("q1"));
    submitted.setStatus("q1", "submitted");
    setState(submitted);
    expect(interrogateToggleAction(host, surface.surface as never, submitted)).toBe("resumed");
    expect(host.isOpen()).toBe(true);

    // Row 3c: reasked-only is live too (BUG-005 set) → "resumed".
    interrogateToggleAction(host, surface.surface as never, submitted); // suspend again
    const reasked = createInterrogationState("goal");
    reasked.upsertQuestion(choiceQ("q1"));
    reasked.setStatus("q1", "reasked");
    setState(reasked);
    expect(interrogateToggleAction(host, surface.surface as never, reasked)).toBe("resumed");
    expect(host.isOpen()).toBe(true);

    // Row 3d (re-targeted negative coverage): suspended ∧ truly dead —
    // terminal-only state (moot; withdrawn/closed equally) → "empty", host
    // stays suspended.
    interrogateToggleAction(host, surface.surface as never, reasked); // suspend again
    const dead = createInterrogationState("goal");
    dead.upsertQuestion(choiceQ("q1"));
    dead.setStatus("q1", "moot");
    setState(dead);
    expect(interrogateToggleAction(host, surface.surface as never, dead)).toBe("empty");
    expect(host.isOpen()).toBe(false);
    expect(host.isSuspended()).toBe(true);

    // Row 3e: empty state (zero questions — e.g. post-clearForCompletion
    // equivalent) is equally dead → "empty".
    const cleared = createInterrogationState("goal");
    setState(cleared);
    expect(interrogateToggleAction(host, surface.surface as never, cleared)).toBe("empty");
    expect(host.isSuspended()).toBe(true);

    // Row 4: closed host → "empty"
    const closedHost = createPanelHost(makeMockLifecycle().lifecycle);
    expect(interrogateToggleAction(closedHost, surface.surface as never, undefined)).toBe("empty");
  });
});

describe("/interrogate command handler", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_toggle_suspends_when_open", async () => {
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);
    expect(host.isOpen()).toBe(true);

    const { ctx, notify } = makeCtx();
    await expect(invokeCommand("", ctx)).resolves.toBeUndefined();

    // S1 consumed: suspendPanel called once; real host phase flipped.
    expect(suspendPanel).toHaveBeenCalledTimes(1);
    expect(host.isSuspended()).toBe(true);
    expect(host.isOpen()).toBe(false);
    // Silent success — no notify on suspend.
    expect(notify).not.toHaveBeenCalled();
  });

  test("test_toggle_resumes_when_suspended", async () => {
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);

    const first = makeCtx();
    await invokeCommand("", first.ctx); // open → suspended
    expect(host.isSuspended()).toBe(true);

    const second = makeCtx();
    await invokeCommand("", second.ctx); // suspended → resumed via S1 resumePanel

    expect(resumePanel).toHaveBeenCalledTimes(1);
    // The command ctx is the PiUISurface carrier handed to S1 (maybeAutoOpen pattern).
    expect(resumePanel).toHaveBeenCalledWith(second.ctx);
    expect(host.isOpen()).toBe(true);
    expect(second.notify).not.toHaveBeenCalled();
  });

  test("test_toggle_empty_state_notifies_exact_string", async () => {
    const { invokeCommand } = makeHarness(); // closed host, no singleton state
    const { ctx, notify } = makeCtx();

    await invokeCommand("", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(EMPTY_MESSAGE, "info");
    expect(suspendPanel).not.toHaveBeenCalled();
    expect(resumePanel).not.toHaveBeenCalled();
  });

  test("test_toggle_empty_state_with_args_same_notify", async () => {
    const { invokeCommand } = makeHarness();
    const { ctx, notify } = makeCtx();

    // h2.15: args are ignored for toggling — never throw, same notify.
    await expect(invokeCommand("focus q1 --whatever", ctx)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(EMPTY_MESSAGE, "info");
  });

  test("test_toggle_suspended_answered_pending_resumes_silently", async () => {
    const { host, invokeCommand } = makeHarness();
    // BUG-005 repro (h2.2/h3.4): suspended host, every question ANSWERED
    // (0 open, pending submission). Answered-pending is a LIVE state — the
    // toggle resumes (silent success: notify fires ONLY on "empty") so the
    // user can resurface and ctrl+s the pending answers.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.applyAnswer("q1", { value: "a", at: new Date().toISOString() }); // open → answered
    setState(state);
    openOnSurface(state);
    const first = makeCtx();
    await invokeCommand("", first.ctx);
    expect(host.isSuspended()).toBe(true);

    const second = makeCtx();
    await invokeCommand("", second.ctx);

    expect(second.notify).not.toHaveBeenCalled();
    expect(resumePanel).toHaveBeenCalledTimes(1);
    expect(host.isOpen()).toBe(true);
  });

  test("test_toggle_suspended_terminal_only_dead_panel_notifies", async () => {
    const { host, invokeCommand } = makeHarness();
    // Re-targeted negative coverage: a TRULY dead panel (all terminal —
    // moot here; withdrawn/closed identical) still notifies the empty-state
    // toast and never resumes.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.setStatus("q1", "moot");
    setState(state);
    openOnSurface(state);
    const first = makeCtx();
    await invokeCommand("", first.ctx);
    expect(host.isSuspended()).toBe(true);

    const second = makeCtx();
    await invokeCommand("", second.ctx);

    expect(second.notify).toHaveBeenCalledWith(EMPTY_MESSAGE, "info");
    expect(resumePanel).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(false);
  });

  test("test_command_non_tui_mode_guards", async () => {
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);

    const { ctx, notify } = makeCtx("rpc");
    await expect(invokeCommand("", ctx)).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledWith(NON_TUI_MESSAGE, "info");
    // No toggle side effects in non-TUI mode.
    expect(suspendPanel).not.toHaveBeenCalled();
    expect(resumePanel).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(false);
  });
});

describe("global break-out/resume shortcut handler", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_shortcut_handler_toggles", async () => {
    const { host, invokeShortcut } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);

    const first = makeCtx();
    await expect(invokeShortcut(first.ctx)).resolves.toBeUndefined();
    expect(host.isSuspended()).toBe(true);
    expect(suspendPanel).toHaveBeenCalledTimes(1);

    const second = makeCtx();
    await invokeShortcut(second.ctx);
    expect(resumePanel).toHaveBeenCalledTimes(1);
    expect(resumePanel).toHaveBeenCalledWith(second.ctx);
    expect(host.isOpen()).toBe(true);
  });

  test("test_shortcut_empty_state_notifies_exact_string", async () => {
    const { invokeShortcut } = makeHarness(); // closed host, no state
    const { ctx, notify } = makeCtx();

    await invokeShortcut(ctx);

    expect(notify).toHaveBeenCalledWith(EMPTY_MESSAGE, "info");
    expect(suspendPanel).not.toHaveBeenCalled();
  });

  test("test_double_press_idempotent", async () => {
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);

    // Toggle suspends…
    const ctxA = makeCtx();
    await invokeCommand("", ctxA.ctx);
    expect(host.isSuspended()).toBe(true);

    // …then a racing duplicate suspend (dual registration / double delivery)
    // is a no-op: no throw, no duplicate done(), host stays suspended.
    expect(() => suspendPanel(host)).not.toThrow();
    expect(suspendPanel).toHaveBeenCalledTimes(2);
    expect(host.isSuspended()).toBe(true);

    // Resume via toggle…
    const ctxB = makeCtx();
    await invokeCommand("", ctxB.ctx);
    expect(host.isOpen()).toBe(true);

    // …then a racing duplicate resume no-ops (openPanel single-instance
    // guard returns false): no throw, panel stays open exactly once.
    expect(() => resumePanel(ctxB.ctx)).not.toThrow();
    expect(resumePanel).toHaveBeenCalledTimes(2);
    expect(host.isOpen()).toBe(true);
  });
});

// ------------------------------------------- onReopen real hook (P1.M4.T1.S2)

/**
 * Executor ctx for the reopen path (tool.test.ts tuiCtx shape): TUI with UI,
 * so the {reopen:true} branch actually consults deps.onReopen.
 */
const REOPEN_TUI_CTX = { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };

/** Tool-definition execute wraps the executor string in a text block. */
function resultText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? "";
}

interface CapturedTool {
  execute: (
    toolCallId: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: { action: string } }>;
}

interface FactoryHarness {
  /** Fire every handler the factory registered for `event` (MockPi-style). */
  fire(event: string, payload: Record<string, unknown>, ctx: unknown): void;
  /** The tool definition capture of pi.registerTool (execute closes over
   * the REAL onReopen hook from index.ts's factory closure). */
  tool: CapturedTool;
}

/**
 * Drive the REAL extension factory (index.ts) against a capture-only pi —
 * the seam the codebase already fakes (MockPi conventions), never a pi
 * runtime (AUTOMATION-POLICY). Every factory registration is a tolerant
 * capture: handlers are recorded by event name, registerTool captures the
 * interrogate tool whose execute closure contains the REAL onReopen hook.
 * No event fires except the ones a test explicitly dispatches.
 */
async function makeFactoryHarness(): Promise<FactoryHarness> {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
  const tools: CapturedTool[] = [];
  const pi = {
    on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    }),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerEntryRenderer: vi.fn(),
    appendEntry: vi.fn(),
    registerTool: vi.fn((tool: CapturedTool) => {
      tools.push(tool);
    }),
  } as unknown as ExtensionAPI;
  await interrogatorExtension(pi);
  if (tools.length === 0) throw new Error("factory never registered the interrogate tool");
  return {
    fire(event, payload, ctx) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(payload, ctx);
    },
    tool: tools[tools.length - 1]!,
  };
}

/**
 * Flip the factory's internal panel host into the "suspended" phase: the
 * host record is module-scoped in panel.ts, so openPanel (fresh surface →
 * phase "open") followed by done(null) (the floating .then → markSuspended)
 * leaves the hook's panelHost.isSuspended() true.
 */
async function suspendFactoryHost(state: InterrogationState): Promise<void> {
  const calls = openOnSurface(state);
  calls[calls.length - 1]!.done(null);
  await new Promise<void>((resolve) => setImmediate(resolve)); // flush the .then
}

describe("onReopen — real factory hook (BUG-005 resume half)", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_reopen_hook_answered_only_suspended_state_reopens", async () => {
    const h = await makeFactoryHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.applyAnswer("q1", { value: "a", at: new Date().toISOString() }); // 0 open, 1 answered
    setState(state);
    await suspendFactoryHost(state);

    // Production event order: the stash fires on tool_execution_start,
    // BEFORE the reopen executes inside the tool call.
    const { surface } = makeSurfacePi();
    h.fire("tool_execution_start", { toolName: "interrogate", toolCallId: "c1" }, surface);

    const result = await h.tool.execute("c1", { reopen: true }, undefined, undefined, REOPEN_TUI_CTX);

    expect(resultText(result).endsWith("Panel reopened.")).toBe(true);
    // The hook resumed through the stashed interrogate ctx (carrier identity).
    expect(resumePanel).toHaveBeenCalledTimes(1);
    expect(resumePanel).toHaveBeenCalledWith(surface);
  });

  test("test_reopen_hook_submitted_only_and_reasked_only_states_reopen", async () => {
    for (const status of ["submitted", "reasked"] as const) {
      const h = await makeFactoryHarness();
      const state = createInterrogationState("goal");
      state.upsertQuestion(choiceQ("q1"));
      state.setStatus("q1", status);
      setState(state);
      await suspendFactoryHost(state);

      const { surface } = makeSurfacePi();
      h.fire("tool_execution_start", { toolName: "interrogate", toolCallId: "c1" }, surface);

      const result = await h.tool.execute("c1", { reopen: true }, undefined, undefined, REOPEN_TUI_CTX);
      expect(resultText(result).endsWith("Panel reopened.")).toBe(true);
      expect(resumePanel).toHaveBeenCalledWith(surface);
    }
  });

  test("test_reopen_hook_terminal_only_state_stays_no_state", async () => {
    const h = await makeFactoryHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.setStatus("q1", "moot");
    setState(state);
    await suspendFactoryHost(state);

    const { surface } = makeSurfacePi();
    h.fire("tool_execution_start", { toolName: "interrogate", toolCallId: "c1" }, surface);

    const result = await h.tool.execute("c1", { reopen: true }, undefined, undefined, REOPEN_TUI_CTX);
    expect(resultText(result).endsWith("No open questions to reopen.")).toBe(true);
    expect(resumePanel).not.toHaveBeenCalled();
  });

  test("test_reopen_hook_post_completion_cleared_state_stays_no_state", async () => {
    const h = await makeFactoryHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.applyAnswer("q1", { value: "a", at: new Date().toISOString() });
    state.clearForCompletion(); // h3.9: completion clears the live map
    setState(state);
    await suspendFactoryHost(state);

    const { surface } = makeSurfacePi();
    h.fire("tool_execution_start", { toolName: "interrogate", toolCallId: "c1" }, surface);

    const result = await h.tool.execute("c1", { reopen: true }, undefined, undefined, REOPEN_TUI_CTX);
    expect(resultText(result).endsWith("No open questions to reopen.")).toBe(true);
    expect(resumePanel).not.toHaveBeenCalled();
  });

  test("test_reopen_hook_missing_resume_surface_stays_no_state", async () => {
    // The resumeSurface === undefined guard is surface-carrier plumbing and
    // must survive BUG-005: without a stashed interrogate ctx the hook never
    // resumes, even with live questions (crash-guard for resumePanel).
    const h = await makeFactoryHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.applyAnswer("q1", { value: "a", at: new Date().toISOString() });
    setState(state);
    await suspendFactoryHost(state);
    // NO tool_execution_start fired → resumeSurface stays undefined.

    const result = await h.tool.execute("c1", { reopen: true }, undefined, undefined, REOPEN_TUI_CTX);
    expect(resultText(result).endsWith("No open questions to reopen.")).toBe(true);
    expect(resumePanel).not.toHaveBeenCalled();
  });
});

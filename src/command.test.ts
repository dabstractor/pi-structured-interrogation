/**
 * Unit tests for src/command.ts (P1.M6.T1.S2 as amended by the breakOut
 * removal — /interrogate is INVOKE-ONLY).
 *
 * Follows debug-commands.test.ts stubbing conventions (fake pi recording
 * registerCommand calls; handlers invoked directly with a stub ctx) and
 * panel.test.ts's host-fixture approach (createPanelHost + real
 * InterrogationState seeded through the raw primitives; a `ui.custom` mock
 * returning a promise that never resolves until done()).
 *
 * resumePanel is mocked AT THE S1 SEAM (panel/suspend.ts) with a spy that
 * DELEGATES to the real implementation — so tests both assert "the command
 * consumed S1" (call counts / carrier identity) and exercise the real host
 * phase transitions (resume → open).
 *
 * Coverage: the invoke decision table (open → silent no-op — NEVER suspend;
 * suspended ∧ live → resume; suspended ∧ dead → exact h2.37 empty-state
 * notify; closed ∧ live state → fresh open — the reload row; closed ∧ no
 * state → notify), the BUG-005 answered/submitted/reasked-pending resume
 * rows, the terminal-only dead-panel edge, the non-TUI mode guard, NO
 * registerShortcut call (the ctrl+shift+q chord is gone — window managers
 * claim it on many desktops), double-invoke idempotency, and the REAL
 * index.ts onReopen factory hook driven through a captured registerTool
 * execute (BUG-005 resume half).
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import interrogatorExtension from "./index.js";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { interrogateInvokeAction, registerInterrogateCommand } from "./command.js";
import type { DebugSubcommandHandler } from "./debug-commands.js";
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
  getArgumentCompletions?: (
    argumentPrefix: string,
  ) => Array<{ value: string; label: string; description?: string }> | null;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface Harness {
  host: PanelHost;
  config: InterrogatorConfig;
  commands: Map<string, CapturedCommand>;
  /** registerShortcut calls (must stay EMPTY — the breakOut chord is gone). */
  shortcutCalls: unknown[][];
  invokeCommand(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

/** Fresh host + registration capture. The host record is module-scoped, so
 * every harness re-arms it via createPanelHost (panel.test.ts convention). */
function makeHarness(
  config: InterrogatorConfig = DEFAULT_CONFIG,
  opts?: { debug?: DebugSubcommandHandler },
): Harness {
  const host = createPanelHost(makeMockLifecycle().lifecycle);
  const commands = new Map<string, CapturedCommand>();
  const shortcutCalls: unknown[][] = [];
  const pi = {
    registerCommand: vi.fn((name: string, def: CapturedCommand) => {
      commands.set(name, def);
    }),
    registerShortcut: vi.fn((...args: unknown[]) => {
      shortcutCalls.push(args);
    }),
  } as unknown as Pick<ExtensionAPI, "registerCommand" | "registerShortcut">;

  registerInterrogateCommand(pi as ExtensionAPI, config, host, opts);

  return {
    host,
    config,
    commands,
    shortcutCalls,
    invokeCommand(args, ctx) {
      return commands.get("interrogate")!.handler(args, ctx);
    },
  };
}

/**
 * CMD-001 dispatch-test helper: harness + a fresh command ctx whose notify
 * spy is directly assertable (makeCtx's wrapper, exposed flat).
 */
function makeHarnessWithCtx(
  opts?: Parameters<typeof registerInterrogateCommand>[3],
): ReturnType<typeof makeHarness> & { ctx: ExtensionCommandContext; notify: ReturnType<typeof vi.fn> } {
  const h = makeHarness(DEFAULT_CONFIG, opts);
  const notify = vi.fn();
  const ctx = { ui: { notify }, mode: "tui" } as unknown as ExtensionCommandContext;
  return { ...h, ctx, notify };
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
    expect(def!.description).toContain("Open or resume");
    // CMD-001: /interrogate is the ONE command — nothing else competes for
    // the "/inter" autocomplete prefix.
    expect([...commands.keys()]).toEqual(["interrogate"]);
  });

  test("test_subcommand_ping_notifies_pong", async () => {
    const { invokeCommand, ctx } = makeHarnessWithCtx();
    await invokeCommand("ping", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("pi-interrogator: pong", "info");
  });

  test("test_subcommand_debug_delegates_and_reports_unavailable", async () => {
    const debugCalls: string[] = [];
    const { commands, ctx } = makeHarnessWithCtx({
      debug: async (args) => {
        debugCalls.push(args);
      },
    });
    await commands.get("interrogate")!.handler("debug state", ctx);
    expect(debugCalls).toEqual(["state"]);
    await commands.get("interrogate")!.handler("debug  upsert {\"a\":1}", ctx);
    expect(debugCalls).toEqual(["state", 'upsert {"a":1}']);
    // No debug seam wired → the branch reports it (never throws).
    const bare = makeHarnessWithCtx();
    await bare.commands.get("interrogate")!.handler("debug state", bare.ctx);
    expect(bare.notify.mock.calls.some((c) => /unavailable/.test(c[0]))).toBe(true);
  });

  test("test_unknown_subcommand_notifies_usage", async () => {
    const { invokeCommand, ctx, notify } = makeHarnessWithCtx();
    await invokeCommand("explode", ctx);
    const [text, level] = notify.mock.calls[0] as [string, string];
    expect(text).toContain('unknown subcommand "explode"');
    expect(text).toContain("ping | debug upsert|submit|state");
    expect(level).toBe("warning");
  });

  test("test_bare_invocation_invokes_with_mode_guard", async () => {
    // Empty/whitespace args → the immediate-invoke path, TUI guard intact
    // (never a keypress gate; never a suspend toggle).
    const { invokeCommand, ctx } = makeHarnessWithCtx();
    Object.assign(ctx, { mode: "rpc" });
    await invokeCommand("   ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("The interrogation panel requires TUI mode", "info");
  });

  test("test_argument_completions_surface_subcommands", () => {
    const { commands } = makeHarness();
    const comp = commands.get("interrogate")!.getArgumentCompletions!;
    const values = (prefix: string): string[] =>
      (comp(prefix) ?? []).map((i: { value: string }) => i.value);
    // Top level after a space: ping + debug.
    expect(values("")).toEqual(["ping", "debug"]);
    expect(values("pi")).toEqual(["ping"]);
    expect(values("d")).toEqual(["debug"]);
    expect(values("zzz")).toEqual([]); // null → no suggestions
    expect(comp("zzz")).toBeNull();
    // Debug level: values carry the full replacement text (pi-tui swaps the
    // whole argument prefix for item.value).
    expect(values("debug ")).toEqual(["debug upsert", "debug submit", "debug state"]);
    expect(values("debug s")).toEqual(["debug submit", "debug state"]);
    expect(values("debug up")).toEqual(["debug upsert"]);
    expect(comp("other ")).toBeNull();
  });

  test("test_no_global_shortcut_registered", () => {
    // breakOut removal: the historical ctrl+shift+q registerShortcut is
    // GONE — that chord closes windows on many desktop environments (the
    // WM claims it before the terminal sees the bytes), so the extension
    // must never register it, under any config.
    const rebound: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, submit: "ctrl+alt+x" },
    };
    expect(makeHarness(DEFAULT_CONFIG).shortcutCalls).toEqual([]);
    expect(makeHarness(rebound).shortcutCalls).toEqual([]);
  });
});

describe("interrogateInvokeAction — decision table", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_invoke_matrix_all_rows", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));

    // Row 1: open host → ALREADY INVOKED — the command never suspends
    // (invoke-only semantics: suspending here is what historically demanded
    // a second keypress to get the panel back).
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    openOnSurface(state);
    expect(host.isOpen()).toBe(true);
    const surface = makeSurfacePi();
    expect(interrogateInvokeAction(host, surface.surface as never, state)).toBe("open");
    expect(host.isOpen()).toBe(true);
    expect(suspendPanel).not.toHaveBeenCalled();

    // Row 2: suspended ∧ open>0 → resumePanel → "resumed"
    suspendPanel(host);
    expect(interrogateInvokeAction(host, surface.surface as never, state)).toBe("resumed");
    expect(host.isOpen()).toBe(true);

    // Row 2b (BUG-005 flip, h2.2/h3.4): suspended ∧ answered-pending
    // (0 open) → "resumed" — the panel resurfaces so the user can ctrl+s.
    suspendPanel(host);
    const answered = createInterrogationState("goal");
    answered.upsertQuestion(choiceQ("q1"));
    answered.applyAnswer("q1", { value: "a", at: new Date().toISOString() }); // open → answered
    setState(answered);
    expect(interrogateInvokeAction(host, surface.surface as never, answered)).toBe("resumed");
    expect(host.isOpen()).toBe(true);

    // Row 2c/2d: submitted-only / reasked-only are live too (BUG-005 set).
    for (const status of ["submitted", "reasked"] as const) {
      suspendPanel(host);
      const s = createInterrogationState("goal");
      s.upsertQuestion(choiceQ("q1"));
      s.setStatus("q1", status);
      setState(s);
      expect(interrogateInvokeAction(host, surface.surface as never, s)).toBe("resumed");
      expect(host.isOpen()).toBe(true);
    }

    // Row 3: suspended ∧ truly dead — terminal-only state (moot;
    // withdrawn/closed equally) → "empty", host stays suspended.
    suspendPanel(host);
    const dead = createInterrogationState("goal");
    dead.upsertQuestion(choiceQ("q1"));
    dead.setStatus("q1", "moot");
    setState(dead);
    expect(interrogateInvokeAction(host, surface.surface as never, dead)).toBe("empty");
    expect(host.isOpen()).toBe(false);
    expect(host.isSuspended()).toBe(true);

    // Row 3b: empty state (zero questions — post-clearForCompletion
    // equivalent) is equally dead → "empty".
    const cleared = createInterrogationState("goal");
    setState(cleared);
    expect(interrogateInvokeAction(host, surface.surface as never, cleared)).toBe("empty");

    // Row 4: closed host ∧ LIVE state → fresh open from the singleton —
    // the reload row (extension reload leaves a fresh host record while
    // reconstruction/last events left live questions in state).
    const closedHost = createPanelHost(makeMockLifecycle().lifecycle);
    const freshSurface = makeSurfacePi();
    const live = createInterrogationState("goal");
    live.upsertQuestion(choiceQ("q1"));
    setState(live);
    expect(
      interrogateInvokeAction(closedHost, freshSurface.surface as never, live, {
        config: DEFAULT_CONFIG,
      }),
    ).toBe("opened");
    expect(closedHost.isOpen()).toBe(true);

    // Row 5: closed host, no state → "empty".
    const closedHost2 = createPanelHost(makeMockLifecycle().lifecycle);
    expect(interrogateInvokeAction(closedHost2, surface.surface as never, undefined)).toBe("empty");
  });

  test("test_closed_host_without_opts_falls_to_empty_not_throw", () => {
    // The fresh-open row needs opts (config) — without them the action must
    // degrade to "empty", never throw (the registration always passes opts;
    // this pins the pure core's guard).
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    const surface = makeSurfacePi();
    expect(interrogateInvokeAction(host, surface.surface as never, state)).toBe("empty");
    expect(host.isOpen()).toBe(false);
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

  test("test_invoke_on_open_panel_keeps_it_open_and_silent", async () => {
    // The reload-complaint regression: with the panel OPEN, /interrogate
    // must NOT suspend it (the old toggle behavior dismissed the panel and
    // demanded a keypress to bring it back). Silent no-op success.
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);
    expect(host.isOpen()).toBe(true);

    const { ctx, notify } = makeCtx();
    await expect(invokeCommand("", ctx)).resolves.toBeUndefined();

    expect(suspendPanel).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  test("test_invoke_resumes_when_suspended", async () => {
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);

    const first = makeCtx();
    suspendPanel(host); // esc-equivalent suspend, NOT the command
    expect(host.isSuspended()).toBe(true);

    const second = makeCtx();
    await invokeCommand("", second.ctx); // suspended → resumed via S1 resumePanel

    expect(resumePanel).toHaveBeenCalledTimes(1);
    // The command ctx is the PiUISurface carrier handed to S1 (maybeAutoOpen pattern).
    expect(resumePanel).toHaveBeenCalledWith(second.ctx);
    expect(host.isOpen()).toBe(true);
    expect(second.notify).not.toHaveBeenCalled();
  });

  test("test_invoke_empty_state_notifies_exact_string", async () => {
    const { invokeCommand } = makeHarness(); // closed host, no singleton state
    const { ctx, notify } = makeCtx();

    await invokeCommand("", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(EMPTY_MESSAGE, "info");
    expect(suspendPanel).not.toHaveBeenCalled();
    expect(resumePanel).not.toHaveBeenCalled();
  });

  test("test_invoke_empty_state_with_args_same_notify", async () => {
    const { invokeCommand } = makeHarness();
    const { ctx, notify } = makeCtx();

    // CMD-001 supersedes h2.15's "args are ignored": args now dispatch
    // subcommands, and an UNKNOWN one never throws — it notifies the usage
    // line (warning) instead of the empty-state message.
    await expect(invokeCommand("focus q1 --whatever", ctx)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain('unknown subcommand "focus"');
    expect(notify.mock.calls[0][1]).toBe("warning");
  });

  test("test_invoke_suspended_answered_pending_resumes_silently", async () => {
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
    suspendPanel(host); // esc-equivalent suspend, NOT the command
    expect(host.isSuspended()).toBe(true);

    const second = makeCtx();
    await invokeCommand("", second.ctx);

    expect(second.notify).not.toHaveBeenCalled();
    expect(resumePanel).toHaveBeenCalledTimes(1);
    expect(host.isOpen()).toBe(true);
  });

  test("test_invoke_suspended_terminal_only_dead_panel_notifies", async () => {
    const { host, invokeCommand } = makeHarness();
    // Re-targeted negative coverage: a TRULY dead panel (all terminal —
    // moot here; withdrawn/closed identical) still notifies the empty-state
    // toast and never resumes.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.setStatus("q1", "moot");
    setState(state);
    openOnSurface(state);
    suspendPanel(host); // esc-equivalent suspend, NOT the command
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

// ----------------------------------------- invoke idempotency (cycle safety)

describe("/interrogate — invoke idempotency", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetState();
  });

  test("test_repeated_invoke_never_wedges_the_host", async () => {
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);
    openOnSurface(state);

    // Repeated /interrogate on the open panel: silent no-ops every time —
    // no throw, no duplicate done(), panel stays open exactly once.
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx();
      await expect(invokeCommand("", ctx.ctx)).resolves.toBeUndefined();
      expect(ctx.notify).not.toHaveBeenCalled();
      expect(host.isOpen()).toBe(true);
    }
    expect(suspendPanel).not.toHaveBeenCalled();

    // Suspend (esc-equivalent), then invoke resumes…
    suspendPanel(host);
    const ctxB = makeCtx();
    await invokeCommand("", ctxB.ctx);
    expect(resumePanel).toHaveBeenCalledTimes(1);
    expect(host.isOpen()).toBe(true);

    // …and a racing duplicate resume no-ops (openPanel single-instance
    // guard returns false): no throw, panel stays open exactly once.
    expect(() => resumePanel(ctxB.ctx)).not.toThrow();
    expect(resumePanel).toHaveBeenCalledTimes(2);
    expect(host.isOpen()).toBe(true);
  });

  test("test_invoke_after_reload_opens_from_closed_host", async () => {
    // Reload row through the REAL registration: a closed host record with
    // live state opens the panel immediately — no keypress, no notify.
    const { host, invokeCommand } = makeHarness();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    setState(state);

    const { ctx, notify, calls } = makeCtx();
    await invokeCommand("", ctx);

    expect(notify).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(true);
    expect(calls.length).toBe(1); // a real custom() panel mounted
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

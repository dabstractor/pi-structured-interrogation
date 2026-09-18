/**
 * src/reload-invoke.test.ts — extension-reload + /interrogate regression
 * suite (the "Ctrl+Shift+Q gate" complaint).
 *
 * Reproduces the reported flow END-TO-END through the REAL factory: a true
 * /reload is simulated with vi.resetModules() + dynamic import, so the
 * second factory run gets a FRESH module graph (fresh panel-host record,
 * fresh state singleton) exactly like pi rebuilding the extension runtime —
 * then session_start {reason:"reload"} fires against a sessionManager whose
 * branch carries the pre-reload interrogate tool result (reconstruction
 * input), and the user types /interrogate.
 *
 * Regression pins (breakOut removal + invoke-only /interrogate):
 * 1. NO global shortcut is registered (ctrl+shift+q closes windows on many
 *    desktop environments — the WM claims the chord before the terminal
 *    sees the bytes).
 * 2. After the reload the panel auto-opens (reconstruction) and the stale
 *    pre-reload suspend widget line is cleared.
 * 3. /interrogate while the panel is OPEN keeps it open — silent no-op,
 *    NEVER a suspend that would strand the user behind a keypress gate.
 * 4. /interrogate with the panel SUSPENDED resumes it immediately.
 * 5. /interrogate on a CLOSED host with live state opens the panel fresh
 *    (the reload-row safety net).
 * 6. The suspend widget line names /interrogate only — no key chord ever.
 */
import { describe, expect, test, vi, type Mock } from "vitest";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

type EventHandler = (event: unknown, ctx: unknown) => void;

/**
 * Capture-only fake pi: records commands/shortcuts/tools/event
 * subscriptions; a widget registry emulating pi's app-level keyed widgets
 * (which SURVIVE an extension reload — the stale-reminder precondition);
 * a custom() whose promise resolves only on done() (the blocking contract).
 */
class FakePi {
  commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
  shortcutCalls: unknown[][] = [];
  tools = new Map<string, { execute: (id: string, params: unknown, s: unknown, u: unknown, ctx: unknown) => Promise<unknown> }>();
  events = new Map<string, EventHandler[]>();
  widget: string[] | undefined;
  notifies: Array<{ text: string; severity: string }> = [];
  customCalls: Array<{ done: (r: null) => void }> = [];

  api(): ExtensionAPI {
    return {
      registerCommand: (name: string, def: unknown) => {
        this.commands.set(name, def as never);
      },
      registerShortcut: (...args: unknown[]) => {
        this.shortcutCalls.push(args);
      },
      registerTool: (tool: unknown) => {
        this.tools.set((tool as { name: string }).name, tool as never);
      },
      on: (event: string, handler: unknown) => {
        const list = this.events.get(event) ?? [];
        list.push(handler as never);
        this.events.set(event, list);
        return undefined;
      },
      registerMessageRenderer: vi.fn() as never,
      registerEntryRenderer: vi.fn() as never,
    } as unknown as ExtensionAPI;
  }

  emit(event: string, ev: unknown, ctx: unknown) {
    for (const h of [...(this.events.get(event) ?? [])]) h(ev, ctx);
  }

  ctx(mode = "tui", branch: SessionEntry[] = []) {
    return {
      mode,
      hasUI: mode === "tui",
      sessionManager: { getBranch: () => branch },
      ui: {
        custom: ((
          factory: (tui: unknown, theme: unknown, kb: unknown, done: (r: null) => void) => unknown,
        ) => {
          let resolve!: (r: null | undefined) => void;
          const promise = new Promise<null | undefined>((res) => {
            resolve = res;
          });
          factory({} as never, {} as never, {} as never, (r) => resolve(r));
          this.customCalls.push({ done: (r) => resolve(r) });
          return promise;
        }) as unknown as Mock,
        setWidget: (key: string, content: string[] | undefined) => {
          if (key === "interrogator") this.widget = content;
        },
        notify: (text: string, severity: string) => this.notifies.push({ text, severity }),
      },
    };
  }

  async invokeInterrogate(ctx: unknown) {
    await this.commands.get("interrogate")!.handler("", ctx);
  }
}

function toolResultEntry(state: unknown): SessionEntry {
  return {
    type: "message",
    id: `t${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "interrogate",
      content: [{ type: "text", text: "ok" }],
      details: { state },
    },
  } as unknown as SessionEntry;
}

describe("extension reload + /interrogate (breakOut gate removal)", () => {
  test("test_reload_then_interrogate_invokes_panel_immediately_no_key_gate", async () => {
    // ---- Round 1: the pre-reload session — interrogation ran, panel open.
    const mod1 = await import("./index.js");
    const pi1 = new FakePi();
    await mod1.default(pi1.api() as never);

    const ctx1 = pi1.ctx("tui", []);
    pi1.emit("session_start", { reason: "startup" }, ctx1);

    const params = {
      questions: [
        { id: "q1", prompt: "p", type: "choice", options: [{ value: "a", label: "A" }] },
      ],
    };
    pi1.emit("tool_execution_start", { toolCallId: "c1", toolName: "interrogate", args: params }, ctx1);
    await pi1.tools.get("interrogate")!.execute("c1", params, undefined, undefined, ctx1);
    pi1.emit("tool_execution_end", { toolCallId: "c1", toolName: "interrogate", isError: false }, ctx1);
    expect(pi1.customCalls.length).toBe(1); // panel auto-opened on the upsert

    // User suspends (esc) → the OLD widget line appears.
    pi1.customCalls[0]!.done(null);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pi1.widget).toEqual(["1 open · 0 answered — /interrogate to resume"]);
    expect(pi1.widget![0]).not.toMatch(/ctrl|alt\+|super\+|shift\+/i);

    // The branch pi will hand the reloaded runtime: the interrogate tool
    // result carries the canonical details.state (reconstruction input).
    const state1 = (await import("./state.js")).getState();
    expect(state1).toBeDefined();
    const branch: SessionEntry[] = [toolResultEntry(state1!.serialize())];

    // ---- Round 2: /reload — fresh module graph, same session, stale widget.
    vi.resetModules();
    const mod2 = await import("./index.js");
    const pi2 = new FakePi();
    await mod2.default(pi2.api() as never);

    // Pin 1: no global shortcut is registered by the reloaded factory.
    expect(pi2.shortcutCalls).toEqual([]);

    // The stale pre-reload widget is still visible (pi app state survives).
    pi2.widget = pi1.widget;

    pi2.emit("session_start", { reason: "reload" }, pi2.ctx("tui", branch));

    // Pin 2: reconstruction auto-opened the panel and cleared the widget.
    expect(pi2.customCalls.length).toBe(1);
    expect(pi2.widget).toBeUndefined();

    // Pin 3: /interrogate with the panel OPEN keeps it open — silent
    // no-op success (the old toggle SUSPENDED here and left the widget
    // demanding Ctrl+Shift+Q — the reported complaint).
    await pi2.invokeInterrogate(pi2.ctx("tui", branch));
    expect(pi2.customCalls.length).toBe(1); // no dismiss, no reopen — steady
    expect(pi2.notifies).toEqual([]);
    expect(pi2.widget).toBeUndefined();
  });

  test("test_reload_suspended_panel_interrogate_resumes_immediately", async () => {
    const mod1 = await import("./index.js");
    const pi1 = new FakePi();
    await mod1.default(pi1.api() as never);
    const ctx1 = pi1.ctx("tui", []);
    pi1.emit("session_start", { reason: "startup" }, ctx1);
    const params = {
      questions: [
        { id: "q1", prompt: "p", type: "choice", options: [{ value: "a", label: "A" }] },
      ],
    };
    pi1.emit("tool_execution_start", { toolCallId: "c1", toolName: "interrogate", args: params }, ctx1);
    await pi1.tools.get("interrogate")!.execute("c1", params, undefined, undefined, ctx1);
    pi1.emit("tool_execution_end", { toolCallId: "c1", toolName: "interrogate", isError: false }, ctx1);
    const state1 = (await import("./state.js")).getState();
    const branch: SessionEntry[] = [toolResultEntry(state1!.serialize())];

    vi.resetModules();
    const mod2 = await import("./index.js");
    const pi2 = new FakePi();
    await mod2.default(pi2.api() as never);
    // The reload lands with the panel SUSPENDED (pre-reload state), the
    // stale widget visible, and reconstruction auto-reopens — then the user
    // SUSPENDS again (esc) before typing /interrogate.
    pi2.emit("session_start", { reason: "reload" }, pi2.ctx("tui", branch));
    expect(pi2.customCalls.length).toBe(1);
    pi2.customCalls[0]!.done(null); // esc-equivalent suspend
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pi2.widget).toEqual(["1 open · 0 answered — /interrogate to resume"]);

    // Pin 4: /interrogate resumes the suspended panel immediately.
    await pi2.invokeInterrogate(pi2.ctx("tui", branch));
    expect(pi2.customCalls.length).toBe(2); // a fresh panel mounted
    expect(pi2.notifies).toEqual([]);
    expect(pi2.widget).toBeUndefined(); // cleared on open
  });

  test("test_closed_host_with_live_state_interrogate_opens_fresh", async () => {
    // Pin 5 (the reload-row safety net): the host record is closed (e.g.
    // reload reconstruction could not mount a panel) while the session
    // singleton holds live questions — /interrogate must OPEN the panel,
    // not notify an empty state.
    const mod1 = await import("./index.js");
    const pi1 = new FakePi();
    await mod1.default(pi1.api() as never);
    const ctx1 = pi1.ctx("tui", []);
    pi1.emit("session_start", { reason: "startup" }, ctx1);
    const params = {
      questions: [
        { id: "q1", prompt: "p", type: "choice", options: [{ value: "a", label: "A" }] },
      ],
    };
    pi1.emit("tool_execution_start", { toolCallId: "c1", toolName: "interrogate", args: params }, ctx1);
    await pi1.tools.get("interrogate")!.execute("c1", params, undefined, undefined, ctx1);
    const state1 = (await import("./state.js")).getState();
    const branch: SessionEntry[] = [toolResultEntry(state1!.serialize())];

    vi.resetModules();
    const mod2 = await import("./index.js");
    const pi2 = new FakePi();
    await mod2.default(pi2.api() as never);

    // session_start fires with a NON-TUI ctx first (reconstruction falls
    // back without a panel)… the session then lands in TUI with the state
    // installed and a closed host.
    pi2.emit("session_start", { reason: "reload" }, pi2.ctx("print", branch));
    expect(pi2.customCalls.length).toBe(0);

    // The tool re-orients with a TUI upsert: the panel mounts via the
    // auto-open path. Then the user suspends, and a SECOND reload-style
    // reset… — simpler and just as load-bearing: suspend, then dispose the
    // host residue via a fresh session_start on a dead branch is NOT the
    // scenario; instead pin the pure closed-host row directly:
    // suspend (esc) then invoke — resumes.
    // A read (re-orient) call — same rev, no upsert semantics; the panel
    // mounts via maybeAutoOpen on tool_execution_end.
    pi2.emit("tool_execution_start", { toolCallId: "c2", toolName: "interrogate", args: {} }, pi2.ctx("tui", branch));
    await pi2.tools.get("interrogate")!.execute("c2", {}, undefined, undefined, pi2.ctx("tui", branch));
    pi2.emit("tool_execution_end", { toolCallId: "c2", toolName: "interrogate", isError: false }, pi2.ctx("tui", branch));
    expect(pi2.customCalls.length).toBe(1);
    pi2.customCalls[0]!.done(null); // suspend
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Closed-host-with-live-state via the pure core (registration seam
    // always passes opts, so this row is reachable through the command):
    // recreate by disposing the suspended host's record through a dead
    // branch reconstruction.
    pi2.emit("session_tree", {}, pi2.ctx("tui", []));
    // State reset by reconstruction on a branch without interrogation — the
    // empty-state notify is CORRECT there (no live questions). To pin the
    // live-state row we instead reuse round 1's state singleton:
    const modState = await import("./state.js");
    modState.setState(state1 as never);

    await pi2.invokeInterrogate(pi2.ctx("tui", branch));
    expect(pi2.notifies).toEqual([]); // live state → never the empty toast
    expect(pi2.customCalls.length).toBe(2); // panel opened
  });
});

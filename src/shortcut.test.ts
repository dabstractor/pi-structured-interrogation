/**
 * src/shortcut.test.ts — PANELTOGGLE-001 global toggle shortcut coverage.
 *
 * Pins the registration seam (src/shortcut.ts):
 * - gating — `panelShortcut: false` touches NO pi surface; default (true)
 *   registers exactly one shortcut on `keys.toggle`;
 * - accelerator resolution — the config accelerator verbatim when valid,
 *   the h2.52 default with exactly ONE console.warn when invalid (the
 *   resolveBindings contract, single-layer);
 * - handler legs — open host → host.suspend() (the defensive close leg),
 *   and the empty outcome → the byte-identical h2.37 empty-state notify
 *   (command.ts's exported string — the same surface /interrogate shows).
 *
 * The open/resume legs beyond "empty" (suspended-live resume, closed-live
 * fresh-open) are command.test.ts's interrogateInvokeAction table — this
 * file pins the WRAPPER, not the invoke core. The in-panel close leg
 * (onToggle → suspend) is pinned by config-surface.test.ts's exhaustive
 * remap suite (toggle rides ALL_ACTIONS).
 *
 * Conventions: command.test.ts harness shapes — a spy `pi` cast to the
 * narrow structural surface (`Pick<ExtensionAPI, "registerShortcut">`),
 * a stub PanelHost, module state reset through resetState().
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { EMPTY_STATE_MESSAGE } from "./command.js";
import type { PanelHost } from "./panel/panel.js";
import { registerPanelShortcut } from "./shortcut.js";
import { resetState } from "./state.js";

/** Spy registration surface: first-arg KeyId + options record. */
interface Registration {
  key: string;
  description?: string;
  handler: (ctx: ExtensionContext) => void;
}

function makePi(): { pi: Pick<ExtensionAPI, "registerShortcut">; calls: Registration[] } {
  const calls: Registration[] = [];
  const pi = {
    registerShortcut: (key: string, options: { description?: string; handler: (ctx: ExtensionContext) => void }) => {
      calls.push({ key, description: options.description, handler: options.handler });
    },
  };
  return { pi, calls };
}

/** Stub host — isOpen/suspend spy pair is all the handler touches. */
function makeHost(open = false): PanelHost & { suspendCalls: number } {
  let suspendCalls = 0;
  const host: PanelHost & { suspendCalls: number } = {
    isOpen: () => open,
    isSuspended: () => false,
    suspend() {
      suspendCalls += 1;
    },
    getPanel: () => undefined,
    retargetState: () => {},
    dispose: () => {},
    get suspendCalls() {
      return suspendCalls;
    },
  };
  return host;
}

/** TUI-shaped ctx stub — the handler reads mode/ui.notify only. */
function makeCtx(): ExtensionContext {
  return {
    mode: "tui",
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext;
}

function configWith(overrides: Partial<InterrogatorConfig>): InterrogatorConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetState();
});

describe("PANELTOGGLE-001 registration", () => {
  test("test_default_config_registers_exactly_one_shortcut_on_keys_toggle", () => {
    const { pi, calls } = makePi();
    registerPanelShortcut(pi, DEFAULT_CONFIG, makeHost());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe(DEFAULT_CONFIG.keys.toggle);
    expect(typeof calls[0]!.handler).toBe("function");
    expect(calls[0]!.description).toBeTruthy();
  });

  test("test_rebound_accelerator_registers_verbatim", () => {
    const { pi, calls } = makePi();
    registerPanelShortcut(
      pi,
      configWith({ keys: { ...DEFAULT_CONFIG.keys, toggle: "ctrl+alt+n" } }),
      makeHost(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("ctrl+alt+n");
  });

  test("test_panelShortcut_false_registers_nothing", () => {
    const { pi, calls } = makePi();
    registerPanelShortcut(pi, configWith({ panelShortcut: false }), makeHost());
    expect(calls).toHaveLength(0);
  });

  test("test_invalid_accelerator_falls_back_to_default_with_one_warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pi, calls } = makePi();
    registerPanelShortcut(
      pi,
      configWith({ keys: { ...DEFAULT_CONFIG.keys, toggle: "ctrl+" } }),
      makeHost(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe(DEFAULT_CONFIG.keys.toggle);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(" ")).toContain('"toggle"');
  });

  test("test_unnormalized_accelerator_normalizes_to_lowercase_keyid", () => {
    const { pi, calls } = makePi();
    registerPanelShortcut(
      pi,
      configWith({ keys: { ...DEFAULT_CONFIG.keys, toggle: " Ctrl+F9 " } }),
      makeHost(),
    );
    expect(calls[0]!.key).toBe("ctrl+f9");
  });
});

describe("PANELTOGGLE-001 handler", () => {
  test("test_open_host_suspends_without_invoking_or_notifying", async () => {
    const { pi, calls } = makePi();
    const host = makeHost(true);
    registerPanelShortcut(pi, DEFAULT_CONFIG, host);
    const ctx = makeCtx();
    await calls[0]!.handler(ctx);
    expect(host.suspendCalls).toBe(1);
    expect((ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  test("test_no_state_notifies_the_h237_empty_state_string", async () => {
    resetState(); // no interrogation exists
    const { pi, calls } = makePi();
    const host = makeHost(false); // closed host, nothing resumable
    registerPanelShortcut(pi, DEFAULT_CONFIG, host);
    const ctx = makeCtx();
    await calls[0]!.handler(ctx);
    expect(host.suspendCalls).toBe(0);
    expect(ctx.ui.notify).toHaveBeenCalledWith(EMPTY_STATE_MESSAGE, "info");
    expect(EMPTY_STATE_MESSAGE).toBe(
      "No active interrogation — ask the agent to interrogate you",
    );
  });
});

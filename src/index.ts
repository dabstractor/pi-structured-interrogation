/**
 * pi-interrogator — structured interrogation extension for pi.
 *
 * h2.0 core commitments:
 * - /interrogate panel: an embedded pi-tui Editor panel that walks the user
 *   through clarifying questions and collects structured answers.
 * - interrogate tool: the LLM-facing tool that upserts/reads question state
 *   and returns compact, non-blocking results.
 * - rev/epoch guards: stale asynchronous UI results are discarded when the
 *   underlying state has moved on.
 * - draft sacredness: the user's in-progress editor draft is preserved
 *   across panel open/close interactions.
 * - single in-memory state source of truth for the lifetime of the session.
 * - TUI-first, with a non-TUI fallback for headless/print mode.
 *
 * This file is the factory. It loads the interrogator config once at startup
 * (async factories are awaited by pi before session_start — docs/extensions.md
 * "The factory can be synchronous or asynchronous"), registers the
 * /interrogate-ping smoke-test command, and registers the `interrogate` tool
 * (h2.15) via createInterrogateTool, wires the auto-close lifecycle engine
 * (P1.M2.T2.S1 — h2.44 close pass on agent_settled), and plugs the one-time
 * completion trigger into its onAfterClosePass seam (P1.M2.T2.S2 — h3.9:
 * inject the full interrogation-completion record once, dismiss the panel,
 * clear in-memory state). The panel host and message renderers land in later
 * milestones.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCompletionTrigger } from "./completion.js";
import { loadConfig } from "./config.js";
import { registerDebugCommands } from "./debug-commands.js";
import { DraftStore } from "./draft-store.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { createPanelHost, maybeAutoOpen } from "./panel/panel.js";
import { createInterrogateTool } from "./tool.js";

export default async function interrogatorExtension(pi: ExtensionAPI): Promise<void> {
  const config = await loadConfig(process.cwd());

  pi.registerCommand("interrogate-ping", {
    description: "Smoke-test: proves the pi-interrogator extension loaded",
    handler: async (_args: string, ctx) => {
      ctx.ui.notify("pi-interrogator: pong", "info");
    },
  });

  pi.registerTool(createInterrogateTool(config));

  // P1.M2.T2.S1 — auto-close engine (h2.44): subscribes tool_execution_start/end
  // + agent_settled and runs the idempotent close pass after each settle.
  // P1.M2.T2.S2 — completion trigger (h3.9) plugged into onAfterClosePass:
  // injects the one full interrogation-completion record, dismisses the
  // panel, then clears in-memory state (exactly once per interrogation).
  //
  // Circularity note: the trigger needs the lifecycle (dismissPanel) and the
  // engine needs the trigger (onAfterClosePass). Resolved with a late-binding
  // shim — the shim closure reads the `lifecycle` binding lazily at call
  // time, by which point the assignment below has completed (no close pass
  // can run before this factory returns, so the binding is never undefined).
  let lifecycle: Lifecycle;
  lifecycle = createLifecycle(pi, {
    onAfterClosePass: createCompletionTrigger(pi, {
      lifecycle: {
        dismissPanel: () => lifecycle.dismissPanel(),
      },
    }),
  });

  // P1.M2.T3.S1 — debug commands for scripted verification (h2.50): share
  // the tool executor / submission path so keyboard-driven runs are evidence
  // about the production path. Uses the same single-loaded config.
  registerDebugCommands(pi, config);

  // P1.M3.T1.S1 — panel host: opens on the first interrogate upsert in TUI
  // mode (fire-and-forget custom(), h2.0 commitment 1), persists while the
  // agent is idle, suspends via done(null) (h2.35) — also reachable through
  // lifecycle.dismissPanel() from the completion flow — and reopens when a
  // later upsert lands while suspended (h2.37). Panel host + auto-open:
  const panelHost = createPanelHost(lifecycle);
  // P1.M4.T2.S1 — R4 draft store (h2.45): ONE instance per extension
  // activation, held in this closure and passed to every openPanel. Panel
  // components are destroyed on suspend/re-instantiation; this store is
  // not — that lifetime asymmetry IS the suspend/resume survival mechanism.
  // Restart loses drafts BY DESIGN (Q6=B): nothing here touches disk, and
  // persistence.ts (P1.M7.T1) must not serialize it.
  const drafts = new DraftStore();
  maybeAutoOpen(pi, config, panelHost, drafts);
}

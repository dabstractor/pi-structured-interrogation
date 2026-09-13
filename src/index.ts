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
 * (h2.15) via createInterrogateTool. The panel host, lifecycle subscriptions,
 * message renderers, and completion flow land in later milestones.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
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
}

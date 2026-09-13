/**
 * pi-interrogator — structured interrogation extension for pi.
 *
 * h2.0 core commitments:
 * - /interrogate panel: an embedded pi-tui Editor panel that walks the user
 *   through clarifying questions and collects structured answers.
 * - interrogate tool: the LLM-facing tool that opens the panel and returns
 *   the user's answers as tool content.
 * - rev/epoch guards: stale asynchronous UI results are discarded when the
 *   underlying state has moved on.
 * - draft sacredness: the user's in-progress editor draft is preserved
 *   across panel open/close interactions.
 * - single in-memory state source of truth for the lifetime of the session.
 * - TUI-first, with a non-TUI fallback for headless/print mode.
 *
 * This file is the factory; module registrations land in later subtasks.
 * Currently it registers only the /interrogate-ping smoke-test stub that
 * proves the extension loads and its commands are reachable.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function interrogatorExtension(pi: ExtensionAPI): void {
  pi.registerCommand("interrogate-ping", {
    description: "Smoke-test: proves the pi-interrogator extension loaded",
    handler: async (_args: string, ctx) => {
      ctx.ui.notify("pi-interrogator: pong", "info");
    },
  });
}

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
 * clear in-memory state). The panel host landed in P1.M3; the user-only
 * submission diff card renderer is registered here (P1.M7.T3.S1,
 * registerSubmissionCardRenderer) — the completion recap card / entry
 * renderers land in P1.M7.T3.S2. Persistence mirror (P1.M7.T1.S1): debounced
 * `interrogation-state` custom-entry appends + session_shutdown flush.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCompletionTrigger } from "./completion.js";
import { registerInterrogateCommand } from "./command.js";
import { createCompactionGuard } from "./compaction.js";
import { loadConfig } from "./config.js";
import { registerDebugCommands } from "./debug-commands.js";
import { DraftStore } from "./draft-store.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { createPanelHost, maybeAutoOpen } from "./panel/panel.js";
import { resumePanel } from "./panel/suspend.js";
import { createStateMirror } from "./persistence.js";
import { createReconstruction } from "./reconstruct.js";
import { registerSubmissionCardRenderer } from "./renderers.js";
import { getState } from "./state.js";
import { createInterrogateTool } from "./tool.js";

export default async function interrogatorExtension(pi: ExtensionAPI): Promise<void> {
  const config = await loadConfig(process.cwd());

  pi.registerCommand("interrogate-ping", {
    description: "Smoke-test: proves the pi-interrogator extension loaded",
    handler: async (_args: string, ctx) => {
      ctx.ui.notify("pi-interrogator: pong", "info");
    },
  });

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

  // P1.M7.T1.S1 — storage layer 3 (h2.40, FR-27): mirror every state mutation
  // into `interrogation-state` custom entries — an append-only audit trail
  // NOT in LLM context — as the fallback reconstruction (P1.M7.T1.S2) reads
  // when compaction drops the tool-result entry that carried canonical
  // details.state (Q37 residue). Debounced 2s per mutation window; the
  // session_shutdown handler (all reasons) flushes a pending window
  // synchronously. The mirror resolves the state singleton lazily — it does
  // not exist until the first interrogate upsert (tool.ts setState). No
  // extension dispose seam exists in this factory, so mirror.dispose()
  // stays available-but-unwired (subscriptions die with the runtime).
  const mirror = createStateMirror(pi);
  pi.on("session_shutdown", () => mirror.flush());

  // P1.M7.T2.S1 — compaction preservation (FR-29, h2.42): when pi compacts
  // mid-interrogation, the guard flushes THIS mirror (fresh interrogation-state
  // entry pre-compaction) and runs the summarization itself with the PRD's
  // preservation text prepended — pi 0.85.x SessionBeforeCompactResult has no
  // customInstructions return, so the custom-compaction pattern is the only
  // mechanism (see compaction.ts [Mode A] JSDoc). ANY failure falls through to
  // default compaction (undefined) — never cancels, never blocks.
  createCompactionGuard(pi, { config, mirror });

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

  // P1.M7.T1.S2 — reconstruction (h2.41/h2.43/h3.11, FR-28): on session_start
  // (all reasons) AND session_tree (mid-session branch navigation — ctx
  // already reflects the new leaf), rebuild the state from the RAW branch
  // (compaction not applied, so the canonical tool-result details.state
  // survives /compact), newest-mirror fallback, replay submission deltas,
  // recompute moot-ness, then auto-open the panel (TUI) or set the non-TUI
  // digest fallback flag. resetState() at the top of every run guarantees no
  // caching across session_shutdown. Drafts are NEVER restored (Q6=B) — the
  // store above passes through untouched (empty at start, by design).
  createReconstruction(pi, { config, host: panelHost, drafts });

  // P1.M6.T2.S1 — agent-judgment reopen (FR-6/Q12, h2.35): the tool's
  // {reopen:true} action resumes a suspended panel through the SAME
  // resumePanel path as the ctrl+shift+q / /interrogate hotkey — no
  // deterministic guard beyond host phase + open-question existence (the
  // agent's judgment is the gate; the always-visible suspend widget is the
  // user's safety net). Registered AFTER createPanelHost so the hook
  // closure captures the live host; the phase API isOpen()/isSuspended()
  // is the only state source (the module-private `phase` is never read
  // directly). The 0-open suspended edge mirrors S2's empty-state rule:
  // a dead panel is never resumed. Idempotency races are S1's concern
  // (resumePanel → openPanel no-ops when already open) — not duplicated
  // here.
  //
  // Surface carrier adaptation (PRP drift rule): the factory's `pi` is an
  // ExtensionAPI with NO `ui` (panel.ts's maybeAutoOpen note) — the
  // PiUISurface carrier is the per-event handler ctx, same as every other
  // panel entry point. reopen:true executes INSIDE an interrogate tool
  // call, whose tool_execution_start event has already fired, so stashing
  // that ctx gives the hook a fresh surface at the moment it runs. The
  // stash is defensively consulted for undefined only; state existence is
  // checked by the executor BEFORE the hook, and a suspended host implies
  // a prior panel ctx existed.
  let resumeSurface: ExtensionContext | undefined;
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName === "interrogate") resumeSurface = ctx;
  });
  pi.registerTool(
    createInterrogateTool(config, {
      onReopen: () => {
        if (panelHost.isOpen()) return "already-open";
        if (panelHost.isSuspended()) {
          const open = getState()?.orderedQuestions().filter((q) => q.status === "open").length ?? 0;
          if (open === 0 || resumeSurface === undefined) return "no-state";
          resumePanel(resumeSurface);
          return "reopened";
        }
        return "no-state";
      },
    }),
  );

  // P1.M7.T3.S1 — user-only submission diff card (h2.36): renders
  // `interrogation-submission` custom messages from details.card in the
  // TUI transcript (compact by default, full submission when expanded).
  // Display-only — the model keeps reading message.content. The completion
  // recap/entry renderers (P1.M7.T3.S2) will extend renderers.ts likewise.
  registerSubmissionCardRenderer(pi);

  // P1.M6.T1.S2 — /interrogate toggle command + the global break-out/resume
  // shortcut (h2.15/h2.34/h2.35/h2.37): ONE seam registering both surfaces
  // over the panel host's phase API. Shares this closure's config (raw
  // keys.breakOut for the shortcut), panelHost (toggle state source), and
  // drafts (signature-stability pass-through; S1's resume reuses lastOpts).
  registerInterrogateCommand(pi, config, panelHost, drafts);
}

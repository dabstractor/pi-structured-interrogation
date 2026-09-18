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
 * "The factory can be synchronous or asynchronous"), registers the ONE
 * /interrogate command (CMD-001: bare = panel toggle; `ping` smoke test and
 * `debug upsert|submit|state` verification subcommands ride the same
 * registration), registers the `interrogate` tool
 * (h2.15) via createInterrogateTool, wires the auto-close lifecycle engine
 * (P1.M2.T2.S1 — h2.44 close pass on agent_settled), and plugs the one-time
 * completion trigger into its onAfterClosePass seam (P1.M2.T2.S2 — h3.9:
 * inject the full interrogation-completion record once, dismiss the panel,
 * clear in-memory state). The panel host landed in P1.M3; the user-only
 * submission diff card renderer is registered here (P1.M7.T3.S1,
 * registerSubmissionCardRenderer) — and the completion recap card + state
 * mirror entry marker renderers complete the surface (P1.M7.T3.S2). Persistence mirror (P1.M7.T1.S1): debounced
 * `interrogation-state` custom-entry appends + session_shutdown flush.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCompletionTrigger } from "./completion.js";
import { registerInterrogateCommand } from "./command.js";
import { createCompactionGuard } from "./compaction.js";
import { loadConfig } from "./config.js";
import { createDebugSubcommands } from "./debug-commands.js";
import { drainBatchNotes } from "./delivery.js";
import { createRoundDetector } from "./detect.js";
import { DraftStore } from "./draft-store.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { createPanelHost, maybeAutoOpen } from "./panel/panel.js";
import { hasResumableQuestions, resumePanel } from "./panel/suspend.js";
import { createStateMirror } from "./persistence.js";
import { createRemoteBridge } from "./remote-bridge.js";
import { createReconstruction } from "./reconstruct.js";
import {
  registerCompletionRecapRenderer,
  registerStateEntryRenderer,
  registerSubmissionCardRenderer,
} from "./renderers.js";
import { getState } from "./state.js";
import { createInterrogateTool } from "./tool.js";

export default async function interrogatorExtension(pi: ExtensionAPI): Promise<void> {
  const config = await loadConfig(process.cwd());

  // P1.M2.T2.S1 — auto-close engine (h2.44): subscribes tool_execution_start/end
  // + agent_settled and runs the idempotent close pass after each settle.
  // P1.M2.T2.S2 — completion trigger (h3.9) plugged into onAfterClosePass:
  // injects the one full interrogation-completion record, dismisses the
  // panel, then clears in-memory state (exactly once per interrogation).
  // FR-33 (remote bridge surface): onCompleted resolves every outstanding
  // `itg:` flow AFTER the state settles so no conformant client surface
  // lingers past completion.
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
      // NEW-004 (h2.46): the completion record's NOTES line collects every
      // batch note shipped with this interrogation's submissions — in order.
      // delivery.ts's ledger records them at the ONE transport chokepoint
      // (deliverSubmission); draining here is the notes' final destination,
      // so a follow-up interrogation starts from an empty ledger.
      getBatchNotes: drainBatchNotes,
      // FR-33: resolve every outstanding `itg:` flow after the completion
      // flow settles (late-binding closure — remoteBridge is assigned a few
      // statements below, before any close pass can ever fire).
      onCompleted: () => remoteBridge.completeAll(),
    }),
  });

  // FR-31..34 — remote bridge surface: speak the pi-ask bridge contract on
  // the shared `pi.events` bus. Any conformant client (remote-pi's app
  // today) renders started flows natively and returns submits, which ride
  // the panel-parity pipeline (remote-submit.ts). Emission is inert when
  // nothing listens; submits are filtered by the `itg:` flow registry.
  // Created BEFORE the tool/reconstruction wiring below so every consumer
  // captures the same handle; disposed on session_shutdown (below).
  const remoteBridge = createRemoteBridge(pi, { config, lifecycle });

  // P1.M7.T4.S1 — plain-text round detection (FR-26, h2.27): TUI-only,
  // config-gated (roundDetection), throttled once per 3 turns; never
  // transforms content — notifies only.
  const roundDetector = createRoundDetector(pi, { config, lifecycle });

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
  pi.on("session_shutdown", () => {
    mirror.flush();
    remoteBridge.dispose(); // FR-33: resolve outstanding flows + unsub the submit listener
  });

  // P1.M7.T2.S1 — compaction preservation (FR-29, h2.42): when pi compacts
  // mid-interrogation, the guard flushes THIS mirror (fresh interrogation-state
  // entry pre-compaction) and runs the summarization itself with the PRD's
  // preservation text prepended — pi 0.85.x SessionBeforeCompactResult has no
  // customInstructions return, so the custom-compaction pattern is the only
  // mechanism (see compaction.ts [Mode A] JSDoc). ANY failure falls through to
  // default compaction (undefined) — never cancels, never blocks.
  createCompactionGuard(pi, { config, mirror });

  // P1.M2.T3.S1 — debug subcommands (h2.50, CMD-001): the former
  // /interrogate-debug-* commands now live under /interrogate debug …,
  // keeping /interrogate the ONLY command this extension registers (and
  // thus the top autocomplete hit for "/inter"). Shares the tool
  // executor / submission path so keyboard-driven runs are evidence about
  // the production path; the lifecycle handle lets the debug submit flow
  // honor the h2.44 line-1 caller contract.
  const debugSubcommands = createDebugSubcommands(pi, config, lifecycle);

  // P1.M3.T1.S1 — panel host: opens on the first interrogate upsert in TUI
  // mode (fire-and-forget custom(), h2.0 commitment 1), persists while the
  // agent is idle, suspends via done(null) (h2.35) — also reachable through
  // lifecycle.dismissPanel() from the completion flow — and reopens when a
  // later upsert lands while suspended (h2.37). Panel host + auto-open:
  const panelHost = createPanelHost(lifecycle, pi);
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
  createReconstruction(pi, {
    config,
    host: panelHost,
    drafts,
    // FR-34: restored-with-live-content → re-emit a bridge flow
    // (`ask:resume`) so conformant clients re-render after a restart
    // (rpc daemon has no panel to auto-open). emitFlow gates internally.
    onRestored: (state) => {
      remoteBridge.emitFlow(state, "ask:resume");
    },
  });

  // P1.M6.T2.S1 — agent-judgment reopen (FR-6/Q12, h2.35): the tool's
  // {reopen:true} action resumes a suspended panel through the SAME
  // resumePanel path as the /interrogate invoke command — no
  // deterministic guard beyond host phase + open-question existence (the
  // agent's judgment is the gate; the always-visible suspend widget is the
  // user's safety net). Registered AFTER createPanelHost so the hook
  // closure captures the live host; the phase API isOpen()/isSuspended()
  // is the only state source (the module-private `phase` is never read
  // directly). The dead-panel edge mirrors S2's empty-state rule: dead =
  // NO live questions (post-completion cleared / all terminal — the shared
  // resumable predicate, BUG-005); an answered-pending panel resurfaces so
  // a ctrl+s can ship the pending answers. Idempotency races are S1's
  // concern (resumePanel → openPanel no-ops when already open) — not
  // duplicated here.
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
        // Suspended AND cold-resume stuck-open hosts (isOpen() false with a
        // phantom never-mounted panel) both land here — resumePanel routes
        // through openPanel, whose stuck-open guard remounts.
        const state = getState();
        if (
          !(state !== undefined && hasResumableQuestions(state)) ||
          resumeSurface === undefined
        )
          return "no-state";
        resumePanel(resumeSurface);
        return "reopened";
      },
      // FR-31/D-R6: emission hook — upserts AND reopens (both modes) emit a
      // bridge flow for the live question set; truthy return = emitted (the
      // non-TUI reopen result reports the re-surface).
      onLiveQuestions: (state) => remoteBridge.emitFlow(state, "tool") !== null,
    }),
  );

  // P1.M7.T3.S1 — user-only submission diff card (h2.36): renders
  // `interrogation-submission` custom messages from details.card in the
  // TUI transcript (compact by default, full submission when expanded).
  // Display-only — the model keeps reading message.content.
  registerSubmissionCardRenderer(pi);

  // P1.M7.T3.S2 — completion recap card (h2.36/AC-14) + state mirror entry
  // marker (h2.40 layer 3): renders `interrogation-completion` messages
  // from details — goal header, every grouped question with its final
  // answer and ★, completion timestamp; expanded adds withdrawn/moot
  // reasons, full free-text, NOTES and the epoch line. Debounced
  // `interrogation-state` mirror entries render as ONE dim, non-
  // interactive audit line (`· interrogation state @ epoch {n}`), never a
  // state dump. Display-only — the model keeps reading message.content;
  // entries never participate in LLM context.
  registerCompletionRecapRenderer(pi);
  registerStateEntryRenderer(pi);

  // P1.M6.T1.S2 (as amended by the breakOut removal + CMD-001) — the
  // /interrogate invoke command (h2.15/h2.35/h2.37): ONE seam, invoke-only
  // semantics — an existing session gets the panel IMMEDIATELY (open stays
  // open, suspended resumes, closed host opens fresh from state). No global
  // shortcut is registered (the ctrl+shift+q chord closes windows on many
  // desktop environments). Shares this closure's config, panelHost (phase
  // state source), drafts (load-bearing for the fresh-open row), and the
  // /interrogate debug subcommand handler (h2.50 verification surface).
  registerInterrogateCommand(pi, config, panelHost, { drafts, debug: debugSubcommands });
}

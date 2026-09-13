/**
 * src/command.ts — the /interrogate toggle command + the global
 * break-out/resume shortcut (P1.M6.T1.S2, h2.15/h2.34/h2.35/h2.37).
 *
 * One registration seam, two surfaces:
 * - `pi.registerCommand("interrogate", …)` — user-typed /interrogate.
 * - `pi.registerShortcut(config.keys.breakOut, …)` — the global
 *   ctrl+shift+q (default) break-out/resume key.
 *
 * Both surfaces run the SAME pure toggle core, {@link interrogateToggleAction},
 * whose only state source is the panel host's phase API (isOpen/isSuspended)
 * plus the open-question count — never module-private panel state, never a
 * second phase copy. Success is silent: suspend/resume surface through S1's
 * widget/panel mechanics; only the "empty" outcome notifies (exact h2.37
 * string). Every branch is guarded, so repeated presses and headless modes
 * are no-op-safe (never throw).
 *
 * Consumes P1.M6.T1.S1's exports (suspendPanel/resumePanel from
 * panel/suspend.ts) — this module never reimplements suspend/resume logic.
 * No changes are made here to keys.ts's in-panel breakOut handler, panel.ts,
 * or the widget logic.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import type { InterrogatorConfig } from "./config.js";
import type { DraftStore } from "./draft-store.js";
import type { PanelHost, PiUISurface } from "./panel/panel.js";
import { resumePanel, suspendPanel } from "./panel/suspend.js";
import { getState, type InterrogationState } from "./state.js";

/** EXACT h2.37/h2.3 empty-state string (em dash U+2014, severity "info"). */
const EMPTY_STATE_MESSAGE = "No active interrogation — ask the agent to interrogate you";

/** TUI-only guard message — custom() resolves undefined in RPC mode (h2.15). */
const NON_TUI_MESSAGE = "The interrogation panel requires TUI mode";

/**
 * Toggle decision table ([Mode A] anchor — every branch, one table):
 *
 * ┌──────────────────────────────┬───────────────────────────────────────┐
 * │ host.isOpen()                │ suspendPanel(host)  → "suspended"     │
 * │ host.isSuspended() ∧ open>0  │ resumePanel(pi)     → "resumed"       │
 * │ host.isSuspended() ∧ open=0  │ empty-state notify  → "empty"         │
 * │ host closed (no/ended state) │ empty-state notify  → "empty"         │
 * └──────────────────────────────┴───────────────────────────────────────┘
 *
 * CRITICAL: notify ONLY on "empty"; suspend/resume outcomes surface through
 * S1's widget/panel mechanics — never notify on success (silent success).
 *
 * The `pi` parameter is the PiUISurface carrier — the raw command/shortcut
 * `ctx` works (its `ctx.ui` is the surface; same carrier pattern as
 * maybeAutoOpen passing ctx to openPanel). `state` is the session singleton
 * read at invocation time (undefined until the first upsert — only consulted
 * for the suspended zero-open edge).
 */
export type InterrogateToggleOutcome = "suspended" | "resumed" | "empty";

/**
 * Pure toggle core shared by /interrogate and the global shortcut. Returns
 * what happened so the (thin) registration layer can attach the empty-state
 * notify; throws nothing — S1's suspend/resume are themselves guarded.
 */
export function interrogateToggleAction(
  host: PanelHost,
  pi: PiUISurface,
  state: InterrogationState | undefined,
): InterrogateToggleOutcome {
  if (host.isOpen()) {
    // Open → suspend. host.suspend() only mutates on the open→suspended
    // edge (idempotent); the editor is restored and the reminder widget is
    // set by panel.ts's single suspend choke point (S1's updateSuspendWidget).
    suspendPanel(host);
    return "suspended";
  }
  if (host.isSuspended()) {
    // Suspended with 0 open questions = dead panel (completion/pending-
    // submission territory, h2.37 edge): S1's choke point cleared the
    // widget in that case, so BOTH surfaces treat it as empty state —
    // never resume a dead panel.
    const open = state?.orderedQuestions().filter((q) => q.status === "open").length ?? 0;
    if (open === 0) return "empty";
    // Suspended with open questions → resume on the last-focused question
    // (S1 resumePanel: fresh panel rehydrated from shared state + DraftStore).
    resumePanel(pi);
    return "resumed";
  }
  // Closed host (no interrogation ever started, or state already cleared
  // after completion) → friendly info toast pointing at the agent entry.
  return "empty";
}

/**
 * [Mode A] DUAL REGISTRATION — /interrogate command AND the global
 * break-out/resume shortcut, one seam:
 *
 * WHY registerShortcut ALONE IS INSUFFICIENT: pi's app-level shortcuts are
 * flat registrations, but while the interrogation panel's custom component
 * holds focus, panel-internal key handling (keys.ts's keyRouter →
 * onBreakOut) intercepts input BEFORE the app-level shortcut — so the
 * global registration may not fire exactly when the panel is open.
 * WHY THE IN-PANEL HANDLER ALONE IS INSUFFICIENT: while the panel is
 * SUSPENDED nothing is mounted — no component consumes keys — so only the
 * global registration (and /interrogate from the editor) can fire. The two
 * registrations together cover the full AC-4 break-out/resume cycle in both
 * mount states. keys.ts is NOT touched or duplicated here.
 *
 * IDEMPOTENT-GUARD CONTRACT (race safety for the dual surfaces): both paths
 * funnel into {@link interrogateToggleAction}; suspendPanel → host.suspend()
 * mutates only on the open→suspended edge (a done(null) already resolved by
 * the lifecycle dismiss path cannot double-suspend), and resumePanel →
 * openPanel no-ops while the panel is already open (phase "open" early-
 * return). A double-delivery of ctrl+shift+q (global + in-panel, or a fast
 * double-press) therefore cannot wedge the host or double-done().
 *
 * CONFIG REBIND PATH: the shortcut key is the RAW `config.keys.breakOut`
 * accelerator (default "ctrl+shift+q") — registerShortcut's `modifier+key`
 * format IS the config format, no transformation. It is NOT the display
 * label from resolveKeyLabels (labels are for rendering only, h2.52). A user
 * rebind (R5/AC-12) simply changes what this function registers on next
 * activation, and S1's widget line relabels itself via resolveKeyLabels.
 *
 * CONFLICT VERIFICATION NOTE (h2.34): ctrl+shift+q was verified FREE — no pi
 * built-in default and no installed extension registers it — per
 * plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md:80
 * (:66-68 confirms no other extension registerShortcut conflicts). Re-verify
 * at build time in the target environment and record findings in the PR
 * notes.
 *
 * @param drafts accepted for signature stability with the other factory
 *   seams (index.ts passes the shared DraftStore); the resume path reuses
 *   the panel host's captured lastOpts (which carries the same store), so
 *   this parameter is deliberately unused beyond the closure contract.
 */
export function registerInterrogateCommand(
  pi: ExtensionAPI,
  config: InterrogatorConfig,
  host: PanelHost,
  drafts?: DraftStore,
): void {
  void drafts; // signature stability only — see JSDoc above.

  // User-facing toggle (h2.15): TUI-only — ctx.mode guards throughout;
  // custom() resolves undefined in RPC mode and must never be reached.
  // Any args string is ignored for toggling (never throw on args); with no
  // active interrogation the same empty-state notify fires.
  pi.registerCommand("interrogate", {
    description: "Toggle the interrogation panel (suspend/resume)",
    handler: async (_args: string, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(NON_TUI_MESSAGE, "info");
        return;
      }
      const outcome = interrogateToggleAction(host, ctx, getState());
      if (outcome === "empty") ctx.ui.notify(EMPTY_STATE_MESSAGE, "info");
    },
  });

  // Global break-out/resume (h2.34/h2.35): flat app-level registration —
  // effectively TUI-only by pi's own dispatch, so NO ctx.mode branch here
  // (ctx.mode is not part of this handler's contract). Guard ctx.ui
  // defensively; the toggle core + empty-state notify mirror the command.
  // The raw config value is passed verbatim — see the config-rebind note above.
  pi.registerShortcut(config.keys.breakOut as KeyId, {
    description: "interrogator: break out / resume the interrogation panel",
    handler: async (ctx) => {
      if (ctx.ui === undefined) return;
      const outcome = interrogateToggleAction(host, ctx, getState());
      if (outcome === "empty") ctx.ui.notify(EMPTY_STATE_MESSAGE, "info");
    },
  });
}

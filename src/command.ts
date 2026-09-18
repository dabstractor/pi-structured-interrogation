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
import { type KeyId } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import type { DebugSubcommandHandler } from "./debug-commands.js";
import type { DraftStore } from "./draft-store.js";
import { parseAccelerator } from "./panel/keys.js";
import type { PanelHost, PiUISurface } from "./panel/panel.js";
import { hasResumableQuestions, resumePanel, suspendPanel } from "./panel/suspend.js";
import { getState, type InterrogationState } from "./state.js";

/** EXACT h2.37/h2.3 empty-state string (em dash U+2014, severity "info"). */
const EMPTY_STATE_MESSAGE = "No active interrogation — ask the agent to interrogate you";

/** TUI-only guard message — custom() resolves undefined in RPC mode (h2.15). */
const NON_TUI_MESSAGE = "The interrogation panel requires TUI mode";

/**
 * CMD-001 usage line for an unrecognized /interrogate subcommand. Bare
 * /interrogate (the overwhelmingly common case) never hits this — it is the
 * panel toggle, first in the autocomplete because it is the ONLY command
 * this extension registers.
 */
const SUBCOMMAND_USAGE =
  "usage: /interrogate [ping | debug upsert|submit|state] — bare /interrogate toggles the panel";

/**
 * Toggle decision table ([Mode A] anchor — every branch, one table):
 *
 * ┌──────────────────────────────┬───────────────────────────────────────┐
 * │ host.isOpen()                │ suspendPanel(host)  → "suspended"     │
 * │ host.isSuspended() ∧ live    │ resumePanel(pi)     → "resumed"       │
 * │ host.isSuspended() ∧ dead   │ empty-state notify  → "empty"         │
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
 * for the suspended dead-panel edge — the shared resumable predicate).
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
    // BUG-005 (h2.2/h3.4 Issue 5): a suspended panel is dead ONLY when no
    // live questions remain — post-completion cleared, or every question
    // terminal (moot/withdrawn/closed). Answered-pending panels (0 open,
    // N answered/submitted/reasked) MUST resurface so the user can ctrl+s
    // and ship the pending answers. Pure state-existence check via S1's
    // shared predicate — FR-6: no deterministic (epoch/rev/recency) guard.
    if (!(state !== undefined && hasResumableQuestions(state))) return "empty";
    // Suspended with live questions → resume (RESUME-001): the fresh
    // panel focuses the FIRST UNANSWERED question in state order (open/
    // reasked — what needs answering), falling back to the pre-suspend
    // focus when nothing is unanswered (S1 resumePanel: fresh panel
    // rehydrated from shared state + DraftStore).
    resumePanel(pi);
    return "resumed";
  }
  // Closed host (no interrogation ever started, or state already cleared
  // after completion) → friendly info toast pointing at the agent entry.
  return "empty";
}

/**
 * [Mode A] SINGLE COMMAND REGISTRATION (CMD-001): /interrogate is the ONE
 * command this extension registers — it must be the only (hence first)
 * autocomplete hit for "/inter". The former /interrogate-ping smoke test
 * and the three /interrogate-debug-* verification commands (h2.50) collapsed
 * into SUBCOMMANDS:
 *
 *   /interrogate                → toggle the panel (suspend/resume)
 *   /interrogate ping           → smoke test ("pi-interrogator: pong")
 *   /interrogate debug upsert <json> | submit [id=value,…] | state
 *
 * pi's autocomplete ranks by fuzzy score with ties broken by registration
 * order — five /inter*-prefixed commands tied and buried /interrogate
 * beneath its own dev surface. One command makes the ranking moot.
 * getArgumentCompletions surfaces the subcommands after a space
 * ("/interrogate " → ping / debug; "/interrogate debug " → the verbs).
 *
 * The `pi.registerShortcut(config.keys.breakOut, …)` global
 * ctrl+shift+q surface is UNCHANGED, as is the toggle core
 * {@link interrogateToggleAction} (pure, phase-API-only state source).
 *
 * @param opts.debug the /interrogate debug subcommand handler
 *   (createDebugSubcommands, wired by index.ts with the live lifecycle);
 *   omitted → the debug branch reports it unavailable (tests).
 * @param opts.drafts signature stability with the other factory seams
 *   (index.ts passes the shared DraftStore); the resume path reuses the
 *   panel host's captured lastOpts, so this parameter is deliberately
 *   unused beyond the closure contract.
 */
export function registerInterrogateCommand(
  pi: ExtensionAPI,
  config: InterrogatorConfig,
  host: PanelHost,
  opts?: { drafts?: DraftStore; debug?: DebugSubcommandHandler },
): void {
  void opts?.drafts; // signature stability only — see JSDoc above.

  // User-facing command (h2.15): bare invocation is the panel toggle;
  // args dispatch the subcommands. TUI-only for the TOGGLE branch — custom()
  // resolves undefined in RPC mode and must never be reached. The ping/debug
  // branches keep their pre-CMD-001 behavior (no mode guard — notify-only).
  // Unknown subcommands never throw: a usage line + "warning" notify.
  pi.registerCommand("interrogate", {
    description: "Toggle the interrogation panel (suspend/resume); subcommands: ping, debug upsert|submit|state",
    getArgumentCompletions: (argumentPrefix) => {
      // Static subcommand items; values are FULL replacement text (pi-tui's
      // applyCompletion swaps the entire argument prefix for item.value).
      // Whitespace runs collapse to single spaces so "debug  s" still
      // prefix-matches "debug state" — but a SEPARATING space is preserved
      // ("debug " must reach the verb level, not match the top-level
      // "debug" item).
      const norm = argumentPrefix.toLowerCase().replace(/\s+/g, " ");
      const sp = norm.indexOf(" ");
      if (sp < 0) {
        const tops = [
          { value: "ping", label: "ping", description: "Smoke test: proves the extension loaded" },
          {
            value: "debug",
            label: "debug",
            description: "Dev: upsert / submit / state via the production code paths",
          },
        ];
        const out = norm === "" ? tops : tops.filter((i) => i.value.startsWith(norm));
        return out.length > 0 ? out : null;
      }
      const first = norm.slice(0, sp);
      if (first !== "debug") return null;
      const rest = norm.slice(sp + 1);
      const subs = [
        {
          value: "debug upsert",
          label: "upsert",
          description: "Debug: upsert questions via the tool's exact code path ({json})",
        },
        {
          value: "debug submit",
          label: "submit",
          description: "Debug: record answers + full submission path (id=value,…)",
        },
        {
          value: "debug state",
          label: "state",
          description: "Debug: status line + one line per question",
        },
      ];
      const out = rest === "" ? subs : subs.filter((i) => i.value.startsWith(norm));
      return out.length > 0 ? out : null;
    },
    handler: async (args: string, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "") {
        if (ctx.mode !== "tui") {
          ctx.ui.notify(NON_TUI_MESSAGE, "info");
          return;
        }
        const outcome = interrogateToggleAction(host, ctx, getState());
        if (outcome === "empty") ctx.ui.notify(EMPTY_STATE_MESSAGE, "info");
        return;
      }
      const sp = trimmed.search(/\s/);
      const first = (sp < 0 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
      const rest = sp < 0 ? "" : trimmed.slice(sp + 1).trim();
      if (first === "ping") {
        // Smoke test (former /interrogate-ping): proves the factory ran.
        ctx.ui.notify("pi-interrogator: pong", "info");
        return;
      }
      if (first === "debug") {
        if (opts?.debug === undefined) {
          ctx.ui.notify("interrogate: debug subcommands unavailable", "error");
          return;
        }
        await opts.debug(rest, ctx);
        return;
      }
      ctx.ui.notify(`interrogate: unknown subcommand "${first}" — ${SUBCOMMAND_USAGE}`, "warning");
    },
  });

  // Global break-out/resume (h2.34/h2.35): flat app-level registration —
  // effectively TUI-only by pi's own dispatch, so NO ctx.mode branch here
  // (ctx.mode is not part of this handler's contract). Guard ctx.ui
  // defensively; the toggle core + empty-state notify mirror the command.
  // The config value is normalized through parseAccelerator — the SAME
  // grammar/normalization the in-panel router applies — with the h2.52
  // default as the invalid-value fallback (a settings typo degrades to the
  // default, never bricks registration).
  const breakOutKey =
    parseAccelerator(config.keys.breakOut) ?? (parseAccelerator(DEFAULT_CONFIG.keys.breakOut) as KeyId);
  pi.registerShortcut(breakOutKey, {
    description: "interrogator: break out / resume the interrogation panel",
    handler: async (ctx) => {
      if (ctx.ui === undefined) return;
      const outcome = interrogateToggleAction(host, ctx, getState());
      if (outcome === "empty") ctx.ui.notify(EMPTY_STATE_MESSAGE, "info");
    },
  });
}

/**
 * src/command.ts — the /interrogate invoke command (P1.M6.T1.S2 as amended
 * by the breakOut removal and the CMD-001 subcommand consolidation).
 *
 * ONE registration seam, ONE surface:
 * - `pi.registerCommand("interrogate", …)` — user-typed /interrogate, with
 *   the CMD-001 subcommands riding in the args: `ping` (smoke test) and
 *   `debug upsert|submit|state` (the h2.50 verification surface, via the
 *   DebugSubcommandHandler wired by index.ts).
 *
 * INVOKE, NEVER TOGGLE, NEVER A KEYPRESS GATE: typing /interrogate with an
 * existing interrogation session must invoke the panel IMMEDIATELY in every
 * scenario — open (already invoked: silent no-op), suspended (resume), or
 * closed host with live state (fresh open from the session singleton).
 * The historical toggle semantics (open → suspend) and the global
 * ctrl+shift+q break-out/resume shortcut were removed: that chord closes
 * windows on many desktop environments (the window manager claims it before
 * the terminal ever sees the bytes), so the extension must neither register
 * it globally nor instruct the user to press it anywhere. Suspending the
 * panel is `esc` in-panel (the fixed view-descent ladder, keys.ts);
 * resuming is /interrogate (this module) or the agent's {reopen:true}.
 *
 * The only state source is the panel host's phase API (isOpen/isSuspended)
 * plus the open-question count — never module-private panel state, never a
 * second phase copy. Success is silent: resume/open surface through the
 * panel mechanics; only the "empty" outcome notifies (exact h2.37 string).
 * Every branch is guarded, so repeated invocations and headless modes are
 * no-op-safe (never throw).
 *
 * Consumes P1.M6.T1.S1's exports (resumePanel from panel/suspend.ts) and
 * panel.ts's openPanel — this module never reimplements open/resume logic.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import type { DebugSubcommandHandler } from "./debug-commands.js";
import type { DraftStore } from "./draft-store.js";
import {
  hasResumableQuestions,
  resumePanel,
} from "./panel/suspend.js";
import { getState, type InterrogationState } from "./state.js";
import {
  openPanel,
  type PanelHost,
  type PiUISurface,
} from "./panel/panel.js";

/** EXACT h2.37/h2.3 empty-state string (em dash U+2014, severity "info"). */
const EMPTY_STATE_MESSAGE = "No active interrogation — ask the agent to interrogate you";

/** TUI-only guard message — custom() resolves undefined in RPC mode (h2.15). */
const NON_TUI_MESSAGE = "The interrogation panel requires TUI mode";

/**
 * CMD-001 usage line for an unrecognized /interrogate subcommand. Bare
 * /interrogate (the overwhelmingly common case) never hits this — it is the
 * panel invoke, first in the autocomplete because it is the ONLY command
 * this extension registers.
 */
const SUBCOMMAND_USAGE =
  "usage: /interrogate [ping | debug upsert|submit|state] — bare /interrogate opens or resumes the panel";

/**
 * Invoke decision table ([Mode A] anchor — every branch, one table):
 *
 * ┌──────────────────────────────────┬──────────────────────────────────────┐
 * │ host.isOpen()                    │ nothing (already invoked) → "open"   │
 * │ host.isSuspended() ∧ live        │ resumePanel(pi)     → "resumed"      │
 * │ host.isSuspended() ∧ dead        │ empty-state notify  → "empty"        │
 * │ host closed ∧ live state         │ openPanel(pi, …)    → "opened"       │
 * │ host closed (no/ended state)     │ empty-state notify  → "empty"        │
 * └──────────────────────────────────┴──────────────────────────────────────┘
 *
 * "Live state" = `state !== undefined && hasResumableQuestions(state)` (the
 * shared BUG-005 predicate — answered/submitted/reasked-pending panels are
 * LIVE and must resurface so the user can ctrl+s the pending answers).
 *
 * The closed-host live-state row is the reload scenario: after an extension
 * reload the host record is fresh while the session singleton holds live
 * questions (reconstruction, or an upsert that arrived while no panel
 * could mount). /interrogate must then open the panel from the CURRENT
 * state — never tell the user to press anything.
 *
 * CRITICAL: notify ONLY on "empty"; open/resume outcomes surface through
 * the panel mechanics — never notify on success (silent success). The
 * command NEVER suspends: an open panel stays open (the suspend affordance
 * is in-panel esc, plus the completion flow's dismissal).
 *
 * The `pi` parameter is the PiUISurface carrier — the raw command `ctx`
 * works (its `ctx.ui` is the surface; same carrier pattern as maybeAutoOpen
 * passing ctx to openPanel). `state` is the session singleton read at
 * invocation time (undefined until the first upsert).
 */
export type InterrogateInvokeOutcome = "opened" | "resumed" | "open" | "empty";

/**
 * Options for {@link interrogateInvokeAction} — the factory-closure
 * dependencies needed by the fresh-open (closed-host) row: the shared
 * config and the factory's ONE DraftStore (so drafts survive into the
 * panel opened by invoke, exactly like every other open path).
 */
export interface InvokeOptions {
  config: InterrogatorConfig;
  drafts?: DraftStore;
}

/**
 * Pure invoke core consumed by the /interrogate registration (and tests).
 * Returns what happened so the (thin) registration layer can attach the
 * empty-state notify; throws nothing — openPanel/resumePanel are
 * themselves guarded.
 */
export function interrogateInvokeAction(
  host: PanelHost,
  pi: PiUISurface,
  state: InterrogationState | undefined,
  opts?: InvokeOptions,
): InterrogateInvokeOutcome {
  // Open → already invoked. NEVER suspend from the command (invoke-only
  // semantics): suspending here is what historically demanded a second
  // keypress (the removed breakOut chord) to get the panel back.
  if (host.isOpen()) return "open";

  const live = state !== undefined && hasResumableQuestions(state);

  if (host.isSuspended()) {
    // BUG-005 (h2.2/h3.4 Issue 5): a suspended panel is dead ONLY when no
    // live questions remain — post-completion cleared, or every question
    // terminal (moot/withdrawn/closed). Answered-pending panels (0 open,
    // N answered/submitted/reasked) MUST resurface so the user can ctrl+s
    // and ship the pending answers. Pure state-existence check via S1's
    // shared predicate — FR-6: no deterministic (epoch/rev/recency) guard.
    if (!live) return "empty";
    // Suspended with live questions → resume (RESUME-001): the fresh
    // panel focuses the FIRST UNANSWERED question in state order (open/
    // reasked — what needs answering), falling back to the pre-suspend
    // focus when nothing is unanswered (S1 resumePanel: fresh panel
    // rehydrated from shared state + DraftStore). A false return means no
    // resumable lastOpts (defensive — suspension only follows an open that
    // set them): fall through to the closed-host fresh-open row below so
    // the user still gets the panel.
    if (resumePanel(pi)) return "resumed";
  }

  // Closed host (or the defensive resume miss above): with live state,
  // open a FRESH panel from the session singleton — the reload row. The
  // state/config/drafts ride the same OpenPanelOptions shape as every
  // other open path; openPanel no-ops (false) when the mode guard or the
  // single-instance guard blocks it, which surfaces as "empty" so the
  // thin layer can still give the user feedback.
  if (live && opts !== undefined) {
    return openPanel(pi, { config: opts.config, state: state as InterrogationState, drafts: opts.drafts })
      ? "opened"
      : "empty";
  }
  return "empty";
}

/**
 * [Mode A] SINGLE COMMAND REGISTRATION (CMD-001): /interrogate is the ONE
 * command this extension registers — it must be the only (hence first)
 * autocomplete hit for "/inter". The former /interrogate-ping smoke test
 * and the three /interrogate-debug-* verification commands (h2.50) collapsed
 * into SUBCOMMANDS:
 *
 *   /interrogate                → invoke the panel (open/resume, never suspend)
 *   /interrogate ping           → smoke test ("pi-interrogator: pong")
 *   /interrogate debug upsert <json> | submit [id=value,…] | state
 *
 * pi's autocomplete ranks by fuzzy score with ties broken by registration
 * order — five /inter*-prefixed commands tied and buried /interrogate
 * beneath its own dev surface. One command makes the ranking moot.
 * getArgumentCompletions surfaces the subcommands after a space
 * ("/interrogate " → ping / debug; "/interrogate debug " → the verbs).
 *
 * CONFIG NOTE (breakOut removal): NO registerShortcut call exists anymore.
 * The historical global ctrl+shift+q registration was deleted: that chord
 * is claimed by window managers on common desktop environments (it closes
 * windows) and therefore never reliably reaches the terminal. Resume
 * affordances are /interrogate (this command — immediate invoke) and the
 * agent's {reopen:true}; the suspend reminder widget names /interrogate
 * only (suspend.ts buildSuspendWidgetLine).
 *
 * IDEMPOTENT-GUARD CONTRACT (race safety): every path funnels into
 * {@link interrogateInvokeAction}; openPanel no-ops while a panel is
 * already open (phase "open" early-return) and resumePanel → openPanel
 * inherits the same guard, so repeated invocations cannot wedge the host
 * or double-done().
 *
 * @param opts.debug the /interrogate debug subcommand handler
 *   (createDebugSubcommands, wired by index.ts with the live lifecycle);
 *   omitted → the debug branch reports it unavailable (tests).
 * @param opts.drafts the shared DraftStore (index.ts factory closure) —
 *   load-bearing for the fresh-open row, exactly like every other open
 *   path; the resume path reuses the panel host's captured lastOpts.
 */
export function registerInterrogateCommand(
  pi: ExtensionAPI,
  config: InterrogatorConfig,
  host: PanelHost,
  opts?: { drafts?: DraftStore; debug?: DebugSubcommandHandler },
): void {
  // User-facing command (h2.15): bare invocation is the panel invoke
  // (open/resume — never suspend); args dispatch the subcommands.
  // TUI-only for the INVOKE branch — custom() resolves undefined in RPC
  // mode and must never be reached. The ping/debug branches keep their
  // pre-CMD-001 behavior (no mode guard — notify-only). Unknown
  // subcommands never throw: a usage line + "warning" notify.
  pi.registerCommand("interrogate", {
    description: "Open or resume the interrogation panel; subcommands: ping, debug upsert|submit|state",
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
        const outcome = interrogateInvokeAction(host, ctx, getState(), {
          config,
          drafts: opts?.drafts,
        });
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
}

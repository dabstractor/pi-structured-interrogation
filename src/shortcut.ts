/**
 * src/shortcut.ts — the global panel-toggle shortcut (PANELTOGGLE-001).
 *
 * The open/resume leg of `keys.toggle`: ONE `pi.registerShortcut` on the
 * config accelerator (default "ctrl+n"), gated by the `panelShortcut`
 * toggle (default true). Fires ONLY from pi's main editor (interactive
 * mode dispatches extension shortcuts via `defaultEditor.onExtensionShortcut`
 * — pi modes/interactive/interactive-mode.ts), i.e. exactly when the panel
 * does NOT hold keyboard focus; the close leg of the toggle is the SAME
 * chord inside an open panel (panel/keys.ts routes it to suspend — the esc
 * ladder's terminal rung). One accelerator, both surfaces, true toggle.
 *
 * Why ctrl+n is a SAFE global default (verified against pi's conflict
 * machinery, pi core/extensions/runner.ts):
 * - NOT in RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS (the editor-global
 *   reserved list — ctrl+c/d/l/t/g/z etc.); the runner therefore NEVER
 *   skips the registration. pi logs one startup diagnostic because
 *   `app.session.toggleNamedFilter` defaults to ctrl+n too — the extension
 *   shortcut wins at the main editor and the built-in keeps firing inside
 *   the session resume picker (different focus contexts; nothing user-facing
 *   collides).
 * - NOT a WM-claimed chord: the historical breakOut removal killed
 *   ctrl+shift+q because window managers close windows on it before the
 *   terminal sees bytes; plain ctrl+n reaches the terminal everywhere.
 * - Known limitation, accepted: terminals with `stty ixon` ON swallow
 *   ctrl+q/ctrl+s (XOFF/XON flow control) — users there rebind
 *   `keys.toggle` once and keep going (the existing keys.submit ctrl+s
 *   default already assumes the same).
 *
 * Handler semantics — reuse, never reimplement:
 * - host open (defensive; the main editor cannot hold focus while a panel
 *   is mounted — the leg exists so "toggle" is truthful under any host
 *   state): `host.suspend()`, the identical close the in-panel leg runs.
 * - otherwise: `interrogateInvokeAction` (command.ts's ONE invoke core —
 *   suspended-live resumes, closed-live opens fresh from the session
 *   singleton with this closure's config/drafts, exactly the /interrogate
 *   ladder), notifying the byte-identical h2.37 empty-state string when
 *   nothing could open.
 *
 * Registration is idempotent-safe: pi dedupes extension shortcuts per key
 * (last registration wins, with a diagnostic), and this module registers
 * exactly once per factory run.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { EMPTY_STATE_MESSAGE, interrogateInvokeAction } from "./command.js";
import type { DraftStore } from "./draft-store.js";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { parseAccelerator } from "./panel/keys.js";
import type { PanelHost } from "./panel/panel.js";
import { getState } from "./state.js";

/** Options for {@link registerPanelShortcut} — the factory-closure deps the fresh-open row needs. */
export interface ShortcutOptions {
  /** The shared DraftStore (index.ts factory closure) — load-bearing for the closed-host fresh-open row. */
  drafts?: DraftStore;
}

/**
 * Resolve the shortcut's KeyId: the config accelerator when valid, the
 * h2.52 default otherwise — with the SAME single-warn contract as
 * panel/keys.ts resolveBindings (a settings.json typo degrades to the
 * default; it never kills the toggle silently and never warns twice for
 * one action across the two dispatch layers… except a value invalid for
 * BOTH, which warns once per layer — accepted: each layer resolves its own
 * table independently by design).
 */
function resolveToggleKeyId(config: InterrogatorConfig): KeyId {
  const parsed = parseAccelerator(config.keys.toggle);
  if (parsed !== undefined) return parsed;
  console.warn(
    `[interrogator] invalid keybinding for "toggle": ` +
      `${JSON.stringify(config.keys.toggle)} — using default "${DEFAULT_CONFIG.keys.toggle}"`,
  );
  return parseAccelerator(DEFAULT_CONFIG.keys.toggle) as KeyId;
}

/**
 * Register the global panel-toggle shortcut (PANELTOGGLE-001).
 *
 * No-op when `config.panelShortcut` is false (the opt-out) — no pi surface
 * is touched, the in-panel toggle leg keeps working. Non-TUI modes never
 * dispatch extension shortcuts, so no mode guard is needed here (and none
 * is possible at factory time); the handler simply cannot fire there.
 *
 * @param pi  narrow registration surface — `Pick<ExtensionAPI,
 *            "registerShortcut">` — so tests pass a bare mock.
 */
export function registerPanelShortcut(
  pi: Pick<ExtensionAPI, "registerShortcut">,
  config: InterrogatorConfig,
  host: PanelHost,
  opts?: ShortcutOptions,
): void {
  if (!config.panelShortcut) return;
  pi.registerShortcut(resolveToggleKeyId(config), {
    description: "Toggle the /interrogate panel",
    handler: (ctx: ExtensionContext) => {
      // Close leg — defensive truth: while a panel is mounted it owns
      // focus, so the main-editor dispatch cannot observe host.isOpen();
      // if a stuck-open host ever does, the chord still toggles closed
      // (same done(null) suspend as the in-panel leg and the esc ladder).
      if (host.isOpen()) {
        host.suspend();
        return;
      }
      // Open/resume leg — command.ts's ONE invoke core; state read at
      // press time (undefined until the first upsert). The ctx is a TUI
      // ExtensionContext whose ui.custom/notify are the full interactive
      // surfaces (verified: interactive-mode createContext), so openPanel
      // and the empty-state notify behave exactly as under /interrogate.
      const outcome = interrogateInvokeAction(host, ctx, getState(), {
        config,
        drafts: opts?.drafts,
      });
      if (outcome === "empty") ctx.ui.notify(EMPTY_STATE_MESSAGE, "info");
    },
  });
}

/**
 * src/external-editor.ts — ctrl+g external-editor handoff (P1.M4.T1.S3).
 *
 * [Mode A] A faithful port of pi's own
 * dist/modes/interactive/external-editor.js (h2.31: ctrl+g "mirrors
 * app.editor.external"): seed the current draft into a temp file, spawn the
 * resolved editor with inherited stdio while the TUI is stopped, and on a
 * clean exit (code 0) hand the file contents back to the caller. Adapted
 * names only — temp prefix "pi-interrogator-", file "answer.md" — plus
 * pi's stripBom util (utils/text.js, not exported to extensions) inlined
 * as a leading-BOM replace.
 *
 * Command precedence (h2.31, env-only — pi's settings.externalEditor leg is
 * deliberately dropped because this is an extension, not the host):
 *
 *   $VISUAL → $EDITOR → "notepad" (win32) / "nano" (everything else)
 *
 * The caller (InterrogationPanel.openExternalEditor) owns the TUI
 * suspend/resume envelope: tui.stop() BEFORE this runs, tui.start() +
 * requestRender(true) in a finally.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Result of an external-editor round-trip (mirrors pi's internal API). */
export type ExternalEditorResult =
  | { status: "complete"; content: string }
  | { status: "failed" };

export interface ExternalEditorOptions {
  /** Full command line, e.g. "nvim" or "code --wait" (split on spaces). */
  command: string;
  /** Draft seeded into the temp file. */
  content: string;
}

/**
 * [Mode A] Resolve the external editor command (h2.31): $VISUAL beats
 * $EDITOR beats the platform fallback ("notepad" on win32, "nano"
 * elsewhere) — the app.editor.external resolution minus pi-settings (we
 * are an extension; the contract is env-only).
 */
export function resolveExternalEditorCommand(): string {
  return (
    process.env.VISUAL ||
    process.env.EDITOR ||
    (process.platform === "win32" ? "notepad" : "nano")
  );
}

/**
 * [Mode A] Round-trip `options.content` through the user's external editor
 * (h2.31 — clean-exit-only replace): write the draft into a fresh temp
 * file under os.tmpdir(), launch the resolved command with inherited
 * stdio, and resolve with the read-back contents ONLY when the editor
 * exits 0. Non-zero exit or a spawn error ("error" event, e.g. ENOENT)
 * resolves {status: "failed"} — never throws — so the caller leaves the
 * field untouched. The temp directory is removed on every path (best
 * effort, exactly like pi).
 *
 * The command string is split on spaces so args pass through ("code
 * --wait"); the child is spawned with shell only on win32 (pi's choice).
 */
export async function editInExternalEditor(
  options: ExternalEditorOptions,
): Promise<ExternalEditorResult> {
  const directory = mkdtempSync(join(tmpdir(), "pi-interrogator-"));
  const filePath = join(directory, "answer.md");
  try {
    writeFileSync(filePath, options.content, "utf-8");
    const [editor, ...editorArgs] = options.command.split(" ");
    process.stdout.write(
      `Launching external editor: ${options.command}\nThe panel will resume when the editor exits.\n`,
    );
    // Do not use spawnSync here. On Windows, synchronous child_process calls can keep
    // Node/libuv's console input read active after the parent pauses stdin, racing
    // vim/nvim for the console input buffer until Ctrl+C cancels the pending read.
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(editor, [...editorArgs, filePath], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", () => resolve(null)); // load-bearing: an unhandled "error" event crashes Node
      child.on("close", (code) => resolve(code));
    });
    if (exitCode !== 0) {
      return { status: "failed" };
    }
    return {
      status: "complete",
      // stripBom is pi-internal (utils/text.js, not exported to extensions)
      // — inline it, then drop exactly ONE trailing newline (pi does
      // .replace(/\n$/, "") — one, not /g, so an intentional trailing blank
      // line survives with one newline eaten).
      content: readFileSync(filePath, "utf-8")
        .replace(/^\uFEFF/, "")
        .replace(/\n$/, ""),
    };
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // Cleanup is best effort.
    }
  }
}

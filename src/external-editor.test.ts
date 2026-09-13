/**
 * src/external-editor.test.ts — unit coverage for the ctrl+g round-trip
 * (P1.M4.T1.S3).
 *
 * child_process.spawn is mocked (a fake child that records the spawn args,
 * writes the edited content into the REAL temp file, and emits
 * ("close", code) or "error" on demand); node:fs / node:os / node:path
 * stay REAL so the temp-dir lifecycle (mkdtemp seeding + rmSync in
 * finally) is asserted against the actual filesystem. Conventions follow
 * the other src/*.test.ts files (vitest, describe/it-style tests, vi.mock).
 */
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  editInExternalEditor,
  resolveExternalEditorCommand,
  type ExternalEditorResult,
} from "./external-editor.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// ------------------------------------------------------------------ helpers

/** Seed content observed by the spawn stub at spawn time ("" if absent). */
let seededContent: string | undefined;
/** Temp dir captured from the last spawn (dirname of the file arg). */
let lastDir: string | undefined;

/**
 * spawn stub whose child emits ("close", code) on a microtask, after
 * writing `content` into the temp file (undefined → leave the seed).
 */
function closeWith(content: string | undefined, code: number): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new EventEmitter();
    const file = args[args.length - 1] as string;
    lastDir = dirname(file);
    queueMicrotask(() => {
      seededContent = readFileSync(file, "utf-8");
      if (content !== undefined) writeFileSync(file, content, "utf-8");
      child.emit("close", code);
    });
    return child;
  });
}

/** spawn stub whose child emits "error" (spawn failure, e.g. ENOENT). */
function failToSpawn(): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new EventEmitter();
    const file = args[args.length - 1] as string;
    lastDir = dirname(file);
    queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
    return child;
  });
}

// -------------------------------------------------------------------- tests

describe("resolveExternalEditorCommand — $VISUAL/$EDITOR/nano precedence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("test_visual_beats_editor_beats_fallback", () => {
    vi.stubEnv("VISUAL", "visual-editor");
    vi.stubEnv("EDITOR", "fallback-editor");
    expect(resolveExternalEditorCommand()).toBe("visual-editor");

    vi.stubEnv("VISUAL", ""); // empty/unset → next leg
    expect(resolveExternalEditorCommand()).toBe("fallback-editor");

    vi.stubEnv("EDITOR", "");
    expect(resolveExternalEditorCommand()).toBe("nano"); // non-win32 fallback
  });

  test("test_win32_fallback_is_notepad", () => {
    vi.stubEnv("VISUAL", "");
    vi.stubEnv("EDITOR", "");
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      expect(resolveExternalEditorCommand()).toBe("notepad");
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});

describe("editInExternalEditor — round-trip (P1.M4.T1.S3)", () => {
  beforeEach(() => {
    seededContent = undefined;
    lastDir = undefined;
    // Keep the launch notice out of the test output.
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("test_clean_exit_returns_readback_with_bom_and_one_newline_stripped", async () => {
    closeWith("\uFEFFedited body\n", 0);
    const result: ExternalEditorResult = await editInExternalEditor({
      command: "nvim",
      content: "draft text",
    });
    expect(result).toEqual({ status: "complete", content: "edited body" });
    // Draft was seeded into the temp file before the spawn.
    expect(seededContent).toBe("draft text");
    // spawn(editor, [file], { stdio: "inherit", shell: false }) on posix.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnMock.mock.calls[0] as [string, string[], object];
    expect(command).toBe("nvim");
    expect(args[0]).toMatch(/answer\.md$/);
    expect(opts).toEqual({ stdio: "inherit", shell: false });
  });

  test("test_strips_exactly_one_trailing_newline_and_optional_bom", async () => {
    closeWith("no-newline", 0);
    expect(
      (await editInExternalEditor({ command: "nvim", content: "x" })) as ExternalEditorResult,
    ).toEqual({ status: "complete", content: "no-newline" });

    closeWith("body\n\n", 0); // one — not all — trailing newline is eaten
    expect(
      (await editInExternalEditor({ command: "nvim", content: "x" })) as ExternalEditorResult,
    ).toEqual({ status: "complete", content: "body\n" });

    closeWith("\uFEFFbom only", 0); // BOM stripped without any newline
    expect(
      (await editInExternalEditor({ command: "nvim", content: "x" })) as ExternalEditorResult,
    ).toEqual({ status: "complete", content: "bom only" });
  });

  test("test_command_args_pass_through", async () => {
    closeWith("ok\n", 0);
    await editInExternalEditor({ command: "code --wait", content: "x" });
    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe("code");
    expect(args[0]).toBe("--wait");
    expect(args[1]).toMatch(/answer\.md$/);
  });

  test("test_nonzero_exit_fails_and_temp_dir_is_removed", async () => {
    closeWith("should be discarded", 1);
    const result = await editInExternalEditor({ command: "nvim", content: "draft" });
    expect(result).toEqual({ status: "failed" });
    expect(lastDir).toBeDefined();
    expect(existsSync(lastDir as string)).toBe(false); // finally rmSync
  });

  test("test_spawn_error_event_fails_without_crashing_and_cleans_up", async () => {
    failToSpawn();
    const result = await editInExternalEditor({ command: "definitely-missing-editor", content: "d" });
    expect(result).toEqual({ status: "failed" }); // error → resolve(null) → failed
    expect(existsSync(lastDir as string)).toBe(false);
  });

  test("test_success_removes_temp_dir", async () => {
    closeWith("done\n", 0);
    await editInExternalEditor({ command: "nvim", content: "d" });
    expect(lastDir).toBeDefined();
    expect(existsSync(lastDir as string)).toBe(false);
  });
});

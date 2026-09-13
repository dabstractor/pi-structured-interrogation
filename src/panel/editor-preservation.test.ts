/**
 * src/panel/editor-preservation.test.ts — h2.35 verify-in-test
 * (P1.M6.T2.S3; AUTOMATION-POLICY.md: scripted fake ctx, NEVER a live TUI).
 *
 * The fake below implements EXACTLY the semantics read from pi's installed
 * runtime (`interactive-mode.js` `showExtensionCustom`, ~lines 2157-2210):
 * snapshot `editor.getText()` at custom()-open; on a non-overlay close the
 * SAME editor instance is re-added with `setText(savedText)` BEFORE the
 * promise resolves (restoreEditor() runs synchronously inside close()).
 * Chained cycles re-snapshot the live editor at each open — so text typed
 * while suspended survives. Driving openPanel → done(null) →
 * resumeOpenPanel → done(null) against this fake IS the scripted empirical
 * check that pi preserves main-editor text natively (see
 * editor-preservation.ts's finding JSDoc; source of record:
 * plan/001_0d6760db6bc5/P1M6T2S3/research/finding.md).
 *
 * Conventions copied from panel.test.ts: captured custom() calls with a
 * floating promise resolved only by done(), flush() before assertions on
 * resolved state, module-scoped host re-armed via createPanelHost(...) in
 * beforeEach, DEFAULT_CONFIG + raw-primitive Question fixtures.
 */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import {
  createPanelHost,
  InterrogationPanel,
  openPanel,
  resumeOpenPanel,
  type OpenPanelOptions,
  type PiUISurface,
} from "./panel.js";
import {
  EDITOR_PRESERVATION,
  restoreEditorTextIfEmpty,
  snapshotEditorText,
} from "./editor-preservation.js";

// ----------------------------------------------------------------- fixtures

/** Identity theme so the panel constructor + renderers run (panel.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

/** Raw-primitive choice question (panel.test.ts choiceQ pattern). */
function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
    ...overrides,
  };
}

/** Flush microtasks so the floating custom() promise's .then handlers run. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function optsFor(state: InterrogationState, extra: Partial<OpenPanelOptions> = {}): OpenPanelOptions {
  return { config: DEFAULT_CONFIG, state, ...extra };
}

// ------------------------------------------------- emulation of pi runtime

/**
 * One captured ui.custom invocation. `snapshotText` is the `savedText`
 * captured at custom()-open (interactive-mode.js :2158) — the value that
 * close() writes back into the editor.
 */
interface CustomCall {
  component: InterrogationPanel;
  done: (result: null | undefined) => void;
  promise: Promise<null | undefined>;
  snapshotText: string;
  resolved: boolean;
  resolution: null | undefined;
}

/** The fake main-editor model (`this.editor` in interactive-mode.js). */
interface EditorModel {
  text: string;
}

interface PreservationMock {
  pi: PiUISurface;
  /** The fake editor instance — the observable model behind get/setEditorText. */
  editor: EditorModel;
  /** The vi.fn backing `ui.custom` — assert factory invocations with it. */
  custom: Mock<
    [
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: null) => void,
      ) => Component,
    ],
    Promise<null | undefined>
  >;
  /** Every captured custom() call, in order. */
  calls: CustomCall[];
}

/**
 * Fake pi whose ui.custom implements the VERIFIED showExtensionCustom
 * semantics (non-overlay path — the only path openPanel uses; pi skips
 * restoreEditor only in overlay mode, which openPanel never passes).
 */
function makePreservationPi(initialEditorText = ""): PreservationMock {
  const editor: EditorModel = { text: initialEditorText };
  const calls: CustomCall[] = [];
  const requestRender = vi.fn();

  const custom = vi.fn(
    (
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: null) => void,
      ) => Component,
    ): Promise<null | undefined> => {
      // ── interactive-mode.js :2158 — snapshot the editor text at OPEN.
      const savedText = editor.text;
      let resolve!: (result: null | undefined) => void;
      const promise = new Promise<null | undefined>((res) => {
        resolve = res;
      });
      // close() as handed to the factory as `done` — non-overlay branch
      // (:2161-2167): restoreEditor() re-adds the SAME instance with
      // setText(savedText), THEN resolve(result). Restore-before-resolve
      // keeps the runtime's microtask order (pi's discuss-style
      // post-resolve writes land AFTER the restore, never before it).
      const done = (result: null | undefined): void => {
        editor.text = savedText;
        resolve(result);
      };
      const component = factory(
        { requestRender } as unknown as TUI,
        stubTheme,
        {} as unknown as KeybindingsManager,
        done,
      );
      const call: CustomCall = {
        component: component as InterrogationPanel,
        done,
        promise,
        snapshotText: savedText,
        resolved: false,
        resolution: undefined,
      };
      void promise.then((result) => {
        call.resolved = true;
        call.resolution = result;
      });
      calls.push(call);
      return promise;
    },
  );

  // ctx.ui getEditorText/setEditorText (interactive-mode.js :1920-1921)
  // — the belt-and-braces seams; setEditorText writes the live editor.
  const surface = {
    mode: "tui",
    ui: {
      custom,
      getEditorText: (): string => editor.text,
      setEditorText: (text: string): void => {
        editor.text = text;
      },
    },
  };

  return {
    pi: surface as unknown as PiUISurface,
    editor,
    custom,
    calls,
  };
}

function firstCall(mock: PreservationMock): CustomCall {
  expect(mock.calls.length).toBeGreaterThan(0);
  return mock.calls[0];
}

type MockLifecycle = {
  lifecycle: { onPanelDismiss: (cb: () => void) => void; dismissPanel: () => void };
  dismiss: () => void;
};

function makeMockLifecycle(): MockLifecycle {
  let cb: (() => void) | undefined;
  return {
    lifecycle: {
      onPanelDismiss: (registered) => {
        cb = registered;
      },
      dismissPanel: () => cb?.(),
    },
    dismiss: () => cb?.(),
  };
}

function seedState(): InterrogationState {
  const state = createInterrogationState("goal");
  state.upsertQuestion(choiceQ("q1"));
  return state;
}

// ------------------------------------------------------------------- tests

describe("editor preservation across custom() suspend/resume (h2.35)", () => {
  // Module-scoped host record — re-arm every test (panel.test.ts convention).
  beforeEach(() => {
    createPanelHost(makeMockLifecycle().lifecycle);
  });

  test("test_native_preservation_constant_records_finding", () => {
    expect(EDITOR_PRESERVATION).toBe("native");
  });

  test("test_open_suspend_done_null_preserves_editor_text", async () => {
    const mock = makePreservationPi("T"); // editor holds draft T at panel-open
    const state = seedState();
    expect(openPanel(mock.pi, optsFor(state))).toBe(true);

    firstCall(mock).done(null); // suspend
    await flush();

    // Native semantics: done() restored the SAME editor text. No panel
    // code touched it (the production suspend path has no editor writes).
    expect(firstCall(mock).resolved).toBe(true);
    expect(firstCall(mock).resolution).toBeNull();
    expect(mock.editor.text).toBe("T");
  });

  test("test_text_typed_while_suspended_survives_next_cycle", async () => {
    const mock = makePreservationPi("T");
    const state = seedState();
    openPanel(mock.pi, optsFor(state));
    firstCall(mock).done(null);
    await flush();
    expect(mock.editor.text).toBe("T");

    // User types a side-chat message into the now-live editor.
    mock.editor.text = "T2";

    expect(resumeOpenPanel(mock.pi)).toBe(true);
    expect(mock.calls.length).toBe(2);
    // Second cycle snapshots the LIVE editor — T2, not the stale T.
    expect(mock.calls[1]!.snapshotText).toBe("T2");

    mock.calls[1]!.done(null); // second suspend
    await flush();

    // T2 survives the full second suspend/resume cycle (re-snapshot
    // semantics — chained cycles never lose text).
    expect(mock.calls[1]!.resolved).toBe(true);
    expect(mock.editor.text).toBe("T2");
  });

  test("test_discuss_preload_survives_resume_cycle", async () => {
    const TEMPLATE = "## Discuss\n\n- point A\n- point B";
    const mock = makePreservationPi("");
    const state = seedState();
    openPanel(mock.pi, optsFor(state));
    firstCall(mock).done(null); // suspend (break out to discuss in chat)
    await flush();

    // S2 discuss.ts discussInChat: the setEditorText write is deferred one
    // microtask AFTER custom() resolves (post-restore) — mirror that here.
    void Promise.resolve().then(() => mock.pi.ui.setEditorText?.(TEMPLATE));
    await flush();
    expect(mock.editor.text).toBe(TEMPLATE);

    // Resume + suspend: the template is the live text, re-snapshotted at
    // open and restored at close — S2's flow survives the whole cycle.
    expect(resumeOpenPanel(mock.pi)).toBe(true);
    expect(mock.calls.length).toBe(2);
    expect(mock.calls[1]!.snapshotText).toBe(TEMPLATE);
    mock.calls[1]!.done(null);
    await flush();

    expect(mock.editor.text).toBe(TEMPLATE);
  });
});

describe("belt-and-braces fallback helpers (unused by design)", () => {
  /** Editable minimal surface for direct helper exercises. */
  function makeEditableSurface(initial = ""): {
    pi: PiUISurface;
    get: () => string | undefined;
    set: (text: string) => void;
  } {
    let text: string | undefined = initial;
    const pi = {
      ui: {
        custom: (): Promise<undefined> => Promise.resolve(undefined),
        getEditorText: (): string | undefined => text,
        setEditorText: (next: string): void => {
          text = next;
        },
      },
    } as PiUISurface;
    return {
      pi,
      get: () => text,
      set: (next: string) => {
        text = next;
      },
    };
  }

  test("test_restoreEditorTextIfEmpty_restores_only_into_empty_editor", () => {
    const empty = makeEditableSurface("");
    expect(restoreEditorTextIfEmpty(empty.pi, "saved draft")).toBe(true);
    expect(empty.get()).toBe("saved draft");

    // Whitespace-only counts as empty.
    const blank = makeEditableSurface("   \n\t ");
    expect(restoreEditorTextIfEmpty(blank.pi, "saved draft")).toBe(true);
    expect(blank.get()).toBe("saved draft");

    // NEVER clobber: non-empty current text → no write, false.
    const busy = makeEditableSurface("user typed during side chat");
    expect(restoreEditorTextIfEmpty(busy.pi, "stale snapshot")).toBe(false);
    expect(busy.get()).toBe("user typed during side chat");
  });

  test("test_restoreEditorTextIfEmpty_noops_without_seam_or_snapshot", () => {
    // Missing read seam → false (and nothing written).
    const noGet = {
      ui: {
        custom: (): Promise<undefined> => Promise.resolve(undefined),
        setEditorText: (_text: string): void => {},
      },
    } as PiUISurface;
    expect(restoreEditorTextIfEmpty(noGet, "saved")).toBe(false);

    // Missing write seam → false.
    const noSet = {
      ui: {
        custom: (): Promise<undefined> => Promise.resolve(undefined),
        getEditorText: (): string => "",
      },
    } as PiUISurface;
    expect(restoreEditorTextIfEmpty(noSet, "saved")).toBe(false);

    // Undefined snapshot (seam-absent capture) → false.
    const editable = makeEditableSurface("");
    expect(restoreEditorTextIfEmpty(editable.pi, undefined)).toBe(false);
    expect(editable.get()).toBe("");
  });

  test("test_snapshotEditorText_reads_seam_and_tolerates_absence", () => {
    const editable = makeEditableSurface("live draft");
    expect(snapshotEditorText(editable.pi)).toBe("live draft");

    // Surface without the optional seam → undefined (callers must guard).
    const bare = {
      ui: { custom: (): Promise<undefined> => Promise.resolve(undefined) },
    } as PiUISurface;
    expect(snapshotEditorText(bare)).toBeUndefined();
  });

  test("test_minimal_surface_declares_optional_editor_members", () => {
    // Task-3 scenario 6: the optional members typecheck on a minimal
    // PiUISurface literal (S2's setEditorText + S3's getEditorText
    // coexist; fakes/RPC may omit either) — plus snapshot/restore round
    // trip through both seams.
    const minimal: PiUISurface = {
      ui: {
        custom: (): Promise<undefined> => Promise.resolve(undefined),
        getEditorText: (): string => "round trip",
        setEditorText: (_text: string): void => {},
      },
    };
    expect(snapshotEditorText(minimal)).toBe("round trip");
    expect(restoreEditorTextIfEmpty(minimal, undefined)).toBe(false);
  });
});

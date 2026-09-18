/**
 * src/panel/discuss.test.ts — discuss-in-chat handoff tests (P1.M6.T2.S2).
 *
 * Conventions follow suspend.test.ts / panel.test.ts: a bare mock stands in
 * for pi (captured ui.custom factory + done callback, floating promise,
 * setEditorText RECORDER — template assertions are exact-string, per the
 * h2.35 contract), the module-scoped host record is re-armed via
 * createPanelHost per scenario, and fixture states are real
 * InterrogationStates seeded through the raw primitives.
 *
 * Coverage split mirrors suspend.ts's structure: the pure builder
 * (buildDiscussTemplate) gets exact-string unit tests; the coordinator
 * (discussInChat) gets fake-panel unit tests (deferral, failure paths,
 * optional setEditorText); the panel.ts wiring (routed.onDiscuss →
 * discussInChat with the PiUISurface carrier) gets router-integration tests
 * driving the real keys.ts dispatch from every view.
 */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import { buildDiscussTemplate, discussInChat } from "./discuss.js";
import type { InterrogationPanel } from "./panel.js";
import { createPanelHost, openPanel, type PiUISurface } from "./panel.js";
import { resumePanel } from "./suspend.js";

/** kitty CSI-u ctrl+shift+e (e = 101) — same bytes keys.test.ts routes with. */
const DISCUSS = "\u001b[101;6u";

const SQLITE_Q: Question = {
  id: "q3",
  prompt: "Should we use sqlite or json?",
  type: "choice",
  rev: 1,
  status: "open",
  options: [
    { value: "sqlite", label: "sqlite" },
    { value: "json", label: "json" },
  ],
  recommendation: "sqlite",
};

/** The EXACT h2.35 template for SQLITE_Q (star by VALUE, em dash, no \n tail). */
const SQLITE_TEMPLATE = [
  "> Should we use sqlite or json?",
  "★ sqlite",
  "json",
  "(discussing q3 — agent: side-chat freely; reopen panel when done)",
].join("\n");

// ----------------------------------------------------------------- fixtures

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    ...overrides,
  };
}

/** Real state with q1..q3 in order (q3 = the sqlite question). */
function makeState(): InterrogationState {
  const state = createInterrogationState("goal");
  state.upsertQuestion(choiceQ("q1"));
  state.upsertQuestion(choiceQ("q2"));
  state.upsertQuestion({ ...SQLITE_Q });
  return state;
}

// ------------------------------------------------------- coordinator fakes

/** Minimal InterrogationPanel stand-in: exactly what discussInChat touches. */
function fakePanel(
  state: InterrogationState,
  currentId: string | undefined,
): InterrogationPanel & { suspend: Mock } {
  return {
    currentId,
    state,
    suspend: vi.fn(),
  } as unknown as InterrogationPanel & { suspend: Mock };
}

function fakePi(setEditorText?: Mock): PiUISurface {
  const ui = setEditorText === undefined ? {} : { setEditorText };
  return { mode: "tui", ui } as unknown as PiUISurface;
}

// ------------------------------------------------------- integration mock pi

/** Identity theme so layout renderers run in tests (stub per panel.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

interface CustomCall {
  component: Component;
  done: (result: null | undefined) => void;
}

type SetEditorCall = [text: string];

interface MockPi {
  pi: PiUISurface;
  custom: Mock;
  calls: CustomCall[];
  /** Every setEditorText(text) call, in order. */
  editorCalls: SetEditorCall[];
}

function makeMockPi(mode: string | undefined = "tui"): MockPi {
  const calls: CustomCall[] = [];
  const editorCalls: SetEditorCall[] = [];

  const custom = vi.fn(
    (
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: null) => void,
      ) => Component,
    ): Promise<null | undefined> => {
      let resolve!: (result: null | undefined) => void;
      const promise = new Promise<null | undefined>((res) => {
        resolve = res;
      });
      const done = vi.fn((result: null | undefined): void => resolve(result));
      const component = factory(
        { requestRender: vi.fn() } as unknown as TUI,
        stubTheme,
        {} as unknown as KeybindingsManager,
        done,
      );
      calls.push({ component, done });
      return promise;
    },
  );

  const setEditorText = vi.fn((text: string): void => {
    editorCalls.push([text]);
  });

  const pi = { mode, ui: { custom, setEditorText } } as unknown as PiUISurface;
  return { pi, custom, calls, editorCalls };
}

function makeMockLifecycle(): { onPanelDismiss: (cb: () => void) => void; dismissPanel: () => void } {
  let cb: (() => void) | undefined;
  return {
    onPanelDismiss: (registered) => {
      cb = registered;
    },
    dismissPanel: () => cb?.(),
  };
}

function firstCall(mock: MockPi): CustomCall {
  expect(mock.calls.length).toBeGreaterThan(0);
  return mock.calls[0]!;
}

/** Flush microtasks so deferred writes + the floating custom() .then run. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------- template (pure)

describe("buildDiscussTemplate — exact h2.35 contract", () => {
  test("test_buildDiscussTemplate_choice_with_recommendation_exact_string", () => {
    // Full-equality assert: prompt verbatim, ★ on the recommended VALUE,
    // plain label otherwise, footer with literal id + em dash, no trailing
    // newline.
    expect(buildDiscussTemplate(SQLITE_Q)).toBe(SQLITE_TEMPLATE);
  });

  test("test_buildDiscussTemplate_no_recommendation_no_star_anywhere", () => {
    const q = { ...SQLITE_Q, recommendation: undefined };
    const text = buildDiscussTemplate(q);
    expect(text).not.toContain("★");
    expect(text).toBe(
      [
        "> Should we use sqlite or json?",
        "sqlite",
        "json",
        "(discussing q3 — agent: side-chat freely; reopen panel when done)",
      ].join("\n"),
    );
  });

  test("test_buildDiscussTemplate_text_question_two_lines_only", () => {
    const q: Question = {
      id: "q7",
      prompt: "What is the deploy target?",
      type: "text",
      rev: 1,
      status: "open",
    };
    const text = buildDiscussTemplate(q);
    expect(text).toBe(
      "> What is the deploy target?\n(discussing q7 — agent: side-chat freely; reopen panel when done)",
    );
    expect(text.split("\n")).toHaveLength(2);
  });

  test("test_buildDiscussTemplate_star_matches_value_not_label", () => {
    // Renamed label, same value: the star must FOLLOW THE VALUE (the
    // short-view.ts rule) — a label match would silently drop it.
    const q = {
      ...SQLITE_Q,
      options: [
        { value: "sqlite", label: "SQLite (embedded)" },
        { value: "json", label: "JSON files" },
      ],
    };
    expect(buildDiscussTemplate(q)).toBe(
      [
        "> Should we use sqlite or json?",
        "★ SQLite (embedded)",
        "JSON files",
        "(discussing q3 — agent: side-chat freely; reopen panel when done)",
      ].join("\n"),
    );
  });

  test("test_buildDiscussTemplate_footer_exactness_and_no_trailing_newline", () => {
    const text = buildDiscussTemplate(SQLITE_Q);
    expect(text.endsWith("\n")).toBe(false);
    expect(text.split("\n").at(-1)).toBe(
      "(discussing q3 — agent: side-chat freely; reopen panel when done)",
    );
  });

  test("test_buildDiscussTemplate_choice_empty_options_no_option_lines", () => {
    const q = { ...SQLITE_Q, options: [] };
    expect(buildDiscussTemplate(q).split("\n")).toHaveLength(2);
  });
});

// ------------------------------------------------- coordinator (fake panel)

describe("discussInChat — suspend + deferred editor preload", () => {
  test("test_discussInChat_happy_path_suspend_then_deferred_exact_write", async () => {
    const state = makeState();
    const panel = fakePanel(state, "q3");
    const setEditorText = vi.fn();
    const pi = fakePi(setEditorText);

    expect(discussInChat(pi, panel)).toBe(true);
    // Suspend happens SYNCHRONOUSLY (done(null) path)…
    expect(panel.suspend).toHaveBeenCalledTimes(1);
    // …but the editor write is DEFERRED past a microtask (the custom()
    // resolution restores the editor first — an immediate write would be
    // clobbered).
    expect(setEditorText).not.toHaveBeenCalled();

    // Mirrors the deferral: one microtask tick is the minimum ordering.
    await Promise.resolve();
    expect(setEditorText).toHaveBeenCalledTimes(1);
    expect(setEditorText).toHaveBeenCalledWith(SQLITE_TEMPLATE);
  });

  test("test_discussInChat_undefined_currentId_false_no_suspend_no_write", async () => {
    const state = makeState();
    const panel = fakePanel(state, undefined);
    const setEditorText = vi.fn();

    expect(discussInChat(fakePi(setEditorText), panel)).toBe(false);
    expect(panel.suspend).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(setEditorText).not.toHaveBeenCalled();
  });

  test("test_discussInChat_missing_question_false_no_suspend_no_write", async () => {
    const state = makeState(); // q99 never upserted
    const panel = fakePanel(state, "q99");
    const setEditorText = vi.fn();

    expect(discussInChat(fakePi(setEditorText), panel)).toBe(false);
    expect(panel.suspend).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(setEditorText).not.toHaveBeenCalled();
  });

  test("test_discussInChat_optional_setEditorText_suspend_still_happens", () => {
    // Test fakes / RPC surfaces lack setEditorText: the optional seam must
    // silently skip the write — never throw — and still suspend.
    const state = makeState();
    const panel = fakePanel(state, "q3");

    expect(() => discussInChat(fakePi(), panel)).not.toThrow();
    expect(panel.suspend).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------- wiring (router + openPanel, real)

describe("discuss handoff wiring — keys.ts router → discussInChat", () => {
  test("test_discuss_key_from_short_view_suspends_and_preloads_exact_template", async () => {
    const mock = makeMockPi();
    const lifecycle = makeMockLifecycle();
    const host = createPanelHost(lifecycle);
    const state = makeState();

    expect(openPanel(mock.pi, { config: DEFAULT_CONFIG, state, focusQuestionId: "q3" })).toBe(true);
    const panel = firstCall(mock).component as unknown as {
      handleInput(data: string): boolean;
      currentId: string | undefined;
    };
    expect(panel.currentId).toBe("q3");

    // ctrl+shift+e from the SHORT view: consumed, panel suspends…
    expect(panel.handleInput(DISCUSS)).toBe(true);
    expect(firstCall(mock).done).toHaveBeenCalledTimes(1);

    await flush();
    expect(host.isSuspended()).toBe(true);
    // …suspend widget line painted, and the editor preloaded with the
    // EXACT h2.35 template (star on sqlite).
    expect(mock.editorCalls).toEqual([[SQLITE_TEMPLATE]]);

    // Resume path untouched by the handoff: ctrl+shift+q equivalent works.
    // RESUME-001: the fresh panel focuses the FIRST UNANSWERED question
    // (q1 — everything here is open), not the pre-suspend q3.
    expect(resumePanel(mock.pi)).toBe(true);
    expect(host.isOpen()).toBe(true);
    const reopened = mock.calls[1]!.component as unknown as { currentId: string | undefined };
    expect(reopened.currentId).toBe("q1");
  });

  test("test_discuss_key_same_template_from_deep_and_overview_views", async () => {
    // "From ANY view": currentId is view-independent, so the template is
    // byte-identical in short / deep / overview.
    for (const view of ["short", "deep", "overview"] as const) {
      const mock = makeMockPi();
      createPanelHost(makeMockLifecycle());
      const state = makeState();

      expect(openPanel(mock.pi, { config: DEFAULT_CONFIG, state, focusQuestionId: "q3" })).toBe(
        true,
      );
      const panel = firstCall(mock).component as unknown as {
        handleInput(data: string): boolean;
        setView(view: "short" | "deep" | "overview"): void;
      };
      panel.setView(view);
      expect(panel.handleInput(DISCUSS)).toBe(true);

      await flush();
      expect(mock.editorCalls).toEqual([[SQLITE_TEMPLATE]]);
    }
  });
});

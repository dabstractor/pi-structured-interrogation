/**
 * src/panel/text-field.test.ts — embedded-editor selection + wrapper tests
 * (P1.M4.T1.S1).
 *
 * Conventions follow panel.test.ts / actions.test.ts: bare stub theme
 * ({fg, bold} cast to Theme), stub TUI, vi.fn() spies, no live pi session.
 * The composed-editor fake is a plain literal object implementing the
 * EditorComponent interface — exactly the shape pi-vim etc. must satisfy
 * (nothing beyond the optional surface is assumed).
 *
 * Selection matrix covered here (createEditorComponent):
 *   factory defined + editorMode "composed" → composed, factory called once
 *   factory defined + editorMode "stock"    → stock, factory never called
 *   factory undefined + editorMode "composed" → stock (silent fallback)
 *   factory undefined + editorMode "stock"    → stock
 */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorComponent, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type EditorMode, type InterrogatorConfig } from "../config.js";
import type { CaptureKey, InputCaptureStore } from "../input-capture.js";
import {
  buildEditorTheme,
  createEditorComponent,
  DEFAULT_TEXT_LINES,
  TextField,
} from "./text-field.js";

// ------------------------------------------------------------------ fixtures

/** Recording theme: fg prefixes the color name so accent/muted routing is assertable. */
const recordingTheme = {
  fg: (name: string, s: string) => `${name}:${s}`,
  bold: (s: string) => s,
} as unknown as Theme;

/** Identity theme (stub per panel.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const stubTui = { requestRender: vi.fn() } as unknown as TUI;
const stubKeybindings = {} as unknown as KeybindingsManager;

/** Stateful fake editor component — the pi-vim-shaped structural contract. */
function fakeEditor(): EditorComponent & {
  focused: boolean;
  addToHistory: ReturnType<typeof vi.fn>;
} {
  let text = "";
  const editor = {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["one", "two", "three"]),
    focused: false,
    addToHistory: vi.fn(),
    getExpandedText: vi.fn(() => text),
  };
  return editor as unknown as EditorComponent & {
    focused: boolean;
    addToHistory: ReturnType<typeof vi.fn>;
  };
}

function configWith(mode: EditorMode): InterrogatorConfig {
  return { ...DEFAULT_CONFIG, editorMode: mode };
}

function makeTextField(editor = fakeEditor()): {
  field: TextField;
  editor: ReturnType<typeof fakeEditor>;
  onInvalidate: ReturnType<typeof vi.fn>;
} {
  const onInvalidate = vi.fn();
  const field = new TextField({ editor, theme: stubTheme, onInvalidate });
  return { field, editor, onInvalidate };
}

// ------------------------------------------------- createEditorComponent

describe("createEditorComponent — composed-vs-stock selection", () => {
  test("test_composed_mode_calls_factory_once_with_live_args", () => {
    const factory = vi.fn(
      (_tui: TUI, _theme: EditorTheme, _kb: KeybindingsManager): EditorComponent =>
        fakeEditor(),
    );
    const result = createEditorComponent(
      factory,
      configWith("composed"),
      stubTui,
      recordingTheme,
      stubKeybindings,
    );

    // Exactly ONE call, with the LIVE tui/keybindings and a theme built by
    // buildEditorTheme (accent border — the questionnaire.ts pattern).
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      stubTui,
      expect.objectContaining({
        borderColor: expect.any(Function),
        selectList: expect.any(Object),
      }),
      stubKeybindings,
    );
    expect(result).toBe(factory.mock.results[0]?.value);
  });

  test("test_stock_mode_bypasses_factory", () => {
    const factory = vi.fn(
      (_tui: TUI, _theme: EditorTheme, _kb: KeybindingsManager): EditorComponent =>
        fakeEditor(),
    );
    const result = createEditorComponent(
      factory,
      configWith("stock"),
      stubTui,
      stubTheme,
      stubKeybindings,
    );

    expect(factory).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Editor);
  });

  test("test_absent_factory_composed_mode_falls_back_to_stock_silently", () => {
    const result = createEditorComponent(
      undefined,
      configWith("composed"),
      stubTui,
      stubTheme,
      stubKeybindings,
    );

    expect(result).toBeInstanceOf(Editor);
  });

  test("test_absent_factory_stock_mode_falls_back_to_stock", () => {
    const result = createEditorComponent(
      undefined,
      configWith("stock"),
      stubTui,
      stubTheme,
      stubKeybindings,
    );

    expect(result).toBeInstanceOf(Editor);
  });
});

// ------------------------------------------------------- buildEditorTheme

describe("buildEditorTheme", () => {
  test("test_editor_theme_rides_panel_theme_palette", () => {
    const t = buildEditorTheme(recordingTheme);
    expect(t.borderColor("│")).toBe("accent:│");
    expect(t.selectList.selectedPrefix("›")).toBe("accent:›");
    expect(t.selectList.selectedText("a")).toBe("accent:a");
    expect(t.selectList.description("d")).toBe("muted:d");
    expect(t.selectList.scrollInfo("s")).toBe("dim:s");
    expect(t.selectList.noMatch("n")).toBe("warning:n");
  });
});

// ------------------------------------------------------------ TextField

describe("TextField — delegation", () => {
  test("test_handleInput_delegates_then_invalidates", () => {
    const { field, editor, onInvalidate } = makeTextField();
    field.handleInput("x");
    expect(editor.handleInput).toHaveBeenCalledTimes(1);
    expect(editor.handleInput).toHaveBeenCalledWith("x");
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  test("test_getText_prefers_getExpandedText_when_present", () => {
    const editor = fakeEditor();
    editor.getExpandedText = vi.fn(() => "expanded");
    editor.setText("plain");
    const { field } = makeTextField(editor);
    expect(field.getText()).toBe("expanded");
  });

  test("test_getText_falls_back_to_getText_without_getExpandedText", () => {
    const editor = fakeEditor();
    editor.setText("plain");
    // Feature-detect path: the composed component may omit getExpandedText.
    (editor as { getExpandedText?: unknown }).getExpandedText = undefined;
    const { field } = makeTextField(editor);
    expect(field.getText()).toBe("plain");
  });

  test("test_setText_passes_through", () => {
    const { field, editor } = makeTextField();
    field.setText("hello");
    expect(editor.setText).toHaveBeenCalledWith("hello");
    expect(field.getText()).toBe("hello");
  });

  test("test_seed_sets_when_different_and_is_idempotent", () => {
    const { field, editor } = makeTextField();
    field.seed("draft");
    expect(editor.setText).toHaveBeenCalledTimes(1);
    expect(field.getText()).toBe("draft");
    // Same draft again → no-op (no history churn, no repaint need).
    field.seed("draft");
    expect(editor.setText).toHaveBeenCalledTimes(1);
    // Different draft → set.
    field.seed("updated");
    expect(editor.setText).toHaveBeenCalledTimes(2);
  });
});

describe("TextField — focus lifecycle", () => {
  test("test_not_focused_at_construction", () => {
    const { field, editor } = makeTextField();
    expect(field.focused).toBe(false);
    expect(editor.focused).toBe(false);
  });

  test("test_focus_sets_wrapper_and_editor_flags", () => {
    const { field, editor } = makeTextField();
    field.focus();
    expect(field.focused).toBe(true);
    expect(editor.focused).toBe(true);
  });

  test("test_blur_clears_both_flags_and_invalidates", () => {
    const { field, editor, onInvalidate } = makeTextField();
    field.focus();
    field.blur();
    expect(field.focused).toBe(false);
    expect(editor.focused).toBe(false);
    expect(onInvalidate).toHaveBeenCalled();
  });

  test("test_focus_tolerates_component_without_focused_flag", () => {
    // A composed EditorComponent need not implement pi-tui's Focusable —
    // focus/blur must not crash when the property is absent.
    const editor = fakeEditor();
    delete (editor as { focused?: boolean }).focused;
    const { field } = makeTextField(editor);
    expect(() => {
      field.focus();
      field.blur();
    }).not.toThrow();
    expect(field.focused).toBe(false);
  });
});

describe("TextField — render", () => {
  test("test_render_delegates_at_width_minus_two_and_prefixes_margin", () => {
    const { field, editor } = makeTextField();
    const lines = field.render(80);
    expect(editor.render).toHaveBeenCalledTimes(1);
    expect(editor.render).toHaveBeenCalledWith(78);
    expect(lines).toEqual([" one", " two", " three"]);
  });

  test("test_render_pads_to_stable_default_line_count", () => {
    const editor = fakeEditor();
    editor.render = vi.fn(() => ["only"]);
    const { field } = makeTextField(editor);
    expect(field.render(40)).toEqual([" only", "", ""]);
    expect(field.lineCount()).toBe(DEFAULT_TEXT_LINES);
  });

  test("test_lineCount_defaults_three_and_grows_only_with_editor", () => {
    const { field } = makeTextField();
    expect(field.lineCount()).toBe(DEFAULT_TEXT_LINES);
    const editor = fakeEditor();
    editor.render = vi.fn(() => ["1", "2", "3", "4", "5"]);
    const grown = makeTextField(editor);
    grown.field.render(30);
    expect(grown.field.lineCount()).toBe(5);
  });
});

describe("TextField — history isolation (h2.31)", () => {
  test("test_no_history_writes_across_all_operations", () => {
    const { field, editor } = makeTextField();
    field.handleInput("x");
    field.setText("abc");
    field.seed("abcd");
    field.seed("abcd");
    field.focus();
    field.blur();
    field.render(80);
    field.getText();
    expect(editor.addToHistory).not.toHaveBeenCalled();
  });
});

// --------------------------------------- input-recovery capture (P3.M2.T1.S1)

/** Capture-store stub: records setKeyDirty calls + the passed text getters. */
function captureStub(): {
  store: InputCaptureStore;
  setKeyDirty: Mock;
  texts: string[];
} {
  const texts: string[] = [];
  const setKeyDirty: Mock = vi.fn((_key: CaptureKey, getText: () => string) => {
    texts.push(getText()); // the store reads EAGERLY — mirror that here
  });
  const store = { setKeyDirty } as unknown as InputCaptureStore;
  return { store, setKeyDirty, texts };
}

const PROVIDER_KEY: CaptureKey = { branchId: "br", questionId: "q1", field: "writein" };

/** fakeEditor variant whose setText fires onChange — the stock Editor does (setTextInternal). */
function autoFireEditor(): ReturnType<typeof fakeEditor> {
  const editor = fakeEditor();
  const origSetText = editor.setText;
  editor.setText = vi.fn((t: string) => {
    (origSetText as (t: string) => void)(t);
    editor.onChange?.(t);
  });
  return editor;
}

describe("TextField — input-recovery capture seam (P3.M2.T1.S1)", () => {
  test("WRAP-AND-CHAIN: composed factory's onChange still fires alongside capture", () => {
    const editor = fakeEditor();
    const factoryOnChange = vi.fn();
    editor.onChange = factoryOnChange; // composed factory installed its own
    const { field, onInvalidate } = makeTextField(editor);
    const capture = captureStub();
    field.setCapture(capture.store, () => PROVIDER_KEY);

    field.editor.onChange?.("typed");

    // BOTH callbacks ran: the factory's first (never dropped), then
    // invalidate (render liveness), then capture (recovery).
    expect(factoryOnChange).toHaveBeenCalledWith("typed");
    expect(onInvalidate).toHaveBeenCalled();
    expect(capture.setKeyDirty).toHaveBeenCalledTimes(1);
    expect(capture.setKeyDirty).toHaveBeenCalledWith(PROVIDER_KEY, expect.any(Function));
  });

  test("no-onChange editor still gets capture installed (stock path)", () => {
    const { field, onInvalidate } = makeTextField(); // fakeEditor has no onChange
    const capture = captureStub();
    field.setCapture(capture.store, () => PROVIDER_KEY);
    expect(field.editor.onChange).toBeDefined(); // install happened
    field.editor.onChange?.("x");
    expect(onInvalidate).toHaveBeenCalled();
    expect(capture.setKeyDirty).toHaveBeenCalledTimes(1);
  });

  test("provider returning undefined (un-owned buffer / no branch reader) → no capture, no throw", () => {
    const { field } = makeTextField();
    const capture = captureStub();
    field.setCapture(capture.store, () => undefined);
    expect(() => field.editor.onChange?.("x")).not.toThrow();
    expect(capture.setKeyDirty).not.toHaveBeenCalled();
  });

  test("no store wired → capture fully inert (existing call sites)", () => {
    const { field } = makeTextField();
    field.setCapture(undefined, () => PROVIDER_KEY);
    expect(() => field.editor.onChange?.("x")).not.toThrow();
  });

  test("key provider resolves LIVE at edit time (ownership switch between edits)", () => {
    const { field } = makeTextField();
    const capture = captureStub();
    let current: CaptureKey = PROVIDER_KEY;
    field.setCapture(capture.store, () => current);
    field.editor.onChange?.("a");
    current = { branchId: "br", questionId: "q2", field: "elaboration" }; // user navigated
    field.editor.onChange?.("b");
    const calls = capture.setKeyDirty.mock.calls as unknown as Array<[CaptureKey, () => string]>;
    expect(calls[0][0].questionId).toBe("q1");
    expect(calls[1][0].questionId).toBe("q2");
    expect(calls[1][0].field).toBe("elaboration");
  });

  test("expanded text only: the capture getter reads getExpandedText, never the preview", () => {
    const editor = fakeEditor();
    // Preview (getText) differs from expanded (getExpandedText) — paste marker.
    let expanded = "line1\nline2";
    editor.getText = vi.fn(() => "[paste 2 lines]");
    editor.getExpandedText = vi.fn(() => expanded);
    const { field } = makeTextField(editor);
    const capture = captureStub();
    field.setCapture(capture.store, () => PROVIDER_KEY);
    field.editor.onChange?.("pasted");
    expect(capture.texts).toEqual(["line1\nline2"]); // FULL expanded string
    expanded = "\nindent kept\n";
    field.editor.onChange?.("pasted again");
    expect(capture.texts[1]).toBe("\nindent kept\n");
  });

  test("getExpandedText absent → falls back to getText (stock Editor)", () => {
    const editor = fakeEditor();
    delete (editor as { getExpandedText?: unknown }).getExpandedText;
    const { field } = makeTextField(editor);
    const capture = captureStub();
    field.setCapture(capture.store, () => PROVIDER_KEY);
    editor.setText("plain"); // raw editor write — the buffer now HOLDS "plain"
    field.editor.onChange?.("plain");
    expect(capture.texts).toEqual(["plain"]); // editor.getText() ran
  });

  test("programmatic setText NEVER captures — seeding/incidental buffers mint nothing", () => {
    const editor = autoFireEditor(); // setText fires onChange (stock Editor does)
    const { field } = makeTextField(editor);
    const capture = captureStub();
    field.setCapture(capture.store, () => PROVIDER_KEY);

    field.setText("seeded draft"); // incidental write — onChange FIRED but…
    field.seed("re-seeded"); // …capture must still see NOTHING.

    // The chained callbacks DID run (factory parity preserved) — but the
    // suppression flag kept the store out of it entirely.
    expect(capture.setKeyDirty).not.toHaveBeenCalled();
  });

  test("capture fires for paste-as-mutation then for typed edits — same path", () => {
    const editor = fakeEditor();
    const { field } = makeTextField(editor);
    const capture = captureStub();
    field.setCapture(capture.store, () => PROVIDER_KEY);
    editor.setText("pasted block\nline 2");
    field.editor.onChange?.("pasted block\nline 2");
    editor.setText("pasted block\nline 2!");
    field.editor.onChange?.("pasted block\nline 2!");
    expect(capture.setKeyDirty).toHaveBeenCalledTimes(2);
    expect(capture.texts).toEqual(["pasted block\nline 2", "pasted block\nline 2!"]);
  });
});

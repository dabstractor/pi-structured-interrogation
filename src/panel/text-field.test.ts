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
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG, type EditorMode, type InterrogatorConfig } from "../config.js";
import {
  buildEditorTheme,
  createEditorComponent,
  DEFAULT_TEXT_LINES,
  TextField,
  type EditorFactory,
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

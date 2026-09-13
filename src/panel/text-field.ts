/**
 * src/panel/text-field.ts — embedded free-text editor (P1.M4.T1.S1).
 *
 * Wraps ONE editor component per panel lifetime (h2.31): the user's ACTIVE
 * composed editor (e.g. pi-vim via ctx.ui.getEditorComponent()) when
 * available AND config.editorMode === "composed", else pi-tui's stock
 * Editor. The panel (panel.ts) instantiates it inside its custom() factory
 * body so the editor receives the LIVE tui/theme/keybindings pi handed in;
 * repeated renders/keystrokes never re-instantiate (suspend → reopen
 * creates a fresh panel and therefore a fresh editor — drafts survive via
 * the drafts seam, not via this instance).
 *
 * MODE A — composed-vs-stock selection (createEditorComponent):
 * composed mode embeds the user's ACTIVE editor by invoking the captured
 * `getEditorComponent()` factory with the live custom() arguments. The
 * editorMode "stock" escape hatch (h2.51 risk row 1) or an absent factory
 * (getEditorComponent() is undefined whenever no composed editor is
 * registered — a normal state, never warned about) falls back to
 * `new Editor(tui, editorTheme)` so the panel is never hostage to
 * composed-editor quirks. Exactly ONE component is created per call — the
 * panel calls this once per instantiation.
 *
 * History isolation (h2.31): the embedded editor NEVER receives
 * history entries — free-text answers keep separate history semantics
 * (hardenened in S2). This module contains no history writes.
 *
 * Enter semantics: onSubmit is deliberately NOT set here — two-stage enter
 * is P1.M4.T1.S2. Setting `onChange` to the panel's invalidate callback is
 * allowed and keeps rendering live (only when the factory has not already
 * installed its own onChange).
 */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorComponent,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { InterrogatorConfig } from "../config.js";

/**
 * Structural mirror of pi's `EditorFactory`
 * (core/extensions/types.d.ts: `(tui, theme, keybindings) => EditorComponent`).
 * pi does not re-export the type from its package root, so the exact
 * signature is restated here to avoid a deep import path.
 */
export type EditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;

/**
 * Line count the panel's short-view editor region reserves by default
 * (h2.29). render() pads up to this many lines for layout determinism; it
 * grows beyond it only when the editor itself returns more lines (mirrors
 * questionnaire.ts, which just renders the editor's lines with a prefix).
 */
export const DEFAULT_TEXT_LINES = 3;

/**
 * EditorTheme built from the panel theme (questionnaire.ts pattern): the
 * border + select-list accents ride the theme's fg palette so the embedded
 * editor matches the panel instead of pi's global theme.
 */
export function buildEditorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (s) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    },
  };
}

/**
 * Composed-vs-stock selection — see the MODE A JSDoc on this module.
 *
 * - `config.editorMode === "composed"` AND `factory` defined → the user's
 *   composed editor, constructed with the LIVE (tui, editorTheme,
 *   keybindings) passed by pi's custom() body. Called exactly once.
 * - Otherwise → stock pi-tui `Editor` (editorMode escape hatch, or no
 *   composed editor registered — silent fallback, no warn spam).
 */
export function createEditorComponent(
  factory: EditorFactory | undefined,
  config: InterrogatorConfig,
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
): EditorComponent {
  if (config.editorMode === "composed" && factory !== undefined) {
    return factory(tui, buildEditorTheme(theme), keybindings);
  }
  return new Editor(tui, buildEditorTheme(theme));
}

/** Constructor dependencies for {@link TextField}. */
export interface TextFieldArgs {
  /** Composed or stock editor — see {@link createEditorComponent}. */
  editor: EditorComponent;
  /** Panel theme (S2 reuses it for dim prefix/preview rendering). */
  theme: Theme;
  /** Called after any input/render-state change → panel.requestRender. */
  onInvalidate(): void;
}

/**
 * Panel-side wrapper around the embedded editor component. Only the
 * OPTIONAL EditorComponent surface is assumed beyond
 * getText/setText/handleInput/render — a composed component (pi-vim etc.)
 * need not extend the stock Editor, so every extra is feature-detected
 * (`getExpandedText?.()`, optional `focused`, optional `onChange`).
 */
export class TextField {
  readonly editor: EditorComponent;
  /** Mirrors editor.focused where the component implements Focusable. */
  focused = false;
  private readonly theme: Theme;
  private readonly onInvalidate: () => void;
  /** Lines produced by the last render pass (for {@link lineCount}). */
  private lastRendered = 0;

  constructor(args: TextFieldArgs) {
    this.editor = args.editor;
    this.theme = args.theme;
    this.onInvalidate = args.onInvalidate;
    // Keep rendering live on text changes — but never clobber a callback
    // the composed editor's factory already installed.
    if (this.editor.onChange === undefined) {
      this.editor.onChange = () => this.onInvalidate();
    }
  }

  /**
   * Lines the editor region currently occupies: the last render pass's
   * count, but never fewer than the 3 reserved lines (h2.29). Defaults to
   * 3 before the first render.
   */
  lineCount(): number {
    return Math.max(DEFAULT_TEXT_LINES, this.lastRendered);
  }

  /**
   * Editor lines at `width - 2`, each prefixed with one column of left
   * margin (questionnaire.ts pattern), padded to {@link DEFAULT_TEXT_LINES}
   * so the panel layout stays deterministic when the editor renders short.
   */
  render(width: number): string[] {
    const inner = this.editor.render(Math.max(1, width - 2));
    this.lastRendered = inner.length;
    const lines = inner.map((line) => ` ${line}`);
    while (lines.length < DEFAULT_TEXT_LINES) lines.push("");
    return lines;
  }

  /** Forward raw input to the editor, then schedule a repaint. */
  handleInput(data: string): void {
    this.editor.handleInput(data);
    this.onInvalidate();
  }

  /**
   * Current text — paste markers expanded when the component implements
   * `getExpandedText`, plain getText otherwise.
   */
  getText(): string {
    return this.editor.getExpandedText?.() ?? this.editor.getText();
  }

  setText(text: string): void {
    this.editor.setText(text);
  }

  /**
   * Seed the draft: set only when the field currently holds something
   * different (idempotent — re-focusing with the same draft is a no-op).
   * A no-history primitive: seeding never pushes editor history entries.
   */
  seed(text: string): void {
    if (this.getText() !== text) this.setText(text);
  }

  /** Focus the field (wrapper flag + the editor's Focusable flag). */
  focus(): void {
    this.focused = true;
    setEditorFocused(this.editor, true);
  }

  /** Blur the field and schedule a repaint (focus indicator drops). */
  blur(): void {
    this.focused = false;
    setEditorFocused(this.editor, false);
    this.onInvalidate();
  }
}

/**
 * Feature-detected focus flip: `focused` belongs to pi-tui's Focusable
 * surface (implemented by the stock Editor); a composed EditorComponent may
 * not declare it, so the write is tolerant instead of assumed.
 */
function setEditorFocused(editor: EditorComponent, focused: boolean): void {
  (editor as { focused?: boolean }).focused = focused;
}

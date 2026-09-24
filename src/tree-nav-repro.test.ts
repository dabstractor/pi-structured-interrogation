/**
 * tree-nav-repro.test.ts — faithful simulation of pi 0.85.1's /tree flow
 * against the REAL extension, replicating:
 *
 * - showExtensionCustom: savedText captured at panel open; editor container
 *   swap; restoreEditor() on done() sets the editor back to savedText.
 * - navigateTree ordering: session_tree emitted INSIDE (handlers awaited),
 *   then chatContainer.clear + renderInitialMessages, then
 *   `if (result.editorText && !editor.getText().trim()) editor.setText(...)`.
 * - maybeAutoOpen on interrogate tool_execution_end.
 *
 * Scenarios: panel suspended / open / closed at navigation time, plus a
 * post-navigation agent READ call.
 */
import { describe, expect, test, vi } from "vitest";

// We can't easily run the full factory (it needs registerTool etc.) — but
// FakePi harnesses exist in reload-invoke.test.ts. Reuse its shape minimally:
// instead, this simulation drives the real modules directly.

import { DEFAULT_CONFIG } from "./config.js";
import { InterrogationState, getState, resetState, setState } from "./state.js";
import { DraftStore } from "./draft-store.js";
import {
  createPanelHost,
  maybeAutoOpen,
  openPanel,
  type PiUISurface,
} from "./panel/panel.js";

class FakeLifecycle {
  dismissed = 0;
  notesDelivered = 0;
  onPanelDismiss(cb: () => void): void {
    this.cb = cb;
  }
  cb: (() => void) | undefined;
  dismissPanel(): void {
    this.dismissed++;
    this.cb?.();
  }
  noteSubmissionDelivered(): void {
    this.notesDelivered++;
  }
}

interface CustomCall {
  factoryDone: (r: null) => void;
}

/** Surface replicating showExtensionCustom's savedText semantics. */
class FakeTuiSurface implements PiUISurface {
  mode = "tui";
  editorText = "";
  customCalls: CustomCall[] = [];
  widget: string[] | undefined;
  private savedText: string | undefined;

  ui = {
    custom: async <T,>(_factory: unknown): Promise<T | undefined> => {
      // pi captures the editor text at OPEN time; restore on done.
      this.savedText = this.editorText;
      return new Promise<T | undefined>((resolve) => {
        this.customCalls.push({
          factoryDone: (r: null) => {
            // pi's restoreEditor(): editor text back to savedText
            this.editorText = this.savedText ?? "";
            resolve(r as T | undefined);
          },
        });
      });
    },
    setWidget: (_key: string, content: string[] | undefined) => {
      this.widget = content;
    },
    setEditorText: (t: string) => {
      this.editorText = t;
    },
    getEditorText: () => this.editorText,
  };

  sendMessage = vi.fn();
  isIdle = () => true;
}

function seeded(): InterrogationState {
  const state = new InterrogationState("g");
  state.upsertQuestion({
    id: "q1",
    prompt: "p1",
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  });
  state.upsertQuestion({
    id: "q2",
    prompt: "p2",
    type: "text",
    rev: 1,
    status: "open",
  });
  return state;
}

function allAnswered(): InterrogationState {
  const state = seeded();
  state.applyAnswer("q1", { value: "a", at: "t" });
  state.applyAnswer("q2", { value: "free text", at: "t" });
  return state;
}

describe("/tree navigation simulation (pi 0.85.1 mechanics)", () => {
  test("panel SUSPENDED at nav time: nothing opens; editor keeps restored text", async () => {
    resetState();
    const state = allAnswered();
    setState(state);
    const surface = new FakeTuiSurface();
    const lifecycle = new FakeLifecycle();
    const host = createPanelHost(lifecycle, surface);
    const drafts = new DraftStore();

    // Interrogation was live; user had the panel open with an empty editor,
    // then suspended it (esc). pi restored the editor to savedText ("").
    openPanel(surface, { config: DEFAULT_CONFIG, state, drafts });
    expect(surface.customCalls.length).toBe(1);
    surface.customCalls[0]!.factoryDone(null); // esc suspend
    await new Promise<void>((r) => setImmediate(r));
    expect(host.isSuspended()).toBe(true);

    // /tree: navigate to a user message whose text is "old prompt".
    surface.editorText = ""; // box empty at nav time
    // session_tree handler:
    // (simulate the reconstruction silent path — the real handler calls the
    // same host seams; reconstructFromBranch is covered by its own tests; we
    // assert the HOST contract here: retarget + suspend-if-open only)
    host.retargetState(state, surface);
    if (host.isOpen()) host.suspend();
    // pi's TUI restore:
    const resultEditorText = "old prompt";
    if (resultEditorText && !surface.editorText.trim()) {
      surface.editorText = resultEditorText;
    }
    expect(surface.customCalls.length).toBe(1); // NO new panel
    expect(surface.editorText).toBe("old prompt");
  });

  test("panel OPEN at nav time (tree keybinding): suspends; text restore lands", async () => {
    resetState();
    const state = allAnswered();
    setState(state);
    const surface = new FakeTuiSurface();
    const lifecycle = new FakeLifecycle();
    const host = createPanelHost(lifecycle, surface);

    openPanel(surface, { config: DEFAULT_CONFIG, state, drafts: new DraftStore() });
    expect(surface.customCalls.length).toBe(1);
    expect(host.isOpen()).toBe(true);

    // session_tree → reconstruction suspends the open panel:
    host.retargetState(state, surface);
    if (host.isOpen()) host.suspend();
    // pi's TUI restore (editor was restored to savedText "" by the suspend):
    const resultEditorText = "old prompt";
    if (resultEditorText && !surface.editorText.trim()) {
      surface.editorText = resultEditorText;
    }
    expect(surface.customCalls.length).toBe(1); // panel closed, not re-opened
    expect(surface.editorText).toBe("old prompt");
  });

  test("post-nav agent READ (interrogate {}): panel stays closed (SURFACE-001 — reads never surface)", async () => {
    resetState();
    const state = allAnswered();
    setState(state);
    const surface = new FakeTuiSurface();
    const lifecycle = new FakeLifecycle();
    const host = createPanelHost(lifecycle, surface);
    const drafts = new DraftStore();
    const pi = {
      on: (_e: string, h: (ev: unknown, ctx: unknown) => void) => {
        (pi as { handlers?: Map<string, unknown> }).handlers ??= new Map();
        ((pi as { handlers?: Map<string, unknown> }).handlers as Map<string, unknown>).set(_e, h);
        return () => {};
      },
      handlers: new Map<string, (ev: unknown, ctx: unknown) => void>(),
    };
    maybeAutoOpen(pi as never, DEFAULT_CONFIG, host, drafts);

    // The user navigated (box holds their old prompt), then sent it; the
    // model re-orients with a pure READ:
    surface.editorText = "old prompt (submitted, box now empty)";
    surface.editorText = "";
    const readEnd = pi.handlers.get("tool_execution_end")!;
    readEnd({ toolName: "interrogate", isError: false }, surface);
    await new Promise<void>((r) => setImmediate(r));

    // SURFACE-001 regression pin (FR-28, h2.37 allow-list): reads are PULL,
    // never a surface event — maybeAutoOpen gate (1) classifies every
    // non-upsert call as a read (default peekArgs sees no stash entry), so
    // the panel must NOT pop over the user's prompt box mid-turn: pi's
    // custom() editor snapshot/restore turned every unplanned pop into the
    // empty-box-after-esc data-loss trap. Gate (2) — no unanswered question
    // in this all-answered state — blocks independently.
    expect(surface.customCalls.length).toBe(0); // reads NEVER surface (FR-28)
  });

  test("post-nav agent READ after completion: ghost singleton surfaces nothing (SURFACE-001)", async () => {
    resetState();
    const state = allAnswered();
    // completion clears questions but the singleton REMAINS INSTALLED
    // (clearForCompletion retains goal/epoch/snapshots, completed=true):
    state.clearForCompletion();
    setState(state);
    const surface = new FakeTuiSurface();
    const lifecycle = new FakeLifecycle();
    const host = createPanelHost(lifecycle, surface);
    const pi = {
      on: (_e: string, h: (ev?: unknown, ctx?: unknown) => void) => {
        pi.h = h;
        return () => {};
      },
      h: undefined as ((ev?: unknown, ctx?: unknown) => void) | undefined,
    };
    maybeAutoOpen(pi as never, DEFAULT_CONFIG, host, new DraftStore());
    pi.h!({ toolName: "interrogate", isError: false }, surface);
    await new Promise<void>((r) => setImmediate(r));
    // SURFACE-001 regression pin: the clearForCompletion() ghost singleton
    // (installed, completed=true, zero questions) surfaces NOTHING. Gate (1)
    // classifies the pure read as a read; gate (3) blocks completed state —
    // each gate blocks this independently, both are enforced.
    expect(surface.customCalls.length).toBe(0); // reads NEVER surface (FR-28)
  });
});

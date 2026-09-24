/**
 * src/panel/ac-panel.test.ts — scripted panel-level acceptance criteria
 * (P1.M7.T6.S2; h2.10 ACs, h2.50 same-path rule,
 * plan/001_0d6760db6bc5/AUTOMATION-POLICY.md — BINDING: no live TUI, no real
 * `interrogate` call, no turn ever waits on a user).
 *
 * Every "observe the panel" step is a render(width) + assertion in vitest
 * over the REAL panel/render components with a fake tui/theme/mock pi
 * (panel.test.ts pattern). Interactive-only residuals (real editor focus,
 * real process restart, live /compact, live remap) are NEVER attempted here —
 * they are enumerated for MANUAL-TUI-AC-RUNBOOK.md in
 * plan/001_0d6760db6bc5/P1M7T6S2/research/PANEL-AC-RESULTS.md.
 *
 * [Mode A] PER-AC RESULTS TABLE (full details + defect log:
 * plan/001_0d6760db6bc5/P1M7T6S2/research/PANEL-AC-RESULTS.md)
 *
 * | AC   | verdict | FR proven     | evidence (test)                                        |
 * |------|---------|---------------|--------------------------------------------------------|
 * | AC-1 | PASS    | FR-1 / FR-9   | AC-1_thirty_questions_gate_renders_within_width_budget  |
 * | AC-4 | PASS    | FR-14 / R4    | AC-4_suspend_widget_reopen_drafts_survive_both_sides    |
 * | AC-5 | PASS    | FR-8          | AC-5_deep_view_full_scroll_select_returns_short         |
 * | AC-6 | PASS    | FR-17         | AC-6_contrary_gate_answer_instant_moot_and_slash_O      |
 * | AC-7 | PASS    | FR-18 / Q39=B | AC-7_ripple_confirm_esc_cancels_enter_applies           |
 * | AC-9 | PASS    | FR-28 / SURFACE-002 | AC-9a/b/c_restart_* (no auto-open; widget-only)  |
 * | AC-10| PASS    | FR-29         | AC-10_compact_preserves_plan_statements_and_read_full   |
 * | AC-12| PASS    | R5 / h2.52    | AC-12_remap_updates_footer_and_widget_labels            |
 *
 * State-side ACs (AC-2/3/8/11/13/14) belong to the sibling suite
 * src/ac-scripted.test.ts (P1.M7.T6.S1) — deliberately NOT duplicated here.
 * This suite never edits src/ac-scripted.test.ts, src/config-surface.test.ts,
 * or src/no-hardcoded-keys.test.ts (parallel siblings, additive-only rule).
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  SessionBeforeCompactEvent,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorComponent, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { createCompactionGuard, PRESERVATION_INSTRUCTIONS } from "../compaction.js";
import { DEFAULT_CONFIG, resolveKeyLabels } from "../config.js";
import { DraftStore } from "../draft-store.js";
import { markAnswered } from "../merge.js";
import {
  createStateMirror,
  INTERROGATION_STATE_ENTRY_TYPE,
  type InterrogationStateEntryData,
} from "../persistence.js";
import {
  createReconstruction,
  reconstructFromBranch,
  type ReconstructionContext,
  type ReconstructionOptions,
} from "../reconstruct.js";
import {
  createInterrogationState,
  getState,
  resetState,
  setState,
  type InterrogationState,
  type Question,
} from "../state.js";
import { buildDeepContent, DEEP_VIEW_HEIGHT } from "./deep-view.js";
import { restoreEditorTextIfEmpty, snapshotEditorText } from "./editor-preservation.js";
import { buildSuspendWidgetLine } from "./suspend.js";
import { renderFooter, renderHintLine, renderQuestionLine } from "./layout.js";
import {
  createPanelHost,
  InterrogationPanel,
  openPanel,
  resumeOpenPanel,
  type InterrogationPanelArgs,
  type PanelHost,
  type PiUISurface,
} from "./panel.js";
import { editInExternalEditor } from "../external-editor.js";

/**
 * P1.M4.T1.S3 — the external-editor round-trip is mocked at the module
 * boundary (panel.test.ts convention): no test may ever spawn a real $EDITOR.
 */
vi.mock("../external-editor.js", () => ({
  editInExternalEditor: vi.fn(),
  resolveExternalEditorCommand: vi.fn(() => "stub-editor"),
}));

// ------------------------------------------------------------------ fixtures

const DOWN = "\u001b[B";
const ENTER = "\r";
const ESCAPE = "\u001b";
const CTRL_D = "\u0004"; // DEFAULT_CONFIG.keys.deep
const CTRL_L = "\u000c"; // DEFAULT_CONFIG.keys.overview
const CTRL_T = "\u0014"; // DEFAULT_CONFIG.keys.focusText
const NEXT_Q = "\u001b[Z"; // shift+tab — DEFAULT_CONFIG.keys.nextQuestion

/** Identity theme (panel.test.ts stubTheme): layout renderers run bare. */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

/** Real-ANSI dim theme (panel.test.ts gate convention): dim is observable. */
const ansiTheme = {
  fg: (name: string, s: string) => (name === "dim" ? `\u001b[2m${s}\u001b[0m` : s),
  bold: (s: string) => s,
} as unknown as Theme;

const OPTS_AB = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
];

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

function textQ(id: string, overrides: Partial<Question> = {}): Question {
  return { ...choiceQ(id), type: "text", options: undefined, ...overrides };
}

// h2.10 AC-1 fixture shape (mirrors the P1.M7.T6.S1 contract): 30 questions,
// 4 groups (8/8/8/6), one gate group ("data" via q09), one dependsOn edge
// (q10 dependsOn q09 == alpha) for the AC-6/AC-7 semantics downstream.
const GROUPS = ["scope", "data", "delivery", "process"] as const;
const GOAL = "Ship the 001 pilot";

function fixtureQuestion(i: number): Question {
  const id = `q${String(i).padStart(2, "0")}`;
  const q: Question = {
    id,
    title: `Question ${id}`,
    prompt: `Decide ${id}`,
    description: `Hint for ${id}.`,
    type: "choice",
    group: GROUPS[Math.min(GROUPS.length - 1, Math.floor((i - 1) / 8))],
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
  };
  if (id === "q01") q.recommendation = "alpha";
  if (id === "q09") q.gate = true;
  if (id === "q10") q.dependsOn = [{ id: "q09", equals: "alpha" }];
  return q;
}

function fixtureState(): InterrogationState {
  const state = createInterrogationState(GOAL);
  for (let i = 1; i <= 30; i++) state.upsertQuestion(fixtureQuestion(i));
  return state;
}

// ------------------------------------------------------------------- mock pi

/** One captured ui.custom invocation: component + done + floating promise. */
interface CustomCall {
  component: InterrogationPanel;
  done: (result: null | undefined) => void;
  promise: Promise<null | undefined>;
  resolved: boolean;
  resolution: null | undefined;
}

type Handler = (event: unknown, ctx: unknown) => void;

interface MockPi {
  pi: PiUISurface & Pick<ExtensionAPI, "on">;
  custom: Mock;
  calls: CustomCall[];
  on: Mock<[event: string, handler: Handler], () => void>;
  requestRender: Mock;
  /** The vi.fn backing ui.setWidget — suspend-widget assertions. */
  setWidget: Mock;
  /** Main-editor text behind the getEditorText/setEditorText seams. */
  editorText: { get: () => string; set: (text: string) => void };
  emit(event: string, payload?: Record<string, unknown>): void;
}

/**
 * panel.test.ts's makeMockPi, extended with the two OPTIONAL seams AC-4
 * needs: `setWidget` (h2.3 suspend reminder keyed widget) and the
 * `getEditorText`/`setEditorText` pair (editor-preservation.ts read-back).
 * The custom() mock captures factory + done and returns a promise that never
 * resolves until done() — the exact blocking contract the host must survive.
 */
function makeMockPi(mode: string | undefined = "tui"): MockPi {
  const calls: CustomCall[] = [];
  const handlers = new Map<string, Handler[]>();
  const requestRender = vi.fn();
  const setWidget = vi.fn();
  let editorText = "";

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
      const done = (result: null | undefined): void => resolve(result);
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

  const on = vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {
      const current = handlers.get(event);
      if (current === undefined) return;
      const i = current.indexOf(handler);
      if (i !== -1) current.splice(i, 1);
    };
  });

  const surface = {
    mode,
    ui: {
      custom,
      setWidget,
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
    },
    on,
  };
  const pi = surface as unknown as PiUISurface & Pick<ExtensionAPI, "on">;
  const ctx = surface as unknown;

  return {
    pi,
    custom,
    calls,
    on,
    requestRender,
    setWidget,
    editorText: {
      get: () => editorText,
      set: (text: string) => {
        editorText = text;
      },
    },
    emit(event: string, payload: Record<string, unknown> = {}): void {
      for (const handler of [...(handlers.get(event) ?? [])]) {
        handler({ type: event, ...payload }, ctx);
      }
    },
  };
}

function makeMockLifecycle(): {
  lifecycle: { onPanelDismiss: (cb: () => void) => void; dismissPanel: () => void };
  dismiss: () => void;
} {
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

// ------------------------------------------------------------------ helpers

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Stateful fake composed editor (panel.test.ts structural contract). */
null

/** Stateful fake composed editor (panel.test.ts structural contract). */
function fakePanelEditor(): EditorComponent & { setText: Mock } {
  let text = "";
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["e1", "e2", "e3"]),
    focused: false,
  } as unknown as EditorComponent & { setText: Mock };
}

/** Direct-construction args (panel.test.ts panelArgsFor convention). */
function panelArgsFor(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
): InterrogationPanelArgs {
  return {
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    editorFactory: () => fakePanelEditor(),
    ...extra,
  };
}

beforeEach(() => {
  // Module singletons: the state singleton AND panel.ts's host record.
  resetState();
  createPanelHost(makeMockLifecycle().lifecycle); // re-arm the host record
});

// --------------------------------------------------------------------- AC-1

describe("AC-1 — render proof at panel level (FR-1/FR-9)", () => {
  test("AC-1_thirty_questions_gate_renders_within_width_budget", () => {
    const mock = makeMockPi();
    const state = fixtureState();
    expect(openPanel(mock.pi, { config: DEFAULT_CONFIG, state })).toBe(true);
    const panel = mock.calls[0]!.component;

    // FR-1: the panel opens focused on the gate group's first answerable
    // question — q09 carries gate:true inside the "data" group.
    expect(panel.currentId).toBe("q09");
    expect(state.getQuestion("q09")?.gate).toBe(true);

    // Width budget sweep (AUTOMATION-POLICY scripted equivalent of "observe
    // the panel"): at 40/60/80/120 cols EVERY rendered line fits the width,
    // the header leads and the footer terminates.
    for (const width of [40, 60, 80, 120]) {
      panel.invalidate();
      const lines = panel.render(width);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      expect(lines[0]).toMatch(/^┌ interrogation ·?/);
      expect(lines[lines.length - 1]).toMatch(/^└ /);
      expect(lines.join("\n")).toContain("Question q09"); // gate question line
      expect(lines.join("\n")).toContain("answered"); // progress footer
    }

    // FR-9 "all groups visible": the overview lists every group's header.
    panel.handleInput(CTRL_L);
    const topWindow = panel.render(120).join("\n");
    expect(topWindow).toContain("\n  scope");
    expect(topWindow).toContain("\n  data ▲"); // ▲ gate mark rides the group
    expect(topWindow).toContain("\n  delivery");
    for (let i = 0; i < 25; i++) panel.handleInput(DOWN); // cursor → q30
    const bottomWindow = panel.render(120).join("\n");
    expect(bottomWindow).toContain("\n  process");

    // FR-16: esc descends overview → short, destroying nothing — the current
    // question is still the gate question.
    panel.handleInput(ESCAPE);
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q09");

    // Soft-gate dimming (h2.29): a non-gate CURRENT question renders the
    // dim-wrapped lines — display only, still fully answerable (R1) — while
    // a gate-focused panel renders its gate question UNdimmed (identical to
    // the explicit dim=false renderer call).
    const ordered = state.orderedQuestions();
    const dimPanel = new InterrogationPanel(
      panelArgsFor(state, { theme: ansiTheme, focusQuestionId: "q30" }),
    );
    expect(dimPanel.currentId).toBe("q30"); // process group — NOT the gate group
    const idx = ordered.findIndex((q) => q.id === "q30");
    const dimLines = dimPanel.render(80);
    expect(dimLines[1]).toBe(renderQuestionLine(ordered[idx]!, idx + 1, ansiTheme, 80, true));
    expect(dimLines[2]).toBe(renderHintLine(ordered[idx]!, ansiTheme, 80, true)[0]);
    expect(dimLines.join("\n")).toContain("\u001b[2m"); // dim wrap observable
    dimPanel.handleInput(ENTER); // dimmed is display-only: the answer applies
    expect(state.getQuestion("q30")?.status).toBe("answered");

    const fresh = fixtureState();
    const gatePanel = new InterrogationPanel(panelArgsFor(fresh, { theme: ansiTheme }));
    expect(gatePanel.currentId).toBe("q09");
    const gateLines = gatePanel.render(80);
    const gateIdx = fresh.orderedQuestions().findIndex((q) => q.id === "q09");
    expect(gateLines[1]).toBe(
      renderQuestionLine(fresh.orderedQuestions()[gateIdx]!, gateIdx + 1, ansiTheme, 80, false),
    );
    expect(gateLines[2]).toBe(renderHintLine(fresh.orderedQuestions()[gateIdx]!, ansiTheme, 80, false)[0]);
  });
});

// -------------------------------------------------------------------- AC-12

describe("AC-12 — remapped hotkeys relabel every surface (R5/h2.52)", () => {
  test("AC-12_remap_updates_footer_labels_widget_names_command_only", () => {
    // Deep-merge style clone: remap deep (deepViewToggle) + discuss.
    const config = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, deep: "ctrl+shift+d", discuss: "ctrl+q" },
    };
    const labels = resolveKeyLabels(config);
    expect(labels.deep).toBe("Ctrl+Shift+D");
    expect(labels.discuss).toBe("Ctrl+Q");

    const state = fixtureState();
    const snapshot = state.serialize();

    // Pure renderer level: the short footer carries the NEW deep label and
    // never the stale default.
    const shortFooter = renderFooter(snapshot, "short", labels, stubTheme, 120);
    expect(shortFooter).toContain("Ctrl+Shift+D deep");
    expect(shortFooter).not.toContain("Ctrl+D deep");
    // Overview footer: same rule on the second surface deep appears on.
    const overviewFooter = renderFooter(snapshot, "overview", labels, stubTheme, 120);
    expect(overviewFooter).toContain("Ctrl+Shift+D deep");

    // Panel level: the live render (labels memoized from config at
    // construction) reflects the remap in every view's footer.
    const panel = new InterrogationPanel(panelArgsFor(state, { config }));
    panel.invalidate();
    expect(panel.render(120).at(-1)).toContain("Ctrl+Shift+D deep");
    panel.handleInput(CTRL_L); // overview view (binding unchanged — ctrl+l)
    expect(panel.render(120).at(-1)).toContain("Ctrl+Shift+D deep");

    // Widget level (breakOut removal): the suspend reminder takes NO labels —
    // it names /interrogate only; no key chord may ever appear in it.
    const line = buildSuspendWidgetLine(state);
    expect(line).toBe("30 open · 0 answered — /interrogate to resume");
    expect(line).not.toMatch(/ctrl|alt\+|super\+|shift\+/i);
  });
});

// --------------------------------------------------------------------- AC-6

describe("AC-6 — instant moot + ⊘ on contrary gate answer (FR-17)", () => {
  test("AC-6_contrary_gate_answer_instant_moot_and_slash_O", () => {
    const state = fixtureState();
    // q10 dependsOn q09 == alpha; answering the gate question "beta" is the
    // contrary answer. Driven through the REAL panel accept path — the same
    // enter keypress a user would press.
    const panel = new InterrogationPanel(panelArgsFor(state));
    expect(panel.currentId).toBe("q09"); // gate focused (FR-1)
    expect(state.getQuestion("q10")?.status).toBe("open");

    const before = JSON.stringify(state.serialize());
    expect(panel.cursorIndex).toBe(0); // alpha preselected (no recommendation)
    panel.handleInput(DOWN); // → beta (the contrary option)
    expect(panel.cursorIndex).toBe(1);
    panel.handleInput(ENTER); // accept beta

    // "Instantly" = synchronous dependsOn re-evaluation INSIDE the accept
    // commit (acceptOptionIndex → evaluateDependsOn): no awaited events, no
    // agent round-trip — the dependent's UI state is moot in the same tick.
    expect(state.getQuestion("q09")?.answer?.value).toBe("beta");
    expect(state.getQuestion("q10")?.status).toBe("moot");
    expect(JSON.stringify(state.serialize())).not.toBe(before);
    // The audit trail is contractual: q10 stays in the map (never removed).
    expect(state.getQuestion("q10")).toBeDefined();

    // Overview renders the ⊘ marker for the mootered question, with a
    // reason on the row (h2.29 format `⊘ {title} — {reason}`).
    panel.handleInput(CTRL_L);
    const rendered = panel.render(120).join("\n");
    expect(rendered).toMatch(/⊘ Question q10 — /); // marker + reason present

    // Short form greys the moot question too: the moot reason line renders
    // ahead of the (dimmed) options.
    panel.handleInput(ESCAPE);
    panel.currentId = "q10";
    panel.invalidate();
    const short = panel.render(120).join("\n");
    expect(short).toContain("⊘ moot —");
    expect(short).toContain("dependency changed"); // default reason body
  });
});

// --------------------------------------------------------------------- AC-7

describe("AC-7 — ripple confirm: esc cancels, enter applies (FR-18/Q39=B)", () => {
  /** 3-level transitive chain: r1 ← r2 ← r3 ← r4 (all answered). */
  function rippleState(): InterrogationState {
    const state = createInterrogationState("ripple goal");
    state.upsertQuestion(choiceQ("r1", { group: "g" }));
    state.upsertQuestion(
      choiceQ("r2", { group: "g", dependsOn: [{ id: "r1", equals: "alpha" }] }),
    );
    state.upsertQuestion(
      choiceQ("r3", { group: "g", dependsOn: [{ id: "r2", equals: "alpha" }] }),
    );
    state.upsertQuestion(choiceQ("r4", { group: "g", dependsOn: [{ id: "r3" }] }));
    for (const id of ["r1", "r2", "r3", "r4"]) {
      state.applyAnswer(id, { value: "alpha", at: "t0" });
    }
    return state;
  }

  test("AC-7_ripple_confirm_esc_cancels_enter_applies", () => {
    const state = rippleState();
    const panel = new InterrogationPanel(panelArgsFor(state, { focusQuestionId: "r1" }));
    expect(panel.currentId).toBe("r1");

    // Edit the answered root: switching the cursor to beta + enter MUST veto
    // into the modal confirm (3 answered victims in BFS order).
    const snapshotBefore = JSON.stringify(state.serialize());
    panel.cursorIndex = 1; // alpha → beta
    panel.handleInput(ENTER);
    expect(panel.confirmMode).not.toBeNull();
    expect(panel.confirmMode?.victims).toEqual(["r2", "r3", "r4"]);
    expect(panel.confirmMode?.kind).toBe("choice");

    // The footer is REPLACED by the confirm footer naming all 3 victims.
    panel.invalidate();
    const confirmFooter = panel.render(120).at(-1)!;
    expect(confirmFooter).toContain("⚠ Invalidates 3 answered questions (r2, r3, r4)");
    expect(confirmFooter).toContain("enter=keep, esc=cancel");

    // MODAL: while the confirm is pending every other key is a consumed
    // no-op — nothing moves, nothing applies.
    expect(panel.handleInput("x")).toBe(true);
    expect(panel.confirmMode).not.toBeNull();
    expect(JSON.stringify(state.serialize())).toBe(snapshotBefore);

    // ESC = cancel: the GUARANTEED zero-state-change path — byte-identical
    // state, no epoch bump, user stays on the same question.
    panel.handleInput(ESCAPE);
    expect(panel.confirmMode).toBeNull();
    expect(JSON.stringify(state.serialize())).toBe(snapshotBefore);
    expect(state.epoch).toBe(1);
    expect(panel.currentId).toBe("r1");
    expect(panel.cursorIndex).toBe(0); // restored to the recorded answer

    // Re-enter the same edit → confirm again → ENTER = keep: the edit is
    // applied EXACTLY ONCE (the deferred commit never re-invokes the seam).
    panel.cursorIndex = 1;
    panel.handleInput(ENTER);
    expect(panel.confirmMode?.victims).toEqual(["r2", "r3", "r4"]);
    panel.handleInput(ENTER);
    expect(panel.confirmMode).toBeNull();

    // Applied per FR-18/Q39=B + FR-17: the edit lands; the DIRECTLY unmet
    // dependent flips moot instantly (answers KEPT — audit trail, FR-19);
    // transitives whose conditions still hold against the kept answers are
    // untouched (dependsOn is instant-local, never a cascade).
    expect(state.getQuestion("r1")?.answer?.value).toBe("beta");
    expect(state.getQuestion("r1")?.status).toBe("answered");
    expect(state.getQuestion("r2")?.status).toBe("moot"); // equals alpha unmet
    expect(state.getQuestion("r2")?.answer?.value).toBe("alpha"); // kept
    expect(state.getQuestion("r3")?.status).toBe("answered"); // r2 kept alpha
    expect(state.getQuestion("r4")?.status).toBe("answered");
    expect(state.epoch).toBe(1); // panel edits never bump the epoch
  });
});

// --------------------------------------------------------------------- AC-5

describe("AC-5 — deep view: full scroll + select-from-deep (FR-8)", () => {
  /** Choice question whose ramifications push the pane past one viewport. */
  function deepQ(id: string, overrides: Partial<Question> = {}): Question {
    return {
      id,
      prompt: `prompt:${id}`,
      title: `Deep ${id}`,
      description: "Context you should read before choosing.",
      type: "choice",
      rev: 1,
      status: "open",
      options: [0, 1, 2, 3, 4, 5].map((n) => ({
        value: `opt${n}`,
        label: `opt ${n}`,
        ramification:
          `Consequence ${n}: ` +
          "this consequence text is deliberately long so that it wraps into " +
          "several rendered lines and pushes the deep pane well past the " +
          "twenty-line viewport, forcing real scrolling. ",
      })),
      ...overrides,
    };
  }

  test("AC-5_deep_view_full_scroll_select_returns_short", () => {
    const state = createInterrogationState("deep goal");
    state.upsertQuestion(deepQ("d1"));
    state.upsertQuestion(deepQ("d2"));
    const panel = new InterrogationPanel(panelArgsFor(state, { focusQuestionId: "d1" }));

    // Toggle into the deep view (ctrl+d binding) and measure the content.
    panel.handleInput(CTRL_D);
    expect(panel.view).toBe("deep");
    expect(panel.scrollOffset).toBe(0);
    const q = state.getQuestion("d1")!;
    const content = buildDeepContent({
      question: q,
      goal: state.goal,
      cursorIndex: panel.cursorIndex,
      scrollOffset: 0,
      theme: stubTheme,
      width: 80,
      maxChars: DEFAULT_CONFIG.caps.ramification,
    });
    expect(content.lines.length).toBeGreaterThan(DEEP_VIEW_HEIGHT); // scrolls
    const maxOffset = content.lines.length - DEEP_VIEW_HEIGHT;

    // Drive the SELECTION across every option — at each step the window
    // stays bounded (h2.51: header + pane ≤ 20 + footer) and the selected
    // option's sticky header is visible.
    for (let i = 1; i < q.options!.length; i++) {
      panel.handleInput(DOWN);
      expect(panel.cursorIndex).toBe(i);
      const lines = panel.render(80);
      expect(lines.length).toBeLessThanOrEqual(1 + DEEP_VIEW_HEIGHT + 1);
      const body = lines.slice(1, lines.length - 1);
      expect(body.some((l) => l.includes(`opt ${i}`))).toBe(true); // sticky
    }
    expect(panel.scrollOffset).toBeGreaterThan(0); // the clamp really moved

    // Drive the scroll offset across the FULL range [0..maxOffset]: every
    // window stays in budget, and at the top of the range the LAST
    // ramification lines are reachable (nothing is clipped away).
    for (let k = 0; k <= maxOffset; k++) {
      panel.scrollOffset = k;
      panel.invalidate();
      const body = panel.render(80).slice(1, -1);
      expect(body.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
      for (const line of body) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
    panel.scrollOffset = maxOffset;
    panel.invalidate();
    const atBottom = panel.render(80);
    const lastContentLine = content.lines[content.lines.length - 1]!;
    expect(atBottom.slice(1, -1)).toContain(lastContentLine);

    // Select the highlighted (last) option FROM the deep view: enter applies
    // with the short-form commit semantics, returns to the short form,
    // resets the scroll, and advances to the next unanswered question.
    panel.handleInput(ENTER);
    expect(panel.view).toBe("short");
    expect(panel.scrollOffset).toBe(0);
    expect(panel.deepSticky).toBe(true); // toggle stays sticky (FR-8)
    expect(state.getQuestion("d1")?.status).toBe("answered");
    expect(state.getQuestion("d1")?.answer?.value).toBe("opt5");
    expect(panel.currentId).toBe("d2");
  });
});

// --------------------------------------------------------------------- AC-4

describe("AC-4 — suspend → widget → reopen: drafts survive (FR-14/R4)", () => {
  test("AC-4_suspend_widget_reopen_drafts_survive_both_sides", async () => {
    const mock = makeMockPi();
    const store = new DraftStore();
    const state = createInterrogationState("suspend goal");
    state.upsertQuestion(textQ("t1", { prompt: "Elaborate t1" }));
    state.upsertQuestion(choiceQ("c1", { group: "later" }));
    // Main-editor draft present BEFORE the panel opens (h2.35 native
    // preservation seam — editor-preservation.ts).
    mock.editorText.set("main editor draft in progress");

    expect(openPanel(mock.pi, { config: DEFAULT_CONFIG, state, drafts: store })).toBe(true);
    const panel = mock.calls[0]!.component;
    expect(panel.currentId).toBe("t1");

    // Panel-side draft: focus the text field (ctrl+t), type, ctrl+t again —
    // the toggle-exit write-through (R4). WRITEIN-001 duty-follows-entry
    // (P1.M2.T3.S1): ctrl+t on a text question opens WRITE-IN duty, whose
    // enter would COMMIT the answer (custom:true) — a DRAFT is saved by
    // exiting (re-press), never by enter.
    panel.handleInput(CTRL_T);
    expect(panel.focus).toBe("text");
    (panel.textField.editor as unknown as { setText: Mock }).setText("draft alpha text");
    panel.handleInput(CTRL_T); // toggle-exit: draft write-through + blur
    expect(panel.focus).toBe("options");
    expect(store.getDraft("t1")).toBe("draft alpha text");
    const storeBefore = JSON.stringify({ t1: store.getDraft("t1"), note: store.getNote() });

    // Answer the choice question: enter accepts alpha; the advance lands on
    // t1 (still open) — the pre-suspend focus.
    panel.handleInput(NEXT_Q); // → c1
    expect(panel.currentId).toBe("c1");
    panel.handleInput(ENTER);
    expect(state.getQuestion("c1")?.status).toBe("answered");
    expect(panel.currentId).toBe("t1");

    // SUSPEND via done(null) — exactly the h2.3/h2.35 break-out contract.
    mock.calls[0]!.done(null);
    await flush();
    expect(mock.calls[0]!.resolved).toBe(true);
    expect(mock.calls[0]!.resolution).toBeNull();

    // The keyed widget appears with counts + the /interrogate resume cue
    // (h2.3, breakOut removal): `1 open · 1 answered — /interrogate to resume`.
    const widgetCall = mock.setWidget.mock.calls.at(-1);
    expect(widgetCall?.[0]).toBe("interrogator");
    const widgetLine = (widgetCall?.[1] as string[] | undefined)?.[0] ?? "";
    expect(widgetLine).toContain("1 open · 1 answered");
    expect(widgetLine).toMatch(/— \/interrogate to resume$/);

    // Main-editor side (scripted native-preservation equivalent): the
    // read-back seam still returns the pre-panel text — pi's editor instance
    // persists across custom() sessions (editor-preservation.ts finding).
    expect(snapshotEditorText(mock.pi)).toBe("main editor draft in progress");

    // REOPEN via the resume path: a FRESH panel rehydrated from the SAME
    // state + DraftStore, focused on the pre-suspend question.
    expect(resumeOpenPanel(mock.pi)).toBe(true);
    expect(mock.calls.length).toBe(2);
    const reopened = mock.calls[1]!.component;
    expect(reopened).not.toBe(panel);
    expect(reopened.currentId).toBe("t1"); // focus memory restored

    // Drafts intact BOTH sides: the store slots are byte-identical…
    expect(store.getDraft("t1")).toBe("draft alpha text");
    expect(JSON.stringify({ t1: store.getDraft("t1"), note: store.getNote() })).toBe(storeBefore);
    // …and the refocus seeds the saved draft over a stale buffer (h2.31).
    reopened.handleInput(CTRL_T);
    expect(reopened.focus).toBe("text");
    expect(reopened.textField.getText()).toBe("draft alpha text");

    // Preservation seam guard: a restore NEVER clobbers non-empty editor
    // text; into an EMPTY editor it writes the snapshot back.
    const snap = snapshotEditorText(mock.pi);
    expect(restoreEditorTextIfEmpty(mock.pi, snap)).toBe(false); // non-empty
    mock.editorText.set("");
    expect(restoreEditorTextIfEmpty(mock.pi, snap)).toBe(true);
    expect(mock.editorText.get()).toBe("main editor draft in progress");
  });
});

// --------------------------------------------------------------------- AC-9

// SURFACE-002 rewrite (FR-28 as amended by h2.44 step 4): a restart
// (session_start) NEVER auto-opens the panel. The scripted restart proves
// the new contract per leg: silent install + keyed suspend-widget line
// (h2.37), drafts gone (FR-28 documented limitation), pending answers still
// "answered" (AUTOSUBMIT-001 — they ship on the next commit), and the
// /interrogate reopen restoring questions/answers on a fresh panel.
describe("AC-9 — restart mid-interrogation: silent install + widget-only (FR-28, SURFACE-002)", () => {
  // Reconstruct-test entry shapes (verified against pi's session-manager).
  /** Message entry carrying an interrogate tool result with details.state. */
  function toolResultEntry(state: unknown): SessionEntry {
    return {
      type: "message",
      id: `t${Math.random()}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "interrogate",
        content: [{ type: "text", text: "ok" }],
        details: { state },
        isError: false,
        timestamp: Date.now(),
      },
    } as unknown as SessionEntry;
  }

  function userEntry(): SessionEntry {
    return {
      type: "message",
      id: `u${Math.random()}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
    } as unknown as SessionEntry;
  }

  /** S1 mirror entry (pi.appendEntry shape: custom + data). */
  function mirrorEntry(data: InterrogationStateEntryData): SessionEntry {
    return {
      type: "custom",
      id: `m${Math.random()}`,
      parentId: null,
      timestamp: data.at,
      customType: INTERROGATION_STATE_ENTRY_TYPE,
      data,
    } as unknown as SessionEntry;
  }

  /** Submission delta (pi.sendMessage shape: custom_message + details). */
  function submissionEntry(details: {
    changed: Array<{ id: string; title: string; from: string; to: string; editedArchived: boolean }>;
    epoch: number;
  }): SessionEntry {
    return {
      type: "custom_message",
      id: `s${Math.random()}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: "interrogation-submission",
      content: "Submitted 1",
      display: true,
      details: { ...details, card: { ...details, remainOpen: 0 } },
    } as unknown as SessionEntry;
  }

  function diff(
    id: string,
    to: string,
  ): { id: string; title: string; from: string; to: string; editedArchived: boolean } {
    return { id, title: id, from: "(unanswered)", to, editedArchived: false };
  }

  /** Never-resolving custom(): the opened panel floats, non-blocking. */
  function makeCtx(
    entries: SessionEntry[],
  ): ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } } {
    const custom = vi.fn(() => new Promise<null>(() => {}));
    // SURFACE-002: the reconstruction's only UI act is the keyed suspend
    // widget — updateSuspendWidget no-ops without ui.setWidget, so the AC-9
    // flips need it present to assert the widget non-vacuously.
    const setWidget = vi.fn();
    return {
      mode: "tui",
      hasUI: true,
      sessionManager: { getBranch: () => entries },
      ui: { custom, setWidget },
    } as unknown as ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } };
  }

  function makeHost(): PanelHost {
    return createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} });
  }

  function seededBase(build: (s: InterrogationState) => void): ReturnType<InterrogationState["serialize"]> {
    const s = fixtureState();
    build(s);
    return s.serialize();
  }

  test("AC-9a_restart_tool_result_base_plus_deltas_no_panel_widget_only", () => {
    const base = seededBase((s) => {
      markAnswered(s, "q01", { value: "alpha", at: "t0" });
    });
    const ctx = makeCtx([
      userEntry(),
      toolResultEntry(base),
      submissionEntry({ changed: [diff("q02", "beta")], epoch: 1 }),
    ]);
    const host = makeHost();
    const drafts = new DraftStore(); // FR-28: drafts are NEVER restored
    const result = reconstructFromBranch(ctx, {
      config: DEFAULT_CONFIG,
      host,
      drafts,
    } satisfies ReconstructionOptions);

    // SURFACE-002 (FR-28 rewritten, h2.44 step 4): a restart NEVER opens
    // the panel — the keyed suspend widget line is the ONLY cue (h2.37).
    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(1);
    expect(result.opened).toBe(false);
    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(false);

    // Widget live counts: q01+q02 answered, q10 moot (dependsOn q09==alpha
    // unmet — reconstruction's moot-recompute) → 27 open · 2 answered.
    const widgetCall = (ctx.ui.setWidget as Mock).mock.calls.at(-1);
    expect(widgetCall?.[0]).toBe("interrogator");
    expect((widgetCall?.[1] as string[] | undefined)?.[0]).toBe(
      "27 open · 2 answered — /interrogate to resume",
    );

    // Questions/answers counts restored; drafts gone (documented, FR-28).
    const state = getState()!;
    expect(state.orderedQuestions()).toHaveLength(30);
    expect(state.getQuestion("q01")?.answer?.value).toBe("alpha");
    expect(state.getQuestion("q02")?.answer?.value).toBe("beta"); // replayed
    expect(state.epoch).toBe(base.epoch + 1); // h3.6: one bump per submission
    for (const q of state.orderedQuestions()) {
      expect(drafts.getDraft(q.id)).toBeUndefined();
    }

    // AUTOSUBMIT-001 (P2.M1.T1.S1): q01 stays in the "answered" PENDING
    // state across the restart — it ships on the NEXT commit's
    // maybeAutoSubmit tail (or any ctrl+s). The firing itself is AC-2c's
    // proof; deliberately not duplicated here.
    expect(state.getQuestion("q01")?.status).toBe("answered");

    // REOPEN (/interrogate — the deliberate path; command.ts's
    // closed-host-with-live-state branch reads the STATE SINGLETON, because
    // resumeOpenPanel can't serve a restart: lastOpts is only set by
    // openPanel and reconstruction no longer opens). makeMockPi's
    // factory-invoking custom (AC-4 pattern) mounts the fresh panel.
    const reopenPi = makeMockPi();
    expect(openPanel(reopenPi.pi, { config: DEFAULT_CONFIG, state, drafts })).toBe(true);
    expect(reopenPi.custom).toHaveBeenCalledTimes(1);
    // Fresh panel, state visible: focus follows the GATE-AWARE ladder
    // (gate.ts) → q09, the unanswered gate-group question (not plain order);
    // the component's state readback proves it mounted on the RESTORED
    // state — q01/q02 answers present, moot q10 never focusable.
    expect(reopenPi.calls[0]?.component.currentId).toBe("q09");
    const reopenedState = reopenPi.calls[0]!.component.state;
    expect(reopenedState.getQuestion("q01")?.answer?.value).toBe("alpha");
    expect(reopenedState.getQuestion("q02")?.answer?.value).toBe("beta");
    expect(reopenedState.orderedQuestions()).toHaveLength(30);
  });

  test("AC-9b_restart_mirror_entry_no_panel_widget_only", () => {
    const mirrored = seededBase((s) => {
      markAnswered(s, "q05", { value: "beta", at: "t-mirror" });
    });
    const ctx = makeCtx([
      mirrorEntry({ state: mirrored, epoch: mirrored.epoch, at: "2025-06-01T12:00:00.000Z" }),
    ]);
    const host = makeHost();
    const result = reconstructFromBranch(ctx, { config: DEFAULT_CONFIG, host });

    // SURFACE-002: the mirror-entry restart is silent too — no panel, the
    // widget line is the cue (q05 answered + q10 moot → 28 open · 1 answered).
    expect(result.source).toBe("mirror-entry");
    expect(result.replayed).toBe(0);
    expect(result.opened).toBe(false);
    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(false);
    const widgetCall = (ctx.ui.setWidget as Mock).mock.calls.at(-1);
    expect(widgetCall?.[0]).toBe("interrogator");
    expect((widgetCall?.[1] as string[] | undefined)?.[0]).toBe(
      "28 open · 1 answered — /interrogate to resume",
    );
    expect(getState()?.getQuestion("q05")?.answer?.value).toBe("beta");
    expect(getState()?.orderedQuestions()).toHaveLength(30);

    // REOPEN (/interrogate): the panel comes back with the restored state —
    // focus follows the GATE-AWARE ladder (gate.ts) → q09 (unanswered gate
    // question); the component readback proves q05's answer rode along
    // (FR-28/SURFACE-002).
    const reopenPi = makeMockPi();
    expect(openPanel(reopenPi.pi, { config: DEFAULT_CONFIG, state: getState()! })).toBe(true);
    expect(reopenPi.custom).toHaveBeenCalledTimes(1);
    expect(reopenPi.calls[0]?.component.currentId).toBe("q09");
    expect(reopenPi.calls[0]!.component.state.getQuestion("q05")?.answer?.value).toBe("beta");
  });

  test("AC-9c_restart_session_start_event_fires_reconstruction_silently", () => {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
        return () => {};
      }),
    } as unknown as Pick<ExtensionAPI, "on">;
    const ctx = makeCtx([toolResultEntry(seededBase(() => {}))]);
    const host = makeHost();
    createReconstruction(pi, { config: DEFAULT_CONFIG, host });

    // The subscription exists on BOTH branch-truth events…
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("session_tree")).toBe(true);
    // …and firing session_start runs the SAME reconstruction — silently
    // (SURFACE-002): state installs, the widget appears, the panel NEVER
    // pops. q10 moots (unmet dependsOn) → `29 open · 0 answered — …`.
    (handlers.get("session_start") as (event: unknown, ctx: unknown) => void)(
      { type: "session_start", reason: "resume" },
      ctx,
    );
    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(host.isOpen()).toBe(false);
    expect(getState()?.orderedQuestions()).toHaveLength(30);
    const widgetCall = (ctx.ui.setWidget as Mock).mock.calls.at(-1);
    expect(widgetCall?.[0]).toBe("interrogator");
    expect((widgetCall?.[1] as string[] | undefined)?.[0]).toBe(
      "29 open · 0 answered — /interrogate to resume",
    );

    // REOPEN via the /interrogate invoke path (deliberate;
    // closed-host-with-live-state): one custom() call, panel live with the
    // restored questions — focus follows the GATE-AWARE ladder (gate.ts) →
    // q09 (unanswered gate question); the component readback proves the
    // restored 30-question set.
    const reopenPi = makeMockPi();
    expect(openPanel(reopenPi.pi, { config: DEFAULT_CONFIG, state: getState()! })).toBe(true);
    expect(reopenPi.custom).toHaveBeenCalledTimes(1);
    expect(reopenPi.calls[0]?.component.currentId).toBe("q09");
    expect(reopenPi.calls[0]!.component.state.orderedQuestions()).toHaveLength(30);
  });
});

// -------------------------------------------------------------------- AC-10

describe("AC-10 — compact preservation + read-after-compact (FR-29)", () => {
  const USAGE = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
  const MODEL = { id: "test-model", provider: "test-provider" };

  function userMsg(text: string, timestamp = 1) {
    return { role: "user" as const, content: [{ type: "text" as const, text }], timestamp };
  }

  /** Model response whose summary ECHOES the plan (an obedient summarizer). */
  function summaryEchoing(text: string) {
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      api: "openai-completions",
      provider: "test-provider",
      model: "test-model",
      usage: USAGE,
      stopReason: "stop" as const,
    };
  }

  function makeEvent(messages: unknown[]): SessionBeforeCompactEvent {
    return {
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "kept-entry-1",
        messagesToSummarize: messages,
        turnPrefixMessages: [],
        isSplitTurn: false,
        tokensBefore: 42424,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
        settings: { enabled: true, reserveTokens: 20000, keepRecentTokens: 20000 },
      },
      branchEntries: [],
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
    } as unknown as SessionBeforeCompactEvent;
  }

  test("AC-10_compact_preserves_plan_statements_and_read_is_full", async () => {
    // Active interrogation with answers, installed as the singleton.
    const state = fixtureState();
    markAnswered(state, "q01", { value: "alpha", at: "t0" });
    setState(state);

    // REAL state mirror: every flush lands as a captured appendEntry —
    // exactly what pi would append as an `interrogation-state` entry.
    const appended: InterrogationStateEntryData[] = [];
    const mirrorPi = {
      appendEntry: vi.fn((customType: string, data: InterrogationStateEntryData) => {
        appended.push(data);
        void customType;
      }),
      on: vi.fn(),
    } as unknown as Pick<ExtensionAPI, "appendEntry" | "on">;
    const mirror = createStateMirror(mirrorPi, { getState: () => state });
    state.applyAnswer("q02", { value: "beta", at: "t1" }); // pending window

    // Compaction guard wired like index.ts (same config + mirror).
    const PLAN = "PLAN: ship Friday; storage must be SQLite; never break the public API.";
    const complete = vi.fn(async () =>
      summaryEchoing(`Summary. User plan preserved verbatim: ${PLAN}`),
    );
    const guardHandlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const guardPi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        guardHandlers.set(event, handler);
        return () => {};
      }),
    } as unknown as Pick<ExtensionAPI, "on">;
    createCompactionGuard(guardPi, { config: DEFAULT_CONFIG, mirror, getState: () => state });

    const ctx = {
      mode: "tui",
      model: MODEL,
      modelRegistry: {
        getAvailable: () => [MODEL],
        complete,
      },
    } as unknown as ExtensionContext;

    const result = (await guardHandlers.get("session_before_compact")!(
      makeEvent([userMsg(PLAN), userMsg("also: keep the CLI flags stable")]),
      ctx,
    )) as { compaction?: { summary?: string } } | undefined;

    // The handler RAN the summarization itself (pi 0.85.1 has no
    // instructions-return field) and handed the summary to pi.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result?.compaction?.summary).toContain(PLAN); // plan statements SURVIVE

    // Handler OUTPUT (the summarizer prompt): preservation instructions
    // FIRST (h2.42 verbatim prepend), then the conversation carrying the
    // user plan statements the summary must preserve.
    const promptContext = complete.mock.calls[0] as unknown as [
      unknown,
      { messages: Array<{ content: Array<{ text: string }> }> },
    ];
    const prompt = promptContext[1].messages[0]!.content[0]!.text;
    expect(prompt.startsWith(PRESERVATION_INSTRUCTIONS)).toBe(true);
    expect(prompt).toContain(PLAN);
    expect(prompt).toContain("<conversation>");

    // The flush landed BEFORE the summary was returned (a fresh
    // interrogation-state entry exists even if everything below failed).
    expect(appended.length).toBeGreaterThanOrEqual(1);
    const flushed = appended[appended.length - 1]!;
    expect(flushed.state.epoch).toBe(state.epoch);
    expect(Object.keys(flushed.state.questions)).toHaveLength(30);
    expect(flushed.state.questions["q02"]?.answer?.value).toBe("beta");

    // READ-AFTER-COMPACT consistency: the flushed entry, walked back through
    // the REAL reconstruction (the interrogate({}) read path), returns the
    // FULL state — nothing depends on what the summary keeps.
    const branch = [
      {
        type: "custom",
        id: "m-compact",
        parentId: null,
        timestamp: flushed.at,
        customType: INTERROGATION_STATE_ENTRY_TYPE,
        data: flushed,
      },
    ] as unknown as SessionEntry[];
    const readCtx = {
      mode: "tui",
      hasUI: true,
      sessionManager: { getBranch: () => branch },
      ui: {
        custom: vi.fn(() => new Promise<null>(() => {})),
        setWidget: vi.fn(), // SURFACE-002 cue surface — asserted below
      },
    } as unknown as ReconstructionContext;
    const host = createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} });
    const read = reconstructFromBranch(readCtx, { config: DEFAULT_CONFIG, host });

    expect(read.source).toBe("mirror-entry");
    // SURFACE-002: reads/reconstruction NEVER surface — no panel after the
    // compact either; the widget line is the only cue (q01+q02 answered,
    // q10 moot → `27 open · 2 answered — /interrogate to resume`).
    expect(read.opened).toBe(false);
    expect((readCtx.ui.custom as Mock)).not.toHaveBeenCalled();
    const readWidget = (readCtx.ui.setWidget as Mock).mock.calls.at(-1);
    expect(readWidget?.[0]).toBe("interrogator");
    expect((readWidget?.[1] as string[] | undefined)?.[0]).toBe(
      "27 open · 2 answered — /interrogate to resume",
    );
    const restored = getState()!;
    expect(restored.orderedQuestions()).toHaveLength(30);
    expect(restored.getQuestion("q01")?.answer?.value).toBe("alpha");
    expect(restored.getQuestion("q02")?.answer?.value).toBe("beta");
    expect(restored.epoch).toBe(state.epoch);
  });
});

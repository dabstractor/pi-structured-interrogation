/**
 * src/panel/suspend.test.ts — suspend/resume + widget tests (P1.M6.T1.S1).
 *
 * Conventions follow panel.test.ts: a bare mock stands in for pi (captured
 * ui.custom factory + done callback, floating promise), the module-scoped
 * host record is re-armed via createPanelHost per scenario, and fixture
 * states are real InterrogationStates seeded through the raw primitives.
 * The mock surface gains a setWidget(key, content) RECORDER — widget
 * assertions are exact-string, per the h2.3 contract.
 */
import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, resolveKeyLabels } from "../config.js";
import { DraftStore } from "../draft-store.js";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import { createPanelHost, openPanel, type OpenPanelOptions, type PiUISurface } from "./panel.js";
import {
  buildSuspendWidgetLine,
  hasResumableQuestions,
  RESUMABLE_STATUSES,
  resumePanel,
  updateSuspendWidget,
  WIDGET_KEY,
} from "./suspend.js";

const ESCAPE = "\u001b";
/** kitty CSI-u ctrl+shift+q (q = 113) — same bytes keys.test.ts routes with. */
const BREAK_OUT = "\u001b[113;6u";
const DEFAULT_LABEL = resolveKeyLabels(DEFAULT_CONFIG).breakOut; // "Ctrl+Shift+Q"
const line = (open: number, answered: number): string =>
  `${open} open · ${answered} answered — ${DEFAULT_LABEL} to resume /interrogate`;

/** Identity theme so layout renderers run in tests (stub per panel.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
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

/** Flush microtasks so the floating custom() promise's .then handlers run. */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------------------ fixtures

/** Real state with `open` open + `answered` answered questions, in order. */
function makeState(open: number, answered: number): InterrogationState {
  const state = createInterrogationState("goal");
  let i = 0;
  for (let j = 0; j < open; j++, i++) state.upsertQuestion(choiceQ(`q${i + 1}`));
  for (let j = 0; j < answered; j++, i++) {
    state.upsertQuestion(choiceQ(`q${i + 1}`));
    state.applyAnswer(`q${i + 1}`, { value: "a", at: "t" });
  }
  return state;
}

function optsFor(state: InterrogationState, extra: Partial<OpenPanelOptions> = {}): OpenPanelOptions {
  return { config: DEFAULT_CONFIG, state, ...extra };
}

// ------------------------------------------------------------------ mock pi

interface CustomCall {
  component: Component;
  done: (result: null | undefined) => void;
}

type SetWidgetCall = [key: string, content: string[] | undefined];

interface MockPi {
  pi: PiUISurface;
  custom: Mock;
  /** Every captured custom() call, in order. */
  calls: CustomCall[];
  /** Every setWidget(key, content) call, in order. */
  setWidgetCalls: SetWidgetCall[];
  /** Make the NEXT custom() promise reject (crashed-panel .catch path). */
  rejectNext(): void;
}

function makeMockPi(mode: string | undefined = "tui"): MockPi {
  const calls: CustomCall[] = [];
  const setWidgetCalls: SetWidgetCall[] = [];
  let rejectPending = false;

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
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<null | undefined>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const done = (result: null | undefined): void => resolve(result);
      const component = factory(
        { requestRender: vi.fn() } as unknown as TUI,
        stubTheme,
        {} as unknown as KeybindingsManager,
        done,
      );
      calls.push({ component, done });
      if (rejectPending) {
        rejectPending = false;
        reject(new Error("panel crashed"));
      }
      return promise;
    },
  );

  const setWidget = vi.fn((key: string, content: string[] | undefined): void => {
    setWidgetCalls.push([key, content]);
  });

  const surface = { mode, ui: { custom, setWidget } };
  // Cast mirrors panel.test.ts's mock convention: the mock's call signature
  // is a widened superset of the surface the host uses.
  const pi = surface as unknown as PiUISurface;

  return {
    pi,
    custom,
    calls,
    setWidgetCalls,
    rejectNext: () => {
      rejectPending = true;
    },
  };
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

function firstCall(mock: MockPi): CustomCall {
  expect(mock.calls.length).toBeGreaterThan(0);
  return mock.calls[0]!;
}

// ------------------------------------------------------------------- tests

describe("buildSuspendWidgetLine — exact h2.3 string", () => {
  test("test_buildSuspendWidgetLine_exact_counts_and_label", () => {
    const state = makeState(3, 2);
    // submitted / reasked / withdrawn / moot join NEITHER bucket.
    state.upsertQuestion(choiceQ("s1"));
    state.applyAnswer("s1", { value: "a", at: "t" });
    state.setStatus("s1", "submitted");
    state.upsertQuestion(choiceQ("r1"));
    state.setStatus("r1", "reasked");
    state.upsertQuestion(choiceQ("w1"));
    state.setStatus("w1", "withdrawn");
    state.upsertQuestion(choiceQ("m1"));
    state.setStatus("m1", "moot");

    expect(buildSuspendWidgetLine(state, resolveKeyLabels(DEFAULT_CONFIG))).toBe(
      "3 open · 2 answered — Ctrl+Shift+Q to resume /interrogate",
    );
  });

  test("test_buildSuspendWidgetLine_rebound_breakOut_label", () => {
    const state = makeState(1, 0);
    const rebound = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, breakOut: "ctrl+alt+x" },
    };
    expect(buildSuspendWidgetLine(state, resolveKeyLabels(rebound))).toBe(
      "1 open · 0 answered — Ctrl+Alt+X to resume /interrogate",
    );
  });
});

describe("hasResumableQuestions — shared predicate (BUG-005)", () => {
  test("test_RESUMABLE_STATUSES_contract_set", () => {
    // Single-definition contract lock: exactly the four active statuses.
    expect([...RESUMABLE_STATUSES].sort()).toEqual(["answered", "open", "reasked", "submitted"]);
  });

  test("test_hasResumableQuestions_true_for_each_active_status", () => {
    expect(hasResumableQuestions(makeState(2, 0))).toBe(true); // open-only
    expect(hasResumableQuestions(makeState(0, 2))).toBe(true); // answered-only

    const submitted = createInterrogationState("goal");
    submitted.upsertQuestion(choiceQ("s1"));
    submitted.applyAnswer("s1", { value: "a", at: "t" });
    submitted.setStatus("s1", "submitted");
    expect(hasResumableQuestions(submitted)).toBe(true); // submitted-only

    const reasked = createInterrogationState("goal");
    reasked.upsertQuestion(choiceQ("r1"));
    reasked.setStatus("r1", "reasked");
    expect(hasResumableQuestions(reasked)).toBe(true); // reasked-only
  });

  test("test_hasResumableQuestions_true_for_mixed_active_and_terminal", () => {
    const state = makeState(1, 1);
    state.upsertQuestion(choiceQ("m1"));
    state.setStatus("m1", "moot"); // terminal alongside live ones
    expect(hasResumableQuestions(state)).toBe(true);
  });

  test("test_hasResumableQuestions_false_for_empty_state", () => {
    expect(hasResumableQuestions(createInterrogationState("goal"))).toBe(false);
  });

  test("test_hasResumableQuestions_false_for_terminal_only", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("t1"));
    state.setStatus("t1", "moot");
    state.upsertQuestion(choiceQ("t2"));
    state.setStatus("t2", "withdrawn");
    state.upsertQuestion(choiceQ("t3"));
    state.setStatus("t3", "closed");
    expect(hasResumableQuestions(state)).toBe(false);
  });

  test("test_hasResumableQuestions_false_after_clearForCompletion", () => {
    const state = makeState(2, 2);
    expect(hasResumableQuestions(state)).toBe(true);
    state.clearForCompletion();
    expect(hasResumableQuestions(state)).toBe(false);
  });
});

describe("updateSuspendWidget — set/clear visibility rule", () => {
  test("test_updateSuspendWidget_sets_open_line_then_answered_only_line", () => {
    const mock = makeMockPi();
    const state = makeState(2, 1);

    updateSuspendWidget(mock.pi, state, DEFAULT_CONFIG);
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, ["2 open · 1 answered — Ctrl+Shift+Q to resume /interrogate"]],
    ]);

    // BUG-005: answering the last open questions keeps the widget alive —
    // "0 open · N answered" is a legitimate rendered line now (the old rule
    // cleared here, stranding pending answers invisibly).
    state.applyAnswer("q1", { value: "a", at: "t" });
    state.applyAnswer("q2", { value: "a", at: "t" });
    updateSuspendWidget(mock.pi, state, DEFAULT_CONFIG);
    expect(mock.setWidgetCalls[1]).toEqual([
      WIDGET_KEY,
      ["0 open · 3 answered — Ctrl+Shift+Q to resume /interrogate"],
    ]);
  });

  test("test_updateSuspendWidget_clears_only_dead_states", () => {
    const mock = makeMockPi();

    // Empty state (post-clearForCompletion shape) → cleared.
    updateSuspendWidget(mock.pi, createInterrogationState("goal"), DEFAULT_CONFIG);
    expect(mock.setWidgetCalls[0]).toEqual([WIDGET_KEY, undefined]);

    // All-terminal (moot/withdrawn/closed only) → cleared.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("t1"));
    state.setStatus("t1", "moot");
    state.upsertQuestion(choiceQ("t2"));
    state.setStatus("t2", "withdrawn");
    state.upsertQuestion(choiceQ("t3"));
    state.setStatus("t3", "closed");
    updateSuspendWidget(mock.pi, state, DEFAULT_CONFIG);
    expect(mock.setWidgetCalls[1]).toEqual([WIDGET_KEY, undefined]);

    // Post-clearForCompletion (map emptied) → cleared.
    const live = makeState(2, 2);
    updateSuspendWidget(mock.pi, live, DEFAULT_CONFIG);
    expect(mock.setWidgetCalls[2]?.[1]).toBeDefined();
    live.clearForCompletion();
    updateSuspendWidget(mock.pi, live, DEFAULT_CONFIG);
    expect(mock.setWidgetCalls[3]).toEqual([WIDGET_KEY, undefined]);
  });

  test("test_updateSuspendWidget_nop_without_setWidget_surface", () => {
    const mock = makeMockPi();
    const bare = { mode: "tui", ui: { custom: mock.custom } } as unknown as PiUISurface;
    const state = makeState(1, 0);
    expect(() => updateSuspendWidget(bare, state, DEFAULT_CONFIG)).not.toThrow();
    expect(mock.setWidgetCalls).toEqual([]);
  });
});

describe("suspend — widget set at the single choke point", () => {
  test("test_esc_top_level_suspend_sets_widget_exact_line", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(3, 2);
    expect(openPanel(mock.pi, optsFor(state))).toBe(true);

    const panel = firstCall(mock).component as unknown as { handleInput(data: string): boolean };
    expect(panel.handleInput(ESCAPE)).toBe(true); // esc-descend ladder → suspend
    await flush();

    expect(host.isSuspended()).toBe(true);
    expect(host.isOpen()).toBe(false);
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined], // cleared on open (stale-reminder guard)
      [WIDGET_KEY, [line(3, 2)]], // set at the suspend choke point
    ]);
  });

  test("test_ctrl_shift_q_in_panel_suspend_sets_widget", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(2, 2);
    openPanel(mock.pi, optsFor(state));

    const panel = firstCall(mock).component as unknown as { handleInput(data: string): boolean };
    expect(panel.handleInput(BREAK_OUT)).toBe(true); // config accelerator → p.suspend()
    await flush();

    expect(host.isSuspended()).toBe(true);
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined],
      [WIDGET_KEY, [line(2, 2)]],
    ]);
  });

  test("test_lifecycle_dismiss_suspend_sets_widget_and_keeps_focus", async () => {
    const mockLifecycle = makeMockLifecycle();
    const host = createPanelHost(mockLifecycle.lifecycle);
    const mock = makeMockPi();
    const state = makeState(2, 1);
    openPanel(mock.pi, optsFor(state, { focusQuestionId: "q2" }));

    mockLifecycle.dismiss(); // → suspendCurrent → done(null) → floating .then
    await flush();

    expect(host.isSuspended()).toBe(true);
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined],
      [WIDGET_KEY, [line(2, 1)]],
    ]);

    // Focus memory comes from suspendCurrent itself: currentPanel was already
    // nulled when the floating .then ran, so only the host-forced path could
    // have captured q2.
    expect(resumePanel(mock.pi)).toBe(true);
    const fresh = mock.calls[1]!.component as unknown as { currentId: string | undefined };
    expect(fresh.currentId).toBe("q2");
  });

  test("test_suspend_answered_only_sets_zero_open_widget_line", async () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(0, 2);
    openPanel(mock.pi, optsFor(state));

    firstCall(mock).done(null);
    await flush();

    // BUG-005 (the flip): answered-pending-submission is a LIVE state — the
    // reminder widget STAYS so the user can resurface and ctrl+s.
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined], // cleared on open (stale-reminder guard)
      [WIDGET_KEY, [line(0, 2)]], // set at the suspend choke point
    ]);
  });

  test("test_suspend_submitted_and_reasked_keep_widget_alive", async () => {
    createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("s1"));
    state.applyAnswer("s1", { value: "a", at: "t" });
    state.setStatus("s1", "submitted");
    state.upsertQuestion(choiceQ("r1"));
    state.setStatus("r1", "reasked");
    openPanel(mock.pi, optsFor(state));

    firstCall(mock).done(null);
    await flush();

    // submitted/reasked join neither count bucket but ARE resumable.
    expect(mock.setWidgetCalls[1]).toEqual([
      WIDGET_KEY,
      ["0 open · 0 answered — Ctrl+Shift+Q to resume /interrogate"],
    ]);
  });

  test("test_crashed_panel_catch_applies_same_widget_rule", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    mock.rejectNext();
    const state = makeState(1, 1);
    expect(openPanel(mock.pi, optsFor(state))).toBe(true);

    await flush(); // rejection → .catch → markSuspended + widget rule

    expect(host.isSuspended()).toBe(true);
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined],
      [WIDGET_KEY, [line(1, 1)]],
    ]);
  });
});

describe("resumePanel — widget clear + fresh instance + focus restore", () => {
  test("test_resumePanel_clears_widget_rehydrates_restores_focus", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(3, 1);
    const drafts = new DraftStore();
    drafts.setDraft("q2", "in-progress draft");

    openPanel(mock.pi, optsFor(state, { drafts, focusQuestionId: "q2" }));
    const first = firstCall(mock).component as unknown as {
      currentId: string | undefined;
      deepSticky: boolean;
      handleInput(data: string): boolean;
      drafts?: DraftStore;
    };
    expect(first.currentId).toBe("q2");
    first.deepSticky = true; // per-session state that must reset (h2.29)
    first.handleInput(ESCAPE);
    await flush();
    expect(host.isSuspended()).toBe(true);
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined], // cleared on open
      [WIDGET_KEY, [line(3, 1)]], // set on suspend
    ]);

    expect(resumePanel(mock.pi)).toBe(true);
    expect(mock.calls.length).toBe(2);
    // Widget cleared on resume (openPanel success path).
    expect(mock.setWidgetCalls[2]).toEqual([WIDGET_KEY, undefined]);
    const fresh = mock.calls[1]!.component as unknown as {
      currentId: string | undefined;
      deepSticky: boolean;
      drafts?: DraftStore;
    };
    expect(fresh).not.toBe(first); // fresh instance
    expect(fresh.deepSticky).toBe(false); // per-session state reset (h2.29)
    expect(fresh.currentId).toBe("q2"); // focus restored from lastFocusId
    expect(fresh.drafts?.getDraft("q2")).toBe("in-progress draft"); // R4
    expect(drafts.hasDraft("q2")).toBe(true); // shared store untouched
    expect(host.isOpen()).toBe(true);
    expect(host.isSuspended()).toBe(false);
  });

  test("test_resumePanel_falls_back_to_first_active_when_focus_withdrawn", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(2, 1);
    openPanel(mock.pi, optsFor(state, { focusQuestionId: "q2" }));
    state.setStatus("q2", "withdrawn"); // lastFocusId becomes moot

    const panel = firstCall(mock).component as unknown as { handleInput(data: string): boolean };
    panel.handleInput(ESCAPE);
    await flush();

    expect(resumePanel(mock.pi)).toBe(true);
    const fresh = mock.calls[1]!.component as unknown as { currentId: string | undefined };
    expect(fresh.currentId).toBe("q1"); // first active question — never a dead focus
  });

  test("test_resumePanel_noop_when_open_or_never_opened", () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    expect(resumePanel(mock.pi)).toBe(false); // nothing to resume (no lastOpts)

    const state = makeState(1, 0);
    openPanel(mock.pi, optsFor(state));
    expect(resumePanel(mock.pi)).toBe(false); // single-instance guard
    expect(mock.calls.length).toBe(1);
    expect(host.isOpen()).toBe(true);
  });
});

describe("widget lifecycle — clear on open and full close", () => {
  test("test_openPanel_clears_stale_widget", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(2, 1);
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component as unknown as { handleInput(data: string): boolean };
    panel.handleInput(ESCAPE);
    await flush();
    expect(mock.setWidgetCalls).toEqual([
      [WIDGET_KEY, undefined], // cleared on first open
      [WIDGET_KEY, [line(2, 1)]], // set on suspend
    ]);

    expect(openPanel(mock.pi, optsFor(state))).toBe(true); // explicit reopen
    expect(mock.setWidgetCalls[2]).toEqual([WIDGET_KEY, undefined]); // stale line gone
    expect(host.isOpen()).toBe(true);
  });

  test("test_host_dispose_clears_widget", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(1, 0);
    openPanel(mock.pi, optsFor(state));
    const panel = firstCall(mock).component as unknown as { handleInput(data: string): boolean };
    panel.handleInput(ESCAPE);
    await flush();
    expect(mock.setWidgetCalls.slice(0, 2)).toEqual([
      [WIDGET_KEY, undefined],
      [WIDGET_KEY, [line(1, 0)]],
    ]);

    host.dispose(); // full close → defensive clear BEFORE dropping the surface
    expect(mock.setWidgetCalls.at(-1)).toEqual([WIDGET_KEY, undefined]);
  });
});

describe("R4 — state and drafts byte-identical across suspend/resume", () => {
  test("test_state_epoch_and_drafts_survive_suspend_resume", async () => {
    const host = createPanelHost(makeMockLifecycle().lifecycle);
    const mock = makeMockPi();
    const state = makeState(2, 2);
    const drafts = new DraftStore();
    drafts.setDraft("q1", "keep me");
    drafts.setNote("batch note");

    openPanel(mock.pi, optsFor(state, { drafts }));
    const before = JSON.stringify(state.serialize());
    const panel = firstCall(mock).component as unknown as { handleInput(data: string): boolean };
    panel.handleInput(ESCAPE);
    await flush();
    expect(resumePanel(mock.pi)).toBe(true);

    expect(JSON.stringify(state.serialize())).toBe(before); // byte-identical
    expect(state.epoch).toBe(1); // no submission — untouched
    expect(drafts.getDraft("q1")).toBe("keep me");
    expect(drafts.getNote()).toBe("batch note");
    expect(host.isOpen()).toBe(true);
  });
});

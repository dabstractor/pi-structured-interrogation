/**
 * REGRESSION SUITE for BUG-panel-phantom-recommended-submissions.md
 * (2026-10-02 remote-bridge removal; spec/decisions.md §Remote bridge
 * surface removed).
 *
 * The incident: during a 6-question panel, answers the user never gave
 * were recorded — every still-open question answered with exactly its
 * `recommendation` value — then one genuine answer completed the
 * interrogation and closed the panel with no user-side reopen. Root cause
 * was the (now removed) pi-ask bridge surface: a conformant client with
 * preselected ★ form widgets re-submitted the full set, and the extension
 * committed every wire value as a user shipment.
 *
 * This suite pins the fix:
 *  1. FACTORY: the extension subscribes to no `@eko24ive/pi-ask:*`
 *     channel and a forged `:submit` payload mutates nothing.
 *  2. PANEL INNOCENCE: two genuine write-ins + ctrl+s ship exactly 2;
 *     re-ask + add; a bare ctrl+s ships nothing; a non-recommended answer
 *     stays pending; settle closes only the submitted; no completion.
 *  3. ONE-ANSWER NO-FABRICATION: one non-recommended accept ships nothing
 *     until explicit ctrl+s, and never fabricates the rest.
 *  4. RECORD-DERIVED COUNTERS: the answered counts read from answer
 *     records (status line, group line, panel header, suspend widget) —
 *     symptom 3 (0/6 over six recorded answers) can no longer occur.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import interrogatorExtension from "./index.js";
import { DEFAULT_CONFIG } from "./config.js";
import { createCompletionTrigger } from "./completion.js";
import { DraftStore } from "./draft-store.js";
import { renderHeader } from "./panel/layout.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel/panel.js";
import { buildSuspendWidgetLine } from "./panel/suspend.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { getState, resetState } from "./state.js";
import { executeInterrogate, type ExecutorContext } from "./tool.js";

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

const DOWN = "\u001b[B";
const ENTER = "\r";
const CTRL_S = "\u0013";

function fakeEditor() {
  let text = "";
  return {
    getText: () => text,
    setText: (t: string) => {
      text = t;
    },
    handleInput: vi.fn(),
    render: () => ["e1", "e2", "e3"],
    focused: false,
    focus: vi.fn(),
    blur: vi.fn(),
    invalidate: vi.fn(),
  };
}

/** pi harness: host-event subscriptions captured; sendMessage recorded. */
function makePiHarness() {
  const sendMessage = vi.fn();
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const on = vi.fn((event: string, handler: (e: unknown) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {};
  });
  const pi = { on, sendMessage } as unknown as Pick<ExtensionAPI, "on" | "sendMessage">;
  const emit = (event: string): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event });
  };
  return { pi, sendMessage, on, emit };
}

function tuiCtx(): ExecutorContext {
  return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };
}

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------- 1. factory

describe("regression: bridge vector gone at the factory level", () => {
  test("no pi-ask channel subscribed; forged submit mutates nothing", async () => {
    const h = makePiHarness();
    const busHandlers = new Map<string, Array<(e: unknown) => void>>();
    const events = {
      on: vi.fn((event: string, handler: (e: unknown) => void) => {
        const list = busHandlers.get(event) ?? [];
        list.push(handler);
        busHandlers.set(event, list);
        return () => {};
      }),
      emit: vi.fn(),
    };
    const pi = {
      ...h.pi,
      events,
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerMessageRenderer: vi.fn(),
      registerEntryRenderer: vi.fn(),
      appendEntry: vi.fn(),
      notify: vi.fn(),
    } as unknown as ExtensionAPI;

    await expect(interrogatorExtension(pi)).resolves.toBeUndefined();

    // No subscription on any @eko24ive/pi-ask:* channel — the incident is
    // impossible by construction (no :submit listener exists anywhere).
    const subscribed = [
      ...h.on.mock.calls.map((c) => c[0] as string),
      ...(events.on as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string),
    ];
    expect(subscribed.filter((e) => e.includes("pi-ask"))).toEqual([]);

    // A forged conformant submit payload delivers nothing and mutates state
    // not at all (no state exists yet, and none may be created by it).
    for (const handler of [...(busHandlers.get("@eko24ive/pi-ask:submit") ?? [])])
      handler({ version: 1, requestId: "r", flowId: "itg:x:1", response: { kind: "answer", mode: "form", answers: { q: { values: ["rec"] } } } });
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(getState()).toBeUndefined();
  });
});

// ------------------------------------------------------- 2./3./4. machinery

function choiceQ(id: string) {
  return {
    id,
    prompt: `p:${id}`,
    type: "choice",
    options: [
      { value: "rec", label: `${id}-recommended` },
      { value: "alt", label: `${id}-alternative` },
    ],
    recommendation: "rec",
    group: "Plan",
  };
}

function makeWalkthrough() {
  const h = makePiHarness();
  let lifecycle: Lifecycle;
  lifecycle = createLifecycle(h.pi, {
    onAfterClosePass: createCompletionTrigger(h.pi, {
      lifecycle: { dismissPanel: () => lifecycle.dismissPanel() },
      ctx: { isIdle: () => true },
    }),
  });

  let editor: ReturnType<typeof fakeEditor> | undefined;
  const panelOf = () => {
    const state = getState()!;
    return new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state,
      config: DEFAULT_CONFIG,
      drafts: new DraftStore(),
      editorFactory: () => {
        editor = fakeEditor();
        return editor;
      },
      delivery: {
        sendMessage: h.sendMessage,
        isIdle: () => true,
        noteSubmissionDelivered: () => lifecycle.noteSubmissionDelivered(),
      },
    } as unknown as InterrogationPanelArgs);
  };
  const writeIn = (panel: InterrogationPanel, id: string, text: string): void => {
    panel.currentId = id;
    panel.cursorIndex = getState()!.getQuestion(id)!.options!.length; // ✎ Other row
    panel.handleInput(ENTER);
    editor!.setText(text);
    panel.handleInput(ENTER);
  };
  return { h, lifecycle, panelOf, writeIn };
}

describe("regression: panel innocence through the reported timeline", () => {
  test("no phantom recommended answers ship; no completion on open questions", () => {
    const { h, panelOf, writeIn } = makeWalkthrough();

    // E1 — five recommended questions (the incident's setup).
    executeInterrogate(
      { goal: "Plan", epoch: 1, questions: ["scope", "pending-at-stop", "cancel-trigger", "cancel-semantics", "lite-silence"].map(choiceQ) },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    let panel = panelOf();

    // E2 — two genuine ✎ write-ins + ctrl+s: ships EXACTLY those two.
    writeIn(panel, "scope", "keep it minimal");
    writeIn(panel, "pending-at-stop", "challenge the premise");
    panel.handleInput(CTRL_S);
    const e2 = h.sendMessage.mock.calls.at(-1)![0] as { content: string; customType: string };
    expect(e2.customType).toBe("interrogation-submission");
    expect(e2.content).toContain("scope: ✎ keep it minimal");
    expect(e2.content).toContain("pending-at-stop: ✎ challenge the premise");
    expect(e2.content).not.toMatch(/cancel-trigger: /);
    expect(e2.content).not.toMatch(/cancel-semantics: /);
    expect(e2.content).not.toMatch(/lite-silence: /);

    h.emit("agent_settled"); // close pass archives the two submitted

    // Re-ask pending-at-stop (rule 2: changed options) + add the 6th.
    executeInterrogate(
      {
        epoch: 2,
        questions: [
          {
            ...choiceQ("pending-at-stop"),
            rev: 1,
            options: [
              { value: "rec", label: "Freeze as committed" },
              { value: "alt", label: "Revisit each time" },
              { value: "third", label: "Third path" },
            ],
          },
        ],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    executeInterrogate({ epoch: 2, questions: [choiceQ("normal-mode-fate")] }, tuiCtx(), DEFAULT_CONFIG);

    // E3 — a bare ctrl+s on the remounted panel ships NOTHING (no pending).
    h.sendMessage.mockClear();
    panel = panelOf();
    panel.handleInput(CTRL_S);
    expect(h.sendMessage).not.toHaveBeenCalled();

    // E4 — one genuine NON-recommended answer: stays pending (open
    // questions remain → no auto-submit), never completes.
    panel.currentId = "normal-mode-fate";
    panel.handleInput(DOWN); // → the alternative (non-recommended)
    panel.handleInput(ENTER);
    expect(h.sendMessage).not.toHaveBeenCalled(); // "it submitted it when I answered a question" — gone

    h.emit("agent_settled");
    const completions = h.sendMessage.mock.calls
      .map((c) => c[0] as { customType: string })
      .filter((m) => m.customType === "interrogation-completion");
    expect(completions).toEqual([]);

    // Final statuses are exact: only the two genuine write-ins closed.
    const statuses = getState()!.orderedQuestions().map((q) => `${q.id}:${q.status}`);
    expect(statuses).toEqual([
      "scope:closed",
      "pending-at-stop:reasked",
      "cancel-trigger:open",
      "cancel-semantics:open",
      "lite-silence:open",
      "normal-mode-fate:answered",
    ]);

    // No submission anywhere ever carried a phantom recommended value.
    for (const call of h.sendMessage.mock.calls) {
      const m = call[0] as { content: string };
      expect(m.content).not.toMatch(/cancel-trigger: cancel-trigger-recommended/);
      expect(m.content).not.toMatch(/cancel-semantics: cancel-semantics-recommended/);
      expect(m.content).not.toMatch(/lite-silence: lite-silence-recommended/);
      expect(m.content).not.toMatch(/normal-mode-fate: normal-mode-fate-recommended/);
    }
  });
});

describe("regression: one genuine answer fabricates nothing", () => {
  test("accept + explicit ctrl+s ships exactly the one; no completion", () => {
    const { h, panelOf } = makeWalkthrough();

    executeInterrogate(
      { goal: "Plan", epoch: 1, questions: ["scope", "pending-at-stop", "cancel-trigger", "cancel-semantics", "lite-silence"].map(choiceQ) },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    const panel = panelOf();

    // The user answers exactly ONE question — the NON-recommended option.
    panel.currentId = "cancel-trigger";
    expect(panel.cursorIndex).toBe(0); // seeds to ★ recommended
    panel.handleInput(DOWN);
    expect(panel.cursorIndex).toBe(1);
    panel.handleInput(ENTER);

    // A partial set NEVER auto-ships.
    expect(h.sendMessage).not.toHaveBeenCalled();

    // Explicit ctrl+s ships exactly that one.
    panel.handleInput(CTRL_S);
    const calls = h.sendMessage.mock.calls.map((c) => c[0] as { content: string; customType: string });
    const submissions = calls.filter((m) => m.customType === "interrogation-submission");
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.content).toContain("cancel-trigger: cancel-trigger-alternative");
    for (const id of ["scope", "pending-at-stop", "cancel-semantics", "lite-silence"]) {
      expect(submissions[0]!.content).not.toMatch(new RegExp(`${id}: ${id}-recommended`));
    }

    // Settle: only the submitted one closes; open questions remain → no
    // completion, no panel dismissal, state intact.
    h.emit("agent_settled");
    const statuses = getState()!.orderedQuestions().map((q) => `${q.id}:${q.status}`);
    expect(statuses).toEqual([
      "scope:open",
      "pending-at-stop:open",
      "cancel-trigger:closed",
      "cancel-semantics:open",
      "lite-silence:open",
    ]);
    const completions = h.sendMessage.mock.calls
      .map((c) => c[0] as { customType: string })
      .filter((m) => m.customType === "interrogation-completion");
    expect(completions).toEqual([]);
  });
});

describe("regression: record-derived counters (symptom 3)", () => {
  test("status line, group line, panel header, and widget agree with the records", () => {
    const { h, panelOf, writeIn } = makeWalkthrough();

    // Build the walkthrough state: 6 questions, 2 closed-with-answers
    // (genuine write-ins), 1 re-asked, 1 pending answer, 3 open total.
    executeInterrogate(
      { goal: "Plan", epoch: 1, questions: ["scope", "pending-at-stop", "cancel-trigger", "cancel-semantics", "lite-silence"].map(choiceQ) },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    const panel = panelOf();
    writeIn(panel, "scope", "keep it minimal");
    writeIn(panel, "pending-at-stop", "challenge the premise");
    panel.handleInput(CTRL_S);
    h.emit("agent_settled");
    executeInterrogate(
      {
        epoch: 2,
        questions: [
          {
            ...choiceQ("pending-at-stop"),
            rev: 1,
            options: [
              { value: "rec", label: "Freeze as committed" },
              { value: "alt", label: "Revisit each time" },
              { value: "third", label: "Third path" },
            ],
          },
        ],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    executeInterrogate({ epoch: 2, questions: [choiceQ("normal-mode-fate")] }, tuiCtx(), DEFAULT_CONFIG);
    const panel2 = panelOf();
    panel2.currentId = "normal-mode-fate";
    panel2.handleInput(DOWN);
    panel2.handleInput(ENTER);

    const state = getState()!;

    // Model-facing status line: 2 answered (scope closed + normal-mode-fate
    // pending), 1 re-asked, epoch 2 — recomputed from the records above.
    const read = executeInterrogate({}, tuiCtx(), DEFAULT_CONFIG);
    expect(read.content).toContain("2/6 answered · 1 re-asked · 0 moot · epoch 2");
    // Group summary line carries the same count.
    expect(read.content).toContain("Plan: 2/6 answered");

    // Panel header counts agree.
    const header = renderHeader(state.serialize(), stubTheme, 120);
    expect(header.line).toContain("2/6 answered · 1 re-asked");

    // Suspend widget counts agree (3 open · 2 answered).
    expect(buildSuspendWidgetLine(state)).toBe("3 open · 2 answered — /interrogate to resume");
  });
});

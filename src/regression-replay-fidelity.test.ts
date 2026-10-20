/**
 * REGRESSION SUITE for BUG-001 (PRD h2.2/h3.0; Recommendation 1, item 4).
 *
 * The incident: a delivered submission delta replayed on restart restored
 * only `entry.value` — the DiffEntry carrier had no `text`/`custom`, so a
 * restart silently dropped answer elaborations and ✎ Other write-in
 * markers from every reconstructed surface.
 *
 * Reachability (the missed-flush window): the session mirror that would
 * otherwise carry full answer shape is DEBOUNCED by
 * STATE_MIRROR_DEBOUNCE_MS = 2000 (src/persistence.ts:62). A hard kill —
 * SSH drop / SIGKILL / crash — inside that 2s window dies before
 * session_shutdown's synchronous flush ever runs (or an appendEntry call
 * fails outright), so the branch holds only the older interrogate tool
 * result + the delivered interrogation-submission entries. Restart then
 * reconstructs by replaying the submission delta on top of the tool
 * result — and that replay is the ONLY chance to restore the full answer
 * shape. This file pins that replay END-TO-END: real executeInterrogate
 * upsert (the tool result envelope IS the reconstruction base), real
 * panel gestures (option accept + committed elaboration, then a ✎ Other
 * write-in), the REAL synchronous auto-submit delivery captured off the
 * mocked sendMessage wire, then reconstructFromBranch over exactly
 * [tool-result base, submission entry] with NO mirror entry.
 *
 * Pinned contracts: FR-27 (canonical branch state), TRUST-001 (user words
 * stay model-visible), WRITEIN-001 (write-in markers live),
 * ANSWER-PIN-001 (write-in value survives as the RAW text, value-first —
 * never the `✎ …` display label), FR-5 / commitment 2 (the completion
 * record keeps elaborations).
 *
 * The fix surface — S2 (DiffEntry carrier + computeEntries,
 * snapshots.ts), S3 (panel submit seam spreads, panel/actions.ts), S4
 * (replaySubmission conditional spreads, reconstruct.ts) — is pinned as
 * ONE chain here: a regression in any of the three fails this file.
 */
import type { ExtensionAPI, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import type { TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "./config.js";
import { DraftStore } from "./draft-store.js";
import {
  reconstructFromBranch,
  setFallbackActive,
  type ReconstructionContext,
  type ReconstructionOptions,
} from "./reconstruct.js";
import {
  createPanelHost,
  InterrogationPanel,
  type InterrogationPanelArgs,
  type PanelHost,
} from "./panel/panel.js";
import { getState, resetState, type Question } from "./state.js";
import { executeInterrogate, type ExecutorContext } from "./tool.js";

// ------------------------------------------------------------------ helpers
// Locally-copied (module-private in their home files): stubTheme/fakeEditor/
// makePiHarness from regression-phantom-submissions.test.ts; entry fixtures +
// ctx/host/opts mocks from reconstruct.test.ts.

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

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

/**
 * Message entry carrying an interrogate tool result. `details` is the REAL
 * tool-result envelope (`{ state, epoch, statusLine, action }`) — a faithful
 * superset of the fixture shape; reconstruction reads only `details.state`
 * for tool-result candidates.
 */
function toolResultEntry(details: unknown): SessionEntry {
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
      details,
      isError: false,
      timestamp: Date.now(),
    },
  } as unknown as SessionEntry;
}

/**
 * Submission delta (pi.sendMessage shape: `custom_message` + `details`).
 * The real captured delivery details pass through verbatim — `card` is only
 * added when absent (hand-built fixtures); the wire payload already carries
 * one. Post-S2/S3 the inline entry type includes text?/custom?.
 */
function submissionEntry(details: {
  changed: Array<{
    id: string;
    title: string;
    from: string;
    to: string;
    editedArchived: boolean;
    value?: string;
    text?: string;
    custom?: boolean;
  }>;
  epoch: number;
  card?: unknown;
}): SessionEntry {
  return {
    type: "custom_message",
    id: `s${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "interrogation-submission",
    content: "Submitted 2: q1, q2",
    display: true,
    details: "card" in details ? details : { ...details, card: { ...details, remainOpen: 0 } },
  } as unknown as SessionEntry;
}

function makeCtx(
  entries: SessionEntry[],
): ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } } {
  // Never-resolving promise: phase flips to "open", nothing resolves later
  // (SURFACE-002 — reconstruction's ONLY UI act is the keyed suspend widget).
  const custom = vi.fn(() => new Promise<null>(() => {}));
  const setWidget = vi.fn();
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { custom, setWidget },
  } as unknown as ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } };
}

function makeHost(): PanelHost {
  return createPanelHost({
    onPanelDismiss: () => {},
    dismissPanel: () => {},
  });
}

function makeOpts(host: PanelHost, drafts?: DraftStore): ReconstructionOptions {
  return { config: DEFAULT_CONFIG, host, drafts };
}

beforeEach(() => {
  setFallbackActive(false);
  makeHost(); // resets panel.ts's module-scoped host record between tests
  resetState();
});

// ------------------------------------------------------------------ the pin

describe("regression: BUG-001 replay fidelity (missed-flush window)", () => {
  test("elaboration + write-in survive restart replay (BUG-001 missed-flush window)", () => {
    const ENTER = "\r";
    const ELABORATION = "alpha fits the migration plan";
    const WRITE_IN = "Neither — we use a custom vector store";

    function choiceQ(id: string): Question {
      return {
        id,
        prompt: `p:${id}`,
        description: `deep-view context for ${id} — standalone background the reader needs`,
        type: "choice",
        rev: 1,
        status: "open",
        options: [
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
        ],
      };
    }

    const h = makePiHarness();

    // (a) REAL tool path — upsert two choice questions; the tool result's
    // details.state is the reconstruction base candidate.
    const upsert = executeInterrogate(
      { goal: "Replay fidelity regression", epoch: 1, questions: [choiceQ("q1"), choiceQ("q2")] },
      { mode: "tui", hasUI: true } satisfies ExecutorContext,
      DEFAULT_CONFIG,
    );
    const baseDetails = upsert.details; // { state, epoch: 1, statusLine, action: "upsert" }

    // REAL panel over the live state.
    const panel = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state: getState()!,
      config: DEFAULT_CONFIG,
      drafts: new DraftStore(),
      editorFactory: () => fakeEditor(),
      delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => {} },
    } as unknown as InterrogationPanelArgs);

    // (b1) q1 = option "alpha" …
    panel.currentId = "q1";
    panel.cursorIndex = 0; // row of "alpha"
    expect(panel.handleInput(ENTER)).toBe(true); // acceptOptionIndex commits {value:"alpha"}
    expect(h.sendMessage).not.toHaveBeenCalled(); // transition gate: q2 open → NO delivery

    // (b2) … with a committed elaboration (FR-18 draft path → commitTextDraft).
    panel.currentId = "q1"; // re-seeds cursor to the recorded answer's row
    panel.focusTextField("elaboration");
    panel.textField.setText(ELABORATION);
    expect(panel.handleInput(ENTER)).toBe(true); // stageText → commitTextDraft
    expect(panel.draftTextFor("q1")).toBe(ELABORATION); // slot staged
    expect(h.sendMessage).not.toHaveBeenCalled(); // still gated (AUTOSUBMIT-001)

    // (b3) q2 = ✎ Other write-in; the LAST open transition fires
    // maybeAutoSubmit SYNCHRONOUSLY → the auto path's submit() attaches q1's
    // staged elaboration and delivers ONE interrogation-submission.
    panel.currentId = "q2";
    panel.cursorIndex = getState()!.getQuestion("q2")!.options!.length; // ✎ Other row
    expect(panel.handleInput(ENTER)).toBe(true); // → write-in duty, editor focused
    panel.textField.setText(WRITE_IN); // SIDECHAT-001: the ANSWER editor, not the factory capture
    expect(panel.handleInput(ENTER)).toBe(true); // writeInEnter commits {value, custom:true}

    expect(h.sendMessage).toHaveBeenCalledTimes(1); // the auto-submit — nothing else ever
    const delivered = h.sendMessage.mock.calls[0]![0] as {
      customType: string;
      details: {
        changed: Array<{
          id: string;
          title: string;
          from: string;
          to: string;
          editedArchived: boolean;
          value?: string;
          text?: string;
          custom?: boolean;
        }>;
        epoch: number;
      };
    };
    expect(delivered.customType).toBe("interrogation-submission");

    // WIRE shape — pins producers (S2 carrier + S3 submit seam).
    const q1Entry = delivered.details.changed.find((e) => e.id === "q1")!;
    expect(q1Entry.value).toBe("alpha");
    expect(q1Entry.text).toBe(ELABORATION); // elaboration ON the delta
    expect(q1Entry.custom).toBeUndefined(); // real-option answers stay non-custom
    const q2Entry = delivered.details.changed.find((e) => e.id === "q2")!;
    expect(q2Entry.value).toBe(WRITE_IN); // RAW write-in text (value-first source)
    expect(q2Entry.custom).toBe(true); // WRITEIN-001 marker ON the delta

    // LIVE pre-kill state sanity — proves any later loss is a REPLAY property.
    expect(getState()!.getQuestion("q1")!.answer!.text).toBe(ELABORATION);
    expect(getState()!.getQuestion("q2")!.answer!.custom).toBe(true);

    // (c) The hard kill: process dies inside the 2s mirror debounce — NO
    // interrogation-state entry ever lands; session_shutdown never flushes.
    // Branch = tool-result base + the delivered submission, NOTHING else.
    resetState(); // the live state is gone
    const entries: SessionEntry[] = [
      toolResultEntry(baseDetails), // real tool-result envelope in details
      submissionEntry(delivered.details), // real captured details (changed/epoch/card)
    ];

    // (d) Restart: reconstruct and assert the FULL answer shape.
    const result = reconstructFromBranch(makeCtx(entries), makeOpts(makeHost()));
    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(1);

    const state = getState()!;
    expect(state.epoch).toBe(2); // base 1 + the one replayed submission's bump

    const q1 = state.getQuestion("q1")!;
    expect(q1.answer?.value).toBe("alpha");
    expect(q1.answer?.text).toBe(ELABORATION); // BUG-001 — was silently dropped
    expect("custom" in q1.answer!).toBe(false);
    expect(typeof q1.answer?.at).toBe("string"); // fresh — `at` never carried

    const q2 = state.getQuestion("q2")!;
    expect(q2.answer?.value).toBe(WRITE_IN); // value-first: RAW text, not the "✎ …" label
    expect(q2.answer?.custom).toBe(true); // BUG-001 — was silently dropped
    expect("text" in q2.answer!).toBe(false); // write-ins never duplicate into text
  });
});

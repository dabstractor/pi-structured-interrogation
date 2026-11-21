/**
 * src/blank-rejection.test.ts — P3.M4.T1.S2 scripted acceptance case 5
 * (spec state-and-persistence.md :149, verbatim):
 *
 *   "Reopen a committed Other/text answer; verify its exact value. Clear
 *   or enter only whitespace, attempt commit, then restart and reopen:
 *   the newer edit wins, the prior answer is unchanged, and rejection
 *   kept focus and explained why. Repeat blank rejection through
 *   non-editor ingress; replay a legacy blank with and without a prior
 *   valid answer and verify the resulting answer and counts."
 *
 * HALF-SPLIT (pinned when S1 landed): the LIVE halves of case 5 — the
 * applyAnswer blank throw, the editor's keep-focus/inline-reason
 * rejection ("Answer cannot be blank"), the fallback rejected bucket and
 * the tool's "blank value not recorded: {ids}" line — are S1's
 * (state.ts / panel/actions.ts / fallback.ts / tool.ts, landed and
 * pinned by their own suites; this file CALLS those real seams, never
 * modifies them). This file is S2's: the RESTART/REPLAY halves (the
 * reconstruct.ts blank guards — delta skip widened to isBlankAnswerValue
 * + the pre-deserialize base scrub) and the scripted end-to-end case 5.
 * P3.M5.T1.S1's full gate (cases 1–5) consumes this file as the case-5
 * artifact.
 *
 * Harness: adapted from session-restore.test.ts (P3.M3's case-1/case-4
 * pattern — read-only precedent): a DIRECT-constructed real panel over
 * the index.ts-shaped input-recovery composition (InputCaptureStore sink
 * → durable write over a tmpdir), typing through the REAL editor
 * mutation path, REAL timers, and the "abandoned references" crash
 * model (NO dispose, NO forceFlush-after, NO shutdown handler on the
 * killed side; forceFlush BEFORE the kill is the sanctioned
 * completed-save seam). The restart half is a hand-built reconstruction
 * over a GROWN walk whose base carries the committed answer with its
 * ORIGINAL `at` (the post-submit mirror landed — the common restart
 * shape), plus the original commit's submission delta POSITIONED BEFORE
 * the base (already contained → the position filter skips it, exactly
 * like a mirror base at a later index). That keeps the replayed answer's
 * `at` byte-original so the ANSWER-PIN ladder (`recoverySeed`) can award
 * the reopen seeding to the newer durable blank-ish draft — the spec
 * :149 "newer edit wins" limb. The rejected blank NEVER entered history
 * (S1's reject is zero-trace) — the walk's only submission delta is the
 * original valid commit, and asserting the prior answer after restart
 * pins that property.
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG } from "./config.js";
import { recordAnswers } from "./fallback.js";
import { DraftStore } from "./draft-store.js";
import { InputCaptureStore, type CaptureKey } from "./input-capture.js";
import { DurableInputStore } from "./input-durability.js";
import {
  createPanelHost,
  InterrogationPanel,
  type InterrogationPanelArgs,
  type PanelHost,
} from "./panel/panel.js";
import { INTERROGATION_STATE_ENTRY_TYPE } from "./persistence.js";
import {
  reconstructFromBranch,
  type ReconstructionOptions,
} from "./reconstruct.js";
import {
  createInterrogationState,
  getState,
  resetState,
  setState,
  type InterrogationState,
  type Question,
} from "./state.js";
import { executeInterrogate, type ExecutorContext } from "./tool.js";

const ENTER = "\r"; // the harness precedent's enter byte
const T_COMMIT = "2025-06-01T00:00:00.000Z"; // scripted wall-clock of the prior session's commit

/** The byte-exact probe: multiline + Unicode + irregular whitespace. */
const PROBE = "Half-typed ✍ réponsé\n  with  double spaces\tand ünïcode ☃ — keep  ";

// ------------------------------------------------------------------ fixtures

/** Fresh temp dir per test, removed in afterEach (session-restore fixture). */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  resetState(); // the reconstruction singleton — isolate per test
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-interrogator-blank-rejection-"));
  dirs.push(d);
  return d;
}

/** Identity theme (panel.test.ts stubTheme). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
} as unknown as InterrogationPanelArgs["theme"];

function textQ(id: string, overrides: Partial<Question> = {}): Question {
  return { id, prompt: `prompt:${id}`, type: "text", rev: 1, status: "open", options: undefined, ...overrides };
}

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

/**
 * The typed editor (session-restore harness): handleInput APPENDS the raw
 * bytes and fires onChange — the exact production mutation chain TextField
 * wraps; setText fires onChange too (the stock Editor's setTextInternal
 * behavior). Enter/esc never mutate buffer text.
 */
function typedEditor(): EditorComponent & {
  setText: (t: string) => void;
  handleInput: (data: string) => void;
  getText: () => string;
  onChange?: (text: string) => void;
} {
  let text = "";
  const editor: {
    getText: () => string;
    setText: (t: string) => void;
    handleInput: (data: string) => void;
    render: () => string[];
    focused: boolean;
    onChange?: (text: string) => void;
  } = {
    getText: () => text,
    setText: (t: string) => {
      text = t;
      editor.onChange?.(text);
    },
    handleInput: (data: string) => {
      if (data === "\r" || data === "\u001b") return;
      if (data === "\u007f") {
        // Backspace/DEL — how a real user CLEARS (spec :149's "clear"
        // limb): a user deletion is an editor mutation path, never the
        // seed-only setTextInternal route (whose onChange the panel's
        // capture suppression flag exists to swallow).
        text = text.slice(0, -1);
        editor.onChange?.(text);
        return;
      }
      text += data;
      editor.onChange?.(text);
    },
    render: () => ["e1", "e2", "e3"],
    focused: false,
  };
  return editor as unknown as EditorComponent & {
    setText: (t: string) => void;
    handleInput: (data: string) => void;
    getText: () => string;
    onChange?: (text: string) => void;
  };
}

/** Type through the REAL editor path, one keystroke at a time. */
function typeInto(field: { handleInput(data: string): void }, text: string): void {
  for (const ch of text) field.handleInput(ch);
}

// ------------------------------------------------------------------- harness

interface Harness {
  state: InterrogationState;
  panel: InterrogationPanel;
  capture: InputCaptureStore;
  durable: DurableInputStore;
  drafts: DraftStore;
  dir: string;
  /** Durable key builder for THIS session (tip = this walk's last entry). */
  key: (questionId: string, field: "writein" | "elaboration" | "note") => CaptureKey;
}

/**
 * One "process": fresh stores over `dir`, a fresh state, and a real panel
 * whose branchReader serves `walkIds` (oldest → newest). The capture
 * wiring is the index.ts shape exactly (session-restore makeSession,
 * minus the chat limbs — case 5 never opens chat).
 */
function makeSession(opts: {
  dir: string;
  walkIds: string[];
  questions: Question[];
  state?: InterrogationState; // restart side: adopt the RECONSTRUCTED singleton
  walkStubs?: Array<{ id: string }>; // restart side: the panel's lineage view
}): Harness {
  const state = opts.state ?? createInterrogationState("blank-rejection harness");
  if (opts.state === undefined) {
    for (const q of opts.questions) state.upsertQuestion(q);
  }
  const durable = new DurableInputStore({ dir: opts.dir });
  const capture = new InputCaptureStore({
    sink: (record) => {
      durable.write(record);
    },
    seedSeq: (k) => durable.lastSeq(k),
    onRetire: (k) => {
      durable.retire(k, { explicit: true });
    },
  });
  const drafts = new DraftStore();
  const walk = opts.walkStubs ?? opts.walkIds.map((id) => ({ id }));
  const tip = walk[walk.length - 1]?.id ?? "";
  const key = (
    questionId: string,
    field: "writein" | "elaboration" | "note",
  ): CaptureKey => ({ branchId: tip, questionId, field });
  const panel = new InterrogationPanel({
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts,
    inputCapture: capture,
    durableInputs: durable,
    editorFactory: () => typedEditor() as unknown as EditorComponent,
    pi: {
      sessionManager: {
        getBranch: () => walk,
        getSessionId: () => "sess-1",
      },
    } as unknown as InterrogationPanelArgs["pi"],
  });
  return { state, panel, capture, durable, drafts, dir: opts.dir, key };
}

/**
 * Hand-built reconstruction over a scripted branch walk (session-restore
 * case-4 side B's restart pattern): fresh panel host, pi-sessionManager
 * stand-in serving `entries`, SURFACE-002 ui mocks. Origin
 * "session-start" — the real restart contract (never opens a panel).
 */
function reconstructWalk(entries: SessionEntry[]): {
  result: ReturnType<typeof reconstructFromBranch>;
  host: PanelHost;
} {
  const host = createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} });
  const ctx = {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { custom: vi.fn(() => new Promise<null>(() => {})), setWidget: vi.fn() },
  };
  const result = reconstructFromBranch(
    ctx as unknown as Parameters<typeof reconstructFromBranch>[0],
    { config: DEFAULT_CONFIG, host } as ReconstructionOptions,
    "session-start",
  );
  return { result, host };
}

/** Message entry carrying an interrogate tool result with `details.state`. */
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

/** Submission delta (pi.sendMessage shape: `custom_message` + `details`). */
function submissionEntry(details: {
  changed: Array<{
    id: string;
    title: string;
    from: string;
    to: string;
    editedArchived: boolean;
    value?: string;
    custom?: boolean;
  }>;
  epoch: number;
}): SessionEntry {
  return {
    type: "custom_message",
    id: `s${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "interrogation-submission",
    content: "Submitted 1: t1: x",
    display: true,
    details: { ...details, card: { ...details, remainOpen: 0 } },
  } as unknown as SessionEntry;
}

function diff(
  id: string,
  to: string,
  value?: string,
): {
  id: string;
  title: string;
  from: string;
  to: string;
  editedArchived: boolean;
  value?: string;
} {
  return { id, title: id, from: "(unanswered)", to, editedArchived: false, value };
}

/** Non-TUI executor stub (h2.26 fallback) — the record action's live shape. */
function printCtx(): ExecutorContext {
  return { mode: "print", hasUI: false };
}

// ------------------------------------------------------------- case 5 · §1

describe("case 5 · reopen a committed Other/text answer → exact value", () => {
  test("commit through the real writeInEnter seam; reopen seeds the answer byte-exact", () => {
    const dir = tmpDir();
    // Session 1: type a byte-exact PROBE-style write-in on the text
    // question, commit through the REAL writeInEnter seam (handleInput
    // ENTER → applyAnswer + consumeCommittedBuffer → retire at handoff).
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1"), textQ("t1")] });
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein"); // a text question's answer duty IS writein
    typeInto(s1.panel.textField, PROBE);
    expect(s1.panel.handleInput(ENTER)).toBe(true); // writeInEnter COMMITS
    const committed = s1.state.getQuestion("t1")?.answer;
    expect(committed).toEqual({ value: PROBE, custom: true, at: expect.any(String) });
    // The handoff retired the capture — no newer draft exists:
    expect(s1.durable.latest({ branchId: "e1", questionId: "t1", field: "writein" })).toBeUndefined();

    // REOPEN (same process): the commit ADVANCED off t1 (next unanswered —
    // q1); navigate back (the harness's navigation primitive), then the
    // ladder finds no draft → the recorded answer tier seeds byte-exact
    // (spec :149 sentence 1).
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein");
    expect(s1.panel.textField.getText()).toBe(PROBE);
    // A second reopen mutates nothing — no submission, no epoch burn:
    const epochAtReopen = s1.state.epoch;
    s1.panel.focusTextField("writein");
    expect(s1.state.epoch).toBe(epochAtReopen);
    expect(s1.state.getQuestion("t1")?.answer).toEqual(committed);
  });
});

// ------------------------------------------------------------- case 5 · §2

describe("case 5 · rejected blank edit → restart → newer draft wins, prior answer unchanged", () => {
  /**
   * Shared choreography (spec :149 sentence 2): session 1 commits a valid
   * write-in on t1 through the REAL seam; the user reopens, makes the
   * buffer blank-ish, hits ENTER — S1's rejection keeps focus/content and
   * flashes — the blank edit is forceFlushed (completed save) and the
   * process HARD-KILLS. The restart reconstructs from a walk whose base
   * carries the committed answer (original `at` preserved — the mirror
   * landed) plus the original commit's submission delta positioned BEFORE
   * the base (already contained → position-skipped). Reopen then seeds the
   * NEWER blank-ish durable draft over the byte-unchanged prior answer.
   */
  function commitAndKill(dir: string, blankBuffer: (h: Harness) => void): {
    committedAtRestart: { value: string; custom: true; at: string };
    walk: SessionEntry[];
  } {
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1"), textQ("t1")] });
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein");
    typeInto(s1.panel.textField, "committed answer");
    // Completed save of the typing BEFORE the commit (the sanctioned
    // forceFlush seam — capture pacing precedent; a durable value MUST
    // exist so the later blank-ish edit REPLACES it — a deliberate ""
    // never creates a file, durability/input-durability "skipped-empty").
    s1.capture.forceFlush(s1.key("t1", "writein"));
    expect(s1.panel.handleInput(ENTER)).toBe(true); // real writeInEnter commit
    const committed = s1.state.getQuestion("t1")?.answer as {
      value: string;
      custom: true;
      at: string;
    };
    expect(committed.value).toBe("committed answer");

    // Reopen t1 (the commit ADVANCED off it — next unanswered q1): navigate
    // back, then the ladder seeds the answer tier. Make the buffer
    // blank-ish → ENTER.
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein");
    blankBuffer(s1);
    const consumed = s1.panel.handleInput(ENTER);
    // S1's LIVE rejection half — kept focus and explained why (zero trace):
    expect(consumed).toBe(true); // consumed — the enter did its (rejecting) job
    expect(s1.panel.footerFlash?.text).toBe("Answer cannot be blank");
    expect(s1.panel.focus).toBe("text"); // focus KEPT
    expect(s1.panel.textDuty).toBe("writein"); // duty kept
    expect(s1.panel.currentId).toBe("t1"); // NO advance
    expect(s1.state.getQuestion("t1")?.status).toBe("answered"); // no status flip
    expect(s1.state.getQuestion("t1")?.answer).toEqual(committed); // prior answer byte-unchanged
    expect(s1.state.epoch).toBe(1); // rejection burns nothing

    // Completed save of the blank-ish edit BEFORE the kill (the sanctioned
    // forceFlush seam), then HARD KILL: abandon every reference — no
    // dispose, no flush-after, no shutdown handler.
    s1.capture.forceFlush(s1.key("t1", "writein"));
    const saved = s1.durable.latest(s1.key("t1", "writein"));
    expect(saved).toBeDefined();
    // ANSWER-PIN ordering sanity: the blank-ish save is strictly newer than
    // the scripted commit it must beat at the reopen ladder.
    expect((saved?.savedAt ?? "") > T_COMMIT).toBe(true);

    // RESTART walk: the rejected blank NEVER entered history (zero-trace) —
    // the only submission delta is the ORIGINAL valid commit, positioned
    // BEFORE the post-commit mirror base (already contained → the position
    // filter skips it; the replayed answer keeps its byte-original `at`).
    // The base's commit `at` is scripted to a FIXED earlier wall-clock (the
    // prior session's commit time) so the ANSWER-PIN ladder ordering
    // (durable savedAt vs answer at) is deterministic — the harness owns
    // the timeline exactly like session-restore's T0 fixtures.
    const postCommit = s1.state.serialize();
    (postCommit as { questions: Record<string, { answer?: { at: string } }> }).questions.t1.answer!.at = T_COMMIT;
    const committedAtRestart = { value: committed.value, custom: true as const, at: T_COMMIT };
    const walk = [
      {
        type: "message",
        id: "r1",
        parentId: null,
        timestamp: committed.at,
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
      },
      submissionEntry({
        changed: [
          {
            id: "t1",
            title: "t1",
            from: "(unanswered)",
            to: "committed answer",
            editedArchived: false,
            value: "committed answer",
            custom: true,
          },
        ],
        epoch: 1,
      }),
      {
        type: "custom",
        id: "e2",
        parentId: "e1",
        timestamp: T_COMMIT,
        customType: INTERROGATION_STATE_ENTRY_TYPE,
        data: { state: postCommit, epoch: postCommit.epoch, at: T_COMMIT },
      },
    ] as unknown as SessionEntry[];
    return { committedAtRestart, walk };
  }

  function restartAndReopen(
    dir: string,
    walk: SessionEntry[],
    committed: { value: string; custom: true; at: string },
    expectedSeed: string,
  ): void {
    const { result } = reconstructWalk(walk);
    // Replay: the delta is already contained in the base — nothing to
    // replay, so no blank can reach applyAnswer (trivially satisfied here:
    // the walk carries NO blank at all — zero-trace).
    expect(result.replayed).toBe(0);
    const restored = getState()! as InterrogationState;
    // The prior answer is byte-UNCHANGED — original value, marker, and
    // scripted commit-time `at` (no re-mint), status answered, counts OK.
    expect(restored.getQuestion("t1")?.answer).toEqual(committed);
    expect(restored.getQuestion("t1")?.status).toBe("answered");
    expect(restored.groupSummaries()[0].answered).toBe(1);
    expect(restored.groupSummaries()[0].open).toBe(1); // q1 still pending

    // Fresh stores over the SAME disk (the durable blank-ish draft survived
    // the kill); a real panel over the RECONSTRUCTED singleton, lineage =
    // the grown walk (session-restore case-4 side B's panel2 pattern).
    const s2 = makeSession({
      dir,
      walkIds: [],
      questions: [],
      state: restored,
      walkStubs: [{ id: "r1" }, { id: "e1" }, { id: "e2" }],
    });
    s2.panel.currentId = "t1";
    s2.panel.focusTextField("writein"); // the reopen limb — the ladder runs HERE
    // THE NEWER EDIT WINS (spec :149): the durable blank-ish draft beats
    // the recorded answer under recoverySeed's ANSWER-PIN ordering
    // (savedAt strictly newer than the original commit `at`).
    expect(s2.panel.textField.getText()).toBe(expectedSeed);
    // …while the STATE answer stays untouched — the draft is not an answer:
    expect(restored.getQuestion("t1")?.answer).toEqual(committed);
    // A second reopen mutates nothing:
    const epochAtReopen = restored.epoch;
    s2.panel.focusTextField("writein");
    expect(restored.epoch).toBe(epochAtReopen);
  }

  test("whitespace-only edit: rejection keeps focus + flash; restart seeds the whitespace draft", () => {
    const dir = tmpDir();
    const { committedAtRestart, walk } = commitAndKill(dir, (h) => {
      // Clear the seeded answer text by BACKSPACING (a real user clear —
      // the capture-bearing mutation path), then type ONLY whitespace —
      // the "enter only whitespace" limb of spec :149.
      typeInto(h.panel.textField, "\u007f".repeat("committed answer".length));
      typeInto(h.panel.textField, "  ");
      expect(h.panel.textField.getText()).toBe("  ");
    });
    restartAndReopen(dir, walk, committedAtRestart, "  ");
  });

  test("cleared-to-empty edit: rejection keeps focus + flash; restart preserves the EMPTY editor", () => {
    const dir = tmpDir();
    const { committedAtRestart, walk } = commitAndKill(dir, (h) => {
      // The "clear" limb: an intentional deletion to empty IS an edit —
      // backspace down to the empty buffer (the capture-bearing path; a
      // user never clears via setTextInternal). The durable "" (a
      // deliberate deletion, never an absent draft) must preserve the
      // empty editor at reopen (spec :140/:149).
      typeInto(h.panel.textField, "\u007f".repeat("committed answer".length));
      expect(h.panel.textField.getText()).toBe("");
    });
    restartAndReopen(dir, walk, committedAtRestart, "");
  });
});

// ------------------------------------------------------------- case 5 · §3

describe("case 5 · blank rejection through non-editor ingress (fallback + tool line)", () => {
  test("recordAnswers rejects the blank overwrite; the tool renders 'blank value not recorded'", () => {
    // REAL fallback recordAnswers on a fresh state — a valid answer first.
    const st = createInterrogationState("case-5 ingress");
    setState(st); // the tool reads the singleton (getState)
    st.upsertQuestion(textQ("t1"));
    const first = recordAnswers(st, [{ id: "t1", value: "postgres via fallback" }]);
    expect(first.recorded).toEqual(["t1"]);
    expect(first.rejected).toEqual([]);
    expect(st.getQuestion("t1")?.answer?.value).toBe("postgres via fallback");
    expect(st.epoch).toBe(2); // one call = one submission: one bump

    // Blank overwrite through the REAL tool seam (non-TUI record): the
    // rejected bucket renders the S1 status line, stays a SUCCESS, burns
    // NO epoch, and preserves the prior answer.
    const epochBefore = st.epoch;
    const r = executeInterrogate(
      { epoch: epochBefore, answers: [{ id: "t1", value: "   " }] },
      printCtx(),
    );
    const lines = r.content.split("\n");
    expect(lines[0]).toBe(`1/1 answered · 0 re-asked · 0 moot · epoch ${epochBefore}`); // NOT burned
    expect(lines[1]).toBe("blank value not recorded: t1"); // the S1 line, exact
    expect(lines[2]).toBe("no answers recorded"); // nothing was recorded
    expect(lines).toHaveLength(3);
    expect(r.details.action).toBe("record");
    expect(r.details.epoch).toBe(epochBefore);
    expect(st.getQuestion("t1")?.answer?.value).toBe("postgres via fallback"); // prior preserved

    // And the raw fallback bucket on a pure-blank call (same rejection, no
    // line rendering): prior answer preserved, no epoch burn.
    const second = recordAnswers(st, [{ id: "t1", value: "" }]);
    expect(second.rejected).toEqual(["t1"]);
    expect(second.recorded).toEqual([]);
    expect(st.getQuestion("t1")?.answer?.value).toBe("postgres via fallback");
    expect(st.epoch).toBe(epochBefore);
  });
});

// ------------------------------------------------------------- case 5 · §4

describe("case 5 · replay a legacy blank WITHOUT a prior valid answer", () => {
  test("whitespace delta on an unanswered question: no throw, no answer, no count, no epoch burn", () => {
    // Acceptance grain of the crash-fix pin: before the :466 widening, this
    // exact walk THREW inside replaySubmission (S1's applyAnswer blank
    // reject) and broke reconstruction. The reconstructed question stays
    // unanswered — never answered from `to`, never counted.
    const base = createInterrogationState("case-5 replay");
    base.upsertQuestion(textQ("t1"));
    const entries = [
      toolResultEntry(base.serialize()),
      submissionEntry({ changed: [diff("t1", "Whatever the summary says", "  ")], epoch: 2 }),
    ];
    const { result } = reconstructWalk(entries);
    const state = getState()!;
    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(0); // the blank earns no replayed credit
    expect(state.getQuestion("t1")?.answer).toBeUndefined(); // NOT fabricated from `to`
    expect(state.getQuestion("t1")?.status).toBe("open");
    expect(state.epoch).toBe(base.epoch); // nothing applied → nothing bumped (h3.6)
    expect(state.groupSummaries()[0].answered).toBe(0);
    expect(state.groupSummaries()[0].submitted).toBe(0);
    expect(state.groupSummaries()[0].open).toBe(1);
  });
});

// ------------------------------------------------------------- case 5 · §5

describe("case 5 · replay a legacy blank WITH a prior valid answer", () => {
  test("valid commit then blank delta: the prior valid answer wins; counts stay answered=1", () => {
    // Chronological replay is structural prior-valid-wins: the blank entry
    // applies nothing, so the first submission's answer stands — one
    // replayed credit, one epoch bump (the blank's), zero otherwise.
    const base = createInterrogationState("case-5 replay");
    base.upsertQuestion(textQ("t1"));
    const entries = [
      toolResultEntry(base.serialize()),
      submissionEntry({ changed: [diff("t1", "alpha", "alpha")], epoch: 2 }),
      submissionEntry({ changed: [diff("t1", "alpha", "\n\t ")], epoch: 3 }),
    ];
    const { result } = reconstructWalk(entries);
    const state = getState()!;
    expect(result.replayed).toBe(1); // only the valid submission counts
    expect(state.getQuestion("t1")?.answer?.value).toBe("alpha");
    expect(state.getQuestion("t1")?.status).toBe("answered");
    expect(state.epoch).toBe(base.epoch + 1); // ONE bump — from the valid one only
    expect(state.groupSummaries()[0].answered).toBe(1);
    expect(state.groupSummaries()[0].submitted).toBe(0);
  });
});

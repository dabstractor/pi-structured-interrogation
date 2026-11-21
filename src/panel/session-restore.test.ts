/**
 * src/panel/session-restore.test.ts — P3.M3.T1.S2 scripted acceptance:
 * state-and-persistence.md case 1 (:145 — type in the real editors →
 * completed save → HARD KILL → fresh stores + same-branch walk → reopen →
 * EXACT draft, byte-for-byte, no answer recorded, nothing sent) and the
 * commit-half of case 4 (:148 — both sides of the save/commit handoff),
 * plus the restore invariants (SURFACE-002, cross-branch silence,
 * composer never clobbers live typing, /clear never re-seeds).
 *
 * Harness: the retirement-sidechat.test.ts pattern — a DIRECT-constructed
 * real panel over the index.ts-shaped input-recovery composition
 * (InputCaptureStore with sink → durable write, seedSeq → durable
 * lastSeq, onRetire → durable retire over a tmpdir) and a fake
 * sessionManager on `pi` (the panel's live branchReader) with CONTROLLED
 * entry-id walks. Typing goes through the REAL editor mutation path
 * (editor.handleInput → onChange → TextField fireCapture → setKeyDirty)
 * so every capture minted in these tests is the shipped capture.
 *
 * REAL timers throughout; capture pacing uses forceFlush — the sanctioned
 * completed-save seam (the write must already be on disk BEFORE the
 * kill). THE CRASH MODEL: abandoned references — NO dispose, NO
 * forceFlush-after, NO shutdown handler on the killed side. The restart
 * side is a fresh DurableInputStore over the SAME tmpdir + a fresh panel
 * over a GROWN walk ([e1] → [e1, e2]) — the ancestry restore rule.
 *
 * SURFACE-002: nothing in these restore flows opens or focuses a panel —
 * assertions pin the host closed and the engine untouched.
 */
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG } from "../config.js";
import { DraftStore } from "../draft-store.js";
import { InputCaptureStore, type CaptureKey } from "../input-capture.js";
import { DurableInputStore } from "../input-durability.js";
import { restoreSessionNote } from "../input-restore.js";
import { createReconstruction, reconstructFromBranch, type ReconstructionOptions } from "../reconstruct.js";
import {
  createInterrogationState,
  getState,
  resetState,
  type InterrogationState,
  type Question,
} from "../state.js";
import { createPanelHost, type SidechatEngine } from "./panel.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel.js";
import { resetSidechatForTests, type SidechatRebindDeps } from "./sidechat.js";

const CHAT_KEY = "c"; // DEFAULT_CONFIG.keys.chat
const ENTER = "\r";
const T0 = "2025-01-01T00:00:00.000Z";

/** The byte-exact probe: multiline + Unicode + irregular whitespace. */
const PROBE = "Half-typed ✍ réponsé\n  with  double spaces\tand ünïcode ☃ — keep  ";

// ------------------------------------------------------------------ fixtures

/** Fresh temp dir per test, removed in afterEach (retirement-sidechat fixture). */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  resetSidechatForTests(); // the singleton is module memory — never leak
});
beforeEach(() => {
  resetSidechatForTests();
  resetState(); // the reconstruction singleton — isolate per test
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-interrogator-session-restore-"));
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
 * The typed editor: handleInput APPENDS the raw bytes and fires onChange —
 * the exact production mutation chain TextField wraps (wrap-and-chain at
 * construction: onInvalidate + fireCapture). setText fires onChange too
 * (the stock Editor's setTextInternal behavior the suppression flag
 * exists for). No getExpandedText — plain getText.
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
      if (data === "\r" || data === "\u001b") return; // enter/esc never mutate buffer text
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
  key: (questionId: string, field: "writein" | "elaboration" | "note" | "sidechat-composer") => CaptureKey;
}

/**
 * One "process": fresh stores over `dir`, a fresh state, and a real panel
 * whose branchReader serves `walkIds` (oldest → newest). The capture
 * wiring is the index.ts shape exactly. `extra` rides InterrogationPanelArgs
 * (chatRebindDeps / sidechatEngine for the composer limb).
 */
function makeSession(opts: {
  dir: string;
  walkIds: string[];
  questions: Question[];
  answers?: Array<{ id: string; value: string }>;
  extra?: Partial<InterrogationPanelArgs>;
  drafts?: DraftStore;
}): Harness {
  const state = createInterrogationState("session-restore harness");
  for (const q of opts.questions) state.upsertQuestion(q);
  for (const a of opts.answers ?? []) state.applyAnswer(a.id, { value: a.value, at: T0 });

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
  const drafts = opts.drafts ?? new DraftStore();
  const tip = opts.walkIds[opts.walkIds.length - 1] ?? "";
  const key = (
    questionId: string,
    field: "writein" | "elaboration" | "note" | "sidechat-composer",
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
        getBranch: () => opts.walkIds.map((id) => ({ id })),
        getSessionId: () => "sess-1",
      },
    } as unknown as InterrogationPanelArgs["pi"],
    ...opts.extra,
  });
  return {
    state,
    panel,
    capture,
    durable,
    drafts,
    dir: opts.dir,
    key,
  };
}

const rebindDeps: SidechatRebindDeps = {
  resolveModelSnapshot: () => ({ provider: "prov", modelId: "mdl-1" }),
  buildSystemPrompt: () => "SYS",
  buildBranchSnapshot: () => [] as never,
};

/** Inert engine double — sendTurn MUST stay at 0 calls in every restore flow. */
function inertEngine(): SidechatEngine & { sendTurn: Mock; abort: Mock } {
  return {
    sendTurn: vi.fn(() => false),
    abort: vi.fn(() => false),
  } as unknown as SidechatEngine & { sendTurn: Mock; abort: Mock };
}

function openChat(panel: InterrogationPanel): void {
  panel.currentId = "q1";
  expect(panel.handleInput(CHAT_KEY)).toBe(true);
  expect(panel.view).toBe("chat");
}

// ---------------------------------------------------------------- case 1

describe("acceptance case 1 — hard-kill draft restore, all five limbs", () => {
  test("limb ✎ Other (writein on a choice question): byte-exact, no answer, no send", () => {
    const dir = tmpDir();
    const walk1 = ["e1"];
    const s1 = makeSession({ dir, walkIds: walk1, questions: [choiceQ("q1"), textQ("t1")] });
    s1.panel.currentId = "q1";
    s1.panel.focusTextField("writein"); // the ✎ Other row / ctrl+t entry
    typeInto(s1.panel.textField, PROBE);
    s1.capture.forceFlush(s1.key("q1", "writein"));
    // COMPLETED SAVE, on disk before the kill:
    expect(s1.durable.latest(s1.key("q1", "writein"))).toEqual({
      text: PROBE,
      seq: 1,
      savedAt: expect.any(String),
    });

    // HARD KILL: abandon every reference — no dispose, no flush, no shutdown.
    // RESTART: fresh stores over the same disk, fresh state (reconstruction's
    // product), same branch with a GROWN tip.
    const s2 = makeSession({ dir, walkIds: ["e1", "e2"], questions: [choiceQ("q1"), textQ("t1")] });
    s2.panel.currentId = "q1";
    s2.panel.focusTextField("writein"); // the reopen limb — ladder runs HERE
    expect(s2.panel.textField.getText()).toBe(PROBE); // byte-for-byte
    // Nothing was answered, nothing sent:
    expect(s2.state.getQuestion("q1")?.answer).toBeUndefined();
    expect(s2.state.getQuestion("q1")?.status).toBe("open");
    expect(s2.state.epoch).toBe(1); // no submission bumped the epoch
  });

  test("limb text question (desiredTextDuty): byte-exact restore", () => {
    const dir = tmpDir();
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1"), textQ("t1")] });
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein"); // a text question's answer duty IS writein
    typeInto(s1.panel.textField, PROBE);
    s1.capture.forceFlush(s1.key("t1", "writein"));
    expect(s1.durable.latest(s1.key("t1", "writein"))?.text).toBe(PROBE);

    // kill → restart
    const s2 = makeSession({ dir, walkIds: ["e1", "e2"], questions: [choiceQ("q1"), textQ("t1")] });
    s2.panel.currentId = "t1";
    s2.panel.focusTextField("writein");
    expect(s2.panel.textField.getText()).toBe(PROBE);
    expect(s2.state.getQuestion("t1")?.answer).toBeUndefined();
  });

  test("limb elaboration (option-answered question): byte-exact restore", () => {
    const dir = tmpDir();
    const s1 = makeSession({
      dir,
      walkIds: ["e1"],
      questions: [choiceQ("q1")],
      answers: [{ id: "q1", value: "a" }], // option-committed
    });
    s1.panel.currentId = "q1";
    s1.panel.focusTextField("elaboration"); // ctrl+t rationale duty
    typeInto(s1.panel.textField, PROBE);
    s1.capture.forceFlush(s1.key("q1", "elaboration"));
    expect(s1.durable.latest(s1.key("q1", "elaboration"))?.text).toBe(PROBE);

    // kill → restart (answer replays with the base)
    const s2 = makeSession({
      dir,
      walkIds: ["e1", "e2"],
      questions: [choiceQ("q1")],
      answers: [{ id: "q1", value: "a" }],
    });
    s2.panel.currentId = "q1";
    s2.panel.focusTextField("elaboration");
    // The elaboration duty has NO answer tier — the durable draft wins whole.
    expect(s2.panel.textField.getText()).toBe(PROBE);
    expect(s2.state.getQuestion("q1")?.answer?.value).toBe("a"); // answer untouched
  });

  test("limb batch note: staged at session start through restoreSessionNote, found by enterNoteMode", () => {
    const dir = tmpDir();
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1")] });
    s1.panel.enterNoteMode(); // bufferOwner "note" — the note capture key
    typeInto(s1.panel.textField, PROBE);
    s1.capture.forceFlush(s1.key("-", "note")); // the note capture key carries questionId "-"
    expect(s1.durable.latest(s1.key("-", "note"))?.text).toBe(PROBE);

    // kill → restart: the session_start hook's EXACT call
    // (index.ts restoreDrafts → restoreSessionNote) over fresh stores.
    const drafts2 = new DraftStore(); // post-restart seam is empty
    const durable2 = new DurableInputStore({ dir });
    expect(restoreSessionNote(durable2, drafts2, ["e1", "e2"])).toBe(true);
    expect(drafts2.getNote()).toBe(PROBE);
    // enterNoteMode's existing seed (`drafts?.getNote() || batchNote || ""`)
    // finds the staged note — no panel change for the note limb:
    const s2 = makeSession({ dir, walkIds: ["e1", "e2"], questions: [choiceQ("q1")], drafts: drafts2 });
    s2.panel.enterNoteMode();
    expect(s2.panel.textField.getText()).toBe(PROBE); // byte-for-byte
    expect(s2.state.epoch).toBe(1);
  });

  test("limb side-chat composer: cold-create seed, conversation NEVER restores, ZERO sends", () => {
    const dir = tmpDir();
    const engine1 = inertEngine();
    const s1 = makeSession({
      dir,
      walkIds: ["e1"],
      questions: [choiceQ("q1")],
      extra: { chatRebindDeps: rebindDeps, sidechatEngine: engine1 },
    });
    openChat(s1.panel); // cold create #1 — durable empty, nothing seeded
    expect(s1.panel.chatField.getText()).toBe("");
    typeInto(s1.panel.chatField, PROBE); // real composer typing path
    s1.capture.forceFlush(s1.key("q1", "sidechat-composer"));
    expect(s1.durable.latest(s1.key("q1", "sidechat-composer"))?.text).toBe(PROBE);
    expect(engine1.sendTurn).not.toHaveBeenCalled();

    // HARD KILL: the sidechat record singleton is PROCESS memory — the fresh
    // process starts with none (this reset IS the restart for the record).
    resetSidechatForTests();

    // kill → restart → the user presses `c` again: onChat COLD-CREATES (the
    // fresh process has no record) and the composer seeds silently. The
    // conversation is dead (SIDECHAT-002) — only the saved INPUT returns.
    const engine2 = inertEngine();
    const s2 = makeSession({
      dir,
      walkIds: ["e1", "e2"],
      questions: [choiceQ("q1")],
      extra: { chatRebindDeps: rebindDeps, sidechatEngine: engine2 },
    });
    openChat(s2.panel);
    expect(s2.panel.chatField.getText()).toBe(PROBE); // byte-for-byte
    expect(engine2.sendTurn).not.toHaveBeenCalled(); // NOTHING was sent
    expect(s2.state.getQuestion("q1")?.answer).toBeUndefined();
    expect(s2.state.epoch).toBe(1);
  });
});

// --------------------------------------------- case 4 — commit-half, both sides

describe("acceptance case 4-commit-half — both sides of the save/commit handoff", () => {
  test("side A — kill AFTER the save, BEFORE the commit: draft recoverable, no answer", () => {
    const dir = tmpDir();
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1"), textQ("t1")] });
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein");
    typeInto(s1.panel.textField, "nonblank write-in"); // saved…
    s1.capture.forceFlush(s1.key("t1", "writein"));
    expect(s1.durable.latest(s1.key("t1", "writein"))?.text).toBe("nonblank write-in");
    // …and killed BEFORE the commit seam: no ENTER was ever processed.

    // restart: fresh stores, no submission delta in the walk, no answer.
    const engine = inertEngine();
    const s2 = makeSession({
      dir,
      walkIds: ["e1", "e2"],
      questions: [choiceQ("q1"), textQ("t1")],
      extra: { chatRebindDeps: rebindDeps, sidechatEngine: engine },
    });
    s2.panel.currentId = "t1";
    s2.panel.focusTextField("writein");
    expect(s2.panel.textField.getText()).toBe("nonblank write-in"); // exact DRAFT
    expect(s2.state.getQuestion("t1")?.answer).toBeUndefined(); // NOT an answer
    expect(s2.state.getQuestion("t1")?.status).toBe("open");
    expect(s2.state.epoch).toBe(1); // no commit replayed, no submission fired
    expect(engine.sendTurn).not.toHaveBeenCalled();
  });

  test("side B — commit recorded + capture retired: restart seeds the ANSWER, no resurrection", () => {
    const dir = tmpDir();
    // Session 1: type, then commit through the REAL writeInEnter seam
    // (applyAnswer + consumeCommittedBuffer → retire at the handoff).
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1"), textQ("t1")] });
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein");
    typeInto(s1.panel.textField, "committed answer");
    expect(s1.panel.handleInput(ENTER)).toBe(true); // writeInEnter COMMITS
    expect(s1.state.getQuestion("t1")?.answer).toEqual({
      value: "committed answer",
      custom: true,
      at: expect.any(String),
    });
    // The handoff retired the capture — the durable file is gone:
    expect(s1.durable.latest({ branchId: "e1", questionId: "t1", field: "writein" })).toBeUndefined();

    // The user's ctrl+s shipped the submission — its delta is IN the restart
    // walk (the scripted equivalent of the real sendMessage custom_message).
    const base = s1.state.serialize();
    const restartEntries = [
      {
        type: "message",
        id: "r1",
        parentId: null,
        timestamp: T0,
        message: {
          role: "user",
          content: [{ type: "text", text: "hi" }],
          timestamp: Date.now(),
        },
      },
      {
        type: "message",
        id: "e1",
        parentId: "r1",
        timestamp: T0,
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "interrogate",
          content: [{ type: "text", text: "ok" }],
          details: { state: base },
          isError: false,
          timestamp: Date.now(),
        },
      },
      {
        type: "custom_message",
        id: "e2",
        parentId: "e1",
        timestamp: T0,
        customType: "interrogation-submission",
        content: "Submitted 1: t1: committed answer",
        display: true,
        details: {
          changed: [
            {
              id: "t1",
              title: "t1",
              from: "(unanswered)",
              to: "committed answer",
              editedArchived: false,
              custom: true,
            },
          ],
          epoch: 1,
          card: { changed: [], remainOpen: 1 },
        },
      },
    ] as unknown as Parameters<typeof reconstructFromBranch>[0] extends never ? never : object[];

    // RESTART: reconstruction replays the commit read-only, exactly once.
    const host = createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} });
    const ctx = {
      mode: "tui",
      hasUI: true,
      sessionManager: { getBranch: () => restartEntries },
      ui: { custom: vi.fn(() => new Promise<null>(() => {})), setWidget: vi.fn() },
    };
    const result = reconstructFromBranch(
      ctx as unknown as Parameters<typeof reconstructFromBranch>[0],
      { config: DEFAULT_CONFIG, host } as ReconstructionOptions,
      "session-start",
    );
    expect(result.replayed).toBe(1); // exactly once
    const restored = getState();
    expect(restored?.getQuestion("t1")?.answer?.value).toBe("committed answer");
    expect(restored?.getQuestion("t1")?.answer?.custom).toBe(true);
    const replayAt = restored?.getQuestion("t1")?.answer?.at ?? "";
    expect(replayAt > T0).toBe(true); // `answer.at` minted FRESH at replay

    // Fresh stores: retire unlinked the file, and no tombstone resurrection.
    const durable2 = new DurableInputStore({ dir });
    expect(durable2.latest({ branchId: "e1", questionId: "t1", field: "writein" })).toBeUndefined();

    // Reopen the ✎ Other editor: the ladder seeds the ANSWER byte-exact —
    // no draft resurrection (there is no draft), no repeat commit.
    const engine = inertEngine();
    // Use the RECONSTRUCTED singleton state (the restart's real state object):
    const panel2 = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state: restored as InterrogationState,
      config: DEFAULT_CONFIG,
      drafts: new DraftStore(),
      inputCapture: new InputCaptureStore({
        sink: () => {},
        seedSeq: () => 0,
        onRetire: () => {},
      }),
      durableInputs: durable2,
      editorFactory: () => typedEditor() as unknown as EditorComponent,
      pi: {
        sessionManager: {
          getBranch: () => [{ id: "e1" }, { id: "e2" }],
          getSessionId: () => "sess-2",
        },
      } as unknown as InterrogationPanelArgs["pi"],
      chatRebindDeps: rebindDeps,
      sidechatEngine: engine,
    });
    panel2.currentId = "t1";
    panel2.focusTextField("writein");
    expect(panel2.textField.getText()).toBe("committed answer"); // answer tier, byte-exact
    const epochAtReopen = restored?.epoch ?? -1;
    panel2.focusTextField("writein"); // a second reopen mutates nothing
    expect(restored?.epoch).toBe(epochAtReopen); // epoch stable — NO submission
    expect(engine.sendTurn).not.toHaveBeenCalled(); // restore/reopen never sends
    expect(durable2.latest({ branchId: "e1", questionId: "t1", field: "writein" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------- invariants

describe("restore invariants — SURFACE-002, cross-branch, live-typing, /clear", () => {
  test("SURFACE-002: the composed restart wiring never opens a panel — widget line only", () => {
    const dir = tmpDir();
    // The killed session left a durable note behind:
    const durable = new DurableInputStore({ dir });
    expect(
      durable.write({ session: "sess-1", branchId: "e1", questionId: "-", field: "note", text: "note draft", seq: 1 }),
    ).toBe("written");

    const drafts = new DraftStore();
    const host = createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} });
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
    const mockPi = {
      on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };
    // The restart walk: a user turn (id e1 — the killed session's capture
    // tip) followed by an interrogate tool result CARRYING STATE (id e2 —
    // the durable base the fresh process reconstructs from).
    const base = createInterrogationState("session-restore harness");
    base.upsertQuestion(choiceQ("q1"));
    const custom = vi.fn(() => new Promise<null>(() => {}));
    const setWidget = vi.fn();
    const ctx = {
      mode: "tui",
      hasUI: true,
      sessionManager: {
        getBranch: () => [
          { id: "e1", type: "message", message: { role: "user", content: [] } },
          {
            id: "e2",
            type: "message",
            parentId: "e1",
            message: {
              role: "toolResult",
              toolCallId: "tc1",
              toolName: "interrogate",
              content: [{ type: "text", text: "ok" }],
              details: { state: base.serialize() },
              isError: false,
            },
          },
        ],
      },
      ui: { custom, setWidget },
    };
    // The index.ts wiring shape EXACTLY:
    createReconstruction(mockPi as never, {
      config: DEFAULT_CONFIG,
      host,
      drafts,
      restoreDrafts: (walkIds) => {
        restoreSessionNote(durable, drafts, walkIds);
      },
    } as ReconstructionOptions);
    for (const h of handlers.get("session_start") ?? []) h({ type: "session_start" }, ctx);

    // State installed, note staged SILENTLY — and NO surface appeared:
    expect(getState()).toBeDefined();
    expect(drafts.getNote()).toBe("note draft"); // the hook ran
    expect(host.isOpen()).toBe(false);
    expect(host.isSuspended()).toBe(false);
    expect(custom).not.toHaveBeenCalled(); // no panel host was ever constructed
    const widgetCall = setWidget.mock.calls.at(-1);
    expect(widgetCall?.[0]).toBe("interrogator"); // the widget line is the ONLY cue
  });

  test("cross-branch: a capture tip NOT in the walk restores NOTHING on any duty", () => {
    const dir = tmpDir();
    const s1 = makeSession({ dir, walkIds: ["e1"], questions: [choiceQ("q1"), textQ("t1")] });
    // Leave durable values for writein + note + composer at tip e1:
    s1.panel.currentId = "t1";
    s1.panel.focusTextField("writein");
    typeInto(s1.panel.textField, "sibling draft");
    s1.capture.forceFlush(s1.key("t1", "writein"));
    expect(
      durableHas(dir, { branchId: "e1", questionId: "t1", field: "writein" }),
    ).toBe(true);

    // RESTART ON A DIFFERENT BRANCH: the walk does NOT contain e1.
    const drafts2 = new DraftStore();
    const durable2 = new DurableInputStore({ dir });
    expect(restoreSessionNote(durable2, drafts2, ["x1", "x2"])).toBe(false);
    expect(drafts2.getNote()).toBe("");

    const s2 = makeSession({
      dir,
      walkIds: ["x1", "x2"],
      questions: [choiceQ("q1"), textQ("t1")],
      drafts: drafts2,
      extra: { chatRebindDeps: rebindDeps, sidechatEngine: inertEngine() },
    });
    s2.panel.currentId = "t1";
    // Chat FIRST (fresh panel: options focus — the chord routes from there):
    openChat(s2.panel);
    expect(s2.panel.chatField.getText()).toBe(""); // composer: nothing seeded
    s2.panel.focusTextField("writein");
    expect(s2.panel.textField.getText()).toBe(""); // writein: nothing
    s2.panel.enterNoteMode();
    expect(s2.panel.textField.getText()).toBe(""); // note: nothing staged
  });

  test("composer NEVER clobbers nonempty live text on a cold create (NEW-003)", () => {
    const dir = tmpDir();
    // A durable composer value exists on-walk (written directly — the killed
    // session's completed save):
    const durable = new DurableInputStore({ dir });
    durable.write({
      session: "sess-1",
      branchId: "e1",
      questionId: "q1",
      field: "sidechat-composer",
      text: "saved prompt",
      seq: 1,
    });
    const s2 = makeSession({
      dir,
      walkIds: ["e1", "e2"],
      questions: [choiceQ("q1")],
      extra: { chatRebindDeps: rebindDeps, sidechatEngine: inertEngine() },
    });
    // The user is MID-SENTENCE when the cold create happens:
    s2.panel.chatField.setText("live typing");
    openChat(s2.panel);
    expect(s2.panel.chatField.getText()).toBe("live typing"); // untouched
  });

  test("/clear (resetChat) does NOT re-seed — the fresh-start gesture", () => {
    const dir = tmpDir();
    const durable = new DurableInputStore({ dir });
    durable.write({
      session: "sess-1",
      branchId: "e1",
      questionId: "q1",
      field: "sidechat-composer",
      text: "saved prompt",
      seq: 1,
    });
    const engine = inertEngine();
    const s2 = makeSession({
      dir,
      walkIds: ["e1", "e2"],
      questions: [choiceQ("q1")],
      extra: { chatRebindDeps: rebindDeps, sidechatEngine: engine },
    });
    openChat(s2.panel);
    expect(s2.panel.chatField.getText()).toBe("saved prompt"); // cold-create seed

    // /clear: resetChat replaces the record wholesale + clears the input.
    // (The user clears the seeded buffer first — a deliberate empty edit;
    // setText is capture-suppressed so it mints nothing.)
    s2.panel.chatField.setText("");
    typeInto(s2.panel.chatField, "/clear");
    expect(s2.panel.handleInput(ENTER)).toBe(true);
    expect(s2.panel.chatField.getText()).toBe("");
    // Re-pressing the chat key from OUTSIDE chat focus (blur first — the
    // router only opens a chat from non-chat focus): the record MATCHES the
    // question — NOT a cold create — so the seed does not run again. The
    // user's fresh start holds.
    s2.panel.blurChatInput();
    expect(s2.panel.handleInput(CHAT_KEY)).toBe(true);
    expect(s2.panel.chatField.getText()).toBe("");
    expect(engine.sendTurn).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ helpers

/** Direct-disk existence probe (fresh-store-independent completed-save check). */
function durableHas(dir: string, key: CaptureKey): boolean {
  const probe = new DurableInputStore({ dir });
  return probe.latest(key) !== undefined;
}

// The reconstructFromBranch import is exercised only through side B's
// replay above; keep the type import honest for lint.
export type { ReconstructionOptions };

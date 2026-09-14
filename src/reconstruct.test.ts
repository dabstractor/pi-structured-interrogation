/**
 * src/reconstruct.test.ts — reconstruction tests (P1.M7.T1.S2; h2.41
 * algorithm). Fake `ctx` objects carry hand-built SessionEntry arrays
 * (shapes verified against pi's session-manager.d.ts: interrogate tool
 * results land as `message` entries with `details.state`, the S1 mirror as
 * `custom` entries with `data`, submissions as `custom_message` entries
 * with `details` — pi.sendMessage → appendCustomMessageEntry). The panel
 * path is exercised for REAL: createPanelHost + openPanel against a mock
 * PiUISurface (panel.test.ts pattern, factory never invoked), so "panel
 * opened" is asserted via `ui.custom` calls and the live host phase.
 */
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { createPanelHost, openPanel, suspendPanel, type PanelHost } from "./panel/panel.js";
import { DraftStore } from "./draft-store.js";
import {
  INTERROGATION_STATE_ENTRY_TYPE,
  type InterrogationStateEntryData,
} from "./persistence.js";
import {
  createReconstruction,
  isFallbackActive,
  reconstructFromBranch,
  setFallbackActive,
  type ReconstructionContext,
  type ReconstructionOptions,
} from "./reconstruct.js";
import {
  applyUpsert,
  markAnswered,
} from "./merge.js";
import {
  createInterrogationState,
  getState,
  resetState,
  setState,
  type InterrogationState,
  type Question,
} from "./state.js";

// ------------------------------------------------------------------ fixtures

const OPTS_AB = [
  { value: "sqlite", label: "SQLite" },
  { value: "postgres", label: "Postgres" },
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

/** Real state built through the merge-rule primitives, then serialized. */
function seededState(build: (s: InterrogationState) => void): ReturnType<InterrogationState["serialize"]> {
  const s = createInterrogationState("test goal");
  build(s);
  return s.serialize();
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

/** A non-interrogate message entry (noise for the walker). */
function userEntry(): SessionEntry {
  return {
    type: "message",
    id: `u${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
  } as unknown as SessionEntry;
}

/** S1 mirror entry (pi.appendEntry shape: `custom` + `data`). */
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

/** Submission delta (pi.sendMessage shape: `custom_message` + `details`). */
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
    content: "Submitted 1: q1: x",
    display: true,
    details: { ...details, card: { ...details, remainOpen: 0 } },
  } as unknown as SessionEntry;
}

function diff(id: string, to: string): { id: string; title: string; from: string; to: string; editedArchived: boolean } {
  return { id, title: id, from: "(unanswered)", to, editedArchived: false };
}

// ------------------------------------------------------------------ mock ctx

type Handler = (event: unknown, ctx: unknown) => void;

function makeCtx(entries: SessionEntry[], mode = "tui"): ReconstructionContext & { ui: { custom: Mock } } {
  // Never-resolving promise: phase flips to "open", nothing resolves later.
  const custom = vi.fn(() => new Promise<null>(() => {}));
  return {
    mode,
    hasUI: mode === "tui",
    sessionManager: { getBranch: () => entries },
    ui: { custom },
  } as unknown as ReconstructionContext & { ui: { custom: Mock } };
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

// -------------------------------------------------------------------- tests

describe("reconstructFromBranch — base selection", () => {
  test("tool-result base beats everything; deltas after it replay (a)", () => {
    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
      applyUpsert(s, [choiceQ("q2", { dependsOn: [{ id: "q1", equals: "sqlite" }] })]);
      markAnswered(s, "q1", { value: "sqlite", at: "t0" });
    });
    const ctx = makeCtx([
      userEntry(),
      toolResultEntry(base),
      submissionEntry({ changed: [diff("q1", "postgres")], epoch: 1 }),
      submissionEntry({ changed: [diff("q1", "sqlite")], epoch: 2 }),
    ]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(2);
    const state = getState();
    expect(state).toBeDefined();
    expect(state?.getQuestion("q1")?.answer?.value).toBe("sqlite");
    // One epoch bump per replayed submission (h3.6).
    expect(state?.epoch).toBe(base.epoch + 2);
    // Moot recompute ran post-replay: q2's dependency (sqlite) is met again,
    // but it started open; flip it visibly by checking it is NOT moot, and
    // with an unmet dependency below in the dedicated test.
    expect(state?.getQuestion("q2")?.status).not.toBe("moot");
    // TUI + non-empty → existing panel path opened.
    expect(result.opened).toBe(true);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(isFallbackActive()).toBe(false);
  });

  test("evaluateDependsOn recomputes moot-ness AFTER replay (a)", () => {
    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
      applyUpsert(s, [choiceQ("q2", { dependsOn: [{ id: "q1", equals: "postgres" }] })]);
      markAnswered(s, "q1", { value: "postgres", at: "t0" });
    });
    const ctx = makeCtx([
      toolResultEntry(base),
      submissionEntry({ changed: [diff("q1", "sqlite")], epoch: 1 }),
    ]);
    reconstructFromBranch(ctx, makeOpts(makeHost()));
    // q2's dependsOn is unmet after the replayed flip → moot with h2.29 reason.
    expect(getState()?.getQuestion("q2")?.status).toBe("moot");
  });

  test("tool result AFTER submissions is the base → zero replay (b)", () => {
    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
      markAnswered(s, "q1", { value: "postgres", at: "t-late" });
    });
    const ctx = makeCtx([
      submissionEntry({ changed: [diff("q1", "sqlite")], epoch: 1 }),
      toolResultEntry(base),
    ]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(0);
    const state = getState();
    expect(state?.epoch).toBe(base.epoch); // untouched by the earlier delta
    expect(state?.getQuestion("q1")?.answer?.at).toBe("t-late");
  });

  test("no tool result → newest mirror entry wins (c)", () => {
    const old = seededState((s) => {
      applyUpsert(s, [choiceQ("old-q")]);
    });
    const newest = seededState((s) => {
      applyUpsert(s, [choiceQ("new-q")]);
      markAnswered(s, "new-q", { value: "sqlite", at: "t-new" });
    });
    const ctx = makeCtx([
      mirrorEntry({ state: old, epoch: old.epoch, at: "2025-06-01T12:00:01.000Z" }),
      mirrorEntry({ state: newest, epoch: newest.epoch, at: "2025-06-01T12:00:02.000Z" }),
    ]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("mirror-entry");
    expect(result.replayed).toBe(0);
    expect(getState()?.getQuestion("new-q")?.answer?.value).toBe("sqlite");
    expect(getState()?.getQuestion("old-q")).toBeUndefined();
    expect(result.opened).toBe(true); // TUI + non-empty
  });

  test("mirror submissions replay only at/above the base epoch", () => {
    const mirrored = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
    }); // epoch 1
    const ctx = makeCtx([
      submissionEntry({ changed: [diff("q1", "postgres")], epoch: 0 }), // older → in mirror already
      mirrorEntry({ state: mirrored, epoch: mirrored.epoch, at: "2025-06-01T12:00:02.000Z" }),
      submissionEntry({ changed: [diff("q1", "postgres")], epoch: 1 }), // == base → NOT in mirror
    ]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("mirror-entry");
    expect(result.replayed).toBe(1);
    expect(getState()?.getQuestion("q1")?.answer?.value).toBe("postgres");
    expect(getState()?.epoch).toBe(mirrored.epoch + 1);
  });

  test("empty/foreign branch → no state, no panel, no flag; prior state dropped (d)", () => {
    setState(createInterrogationState("stale-from-previous-branch"));
    setFallbackActive(true); // stale flag from a previous non-TUI branch
    const ctx = makeCtx([userEntry(), userEntry()]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result).toEqual({ source: "none", replayed: 0, opened: false, fallbackActive: false });
    expect(getState()).toBeUndefined();
    expect((ctx.ui.custom as Mock)).not.toHaveBeenCalled();
    expect(isFallbackActive()).toBe(false);
  });

  test("compaction entry on the branch does NOT hide the tool-result base (L4)", () => {
    // Simulates the Q37 residue scenario: /compact projects buildContext
    // (dropping the tool result from LLM context) but the RAW branch walked
    // here still carries it — plus a compaction entry mid-branch that the
    // walker must skip.
    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
    });
    const compaction: SessionEntry = {
      type: "compaction",
      id: "c1",
      parentId: null,
      timestamp: new Date().toISOString(),
      summary: "earlier context summarized",
      firstKeptEntryId: "x",
      tokensBefore: 1000,
    } as unknown as SessionEntry;
    const ctx = makeCtx([
      toolResultEntry(base),
      compaction,
      submissionEntry({ changed: [diff("q1", "postgres")], epoch: 1 }),
    ]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("tool-result");
    expect(result.replayed).toBe(1);
    expect(getState()?.getQuestion("q1")?.answer?.value).toBe("postgres");
  });

  test("corrupt tool-result state falls through to the mirror (g)", () => {
    const good = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
    });
    const ctx = makeCtx([
      toolResultEntry({
        get goal(): string {
          throw new Error("corrupt payload");
        },
      }),
      mirrorEntry({ state: good, epoch: good.epoch, at: "2025-06-01T12:00:02.000Z" }),
    ]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("mirror-entry");
    expect(getState()?.getQuestion("q1")?.status).toBe("open");
  });
});

describe("reconstructFromBranch — surface decision", () => {
  test("non-TUI mode → fallback flag active, no panel call (e)", () => {
    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
    });
    const ctx = makeCtx([toolResultEntry(base)], "rpc");
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.opened).toBe(false);
    expect(result.fallbackActive).toBe(true);
    expect(isFallbackActive()).toBe(true);
    expect((ctx.ui.custom as Mock)).not.toHaveBeenCalled();
  });

  test("suspended host reopens through openPanel with the FRESH state (f)", () => {
    const oldState = createInterrogationState("old branch");
    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
    });
    const host = makeHost();
    const drafts = new DraftStore();
    drafts.setDraft("q1", "wip draft");
    const firstCtx = makeCtx([]);
    openPanel(firstCtx, { config: DEFAULT_CONFIG, state: oldState, drafts });
    suspendPanel(host); // host-forced suspend — no async needed
    expect(host.isSuspended()).toBe(true);

    const ctx = makeCtx([toolResultEntry(base)]);
    const result = reconstructFromBranch(ctx, makeOpts(host, drafts));

    expect(result.opened).toBe(true);
    expect((ctx.ui.custom as Mock)).toHaveBeenCalledTimes(1);
    // Fresh state is live: reopening must not have resuscitated lastOpts.state.
    expect(getState()?.goal).toBe("test goal");
    // Drafts pass through UNTOUCHED (FR-28: never read, never written here).
    expect(drafts.getDraft("q1")).toBe("wip draft");
  });

  test("completed (empty) state installs but opens nothing", () => {
    const done = seededState((s) => {
      s.epoch = 4;
      s.clearForCompletion();
    });
    const ctx = makeCtx([toolResultEntry(done)]);
    const result = reconstructFromBranch(ctx, makeOpts(makeHost()));

    expect(result.source).toBe("tool-result");
    expect(result.opened).toBe(false);
    expect(getState()?.completed).toBe(true); // exactly-once survives restart
    expect(getState()?.epoch).toBe(4);
    expect((ctx.ui.custom as Mock)).not.toHaveBeenCalled();
  });
});

describe("createReconstruction — wiring (h)", () => {
  function makeMockPi(): { pi: Pick<ExtensionAPI, "on">; emit: (event: string, ctx: unknown) => void; on: Mock } {
    const handlers = new Map<string, Handler[]>();
    const on = vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }) as Mock;
    const emit = (event: string, ctx: unknown): void => {
      for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event }, ctx);
    };
    return { pi: { on } as unknown as Pick<ExtensionAPI, "on">, emit, on };
  }

  test("subscribes BOTH session_start and session_tree; both run the walk", () => {
    const mock = makeMockPi();
    const host = makeHost();
    createReconstruction(mock.pi, makeOpts(host));
    expect(mock.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(mock.on).toHaveBeenCalledWith("session_tree", expect.any(Function));

    const base = seededState((s) => {
      applyUpsert(s, [choiceQ("q1")]);
    });
    // session_start reconstructs…
    mock.emit("session_start", makeCtx([toolResultEntry(base)]));
    expect(getState()?.getQuestion("q1")).toBeDefined();
    // …and session_tree re-runs on a branch without traces → cleared.
    mock.emit("session_tree", makeCtx([userEntry()]));
    expect(getState()).toBeUndefined();
  });
});

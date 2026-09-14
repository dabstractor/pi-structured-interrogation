/**
 * Unit tests for src/debug-commands.ts (P1.M2.T3.S1).
 *
 * Follows tool.test.ts / delivery.test.ts stubbing conventions: no pi
 * runtime anywhere — the registered command handlers are captured through a
 * vi.fn() registerCommand and invoked directly with a stub ctx
 * ({ ui: { notify } }); transport assertions deep-equal the captured
 * pi.sendMessage payloads.
 *
 * Coverage: exact h2.3 command names; upsert via executeInterrogate
 * (status-line notify, invalid JSON → no state change, stale rev → AC-8
 * self-heal message, harmless read on an empty session); submit (parse
 * errors, no-state error, unknown-id collection, happy path with exactly
 * ONE sendMessage / ONE epoch bump / ONE new snapshot and the forced-idle
 * delivery options, free-form values with spaces); state (harmless empty,
 * status line + one-liner per question, 60-char prompt preview); and the
 * h2.50 same-code-path proof (handler upsert vs direct executeInterrogate
 * produce identical serialize() output).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config.js";
import { registerDebugCommands } from "./debug-commands.js";
import { buildStatusLine } from "./results.js";
import { createInterrogationState, getState, resetState } from "./state.js";
import { executeInterrogate } from "./tool.js";

// ------------------------------------------------------------------ fixtures

/** Valid upsert fixture (choice + text question; new ids need no rev). */
const FIXTURE = {
  goal: "Plan the migration",
  questions: [
    {
      id: "q1",
      prompt: "Which database?",
      type: "choice",
      options: [
        { value: "sqlite", label: "SQLite" },
        { value: "postgres", label: "Postgres" },
      ],
    },
    { id: "q2", prompt: "Timeline?", type: "text" },
  ],
} as const;

const FIXTURE_JSON = JSON.stringify(FIXTURE);

// --------------------------------------------------------------------- stubs

type NotifyFn = ReturnType<typeof vi.fn>;

interface CtxStub {
  ui: { notify: NotifyFn };
}

interface CapturedCommand {
  description?: string;
  handler: (args: string, ctx: CtxStub) => Promise<void>;
}

/** Stub pi + ctx harness; returns an invoke helper per command name. */
function makeHarness(lifecycle?: Parameters<typeof registerDebugCommands>[2]) {
  const commands = new Map<string, CapturedCommand>();
  const sendMessage = vi.fn();
  const registerCommand = vi.fn((name: string, def: CapturedCommand) => {
    commands.set(name, def);
  });
  const pi = { registerCommand, sendMessage } as unknown as Pick<
    ExtensionAPI,
    "registerCommand" | "sendMessage"
  >;
  registerDebugCommands(pi, DEFAULT_CONFIG, lifecycle);
  const ctx: CtxStub = { ui: { notify: vi.fn() } };
  const invoke = (name: string, args = ""): Promise<void> => {
    const def = commands.get(name);
    if (def === undefined) throw new Error(`command not registered: ${name}`);
    return def.handler(args, ctx);
  };
  return { commands, registerCommand, sendMessage, ctx, invoke };
}

/** Level of the nth notify call ("info" | "warning" | "error"). */
function levelOf(ctx: CtxStub, n = 0): string | undefined {
  return ctx.ui.notify.mock.calls[n]?.[1];
}

beforeEach(() => {
  resetState();
});

// ------------------------------------------------------------- registration

describe("registration", () => {
  test("registers exactly the three h2.3 command names", () => {
    const { registerCommand, commands } = makeHarness();
    expect(registerCommand).toHaveBeenCalledTimes(3);
    expect([...commands.keys()]).toEqual([
      "interrogate-debug-upsert",
      "interrogate-debug-submit",
      "interrogate-debug-state",
    ]);
    for (const def of commands.values()) {
      expect(typeof def.description).toBe("string");
      expect(def.description!.length).toBeGreaterThan(0);
      expect(typeof def.handler).toBe("function");
    }
  });
});

// -------------------------------------------------------------------- upsert

describe("/interrogate-debug-upsert", () => {
  test("valid_fixture_creates_state_and_notifies_status_line", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);

    const state = getState();
    expect(state).toBeDefined();
    expect(state!.goal).toBe("Plan the migration");
    expect(state!.orderedQuestions().map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(state!.epoch).toBe(1); // upsert alone never bumps the epoch

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      buildStatusLine(state!.serialize()),
      "info",
    );
  });

  test("invalid_json_notifies_error_and_touches_no_state", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-upsert", "{not json");

    expect(getState()).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0][0]).toMatch(
      /^interrogate-debug-upsert: invalid JSON: /,
    );
    expect(levelOf(ctx)).toBe("error");
  });

  test("stale_rev_notifies_ac8_self_heal_message_with_current_rev_and_text", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    // q1 exists at rev 1; re-upsert claiming rev 9 → StaleError.
    const stale = JSON.stringify({
      goal: "Plan the migration",
      questions: [{ ...FIXTURE.questions[0], rev: 9 }],
    });
    await invoke("interrogate-debug-upsert", stale);

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const message = ctx.ui.notify.mock.calls[0][0] as string;
    expect(levelOf(ctx)).toBe("error");
    expect(message).toContain("STALE:");
    expect(message).toContain("q1 is at rev 1 (you sent 9)"); // current rev observable
    expect(message).toContain("Current q1: Which database?."); // current text observable
    expect(getState()!.getQuestion("q1")!.rev).toBe(1); // guard ran before any mutation
  });

  test("empty_args_run_the_read_path_harmlessly_on_an_empty_session", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-upsert", "{}");

    // Synthesized empty read view — NOT persisted (epoch 0 convention).
    expect(getState()).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0][0]).toBe(
      "0/0 answered · 0 re-asked · 0 moot · epoch 0",
    );
    expect(levelOf(ctx)).toBe("info");
  });
});

// -------------------------------------------------------------------- submit

describe("/interrogate-debug-submit", () => {
  test("zero_pairs_warns_nothing_to_submit", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-submit", "   ");

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0][0]).toBe(
      "interrogate-debug-submit: nothing to submit",
    );
    expect(levelOf(ctx)).toBe("warning"); // pi's notify enum: warning, not warn
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("malformed_token_without_equals_notifies_parse_error", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-submit", "q1=postgres, oops");

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0][0]).toBe(
      "interrogate-debug-submit: expected id=value[,id=value...]",
    );
    expect(levelOf(ctx)).toBe("error");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("empty_id_notifies_parse_error", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-submit", " = postgres");

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0][0]).toBe(
      "interrogate-debug-submit: expected id=value[,id=value...]",
    );
  });

  test("no_state_notifies_error_and_never_sends", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-submit", "q1=postgres");

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0][0]).toBe(
      "interrogate-debug-submit: no interrogation state",
    );
    expect(levelOf(ctx)).toBe("error");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("happy_path_records_flushes_and_delivers_exactly_one_submission", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-submit", "q1=postgres,q2=sqlite");

    // Flush summary notify.
    expect(ctx.ui.notify.mock.calls[0]).toEqual([
      "interrogate-debug-submit: recorded: q1, q2; unknown: (none)",
      "info",
    ]);

    // Answers landed with the applied shape; answers never touch rev.
    // DEFECT FIX (P1.M7.T6.S1): the submit flush now also performs the
    // h2.38 ctrl+s transition — pending answers enter status "submitted"
    // before buildSubmission (was "answered", which left the h2.44 close
    // pass with nothing to archive). rev is STILL untouched.
    const state = getState()!;
    expect(state.getQuestion("q1")!.answer!.value).toBe("postgres");
    expect(state.getQuestion("q2")!.answer!.value).toBe("sqlite");
    expect(state.getQuestion("q1")!.status).toBe("submitted");
    expect(state.getQuestion("q2")!.status).toBe("submitted");
    expect(state.getQuestion("q1")!.rev).toBe(1);

    // Epoch bumped EXACTLY once; EXACTLY one new snapshot (buildSubmission's
    // own side-effect tail — the command must not duplicate it).
    expect(state.epoch).toBe(2);
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]!.epoch).toBe(1); // snapshot labeled pre-bump

    // EXACTLY one sendMessage, customType interrogation-submission, forced-
    // idle delivery options deep-equal (triggerTurn + followUp, h3.6).
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [msg, options] = sendMessage.mock.calls[0] as [
      { customType: string; display: boolean; content: string; details: { epoch: number } },
      unknown,
    ];
    expect(msg.customType).toBe("interrogation-submission");
    expect(msg.display).toBe(true);
    expect(msg.details.epoch).toBe(1); // PRE-bump epoch label
    expect(msg.content).toContain("Submitted 2:");
    expect(options).toEqual({ triggerTurn: true, deliverAs: "followUp" });

    // Submission status notify carries the POST-bump epoch.
    expect(ctx.ui.notify.mock.calls[1]).toEqual([
      "interrogate-debug-submit: submitted epoch 2",
      "info",
    ]);
  });

  test("unknown_ids_are_collected_and_skipped_not_fatal", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-submit", "q1=postgres,zzz=nope");

    expect(ctx.ui.notify.mock.calls[0]).toEqual([
      "interrogate-debug-submit: recorded: q1; unknown: zzz",
      "info",
    ]);
    // Still one submission for the recorded answer (an all/unknown batch is
    // still one submission per h2.39 — mirror of recordAnswers).
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const state = getState()!;
    expect(state.epoch).toBe(2);
    expect(state.snapshots).toHaveLength(1);
    const msg = sendMessage.mock.calls[0][0] as {
      details: { card: { changed: Array<{ id: string }> } };
    };
    expect(msg.details.card.changed.map((e) => e.id)).toEqual(["q1"]);
  });

  test("values_run_to_the_next_comma_and_are_trimmed", async () => {
    const { invoke } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);

    await invoke("interrogate-debug-submit", " q1 = big postgres , q2=  soonish yes  ");

    const state = getState()!;
    expect(state.getQuestion("q1")!.answer!.value).toBe("big postgres");
    expect(state.getQuestion("q2")!.answer!.value).toBe("soonish yes");
  });
});

// --------------------------------------------------------------------- state

describe("/interrogate-debug-state", () => {
  test("empty_state_is_harmless_info_epoch_0", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-state");

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0]).toEqual([
      "interrogate-debug-state: no interrogation state (epoch 0)",
      "info",
    ]);
  });

  test("populated_state_shows_status_line_then_one_line_per_question", async () => {
    const { invoke, ctx } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    getState()!.applyAnswer("q1", { value: "postgres", at: "2025-01-01T00:00:00.000Z" });
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-state");

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const text = ctx.ui.notify.mock.calls[0][0] as string;
    expect(levelOf(ctx)).toBe("info");
    const lines = text.split("\n");
    expect(lines[0]).toBe(buildStatusLine(getState()!.serialize()));
    expect(lines[1]).toBe("- q1 [answered] rev1 Which database? = postgres");
    expect(lines[2]).toBe("- q2 [open] rev1 Timeline?");
    expect(lines).toHaveLength(3);
  });

  test("prompt_preview_is_sliced_to_60_chars", async () => {
    const { invoke, ctx } = makeHarness();
    const long = JSON.stringify({
      goal: "g",
      questions: [{ id: "q1", prompt: "x".repeat(100), type: "text" }],
    });
    await invoke("interrogate-debug-upsert", long);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-state");

    const lines = (ctx.ui.notify.mock.calls[0][0] as string).split("\n");
    expect(lines[1]).toBe(`- q1 [open] rev1 ${"x".repeat(60)}`);
  });
});

// ------------------------------------------------- h2.50 same-code-path proof

describe("same-code-path proof (Level 4)", () => {
  test("handler_upsert_matches_direct_executeInterrogate_serialize", async () => {
    const { invoke } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    const viaHandler = getState()!.serialize();

    resetState();
    executeInterrogate(JSON.parse(FIXTURE_JSON), { mode: "tui", hasUI: true }, DEFAULT_CONFIG);
    const viaExecutor = getState()!.serialize();

    // Question state carries no timestamps for pure upserts, so the two
    // projections must be deep-equal — the debug command IS the tool path.
    expect(viaHandler).toEqual(viaExecutor);
  });
});

// ------------- note= token (R3, P1.M4.T2.S2) — scripted AC coverage

describe("/interrogate-debug-submit — note= token (R3, P1.M4.T2.S2)", () => {
  test("note_token_ships_the_NOTE_line_sets_details_note_and_reports_clearing", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-submit", "q1=postgres,note=hold this for me");

    // The note id never reaches the state engine (not recorded, not unknown).
    expect(ctx.ui.notify.mock.calls[0]).toEqual([
      "interrogate-debug-submit: recorded: q1; unknown: (none)",
      "info",
    ]);
    expect(getState()!.getQuestion("note")).toBeUndefined();

    // Model-visible NOTE: line + details.note for the card renderer.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as {
      content: string;
      details: { note?: string; changed: Array<{ id: string }> };
    };
    expect(msg.content).toContain("\nNOTE: hold this for me");
    expect(msg.content.split("\n")).toHaveLength(3);
    expect(msg.details.note).toBe("hold this for me");
    expect(msg.details.changed.map((e) => e.id)).toEqual(["q1"]); // note never an entry

    // Cleared-after-shipping report mirrors the panel contract (h2.32).
    expect(ctx.ui.notify.mock.calls[1]).toEqual([
      'interrogate-debug-submit: submitted epoch 2; note cleared: "hold this for me"',
      "info",
    ]);
  });

  test("no_note_token_keeps_the_unchanged_notify_format", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-submit", "q1=postgres");

    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content.split("\n")).toHaveLength(2); // no NOTE line
    expect(ctx.ui.notify.mock.calls[1]).toEqual([
      "interrogate-debug-submit: submitted epoch 2",
      "info",
    ]);
  });

  test("empty_note_value_is_no_note_at_all", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-submit", "q1=postgres,note=");

    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content.split("\n")).toHaveLength(2);
    expect(ctx.ui.notify.mock.calls[1][0]).not.toContain("note cleared");
  });

  test("note_only_args_submit_a_zero_change_delta_carrying_the_note", async () => {
    const { invoke, ctx, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    ctx.ui.notify.mockClear();

    await invoke("interrogate-debug-submit", "note=zero pending context");

    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toBe(
      "Submitted 0: (no changes) (state epoch 2)\n" +
        "Consider how these affect your other questions.\n" +
        "NOTE: zero pending context",
    );
    expect(ctx.ui.notify.mock.calls[0]).toEqual([
      "interrogate-debug-submit: recorded: (none); unknown: (none)",
      "info",
    ]);
  });

  // DEFECT FIX regression (P1.M7.T6.S1): the submit flush performs the
  // h2.38 ctrl+s transition — ALL pending (answered) ids enter status
  // "submitted" before buildSubmission — and notifies the auto-close
  // engine per the h2.44 line-1 caller contract. Unit-level half of the
  // AC-3/AC-14 end-to-end proofs (see ac-scripted.test.ts).
  test("submit_flush_marks_all_pending_answered_submitted_and_notifies_lifecycle", async () => {
    const noteSubmissionDelivered = vi.fn();
    const { invoke, sendMessage } = makeHarness({ noteSubmissionDelivered });
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    const state = getState()!;

    // q3 answered EARLIER (never yet submitted) — the flush is not limited
    // to the ids in this command's args (merge.ts: "all pending (answered)").
    state.applyAnswer("q2", { value: "whenever", at: new Date().toISOString() });

    await invoke("interrogate-debug-submit", "q1=postgres");

    expect(state.getQuestion("q1")!.status).toBe("submitted");
    expect(state.getQuestion("q2")!.status).toBe("submitted");
    // rev NEVER moves on answers or on the flush (h2.39).
    expect(state.getQuestion("q1")!.rev).toBe(1);
    expect(state.getQuestion("q2")!.rev).toBe(1);
    // Contract call happened exactly once, after the single delivery.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(noteSubmissionDelivered).toHaveBeenCalledTimes(1);
    expect(noteSubmissionDelivered.mock.invocationCallOrder[0]).toBeGreaterThan(
      sendMessage.mock.invocationCallOrder[0],
    );
  });

  test("submit_without_lifecycle_handle_still_delivers (seam optional)", async () => {
    const { invoke, sendMessage } = makeHarness();
    await invoke("interrogate-debug-upsert", FIXTURE_JSON);
    await invoke("interrogate-debug-submit", "q1=postgres");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(getState()!.getQuestion("q1")!.status).toBe("submitted");
  });
});

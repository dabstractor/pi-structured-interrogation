/**
 * Unit tests for src/delivery.ts (P1.M2.T1.S1 builder, P1.M2.T1.S3 completion
 * builder, P1.M2.T1.S2 transport).
 *
 * Follows snapshots.test.ts conventions: fresh InterrogationState per test,
 * fixtures built via createInterrogationState + applyAnswer + computeDiff,
 * no pi runtime imports. Verifies content format (h3.6), ≤3-line budget
 * truncation, epoch semantics (pre-bump label, one snapshot + one bump),
 * note passthrough, and `(changed)` markers on editedArchived entries.
 *
 * The S2 suite (deliverSubmission) follows fallback.test.ts mock conventions:
 * plain vi.fn() mocks stand in for runtime deps — no pi runtime anywhere.
 */
import * as fs from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  SUBMISSION_LIST_MAX_CHARS,
  SUBMISSION_REMINDER,
  buildCompletion,
  buildSubmission,
  deliverSubmission,
  drainBatchNotes,
  type DeliveryOptions,
  type SendableMessage,
  type SubmissionMessage,
} from "./delivery";
import { computeDiff, type SubmissionCardData } from "./snapshots";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
  type QuestionAnswer,
  type SerializedState,
} from "./state";
import { StaleError, assertFresh } from "./guards.js";

const T0 = "2025-01-01T00:00:00.000Z";

/** Fresh question with sensible defaults; overrides win (state.test.ts convention). */
function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    prompt: `prompt for ${overrides.id}`,
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

/** Fresh answer with a fixed timestamp so serialized states compare stably. */
function ans(value: string, text?: string): QuestionAnswer {
  return text === undefined ? { value, at: T0 } : { value, text, at: T0 };
}

/** Diff the live state against a prev captured BEFORE the answers were applied. */
function diffFrom(prev: SerializedState, note?: string): SubmissionCardData {
  return computeDiff(prev, state.serialize(), note);
}

/** Choice question fixture with two labeled options. */
function choice(id: string): Question {
  return q({
    id,
    type: "choice",
    options: [
      { value: "sqlite", label: "SQLite" },
      { value: "postgres", label: "Postgres" },
    ],
  });
}

let state: InterrogationState;

beforeEach(() => {
  state = createInterrogationState("Plan the migration");
});

describe("buildSubmission — content", () => {
  test("happy_path_two_answers_exact_content_and_envelope", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("SQLite"));
    state.applyAnswer("q2", ans("Postgres"));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);

    expect(msg.content).toBe(
      "Submitted 2: q1: SQLite; q2: Postgres (state epoch 2)\nConsider how these affect your other questions.",
    );
    expect(msg.customType).toBe("interrogation-submission");
    expect(msg.display).toBe(true);
    expect(msg.details.card).toBe(diff); // same object reference
    expect(msg.details.changed).toEqual(diff.changed);
  });

  test("editedArchived_entry_gets_changed_suffix_regular_edit_does_not", () => {
    state.upsertQuestion(choice("qa"));
    state.upsertQuestion(q({ id: "qb" }));
    state.applyAnswer("qa", ans("sqlite"));
    state.setStatus("qa", "closed"); // archived (Q24=B)
    state.applyAnswer("qb", ans("old"));
    const prev = state.serialize();
    state.applyAnswer("qa", ans("postgres"));
    state.applyAnswer("qb", ans("new"));
    const diff = computeDiff(prev, state.serialize());

    const msg = buildSubmission(state, diff);

    const line1 = msg.content.split("\n")[0];
    expect(line1).toBe("Submitted 2: qa: Postgres (changed); qb: new (state epoch 2)");
  });

  test("truncation_30_long_answers_keeps_3_line_budget_and_true_k", () => {
    for (let i = 1; i <= 30; i++) {
      state.upsertQuestion(q({ id: `q${i}` }));
    }
    const prev = state.serialize();
    for (let i = 1; i <= 30; i++) state.applyAnswer(`q${i}`, ans("v".repeat(60)));
    const diff = computeDiff(prev, state.serialize());
    expect(diff.changed).toHaveLength(30);

    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");

    expect(lines).toHaveLength(2); // ≤3 lines (2 by construction)
    expect(lines[0]).toMatch(/^Submitted 30: /); // k reports the true count
    expect(lines[0]).toMatch(/\+\d+ more \(state epoch \d+\)$/); // rollup BEFORE the suffix
    expect(lines[1]).toBe(SUBMISSION_REMINDER);
  });

  test("single_huge_entry_is_ellipsis_truncated_to_budget", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("x".repeat(SUBMISSION_LIST_MAX_CHARS * 2)));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");

    expect(lines).toHaveLength(2);
    // BUG-006 cap half: the single kept entry is ellipsis-truncated so line 1
    // fits the budget (the old "keep ≥1 entry whole" rule let it through).
    expect(lines[0]!.length).toBeLessThanOrEqual(SUBMISSION_LIST_MAX_CHARS);
    expect(lines[0]!.startsWith("Submitted 1: q1: x")).toBe(true);
    expect(lines[0]).toContain("…"); // ellipsis terminator on the capped entry
    expect(lines[0]).toMatch(/\(state epoch 2\)$/); // epoch suffix never dropped
    expect(lines[0]).not.toContain("+1 more"); // single entry is never dropped — it is capped
    expect(lines[1]).toBe(SUBMISSION_REMINDER);
  });

  test("zero_changes_no_changes_line_still_one_snapshot_one_bump", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    const diff = diffFrom(prev);
    expect(diff.changed).toEqual([]);

    const msg = buildSubmission(state, diff);

    expect(msg.content).toBe(
      "Submitted 0: (no changes) (state epoch 2)\nConsider how these affect your other questions.",
    );
    expect(state.snapshots).toHaveLength(1); // ring consistency on empty diffs
    expect(state.epoch).toBe(2);
  });

  test("reminder_line_is_byte_exact_vs_constant", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const msg = buildSubmission(state, diffFrom(prev));

    expect(SUBMISSION_REMINDER).toBe("Consider how these affect your other questions.");
    expect(msg.content.split("\n")[1]).toBe(SUBMISSION_REMINDER);
  });
});

describe("buildSubmission — details", () => {
  test("note_passthrough_present_when_non_empty_absent_otherwise", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);

    const withNote = buildSubmission(state, diff, "switching db");
    expect(withNote.details.note).toBe("switching db");

    const noNote = buildSubmission(state, diff);
    expect("note" in noNote.details).toBe(false);

    const emptyNote = buildSubmission(state, diff, "");
    expect("note" in emptyNote.details).toBe(false);
  });

  test("epoch_details_epoch_is_pre_bump_state_epoch_is_post_bump", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);
    const before = state.epoch; // 1

    const msg = buildSubmission(state, diff);

    expect(before).toBe(1);
    expect(msg.details.epoch).toBe(1); // pre-bump, matches diff.epoch
    expect(msg.details.epoch).toBe(diff.epoch);
    expect(state.epoch).toBe(2); // exactly +1
  });

  test("snapshot_ring_exactly_one_push_labeled_pre_bump_epoch", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);
    const ringBefore = state.snapshots.length;

    buildSubmission(state, diff);

    expect(state.snapshots.length - ringBefore).toBe(1); // exactly one push
    const last = state.snapshots[state.snapshots.length - 1];
    expect(last?.epoch).toBe(1); // labeled with the PRE-bump epoch
    expect(last?.state.epoch).toBe(1); // snapshot state is pre-bump too
  });

  test("no_message_mutation_side_effects_details_hold_input_references", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);

    const msg: SubmissionMessage = buildSubmission(state, diff, "n");

    expect(msg.details.card).toBe(diff);
    expect(msg.details.changed).toBe(diff.changed);
    expect(Object.keys(msg.details).sort()).toEqual(["card", "changed", "epoch", "note"]);
  });
});

describe("buildSubmission — (state epoch {n}) content suffix (BUG-003)", () => {
  /** Fresh 1-answer diff submitted once (state is reset by beforeEach). */
  function submitOnce(): SubmissionMessage {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    return buildSubmission(state, diffFrom(prev));
  }

  test("content_epoch_is_post_bump_and_matches_state_after_call", () => {
    const msg = submitOnce();
    const n = state.epoch; // post-bump

    expect(n).toBe(2);
    expect(msg.content).toContain(`(state epoch ${n})`); // SAME n the model must echo
    expect(msg.details.epoch).toBe(n - 1); // details stays PRE-bump
  });

  test("echoed_epoch_passes_assertFresh_regression", () => {
    const msg = submitOnce();

    // The model reads the epoch FROM content — parse it out the same way.
    const echoed = Number(/\(state epoch (\d+)\)/.exec(msg.content)![1]);
    const reask = { id: "q1", prompt: "prompt for q1", type: "text" as const, rev: 1 };

    // Post-bump echo on an upsert touching an existing id: NOT stale (BUG-003 guard).
    expect(() => assertFresh(state, { action: "upsert", epoch: echoed, questions: [reask] })).not
      .toThrow();

    // The PRE-bump echo (what BUG-003's epoch-less content forced) throws STALE.
    expect(() =>
      assertFresh(state, { action: "upsert", epoch: echoed - 1, questions: [reask] }),
    ).toThrow(StaleError);

    // P1.M1.T3.S1 (landed): omitting the epoch entirely is rejected too —
    // content's post-bump epoch is the model's ONLY reliable source.
    expect(() => assertFresh(state, { action: "upsert", questions: [reask] })).toThrow(
      /requires the session epoch/,
    );
  });
});

describe("module hygiene", () => {
  test("builder half stays transport-free; pi import is type-only (S2 appended)", () => {
    const src = fs.readFileSync(new URL("./delivery.ts", import.meta.url), "utf8");

    // Exactly four imports: three local data-layer modules + ONE type-only pi
    // import (Pick<ExtensionAPI, "sendMessage"> needs the type; the module
    // must keep zero runtime pi dependency). S3 added depends-on.js for the
    // completion record's moot-reason recomputation.
    const importLines = src.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(4);
    expect(importLines).toContain(
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    );
    const localImports = importLines.filter((l) => !l.includes("@earendil-works"));
    expect(localImports).toHaveLength(3);
    for (const line of localImports) {
      expect(line).toMatch(
        /^import (?:type )?\{.*\} from "\.\/(snapshots|state|depends-on)\.js";$/s,
      );
    }

    // S1's builder half (everything above the TRANSPORT section marker) never
    // touches transport: sendMessage/triggerTurn live only in deliverSubmission.
    const marker = src.indexOf("// ==== TRANSPORT");
    expect(marker).toBeGreaterThan(0);
    const builderHalf = src.slice(0, marker);
    const code = builderHalf.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("sendMessage");
    expect(code).not.toContain("triggerTurn");
  });
});


// ---------------------------------------------------------------------------
// P1.M2.T1.S2 — deliverSubmission (transport half)
// ---------------------------------------------------------------------------

describe("deliverSubmission (P1.M2.T1.S2 transport)", () => {
  /**
   * Minimal SubmissionMessage fixture — deliverSubmission must treat this as
   * opaque plumbing payload, so a hand-built literal (no state machinery)
   * is the sharpest possible purity test.
   */
  function fixture(): SendableMessage {
    return {
      customType: "interrogation-submission",
      content: "Submitted 1: q1: SQLite\nConsider how these affect your other questions.",
      display: true,
      details: {
        changed: [],
        epoch: 1,
        card: { changed: [], epoch: 1, remainOpen: 0 },
      },
    };
  }

  // ------------------------------------ batch-note ledger (NEW-004, h2.46)

  test("NEW-004: a delivered submission's details.note lands in the ledger, in order", () => {
    const withNote = fixture() as SubmissionMessage;
    withNote.details.note = "prefer sqlite";
    const second = fixture() as SubmissionMessage;
    second.details.note = "skip the backup step";
    const sendMessage = vi.fn();

    deliverSubmission({ sendMessage }, fixture()); // no note → not recorded
    deliverSubmission({ sendMessage }, withNote);
    deliverSubmission({ sendMessage }, second);

    expect(drainBatchNotes()).toEqual(["prefer sqlite", "skip the backup step"]);
  });

  test("NEW-004: drain clears the ledger; completion messages never record", () => {
    const completion = fixture() as SendableMessage;
    completion.customType = "interrogation-completion";
    completion.content = "INTERROGATION COMPLETE — goal";
    (completion.details as Record<string, unknown>).notes = ["stale"];
    const submission = fixture() as SubmissionMessage;
    submission.details.note = "the only note";
    const sendMessage = vi.fn();

    deliverSubmission({ sendMessage }, completion); // consumer, not a source
    deliverSubmission({ sendMessage }, submission);

    expect(drainBatchNotes()).toEqual(["the only note"]);
    expect(drainBatchNotes()).toEqual([]); // drained → follow-up starts clean
  });

  test("idle_ctx_uses_triggerTurn_followUp_options", () => {
    const msg = fixture();
    const sendMessage = vi.fn();

    deliverSubmission({ sendMessage }, msg, { isIdle: () => true });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(msg, {
      triggerTurn: true,
      deliverAs: "followUp",
    });
    const opts = sendMessage.mock.calls[0]?.[1] as DeliveryOptions | undefined;
    expect(opts).toEqual({ triggerTurn: true, deliverAs: "followUp" });
  });

  test("busy_ctx_uses_steer_and_omits_triggerTurn", () => {
    const msg = fixture();
    const sendMessage = vi.fn();

    deliverSubmission({ sendMessage }, msg, { isIdle: () => false });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(msg, { deliverAs: "steer" });
    const opts = sendMessage.mock.calls[0]?.[1] as DeliveryOptions | undefined;
    expect(opts).toEqual({ deliverAs: "steer" });
    expect("triggerTurn" in (opts ?? {})).toBe(false); // meaningless while busy — omitted
    expect(Object.keys(opts ?? {})).toEqual(["deliverAs"]); // exact option object
  });

  test("no_ctx_defaults_to_triggerTurn_followUp", () => {
    const msg = fixture();
    const sendMessage = vi.fn();

    deliverSubmission({ sendMessage }, msg);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(msg, {
      triggerTurn: true,
      deliverAs: "followUp",
    });
  });

  test("ctx_without_isIdle_defaults_to_triggerTurn_followUp", () => {
    const msg = fixture();
    const sendMessage = vi.fn();

    deliverSubmission({ sendMessage }, msg, {});

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(msg, {
      triggerTurn: true,
      deliverAs: "followUp",
    });
  });

  test("message_passed_by_reference_unmutated_single_call_no_other_pi_api", () => {
    const msg = fixture();
    const before = structuredClone(msg);
    const sendMessage = vi.fn();
    const pi = { sendMessage }; // mock exposes ONLY sendMessage — any other
    // pi API access would be a TypeError, so one call + these asserts pin it.

    deliverSubmission(pi, msg, { isIdle: () => false });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe(msg); // same reference, not a copy
    expect(msg).toEqual(before); // deep-unmutated
    expect(msg).not.toBe(before); // (clone really was a distinct object)
  });

  test("sendMessage_errors_propagate_not_swallowed", () => {
    const msg = fixture();
    const sendMessage = vi.fn(() => {
      throw new Error("invalid state");
    });

    expect(() => deliverSubmission({ sendMessage }, msg, { isIdle: () => false })).toThrow(
      "invalid state",
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// P1.M2.T1.S3 — buildCompletion (the one full injection)
// ---------------------------------------------------------------------------

/**
 * Multi-group fixture at completion: answered ★ + free text, unanswered
 * choice, withdrawn, moot (dependsOn pair), answered text with free text,
 * recommendation NOT followed, ungrouped. Terminal statuses are set BEFORE
 * buildCompletion runs so the builder's internal evaluateDependsOn pass is a
 * no-op (stable statuses → read-only), keeping the fixture pure.
 */
function goldenState(): InterrogationState {
  const s = createInterrogationState("Plan the migration");
  s.upsertQuestion(
    q({
      id: "storage",
      title: "Storage engine",
      type: "choice",
      group: "Storage",
      recommendation: "sqlite",
      options: [
        { value: "sqlite", label: "SQLite" },
        { value: "postgres", label: "Postgres" },
      ],
    }),
  );
  s.applyAnswer("storage", ans("sqlite", "We already run sqlite everywhere."));
  s.upsertQuestion(
    q({
      id: "backup",
      prompt: "Backup strategy",
      type: "choice",
      group: "Storage",
      options: [
        { value: "sqlite", label: "SQLite" },
        { value: "postgres", label: "Postgres" },
      ],
    }),
  );
  s.upsertQuestion(q({ id: "dropped", prompt: "Drop legacy tables", group: "Storage" }));
  s.setStatus("dropped", "withdrawn");
  s.upsertQuestion(
    q({
      id: "legacy",
      prompt: "Legacy data migration",
      type: "choice",
      group: "Storage",
      options: [
        { value: "etl", label: "ETL scripts" },
        { value: "manual", label: "Manual copy" },
      ],
      dependsOn: [{ id: "storage", equals: "postgres" }],
    }),
  );
  s.setStatus("legacy", "moot");
  s.upsertQuestion(q({ id: "rollout", prompt: "Rollout plan", group: "Delivery" }));
  s.applyAnswer("rollout", ans("Blue-green", "staged over two weeks"));
  s.upsertQuestion(
    q({
      id: "monitoring",
      title: "Monitoring",
      type: "choice",
      group: "Delivery",
      recommendation: "postgres",
      options: [
        { value: "sqlite", label: "SQLite" },
        { value: "postgres", label: "Postgres" },
      ],
    }),
  );
  s.applyAnswer("monitoring", ans("sqlite"));
  s.upsertQuestion(q({ id: "misc", prompt: "Anything else" }));
  s.applyAnswer("misc", ans("None for now"));
  return s;
}

/** Expected h2.46 record for goldenState — byte-exact golden string. */
const GOLDEN_CONTENT = [
  "INTERROGATION COMPLETE — Plan the migration",
  "[Storage] storage Storage engine: SQLite ★ — We already run sqlite everywhere.",
  "[Storage] backup Backup strategy: (unanswered)",
  "[Storage] dropped Drop legacy tables: (unanswered)",
  "[Storage] legacy Legacy data migration: (unanswered)",
  "[Delivery] rollout Rollout plan: Blue-green — staged over two weeks",
  "[Delivery] monitoring Monitoring: SQLite",
  "[(none)] misc Anything else: None for now",
  "NOTES: Chose sqlite after profiling; skipped backup for v1",
  "Withdrawn/moot: dropped (withdrawn: omitted by agent); legacy (moot: storage=sqlite)",
].join("\n");

describe("buildCompletion (P1.M2.T1.S3 — the one full injection)", () => {
  test("write-in answer (custom) renders ✎ {text}; labeled choice regression intact", () => {
    const s = createInterrogationState("Plan the migration");
    s.upsertQuestion(
      q({
        id: "w1",
        title: "Wildcard",
        type: "choice",
        group: "G",
        options: [{ value: "a", label: "Alpha" }],
      }),
    );
    s.applyAnswer("w1", { value: "my own text", custom: true, at: T0 });
    s.upsertQuestion(
      q({
        id: "l1",
        title: "Labeled",
        type: "choice",
        group: "G",
        options: [{ value: "a", label: "Alpha" }],
      }),
    );
    s.applyAnswer("l1", ans("a"));
    const msg = buildCompletion(s);
    expect(msg.content).toContain("[G] w1 Wildcard: ✎ my own text");
    expect(msg.content).toContain("[G] l1 Labeled: Alpha");
  });

  test("write-in with elaboration composes `✎ {text} — {elaboration}` (S2 docblock contract)", () => {
    const s = createInterrogationState("Plan the migration");
    s.upsertQuestion(
      q({
        id: "w1",
        title: "Wildcard",
        type: "choice",
        group: "G",
        options: [{ value: "a", label: "Alpha" }],
      }),
    );
    s.applyAnswer("w1", { value: "my own text", text: "because", custom: true, at: T0 });
    const msg = buildCompletion(s);
    expect(msg.content).toContain("[G] w1 Wildcard: ✎ my own text — because");
  });

  test("write-in star: ★ still composes after ✎ when recommendation === the write-in value", () => {
    const s = createInterrogationState("Plan the migration");
    s.upsertQuestion(
      q({
        id: "w2",
        title: "Wildcard",
        type: "choice",
        group: "G",
        recommendation: "my own text",
        options: [{ value: "a", label: "Alpha" }],
      }),
    );
    s.applyAnswer("w2", { value: "my own text", custom: true, at: T0 });
    const msg = buildCompletion(s);
    expect(msg.content).toContain("[G] w2 Wildcard: ✎ my own text ★");
  });

  test("golden_record_multi_group_byte_exact_content_and_envelope", () => {
    const msg = buildCompletion(goldenState(), [
      "Chose sqlite after profiling",
      "skipped backup for v1",
    ]);

    expect(msg.content).toBe(GOLDEN_CONTENT);
    expect(msg.customType).toBe("interrogation-completion");
    expect(msg.display).toBe(true);
  });

  test("header_line_byte_exact_em_dash_not_hyphen", () => {
    const msg = buildCompletion(goldenState());
    expect(msg.content.split("\n")[0]).toBe("INTERROGATION COMPLETE — Plan the migration");
    expect(msg.content.includes("COMPLETE --")).toBe(false);
    expect(msg.content.includes("COMPLETE - ")).toBe(false);
  });

  test("star_iff_answer_matches_recommendation_free_text_iff_non_empty", () => {
    const opts = [
      { value: "x", label: "Ex" },
      { value: "y", label: "Why" },
    ];
    state.upsertQuestion(q({ id: "a", type: "choice", recommendation: "x", options: opts }));
    state.upsertQuestion(q({ id: "b", type: "choice", recommendation: "y", options: opts }));
    state.upsertQuestion(q({ id: "c", type: "choice", options: opts })); // no recommendation
    state.applyAnswer("a", ans("x"));
    state.applyAnswer("b", ans("x")); // recommendation NOT followed
    state.applyAnswer("c", ans("x"));
    state.upsertQuestion(q({ id: "t1" }));
    state.applyAnswer("t1", ans("v", "some elaboration"));
    state.upsertQuestion(q({ id: "t2" }));
    state.applyAnswer("t2", ans("v", "")); // empty string → no free-text segment

    const msg = buildCompletion(state);
    const lines = msg.content.split("\n");
    expect(lines[1]).toBe("[(none)] a prompt for a: Ex ★");
    expect(lines[2]).toBe("[(none)] b prompt for b: Ex"); // no ★
    expect(lines[3]).toBe("[(none)] c prompt for c: Ex"); // no recommendation → never ★
    expect(lines[4]).toBe("[(none)] t1 prompt for t1: v — some elaboration");
    expect(lines[5]).toBe("[(none)] t2 prompt for t2: v");

    const entries = msg.details.groups[0]!.questions;
    const a = entries.find((e) => e.id === "a")!;
    expect(a).toEqual({ id: "a", title: "prompt for a", answer: "Ex", star: true, answeredAt: T0 });
    const t1 = entries.find((e) => e.id === "t1")!;
    expect(t1.freeText).toBe("some elaboration");
    const t2 = entries.find((e) => e.id === "t2")!;
    expect(t2.star).toBe(false);
    expect("freeText" in t2).toBe(false); // empty string → key omitted
    expect("answeredAt" in t2).toBe(true);
  });

  test("notes_line_joins_in_order_none_when_empty_or_undefined", () => {
    state.upsertQuestion(q({ id: "q1" }));

    const multi = buildCompletion(state, ["first", "second; third", "last"]);
    expect(multi.content.split("\n")).toContain("NOTES: first; second; third; last");
    expect(multi.details.notes).toEqual(["first", "second; third", "last"]);
    expect(multi.content.split("\n").filter((l) => l.startsWith("NOTES:"))).toHaveLength(1);

    const empty = buildCompletion(state, []);
    expect(empty.content.split("\n")).toContain("NOTES: (none)");
    expect(empty.details.notes).toEqual([]);

    const undef = buildCompletion(state);
    expect(undef.content.split("\n")).toContain("NOTES: (none)");
    expect(undef.details.notes).toEqual([]);
  });

  test("withdrawn_moot_reasons_derived_none_when_empty", () => {
    const s = createInterrogationState("G");
    s.upsertQuestion(q({ id: "w", prompt: "W" }));
    s.setStatus("w", "withdrawn");
    s.upsertQuestion(q({ id: "dep", prompt: "Dep" }));
    s.applyAnswer("dep", ans("sqlite"));
    s.upsertQuestion(q({ id: "m", prompt: "M", dependsOn: [{ id: "dep", equals: "postgres" }] }));
    s.setStatus("m", "moot");
    s.upsertQuestion(q({ id: "ghost", prompt: "Ghost", dependsOn: [{ id: "nowhere", equals: "x" }] }));
    s.setStatus("ghost", "moot"); // unmet missing dep → legitimately moot

    const msg = buildCompletion(s);
    expect(msg.content).toContain(
      "Withdrawn/moot: w (withdrawn: omitted by agent); m (moot: dep=sqlite); ghost (moot: nowhere=missing)",
    );
    expect(msg.details.withdrawnMoot).toEqual([
      { id: "w", status: "withdrawn", reason: "omitted by agent" },
      { id: "m", status: "moot", reason: "dep=sqlite" },
      { id: "ghost", status: "moot", reason: "nowhere=missing" },
    ]);

    const plain = createInterrogationState("G");
    plain.upsertQuestion(q({ id: "q1" }));
    expect(buildCompletion(plain).content.split("\n")).toContain("Withdrawn/moot: (none)");
  });

  test("groups_first_appearance_order_questions_in_order_within_group", () => {
    const s = createInterrogationState("G");
    s.upsertQuestion(q({ id: "u1", prompt: "U1" })); // (none) appears first
    s.upsertQuestion(q({ id: "b1", prompt: "B1", group: "Bravo" }));
    s.upsertQuestion(q({ id: "a1", prompt: "A1", group: "Alpha" }));
    s.upsertQuestion(q({ id: "b2", prompt: "B2", group: "Bravo" }));

    const msg = buildCompletion(s);
    expect(msg.details.groups.map((g) => g.group)).toEqual(["(none)", "Bravo", "Alpha"]);
    expect(msg.details.groups[1]!.questions.map((e) => e.id)).toEqual(["b1", "b2"]);
    const lines = msg.content.split("\n");
    expect(lines[1]).toBe("[(none)] u1 U1: (unanswered)");
    expect(lines[2]).toBe("[Bravo] b1 B1: (unanswered)");
    expect(lines[3]).toBe("[Alpha] a1 A1: (unanswered)");
    expect(lines[4]).toBe("[Bravo] b2 B2: (unanswered)"); // order[] order within group
  });

  test("details_shape_goal_groups_notes_withdrawnMoot_completedAt_epoch", () => {
    const msg = buildCompletion(goldenState(), ["note"]);
    expect(msg.details.goal).toBe("Plan the migration");
    expect(msg.details.notes).toEqual(["note"]);
    expect(msg.details.epoch).toBe(1);
    expect(Number.isNaN(Date.parse(msg.details.completedAt))).toBe(false);
    expect(msg.details.groups.map((g) => g.group)).toEqual(["Storage", "Delivery", "(none)"]);

    const storage = msg.details.groups[0]!.questions;
    expect(storage.find((e) => e.id === "storage")).toEqual({
      id: "storage",
      title: "Storage engine",
      answer: "SQLite",
      star: true,
      freeText: "We already run sqlite everywhere.",
      answeredAt: T0,
    });
    const backup = storage.find((e) => e.id === "backup")!;
    expect(backup.answer).toBe("(unanswered)");
    expect(backup.star).toBe(false);
    expect("freeText" in backup).toBe(false);
    expect("answeredAt" in backup).toBe(false); // unanswered → both keys omitted
    expect(msg.details.groups[2]!.questions.map((e) => e.id)).toEqual(["misc"]);
    expect(msg.details.withdrawnMoot).toEqual([
      { id: "dropped", status: "withdrawn", reason: "omitted by agent" },
      { id: "legacy", status: "moot", reason: "storage=sqlite" },
    ]);
  });

  test("purity_no_snapshot_bump_clear_events_or_state_mutation", () => {
    const s = goldenState();
    const before = s.serialize();
    const snapshotsBefore = s.snapshots.length;
    const epochBefore = s.epoch;
    let changedEvents = 0;
    s.on("changed", () => changedEvents++);
    const epochEvents: number[] = [];
    s.on("epoch-bumped", (e) => epochEvents.push(e));

    buildCompletion(s, ["n"]);

    expect(s.serialize()).toEqual(before); // byte-identical state
    expect(s.snapshots.length).toBe(snapshotsBefore); // no takeSnapshot
    expect(s.epoch).toBe(epochBefore); // no bumpEpoch
    expect(changedEvents).toBe(0); // no events (incl. none from evaluateDependsOn)
    expect(epochEvents).toEqual([]);
  });
});

describe("SendableMessage widening (P1.M2.T1.S3)", () => {
  test("completion_message_assignable_and_carried_by_deliverSubmission_unchanged", () => {
    const msg: SendableMessage = buildCompletion(goldenState(), ["note"]); // type-level union check
    expect(msg.customType).toBe("interrogation-completion");

    const sendMessage = vi.fn();
    deliverSubmission({ sendMessage }, msg, { isIdle: () => true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(msg, { triggerTurn: true, deliverAs: "followUp" });
  });
});

// ------------- buildSubmission NOTE: content line (h2.32/R3, P1.M4.T2.S2)

describe("buildSubmission — NOTE: content line (h2.32/R3, P1.M4.T2.S2)", () => {
  /** Fresh 1-answer diff (state is reset by beforeEach). */
  function answeredDiff(): SubmissionCardData {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("SQLite"));
    return diffFrom(prev);
  }

  test("non_empty_note_appends_third_content_line_and_keeps_details_note", () => {
    const diff = answeredDiff();
    const msg = buildSubmission(state, diff, "picked sqlite — deploy is friday");

    const lines = msg.content.split("\n");
    expect(lines).toHaveLength(3); // h3.6 ≤3-line budget: 2 without, 3 with note
    expect(lines[0]).toBe("Submitted 1: q1: SQLite (state epoch 2)"); // line 1 carries the epoch
    expect(lines[1]).toBe(SUBMISSION_REMINDER); // line 2 untouched
    expect(lines[2]).toBe("NOTE: picked sqlite — deploy is friday"); // MODEL-visible
    expect(msg.details.note).toBe("picked sqlite — deploy is friday"); // card keeps it
  });

  test("newlines_in_the_note_collapse_to_slash_separator_and_never_truncate", () => {
    const diff = answeredDiff();
    const longNote = `multi\n\nline ${"x".repeat(400)}`; // beyond any budget

    const msg = buildSubmission(state, diff, longNote);

    const lines = msg.content.split("\n");
    expect(lines).toHaveLength(3); // \n and \n\n each collapse — never split
    expect(lines[2]!.startsWith("NOTE: multi / line ")).toBe(true);
    expect(lines[2]!.endsWith("x")).toBe(true); // never truncated
  });

  test("empty_or_undefined_note_keeps_exactly_two_lines", () => {
    const diff = answeredDiff();
    expect(buildSubmission(state, diff, "").content.split("\n")).toHaveLength(2);
    expect(buildSubmission(state, diff).content.split("\n")).toHaveLength(2);
  });

  test("zero_changes_with_note_still_carries_the_NOTE_line", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize(); // nothing answered → zero changes
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff, "hold");

    const lines = msg.content.split("\n");
    expect(lines[0]).toBe("Submitted 0: (no changes) (state epoch 2)");
    expect(lines[2]).toBe("NOTE: hold");
  });
});

// ------------------------------------------------------- BUG-006 flatten half

describe("BUG-006 flatten half — multi-line write-ins (P1.M2.T3.S1)", () => {
  test("bug006_multi_line_write_in_delta_stays_two_lines", () => {
    state.upsertQuestion(choice("q1"));
    state.upsertQuestion(q({ id: "q2" }));
    const prev = state.serialize();
    state.applyAnswer("q1", { value: "line one\nline two 🚀", custom: true, at: T0 });
    state.applyAnswer("q2", ans("A"));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);

    // Byte-exact: the multi-line write-in entry is SINGLE-LINE (runs of
    // \n/\t collapse to " / " — the NOTE line's grammar), so the content
    // keeps the 2-line shape (+reminder) instead of spilling.
    expect(msg.content).toBe(
      "Submitted 2: q1: ✎ line one / line two 🚀; q2: A (state epoch 2)\n" +
        "Consider how these affect your other questions.",
    );
    expect(msg.content.split("\n")).toHaveLength(2);
    // Card to/from fields carry no newlines or tabs for any entry.
    for (const entry of msg.details.changed) {
      expect(entry.to.includes("\n")).toBe(false);
      expect(entry.to.includes("\t")).toBe(false);
      expect(entry.from.includes("\n")).toBe(false);
      expect(entry.from.includes("\t")).toBe(false);
    }
    // The committed value in STATE keeps its raw newlines (summary-only).
    expect(state.getQuestion("q1")?.answer?.value).toBe("line one\nline two 🚀");
  });

  test("bug006_note_adds_exactly_one_line_over_flattened_entries", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", { value: "one\ntwo", custom: true, at: T0 });
    const diff = diffFrom(prev);

    // With a (multi-line) note the budget is 3 lines: delta + NOTE + reminder.
    const msg = buildSubmission(state, diff, "multi\nline note");

    const lines = msg.content.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Submitted 1: q1: ✎ one / two (state epoch 2)");
    expect(lines[1]).toBe("Consider how these affect your other questions.");
    expect(lines[2]).toBe("NOTE: multi / line note"); // NOTE's own flatten (unchanged)
  });
});

// ---------------------------------------------------- BUG-006 cap half

describe("BUG-006 cap half — per-entry truncation (P1.M2.T3.S2)", () => {
  test("bug006_single_3000_char_write_in_entry_is_capped", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", { value: "X".repeat(3000), custom: true, at: T0 });
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");

    expect(lines).toHaveLength(2); // ≤3-line budget restored (FR-3/AC-2)
    expect(lines[0]!.length).toBeLessThanOrEqual(SUBMISSION_LIST_MAX_CHARS);
    expect(lines[0]!.startsWith("Submitted 1: q1: ✎ X")).toBe(true);
    expect(lines[0]).toContain("…"); // ellipsis terminator
    expect(lines[0]).toMatch(/\(state epoch 2\)$/); // suffix never dropped
    expect(lines[0]).not.toContain("+1 more"); // single entry: capped, not dropped
    expect(lines[1]).toBe(SUBMISSION_REMINDER);
    // details/card keep the UNTRUNCATED `to` (h2.36 Q2=A) — only content is capped.
    expect(msg.details.changed[0]?.to).toBe(`✎ ${"X".repeat(3000)}`);
  });

  test("bug006_huge_plus_normal_entries_truncate_then_rollup", () => {
    for (let i = 1; i <= 4; i++) state.upsertQuestion(q({ id: `q${i}` }));
    const prev = state.serialize();
    state.applyAnswer("q1", { value: "X".repeat(3000), custom: true, at: T0 });
    state.applyAnswer("q2", ans("A"));
    state.applyAnswer("q3", ans("B"));
    state.applyAnswer("q4", ans("C"));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]!.length).toBeLessThanOrEqual(SUBMISSION_LIST_MAX_CHARS);
    expect(lines[0]!.startsWith("Submitted 4: q1: ✎ X")).toBe(true); // first entry KEPT (truncated); k true
    expect(lines[0]).toContain("…");
    expect(lines[0]).toMatch(/\+3 more \(state epoch 2\)$/); // rollup BEFORE the never-dropped suffix
    expect(lines[1]).toBe(SUBMISSION_REMINDER);
  });

  test("bug006_short_entries_byte_identical_to_golden", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("SQLite"));
    state.applyAnswer("q2", ans("Postgres"));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);

    // Guard: the cap must be a strict no-op for lines that already fit.
    expect(msg.content).toBe(
      "Submitted 2: q1: SQLite; q2: Postgres (state epoch 2)\n" +
        "Consider how these affect your other questions.",
    );
  });
});

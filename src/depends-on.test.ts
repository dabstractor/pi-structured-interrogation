/**
 * Unit tests for src/depends-on.ts (P1.M1.T2.S3).
 *
 * FR-17 (instant local moot greying) and FR-18 (ripple closure data contract).
 * Fresh InterrogationState per test; reasons pinned to the h2.29 format
 * (`moot: storage=sqlite` exemplar from the specs). state.ts is a frozen
 * contract — these tests only use its public surface.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { InterrogationState, createInterrogationState } from "./state.js";
import {
  computeRipple,
  dependencyMet,
  evaluateDependsOn,
  type MootEvaluation,
} from "./depends-on.js";
import type { DependsOn, Question } from "./state.js";

// --------------------------------------------------------------- helpers

/** Seed question with the S1-required defaults. */
function q(id: string, dependsOn?: DependsOn[]): Question {
  return { id, prompt: id, type: "choice", rev: 1, status: "open", dependsOn };
}

/** Answer payload with a fresh ISO timestamp. */
function answered(value: string): { value: string; at: string } {
  return { value, at: new Date().toISOString() };
}

/**
 * Attach a 'changed' listener counter and return a reader — used to prove
 * evaluateDependsOn emits zero events on no-op passes (idempotence).
 */
function changeCounter(state: InterrogationState): () => number {
  let count = 0;
  state.on("changed", () => {
    count++;
  });
  return () => count;
}

let state: InterrogationState;

beforeEach(() => {
  state = createInterrogationState("depends-on tests");
});

// ---------------------------------------------------------------- tests

describe("evaluateDependsOn — FR-17", () => {
  test("no_dependsOn_anywhere_is_a_noop_with_zero_changed_events", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("fs"));

    const changes = changeCounter(state);
    const result: MootEvaluation = evaluateDependsOn(state);

    expect(result).toStrictEqual({ mootered: [], reopened: [] });
    expect(changes()).toBe(0);
    expect(state.getQuestion("storage")?.status).toBe("open");
  });

  test("unanswered_dependency_mootered_with_unanswered_reason", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("fs", [{ id: "storage", equals: "sqlite" }]));

    const result = evaluateDependsOn(state);

    expect(result.mootered).toStrictEqual([
      { id: "fs", reason: "moot: storage=unanswered" },
    ]);
    expect(result.reopened).toStrictEqual([]);
    expect(state.getQuestion("fs")?.status).toBe("moot");
    // Question stays in the map (FR-19: never pruned, audit trail Q34=A).
    expect(state.getQuestion("fs")).toBeDefined();
  });

  test("equals_satisfied_no_moot__equals_mismatch_exact_reason_string", () => {
    state.upsertQuestion(q("storage"));
    const fs = q("fs", [{ id: "storage", equals: "postgres" }]);
    state.upsertQuestion(fs);

    // Dependency answered with the expected value → met, untouched.
    state.applyAnswer("storage", answered("postgres"));
    const met = evaluateDependsOn(state);
    expect(met.mootered).toStrictEqual([]);
    expect(state.getQuestion("fs")?.status).toBe("open");

    // Dependency answered with a different value → unmet. Reason shows the
    // dependency's ACTUAL value (h2.29): `moot: storage=sqlite`.
    state.applyAnswer("storage", answered("sqlite"));
    const unmet = evaluateDependsOn(state);
    expect(unmet.mootered).toStrictEqual([{ id: "fs", reason: "moot: storage=sqlite" }]);
    expect(state.getQuestion("fs")?.status).toBe("moot");
  });

  test("notEquals_answered_matching_unmet__answered_different_met__unanswered_unmet", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("fs", [{ id: "storage", notEquals: "sqlite" }]));

    // Unanswered dependency with notEquals → still unmet (unanswered ≠ "not
    // equal" — regression for the PRP gotcha).
    const unanswered = evaluateDependsOn(state);
    expect(unanswered.mootered).toStrictEqual([
      { id: "fs", reason: "moot: storage=unanswered" },
    ]);

    // Answered WITH the excluded value → unmet; reason shows actual value,
    // reproducing the h2.29 exemplar `moot: storage=sqlite` exactly.
    state.applyAnswer("storage", answered("sqlite"));
    const excluded = evaluateDependsOn(state);
    expect(excluded.mootered).toStrictEqual([{ id: "fs", reason: "moot: storage=sqlite" }]);

    // Re-met path: moot → open only from moot, then answered differently → met.
    state.applyAnswer("storage", answered("postgres"));
    const different = evaluateDependsOn(state);
    expect(different.mootered).toStrictEqual([]);
    expect(different.reopened).toStrictEqual(["fs"]);
    expect(state.getQuestion("fs")?.status).toBe("open");
  });

  test("conditionless_conjunct_met_iff_dependency_answered", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("fs", [{ id: "storage" }]));

    // Unanswered → unmet (conditionless conjunct still requires an answer).
    const before = evaluateDependsOn(state);
    expect(before.mootered).toStrictEqual([{ id: "fs", reason: "moot: storage=unanswered" }]);

    // Any answer satisfies a conditionless conjunct.
    state.applyAnswer("storage", answered("anything"));
    const after = evaluateDependsOn(state);
    expect(after.mootered).toStrictEqual([]);
    expect(after.reopened).toStrictEqual(["fs"]);
    expect(state.getQuestion("fs")?.status).toBe("open");
  });

  test("multiple_conjuncts_all_must_hold__reason_from_first_failing", () => {
    state.upsertQuestion(q("a"));
    state.upsertQuestion(q("b"));
    state.upsertQuestion(q("c", [{ id: "a", equals: "x" }, { id: "b", equals: "y" }]));

    // First conjunct fails → its reason wins.
    let result = evaluateDependsOn(state);
    expect(result.mootered).toStrictEqual([{ id: "c", reason: "moot: a=unanswered" }]);

    // First conjunct passes, second still fails → second conjunct's reason.
    state.applyAnswer("a", answered("x"));
    state.setStatus("c", "open"); // force re-evaluation path
    result = evaluateDependsOn(state);
    expect(result.mootered).toStrictEqual([{ id: "c", reason: "moot: b=unanswered" }]);

    // Both pass → met.
    state.applyAnswer("b", answered("y"));
    result = evaluateDependsOn(state);
    expect(result.mootered).toStrictEqual([]);
    expect(state.getQuestion("c")?.status).toBe("open");
  });

  test("remet_flips_moot_to_open__second_call_zero_changed_events", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("fs", [{ id: "storage", equals: "sqlite" }]));
    state.upsertQuestion(q("wal", [{ id: "fs", notEquals: "none" }]));

    // Pass 1: fs unanswered → moot; wal's dep (fs) unanswered → moot.
    const first = evaluateDependsOn(state);
    expect(first.mootered.map((m) => m.id)).toStrictEqual(["fs", "wal"]);

    // Pass 2, unchanged answers: same mootered set, ZERO status flips/events.
    const changes = changeCounter(state);
    const second = evaluateDependsOn(state);
    expect(second.mootered.map((m) => m.id)).toStrictEqual(["fs", "wal"]);
    expect(second.reopened).toStrictEqual([]);
    expect(changes()).toBe(0);

    // Answer the root → pass 3 re-mets fs: moot → open (h2.38). wal stays
    // moot: its dependency (fs) is reopened but still UNANSWERED — per the
    // condition semantics, unanswered dependency = unmet even for notEquals.
    state.applyAnswer("storage", answered("sqlite"));
    const third = evaluateDependsOn(state);
    expect(third.reopened).toStrictEqual(["fs"]);
    expect(state.getQuestion("fs")?.status).toBe("open");
    expect(state.getQuestion("wal")?.status).toBe("moot");

    // Answering fs lets wal re-met on the next pass — reopening propagates
    // one level per user answer, which is exactly the FR-17 flow.
    state.applyAnswer("fs", answered("btree"));
    const fourth = evaluateDependsOn(state);
    expect(fourth.reopened).toStrictEqual(["wal"]);
    expect(state.getQuestion("wal")?.status).toBe("open");

    // Pass 5 after full re-met: idempotent — nothing mootered, zero events.
    const changes5 = changeCounter(state);
    expect(evaluateDependsOn(state)).toStrictEqual({ mootered: [], reopened: [] });
    expect(changes5()).toBe(0);
  });

  test("withdrawn_and_closed_questions_skipped_status_unchanged", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("wd", [{ id: "storage", equals: "sqlite" }]));
    state.upsertQuestion(q("cl", [{ id: "storage", equals: "sqlite" }]));
    state.setStatus("wd", "withdrawn");
    state.setStatus("cl", "closed");

    const changes = changeCounter(state);
    const result = evaluateDependsOn(state);

    // Terminal-until-re-upsert (h2.38): not evaluated, not listed, untouched.
    expect(result.mootered).toStrictEqual([]);
    expect(changes()).toBe(0);
    expect(state.getQuestion("wd")?.status).toBe("withdrawn");
    expect(state.getQuestion("cl")?.status).toBe("closed");
  });

  test("missing_dependency_id_yields_missing_reason_without_throwing", () => {
    state.upsertQuestion(q("fs", [{ id: "ghost", equals: "x" }]));

    const result = evaluateDependsOn(state);

    expect(result.mootered).toStrictEqual([{ id: "fs", reason: "moot: ghost=missing" }]);
    expect(state.getQuestion("fs")?.status).toBe("moot");
  });

  test("answered_and_submitted_and_reasked_go_moot_when_unmet", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("ans", [{ id: "storage", equals: "sqlite" }]));
    state.upsertQuestion(q("sub", [{ id: "storage", equals: "sqlite" }]));
    state.upsertQuestion(q("rea", [{ id: "storage", equals: "sqlite" }]));
    state.applyAnswer("ans", answered("postgres"));
    state.applyAnswer("sub", answered("postgres"));
    state.setStatus("sub", "submitted");
    state.setStatus("rea", "reasked");

    const result = evaluateDependsOn(state);

    // Moot wins over answered/submitted/reasked (merge.ts owns re-upsert;
    // re-derivation on re-met later returns them to open).
    expect(result.mootered.map((m) => m.id)).toStrictEqual(["ans", "sub", "rea"]);
    expect(state.getQuestion("ans")?.status).toBe("moot");
    expect(state.getQuestion("sub")?.status).toBe("moot");
    expect(state.getQuestion("rea")?.status).toBe("moot");
  });
});

describe("dependencyMet — single-question helper", () => {
  test("direct_check_met_unmet_and_reason_for_first_failing_conjunct", () => {
    state.upsertQuestion(q("storage"));
    state.upsertQuestion(q("fs", [{ id: "storage", equals: "sqlite" }]));
    const fs = state.getQuestion("fs") as Question;

    expect(dependencyMet(state, fs)).toStrictEqual({
      met: false,
      reason: "moot: storage=unanswered",
    });

    state.applyAnswer("storage", answered("sqlite"));
    expect(dependencyMet(state, fs)).toStrictEqual({ met: true });

    state.applyAnswer("storage", answered("postgres"));
    expect(dependencyMet(state, fs)).toStrictEqual({
      met: false,
      reason: "moot: storage=postgres",
    });

    // Empty dependsOn array = always met.
    const plain = q("plain");
    state.upsertQuestion(plain);
    expect(dependencyMet(state, state.getQuestion("plain") as Question)).toStrictEqual({
      met: true,
    });
  });
});

describe("computeRipple — FR-18 data contract", () => {
  test("three_level_chain_ripple_from_each_node", () => {
    // JSDoc/Mode A fixture: A ← B dependsOn A ← C dependsOn B ← D dependsOn C.
    state.upsertQuestion(q("a"));
    state.upsertQuestion(q("b", [{ id: "a", equals: "x" }]));
    state.upsertQuestion(q("c", [{ id: "b", equals: "y" }]));
    state.upsertQuestion(q("d", [{ id: "c" }]));

    expect(computeRipple(state, "a")).toStrictEqual(["b", "c", "d"]);
    expect(computeRipple(state, "c")).toStrictEqual(["d"]);
    expect(computeRipple(state, "d")).toStrictEqual([]);
    // Leaf with no dependents anywhere.
    expect(computeRipple(state, "nonexistent")).toStrictEqual([]);
  });

  test("pure_no_state_mutation_serialize_identical", () => {
    state.upsertQuestion(q("a"));
    state.upsertQuestion(q("b", [{ id: "a", equals: "x" }]));
    state.applyAnswer("a", answered("x"));

    const before = JSON.stringify(state.serialize());
    computeRipple(state, "a");
    computeRipple(state, "b");
    const after = JSON.stringify(state.serialize());

    expect(after).toBe(before);
    expect(state.getQuestion("b")?.status).toBe("open"); // untouched
  });

  test("cycle_terminates_excludes_changed_id_no_hang", () => {
    // Agent-bug cycle: A dependsOn B, B dependsOn A.
    state.upsertQuestion(q("a", [{ id: "b", equals: "x" }]));
    state.upsertQuestion(q("b", [{ id: "a", equals: "y" }]));
    state.upsertQuestion(q("c", [{ id: "a", equals: "z" }]));

    expect(computeRipple(state, "a")).toStrictEqual(["b", "c"]);
    expect(computeRipple(state, "b")).toStrictEqual(["a", "c"]);
  });
});

describe("reconstruction step 5 — works on deserialized state", () => {
  test("evaluateDependsOn_on_deserialized_state_produces_same_statuses", () => {
    const original = createInterrogationState("roundtrip");
    original.upsertQuestion(q("storage"));
    original.upsertQuestion(q("fs", [{ id: "storage", equals: "sqlite" }]));
    original.upsertQuestion(q("wal", [{ id: "fs", notEquals: "none" }]));
    // Answer so fs is met-but-not-yet-evaluated and wal is unmet-not-yet-moot.
    original.applyAnswer("storage", answered("postgres"));

    // JSON round-trip through SerializedState (persisted-entry path).
    const rt = InterrogationState.deserialize(
      JSON.parse(JSON.stringify(original.serialize())),
    );
    // fs serializes as "open" (no evaluation ran pre-deserialize)...
    expect(rt.getQuestion("fs")?.status).toBe("open");

    // ...and reconstruction step 5 re-derives moot-ness on the fresh instance.
    evaluateDependsOn(original);
    evaluateDependsOn(rt);

    expect(rt.getQuestion("fs")?.status).toBe("moot");
    expect(rt.getQuestion("wal")?.status).toBe("moot");
    expect(JSON.stringify(rt.serialize())).toBe(JSON.stringify(original.serialize()));

    // And the re-met path works post-deserialize too (fs reopens now; wal
    // once fs is actually answered — unanswered dependency = unmet).
    rt.applyAnswer("storage", answered("sqlite"));
    let reopened = evaluateDependsOn(rt);
    expect(reopened.reopened).toStrictEqual(["fs"]);
    rt.applyAnswer("fs", answered("btree"));
    reopened = evaluateDependsOn(rt);
    expect(reopened.reopened).toStrictEqual(["wal"]);
  });
});

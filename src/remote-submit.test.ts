/**
 * src/remote-submit.test.ts — D-R5 ordering parity with the panel's
 * ctrl+s (plan §5.1): exactly one snapshot + one epoch bump per submission
 * (both inside buildSubmission), BUG-008 predicate parity (agent-caused
 * re-ask resets never shipped), one deliverSubmission call, the h2.44
 * noteSubmissionDelivered caller contract AFTER delivery, and the
 * idle-vs-busy delivery branch.
 */
import { describe, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeSubmitted } from "./merge.js";
import { recordRemoteSubmission, type RemoteAnswerInput } from "./remote-submit.js";
import { createInterrogationState, type InterrogationState } from "./state.js";
import { takeSnapshot } from "./snapshots.js";

function fixture(): InterrogationState {
  const state = createInterrogationState("Plan");
  state.upsertQuestion({
    id: "q1",
    prompt: "Engine?",
    type: "choice",
    options: [
      { value: "sqlite", label: "SQLite" },
      { value: "postgres", label: "PostgreSQL" },
    ],
    rev: 1,
    status: "open",
  });
  state.upsertQuestion({ id: "q2", prompt: "Downtime?", type: "text", rev: 1, status: "open" });
  return state;
}

function makePi(): { pi: Pick<ExtensionAPI, "sendMessage">; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  return {
    pi: { sendMessage: (msg: unknown) => void sent.push(msg as Record<string, unknown>) },
    sent,
  };
}

const answers = (list: RemoteAnswerInput[]) => list;

describe("recordRemoteSubmission (D-R5 parity)", () => {
  test("applies answers, ships ONE submission, bumps snapshot+epoch EXACTLY once", () => {
    const state = fixture();
    const { pi, sent } = makePi();
    const snapshotsBefore = state.snapshots.length;
    const epochBefore = state.epoch;

    const out = recordRemoteSubmission(pi, state, answers([
      { id: "q1", value: "postgres" },
      { id: "q2", value: "one hour max" },
    ]));

    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(state.snapshots.length).toBe(snapshotsBefore + 1); // exactly one takeSnapshot
    expect(state.epoch).toBe(epochBefore + 1); // exactly one bumpEpoch
    expect(state.getQuestion("q1")!.status).toBe("submitted");
    expect(state.getQuestion("q2")!.status).toBe("submitted");
    const msg = sent[0] as { content: string };
    expect(msg.content).toContain("Submitted 2: q1: PostgreSQL; q2: one hour max (state epoch 2)");
  });

  test("nothing_shippable on identical re-selection: no snapshot, no bump, no delivery", () => {
    const state = fixture();
    const { pi, sent } = makePi();
    recordRemoteSubmission(pi, state, answers([{ id: "q1", value: "postgres" }]));
    const sentCount = sent.length;
    const snaps = state.snapshots.length;
    const epoch = state.epoch;

    // markSubmitted→closed cycle: reopen via re-upsert, answer identically.
    closeSubmitted(state, ["q1"]);
    state.upsertQuestion({
      id: "q1",
      prompt: "Engine?",
      type: "choice",
      options: [
        { value: "sqlite", label: "SQLite" },
        { value: "postgres", label: "PostgreSQL" },
      ],
      rev: 2,
      status: "reasked",
    });

    const out = recordRemoteSubmission(pi, state, answers([{ id: "q1", value: "postgres" }]));
    // Re-answering after a re-ask DOES diff (baseline holds the old submitted
    // answer's signature)... unless the value is identical — answerSignature
    // is value+text, so identical → no diff entry → nothing_shippable.
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("nothing_shippable");
    expect(sent).toHaveLength(sentCount);
    expect(state.snapshots.length).toBe(snaps);
    expect(state.epoch).toBe(epoch);
  });

  test("BUG-008 parity: agent-caused re-ask resets are never shipped", () => {
    const state = fixture();
    const { pi, sent } = makePi();
    // User answers q1 on the panel earlier (answered-pending, unsubmitted).
    state.applyAnswer("q1", { value: "sqlite", at: "2026-01-01T00:00:00.000Z" });
    // Baseline snapshot at "submitted" — then the agent re-asks q1 with
    // changed options, resetting its answer (merge rule 2).
    state.applyAnswer("q1", { value: "sqlite", at: "2026-01-01T00:00:00.000Z" });
    takeSnapshot(state);
    state.bumpEpoch();
    state.upsertQuestion({
      id: "q1",
      prompt: "Engine? (changed options)",
      type: "choice",
      options: [
        { value: "mysql", label: "MySQL" },
        { value: "postgres", label: "PostgreSQL" },
      ],
      rev: 2,
      status: "reasked",
    }); // rule 2 reset: answer cleared, status reasked

    // Bridge answers ONLY q2. q1's diff entry (old answer → "(unanswered)")
    // is agent-caused and must NOT ship.
    const out = recordRemoteSubmission(pi, state, answers([{ id: "q2", value: "none" }]));

    expect(out.ok).toBe(true);
    const msg = sent[0] as { content: string; details: { changed: Array<{ id: string }> } };
    expect(msg.details.changed.map((e) => e.id)).toEqual(["q2"]);
    expect(msg.content).toContain("Submitted 1: q2: none");
  });

  test("lifecycle.noteSubmissionDelivered fires AFTER delivery, exactly once", () => {
    const state = fixture();
    const { pi } = makePi();
    const order: string[] = [];
    const lifecycle = {
      noteSubmissionDelivered: () => void order.push("noted"),
    };
    const piWithOrder = { sendMessage: (msg: unknown) => void order.push(`sent:${(msg as { customType: string }).customType}`) };
    recordRemoteSubmission(piWithOrder as unknown as Pick<ExtensionAPI, "sendMessage">, state, answers([{ id: "q1", value: "sqlite" }]), { lifecycle });
    expect(order).toEqual(["sent:interrogation-submission", "noted"]);
    expect(pi).toBeTruthy();
  });

  test("idle → followUp+triggerTurn; busy → steer without triggerTurn", () => {
    const mk = (idle: boolean) => {
      const state = fixture();
      const opts: unknown[] = [];
      const pi = {
        sendMessage: (_msg: unknown, options: unknown) => void opts.push(options),
      };
      const out = recordRemoteSubmission(pi as unknown as Pick<ExtensionAPI, "sendMessage">, state, answers([{ id: "q1", value: "sqlite" }]), { isIdle: () => idle });
      return { opts, out };
    };
    const idle = mk(true);
    expect(idle.out.ok).toBe(true);
    expect(idle.opts).toEqual([{ triggerTurn: true, deliverAs: "followUp" }]);
    const busy = mk(false);
    expect(busy.out.ok).toBe(true);
    expect(busy.opts).toEqual([{ deliverAs: "steer" }]);
  });
});

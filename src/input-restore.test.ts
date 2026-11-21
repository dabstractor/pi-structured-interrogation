/**
 * src/input-restore.test.ts — P3.M3.T1.S1 ladder rules as PURE unit tests
 * (no panel, no fs, no timers): every tier transition, the option-value
 * invariant, and the ancestry-gated durable lookup.
 *
 * Conventions: plain object doubles for DurableRead/DurableValue;
 * answerSeedEligible is exercised as the caller-side gate the panel uses.
 */
import { describe, expect, test } from "vitest";
import {
  answerSeedEligible,
  latestDraftOnLineage,
  recoverySeed,
  recoverySeedText,
  type DurableRead,
  type DurableValue,
  type SeedAnswer,
} from "./input-restore.js";

// ------------------------------------------------------------------ fixtures

/** DurableRead double backed by a branchId → value map (canned latest()). */
function fakeDurable(entries: Record<string, DurableValue | undefined>): DurableRead {
  return {
    latest: (query) => entries[query.branchId],
  };
}

const T0 = "2025-01-01T00:00:00.000Z";

function answer(overrides: Partial<SeedAnswer> = {}): SeedAnswer {
  return { value: "committed write-in", at: T0, custom: true, ...overrides };
}

function durable(overrides: Partial<DurableValue> = {}): DurableValue {
  return { text: "recovery draft", seq: 1, savedAt: "2025-01-01T01:00:00.000Z", ...overrides };
}

/** Base inputs: no slot, no seam, no durable, eligible write-in answer. */
function baseInputs(overrides: Partial<Parameters<typeof recoverySeed>[0]> = {}) {
  return {
    slotText: undefined,
    seamText: undefined,
    durable: undefined,
    answer: answer(),
    answerEligible: true,
    ...overrides,
  };
}

// ------------------------------------------------------------------- ladder

describe("recoverySeedText — tier ladder", () => {
  test("slot wins over everything, deliberate empty preserved", () => {
    const inputs = baseInputs({
      slotText: "",
      seamText: "seam draft",
      durable: durable(),
    });
    expect(recoverySeedText(inputs)).toBe("");
    expect(recoverySeed(inputs)).toEqual({ text: "", tier: "slot" });

    const nonEmpty = baseInputs({ slotText: "slot draft", durable: durable({ text: "newer" }) });
    expect(recoverySeedText(nonEmpty)).toBe("slot draft");
  });

  test("seam wins when slot absent, deliberate empty preserved", () => {
    const inputs = baseInputs({ seamText: "", durable: durable() });
    expect(recoverySeedText(inputs)).toBe("");
    expect(recoverySeed(inputs)).toEqual({ text: "", tier: "seam" });

    const nonEmpty = baseInputs({ seamText: "seam draft", durable: durable({ text: "newer" }) });
    expect(recoverySeedText(nonEmpty)).toBe("seam draft");
  });

  test("durable wins over absent tiers, deliberate durable empty beats an eligible answer", () => {
    // Deliberate durable "" is the NEWEST edit — the empty editor wins over
    // the recorded answer (acceptance case 5 reopen limb).
    const deliberateEmpty = baseInputs({ durable: durable({ text: "" }) });
    expect(recoverySeedText(deliberateEmpty)).toBe("");
    expect(recoverySeed(deliberateEmpty)).toEqual({ text: "", tier: "durable" });

    const draft = baseInputs({ durable: durable({ text: "recovery draft" }) });
    expect(recoverySeedText(draft)).toBe("recovery draft");
  });
});

describe("recoverySeedText — durable vs answer freshness", () => {
  test("durable newer than answer (savedAt > at) → draft wins byte-exact", () => {
    const inputs = baseInputs({
      durable: durable({ text: "half-typed after commit", savedAt: "2025-01-01T00:00:01.000Z" }),
      answer: answer({ at: "2025-01-01T00:00:00.000Z" }),
    });
    expect(recoverySeedText(inputs)).toBe("half-typed after commit");
    expect(recoverySeed(inputs).tier).toBe("durable");
  });

  test("answer newer than draft (applyChatAnswer shape) → answer.value", () => {
    const inputs = baseInputs({
      durable: durable({ savedAt: "2024-12-31T23:00:00.000Z" }),
      answer: answer({ at: "2025-01-01T00:00:00.000Z" }),
    });
    expect(recoverySeedText(inputs)).toBe("committed write-in");
    expect(recoverySeed(inputs).tier).toBe("answer");
  });

  test("tie (savedAt === at) resolves to the answer (ANSWER-PIN conservatism)", () => {
    const inputs = baseInputs({
      durable: durable({ savedAt: T0 }),
      answer: answer({ at: T0 }),
    });
    expect(recoverySeedText(inputs)).toBe("committed write-in");
    expect(recoverySeed(inputs).tier).toBe("answer");
  });

  test("missing durable savedAt resolves to the answer", () => {
    const inputs = baseInputs({ durable: durable({ savedAt: undefined }) });
    expect(recoverySeedText(inputs)).toBe("committed write-in");
    expect(recoverySeed(inputs).tier).toBe("answer");
  });

  test("no answer at all → durable always wins (deliberate '' included)", () => {
    const inputs = baseInputs({ answer: undefined, durable: durable({ text: "" }) });
    expect(recoverySeedText(inputs)).toBe("");
    expect(recoverySeed(inputs).tier).toBe("durable");
  });

  test("no durable and ineligible/absent answer → blank tier", () => {
    expect(recoverySeed(baseInputs({ answerEligible: false }))).toEqual({ text: "", tier: "blank" });
    expect(recoverySeed(baseInputs({ answer: undefined }))).toEqual({ text: "", tier: "blank" });
  });
});

// --------------------------------------------------------------- answer gate

describe("answerSeedEligible — the option-value invariant gate", () => {
  test("custom:true write-in answer is eligible", () => {
    expect(answerSeedEligible("writein", answer({ custom: true }))).toBe(true);
  });

  test("custom:true text-type answer is eligible (custom covers type:text too)", () => {
    expect(answerSeedEligible("writein", answer({ custom: true, value: "typed prose" }))).toBe(true);
  });

  test("option answer (custom unset/false) is NEVER eligible", () => {
    expect(answerSeedEligible("writein", answer({ custom: undefined, value: "a" }))).toBe(false);
    expect(answerSeedEligible("writein", answer({ custom: false, value: "a" }))).toBe(false);
    expect(answerSeedEligible("writein", undefined)).toBe(false);
  });

  test("elaboration duty is NEVER eligible — even for custom answers", () => {
    expect(answerSeedEligible("elaboration", answer({ custom: true }))).toBe(false);
  });

  test("option answer never seeds the editor — ladder falls to blank (no draft tiers)", () => {
    const inputs = baseInputs({
      answer: answer({ custom: undefined, value: "a", at: T0 }),
      answerEligible: false,
    });
    expect(recoverySeedText(inputs)).toBe("");
    expect(recoverySeed(inputs).tier).toBe("blank");
  });

  test("option answer still yields to a real draft tier when one exists", () => {
    const inputs = baseInputs({
      answer: answer({ custom: undefined, value: "a" }),
      answerEligible: false,
      durable: durable({ text: "unrelated note draft" }),
    });
    expect(recoverySeedText(inputs)).toBe("unrelated note draft");
    expect(recoverySeed(inputs).tier).toBe("durable");
  });
});

describe("invariant — option values never leak through the ladder", () => {
  test("for every option answer shape, seed ≠ answer.value unless a draft tier produced it", () => {
    const optionValues = ["a", "b", "", "  a  ", "option-with-✎-lookalike"];
    for (const value of optionValues) {
      for (const at of [T0, "2024-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"]) {
        const opt = answer({ custom: undefined, value, at });
        // No draft tiers → blank, never the option value (even when the
        // option value itself is "" — tier attribution proves it).
        const bare = baseInputs({ answer: opt, answerEligible: answerSeedEligible("writein", opt) });
        const bareSeed = recoverySeed(bare);
        expect(bareSeed.text).toBe("");
        expect(["answer", "durable"]).not.toContain(bareSeed.tier);
        // A durable draft may win — but then its tier says so, and the text
        // came from the draft, not the answer.
        const withDraft = baseInputs({
          answer: opt,
          answerEligible: answerSeedEligible("writein", opt),
          durable: durable({ text: "DRAFT", savedAt: at }),
        });
        const draftSeed = recoverySeed(withDraft);
        if (draftSeed.text === "DRAFT") expect(draftSeed.tier).toBe("durable");
        else expect(draftSeed.tier).toBe("blank");
      }
    }
  });

  test("seed text is returned verbatim — untrimmed, exact bytes", () => {
    const inputs = baseInputs({ answer: answer({ value: "  padded answer  " }) });
    expect(recoverySeedText(inputs)).toBe("  padded answer  ");
    const draft = baseInputs({ durable: durable({ text: "  padded draft  " }) });
    expect(recoverySeedText(draft)).toBe("  padded draft  ");
  });
});

// ------------------------------------------------------------------ ancestry

describe("latestDraftOnLineage — ancestry-gated durable lookup", () => {
  const key = { questionId: "q1", field: "writein" as const };

  test("candidate whose branchId is in the walk is accepted", () => {
    const store = fakeDurable({ tip2: durable({ text: "live draft" }) });
    expect(latestDraftOnLineage(store, ["tip1", "tip2"], key)?.text).toBe("live draft");
  });

  test("sibling-branch branchId NOT in the walk is ignored", () => {
    const store = fakeDurable({ sibling: durable({ text: "other branch draft" }) });
    expect(latestDraftOnLineage(store, ["tip1", "tip2"], key)).toBeUndefined();
  });

  test("cross-branch candidates order by savedAt (never seq)", () => {
    // seq numbers are per-key: the OLDER savedAt carries the HIGHER seq —
    // savedAt must still win.
    const store = fakeDurable({
      tip1: durable({ text: "older draft", seq: 9, savedAt: "2025-01-01T00:00:00.000Z" }),
      tip2: durable({ text: "newer draft", seq: 1, savedAt: "2025-01-01T05:00:00.000Z" }),
    });
    expect(latestDraftOnLineage(store, ["tip1", "tip2"], key)?.text).toBe("newer draft");
  });

  test("savedAt tie → later position in the walk wins", () => {
    const store = fakeDurable({
      tip1: durable({ text: "walk-earlier", savedAt: T0 }),
      tip2: durable({ text: "walk-later", savedAt: T0 }),
    });
    expect(latestDraftOnLineage(store, ["tip1", "tip2"], key)?.text).toBe("walk-later");
  });

  test("missing savedAt is treated as the oldest", () => {
    const store = fakeDurable({
      tip1: durable({ text: "timeless", savedAt: undefined }),
      tip2: durable({ text: "timestamped", savedAt: "2020-01-01T00:00:00.000Z" }),
    });
    expect(latestDraftOnLineage(store, ["tip1", "tip2"], key)?.text).toBe("timestamped");
    // ...and a timeless candidate still wins when it is the only one.
    expect(latestDraftOnLineage(store, ["tip1"], key)?.text).toBe("timeless");
  });

  test("empty walk → undefined; tombstoned/never-captured keys drop out", () => {
    expect(latestDraftOnLineage(fakeDurable({}), [], key)).toBeUndefined();
    const retired = fakeDurable({ tip1: undefined });
    expect(latestDraftOnLineage(retired, ["tip1"], key)).toBeUndefined();
  });

  test("deliberate durable empty {text:'', seq} flows through as a candidate", () => {
    const store = fakeDurable({ tip1: durable({ text: "", seq: 2 }) });
    const found = latestDraftOnLineage(store, ["tip1"], key);
    expect(found).toBeDefined();
    expect(found?.text).toBe("");
    expect(found?.seq).toBe(2);
  });

  test("elaboration field queries are independent of writein records", () => {
    // Field-aware double — the real store's canonical key includes field.
    const store: DurableRead = {
      latest: (query) =>
        query.field === "writein" && query.branchId === "tip1"
          ? durable({ text: "writein draft" })
          : undefined,
    };
    expect(
      latestDraftOnLineage(store, ["tip1"], { questionId: "q1", field: "elaboration" }),
    ).toBeUndefined();
    expect(
      latestDraftOnLineage(store, ["tip1"], { questionId: "q1", field: "writein" })?.text,
    ).toBe("writein draft");
  });

  test("query passes questionId and field verbatim", () => {
    const seen: Array<{ branchId: string; questionId?: string | "-"; field: string }> = [];
    const store: DurableRead = {
      latest: (query) => {
        seen.push({ ...query });
        return undefined;
      },
    };
    latestDraftOnLineage(store, ["a", "b"], { questionId: "q9", field: "elaboration" });
    expect(seen).toEqual([
      { branchId: "a", questionId: "q9", field: "elaboration" },
      { branchId: "b", questionId: "q9", field: "elaboration" },
    ]);
  });
});

// ------------------------------------------------------------- composition

describe("recoverySeed composed with latestDraftOnLineage (panel-shaped flow)", () => {
  test("newer sibling-branch draft does not resurrect onto this branch", () => {
    const store = fakeDurable({ sibling: durable({ text: "other branch", savedAt: "2099-01-01T00:00:00.000Z" }) });
    const resolved = latestDraftOnLineage(store, ["tip1"], { questionId: "q1", field: "writein" });
    const seed = recoverySeed(
      baseInputs({ durable: resolved, answer: answer({ at: "2025-01-01T00:00:00.000Z" }) }),
    );
    expect(seed).toEqual({ text: "committed write-in", tier: "answer" });
  });

  test("live-session draft (tip grown past capture) still resolves via ancestry", () => {
    // Captured at tip1; the walk has since grown to tip3 — the exact-tip
    // lookup would miss it, the ancestry scan must find it.
    const store = fakeDurable({ tip1: durable({ text: "pre-growth draft", savedAt: "2025-06-01T00:00:00.000Z" }) });
    const resolved = latestDraftOnLineage(store, ["tip1", "tip2", "tip3"], { questionId: "q1", field: "writein" });
    const seed = recoverySeed(baseInputs({ durable: resolved }));
    expect(seed).toEqual({ text: "pre-growth draft", tier: "durable" });
  });
});

/**
 * src/draft-store.test.ts — R4 draft store unit coverage (P1.M4.T2.S1).
 *
 * Conventions follow actions.test.ts / panel.test.ts: vitest describe/test,
 * direct construction, no live pi session. The store is a pure in-memory
 * Map wrapper — survival is by WHERE it lives (extension closure), so the
 * meaningful suspend/resume assertion is that two consumers sharing ONE
 * instance see the same drafts, and that the class subscribes to nothing
 * and touches no disk (asserted structurally here + Level 4 greps).
 */
import { describe, expect, test } from "vitest";
import { DraftStore } from "./draft-store.js";
import type { DraftStore as IDraftStore } from "./panel/panel.js";

describe("DraftStore — seam compliance", () => {
  test("test_i_instance_satisfies_the_panel_DraftStore_interface", () => {
    // Type-level check: the class structurally implements panel.ts's seam
    // (getDraft/setDraft/getNote/setNote) exactly.
    const store: IDraftStore = new DraftStore();
    expect(store.getDraft("q1")).toBeUndefined();
    store.setDraft("q1", "typed");
    expect(store.getDraft("q1")).toBe("typed");
    expect(store.getNote()).toBe("");
    store.setNote("note");
    expect(store.getNote()).toBe("note");
  });
});

describe("DraftStore — seam round-trips", () => {
  test("test_i_setDraft_getDraft_roundtrip_unknown_id_is_undefined", () => {
    const store = new DraftStore();
    expect(store.getDraft("q1")).toBeUndefined(); // unknown id
    store.setDraft("q1", "typed text");
    expect(store.getDraft("q1")).toBe("typed text");
    store.setDraft("q1", "edited"); // upsert, not append
    expect(store.getDraft("q1")).toBe("edited");
  });

  test("test_i_setDraftEntry_stores_full_value_text_shape_getDraft_reads_text", () => {
    const store = new DraftStore();
    store.setDraftEntry("q1", { value: "option-a", text: "typed" });
    expect(store.getDraft("q1")).toBe("typed");
    // Full entry is retrievable via shipDrafts (the only entry-returning API).
    const shipped = store.shipDrafts(["q1"]);
    expect(shipped.get("q1")).toEqual({ value: "option-a", text: "typed" });
  });

  test("test_i_setDraft_upserts_value_equal_to_question_id", () => {
    const store = new DraftStore();
    store.setDraft("q3", "long answer");
    const shipped = store.shipDrafts(["q3"]);
    expect(shipped.get("q3")).toEqual({ value: "q3", text: "long answer" });
  });

  test("test_i_getNote_setNote_roundtrip_default_empty_string", () => {
    const store = new DraftStore();
    expect(store.getNote()).toBe("");
    store.setNote("batch note text");
    expect(store.getNote()).toBe("batch note text");
  });
});

describe("DraftStore — hasDraft (✎-marker data)", () => {
  test("test_i_true_for_non_empty_text_false_for_unknown_false_for_empty_text", () => {
    const store = new DraftStore();
    expect(store.hasDraft("q1")).toBe(false); // unknown id
    store.setDraft("q1", "typed");
    expect(store.hasDraft("q1")).toBe(true);
    store.setDraft("q1", ""); // user cleared the field → slot exists, draft absent
    expect(store.hasDraft("q1")).toBe(false);
  });

  test("test_i_hasDraft_true_even_when_clearDraft_default_was_a_noop", () => {
    const store = new DraftStore();
    store.setDraft("q1", "typed");
    store.clearDraft("q1"); // non-explicit → no-op
    expect(store.hasDraft("q1")).toBe(true);
  });
});

describe("DraftStore — clearDraft explicit gate (R4)", () => {
  test("test_i_without_explicit_is_a_noop_returning_false_slot_intact", () => {
    const store = new DraftStore();
    store.setDraft("q1", "typed");
    expect(store.clearDraft("q1")).toBe(false); // default is NO-OP
    expect(store.clearDraft("q1", {})).toBe(false); // explicit absent
    expect(store.clearDraft("q1", { explicit: false })).toBe(false);
    expect(store.getDraft("q1")).toBe("typed"); // slot intact
  });

  test("test_i_with_explicit_true_removes_and_returns_true", () => {
    const store = new DraftStore();
    store.setDraft("q1", "typed");
    expect(store.clearDraft("q1", { explicit: true })).toBe(true);
    expect(store.getDraft("q1")).toBeUndefined();
  });

  test("test_i_explicit_clear_removes_empty_text_slot_too_reports_absent_slot_false", () => {
    const store = new DraftStore();
    store.setDraft("q1", ""); // empty-text slot
    expect(store.clearDraft("q1", { explicit: true })).toBe(true);
    expect(store.clearDraft("missing", { explicit: true })).toBe(false); // nothing to remove
  });
});

describe("DraftStore — clearAll explicit gate (R4)", () => {
  test("test_i_default_noop_leaves_slots_and_note_intact", () => {
    const store = new DraftStore();
    store.setDraft("q1", "a");
    store.setDraft("q2", "b");
    store.setNote("note");
    store.clearAll(); // non-explicit → no-op
    expect(store.getDraft("q1")).toBe("a");
    expect(store.getDraft("q2")).toBe("b");
    expect(store.getNote()).toBe("note");
  });

  test("test_i_explicit_clears_slots_but_keeps_the_batch_note_R3_lifecycle", () => {
    const store = new DraftStore();
    store.setDraft("q1", "a");
    store.setDraft("q2", "b");
    store.setNote("note");
    store.clearAll({ explicit: true });
    expect(store.getDraft("q1")).toBeUndefined();
    expect(store.getDraft("q2")).toBeUndefined();
    expect(store.getNote()).toBe("note"); // note survives clearAll
  });
});

describe("DraftStore — shipDrafts submit flush", () => {
  test("test_i_ships_exactly_the_requested_ids_and_removes_only_them", () => {
    const store = new DraftStore();
    store.setDraft("a", "text-a");
    store.setDraft("b", "text-b");
    store.setDraft("c", "text-c");

    const shipped = store.shipDrafts(["a", "c"]);
    expect(shipped.size).toBe(2);
    expect(shipped.get("a")).toEqual({ value: "a", text: "text-a" });
    expect(shipped.get("c")).toEqual({ value: "c", text: "text-c" });

    expect(store.getDraft("a")).toBeUndefined(); // shipped → destroyed
    expect(store.getDraft("c")).toBeUndefined();
    expect(store.getDraft("b")).toBe("text-b"); // unshipped → preserved
  });

  test("test_i_ship_with_unknown_ids_returns_only_known_entries", () => {
    const store = new DraftStore();
    store.setDraft("a", "text-a");
    const shipped = store.shipDrafts(["a", "missing"]);
    expect(shipped.size).toBe(1);
    expect(shipped.has("missing")).toBe(false);
  });

  test("test_i_ship_without_ids_returns_and_clears_everything", () => {
    const store = new DraftStore();
    store.setDraft("a", "text-a");
    store.setDraft("b", "text-b");
    const shipped = store.shipDrafts();
    expect(shipped.size).toBe(2);
    expect(store.getDraft("a")).toBeUndefined();
    expect(store.getDraft("b")).toBeUndefined();
    expect(store.shipDrafts().size).toBe(0); // second flush is empty
  });

  test("test_i_note_is_never_shipped_or_cleared_by_shipDrafts", () => {
    const store = new DraftStore();
    store.setDraft("a", "text-a");
    store.setNote("note");
    store.shipDrafts();
    expect(store.getNote()).toBe("note");
  });
});

describe("DraftStore — survival matrix (R4, h2.45)", () => {
  test("test_i_two_consumers_sharing_one_store_see_the_same_drafts_suspend_resume_sim", () => {
    // Suspend/resume by construction: the store lives OUTSIDE the panel
    // component, so a fresh consumer (the re-instantiated panel) seeded
    // from the SAME instance rehydrates every draft.
    const store = new DraftStore(); // the extension-closure singleton
    const session1 = store; // panel instance #1 writes through the seam
    session1.setDraft("q3", "user's long answer");
    session1.setNote("batch note");

    // State churn between sessions must not matter: the store subscribes to
    // nothing, so an upsert (even a merge rule 2 answer reset + rev bump)
    // cannot remove the slot — preservation by omission. Simulated by no
    // call at all: there is no API through which an event could clear it.
    const session2 = store; // panel instance #2 after suspend/resume
    expect(session2.getDraft("q3")).toBe("user's long answer");
    expect(session2.getNote()).toBe("batch note");
  });

  test("test_i_navigation_and_view_toggles_are_non_events_for_the_store", () => {
    // Navigation/toggles never touch the store — assert the invariant the
    // panel relies on: writing then "navigating" (no store call) keeps data.
    const store = new DraftStore();
    store.setDraft("q3", "typed");
    // ... user navigates to q7, toggles views, agent upserts q3 ...
    expect(store.getDraft("q3")).toBe("typed");
    expect(store.hasDraft("q3")).toBe(true);
  });

  test("test_i_submit_flow_ships_then_destroys_only_shipped_ids", () => {
    const store = new DraftStore();
    store.setDraft("q1", "changed answer"); // ships (in diff.changed)
    store.setDraft("q2", "untouched draft"); // not in the diff
    const shipped = store.shipDrafts(["q1"]); // actions.ts submit flush shape
    expect([...shipped.keys()]).toEqual(["q1"]);
    expect(store.getDraft("q1")).toBeUndefined();
    expect(store.getDraft("q2")).toBe("untouched draft");
  });

  test("test_i_explicit_clear_destroys_exactly_one_slot", () => {
    const store = new DraftStore();
    store.setDraft("q1", "a");
    store.setDraft("q2", "b");
    expect(store.clearDraft("q1", { explicit: true })).toBe(true);
    expect(store.getDraft("q1")).toBeUndefined();
    expect(store.getDraft("q2")).toBe("b");
  });
});

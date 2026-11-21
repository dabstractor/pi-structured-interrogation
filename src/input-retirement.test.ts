/**
 * src/input-retirement.test.ts — retirement semantics, tombstone
 * anti-resurrection, and acceptance cases 2/3 (S3-owned limbs)
 * (P3.M2.T1.S3; spec state-and-persistence.md §Local input recovery
 * :139-149; architecture note input-recovery.md §retirement :222-251).
 *
 * Conventions: REAL os.tmpdir() fs (config.test.ts fixture — the durable
 * store's atomic protocol cannot be tested with mocks) + fault injection
 * via a DurableFs wrapper (input-durability.test.ts pattern); fake timers
 * ONLY for the capture store's pacing clock (plain setTimeout, no
 * intervals). Stores are COMPOSED in the index.ts wiring shape:
 * sink → durable.write, seedSeq → durable.lastSeq, onRetire →
 * durable.retire({explicit:true}) — the retired seam is always the
 * composed one.
 *
 * The three retirement exits under test here:
 * 1. Deliberate discard = the user's own delete-to-empty — replacement by
 *    the minted-seq empty save ({text:"", seq}); the FILE STAYS (P3.M3
 *    seeds a blank editor, not the prior answer). Never unlinked here.
 * 2. Replacement = newer-seq save replaces in place (S2 monotonic guard).
 * 3. Successful handoff = EXPLICIT retire AFTER the handoff — file gone,
 *    tombstone left, stragglers can never resurrect it.
 *
 * Refused/failed/aborted sends retire NOTHING — that half is behavioral
 * and lives in src/panel/retirement-sidechat.test.ts.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  InputCaptureStore,
  type CaptureKey,
  type CaptureRecord,
  type CaptureSink,
} from "./input-capture.js";
import { DurableInputStore, type DurableFs, type WriteOutcome } from "./input-durability.js";

// ------------------------------------------------------------------ fixtures

/** Fresh temp dir per test, removed in afterEach (real fs, never ~/.pi). */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-interrogator-retire-"));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function key(partial: Partial<CaptureKey> & { field: CaptureKey["field"] }): CaptureKey {
  return { branchId: "branch-1", questionId: "q1", ...partial };
}

const WRITEIN_KEY = key({ field: "writein" });

/**
 * Fault adapter (input-durability.test.ts pattern): the REAL node:fs
 * functions; rmSync can be made to throw on demand (a failed retire).
 */
class FaultFs implements DurableFs {
  failOn: string | null = null;
  private chk(name: string): void {
    if (this.failOn === name) throw new Error(`injected fault: ${name}`);
  }
  existsSync(p: string): boolean {
    return fs.existsSync(p);
  }
  mkdirSync(p: string, opts: { recursive: true }): string | undefined {
    this.chk("mkdirSync");
    return fs.mkdirSync(p, opts);
  }
  readdirSync(p: string): string[] {
    return fs.readdirSync(p, "utf-8");
  }
  readFileSync(p: string, encoding: "utf-8"): string {
    return fs.readFileSync(p, encoding);
  }
  openSync(p: string, flags: "w" | "r"): number {
    this.chk("openSync");
    return fs.openSync(p, flags);
  }
  writeSync(fd: number, data: string): number {
    this.chk("writeSync");
    return fs.writeSync(fd, data);
  }
  fsyncSync(fd: number): void {
    this.chk("fsyncSync");
    return fs.fsyncSync(fd);
  }
  closeSync(fd: number): void {
    return fs.closeSync(fd);
  }
  renameSync(from: string, to: string): void {
    this.chk("renameSync");
    return fs.renameSync(from, to);
  }
  rmSync(p: string, opts?: { force?: boolean }): void {
    this.chk("rmSync");
    return fs.rmSync(p, opts);
  }
}

/**
 * Composed stores in the index.ts wiring shape — ONE helper so every test
 * exercises the same seam graph production uses. `outcomes` records every
 * sink delivery's WriteOutcome (the durable write is never-throwing, so
 * the outcome value is the only observable).
 */
function makeComposedStores(options: { fs?: DurableFs } = {}): {
  capture: InputCaptureStore;
  durable: DurableInputStore;
  outcomes: WriteOutcome[];
  retiredKeys: CaptureKey[];
  dir: string;
} {
  const dir = tmpDir();
  const durable = new DurableInputStore({ dir, ...(options.fs !== undefined ? { fs: options.fs } : {}) });
  const outcomes: WriteOutcome[] = [];
  const retiredKeys: CaptureKey[] = [];
  const capture = new InputCaptureStore({
    sink: (record) => {
      outcomes.push(durable.write(record));
    },
    session: () => "sess-1",
    seedSeq: (k) => durable.lastSeq(k),
    onRetire: (k) => {
      retiredKeys.push(k);
      durable.retire(k, { explicit: true });
    },
  });
  return { capture, durable, outcomes, retiredKeys, dir };
}

function jsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
}

/** Capture `text` under `k` and let the pacing clock deliver it. */
function typeAndFlush(capture: InputCaptureStore, k: CaptureKey, text: string): void {
  capture.setKeyDirty(k, () => text);
  vi.advanceTimersByTime(250);
}

// ---------------------------------------------------------------- retire units

describe("retire units — explicit guard, drop-pending, tombstone (P3.M2.T1.S3)", () => {
  test("non-explicit retire is a NO-OP at both layers (draft-store.ts:111 guard)", () => {
    const { capture, durable, retiredKeys, dir } = makeComposedStores();
    typeAndFlush(capture, WRITEIN_KEY, "typed");
    expect(jsonFiles(dir)).toHaveLength(1);

    // Capture layer: no flag ⇒ no pending drop, no lastValue clear, no forward.
    capture.setKeyDirty(WRITEIN_KEY, () => "typed v2");
    capture.retire(WRITEIN_KEY); // no opts
    capture.retire(WRITEIN_KEY, {}); // empty opts
    expect(retiredKeys).toEqual([]); // onRetire never fired
    vi.advanceTimersByTime(250);
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("typed v2"); // pending FLUSHED, not dropped

    // Durable layer: no flag ⇒ file intact, no tombstone.
    expect(durable.retire({ ...WRITEIN_KEY })).toBe("ignored");
    expect(durable.retire({ ...WRITEIN_KEY }, {})).toBe("ignored");
    expect(durable.latest(WRITEIN_KEY)).toEqual({ text: "typed v2", seq: 2, savedAt: expect.any(String) });
    expect(jsonFiles(dir)).toHaveLength(1); // file NOT removed
  });

  test("explicit capture retire: drops pending (never flushes), keeps seq, re-typed same text re-mints, fires onRetire", () => {
    const { capture, durable, retiredKeys, outcomes } = makeComposedStores();
    typeAndFlush(capture, WRITEIN_KEY, "v1"); // seq 1 — the "handed off" value
    expect(durable.lastSeq(WRITEIN_KEY)).toBe(1);

    // Arm a pending dirty entry, THEN retire: the pending text must NEVER
    // flush (flush-then-retire after the durable unlink = resurrection).
    capture.setKeyDirty(WRITEIN_KEY, () => "pre-handoff straggler");
    capture.retire(WRITEIN_KEY, { explicit: true });
    vi.advanceTimersByTime(5000); // far past every timer
    expect(outcomes).toHaveLength(1); // no second sink delivery ever fired
    // The COMPOSED retire completed: the durable value is GONE (tombstone
    // at the handed-off seq) — retirement, not preservation, is the point.
    expect(durable.latest(WRITEIN_KEY)).toBeUndefined();
    expect(durable.lastSeq(WRITEIN_KEY)).toBe(1); // tombstone keeps the baseline
    expect(retiredKeys).toEqual([WRITEIN_KEY]); // forwarder fired EXACTLY once

    // Seq counter preserved: the next mint is prev+1 (above any tombstone).
    capture.setKeyDirty(WRITEIN_KEY, () => "v1"); // SAME text as pre-retire —
    // the lastValue gate was cleared, so this re-mints (capturable again).
    vi.advanceTimersByTime(250);
    expect(durable.latest(WRITEIN_KEY)?.seq).toBe(2); // fresh seq above seq 1
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("v1");
  });

  test("explicit durable retire: file gone, latest() undefined, lastSeq() = tombstone seq, never throws", () => {
    const { capture, durable, dir } = makeComposedStores();
    typeAndFlush(capture, WRITEIN_KEY, "handed off");
    const file = jsonFiles(dir);
    expect(file).toHaveLength(1);

    expect(durable.retire({ ...WRITEIN_KEY }, { explicit: true })).toBe("retired");
    expect(jsonFiles(dir)).toEqual([]); // unlink happened
    expect(durable.latest(WRITEIN_KEY)).toBeUndefined(); // reads as never-captured
    expect(durable.lastSeq(WRITEIN_KEY)).toBe(1); // tombstone keeps the ordering baseline
    expect(fs.existsSync(path.join(dir, file[0]!))).toBe(false);
  });

  test("straggler write seq <= tombstone → ignored-stale, file NOT recreated; seq > tombstone → written", () => {
    const { capture, durable, dir, outcomes } = makeComposedStores();
    typeAndFlush(capture, WRITEIN_KEY, "v1"); // durable seq 1
    typeAndFlush(capture, WRITEIN_KEY, "v2"); // durable seq 2
    capture.retire(WRITEIN_KEY, { explicit: true }); // tombstone at seq 2, file gone
    expect(jsonFiles(dir)).toEqual([]);

    // A still-pending OLDER delivery (the resurrection hazard the tombstone
    // exists for): seq 1 AND seq 2 both land after the unlink.
    const stale1: CaptureRecord = { ...WRITEIN_KEY, session: "sess-1", text: "v1", seq: 1 };
    const stale2: CaptureRecord = { ...WRITEIN_KEY, session: "sess-1", text: "v2", seq: 2 };
    expect(durable.write(stale1)).toBe("ignored-stale");
    expect(durable.write(stale2)).toBe("ignored-stale");
    expect(jsonFiles(dir)).toEqual([]); // NO resurrection — file never recreated
    expect(durable.latest(WRITEIN_KEY)).toBeUndefined();

    // A GENUINE post-handoff re-edit mints ABOVE the tombstone and captures.
    typeAndFlush(capture, WRITEIN_KEY, "genuine re-edit");
    expect(outcomes[outcomes.length - 1]).toBe("written");
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("genuine re-edit");
    expect(durable.latest(WRITEIN_KEY)?.seq).toBe(3); // above the tombstone (2)
    expect(jsonFiles(dir)).toHaveLength(1);
  });

  test("retire never throws: throwing onRetire is isolated; rmSync fault → ignored, no tombstone; unknown key is harmless", () => {
    // A hostile retirement forwarder must never break the retire path —
    // retire runs inside commit/settle call sites (never-throw contract).
    const durable = new DurableInputStore({ dir: tmpDir() });
    const capture = new InputCaptureStore({
      onRetire: () => {
        throw new Error("hostile forwarder");
      },
    });
    expect(() => capture.retire(WRITEIN_KEY, { explicit: true })).not.toThrow();

    // A failed unlink leaves the durable value AND leaves no tombstone
    // (tombstoning without unlinking would strand latest() at undefined
    // while the file lives on — worse than a leftover file).
    const faultFs = new FaultFs();
    const d2 = tmpDir();
    const durable2 = new DurableInputStore({ dir: d2, fs: faultFs });
    durable2.write({ ...WRITEIN_KEY, session: "sess-1", text: "kept", seq: 1 });
    faultFs.failOn = "rmSync";
    expect(durable2.retire({ ...WRITEIN_KEY }, { explicit: true })).toBe("ignored");
    expect(durable2.latest(WRITEIN_KEY)?.text).toBe("kept"); // value stands
    expect(durable2.lastSeq(WRITEIN_KEY)).toBe(1); // NOT tombstoned
    faultFs.failOn = null;
    expect(durable2.retire({ ...WRITEIN_KEY }, { explicit: true })).toBe("retired");

    // A key never captured retires harmlessly (uniform semantics; behaves
    // identically to never-captured — tombstone at seq 0).
    const neverKey = key({ questionId: "q-none", field: "note" });
    expect(durable.retire({ ...neverKey }, { explicit: true })).toBe("retired");
    expect(durable.latest(neverKey)).toBeUndefined();
    expect(durable.lastSeq(neverKey)).toBe(0);
    expect(durable.write({ ...neverKey, session: "sess-1", text: "fresh", seq: 1 })).toBe("written");
  });

  test("composed end-to-end: capture retire → onRetire → durable tombstone; the restart shape seeds above retirement", () => {
    const { capture, durable, retiredKeys, dir } = makeComposedStores();
    typeAndFlush(capture, WRITEIN_KEY, "handed off");
    capture.retire(WRITEIN_KEY, { explicit: true });
    expect(retiredKeys).toEqual([WRITEIN_KEY]);
    expect(durable.latest(WRITEIN_KEY)).toBeUndefined();

    // RESTART SHAPE (tombstones are in-memory only): a FRESH durable over
    // the same dir scans NO file for the key — retired reads exactly like
    // never-captured, so P3.M3's seeding ladder falls through to blank.
    const restarted = new DurableInputStore({ dir });
    expect(restarted.latest({ ...WRITEIN_KEY })).toBeUndefined();
    expect(restarted.lastSeq({ ...WRITEIN_KEY })).toBe(0); // nothing on disk
    expect(jsonFiles(dir)).toEqual([]); // the retired file stayed gone

    // And a FRESH capture store seeded from a durable lastSeq (the index.ts
    // seedSeq wiring) mints STRICTLY above the retirement point — the
    // restart-clobber hole stays closed across a retirement.
    const sink = vi.fn();
    const restartedCapture = new InputCaptureStore({
      sink: sink as unknown as CaptureSink,
      session: () => "sess-1",
      seedSeq: (k) => durable.lastSeq(k), // the tombstone baseline (1)
    });
    restartedCapture.setKeyDirty(WRITEIN_KEY, () => "post-restart edit");
    vi.advanceTimersByTime(250);
    expect((sink.mock.calls[0][0] as CaptureRecord).seq).toBe(2); // 1 + 1
  });
});

// ------------------------------------------------------------- acceptance case 2

describe("acceptance case 2 — continuous typing progresses without idle, byte-exact final value", () => {
  test("case 2: edits every 200ms for 3s (no idle) flush ≥2 durable saves mid-typing; final latest() = exact expanded string", () => {
    const { capture, durable, outcomes, dir } = makeComposedStores();

    // The exact expanded string (multiline Unicode + surrounding whitespace)
    // — the FINAL paste is the text that must be recoverable byte-exact.
    const EXACT = "  lead\nline2\tあé…🜂\ntrail  ";

    // Continuous typing: a mutation every 200ms — closer together than the
    // 250ms pacing window, so the typing NEVER pauses (no idle gap) across
    // the whole 3s. Progress must still happen (spec :137 "Saving must
    // progress during continuous typing; do not wait indefinitely for
    // idle, send, blur, suspend or shutdown" — the S1 pacing clock:
    // either the re-armed debounce cadence or the 1000ms max-dirty-age
    // deadline, "either way: progress WITHOUT idle").
    let typed = "";
    let seqProgressedTwo = false;
    for (let i = 0; i < 15; i++) {
      typed += `edit ${i} `;
      capture.setKeyDirty(WRITEIN_KEY, () => typed);
      vi.advanceTimersByTime(200); // NO 250ms idle ever
      if (durable.lastSeq(WRITEIN_KEY) >= 2) seqProgressedTwo = true;
    }
    // Mid-typing (before any idle/blir/send accelerator): the durable layer
    // already holds ≥2 completed saves from the pacing clock alone.
    expect(seqProgressedTwo).toBe(true);
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
    for (const o of outcomes) expect(o).toBe("written"); // each flush durable

    // The FINAL gesture is the paste: one mutation carrying the exact
    // expanded string. Advance past the 1000ms max-dirty-age deadline —
    // the deadline guarantees the flush no matter what the user does next.
    capture.setKeyDirty(WRITEIN_KEY, () => EXACT);
    vi.advanceTimersByTime(1000);
    expect(outcomes[outcomes.length - 1]).toBe("written");

    const final = durable.latest(WRITEIN_KEY);
    expect(final?.text).toBe(EXACT); // BYTE-exact — never a preview/placeholder
    expect(final?.text).toBe(capture.latest(WRITEIN_KEY)?.text); // layers agree
    expect(final?.seq).toBe(capture.latest(WRITEIN_KEY)?.seq);
    expect(jsonFiles(dir)).toHaveLength(1);
  });
});

// ------------------------------------------------------------- acceptance case 3

describe("acceptance case 3 — failed write keeps both values; delayed writes never clobber or resurrect; branches isolate at file level", () => {
  test("case 3a: failed write → no false progress; last durable value AND live edit both kept", () => {
    const faultFs = new FaultFs();
    const { capture, durable, outcomes } = makeComposedStores({ fs: faultFs });
    typeAndFlush(capture, WRITEIN_KEY, "last good save"); // seq 1 lands
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("last good save");

    faultFs.failOn = "writeSync";
    typeAndFlush(capture, WRITEIN_KEY, "live edit in memory"); // seq 2 FAILS
    faultFs.failOn = null;

    expect(outcomes[outcomes.length - 1]).toBe("failed"); // honest outcome —
    // there is structurally no "saved" surface (the static scanner proves
    // the modules export none), so no false indication can exist.
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("last good save"); // durable kept
    expect(durable.latest(WRITEIN_KEY)?.seq).toBe(1);
    expect(capture.latest(WRITEIN_KEY)?.text).toBe("live edit in memory"); // live edit kept
    // NO spurious re-flush: the failed flush consumed the pending entry and
    // the mint gate holds the text, so nothing retries until the user's
    // NEXT differing edit (S1/S2 shipped semantics — only completed saves
    // are promised recoverable; no retry storm, no background loop).
    vi.advanceTimersByTime(5000);
    expect(outcomes).toHaveLength(2);
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("last good save");
  });

  test("case 3b: delayed older write past a newer edit AND past a delete-to-empty discard → ignored-stale both times", () => {
    const { capture, durable, dir } = makeComposedStores();
    typeAndFlush(capture, WRITEIN_KEY, "old text"); // seq 1
    typeAndFlush(capture, WRITEIN_KEY, "newer text"); // seq 2 (replacement — exit 2)
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("newer text");

    // A delayed OLDER delivery (a stale sink flush from before the newer
    // edit) must never clobber:
    expect(
      durable.write({ ...WRITEIN_KEY, session: "sess-1", text: "old text", seq: 1 }),
    ).toBe("ignored-stale");
    expect(durable.latest(WRITEIN_KEY)?.text).toBe("newer text"); // no clobber

    // THE DELIBERATE DISCARD (exit 1): the user deletes to empty — a
    // DELIBERATE empty IS an edit: it mints seq 3 and captures "". S2
    // replaces the value IN PLACE: the file STAYS (P3.M3 seeds a blank
    // editor, not the prior answer — spec :140). Never unlink on empty-save.
    typeAndFlush(capture, WRITEIN_KEY, ""); // delete-to-empty by the user
    const discarded = durable.latest(WRITEIN_KEY);
    expect(discarded).toEqual({ text: "", seq: 3, savedAt: expect.any(String) });
    expect(jsonFiles(dir)).toHaveLength(1); // file NOT unlinked
    // and the file on disk holds the empty record, not the prior answer:
    const raw = JSON.parse(fs.readFileSync(path.join(dir, jsonFiles(dir)[0]!), "utf-8"));
    expect(raw.text).toBe("");

    // Delayed writes from BEFORE the discard can never resurrect the
    // discarded text (no unlink happened — but the monotonic guard still
    // rejects them, and the empty record stands):
    expect(
      durable.write({ ...WRITEIN_KEY, session: "sess-1", text: "old text", seq: 1 }),
    ).toBe("ignored-stale");
    expect(
      durable.write({ ...WRITEIN_KEY, session: "sess-1", text: "newer text", seq: 2 }),
    ).toBe("ignored-stale");
    expect(durable.latest(WRITEIN_KEY)?.text).toBe(""); // the discard stands
    expect(JSON.parse(fs.readFileSync(path.join(dir, jsonFiles(dir)[0]!), "utf-8")).text).toBe("");
  });

  test("case 3c: same questionId on two branches → distinct files; retiring one leaves the other intact", () => {
    const { capture, durable, dir } = makeComposedStores();
    const branchA = key({ branchId: "branch-A", field: "writein" });
    const branchB = key({ branchId: "branch-B", field: "writein" });
    typeAndFlush(capture, branchA, "typed on A");
    typeAndFlush(capture, branchB, "typed on B");
    expect(jsonFiles(dir)).toHaveLength(2); // file-level isolation
    expect(durable.latest(branchA)?.text).toBe("typed on A");
    expect(durable.latest(branchB)?.text).toBe("typed on B");

    // Handoff on A retires ONLY A's recovery value:
    capture.retire(branchA, { explicit: true });
    expect(jsonFiles(dir)).toHaveLength(1); // A's file gone, B's stands
    expect(durable.latest(branchA)).toBeUndefined();
    expect(durable.latest(branchB)?.text).toBe("typed on B"); // untouched

    // A straggler for A cannot resurrect into B's slot either:
    expect(
      durable.write({ ...branchA, session: "sess-1", text: "typed on A", seq: 1 }),
    ).toBe("ignored-stale");
    expect(jsonFiles(dir)).toHaveLength(1);
    expect(durable.latest(branchB)?.text).toBe("typed on B");

    // B's own editing continues independently (seq counters are per-key):
    typeAndFlush(capture, branchB, "typed on B v2");
    expect(durable.latest(branchB)?.text).toBe("typed on B v2");
    expect(durable.latest(branchB)?.seq).toBe(2);
    // (the ancestry restore GATE — which of these a restart may seed — is
    // P3.M3.T1.S2's seam and is deliberately not asserted here)
  });
});

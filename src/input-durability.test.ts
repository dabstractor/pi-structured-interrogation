/**
 * src/input-durability.test.ts — the scripted atomicity / monotonicity /
 * honest-failure / load-integrity matrix for P3.M2.T1.S2.
 *
 * Conventions: REAL os.tmpdir() fs (config.test.ts fixture — atomicity
 * cannot be tested with mocks) + fault injection via a DurableFs wrapper
 * whose individual protocol steps throw on demand; fake timers ONLY where
 * S1's InputCaptureStore is composed in (its pacing clock).
 *
 * Every interrupt instant of the write protocol is exercised: at each
 * faulted step the durable file must still hold the previous COMPLETE
 * value (never torn — payloads share 200-char prefix/suffix bookends so
 * any partial is detectable), the outcome must be "failed", and a later
 * healthy write must still land.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DurableInputStore, type DurableFs } from "./input-durability.js";
import { InputCaptureStore, type CaptureKey } from "./input-capture.js";

// ------------------------------------------------------------------ fixtures

/** Fresh temp dir per test, removed in afterEach (real fs, never ~/.pi). */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-interrogator-dur-"));
  dirs.push(d);
  return d;
}

const K = { branchId: "branch-1", questionId: "q1", field: "writein" as const };

function rec(text: string, seq: number): {
  session: string;
  branchId: string;
  questionId: string;
  field: "writein";
  text: string;
  seq: number;
} {
  return { session: "sess-1", branchId: K.branchId, questionId: K.questionId, field: K.field, text, seq };
}

function onlyJsonFile(dir: string): string {
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  expect(files).toHaveLength(1);
  return path.join(dir, files[0]);
}

/**
 * Fault adapter: wraps the REAL node:fs functions; any single protocol
 * step can be made to throw on demand (`failOn`), and tmp cleanup can be
 * suppressed (`failRm`) so leftovers survive a failed write.
 */
class FaultFs implements DurableFs {
  failOn: string | null = null;
  failRm = false;
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
    this.chk("readdirSync");
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
    this.chk("closeSync");
    return fs.closeSync(fd);
  }
  renameSync(from: string, to: string): void {
    this.chk("renameSync");
    return fs.renameSync(from, to);
  }
  rmSync(p: string, opts?: { force?: boolean }): void {
    if (this.failRm) throw new Error("injected fault: rmSync");
    return fs.rmSync(p, opts);
  }
}

/** Torn detector: A/B share 200-char bookends, differ only in the middle. */
const BOOKEND = "L".repeat(200);
const A_TEXT = `${BOOKEND}FIRST-middle-abc${BOOKEND}`;
const B_TEXT = `${BOOKEND}SECOND-middle-xyz-longer-payload${BOOKEND}`;

// ------------------------------------------------------- atomic-replace group

describe("atomic replace — fault injection at every protocol step", () => {
  const faultPoints = ["openSync", "writeSync", "fsyncSync", "closeSync", "renameSync"] as const;

  for (const point of faultPoints) {
    test(`fault at ${point} leaves the previous complete value, never torn`, () => {
      const dir = tmpDir();
      const ffs = new FaultFs();
      const store = new DurableInputStore({ dir, fs: ffs, now: () => "t0" });

      expect(store.write(rec(A_TEXT, 1))).toBe("written");
      const file = onlyJsonFile(dir);

      ffs.failOn = point;
      expect(store.write(rec(B_TEXT, 2))).toBe("failed");
      ffs.failOn = null;

      // The durable file parses and equals EXACTLY A (byte-exact value).
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as { text: string; seq: number; v: number };
      expect(raw.v).toBe(1);
      expect(raw.seq).toBe(1);
      expect(raw.text).toBe(A_TEXT);
      // No .tmp leftover survived the failed write's own cleanup.
      expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);

      // A subsequent healthy write still lands.
      expect(store.write(rec(B_TEXT, 2))).toBe("written");
      expect(store.latest(K)?.text).toBe(B_TEXT);
    });
  }

  test("rename-fault .tmp leftover is removed by a FRESH store, which still reads A", () => {
    const dir = tmpDir();
    const ffs = new FaultFs();
    const store = new DurableInputStore({ dir, fs: ffs });
    expect(store.write(rec(A_TEXT, 1))).toBe("written");

    ffs.failOn = "renameSync";
    ffs.failRm = true; // suppress the write path's own cleanup
    expect(store.write(rec(B_TEXT, 2))).toBe("failed");
    ffs.failOn = null;
    ffs.failRm = false;
    expect(fs.readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(true);

    const fresh = new DurableInputStore({ dir }); // simulated restart over the dir
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(fresh.latest(K)?.text).toBe(A_TEXT);
  });
});

// ------------------------------------------------------------ monotonic group

describe("monotonic guard — older writes and counter resets can never win", () => {
  test("stale seq ignored byte-identical; equal seq idempotent; newer replaces", () => {
    const dir = tmpDir();
    const store = new DurableInputStore({ dir });
    expect(store.write(rec("v5", 5))).toBe("written");
    const file = onlyJsonFile(dir);
    const before = fs.readFileSync(file);

    expect(store.write(rec("v3", 3))).toBe("ignored-stale"); // acceptance case 3
    expect(fs.readFileSync(file).equals(before)).toBe(true); // file untouched

    expect(store.write(rec("v5-again", 5))).toBe("written"); // seq >= durable proceeds
    expect(store.write(rec("v6", 6))).toBe("written");
    expect(store.latest(K)).toMatchObject({ text: "v6", seq: 6 });
  });

  test("restart: fresh store reports lastSeq; naive counter-reset rejected; seeded edit written", () => {
    vi.useFakeTimers();
    try {
      const dir = tmpDir();
      const store1 = new DurableInputStore({ dir });
      store1.write(rec("v6", 6));
      store1.write(rec("v7", 7));

      const store2 = new DurableInputStore({ dir }); // restart over the same dir
      expect(store2.lastSeq(K)).toBe(7);
      expect(store2.latest(K)?.text).toBe("v7");

      // A naive fresh counter (the restart-clobber hole) is REJECTED.
      expect(store2.write(rec("reset", 1))).toBe("ignored-stale");

      // S1 composed with the seedSeq hook: first mint continues at 8.
      const minted: { seq: number; text: string }[] = [];
      const capture = new InputCaptureStore({
        sink: (r) => {
          minted.push({ seq: r.seq, text: r.text });
          store2.write(r);
        },
        seedSeq: (key) => store2.lastSeq(key),
        session: () => "sess-1",
      });
      capture.setKeyDirty(K, () => "post-restart edit");
      vi.advanceTimersByTime(250);

      expect(minted).toHaveLength(1);
      expect(minted[0].seq).toBe(8); // seeded: > durable 7, a monotonic continuation
      expect(store2.latest(K)).toMatchObject({ text: "post-restart edit", seq: 8 });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ------------------------------------------------------ incidental-empty group

describe("incidental-empty guards — empties never clobber, deliberate empty writes", () => {
  test("empty with NO prior record: skipped, no file, not even a directory", () => {
    const dir = tmpDir();
    const store = new DurableInputStore({ dir });
    expect(store.write(rec("", 1))).toBe("skipped-empty");
    expect(fs.readdirSync(dir)).toEqual([]); // no file created — mkdir never even ran
  });

  test("delete-to-empty over a prior record writes; latest is {text:\"\", seq}, not undefined", () => {
    const dir = tmpDir();
    const store = new DurableInputStore({ dir });
    store.write(rec("draft", 1));
    expect(store.write(rec("", 2))).toBe("written");
    expect(store.latest(K)).toEqual({ text: "", seq: 2, savedAt: expect.any(String) });
    const raw = JSON.parse(fs.readFileSync(onlyJsonFile(dir), "utf-8")) as { text: string };
    expect(raw.text).toBe("");
    expect(store.latest(K)).not.toBeUndefined();
  });

  test("non-finite and non-positive seq records are classified incidental (never win)", () => {
    const dir = tmpDir();
    const store = new DurableInputStore({ dir });
    store.write(rec("v1", 1));
    expect(store.write(rec("NaN", Number.NaN))).toBe("skipped-empty");
    expect(store.write(rec("zero", 0))).toBe("skipped-empty");
    expect(store.latest(K)?.text).toBe("v1");
  });
});

// --------------------------------------------------------- honest-failure group

describe("honest failure — composed S1 wiring: both values kept, nothing claimed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("failed flush keeps last durable value AND live edit; in-flight write not promised", () => {
    const dir = tmpDir();
    const ffs = new FaultFs();
    const durable = new DurableInputStore({ dir, fs: ffs });
    const capture = new InputCaptureStore({
      sink: (r) => {
        durable.write(r); // never throws — outcome value only
      },
      seedSeq: (key) => durable.lastSeq(key),
      session: () => "sess-1",
    });

    capture.setKeyDirty(K, () => "A");
    vi.advanceTimersByTime(250); // healthy flush: A durable
    expect(durable.latest(K)).toMatchObject({ text: "A", seq: 1 });

    ffs.failOn = "writeSync"; // the disk starts failing
    capture.setKeyDirty(K, () => "B");
    expect(() => vi.advanceTimersByTime(250)).not.toThrow(); // nothing escapes the sink
    ffs.failOn = null;
    expect(durable.latest(K)?.text).toBe("A"); // last durable value kept
    expect(capture.latest(K)?.text).toBe("B"); // live edit kept in S1 memory — BOTH values

    // Edit again 100ms into the 250ms debounce, then simulate a kill
    // BEFORE the flush: only the last COMPLETED save is recoverable.
    capture.setKeyDirty(K, () => "B2");
    vi.advanceTimersByTime(100);
    const fresh = new DurableInputStore({ dir });
    expect(fresh.latest(K)?.text).toBe("A"); // in-flight/mid-debounce NOT promised
    expect(fresh.lastSeq(K)).toBe(1);
  });
});

// --------------------------------------------------------- load-integrity group

describe("load integrity — tolerant construction scan", () => {
  test("missing dir tolerated: empty index, first write creates the dir", () => {
    const dir = path.join(tmpDir(), "absent");
    const store = new DurableInputStore({ dir });
    expect(store.lastSeq(K)).toBe(0);
    expect(store.latest(K)).toBeUndefined();
    expect(store.write(rec("hello", 1))).toBe("written");
    expect(store.latest(K)?.text).toBe("hello");
  });

  test("corrupt JSON skipped without throw and left on disk", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "input-corrupt-xyz.json"), "{not json{{");
    const store = new DurableInputStore({ dir });
    expect(store.lastSeq(K)).toBe(0);
    expect(fs.existsSync(path.join(dir, "input-corrupt-xyz.json"))).toBe(true);
  });

  test("foreign payloads (wrong v / missing fields) skipped; valid sibling indexed", () => {
    const dir = tmpDir();
    const valid = rec("good", 3);
    const payload = { v: 1, key: { session: valid.session, branchId: valid.branchId, questionId: valid.questionId, field: valid.field }, text: valid.text, seq: valid.seq, savedAt: "t" };
    const otherBranch = { ...payload, key: { ...payload.key, branchId: "other" }, seq: 9 };
    fs.writeFileSync(path.join(dir, "input-badv-a.json"), JSON.stringify({ ...payload, v: 2 }));
    fs.writeFileSync(path.join(dir, "input-badv-b.json"), JSON.stringify({ v: 1, text: "x" }));
    fs.writeFileSync(path.join(dir, "input-good-abc.json"), JSON.stringify(payload));
    const store = new DurableInputStore({ dir });
    expect(store.lastSeq(K)).toBe(3);
    expect(store.lastSeq({ branchId: "other", questionId: "q1", field: "writein" })).toBe(0);
    void otherBranch;
  });

  test("duplicate canonical keys across filenames: the PARSED key indexes, higher seq wins", () => {
    const dir = tmpDir();
    const store1 = new DurableInputStore({ dir });
    store1.write(rec("older", 2));
    const first = onlyJsonFile(dir);
    const payload = JSON.parse(fs.readFileSync(first, "utf-8")) as {
      key: unknown;
      text: string;
      seq: number;
      savedAt: string;
    };
    // Same canonical key payload under an ARBITRARY other filename, seq 9.
    const forged = { ...payload, text: "newer", seq: 9, savedAt: "t9" };
    fs.writeFileSync(path.join(dir, "input-arbitrary-name.json"), JSON.stringify(forged));
    const store2 = new DurableInputStore({ dir });
    expect(store2.lastSeq(K)).toBe(9); // indexed by parsed payload key, not filename
    expect(store2.latest(K)?.text).toBe("newer");
  });

  test("byte-exact round-trips: whitespace, unicode, deliberate empty", () => {
    const values = ["  leading\nline2\t", "あé…🜂", "trailing   ", ""];
    for (const value of values) {
      const dir = tmpDir();
      const store = new DurableInputStore({ dir, now: () => "t" });
      if (value === "") {
        store.write(rec("x", 1)); // deliberate empty needs a prior record
        expect(store.write(rec("", 2))).toBe("written");
      } else {
        expect(store.write(rec(value, 1))).toBe("written");
      }
      const raw = JSON.parse(fs.readFileSync(onlyJsonFile(dir), "utf-8")) as { text: string };
      expect(raw.text).toBe(value);
      const fresh = new DurableInputStore({ dir });
      expect(fresh.latest(K)?.text).toBe(value);
      expect(fresh.latest(K)).not.toBeUndefined();
    }
  });

  test(".tmp leftovers cleaned on construction; non-json non-tmp files untouched", () => {
    const dir = tmpDir();
    const store1 = new DurableInputStore({ dir });
    store1.write(rec("kept", 1));
    fs.writeFileSync(path.join(dir, "input-stray-1.123.0.tmp"), "junk");
    fs.writeFileSync(path.join(dir, "unrelated.tmp"), "junk");
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const store2 = new DurableInputStore({ dir });
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
    expect(store2.lastSeq(K)).toBe(1);
  });
});

// ------------------------------------------------------------- seedSeq seam

describe("seedSeq seam (S1 additive option)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function composedStore(
    seedSeq: ((key: CaptureKey) => number) | undefined,
  ): { capture: InputCaptureStore; minted: { seq: number }[] } {
    const minted: { seq: number }[] = [];
    const capture = new InputCaptureStore({
      sink: (r) => {
        minted.push({ seq: r.seq });
      },
      seedSeq,
      session: () => "sess-1",
    });
    return { capture, minted };
  }

  test("consulted exactly ONCE per key; first mint is seed+1; later mints increment", () => {
    const seed = vi.fn(() => 5);
    const { capture, minted } = composedStore(seed);
    capture.setKeyDirty(K, () => "first");
    vi.advanceTimersByTime(250);
    capture.setKeyDirty(K, () => "second");
    vi.advanceTimersByTime(250);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(minted.map((m) => m.seq)).toEqual([6, 7]);
  });

  test("absent, throwing, non-finite, and non-positive seeds degrade to first mint 1", () => {
    for (const seed of [undefined, () => 0, () => -3, () => Number.NaN, () => {
      throw new Error("hostile seed");
    }]) {
      const { capture, minted } = composedStore(seed);
      capture.setKeyDirty(K, () => "x");
      vi.advanceTimersByTime(250);
      expect(minted.map((m) => m.seq)).toEqual([1]);
    }
  });
});

// -------------------------------------------------------- no-surface structural

describe("no-surface structural guard — nothing that could claim \"saved\"", () => {
  const src = fs.readFileSync(new URL("./input-durability.ts", import.meta.url), "utf-8");

  test("module references NONE of the forbidden answer/submit/send/session/notify surfaces", () => {
    for (const token of [
      "appendEntry",
      "persistence",
      "applyAnswer",
      "sendMessage",
      "streamSimple",
      "openPanel",
      "sidechat-engine",
      "EventEmitter",
      ".emit(",
      "setStatus",
      "upsertQuestion",
    ]) {
      expect(src, `forbidden token: ${token}`).not.toContain(token);
    }
  });

  test("imports are confined to crypto/fs/path + getAgentDir + capture types", () => {
    const allowed = [
      "from \"node:crypto\";",
      "from \"node:fs\";",
      "from \"node:path\";",
      "from \"@earendil-works/pi-coding-agent\";",
      "from \"./input-capture.js\";",
    ];
    const importLines = src.split("\n").filter((l) => l.startsWith("import "));
    expect(importLines).toHaveLength(allowed.length);
    for (const a of allowed) expect(src).toContain(a);
  });

  test("prototype exposes no save/status/event surface (write/latest/lastSeq only)", () => {
    const names = Object.getOwnPropertyNames(DurableInputStore.prototype);
    expect(names).toContain("write");
    expect(names).toContain("latest");
    expect(names).toContain("lastSeq");
    for (const n of names) {
      expect(n).not.toMatch(/^(save|saved|status|isSaved|on[A-Z]|add[A-Z]|subscribe|once|emit)/);
    }
  });
});

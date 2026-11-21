/**
 * src/input-durability.ts — the durable atomic file sink for local input
 * recovery (P3.M2.T1.S2).
 *
 * [Mode A] — what this module is:
 *
 * The WRITE half of the recovery point (spec §Local input recovery
 * :133-149, "Recovery point" bullet :141; mechanism authority:
 * plan/006_45773b259b06/architecture/input-recovery.md §atomicity /
 * §ordering / §failureSemantics — followed on every conflict). It attaches
 * to S1's InputCaptureStore sink seam (wired in index.ts) and persists
 * every flushed capture record as ONE self-describing JSON file per key
 * under `<agentDir>/data/interrogator/` (getAgentDir() honors
 * PI_CODING_AGENT_DIR — the same resolution src/config.ts uses).
 *
 * Write protocol — crash-safe atomic replace, per flushed record:
 * normalize key → seq<=0 incidental guard → per-key monotonic guard
 * (a delayed OLDER write can never clobber a newer durable save, and a
 * naive post-restart counter is rejected the same way) → incidental-empty
 * guard (an empty buffer with NO prior durable record never creates a
 * file; a DELIBERATE delete-to-empty over a prior record DOES write "")
 * → mkdir -p → serialize → `<file>.<pid>.<n>.tmp` in the SAME directory
 * → openSync("w") → writeSync → fsyncSync BEFORE closeSync → closeSync →
 * renameSync (POSIX-atomic replace — readers observe either the previous
 * or the new COMPLETE file, never a torn one) → best-effort directory
 * fsync (POSIX only; Windows throws on dir open — swallowed) → in-memory
 * index update → "written". On ANY fault: best-effort tmp removal, the
 * durable file stays at the last completed save, "failed" — never a
 * throw. The rename-of-an-unsynced-tmp hazard is why fsync precedes
 * close: closeSync alone does not flush.
 *
 * Durability honesty: file fsync + atomic rename + best-effort dir fsync
 * delivers the record "within the OS and storage system's durability
 * guarantees" (spec :138) — the strongest claim any software can make;
 * drives that lie about flushes are beyond every software contract
 * (danluu.com/file-consistency). Nothing here claims more.
 *
 * Honest failure: a failed write keeps BOTH values — the last durable
 * save on disk and the live edit in S1's in-memory store. This module
 * exports no event surface, no status/"saved" flag, no renderer hooks:
 * there is structurally nothing that could flash a false "saved". The
 * WriteOutcome union exists for tests and one degraded console.error line
 * only (the shipped degraded-fallback style of the state-mirror layer).
 * Keystrokes still inside S1's debounce window are NOT promised — only
 * completed saves are recoverable, by design and by test.
 *
 * Deliberately inert (draft-store.ts posture): no events, no UI surface,
 * no status flag, no session-file writes, no answer/submit/send/model
 * surfaces. `latest(key) === undefined` means NEVER captured;
 * `{text: "", seq}` means DELIBERATELY EMPTIED — the distinction is
 * load-bearing for P3.M3's seeding ladder; never conflate them. After a
 * RETIREMENT (P3.M2.T1.S3) `latest()` also reads undefined — the durable
 * value is gone (file unlinked) and unresurrectable (in-memory tombstone:
 * writes at or below the retired seq are "ignored-stale").
 *
 * Lifecycle: constructed once per extension activation, next to the
 * capture store in index.ts, and NEVER disposed — session replacement
 * (/new, reload, resume) fires session_shutdown too, and the factory
 * closure outlives every session; only S1's flush accelerator runs there.
 */

import * as crypto from "node:crypto";
import * as nodeFs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CaptureField, CaptureRecord, RetireOptions } from "./input-capture.js";

/**
 * Full durable identity — the spec :137 recovery scope ("originating
 * session, branch, question, field"). `questionId` is normalized from the
 * record (`?? "-"`) at this layer's boundary so file identity never
 * depends on the upstream optional's exact typing.
 */
export interface DurableKey {
  session: string;
  branchId: string;
  questionId: string | "-";
  field: CaptureField;
}

/**
 * Read-side key: identical to {@link DurableKey} but `session` is
 * OPTIONAL — entry ids are unique across sessions (the architecture
 * note's keying rationale), so {branchId, questionId, field} alone is
 * already unambiguous. The capture store's seedSeq seam carries no
 * session at mint time; omitting it scans the (small) in-memory index.
 */
export interface DurableKeyQuery {
  session?: string;
  branchId: string;
  questionId?: string | "-";
  field: CaptureField;
}

/** The last completed save for a key — `undefined` means never captured. */
export interface DurableValue {
  text: string;
  seq: number;
  savedAt?: string;
}

/**
 * Anti-resurrection tombstone (P3.M2.T1.S3) — an in-memory-only index
 * entry left behind by {@link DurableInputStore.retire}. Unlinking alone
 * would reset the monotonic guard (the entry disappears, a delayed OLDER
 * write sees `cur === undefined` and RECREATES the file = resurrection
 * after handoff). The tombstone keeps the key's last seq as the ordering
 * authority: writes with `seq <= tombstone.seq` are "ignored-stale" and
 * the file stays gone. It carries the key so session-less lookups (the
 * seedSeq scan path) still find it. NEVER persisted: after a restart
 * there are no pending in-flight writes to guard, and a fresh capture
 * mints from the durable lastSeq — above any tombstone — by construction.
 */
interface DurableTombstone {
  key: DurableKey;
  seq: number;
  retired: true;
}

/** Index map value: a completed save, or a retirement tombstone. */
type IndexEntry = { key: DurableKey; value: DurableValue } | DurableTombstone;

/** Discriminator — the value-entry shape has no `retired` field. */
function isTombstone(entry: IndexEntry): entry is DurableTombstone {
  return "retired" in entry;
}

/**
 * Test/debug visibility only — NEVER a user-facing "saved" surface
 * (spec :138 "never claim the edit was saved"; there is no code path from
 * these values to any UI).
 */
export type WriteOutcome = "written" | "ignored-stale" | "skipped-empty" | "failed";

/** File payload v1 — self-describing so files are inspectable by hand. */
interface DurablePayload {
  v: 1;
  key: DurableKey;
  text: string;
  seq: number;
  savedAt: string;
}

/**
 * Injectable fs subset — fault injection in tests (atomicity cannot be
 * tested with mocks of the STORE, only with a fs that can fail per step);
 * the default adapter wraps the node:fs functions.
 */
export interface DurableFs {
  existsSync(p: string): boolean;
  mkdirSync(p: string, opts: { recursive: true }): string | undefined;
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: "utf-8"): string;
  openSync(p: string, flags: "w" | "r"): number;
  writeSync(fd: number, data: string): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  rmSync(p: string, opts?: { force?: boolean }): void;
}

const defaultDurableFs: DurableFs = {
  existsSync: (p) => nodeFs.existsSync(p),
  mkdirSync: (p, opts) => nodeFs.mkdirSync(p, opts),
  readdirSync: (p) => nodeFs.readdirSync(p, "utf-8"),
  readFileSync: (p, encoding) => nodeFs.readFileSync(p, encoding),
  openSync: (p, flags) => nodeFs.openSync(p, flags),
  writeSync: (fd, data) => nodeFs.writeSync(fd, data),
  fsyncSync: (fd) => nodeFs.fsyncSync(fd),
  closeSync: (fd) => nodeFs.closeSync(fd),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  rmSync: (p, opts) => nodeFs.rmSync(p, opts),
};

export interface DurableInputStoreOptions {
  /** Storage directory; defaults to `<agentDir>/data/interrogator`. */
  dir?: string;
  /** fs adapter; defaults to the node:fs subset above (tests inject faults). */
  fs?: DurableFs;
  /** Clock; defaults to `() => new Date().toISOString()` (tests freeze it). */
  now?: () => string;
}

const FIELDS: readonly CaptureField[] = [
  "writein",
  "elaboration",
  "note",
  "sidechat-composer",
];

/** Canonical, order-fixed JSON identity of a key — the index/file hash input. */
function canonicalKeyJson(key: DurableKey): string {
  return JSON.stringify([key.session, key.branchId, key.questionId, key.field]);
}

/**
 * Cosmetic filename slug — NEVER the identity. questionIds are arbitrary
 * model-authored strings (possibly containing `/`), so path safety comes
 * from the FULL sha1 of the canonical key JSON, not from sanitization.
 */
function slugOf(key: DurableKey): string {
  return `${key.field}--${key.questionId}`.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48);
}

function sha1Hex(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Strict v1 payload validation for the load scan — anything that fails is
 * corrupt/foreign and is SKIPPED (left on disk, never blessed as data): a
 * parse or shape failure must read as "no recovery value", preserving the
 * previous-or-new invariant end to end.
 */
function validatePayload(raw: unknown):
  | { key: DurableKey; text: string; seq: number; savedAt: string }
  | undefined {
  if (!isRecordLike(raw) || raw.v !== 1) return undefined;
  const key = raw.key;
  if (!isRecordLike(key)) return undefined;
  const { session, branchId, questionId, field } = key;
  if (typeof session !== "string" || typeof branchId !== "string") return undefined;
  if (typeof questionId !== "string" || questionId === "") return undefined;
  if (typeof field !== "string" || !FIELDS.includes(field as CaptureField)) return undefined;
  if (typeof raw.text !== "string") return undefined;
  if (typeof raw.seq !== "number" || !Number.isFinite(raw.seq) || raw.seq <= 0) return undefined;
  if (typeof raw.savedAt !== "string") return undefined;
  return {
    key: { session, branchId, questionId, field: field as CaptureField },
    text: raw.text,
    seq: raw.seq,
    savedAt: raw.savedAt,
  };
}

/**
 * Extension-lifetime durable store (ONE instance per activation, owned by
 * the index.ts factory closure — panel components are disposable, this is
 * not). Owns ONLY: the storage directory, the in-memory index of completed
 * saves, and the atomic write protocol. Knows nothing about panels,
 * editors, state, or answers.
 *
 * The index is keyed by the PARSED payload key (canonical key JSON), never
 * by filename — filenames are cosmetic; the per-key `seq` is the ONLY
 * ordering authority (never mtimes, never names).
 */
export class DurableInputStore {
  private readonly dir: string;
  private readonly fs: DurableFs;
  private readonly nowFn: () => string;
  /** canon → completed save or retirement tombstone, updated after each rename/retire. */
  private readonly index = new Map<string, IndexEntry>();
  private tmpCounter = 0;

  constructor(options: DurableInputStoreOptions = {}) {
    this.dir = options.dir ?? path.join(getAgentDir(), "data", "interrogator");
    this.fs = options.fs ?? defaultDurableFs;
    this.nowFn = options.now ?? (() => new Date().toISOString());
    this.loadIndex();
  }

  /**
   * Persist ONE flushed capture record. SYNCHRONOUS and NEVER THROWS —
   * the sink contract (the capture store isolates sink failures, but this
   * side must hold its half): every failure mode collapses to a WriteOutcome.
   *
   * Guards, in order: `seq <= 0` (never-minted/incidental) can never win;
   * `seq < durable seq` for the key is ignored-stale (file untouched); an
   * empty text with NO prior durable record is skipped-empty (no file
   * created). A deliberate delete-to-empty ("" WITH a prior record, newer
   * seq) DOES write — `latest()` then returns `{text: "", seq}`, distinct
   * from `undefined`.
   */
  write(record: CaptureRecord): WriteOutcome {
    const key: DurableKey = {
      session: typeof record.session === "string" ? record.session : "",
      branchId: record.branchId,
      questionId: record.questionId ?? "-",
      field: record.field,
    };
    if (typeof record.seq !== "number" || !Number.isFinite(record.seq) || record.seq <= 0) {
      return "skipped-empty"; // never-minted/incidental records can never win
    }
    const canon = canonicalKeyJson(key);
    const cur = this.index.get(canon);
    if (cur !== undefined) {
      if (isTombstone(cur)) {
        // P3.M2.T1.S3 anti-resurrection: a straggler/delayed write at or
        // below the tombstone seq can never recreate a retired file. A
        // GENUINE post-handoff re-edit mints seq > tombstone.seq (the
        // capture-side counter was kept) and captures normally below.
        if (record.seq <= cur.seq) return "ignored-stale";
      } else if (record.seq < cur.value.seq) {
        return "ignored-stale"; // a delayed older write can never clobber a newer save
      }
    }
    if (record.text === "" && cur === undefined) {
      return "skipped-empty"; // incidental empty never creates a file
    }
    const savedAt = this.nowFn();
    const payload: DurablePayload = { v: 1, key, text: record.text, seq: record.seq, savedAt };
    const file = this.filePath(key, canon);
    const tmp = `${file}.${process.pid}.${this.tmpCounter++}.tmp`; // SAME dir ⇒ same fs ⇒ atomic rename
    try {
      this.fs.mkdirSync(this.dir, { recursive: true }); // no-op when present
      const fd = this.fs.openSync(tmp, "w");
      try {
        this.fs.writeSync(fd, JSON.stringify(payload));
        this.fs.fsyncSync(fd); // BEFORE close — the durability step; close alone does not flush
      } finally {
        this.fs.closeSync(fd);
      }
      this.fs.renameSync(tmp, file); // POSIX-atomic replace: previous or new complete file
      this.fsyncDirBestEffort(); // best-effort; POSIX-only win, swallowed elsewhere
      this.index.set(canon, { key, value: { text: record.text, seq: record.seq, savedAt } });
      return "written";
    } catch (err) {
      try {
        this.fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort — the fresh-store scan also cleans stray .tmp files */
      }
      console.error("interrogator: durable input write failed", err); // degraded-fallback style
      return "failed"; // durable stays at last completed save; live edit stays in S1 memory
    }
  }

  /** The last COMPLETED save for `query` — undefined when never captured OR retired. */
  latest(query: DurableKeyQuery): DurableValue | undefined {
    const entry = this.lookup(query);
    return entry !== undefined && !isTombstone(entry) ? entry.value : undefined;
  }

  /**
   * The last durable seq for `query` — 0 when unknown (the seed baseline);
   * a retired key reports its TOMBSTONE seq, keeping post-retire mints
   * monotonic above the retirement point.
   */
  lastSeq(query: DurableKeyQuery): number {
    const entry = this.lookup(query);
    if (entry === undefined) return 0;
    return isTombstone(entry) ? entry.seq : entry.value.seq;
  }

  /**
   * Retirement at a successful handoff (P3.M2.T1.S3; spec :139, architecture
   * note §retirement #3 — ORDER IS LOAD-BEARING: callers MUST have recorded
   * the handoff (answer committed / send accepted+settled) BEFORE calling
   * this; kill between handoff and retire leaves the file — harmless, the
   * text is identical to the handed-off answer).
   *
   * NO-OP unless `{explicit: true}` (draft-store.ts:111 guard precedent).
   * With the flag it: unlinks the key's file (force: a missing file is a
   * no-op) AND replaces the index entry with a TOMBSTONE at the key's last
   * seq — so `latest()` reads undefined (never-captured/retired are
   * indistinguishable for seeding), `lastSeq()` keeps the ordering
   * baseline, and any straggler write `seq <= tombstone.seq` is
   * "ignored-stale" (anti-resurrection). Tombstones are in-memory only.
   * NEVER THROWS: a failed unlink leaves the file (harmless post-handoff
   * double-record) and degrades to "ignored" with one console.error line.
   *
   * Accepts a {@link DurableKeyQuery} (session optional — entry ids are
   * unique across sessions, the same rationale as the read surface); a
   * key never captured tombstones at seq 0, which behaves identically to
   * never-captured (harmless, uniform).
   */
  retire(query: DurableKeyQuery, opts?: RetireOptions): "retired" | "ignored" {
    if (!opts?.explicit) return "ignored";
    try {
      const entry = this.lookup(query);
      const key: DurableKey =
        entry !== undefined
          ? entry.key
          : {
              session: query.session ?? "",
              branchId: query.branchId,
              questionId: query.questionId ?? "-",
              field: query.field,
            };
      const canon = canonicalKeyJson(key);
      const priorSeq =
        entry === undefined ? 0 : isTombstone(entry) ? entry.seq : entry.value.seq;
      this.fs.rmSync(this.filePath(key, canon), { force: true });
      this.index.set(canon, { key, seq: priorSeq, retired: true }); // TOMBSTONE
      return "retired";
    } catch (err) {
      console.error("interrogator: durable input retire failed", err); // degraded-fallback style
      return "ignored";
    }
  }

  /** Exact lookup for full keys; session-less lookup scans by unique branchId. */
  private lookup(query: DurableKeyQuery): IndexEntry | undefined {
    if (query.session !== undefined) {
      return this.index.get(
        canonicalKeyJson({
          session: query.session,
          branchId: query.branchId,
          questionId: query.questionId ?? "-",
          field: query.field,
        }),
      );
    }
    const questionId = query.questionId ?? "-";
    for (const entry of this.index.values()) {
      if (
        entry.key.branchId === query.branchId &&
        entry.key.questionId === questionId &&
        entry.key.field === query.field
      ) {
        return entry;
      }
    }
    return undefined; // no completed save, no tombstone
  }

  /** `input-<slug>-<sha1(canonical key)>.json` — identity is the full hash. */
  private filePath(key: DurableKey, canon: string): string {
    return path.join(this.dir, `input-${slugOf(key)}-${sha1Hex(canon)}.json`);
  }

  /**
   * Directory fsync so the RENAME itself survives a crash (POSIX) —
   * best-effort by design: Windows throws opening a directory, and this
   * must never convert a completed rename into a "failed" outcome.
   */
  private fsyncDirBestEffort(): void {
    try {
      const dfd = this.fs.openSync(this.dir, "r");
      try {
        this.fs.fsyncSync(dfd);
      } finally {
        this.fs.closeSync(dfd);
      }
    } catch {
      /* non-POSIX or unsupported — the rename is the atomicity step */
    }
  }

  /**
   * Construction-time tolerant scan: a missing dir is an empty index (no
   * throw, no mkdir yet); `.tmp` leftovers are removed best-effort (they
   * never completed their rename — never data); `.json` files are parsed
   * and validated strictly (corrupt/foreign: skipped, LEFT on disk);
   * duplicate canonical keys resolve to the higher seq.
   */
  private loadIndex(): void {
    let names: string[];
    try {
      names = this.fs.readdirSync(this.dir);
    } catch {
      return; // missing/unreadable dir — empty index; the first write mkdirs
    }
    for (const name of names) {
      const full = path.join(this.dir, name);
      if (name.endsWith(".tmp")) {
        try {
          this.fs.rmSync(full, { force: true });
        } catch {
          /* best effort */
        }
        continue;
      }
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = validatePayload(JSON.parse(this.fs.readFileSync(full, "utf-8")));
        if (parsed === undefined) continue; // corrupt/foreign: skip, leave on disk
        const canon = canonicalKeyJson(parsed.key);
        const cur = this.index.get(canon);
        if (cur === undefined || isTombstone(cur) || parsed.seq > cur.value.seq) {
          this.index.set(canon, {
            key: parsed.key,
            value: { text: parsed.text, seq: parsed.seq, savedAt: parsed.savedAt },
          });
        }
      } catch {
        /* unreadable/unparseable file — treat as no recovery value */
      }
    }
  }
}

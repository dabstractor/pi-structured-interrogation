---
name: "P3.M2.T1.S2 — Atomic persistence, durability, monotonicity, and honest failure (Local input recovery)"
description: "Attach the durable sink to S1's InputCaptureStore sink seam: CREATE src/input-durability.ts (DurableInputStore — tmp+fsync+rename atomic replace, per-key monotonic seq guard, incidental-empty guard, load index with .tmp cleanup, never-throw write with outcome enum, zero user surface). EXTEND src/input-capture.ts additively with an optional seedSeq hook (first-mint lazy consult — closes the restart counter-reset clobber hole). WIRE src/index.ts: construct the durable store at <agentDir>/data/interrogator (getAgentDir() honors PI_CODING_AGENT_DIR), attach sink+seedSeq, session_shutdown = forceFlush accelerator, NEVER dispose. Scripted tests (real os.tmpdir() fs + injectable fault adapter): interrupted write → previous-or-new complete value, never torn; older-write-after-newer-edit ignored; in-flight write not promised; failed write keeps last durable + live edit with no saved indication. Consumed by P3.M2.T1.S3 (retirement) and P3.M3.T1.* (restore/seeding)."
---

## Goal

**Feature Goal**: Every capture record S1 emits is persisted through a crash-safe write protocol: a completed save survives restart within the OS/storage durability guarantees, an interrupted write leaves the previous or new complete value (never torn), older writes and incidental empties can never overwrite newer user edits — including across a process restart — and a failed write keeps both the last durable value and the live edit while never claiming the edit was saved.

**Deliverable**:
1. `src/input-durability.ts` (new) — `DurableInputStore`: synchronous tmp+fsync+rename atomic replace, per-key monotonic seq guard, incidental-empty guard, construction-time directory index (valid files in, `.tmp` leftovers out, corrupt/foreign files ignored), `write`/`latest`/`lastSeq` APIs, never-throw, zero UI/event surface.
2. `src/input-capture.ts` (additive extension) — optional `seedSeq?: (key) => number` constructor option consulted at the FIRST seq mint per key, so post-restart counters continue from the durable file's last seq instead of restarting at 1 (the restart-clobber hole).
3. `src/index.ts` (wiring) — construct `DurableInputStore` (default dir `path.join(getAgentDir(), "data", "interrogator")`), attach `sink: (r) => durable.write(r)` + `seedSeq: (k) => durable.lastSeq(k)` to S1's store, and `pi.on("session_shutdown", () => capture.forceFlush())` (accelerator flush; NO dispose).
4. `src/input-durability.test.ts` (new) — the scripted matrix: interrupted-write (fault injection at every protocol step) → previous-or-new complete value; older-write-after-newer-edit ignored; in-flight write not promised; honest failure (both values kept, no surface); restart seeding; load integrity.

**Success Definition**: `npm test` green (S1's `input-capture.test.ts`, `sidechat-cache-isolation.test.ts`, `editor-preservation.test.ts` untouched-pass), `npm run typecheck` + `npm run lint` clean. Fault-injected tests prove no protocol step can leave a torn or missing previous value; monotonic tests prove a stale seq (including a naive post-restart counter) can never replace a newer durable save; failure tests prove nothing throws through the sink and no code path could ever render a "saved" indication (structural guard).

## User Persona

**Target User**: The interrogation user who types a long answer, then experiences a crash / kill / failed hibernation — and the P3.M3 restore feature that must trust the durable layer's guarantees.

**Use Case**: The recovery point contract: whatever the interrupt instant, reopening the field later yields the previous complete save or the new complete save — never a torn file, never an older edit resurrected over a newer one, never a silent lie that unsaved text was saved.

**User Journey**: user edits → capture store paces a flush (S1) → sink writes atomically → interrupt at ANY instant (before write, mid tmp-write, between fsync and rename, after rename, mid shutdown) → restart → the durable store's index reflects exactly the latest COMPLETED save → (P3.M3) restore seeds from it.

**Pain Points Addressed**: torn JSON from non-atomic writes (classic draft-loss bug); a delayed timer flush overwriting a newer edit with an older buffer; restart resetting seq counters so a fresh edit looks "older" than the durable file; UIs that flash "saved" before durability (a claim this store structurally cannot make).

## Why

- Binding spec: `spec/state-and-persistence.md` §Local input recovery, "Recovery point" bullet (:141) — atomic replace, monotonicity against older writes and incidental empties, keep-both-on-failure, never claim saved, latest-completed-save-only recovery (READ-ONLY).
- S1 (parallel, contract): its sink seam exists precisely so this item can attach fs durability without touching capture/pacing/keying (`plan/006_45773b259b06/P3M2T1S1/PRP.md` — "durable atomic fs persistence is P3.M2.T1.S2"; "shutdown hook in S2 wires this").
- Design authority: `plan/006_45773b259b06/architecture/input-recovery.md` (P3.M1.T1.S1) — read it FIRST; at research time it did not exist, in which case `plan/006_45773b259b06/P3M1T1S1/PRP.md` + `research/findings.md` carry the same resolutions (storagePath, atomicity, ordering, failureSemantics). The note is authoritative where this PRP disagrees.
- Downstream: S3 adds retirement as additive store methods; P3.M3.T1.* consumes `latest(key)`/`lastSeq(key)` and the `undefined` vs `{text: ""}` distinction (never-captured vs deliberately-emptied).

## What

### Behavior

1. **Write protocol** (`DurableInputStore.write(record)`, synchronous, never throws): normalize the key (`questionId ?? "-"`; a record with `seq <= 0` can never win — classified incidental) → **monotonic guard**: if `record.seq < durable.seq` for that key → `"ignored-stale"`, file untouched → **incidental-empty guard**: `text === ""` with NO existing durable record for the key → `"skipped-empty"`, no file created → ensure dir (`mkdirSync recursive`) → write payload JSON to `<file>.<pid>.<counter>.tmp` in the SAME directory via `openSync("w")` → `writeSync` → `fsyncSync(fd)` → `closeSync(fd)` → `renameSync(tmp, file)` (POSIX-atomic replace) → best-effort directory fsync (POSIX only; wrapped in try/catch — Windows `openSync(dir)` throws) → update in-memory index → `"written"`. On ANY fault: best-effort `rmSync(tmp)`, durable file stays at the last completed save, return `"failed"`.
2. **Durability**: file `fsync` before close + atomic rename + best-effort dir fsync = "within the OS and storage system's durability guarantees" (the strongest honest claim; lying drives are beyond any software contract — see findings.md §5).
3. **Monotonicity across restarts**: the constructor scans the storage dir and indexes every valid payload (keyed by the PARSED payload key, not filename); `lastSeq(key)` feeds S1's new `seedSeq` hook consulted at the first seq mint per key. A naive fresh counter (seq 1 against durable seq 42) is REJECTED as stale by the guard — proven by test — and the seeded counter makes genuine post-restart edits monotonic continuations.
4. **Incidental empties never clobber**: classification is S1's (no seq minted on seeding/init/view-change/send-cleanup). This layer's in-depth defenses: `seq <= 0` never wins; `""` with no prior durable record never creates a file. A deliberate delete-to-empty (seq minted, prior record exists) DOES write `""` — `latest()` then returns `{text: "", seq}`, distinct from `undefined`.
5. **Honest failure**: on write failure the last durable value stays on disk AND the live edit stays in S1's in-memory store (both kept). The module exports NO event emitter, NO status/"saved" flag, NO renderer hooks — there is structurally nothing to falsely indicate a save. `"failed"`/`"ignored-stale"`/`"skipped-empty"` outcomes exist for tests and the debug log line only (`console.error`, degraded-fallback style of persistence.ts).
6. **Recovery truth**: `latest(key)` reflects only completed saves (index loaded at construction, updated after each successful rename). Keystrokes never flushed and writes still pending in a debounce window are NOT promised — a kill mid-debounce leaves the previous completed save, by test.
7. **Storage location**: `<agentDir>/data/interrogator/` with `agentDir = getAgentDir()` from `@earendil-works/pi-coding-agent` (honors `PI_CODING_AGENT_DIR`; same import as config.ts:27/:390). NEVER the session file, NEVER `pi.appendEntry` (extensions.md §State external-storage routing; sidechat-cache-isolation.test.ts is the standing guard).
8. **Shutdown**: `session_shutdown` → `capture.forceFlush()` — a synchronous accelerator flush through the sink (persistence.ts StateMirror flush precedent). NEVER dispose: the extension factory outlives session REPLACEMENT (`/new`, reload, resume also fire session_shutdown — see index.ts:152-166 comments); a disposed store would never re-arm for the next session.

### Success Criteria

- [ ] Fault injection at EVERY protocol step (open/write/fsync/close/rename) leaves the previous complete value readable and byte-exact — never torn, never missing (torn-detector test with shared-prefix/suffix payloads).
- [ ] `.tmp` leftovers are ignored by recovery and cleaned on the next store construction.
- [ ] Older write after a newer durable save (`seq 3` vs durable `seq 5`) is ignored — file unchanged.
- [ ] Restart scenario: fresh store over the same dir reports `lastSeq` correctly; a naive seq-1 record is ignored-stale; a seeded seq-8 record is written.
- [ ] Incidental empty (`""`, no prior record) creates no file; delete-to-empty overwrites the prior file and `latest()` returns `{text: "", seq}`.
- [ ] Failed write: nothing throws through the sink; durable holds the last completed value; the live edit survives in S1's in-memory `latest()`; no API exists that could render a "saved" claim (structural test).
- [ ] In-flight/pending write at simulated kill: a fresh store over the dir returns the previous completed save, not the mid-debounce text.
- [ ] S1's tests, sidechat-cache-isolation.test.ts, editor-preservation.test.ts stay green unchanged; `src/input-capture.ts` still imports no `node:fs`.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green; diff confined to the four files below.

## All Needed Context

### Context Completeness Check

Validated: binding spec bullet + acceptance cases 2/3 read in full; S1's PRP consumed as contract (exact sink/record/store shapes, dispose-left-to-S2 note); architecture-note fallback (P3M1T1S1 PRP + findings) read and its atomicity/ordering/failureSemantics resolutions transcribed; pi package `getAgentDir()` implementation verified (env override, dist config.js:453-459); `ReadonlySessionManager` identity surface verified (session-manager.d.ts:178); index.ts shutdown/replace semantics verified (:100-102, :152-166); persistence.ts sync-flush precedent, draft-store.ts inertness template, config.test.ts real-tmpdir fixture convention, eslint rules verified. All design decisions pre-resolved in `research/findings.md` §4.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: THE design authority (storagePath / atomicity / ordering / failureSemantics sections).
    READ FIRST — implementer must check it NOW EXISTS and defer to it on any conflict
  fallback: if still absent, plan/006_45773b259b06/P3M1T1S1/PRP.md + its research/findings.md
    carry identical resolutions (that is the chain used to write this PRP)

- file: spec/state-and-persistence.md
  why: §Local input recovery (:133-149) — binding "Recovery point" bullet + acceptance cases
    2/3 (interrupted write, delayed older write, failed write) + the drafts-are-not-answers
    boundary that keeps this store inert
  gotcha: READ-ONLY — never edit spec/

- file: plan/006_45773b259b06/P3M2T1S1/PRP.md
  why: the S1 CONTRACT — sink seam shape (CaptureSink/CaptureRecord/CaptureKey), store API
    (setKeyDirty/forceFlush/latest/dispose), seq minting rules, "shutdown hook in S2 wires
    this", and its boundary guards (input-capture.ts imports no node:fs) that S2 must keep
    holding
  gotcha: S1 is landing in PARALLEL — adapt to its SHIPPED shapes if they differ from the
    PRP sketch (its `CaptureRecord` sketch has a redundant optional questionId; normalize
    `?? "-"` at this layer's boundary and key files on the full tuple)

- file: src/index.ts
  why: wiring site — DraftStore creation (:141, S1 adds the capture store nearby);
    session_shutdown flush precedent (:100-102 mirror.flush()); session-REPLACEMENT
    semantics (:152-166 comments — why dispose-on-shutdown would kill capture for the
    rest of the process)
  pattern: add the durable store + capture wiring adjacent to the drafts creation; add the
    shutdown flush NEXT TO the existing mirror flush subscription
  gotcha: extension factory runs once per process; session_shutdown fires for /new, reload,
    resume too — flush, never dispose

- file: src/persistence.ts
  why: the sync-flush precedent — StateMirror.flush() JSDoc "synchronously, no awaits — the
    shutdown handler and the process may not survive past this call"; try/catch +
    console.error degraded-fallback style to copy for write failures; debounce-window
    cancel/flush lifecycle shape
  gotcha: persistence.ts itself is the session-entry layer — do NOT route drafts through it

- file: src/draft-store.ts
  why: the inertness template ("Deliberately inert: NO EventEmitter, NO subscriptions, NO
    filesystem") to mirror in input-durability.ts's doc block; the {explicit:true} guard
    S3 will mirror for retire() — design the store so retire is additive (simple Map index)
  gotcha: do not modify DraftStore; its Q6=B restart-loss contract is superseded only for
    input recovery via THIS new parallel store

- file: src/config.ts
  why: getAgentDir import precedent (:27) and use (:390 path.join(getAgentDir(), ...)) —
    S2 uses the SAME helper; never hand-roll PI_CODING_AGENT_DIR logic
  gotcha: do NOT add config keys (architecture note defers overrides; config-surface.test.ts
    guards the shape)

- file: src/external-editor.ts
  why: the existing node:fs user in src (:23-24 mkdtempSync/rmSync/writeFileSync) — sync fs
    style precedent; proves fs imports are lint-clean in this codebase

- file: src/config.test.ts
  why: the real-fs test fixture convention — os.tmpdir() + mkdtemp + afterEach rm recursive;
    "the real ~/.pi is NEVER read". Copy this pattern (atomicity cannot be tested with mocks)
  pattern: cleanup array + afterEach splice/map rm

- url: https://nodejs.org/api/fs.html#fsrenamesyncoldpath-newpath
  why: renameSync atomicity contract (same-filesystem replace) — the entire atomic-replace
    strategy rests on it; tmp must live in the SAME directory
- url: https://nodejs.org/api/fs.html#fsfsyncsyncfd
  why: fd-level fsync BEFORE close is what makes the tmp content durable pre-rename
- url: https://github.com/npm/write-file-atomic
  why: the canonical temp+rename(+fsync) implementation this protocol mirrors — validation
    that the shape is industry-standard
- url: https://danluu.com/file-consistency/
  why: why the spec's "within the OS and storage system's durability guarantees" is the
    strongest honest claim (cite in the module doc block, one line)

- docfile: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  why: §State table (external storage routing — why durable drafts are files, never
    appendEntry/session file); §Errors and cleanup (idempotent session_shutdown cleanup)
```

### Current Codebase tree (relevant slice)

```bash
src/index.ts                     # extension factory — DraftStore :141, mirror+shutdown :100-102
src/input-capture.ts             # S1 (contract) — InputCaptureStore + sink seam [verify landed shape]
src/input-capture.test.ts        # S1 tests — must stay green unchanged
src/persistence.ts               # sync-flush + try/catch precedent (READ-ONLY reference)
src/draft-store.ts               # inertness template (READ-ONLY)
src/config.ts                    # getAgentDir precedent (READ-ONLY)
src/panel/sidechat-cache-isolation.test.ts  # standing session-file guard — untouched, green
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/input-durability.ts          # CREATE — DurableInputStore: atomic write protocol, monotonic +
                                  #   incidental-empty guards, construction-time load index + .tmp
                                  #   cleanup, latest/lastSeq read APIs, outcome enum, no surface
src/input-durability.test.ts     # CREATE — scripted atomicity/monotonicity/empty/failure/restart matrix
src/input-capture.ts             # EXTEND (additive only) — optional seedSeq constructor option
src/index.ts                     # MODIFY — construct durable store, attach sink+seedSeq, shutdown flush
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: NEVER write the session file or call pi.appendEntry for drafts
// (extensions.md §State routing + SIDECHAT-002; sidechat-cache-isolation.test.ts fails otherwise).
// CRITICAL: renameSync is atomic ONLY within one filesystem — the tmp file MUST be in the
// SAME directory as the destination (`${file}.${pid}.${n}.tmp`), never os.tmpdir().
// CRITICAL: fsyncSync the FILE fd before closeSync — a rename of an unsynced tmp can
// surface a zero-length/torn file after power loss; closeSync alone does NOT flush.
// CRITICAL: session_shutdown fires for session REPLACEMENT (/new, reload, resume) — flush
// the capture store, NEVER dispose it; the factory closure outlives every session.
// GOTCHA: restart seq hole — S1's counters are per-process; without seedSeq the monotonic
// guard rejects every post-restart edit (fresh seq 1 < durable seq 42). Seed from
// durable.lastSeq at FIRST mint per key (lazy), wired in index.ts.
// GOTCHA: questionIds are arbitrary model-authored strings — hash filenames (full sha1 of
// the canonical key JSON); sanitize only the cosmetic slug prefix. Path traversal is real.
// GOTCHA: Windows: fs.renameSync replace works (MoveFileEx MOVEFILE_REPLACE_EXISTING) but
// openSync on a directory throws — dir fsync must be best-effort try/catch (POSIX-only win).
// GOTCHA: the sink contract is "must not throw upward" — wrap EVERYTHING in write() in
// try/catch; a throwing sink inside S1's flush timer would crash the extension.
// GOTCHA: eslint — unused vars/args need a leading underscore; plan/ and spec/ are ignored
// by lint but src is not; vitest fake timers for anything timer-driven (composed-wiring test).
// GOTCHA: keep `grep "node:fs" src/input-capture.ts` empty — the fs adapter lives ONLY in
// input-durability.ts; seedSeq is injected via options, never imported.
// GOTCHA: latest(key) === undefined means NEVER captured; {text: "", seq} means deliberately
// EMPTIED. P3.M3's seeding rules and spec :142 depend on this distinction — never conflate.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/input-durability.ts
import * as crypto from "node:crypto";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CaptureField, CaptureRecord } from "./input-capture.js";

/** Full durable identity — the spec :137 recovery scope ("originating session, branch, question, field"). */
export interface DurableKey {
  session: string;
  branchId: string;
  questionId: string | "-"; // normalized from record.questionId ?? "-"
  field: CaptureField;
}
export interface DurableValue { text: string; seq: number; savedAt?: string; }
/** Test/debug visibility only — NEVER a user-facing "saved" surface. */
export type WriteOutcome = "written" | "ignored-stale" | "skipped-empty" | "failed";
/** File payload v1 — self-describing so files are inspectable by hand. */
interface DurablePayload { v: 1; key: DurableKey; text: string; seq: number; savedAt: string; }
/** Injectable fs subset — fault injection in tests; default = the node:fs functions. */
export interface DurableFs {
  existsSync(p: string): boolean;
  mkdirSync(p: string, opts: { recursive: true }): void | string;
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: "utf-8"): string;
  openSync(p: string, flags: "w"): number;
  writeSync(fd: number, data: string): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  rmSync(p: string, opts?: { force?: boolean }): void;
}
export interface DurableInputStoreOptions {
  dir?: string;   // default: path.join(getAgentDir(), "data", "interrogator")
  fs?: DurableFs; // default: node:fs subset
  now?: () => string; // default: () => new Date().toISOString()
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY the contract inputs (read pass)
  - READ plan/006_45773b259b06/architecture/input-recovery.md IF IT NOW EXISTS — it is the
    authority; where its atomicity/ordering/failureSemantics differ from this PRP, IT wins
  - READ the SHIPPED src/input-capture.ts (S1 landed in parallel): confirm CaptureRecord /
    CaptureSink / InputCaptureStore constructor shape — adapt Task 2/3 to the real names
  - RE-READ research/findings.md §3 anchors (index.ts :100-102/:141, config.ts:27) — line
    numbers may have drifted from S1's landing; locate by content, not line

Task 1: CREATE src/input-durability.ts
  - IMPLEMENT: DurableInputStore per the data model + write protocol in What §1:
    normalize → seq<=0 guard → monotonic guard → incidental-empty guard → mkdir →
    tmp(openSync/writeSync/fsyncSync/closeSync) → renameSync → best-effort dir fsync →
    index update → "written"; catch-all → best-effort rmSync(tmp) → "failed"
  - CONSTRUCTOR: tolerant scan — missing dir = empty index (no throw, no mkdir yet);
    readdirSync; `*.tmp` files rmSync'd best-effort; `*.json` files parsed+validated
    (v===1, key fields strings, seq positive number, text string — corrupt/foreign: skip,
    leave on disk); index keyed by PARSED payload key; duplicate keys → higher seq wins
  - FILENAME: `input-${slug}-${sha1hex}.json`, slug = sanitize(`${field}--${questionId}`)
    [^A-Za-z0-9._-]→"_" .slice(0,48), sha1hex = sha1(canonicalKeyJson) full hex
  - API: write(record): WriteOutcome (never throws); latest(key: DurableKey):
    DurableValue | undefined; lastSeq(key: DurableKey): number (0 when unknown)
  - FOLLOW pattern: draft-store.ts inert doc block — cite spec :141, the architecture note,
    and one Dan-Luu line on the honesty of "within the OS and storage system's guarantees";
    "Deliberately inert: no events, no UI surface, no session-file writes"
  - NAMING: input-durability.ts, DurableInputStore, PascalCase types; no imports from
    panel/, state.ts, delivery.ts, persistence.ts, sidechat-engine.ts

Task 2: EXTEND src/input-capture.ts (additive ONLY)
  - ADD: optional constructor option seedSeq?: (key) => number — consulted exactly ONCE per
    canonical key, at the FIRST seq mint for that key (lazy — no fs, no eager work);
    absent option → current behavior (counter starts at 0→first mint 1). S1's existing tests
    must compile and pass UNCHANGED
  - GOTCHA: if S1's shipped mint path makes lazy consult awkward (e.g. counter map created
    eagerly), the minimal equivalent is acceptable — requirement: a key's first minted seq
    is > durable lastSeq for that key when seedSeq is provided

Task 3: MODIFY src/index.ts — wiring
  - AT the S1 capture-store construction site (near `const drafts = new DraftStore()` :141):
    const durableInputs = new DurableInputStore();  // <agentDir>/data/interrogator
    attach to the S1 store: sink: (record) => durableInputs.write(record),
    seedSeq: (key) => durableInputs.lastSeq(key)   [adapt to shipped option names]
  - AT the existing session_shutdown subscription (:100-102): add capture.forceFlush() —
    synchronous accelerator flush through the sync sink; NEVER dispose (factory outlives
    session replacement)
  - PRESERVE: mirror.flush() subscription, DraftStore, all S1 wiring; comment citing
    spec :141 + the flush-never-dispose rationale

Task 4: CREATE src/input-durability.test.ts
  - FIXTURES: real os.tmpdir() dirs (config.test.ts convention: mkdtemp + afterEach rm
    recursive); fault injection via DurableFs wrapper whose individual methods throw on
    demand (beforeCount/proxy); fake timers (vi.useFakeTimers) only where S1's store is
    composed in
  - ATOMIC-REPLACE GROUP: write A (seq n); torn-detector payloads A/B share a long common
    prefix AND suffix (e.g. 200-char bookends) so any partial is detectable; for EACH fault
    point (openSync / writeSync / fsyncSync / closeSync / renameSync): durable file still
    parses and equals EXACTLY A; outcome "failed"; a subsequent successful B write still
    lands; .tmp leftover from the rename fault is removed by a FRESH DurableInputStore over
    the dir, which still reads A
  - MONOTONIC GROUP: durable seq 5 + record seq 3 → "ignored-stale", file byte-identical;
    seq 5 → idempotent rewrite "written"; seq 6 → replaced; RESTART: store1 writes seq 7 →
    fresh store2 same dir → lastSeq=7, latest() returns the value; naive record seq 1 →
    "ignored-stale" (the guard proven against counter reset); seeded record seq 8 → written
  - INCIDENTAL-EMPTY GROUP: {text:"", seq:1} no prior → "skipped-empty", NO file created;
    prior {text:"draft", seq:1} then {text:"", seq:2} → file rewritten "", latest() =
    {text:"", seq:2} (deliberate empty ≠ undefined)
  - HONEST-FAILURE GROUP (composed wiring: S1 InputCaptureStore + durable sink + seedSeq,
    fake timers, faulting fs): edit+flush ok (A durable); edit B; flush faults → nothing
    throws; durable.latest = A; capture.latest (S1 in-memory) = B (BOTH values kept);
    edit B again 100ms into the 250ms debounce → simulate kill (fresh store over dir) →
    latest = A, NOT B (in-flight write not promised, keystrokes-not-received never claimed)
  - NO-SURFACE STRUCTURAL: input-durability.ts imports only node:fs-functions + node:path +
    node:crypto + getAgentDir + input-capture types; no EventEmitter/no .on(/emit; the
    store exposes no status/saved flag; grep guard for applyAnswer|sendMessage|streamSimple|
    appendEntry|openPanel in the module → zero matches
  - LOAD-INTEGRITY GROUP: missing dir tolerated; corrupt JSON file skipped without throw;
    foreign .json (wrong v / missing fields) skipped; valid files indexed across restart;
    byte-exact round-trip through write→latest for "  leading\nline2\t", "あé…🜂",
    trailing whitespace, "" (deliberate)

Task 5: VALIDATE
  - npm test && npm run typecheck && npm run lint
  - npx vitest run src/input-capture.test.ts src/panel/sidechat-cache-isolation.test.ts
    src/panel/editor-preservation.test.ts   # all green, UNTOUCHED
```

### Implementation Patterns & Key Details

```ts
// The write protocol — the heart of the item (all inside try/catch, never throws):
write(record: CaptureRecord): WriteOutcome {
  const key = normalizeKey(record);                 // questionId ?? "-" ; canonical order fixed
  const canon = canonicalKey(key);                  // JSON.stringify([session,branchId,questionId,field])
  const cur = this.index.get(canon);
  if (record.seq <= 0) return "skipped-empty";      // never-minted/incidental can never win
  if (cur !== undefined && record.seq < cur.seq) return "ignored-stale";  // delayed older write
  if (record.text === "" && cur === undefined) return "skipped-empty";    // incidental empty
  try {
    this.fs.mkdirSync(this.dir, { recursive: true });   // no-op when present
    const file = this.filePath(canon, key);
    const tmp = `${file}.${process.pid}.${this.n++}.tmp`;  // unique tmp in SAME dir
    const fd = this.fs.openSync(tmp, "w");
    try {
      this.fs.writeSync(fd, JSON.stringify(payload));   // {v:1,key,text,seq,savedAt}
      this.fs.fsyncSync(fd);                            // BEFORE close — the durability step
    } finally { this.fs.closeSync(fd); }
    this.fs.renameSync(tmp, file);                      // POSIX-atomic replace
    this.fsyncDirBestEffort();                          // try/catch; POSIX only
    this.index.set(canon, { text: record.text, seq: record.seq, savedAt });
    return "written";
  } catch (_err) {
    try { this.fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    console.error("interrogator: durable input write failed", _err);  // degraded-fallback style
    return "failed";                                    // durable untouched; live edit untouched (S1)
  }
}

// index.ts wiring shape (adapt to S1's shipped option names):
const durableInputs = new DurableInputStore();          // <agentDir>/data/interrogator
const capture = new InputCaptureStore({
  sink: (record) => durableInputs.write(record),        // never throws
  seedSeq: (key) => durableInputs.lastSeq(key),         // closes the restart hole
});
pi.on("session_shutdown", () => { capture.forceFlush(); });  // accelerator; NEVER dispose
```

### Integration Points

```yaml
STORAGE:
  - dir: "<agentDir>/data/interrogator/" (getAgentDir() honors PI_CODING_AGENT_DIR)
  - NEVER: session file, pi.appendEntry, persistence.ts, os.tmpdir() for live files

UPSTREAM:
  - S1 InputCaptureStore sink seam + records (session/branch/question/field/text/seq);
    S2's only input-capture.ts change is the additive seedSeq option
  - architecture/input-recovery.md — authority on any conflict

DOWNSTREAM (design for, do NOT implement here):
  - P3.M2.T1.S3: retire(key, {explicit:true}) as an ADDITIVE method (delete file + index
    entry, mirroring draft-store.ts's explicit guard) — keep the index a simple Map so this
    stays trivial; S3 also owns the full acceptance cases 2/3/4-send-half + audit
  - P3.M3.T1.*: latest(key)/lastSeq(key) + the undefined vs {text:""} distinction for
    seeding (newer draft > recorded answer > blank; intentional empty preserved)

OUT OF SCOPE: retirement/discard (S3), restore/seeding/panel UX (P3.M3), blank rejection at
  applyAnswer (P3.M4), config keys (deferred by the architecture note), README/spec edits
  (P3.M5.T1.S2 owns the limitations-row flip)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck && npm run lint
# Expected: zero errors. Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/input-durability.test.ts -v        # the full scripted matrix
npx vitest run src/input-capture.test.ts -v           # S1 green, UNTOUCHED
npm test                                              # full suite green
```

### Level 3: Boundary & Guard Checks

```bash
git diff --name-only
# Expected EXACTLY: src/input-durability.ts(+test), src/input-capture.ts, src/index.ts
grep -n "node:fs" src/input-capture.ts                                # no matches (S1 guard holds)
grep -n "appendEntry\|persistence\|applyAnswer\|sendMessage\|streamSimple\|openPanel\|sidechat-engine" \
  src/input-durability.ts                                             # no matches
grep -rn "EventEmitter\|\.emit(" src/input-durability.ts              # no matches (no surface)
npx vitest run src/panel/sidechat-cache-isolation.test.ts src/panel/editor-preservation.test.ts
# green, untouched
```

### Level 4: Domain-Specific Validation (the acceptance-casing engine)

```bash
# The scripted matrix IS level 4 — every interrupt instant is exercised by fault injection:
#   interrupted write → previous-or-new complete value (atomic-replace group)
#   older-write-after-newer-edit ignored, incl. restart counter reset (monotonic group)
#   in-flight write not promised (honest-failure group, composed with S1 + fake timers)
# Optional manual spot-check of the real storage dir shape:
node -e 'const {DurableInputStore} = require("./src/input-durability.ts");' 2>/dev/null || \
  npx tsx -e 'import {DurableInputStore} from "./src/input-durability.js"; const s = new DurableInputStore({dir: "/tmp/manual-check"}); console.log(s.write({session:"s",branchId:"b",questionId:"q",field:"writein",text:"hello",seq:1}), s.latest({session:"s",branchId:"b",questionId:"q",field:"writein"}));' && ls /tmp/manual-check && cat /tmp/manual-check/*.json
# Expected: written {text:"hello",seq:1}; one .json payload {v:1,key:{...},text,seq,savedAt}
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed; `npm test`, `npm run typecheck`, `npm run lint` green.
- [ ] Fault-injection matrix green: every protocol step → previous-or-new complete value, never torn.
- [ ] Monotonic guards green: stale seq ignored; restart seeding proven both directions (naive rejected, seeded accepted).
- [ ] Incidental-empty guards green; delete-to-empty preserved as `{text:"", seq}`.
- [ ] Honest-failure tests green: no throw through sink; both values kept; no surface (structural).
- [ ] `.tmp` cleanup on construction; corrupt/foreign files skipped without throw.

### Feature Validation

- [ ] All "What" §1-8 behaviors implemented and test-covered.
- [ ] S1 tests + isolation guards untouched and green; `input-capture.ts` still fs-free.
- [ ] index.ts wiring: durable sink attached, seedSeq wired, session_shutdown forceFlush (no dispose).
- [ ] Storage lives under `<agentDir>/data/interrogator`; nothing touches the session file.

### Code Quality Validation

- [ ] Follows draft-store.ts inertness posture + persistence.ts degraded-fallback error style.
- [ ] Diff confined to the four declared files; naming/placement match the desired tree.
- [ ] No anti-patterns from the list below; no config keys added.

### Documentation & Deployment

- [ ] Module doc block cites spec :141, the architecture note, and the durability-honesty caveat.
- [ ] Failure path logs one degraded `console.error` line, never user-facing noise.
- [ ] No new environment variables (PI_CODING_AGENT_DIR honored via getAgentDir, already documented).

## Anti-Patterns to Avoid

- ❌ Don't write the destination directly or put the tmp file in another directory/filesystem — atomicity dies with `renameSync` across mounts.
- ❌ Don't skip the file `fsyncSync` before `closeSync` — rename alone does not flush tmp content.
- ❌ Don't let ANY exception escape `write()` — the sink contract is throw-free; a throwing sink crashes S1's flush timer.
- ❌ Don't dispose the capture store on session_shutdown — session replacement would orphan capture for the process lifetime.
- ❌ Don't seed seq counters eagerly or import fs into input-capture.ts — lazy `seedSeq` injection keeps S1's boundary guard intact.
- ❌ Don't add retirement, restore, blank rejection, config keys, or any UI/"saved" surface here — S3/P3.M3/P3.M4/P3.M5 own those.
- ❌ Don't conflate `latest() === undefined` with `{text: ""}` — intentional-empty vs never-captured is load-bearing for P3.M3.
- ❌ Don't key files on unsanitized question ids or the filename alone — model-authored ids can contain `/`; index by the parsed payload key.
- ❌ Don't use filenames/mtimes as ordering — the per-key `seq` is the ONLY ordering authority.

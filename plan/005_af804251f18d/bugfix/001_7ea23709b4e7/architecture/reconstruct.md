# BUG-008 research — reconstruction candidate pool drops older interrogate tool results

Repo: `/home/dustin/projects/pi-structured-interrogation`. Files read IN FULL: `src/reconstruct.ts` (613 lines), `src/reconstruct.test.ts` (926 lines). Also read in full: `src/persistence.ts` (212 lines). Sliced as needed: `src/tool.ts`, `src/state.ts`, `src/results.ts`, `src/index.ts`.

All line numbers below are exact and were re-verified with `grep -n` / numbered `awk` prints.

**Verdict: CONFIRMED.** `walkBranch` reduces ALL state-carrying interrogate tool results on a branch to a single LAST-wins slot (`toolState`/`toolIndex`), while mirror entries each become their own candidate. If the newest tool result's `details.state` fails deserialize (a throwing getter), the older valid tool result was already discarded by the walker and never enters the candidate pool → `reconstructFromBranch` returns `{source: "none"}` despite a perfectly valid older snapshot sitting on the branch. This directly contradicts the module JSDoc's own contract.

---

## 1. CLAIM 1 — walkBranch keeps only the LAST tool result (CONFIRMED)

`src/reconstruct.ts`, `WalkResult` declaration (lines 282–297) — the tool slot is singular, mirrors/submissions/completions are arrays:

```ts
// reconstruct.ts:282-297
interface WalkResult {
  /** Raw `details.state` of the LAST interrogate tool result carrying one. */
  toolState: unknown;
  /** Branch index of that tool-result entry (position filter anchor). */
  toolIndex: number;
  /** All mirror entries in walk order (newest = last). */
  mirrors: Array<{ index: number; data: unknown }>;
  ...
}
```

The single-pass walker, `src/reconstruct.ts:327-345` (relevance window 336–344):

```ts
// reconstruct.ts:327-345
/** Single pass over the raw branch, collecting every candidate in order. */
function walkBranch(branch: SessionEntry[]): WalkResult {
  const result: WalkResult = {
    toolState: undefined,
    toolIndex: -1,
    mirrors: [],
    ...
  };
  branch.forEach((entry, index) => {
    if (entry.type === "message") {
      const msg = entry.message as { role?: string; toolName?: string; details?: unknown };
      if (msg.role !== "toolResult" || msg.toolName !== "interrogate") return;
      const details = msg.details as { state?: unknown } | undefined;
      if (details === undefined || details.state === undefined || details.state === null) return;
      result.toolState = details.state; // LAST occurrence wins (FR-27)
      result.toolIndex = index;
      return;
    }
    ...
```

Lines **342–343** are the bug: each qualifying tool result OVERWRITES the previous one. A branch with `N` state-carrying interrogate tool results yields exactly **one** tool candidate (the last), while the earlier `N−1` are silently discarded before any deserialize is attempted. Note the filter at line 341: only tool results whose `details` exists and whose `details.state` is neither `undefined` nor `null` qualify — so a newer tool result WITHOUT `details.state` does NOT clobber the older one (it returns at 341 before the write at 342). The clobber requires the newer result to carry *a* `details.state` — which the failing-repro shape does (a corrupt one).

Also note what the walker extracts: only `details.state`. `details.epoch`, `details.statusLine`, `details.action` are never read for candidate purposes.

## 2. CLAIM 2 — the pool pushes ONE tool candidate vs MANY mirror candidates (CONFIRMED)

`src/reconstruct.ts:449-457` inside `reconstructFromBranch` (walk invoked at line 436):

```ts
// reconstruct.ts:444-457
  interface Candidate {
    index: number;
    data: unknown;
    source: ReconstructSource;
  }
  const candidates: Candidate[] = [];
  if (walk.toolIndex >= 0) {
    candidates.push({ index: walk.toolIndex, data: walk.toolState, source: "tool-result" });
  }
  for (const mirror of walk.mirrors) {
    const data = mirror.data as InterrogationStateEntryData | undefined;
    if (data === undefined || data.state === undefined || data.state === null) continue;
    candidates.push({ index: mirror.index, data: data.state, source: "mirror-entry" });
  }
```

Contrast:

- **Tool layer (450–452):** a single `if` guard pushes exactly **one** entry — `{index: walk.toolIndex, data: walk.toolState, source: "tool-result"}`. There is no loop because the walker already collapsed the layer.
- **Mirror layer (453–457):** a `for...of` over `walk.mirrors` pushes **every** qualifying mirror — each `{index: mirror.index, data: data.state, source: "mirror-entry"}`. `walkBranch` collected them in `result.mirrors.push({ index, data: entry.data })` (line 347) with no dedupe or collapse.

So the "degrade to the next-older candidate" loop (below) can only ever degrade WITHIN the mirror layer (or from a corrupt tool result to a mirror). It can never degrade from a corrupt newer tool result to an older tool result — those candidates were destroyed upstream.

### Ordering / selection logic (unchanged by the bug, needed for the fix)

`src/reconstruct.ts:458-469`:

```ts
  candidates.sort((a, b) => b.index - a.index); // newest first (stable sort)
  let source: ReconstructSource = "none";
  let state: LiveState | undefined;
  let baseIndex = -1;
  for (const candidate of candidates) {
    state = tryDeserialize(candidate.data);
    if (state !== undefined) {
      source = candidate.source;
      baseIndex = candidate.index;
      break; // one corrupt entry degrades to the next-older candidate
    }
  }
```

- Ordering key: descending **branch array index** (position of the entry in the `getBranch()` array). `Array.prototype.sort` is stable in V8, so equal indices (impossible in practice — indices are unique per walk) keep walk order.
- First candidate whose `data` deserializes without throwing wins; `break`. If none do, `state === undefined` → the no-traces teardown block at 470–489 and `return { source: "none", replayed: 0, opened: false, fallbackActive: false };` at **line 489**.
- `baseIndex` feeds the submission position filter (`if (submission.index <= baseIndex) continue;`, line ~505) and the completion-terminal lookup (`walk.completions.find((index) => index > baseIndex)`, line ~498). A multi-tool-result pool preserves both automatically because `baseIndex` is just the winner's branch index.

### Candidate entry type (exact)

`Candidate` is a function-local interface, `src/reconstruct.ts:444-448`:

```ts
interface Candidate {
  index: number;                  // position of the entry in the getBranch() array
  data: unknown;                  // RAW serialized state payload to deserialize
  source: ReconstructSource;      // "tool-result" | "mirror-entry" | "none"
}
```

- For a tool candidate: `data` is `details.state` alone (a `SerializedState`-shaped object).
- For a mirror candidate: `data` is `entry.data.state` — the mirror envelope's inner state. The envelope's `epoch`/`at` fields are NOT used for selection or ordering (only the branch `index` is); the epoch read at line 454's cast exists only so `data.state` can be null-checked.
- There is no `position` field distinct from `index`; no timestamp is consulted anywhere in selection. `ReconstructSource` is `export type ReconstructSource = "tool-result" | "mirror-entry" | "none";` (reconstruct.ts:179 area).

## 3. CLAIM 3 — the module JSDoc claims degrade-to-next-older (CONFIRMED)

`src/reconstruct.ts:41-43`, module JSDoc step 2a:

```ts
 *         full record (FR-5 exactly-once broken). Deserialize failures
 *         degrade to the next-older candidate, so one corrupt entry never
 *         crashes session_start.
```

Reinforced by `tryDeserialize`'s JSDoc, `src/reconstruct.ts:360-364`:

```ts
/**
 * Tolerant deserialize wrapper: deserialize is designed to never throw on
 * untrusted input, but a hostile getter/proxy payload still could — a
 * failure must degrade to the next candidate, never crash session_start.
 */
```

and the inline loop comment at line 467 (`// one corrupt entry degrades to the next-older candidate`). The contract is stated three times; the implementation honors it only across (and within) mirror candidates, not across tool-result candidates.

## 4. CLAIM 4 — the repro shape (CONFIRMED by code-path analysis; no existing test covers it)

Repro branch: `[toolResult(valid@i), toolResult(corrupt@j)]` with `i < j`, no mirror entries, no other state-carrying entries. Step-by-step through the real code:

1. `walkBranch` (336–344): both qualify (both carry non-null `details.state`). After entry `i`: `toolState=valid, toolIndex=i`. After entry `j`: **`toolState=corrupt, toolIndex=j`** — `valid` is gone (line 342 overwrite). The test-fixture analogue is `toolResultEntry(state)` (reconstruct.test.ts:74–92), and the corrupt shape is exactly the one used by test (g) at line 372: `{ get goal(): string { throw new Error("corrupt payload"); } }`.
2. Pool (450–452): `candidates = [{index: j, data: corrupt, source: "tool-result"}]` — one entry.
3. Loop (462–468): `tryDeserialize(corrupt)` throws inside `InterrogationState.deserialize` — `state.ts:493` does `new InterrogationState(String(raw.goal ?? ""))`, and property access `raw.goal` fires the throwing getter. `tryDeserialize`'s `catch` (reconstruct.ts:366–370) returns `undefined`.
4. Loop ends with `state === undefined` → teardown block 470–489 → **`return { source: "none", replayed: 0, opened: false, fallbackActive: false };` (line 489)**.

Meanwhile the branch objectively contains a deserializeable `SerializedState` at index `i`. CONFIRMED: the older valid entry exists but was never a candidate.

**Critical nuance for the fix's tests — what "deserialize failure" actually means:**

- `InterrogationState.deserialize` (`src/state.ts:491-523`) is *tolerant by design*: non-throwing on structurally junk input. `{goal: 7, epoch: "x"}` does NOT fail — it produces a valid live state with `goal === "7"`, `epoch === 1`, zero questions (see state.ts:492–495 coercions, 504 `// skip malformed entries`). The existing test at reconstruct.test.ts:780 exploits exactly this: `{ state: { goal: 7, epoch: "x" }, epoch: 9, ... }` is a mirror that deserializes *successfully-but-empty*... actually re-read: that test's comment says "deserialize-tolerated junk" — it does not throw, so it WINS as base and yields empty questions; the assertion `result.source === "mirror-entry"` holds either way (both junk and done mirrors are `mirror-entry`). The important fact: **the only way to fail a candidate is a thrown exception from a getter/proxy**, because every plain-object path in `deserialize` is guarded. Repro fixtures for BUG-008 must therefore use a throwing getter (or proxy), never merely malformed JSON — malformed-but-plain payloads "succeed" into empty states and mask the bug.
- "Valid live state" for base selection = `tryDeserialize` returned an `InterrogationState` instance (no throw). A valid deserialize of an empty/junk payload is still a WINNING candidate by current semantics; changing that (e.g. rejecting empty snapshots) is NOT part of this bug and should not be smuggled into the fix.
- Serialized envelope (`SerializedState`, `src/state.ts:106-121`): plain JSON `{ goal: string; epoch: number; order: string[]; questions: Record<string, Question>; completed?: boolean }`. Live state (`InterrogationState`) is the Map-based event-emitting singleton with mutation methods (`applyAnswer`, `bumpEpoch`, `markCompletedSilently`, ...). Reconstruction's job: envelope → `deserialize` → live instance → `setState` (reconstruct.ts:493 area).

## 5. Where tool results get `details.state` (src/tool.ts + src/results.ts)

- Every interrogate tool result carries the canonical envelope — tool.ts module JSDoc, lines 16–17: "`details.state` on every result is the canonical persistence envelope (h2.40 layer 2)."
- Builder: `src/tool.ts:177-178`:

```ts
function inlineEnvelope(state: SerializedState, action: ResultAction, statusLine: string): ResultDetails {
  return { state: structuredClone(state), epoch: state.epoch, statusLine, action };
}
```

  Used at tool.ts:322 (upsert), 357 (reopen), 374 & 394 (record). `ResultDetails` (`src/results.ts:45-59`): `{ state: SerializedState (structuredClone); epoch: number; statusLine: string; action: ResultAction }`.
- Session-file shape (from pi's persistence, mirrored by the test fixture reconstruct.test.ts:74–92): a `type: "message"` entry whose `message` is `{ role: "toolResult", toolCallId, toolName: "interrogate", content: [...], details: { state, epoch, statusLine, action }, isError, timestamp }`. Multiple interrogate calls on one branch ⇒ multiple such entries — the common case after follow-up calls (e.g. the "new interrogation after completion" flow pinned at reconstruct.test.ts:738).

## 6. Where mirrors are written (src/persistence.ts — NOT src/snapshots.ts) and their shape

The mirror is `src/persistence.ts`, `createStateMirror` (112–212):

- Debounce: `STATE_MIRROR_DEBOUNCE_MS = 2000` (line 62, "trailing-edge"). `onChanged` (126–133) stores the full snapshot and (re)starts the 2s timer; latest-wins within a window.
- Flush (160–179): appends `{ state: snapshot, epoch: snapshot.epoch, at: new Date().toISOString() }` (168–172) via `pi.appendEntry(INTERROGATION_STATE_ENTRY_TYPE, data)` (line 174). `INTERROGATION_STATE_ENTRY_TYPE = "interrogation-state"` (line 59). Append is try/caught (173–178) — a failed mirror write is a degraded fallback, never an error.
- Subscribes to the state singleton's `changed` (full-snapshot payloads, 155) and re-attaches on every `tool_execution_end` with seeding (193, `attachIfPresent(true)` at 150–157). `session_shutdown` wiring (flush) lives in `src/index.ts` (`pi.on("session_shutdown", ...)` at index.ts:98).
- Mirror entry in the session file (fixture reconstruct.test.ts:103–113 `mirrorEntry`): `{ type: "custom", id, parentId, timestamp, customType: "interrogation-state", data: { state: SerializedState, epoch: number, at: string } }`. `walkBranch` collects these at reconstruct.ts:346–349; the pool strips the envelope to `data.state` (454–456).
- `src/snapshots.ts` is unrelated to mirror writing (it owns submission-time snapshot diffs/`DiffEntry`/the `"(unanswered)"` sentinel referenced at reconstruct.ts:204–210).

## 7. The exact seam to change

Collect **every** state-carrying interrogate tool result (with its branch position) into the candidate pool, newest-first — exactly the way mirrors already work. Minimal change surface in `src/reconstruct.ts` only:

1. `WalkResult` (282–297): replace the two scalar fields
   ```ts
   toolState: unknown;   // 284
   toolIndex: number;    // 286
   ```
   with an array field mirroring `mirrors`' shape, e.g. `toolResults: Array<{ index: number; data: unknown }>` (keep the doc comment but drop "LAST"). Initialize in the walker's result literal (329–335) accordingly.
2. `walkBranch` (342–343): replace the overwrite pair with `result.toolResults.push({ index, data: details.state });` — the `// LAST occurrence wins (FR-27)` comment dies with it. (FR-27's "canonical tool result" intent is preserved by the pool's newest-first selection, not by walker-side collapse.)
3. Pool construction (450–452): replace the single `if (walk.toolIndex >= 0) { candidates.push(...) }` with a loop over `walk.toolResults`, matching the mirror loop's null-guard pattern (no state-field guard needed if the walker already filtered, but keep the defensive `data === undefined` check symmetric with 454–455 if cheap):
   ```ts
   for (const tool of walk.toolResults) {
     candidates.push({ index: tool.index, data: tool.data, source: "tool-result" });
   }
   ```
4. NOTHING else changes: the `sort` (458), degrade loop (462–468), `baseIndex` position filters (~505), completion-terminal lookup (~498), and all surfacing logic are position-driven and already handle an arbitrary number of candidates. Do not change `tryDeserialize`, `InterrogationState.deserialize`, the mirror layer, or `tool.ts` — the bug is purely walker-side candidate collapse.
5. Update the `WalkResult` doc comments (283, 285) that describe "LAST ... tool result" semantics.

Risk check (why this is safe): with multiple VALID tool results the pool now contains several tool candidates; newest-first picks the same winner the single-slot overwrite did, so every existing multiple-tool-result test (e.g. reconstruct.test.ts:738) keeps its outcome. The only behavior change is the degrade path gaining older tool results as fallbacks — the documented contract.

## 8. reconstruct.test.ts — tests pinning the behavior, and what must be extended

Fixtures: `toolResultEntry(state)` at lines 74–92 (throws-getter corrupt state achievable by passing `{ get goal() { throw ... } }`), `mirrorEntry(data)` at 103–113, `submissionEntry` at 116–141, `completionEntry` at 168–190, `makeCtx` at 207–227.

Tests pinning SINGLE-tool-result / LAST-wins behavior (read these before editing; do not regress):

- **`"a NEW interrogation after the completion REPLACES — fresh-replacement pin survives restart"` — reconstruct.test.ts:738.** THE multi-tool-result pin: branch = `[toolResult(submitted), completion, toolResult(fresh)]`, asserts `result.source === "tool-result"` from the LAST result, `epoch === 1`, old question absent, widget `"1 open · 0 answered"`. Under the fix, both tool results become candidates and the newer valid one still wins — assertions unchanged. This test PROVES the LAST-wins collapse exists today (two valid tool results, only the second is used) and must keep passing.
- **`"corrupt tool-result state falls through to the mirror (g)"` — reconstruct.test.ts:372.** The corrupt-tool degrade pin: single corrupt tool result (throwing `goal` getter) + one good mirror → `source === "mirror-entry"`. This is the closest existing analogue of BUG-008's mechanism and is where the gap shows: it never tests corrupt-tool → older-VALID-tool (no mirror present). **Extend or add a sibling here.**
- **`"one corrupt post-completion mirror degrades to the completion marker, never crashes"` — reconstruct.test.ts:780.** The mirror-side multi-candidate degrade precedent (corrupt newer mirror tolerated via deserialize coercion — see nuance in §4 — next mirror used). The new BUG-008 test should mirror this shape on the tool layer.
- **`"no tool result → newest mirror entry wins (c)"` — reconstruct.test.ts:284.** Mirror multi-candidate newest-first precedent.
- **`"base selection is position-aware: a later mirror beats an earlier tool result"` — reconstruct.test.ts:761.** Interleaved-layer position ordering; the fixed pool must preserve position-across-layers (a tool candidate may lose to a later mirror and must be able to WIN over an earlier corrupt mirror).
- **`"tool-result base beats everything; deltas after it replay (a)"` — :213; `"tool result AFTER submissions is the base → zero replay (b)"` — :266; `"compaction entry on the branch does NOT hide the tool-result base (L4)"` — :343.** Single-tool-result base + `baseIndex` position filter pins; unaffected but part of the contract net.

Tests that do NOT constrain this bug (for completeness): surface-decision suite (:392–:858), submission-value BUG-007 suite (:866–:926), createReconstruction wiring (:808–:860).

Recommended new/extended tests (downstream agents: name and place alongside :738/:780 in the `restart exactly-once` describe or the `base selection` describe at :211):

1. `corrupt NEWER tool result degrades to the OLDER tool result (BUG-008)` — `[toolResult(validOld), toolResult(throwingGetterState)]`, no mirrors → expect `source === "tool-result"`, live state = older snapshot (question/answer assertions like :738), epoch = old snapshot's.
2. Degradation ORDERING across layers: `[toolResult(validOld), mirror(corruptNewer)]` and/or `[toolResult(corruptOld), mirror(validNewer)]` → newest VALID wins by index regardless of layer (:761 is the valid-valid version).
3. Multi-tool retention: three tool results where the newest TWO are corrupt → oldest valid wins (proves the pool holds all N, not just two).

## 9. Summary of claims

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `walkBranch` keeps only the LAST state-carrying interrogate tool result | **CONFIRMED** | reconstruct.ts:282–297 (singular slot), 342–343 (`result.toolState = details.state; // LAST occurrence wins (FR-27)` overwrite) |
| 2 | Pool pushes that single tool entry while mirrors loop as multiple candidates | **CONFIRMED** | reconstruct.ts:450–452 (single `if` push) vs 453–457 (`for...of` mirror loop); walker mirror collection at 347 |
| 3 | JSDoc claims "Deserialize failures degrade to the next-older candidate" | **CONFIRMED** | reconstruct.ts:41–43 (module JSDoc), 360–364 (`tryDeserialize` JSDoc), 467 (loop comment) |
| 4 | Repro: valid-older + corrupt-newer tool results, no mirrors → `{source:'none'}` | **CONFIRMED** (code-path analysis; no existing test) | 342 clobber → 450–452 single candidate → 463/366–370 `tryDeserialize` returns `undefined` (getter throw at state.ts:493 `raw.goal`) → 489 `return { source: "none", ... }`. Adjacent mechanistic proof: test (g) :372 (getter-throw caught), test :738 (LAST-wins with two tool results) |

No source files were modified. Repository state at research time: `src/reconstruct.ts` 613 lines, `src/reconstruct.test.ts` 926 lines.

# BUG-005 scout: spurious STALE on first upsert of a NEW interrogation after completion (epoch echo)

Repo: `/home/dustin/projects/pi-structured-interrogation`. All anchors verified by read today. No source modified; no tests run.

## 1. Seam map (verified today)

### 1a. Completed-swap + guard call — `src/tool.ts`

- **Swap block: `src/tool.ts:282-303`** — inside `case "upsert":` (case starts at ~line 266). Verbatim, lines 282-291:

```ts
      let state: InterrogationState;
      if (existing !== undefined && existing.completed === true) {
        // BUG-002: fresh interrogation on a completed session. The goal is
        // CONSTRUCTOR-atomic — never setGoal on this path (a follow-up would
        // double-emit `changed` and misrepresent the mutation).
        state = createInterrogationState(
          parsed.action.goal !== undefined ? capped.goal : existing.serialize().goal,
        );
        setState(state);
```

- **Guard call: `src/tool.ts:297-300`** (immediately after the swap, before any mutation):

```ts
      // StaleError propagates (h2.22) — BEFORE any mutation. Runs against the
      // state that will RECEIVE the upsert (guards belong to the receiver): on
      // a fresh swap state this trivially passes (epoch 1, no existing ids).
      assertFresh(state, parsed.action);
```

That comment is the false assumption BUG-005 targets: it "trivially passes" ONLY if the model omitted `epoch`. If the model echoes its last-seen epoch from the completed interrogation (e.g. `epoch: 2`), the fresh state is at `epoch = 1` and the guard throws a spurious STALE. Also note: `parsed.epoch` is optional on upsert (`src/tool-schema.ts:195`).

- Non-swap create/reuse path: `src/tool.ts:292-295` (`state = existing ?? createInterrogationState(...)`; `setState` only when `!existing`).

### 1b. Guard mechanics — `src/guards.ts`

- `assertFresh(state, parsed)`: `src/guards.ts:180-239`.
  - `read`/`reopen` never guarded: line 181.
  - `record`: epoch required (line 184-186), mismatch → `epochStale` (line 187).
  - upsert rev loop: lines 190-226 (new ids `continue` at 194; combined rev+epoch StaleError at 198-218; rev-only at 220-226).
  - upsert epoch PRESENCE guard (BUG-010): lines 229-243 — all-new-id batch may omit epoch:

```ts
  if (
    parsed.epoch === undefined &&
    parsed.questions.some((q) => state.getQuestion(q.id) !== undefined)
  ) {
    throw new Error(
      `STALE: upsert touching existing questions requires the session epoch (current ${state.epoch}). Re-send with epoch.`,
    );
  }
```

  - **The BUG-005 throw site — final epoch-equality check, `src/guards.ts:245-246`:**

```ts
  // upsert — epoch guard (every rev passed; caller sent a mismatched epoch).
  const sentEpoch = parsed.epoch;
  if (sentEpoch !== undefined && sentEpoch !== state.epoch) throw epochStale(state, sentEpoch);
```

  On a freshly swapped state (epoch 1) with model-sent `epoch: 2`: rev loop passes (all ids new), presence guard passes (epoch present), then line 246 fires `epochStale(state, 2)`.

- `epochStale` + digest: `src/guards.ts:242-256` — wait, exact: `epochStale` is at **`src/guards.ts:248-257`**:

```ts
/** Epoch-only StaleError: session epoch mismatch with digestSince delta. */
function epochStale(state: InterrogationState, sentEpoch: number): StaleError {
  const digest = digestSince(state, sentEpoch);
  return new StaleError(
    buildStaleMessage({ sentEpoch, currentEpoch: state.epoch, digest }),
    { sentEpoch, currentEpoch: state.epoch, digest },
  );
}
```

- Message template `buildStaleMessage`: `src/guards.ts:129-145`. Key epoch clause assembly:

```ts
  if (hasEpoch) {
    clauses.push(`session epoch is ${parts.currentEpoch} (you sent ${parts.sentEpoch})`);
  }
  ...
  if (hasEpoch && parts.digest !== undefined) {
    const delta = parts.digest === "" ? "(none)" : parts.digest;
    message += ` Changes since epoch ${parts.sentEpoch}: ${delta}.`;
  }
  return `${message} Re-apply against current state.`;
```

- Digest: `digestSince(state, epochFrom)` — `src/snapshots.ts:361-375`:

```ts
export function digestSince(state: InterrogationState, epochFrom: number): string {
  if (epochFrom >= state.epoch) return "";
```

Fresh state `epoch=1`, `epochFrom=2` → returns `""` → renders `(none)`. Full BUG-005 message: `STALE: session epoch is 1 (you sent 2). Changes since epoch 2: (none). Re-apply against current state.` — exactly the PRD's quote.

- Self-heal: one round trip — model re-sends without `epoch` (all-new ids are epoch-less-friendly, guards.ts:229-243) or with `epoch: 1` → passes. Also `StaleError` class + typed details: `src/guards.ts:57-110`.

### 1c. Epoch reported to the model ("honest echo" guidance is the tool's own)

- Tool description (verbatim, `src/tool.ts:60`, tail): `"...Call with {} to read full current state, goal, and epoch."` — no upsert-echo instruction in the description itself.
- Schema `epoch` field description (`src/tool-schema.ts:114`, verbatim): `"Required when recording answers and when upserting questions that already exist (include the epoch from your last read/result); optional for a first upsert of brand-new questions (guards stale updates)."` — this GUIDES the model to always include the last-seen epoch; on the completed-swap first upsert, "brand-new questions" should be exempt but the batch-level equality check at guards.ts:246 fires anyway.
- Epoch text surfaces the model sees: status line `"... epoch {n}"` (`src/results.ts:101`), header `INTERROGATION — {goal} (epoch {n})` (`src/fallback.ts:127`), envelope `{ state, epoch, statusLine, action }` (`src/tool.ts:177`), `details.epoch` in results (asserted in `src/tool.test.ts:373-375`).

### 1d. BUG-002 decision pin — `spec/decisions.md:32` (verbatim)

> `- 2026-09-14 bugfix pin (Q7 clarification): a new interrogation after completion REPLACES the completed singleton — fresh state, epoch 1, completed=false, empty questions/snapshots; goal retained unless the new upsert supplies one. Resolves the gap flagged in architecture/spec-contracts.md § "Second interrogation in one session / epoch semantics after completion" (epoch-reset-on-new-interrogation was UNSPECIFIED); consistent with state-and-persistence.md § "Auto-close algorithm" "clear in-memory state" — the exactly-once completion guard is per interrogation lifecycle, not per session.`

### 1e. What the fresh state retains / detection markers — `src/state.ts`

- `epoch = 1` default: `src/state.ts:234-235` (`/** Session epoch; starts at 1, bumps on every submission (h2.39). */ epoch = 1;`)
- `completed = false` default: `src/state.ts:245`.
- `createInterrogationState(goal)` — `src/state.ts:567-569`: `return new InterrogationState(goal);` — **retains ONLY the goal** (passed in from `existing.serialize().goal` or the capped upsert goal, tool.ts:288-290). Questions, snapshots, epoch, completed are all defaults; nothing of the old interrogation survives in the new instance.
- The old state's `completed === true` is checked only in `src/tool.ts:282` against `existing` — at the guard site (`assertFresh(state, ...)`) the swap has already happened and `state.completed === false`; **no persisted marker distinguishes "freshly swapped" from "brand-new session first upsert"**. No transient field exists on `InterrogationState`.
- Detectable at guard site WITHOUT a new field: `state.epoch === 1 && state.orderedQuestions().length === 0` (fresh/empty) AND every parsed id is new (`parsed.questions.every(q => state.getQuestion(q.id) === undefined)`). A genuine first create also matches — but there is no prior stale view to lose on a first create, so exempting is harmless.

## 2. Data / control flow

`executeInterrogate` (`src/tool.ts`) → `case "upsert"` → `applyCaps` (pure, tool.ts:268-274) → completed check on `existing` (tool.ts:282): swap to fresh state via `createInterrogationState` + `setState` (tool.ts:287-290) → `assertFresh(state, parsed.action)` (tool.ts:300) → on throw, StaleError propagates uncaught (Mode A: pi sets isError) → else `applyUpsert` (tool.ts:308), `evaluateDependsOn` (tool.ts:325), goal FR-30 swap-excluded (tool.ts:324-325 condition), `serialize`, result envelope (tool.ts:177 pattern). Guards are pure (pinned by `src/guards.test.ts:431` "guards never mutate state and never emit events" and `src/guards.test.ts:500` "guards.ts is a pure module: type-only state/tool-schema imports + digestSince").

## 3. Tests pinning current behavior

### `src/tool.test.ts` — `describe("executeInterrogate: upsert (TUI)")` (line 167); completed-swap tests at lines ~275-345

- `tool.test.ts:277` `"second interrogation after completion completes (BUG-002, PRD h3.1)"` — completes state, then `executeInterrogate({ questions: [qi("n1")] }, tuiCtx())` **with NO epoch** — asserts second completion `{ fired: true }`. Pins that the epoch-less fresh path passes (not the BUG-005 path).
- `tool.test.ts:297` `"upsert on completed state swaps in a FRESH singleton (epoch 1, completed=false, empty snapshots)"` — asserts new instance, `s.epoch === 1`, `snapshots` empty, `r.details.state.epoch === 1`. **No epoch sent.** Would NOT need flipping; extend rather than flip.
- `tool.test.ts:320` `"swap RETAINS the prior goal when the upsert omits goal (FR-30 anchors re-asks)"`.
- `tool.test.ts:327` `"swap applies the CAPPED goal when the upsert supplies one"`.
- `tool.test.ts:336` `"NON-completed existing state is NOT swapped (same instance, q1 intact)"`.
- `tool.test.ts:340` `"guard untouched: deserialize restores completed=true (exactly-once across restart)"`.
- `tool.test.ts:349` `"stale upsert on a NON-completed state still throws StaleError (state unchanged)"` — sends `epoch: 999` + existing id rev 1 → `toThrow(StaleError)`; state unchanged. Must keep passing (non-swap path).
- `tool.test.ts:220` `"stale upsert carrying a goal throws StaleError and leaves goal untouched"` (non-completed; `epoch: 999`).

**No existing test sends an epoch on the completed-swap path**, so nothing strictly needs flipping — the BUG-005 behavior is currently *unpinned*; fix requires new tests.

### `src/guards.test.ts`

- `:146` `"epoch-only mismatch (all revs fresh) carries the delta digest"` — **closest pin on the guard itself**: all-new/rev-fresh batch + wrong epoch → epoch-only StaleError. If the fix exempts *all* all-new-id mismatches this test flips; if scoped to empty-state/epoch-1 only, check its fixture (verify it uses a non-empty state before relying on it).
- `:169` `"epoch-only mismatch with only new ids throws the same variant"` — **directly pins that a new-id-only upsert with a mismatched epoch throws.** Any fix that exempts all-new-id batches must flip/narrow this.
- `:226` `"new-id upsert without rev passes (with or without epoch)"` — "with epoch" here means matching epoch presumably; safe if fix only relaxes mismatch-on-fresh-state.
- `:259` `"fresh upsert (current revs, current epoch) passes"`.
- `:284`/`:300`/`:309` BUG-010 presence-guard pins (epoch-less existing/new/mixed).
- `:325` ordering pin (stale rev wins over presence guard).
- `:338` `"existing-id upsert WITH the matching epoch + revs passes exactly as before"`.
- `:372`/`:388` record-path epoch pins (`"answers with a wrong epoch throw the epoch-only variant"`, `"answers without epoch throw the plain required-param error (not STALE)"`) — must be untouched.
- `:431`/`:457`/`:468`/`:486` purity + StaleError shape + template pins.
- `:500` module-hygiene pin — guards.ts must stay import-pure (type-only from state/tool-schema + `digestSince`). Constrains where a swap flag could live: NOT a new import; a state field would also be serialized (state.ts:440 area) unless excluded.

## 4. Recommended minimal fix (per PRD)

**Touch point: `src/guards.ts:245-246`** — exempt the epoch-equality throw when the receiver state is "fresh" and the batch introduces only new ids:

```ts
  const sentEpoch = parsed.epoch;
  const allNewIds = parsed.questions.every((q) => state.getQuestion(q.id) === undefined);
  const freshReceiver = state.epoch === 1 && state.orderedQuestions().length === 0;
  if (sentEpoch !== undefined && sentEpoch !== state.epoch && !(freshReceiver && allNewIds)) {
    throw epochStale(state, sentEpoch);
  }
```

- Detects "freshly swapped" without a new persisted field: the swapped state is epoch 1 with zero live questions (completion cleared the old state's questions and the swap starts empty — state.ts:245, tool.ts:277). A same-session genuine first create is indistinguishable and equally safe to exempt (no prior view can be stale).
- Alternative (broader, NOT recommended without supervisor sign-off): exempt `allNewIds` entirely — would flip `guards.test.ts:169` and weaken the guard for epoch-mismatched question-set rotations on live interrogations.
- Alternative (narrower, in tool.ts): set a transient non-serialized flag on the swapped state before `assertFresh` (tool.ts:287-300) — but `guards.test.ts:500` hygiene and `serialize()` (state.ts:440) make a state field awkward; the invariant check above is cleaner.
- **Rev-guard interaction: none.** On a fresh state every parsed id is new (`getQuestion → undefined`), so the rev loop (guards.ts:190-226) and the presence guard (229-243) are no-ops; only line 246 can fire. Re-sent OLD ids from the previous interrogation are also "new" to the fresh state — fine. The `record` path (guards.ts:183-188) is untouched: a stale-epoch `answers` right after the swap still correctly STALEs (it needs the fresh state's epoch 1; that is a true one-round-trip heal, arguably desirable).
- Result payload after fix: first swap upsert passes; envelope reports `epoch: 1` (tool.ts:177), so the model's next echo self-corrects.

**Tests to add:** tool.test.ts — after `completeInterrogation`, `executeInterrogate({ epoch: 2, questions: [qi("n1")] }, tuiCtx())` succeeds and `getState().epoch === 1`; guards.test.ts — same shape directly against a fresh state, plus a control (non-empty state, new-id-only batch, wrong epoch still throws, matching `:169`).

## 5. Risks / interactions

1. `guards.test.ts:169` ("epoch-only mismatch with only new ids throws") may use a state with existing questions — if so it stays green under the scoped fix; verify fixture before assuming. If its state is empty, the fix narrows/flips it.
2. Honest-echo contract: schema text (tool-schema.ts:114) says epoch is optional for "a first upsert of brand-new questions" — fix aligns behavior with that guidance.
3. Spec docs: `spec/decisions.md:32` (BUG-002 pin) should gain a BUG-005 companion line ("guard-friendly first upserts" extended to epoch-carrying ones); `architecture/spec-contracts.md` h2.22/h3.8 sections describe the guard — update if they state the mismatch rule unconditionally.
4. Mode A: StaleError propagates uncaught from tool.ts:300 — fix keeps that; no executor changes needed.
5. No persistence change (no new state field) → no deserialize/versioning risk.

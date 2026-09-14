# Core Modules Research (tool.ts / state.ts / guards.ts / caps.ts / tool-schema.ts / merge.ts / results.ts)

Repo: /home/dustin/projects/pi-structured-interrogation. All line numbers verified against current HEAD.

## Defect claim verification

### BUG-001 — upsert reuses singleton, silently ignores later `goal` — CONFIRMED
`src/tool.ts:248`:
```ts
const state: InterrogationState = existing ?? createInterrogationState(parsed.action.goal ?? "");
if (!existing) setState(state);
```
Only the FIRST upsert creates state with the goal; any later upsert reuses `existing` and `parsed.action.goal` is never applied (the parsed goal is passed only to `applyCaps` at tool.ts:252–256, whose return value is otherwise discarded — see BUG-009). This is even asserted as intended behavior in `src/tool.test.ts:145–154`:
```ts
expect(r.details.state.goal).toBe("Ship it");
...
expect(getState()!.goal).toBe("first goal");
```
(`tool.ts:198–201` doc comment even says "the goal is FIXED for the lifetime of the state (`InterrogationState.goal` is readonly, no setter exists — verified)".)

`src/state.ts:217–243`: class `InterrogationState extends EventEmitter` with `readonly goal: string;` (line 218) assigned once in constructor (line 242: `this.goal = goal;`). No setter exists anywhere in state.ts. So changing the goal requires a new state instance.

**All `state.goal` read sites:**
- `state.ts:412` — `serialize(): SerializedState` includes `goal: this.goal` (every tool-result details envelope, snapshot, and persisted mirror carries it).
- `results.ts:125` — `buildReadResult`: `if (state.goal !== "") lines.push(`Goal: ${state.goal}`)` — read digest header line.
- `fallback.ts:125` — non-TUI digest header: `INTERROGATION — ${state.goal} (epoch ${state.epoch})`.
- `panel/layout.ts:209` — `const goalFull = state.goal;` → `HeaderRender.goalFull` (panel header; `panel/layout.test.ts:334` asserts it).
- `panel/deep-view.ts:92, 368` — full goal text for the FR-30 deep view.
- `panel/panel.ts:1047` — completion payload `goal: this.state.goal`.
- `delivery.ts:336, 395` — completion record: header `INTERROGATION COMPLETE — ${state.goal}` and details `goal: state.goal`.
- `renderers.ts:339` — completion card title uses `details.goal`.
- `reconstruct.ts` round-trips via serialize/deserialize (`state.ts:431` `new InterrogationState(String(raw.goal ?? ""))`).

### BUG-002 (tool side) — singleton reuse after completion — CONFIRMED (no reset path)
Create-vs-reuse condition is exactly tool.ts:248: `existing ?? createInterrogationState(...)`. `getState()` returns undefined only before first creation or after `resetState()` (state.ts:555–563; called only by lifecycle/persistence per h2.43 doc). After `clearForCompletion()` (state.ts:386–400) the SAME singleton stays installed with `completed = true`, questions/order cleared, but **goal, epoch, and snapshots retained**. A subsequent upsert therefore runs against the completed state: same goal (BUG-001), epoch continues from the old session (guards compare against stale epoch), and `completed` stays true. Fields needing reset for a fresh interrogation: `goal` (constructor-only), `epoch` (=1), `questions` Map + `order` (already cleared), `completed` (=false — only live assignment site is inside `clearForCompletion`, state.ts:394–395), `snapshots` (readonly array — must be a NEW instance since `readonly snapshots: Snapshot[] = []`, state.ts:230). Practical fix shape: on completed singleton + new goal, `setState(createInterrogationState(goal))`.

### BUG-009 — capped goal discarded, RAW goal stored — CONFIRMED
`src/caps.ts:139–192`:
```ts
export function applyCaps(
  questions: QuestionInput[],
  goal: string,
  config: InterrogatorConfig,
  contextWindow: number,
): CapsResult
```
Returns `{ questions, goal, warnings }` — `goal` is "The goal, truncated to `caps.goal` if it was over budget" (caps.ts:41–47); warning format `goal truncated at ${originalLength} chars` (caps.ts:188). But `src/tool.ts:252–261`:
```ts
const capped = applyCaps(parsed.action.questions, parsed.action.goal ?? "", config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
applyUpsert(state, capped.questions.map(toMergeQuestion));
```
`capped.goal` is never referenced — only `capped.questions` and `capped.warnings` are used. On the create path the state is constructed from the RAW `parsed.action.goal ?? ""` (tool.ts:248), so an over-budget goal is stored untruncated in state even though the model was told it was truncated. (On later upserts neither raw nor capped goal is applied — BUG-001.)

### BUG-010 — assertFresh epoch checked only when present — CONFIRMED
`src/guards.ts:213–235` `export function assertFresh(state: InterrogationState, parsed: ParsedAction): void`:
- `read`/`reopen`: return immediately (line 215).
- `record` (lines 217–222): epoch REQUIRED — `parsed.epoch === undefined` → plain `Error("answers requires epoch: ...")`; mismatch → epoch-only `StaleError` with `digestSince` delta.
- `upsert` (lines 224–231): per-question rev check on EXISTING ids in agent order (`if (q.rev === current.rev) continue;` — missing rev = stale); rev failure may combine with epoch clause if caller's epoch sent AND mismatched. Final epoch check (line 234): `if (sentEpoch !== undefined && sentEpoch !== state.epoch) throw epochStale(...)` — **only when the caller sent an epoch**; an upsert omitting epoch skips the epoch guard entirely.
- `src/tool-schema.ts:108`: `epoch: Type.Optional(Type.Integer(...))` — schema-optional for all actions (ParsedAction lines 183/186: `epoch?: number` on upsert/record). So a model can upsert without epoch and only revs guard it (revs still cover content, but not answers-recorded-since).
- Callers of assertFresh: `tool.ts:250` (upsert) and `tool.ts:290` (record). Both pass the whole parsed action; guards read `parsed.epoch`.

### BUG-006 (tool side) — upsert path skips evaluateDependsOn — CONFIRMED
`src/tool.ts:261`: `applyUpsert(state, capped.questions.map(toMergeQuestion));` — no `evaluateDependsOn` call afterward in tool.ts. Existing production call sites of `evaluateDependsOn` (src/depends-on.ts:160, signature `evaluateDependsOn(state: InterrogationState): MootEvaluation`):
- `reconstruct.ts:368` — once, at end of reconstruction replay (after applyAnswer/applyUpsert replays).
- `panel/ripple-confirm.ts:129` — immediately after `applyAnswer` (FR-17/AC-6 instant moot greying).
- `panel/actions.ts:249` — after answer change / accept flow.
- `delivery.ts:331` — inside submission/completion building (`mootered` reasons map).

So moot recomputation currently runs on answers and reconstruction but NOT on agent upserts via the tool — an upsert that changes a dependency question's options (rule 2, answer reset) does not re-evaluate dependents' moot-ness until some other trigger fires.

## state.ts exported API (exact signatures)

```ts
type QuestionStatus = "open" | "answered" | "submitted" | "reasked" | "moot" | "withdrawn" | "closed";
class InterrogationState extends EventEmitter {
  readonly goal: string;
  epoch = 1;
  completed = false;
  readonly snapshots: Snapshot[] = [];
  constructor(goal: string);
  getQuestion(id: string): Question | undefined;
  orderedQuestions(): Question[];
  groupSummaries(): GroupSummary[];
  upsertQuestion(q: Question): void;            // new id forced rev 1/"open", appended to order
  removeQuestion(id: string): void;
  applyAnswer(id: string, answer: QuestionAnswer): void;  // status → "answered", NEVER touches rev
  setStatus(id: string, status: QuestionStatus): void;
  bumpRev(id: string): void;
  bumpEpoch(): number;                          // epoch++, emits "epoch-bumped" then "changed"
  clearForCompletion(): void;                   // clears questions+order, sets completed=true, KEEPS goal/epoch/snapshots
  serialize(): SerializedState;                 // structuredClone {goal, epoch, order, questions, completed}
  static deserialize(data: unknown): InterrogationState;  // tolerant; emits nothing
}
function createInterrogationState(goal: string): InterrogationState;
function getState(): InterrogationState | undefined;
function setState(state: InterrogationState): void;   // reconstruction seam
function resetState(): void;                          // only teardown
```
Events: `changed: [SerializedState]`, `questions-upserted: [string[]]`, `epoch-bumped: [number]`, `completed-cleared: []`.
`SerializedState = { goal: string; epoch: number; order: string[]; questions: Record<string, Question>; completed?: boolean }`.

Epoch bump triggers: only `bumpEpoch()`. Production callers: fallback.ts `recordAnswers` (non-TUI record path, tool.ts:309) and the panel submit flush (ctrl+s → `markSubmitted` + `bumpEpoch`; see panel code, not in scope). Snapshots ring push lives in snapshots.ts (P1.M1.T2.S4), driven off submissions.

## merge.ts rule 2 — exact behavior

`src/merge.ts:200–220` (inside `applyUpsert` PASS 1): when `sameOptions(incoming, existing)` is false (comparison is by ordered `option.value` list only; undefined/[]/missing all count as "same"):
```ts
// Rule 2 / reopen-changed: answer reset means DELETE the answer ...
status = "reasked";
answer = undefined;
rule = reopening ? "reopen-changed" : 2;
answerReset = true;
```
Then `state.upsertQuestion({...structuredClone(incomingQ), rev: existing.rev + 1, status, answer})` — rev bumped, order position preserved, transition recorded with `revBumped: true, answerReset: true`. Draft preservation: merge.ts header doc lines 15–17 — "Drafts (R4, FR-21) live entirely panel-side: nothing in this module reads, writes, or clears draft state. Rule 2 'preserves' panel drafts by simply never touching them."

Also relevant: rule 4 withdrawal (merge.ts:223–233) only withdraws live statuses `["open","answered","submitted","reasked"]`; moot/closed/withdrawn are no-ops; `markSubmitted(state, ids)` / `closeSubmitted(state, ids)` / `markAnswered(state, id, answer)` are thin validated wrappers over setStatus/applyAnswer; moot transitions are NOT in merge.ts — depends-on.ts owns them.

## Test construction conventions

tool.test.ts fixture (lines 58–89):
```ts
function seedState(goal = "g"): InterrogationState {
  const st = createInterrogationState(goal);
  setState(st);
  return st;
}
function seedQ(st: InterrogationState, id: string): void {
  st.upsertQuestion({ id, prompt: `prompt ${id}`, type: "text", rev: 1, status: "open" });
}
function tuiCtx(): ExecutorContext { return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } }; }
beforeEach(() => { resetState(); });
```
Executor calls go through `executeInterrogate(args, ctx)` directly (no pi runtime); state.test.ts / guards.test.ts / caps.test.ts construct `InterrogationState` via `createInterrogationState("...")` and mutate via the raw primitives, then assert on `serialize()` snapshots / thrown `StaleError` / `CapsResult`. state.test.ts:230 asserts goal retained after clearForCompletion; state.test.ts:43/68 assert goal on state and `changed` events. Note results.test.ts:194 mutates `state.goal = "changed"` on a hand-built SerializedState fixture (plain object, not the class) — the class-level readonly does not apply there.

## Start here
`src/tool.ts` lines 240–262 (upsert case) — all four tool-side defects (001, 002, 009, 006) live in those ~20 lines; then `src/state.ts:217–243` for the readonly goal constraint and `clearForCompletion` at 386–400 for what a reset path must touch.

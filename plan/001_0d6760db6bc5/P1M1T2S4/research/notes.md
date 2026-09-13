# Research Notes — P1.M1.T2.S4: Snapshot ring + diff computation

## Codebase facts (verified by reading src/state.ts)

- `InterrogationState` (S1, complete, DO NOT MODIFY) already owns:
  - `readonly snapshots: Snapshot[] = []` — S1 comment: "The ring-of-10 push/trim logic lands in P1.M1.T2.S4"
  - `interface Snapshot { epoch: number; at: string; state: SerializedState }`
  - `serialize(): SerializedState` — deep-copied (structuredClone), JSON-safe, details-compatible
  - `bumpEpoch(): number` — increments, emits `epoch-bumped` then `changed`, returns new epoch. Its JSDoc says "The snapshot ring pushes into `snapshots` here in P1.M1.T2.S4" — but **state.ts is frozen**, so S4 must hook externally: subscribe to `epoch-bumped`? No — ordering matters. See decision below.
  - Question fields available for summaries: `title?`, `prompt`, `type`, `options[{value,label}]`, `answer?: {value, text?, at}`, `status`, `rev`.
- ESM `.js` import suffix convention; vitest co-located tests (`src/*.test.ts`); scripts `npm run typecheck` (tsc --noEmit), `npm test` (vitest run). No ruff/mypy — TypeScript project.
- Singleton helpers `getState()/setState()/resetState()` exist; S4 does not need them (operate on passed state).

## Key decision: how does snapshot() get called on every submission, BEFORE epoch bump?

The item contract: "snapshot() on every submission (before epoch bump)". `bumpEpoch()` is inside frozen state.ts and emits `epoch-bumped` AFTER incrementing. Options:
1. Monkey-patch `bumpEpoch` — fragile, forbidden-ish.
2. Deliver an exported `snapshot(state)` + `withSnapshot(state)` wrapper: consumers (delivery.ts P1.M2.T1.S1, the submit flow) call `takeSnapshot(state)` (captures serialize() + current epoch) and then `bumpEpoch()`. `takeSnapshot` is idempotent per epoch and does ring trim (keep last 10). This is the contract: S4 EXPORTS the function; wiring happens in delivery.ts later. Also guard: subscribing to `epoch-bumped` would snapshot AFTER bump — wrong ordering; document why the wrapper-call pattern is used.

`takeSnapshot` semantics:
- `const snap = { epoch: state.epoch, at: new Date().toISOString(), state: state.serialize() }` — captures the epoch that is ABOUT to be left (pre-bump state).
- push, then `while (snapshots.length > 10) snapshots.shift()` (drop oldest). Ring bound = 10 (h2.39).
- snapshot must be a deep copy — serialize() already structuredClones.
- No events emitted (snapshotting is bookkeeping; state content unchanged — do NOT emit `changed`).

## computeDiff(prev, next) — SubmissionCardData shape

From item contract + h2.36 renderer + AC-13:
- `{ changed: Array<{ id, title, from, to, editedArchived: boolean }>, note?: string, epoch: number, remainOpen: number }`
- from/to = "answer value/label summaries": for choice questions, prefer the option **label** when the value matches an option, else raw value; for text questions, the raw value. Undefined → "(unanswered)". Truncation (e.g. >60 chars → `…`) is renderer territory — S4 returns full summaries; renderer truncates. (Decision: keep S4 pure data.)
- Edited-archived answers (closed → answered(pending) edit, Q24=B/AC-13): appear with marker data. Detection at diff time: `to` question status was `closed` in prev and now `answered`/`submitted`, OR from.status === "closed". Flag `editedArchived: true` so the card can render `Q3: sqlite → postgres (changed)` per ui-spec h2.36 / AC-13.
- Diff comparison keyed by question id across prev/next serialized states:
  - prev.answer?.value+text vs next.answer?.value+text differ → changed entry (from prev, to next)
  - question in next but not prev → changed with from "(new)"? Spec doesn't define; safest: include with from = "(unanswered)"? Actually new questions aren't answer diffs. Decision: only questions present in BOTH, or in next with answer and absent in prev, count if answer exists in next and (no answer in prev OR values differ). Keep simple: id union, entry iff `answerSignature(prev) !== answerSignature(next)` where missing question = no answer. Include `title` = `title ?? prompt`.
- `epoch` = next.epoch; `remainOpen` = count of next-state questions with status "open" (h2.36: `{open} remain open`).
- `note?` = batch note passed separately by delivery.ts (P1.M2.T1.S1 owns capture); computeDiff takes it as optional param, or delivery merges it. Decision: computeDiff signature `computeDiff(prev: SerializedState, next: SerializedState): SubmissionCardData` — note NOT S4's (delivery adds it). But item contract lists note? in card shape — include an optional third arg `note?: string` passthrough documented in JSDoc.

## digestSince(epochFrom)

Used in stale-guard rejection (spec/architecture.md:75): `"Changes since epoch 4: {delta digest}"` — compact one-line-per-submission delta digest.
- Implementation: walk `snapshots` (and current live state) from first snapshot with `epoch >= epochFrom`... careful: snapshots hold PRE-bump state labeled with the epoch being left. Snapshot labeled epoch N represents state after epoch N's submission? No — taken before the bump to N+1, i.e. state AS SUBMITTED at epoch N. Digest lines: for each consecutive pair (snap_i.state → snap_{i+1}.state ... → current state), compute one line per submission: `q3: sqlite→postgres; q7: answered`, joined with `; ` or newline. Spec says "one-line-per-submission delta digest" — compact string, each submission's changed answers summarized.
- If no snapshot covers epochFrom (ring overflow / old epoch), degrade to first available snapshot and prefix... simplest: digest from oldest surviving snapshot ≥ min. Return empty string when nothing changed or epochFrom >= current epoch.

## Consumers (contract references)
- P1.M2.T1.S1 delivery delta builder: calls takeSnapshot → bumpEpoch → computeDiff(snapshot.state, current serialize)
- P1.M1.T3.S2 stale guards: digestSince(modelEpoch)
- P1.M7.T3.S1 submission card renderer: renders SubmissionCardData (h2.36)
- Post-hoc recovery: snapshots retained even after clearForCompletion() (S1 retains them).

## Validation
- typecheck + vitest, matching existing conventions.

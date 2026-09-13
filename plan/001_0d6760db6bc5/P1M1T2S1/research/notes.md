# Research notes — P1.M1.T2.S1 (InterrogationState core)

## Codebase state at time of writing
- Repo is greenfield. Scaffold arrives from P1.M1.T1.S1 PRP (package.json, tsconfig, vitest.config.ts, src/index.ts with `/interrogate-ping` stub). config.ts arrives in parallel from P1.M1.T1.S2. Neither is needed as a dependency of state.ts (no config reads in the core state module — caps live in tool.ts, P1.M1.T3.S3).
- No source files exist yet at research time; contracts taken from sibling PRPs (plan/001_0d6760db6bc5/P1M1T1S1/PRP.md, P1M1T1S2/PRP.md).

## Authoritative spec sources (read, confirmed)
- spec/state-and-persistence.md — full state machine diagram (§Question state machine), rev/epoch semantics, storage layers (in-memory state is layer 1; mutations emit change events), reconstruction algorithm, snapshot ring of 10.
- PRD h2.17 (data shapes), h2.38 (state machine), h2.39 (rev/epoch), h2.13 (component table: state.ts "Single in-memory source of truth. Never touches UI. Emits change events").
- plan/001_0d6760db6bc5/architecture/system-context.md line 24: `state.ts # InterrogationState: Map<id,Question>, order[], epoch, revs, snapshots, dependsOn evaluator, EventEmitter` — confirms EventEmitter approach. (dependsOn evaluator itself is S3; S1 keeps the type + group summaries only.)

## Downstream consumers (contracts S1 must satisfy)
- P1.M1.T2.S2 (merge rules 1–4 + status transitions): needs upsert entry points that it wraps; bumpRev; status mutation paths.
- P1.M1.T2.S4 (snapshot ring + diff): needs `snapshots: Snapshot[]` field and epoch bump hook (bumpEpoch called on submission, snapshot pushed there in S4).
- P1.M1.T3.S4 (tool read/details): needs serialize() producing plain JSON for `details.state`.
- P1.M7.T1.S1/S2 (persistence mirror + reconstruction): needs serialize()/static deserialize() round-trip.
- Panel/renderers: consume change events only — state.ts must never import UI.

## Design decisions embedded in the PRP
- node:events EventEmitter, no extra deps; typed `.on` via declaration merging or generic wrapper (implementer's choice, typed surface mandated).
- serialize(): Map → ordered plain object keyed by id (order[] is the array form); JSON-compatible, details-friendly. deserialize() validates shape tolerantly (same spirit as config.ts guards) since input may come from persisted custom entries.
- rev starts at 1; bumpRev only on content mutation; answer writes use a separate applyAnswer path that does NOT bump rev (h2.39).
- Events: 'changed' (any mutation, carries full serialized state — panel re-render is cheap), 'questions-upserted' (array of ids), 'epoch-bumped' (number), 'completed-cleared' (emitted when completion clears state; keeps listeners simple).
- h2.43: state never cached across session_shutdown — singleton accessor resets; document in JSDoc.
- Snapshot type defined here (data shape belongs to state), ring logic lands in S4.

## Testing precedent
- vitest co-located `src/*.test.ts` per P1.M1.T1.S2 pattern; node >=22 (Map/Object.fromEntries, structuredClone all fine).

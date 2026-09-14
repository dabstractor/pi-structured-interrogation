# Research notes — bugfix P1.M2.T1.S1 (BUG-003: epoch in buildSubmission content)

## Current code (verified, src/delivery.ts)

- `buildSubmission(state, diff, note?)` at ~lines 129–175.
- Budget loop (~145–157) measures `Submitted ${k}: ${list}`.length against `SUBMISSION_LIST_MAX_CHARS` (240), drops entries from the end, appends `; +{m} more`.
- Content (line 162): `` `Submitted ${k}: ${k === 0 ? "(no changes)" : list}\n${SUBMISSION_REMINDER}${noteLine}` `` — noteLine is a MODEL-visible `NOTE: ...` third line (h2.32/R3).
- Side-effect tail (166–167): `takeSnapshot(state); state.bumpEpoch();` — runs BEFORE `details`/return.
- `SUBMISSION_REMINDER` at line 43 = "Consider how these affect your other questions."
- details = { changed, note?, epoch: diff.epoch (PRE-bump), card: diff }.

## EPOCH SEMANTICS — the contract decision

- `diff.epoch` is PRE-bump. buildSubmission bumps epoch before returning. The item contract REQUIRES the POST-bump epoch (`diff.epoch + 1`, equal to `state.epoch` after the bump) in content: that is the epoch the model must echo in the next upsert to pass `assertFresh` in one round trip. (architecture/delivery-completion.md line 33 suggests pre-bump `diff.epoch` — superseded by the item contract and the BUG-003 repro: echoing pre-bump 1 → "session epoch is 2 (you sent 1)".)
- P1.M1.T3.S1 (parallel, in flight) tightens `assertFresh` to REQUIRE epoch on upserts touching existing ids — makes the correct echoable epoch strictly more important.
- details.epoch stays PRE-bump (snapshot label consistency, reconstruct delta-filter `submission.details.epoch >= state.epoch` depends on it — delivery-completion.md line 71). Do NOT change details.

## Test surface to update (src/delivery.test.ts, byte-exact assertions)

- :88 happy path 2 answers
- :110 editedArchived line-1 assertion
- :126–131 truncation test (regex on line 1 start/end — suffix folded in means the `+m more` rollup now sits BEFORE the epoch segment; adjust `/\+\d+ more$/` expectation)
- :141 single-huge-entry test (line 1 exact equality)
- :154 zero-changes exact content (must include ` (state epoch {n})` after "(no changes)")
- :653, :685 note tests assert `lines[0].toBe("Submitted 1: q1: SQLite")` / `"Submitted 0: (no changes)"` — update to include suffix
- :278 is a hand-built opaque fixture in the S2 transport describe — NOT produced by buildSubmission; leave it (transport tests treat payload as opaque), or update for consistency only.

## Budget rule

Fold the ` (state epoch {n})` suffix into the loop measurement: measure `Submitted ${k}: ${list} (state epoch ${n})` so truncation still respects SUBMISSION_LIST_MAX_CHARS. Suffix is never dropped even in the single-huge-entry case.

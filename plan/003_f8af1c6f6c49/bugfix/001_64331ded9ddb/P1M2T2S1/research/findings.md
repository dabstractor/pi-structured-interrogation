# Research notes — P1.M2.T2.S1 (persist moot reason on Question; consume in renderers)

Primary source: `architecture/ripple-moot-seams.md` §B1–B6, §4 Option A, §5 — all anchors re-verified by direct read today.

## Verified anchors

### Producer — src/depends-on.ts evaluateDependsOn (:168–206)
- Mute site (:199–200): `if (q.status !== "moot") state.setStatus(q.id, "moot"); mootered.push({ id: q.id, reason: result.reason });` — reason lives ONLY in the return array.
- Reopen sites: empty-dependsOn branch (:176–179) and re-met branch (:186–189) both do `if (q.status === "moot") { state.setStatus(q.id, "open"); reopened.push(...) }` — the two places mootReason must be CLEARED.
- Idempotence contract (docblock :164–166 + tests depends-on.test.ts :60/:175/:193–196/:211/:293/:314): "one changed event per actual status flip, and nothing otherwise" — still-moot passes must stay event-free.
- `setStatus` (state.ts:376–381): `q.status = status; this.emitChanged()` — writing mootReason must NOT go through extra setStatus calls; a direct field write is the way (no emit).

### State — src/state.ts
- Question interface :68–91 — NO reason field today. Add `mootReason?: string`.
- `serialize()` structuredClones stored questions — new field flows automatically; `persistence.ts` has no schema allowlist (ripple-moot-seams §5).
- `reviveQuestion` (:514–) — add tolerant revival `if (typeof value.mootReason === "string") q.mootReason = value.mootReason;` (follows the exact pattern of every other optional field).
- `applyAnswer` (:363–370) unconditionally re-marks answered — moot questions are unreachable through the panel accept paths (moot/withdrawn no-op, actions.ts :316), so no clearing needed there; renderers guard status==='moot' as belt-and-braces.

### Consumers (current wrong derivations)
- short-view.ts `mootReason(q)` (:149–152): reads `q.answer?.value ?? DEFAULT_MOOT_REASON` ("dependency changed", :87). Rendered :324–332 via `MOOT_HEAD = "⊘ moot — "` (:89). Docblock :144–147 literally anticipates this: "if state grows one" structured reason.
- overview.ts `overviewMootReason(q)` (:166–172): `answer.text → answer.value → DEFAULT`. Row render at :270-279-test only passes because fixtures BAKE the literal into answer.text.
- layout.ts `statusMarkers` moot branch (:329–333): `truncateVisible(q.answer?.text ?? "", MARKER_REASON_CAP)` — cap 24 (:337). Elaboration-as-reason conflation.
- delivery.ts buildCompletion (:410–419): recomputes reasons via evaluateDependsOn map + strips "moot: " prefix (:396–403) — KEEP; add an agreement assertion.

### merge.ts clear-site
- applyUpsert builds the merged replacement around :178–200: `{ ...structuredClone(incomingQ), rev, status, answer }` — incoming has no mootReason, but the spread could carry stale copies from... no: merged is built from INCOMING clone, so field is naturally absent (undefined). Verify + add explicit `mootReason: undefined`? The spread of incomingQ cannot carry it (agent never sends it). The stale case is the rule-1 silent update path (`status = existing.status` kept) — if existing was moot... rule-1 keeps status moot and SKIP_EVALUATION skips moots; reopening paths in merge (withdrawn/closed → open/answered) leave moot untouched. Conclusion: merged object never inherits a stale reason; still add a defensive clear + test per contract §5 ("a lingering reason must never render on a non-moot question").

### Test flips (from §B6, all confirmed)
- short-view.test.ts :167–175 (mootReason describe) + :403 (render pin) — flip to field-based.
- overview.test.ts :202–220 (derivation) + :270–279 (baked row) — :204/:210/:213/:270 flip.
- panel.test.ts :567–586 — baked answer.text fixture flips to field/production-path.
- NOTE: S2 (P1.M2.T2.S2) owns de-masking the FIXTURE-baked tests to production scenarios; this item flips the derivations the field enables and may rewrite the helper-level tests it directly touches — keep S2's scope (production-path row/panel tests) un-duplicated by stopping at helper-level + minimal render assertions here. Coordinate: if a test only passes because of baked text, flip it HERE (renderer change makes it fail anyway); S2 adds end-to-end evaluateDependsOn→render scenarios.

### Purity traps
- delivery.test.ts :758 `expect(s.serialize()).toEqual(before)` byte-identical — buildCompletion's evaluateDependsOn call must not change serialize output on stable states → still-moot write must be same-string no-op.
- depends-on.test.ts zero-events pins — write field WITHOUT emitChanged; only status flips emit (already via setStatus).

## Fixture shape (contract §2)
dep "storage" (options sqlite/postgres, gate group) + q2 dependsOn [{id:'storage', equals:'postgres'}]; answer storage=sqlite → reason "moot: storage=sqlite".

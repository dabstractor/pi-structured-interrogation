# T5.S9 flip audit — evidence table (verified against HEAD 7972f88; suite green 630/630)

## Fixtures (actions.test.ts)
- `choiceQ(id, overrides)` :65 — options = OPTS_AB (`a`, `b`); cursor domain: 0=`a`, 1=`b`, 2=✎ Other.
- `seed(specs)` :83 — `status: "answered"` ⇒ `applyAnswer(id, {value: overrides.answer?.value ?? "a", at: T0})` — answered questions DO carry an answer; other statuses via setStatus (NO answer).
- `ALL_STATUSES` :710 — q1 open + recommendation "a"; q2 answered (recorded "a", NO recommendation); q3 reasked; q4 moot; q5 withdrawn; q6 closed (no answer).
- Proven post-pin fixture pattern (T1.S1-landed, ~:1258-1276): `seed([{id:"q1", overrides:{recommendation:"b", status:"answered", answer:{value:"a", at:T0}}}])` → `expect(panel.cursorIndex).toBe(1); // the RECORDED answer's display row (D-R13) — not 0, not ★`.

## Row-by-row audit (to-flip map → current state)

| Map row | Current anchor | State | Verdict |
|---|---|---|---|
| actions.test.ts:541 `test_d_cursor_resets_to_star_preselect_on_every_change` | :796-806 | OLD contract: name + both comments credit ★ preselect ("recommendation \"a\"" — factually wrong: q2 has NO recommendation; row 0 holds because the RECORDED "a" owns it). q1 leg (prev → open q1, rec "a") is accurate post-pin. | **FLIP** — rename + local fixture with recorded "b" (row 1) discriminator; mirror the :1258 pattern through next/prevQuestion |
| actions.test.ts:~1878/1948 preselect/write-in rows | :1964-1975 `test_submit_superseded_writein_rebinds_as_elaboration` | ALREADY FLIPPED (2d7a98f): comment carries "FR-35 note … drives to \"a\" explicitly; the ★-reseed premise … is that flip's casualty" | **LEAVE** (verified complete) |
| actions.test.ts revisit rows in auto-submit tests | :2118, :2125 (`test_auto_review_flow…`), :2167 (`test_auto_consecutive_edits…`), :2237 (`test_resume_pending_panel_new_commit…`) | Stale comments "setter re-seeds the cursor to the ★ \"a\" preselect" on ANSWERED revisits (edits). Recorded "a" == row 0 == ★ row (rec "a") → assertions pass coincidentally; comments pin the old premise. | **FLIP** — comment → recorded-answer seed + one seed assertion at first revisit (loop math: 3rd loop iteration recorded "b" → row 1 — keep loop comment-only) |
| actions.test.ts:195 / :245 | seed tests on OPEN q1 (rec "a") | Accurate post-pin (unanswered keeps ★) | **LEAVE** |
| actions.test.ts:~995 EXPLAIN-003 re-seed | (T1.S2-owned) | Flipped by 886489c | **LEAVE** |
| actions.test.ts:~1684/1829 same-value rows | (T2.S5-owned) | Flipped by 2d7a98f/d6d1553 | **LEAVE** |
| deep-view.test.ts:~420 | :420 | T2.S6-owned, landed 4a9d277; :524 already post-pin | **OUT OF SCOPE** |
| overview.test.ts:~412/452 | :400-455 | Both candidate rows target UNANSWERED questions (q1 rec "a" seed; jump test q2 rec "postgres", no answer) — accurate post-pin; marker parity rows :138-159 are the post-T3.S7 vocabulary tests | **LEAVE** (map's "if not already handled in T3.S7" → resolved: handled/accurate) |
| panel.test.ts:~618 | :617+ | ALREADY FLIPPED by T1.S2: `test_overview_enter_revisit_seeds_to_recorded_answer_row` exists with ANSWER-PIN-001 JSDoc; preceding jump test targets unanswered q2 (accurate) | **LEAVE** |
| ac-panel.test.ts:~477 | :477 | `expect(panel.cursorIndex).toBe(0); // alpha preselected (no recommendation)` — q09 is the gate, UNANSWERED, NO recommendation (fixture :153 gives recommendation only to q01). Assertion accurate (unanswered clamp to row 0); comment mislabels it a "preselect" row | **FLIP comment only** (assertion unchanged) |
| short-view.test.ts residual | :79-135 | Post-pin coverage landed by S1 (1fba337): "ANSWER PIN" describe, stale-value clamp test; docstring ★ claims scope UNANSWERED questions | **LEAVE** |
| two-stage.test.ts residual | :229, :520-523 | :229 targets an UNANSWERED question (T4.S8 grep-verified "verified accurate"); :520-523 already carries an "FR-35 note" (write-in supersede) | **AUDIT-ONLY** (expected no-edit; flip per decision rule only if re-derivation shows an answered target) |

## Decision rule (binding for every audit pass)
Assertion/comment credits ★ preselect (or ★ re-seed) at the moment the target question carries an `answer` → FLIP to the recorded-answer contract. Target UNANSWERED → accurate post-pin, leave (optionally clarify comment wording, never the expectation). Never delete an assertion; every flip asserts the NEW contract.

## Gates
- `grep -rn "cursor_resets_to_star_preselect" src/` → 0 hits after flip
- `grep -rn "re-seeds the cursor to the ★" src/panel/*.test.ts` → 0 hits (does NOT match the accurate :1972 "★-reseed premise … casualty" note)
- `npx vitest run src/panel/` green; `npm run typecheck`; `npm test` full green
- Diff touches only test files (+ tasks.json status flip)

## Parallelism note
T4.S8 (comment sweep) runs in parallel but is SOURCE-comments-only and explicitly leaves all *.test.ts to T5.S9/S10 — no write conflict.

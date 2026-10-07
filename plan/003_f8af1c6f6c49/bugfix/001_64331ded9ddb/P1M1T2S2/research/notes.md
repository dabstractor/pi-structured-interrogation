# Research notes — P1.M1.T2.S2 (writeInEnter reasked exclusion)

## Verified facts (working tree, line-exact)

1. **writeInEnter no-op** (actions.ts :379-385): `recorded !== undefined &&
   recorded.value === text && (recorded.custom === true || q.type === "text")` →
   consume + advance + blur + return true. NO status exclusion — a rule-1 re-asked question
   with a kept write-in (or kept text answer) is wedged exactly like BUG-001's option flavor.
2. **Post-no-op sequence** (verified current code):
   - FR-18 gate :389-392: `(status === "answered" || "submitted") && victims > 0` →
     `reasked` SKIPS the gate → direct commit (seam-free re-confirm, exactly what we want)
   - direct commit :393: `applyAnswer(q.id, { value: text, custom: true, at: now })` —
     **ALWAYS sets custom:true**. For a reasked TEXT question whose recorded answer is plain
     (fallback-shaped: `applyAnswer({value, at})` no flag — recorded via fallback.ts /
     debug-commands.ts), a same-value re-commit would FLIP the kind to custom. Item contract:
     "custom flag/kind preserved — custom write-in re-commits custom, text re-commits plain."
     ⇒ the reasked same-value commit must derive `custom` from `recorded.custom === true`
     (choice custom write-in → true; plain text → undefined).
   - then evaluateDependsOn → consumeCommittedBuffer → advance → blur →
     maybeAutoSubmit({wasUnanswered: status === "open" || "reasked", ...}) (:408) — reasked
     counts as unanswered, so the completing transition can fire and (with S1's fixed
     submit(), Complete) DELIVER.
3. **Stay-green pins in the same describe** (write-in no-op describe, actions.test.ts):
   - :623 test_wi_same_value_on_complete_set_does_not_auto_submit (twin with ANSWERED set)
   - :543 test_wi_same_value_recommit_on_text_question_without_custom_flag_is_inert
     (answered status — stays inert; NOT reasked)
   - the byte-identical no-op tests for ANSWERED/SUBMITTED (~:520-542) and
     test_wi_same_value_recommit_on_closed_stays_closed (~:557)
   - :658 test_e_digit_beyond_option_count_is_noop_false (unrelated, guard)
   - :610 test_wi_same_value_recommit_consumes_buffer_no_draft_residue (VAL-002, answered)
4. **Sibling S1 contract** (acceptOptionIndex reasked exclusion, in flight): one-line
   `q.status !== "reasked"` on ITS no-op; parallel function, no shared code. Its decisions.md
   pin "covers both seams (extend its wording if it names only acceptOptionIndex)" per item.
5. **Kind-preservation precedent**: submit() reconciler ships text answers with custom:true
   (test :2076-2082 — panel-typed text IS a write-in). So ONLY the same-value reasked
   re-confirm preserves the recorded kind; a different-text commit on a text question keeps
   custom:true (existing semantics, out of scope).
6. P1.M2.T1.S2 (widened FR-18 gate incl. closed) must not capture the same-value reasked
   re-confirm — gate statuses are answered/submitted(+closed later), never reasked.
7. Fixtures for TDD: writeInSeed harness (choice questions, custom write-ins seeded via
   applyAnswer {value:'alpha', custom:true, at:T0}); text via
   seed([{id:'t1', overrides:{type:'text', options:undefined}}]).

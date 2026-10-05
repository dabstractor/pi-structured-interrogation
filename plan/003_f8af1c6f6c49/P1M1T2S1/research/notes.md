# Research notes — P1.M1.T2.S1 (acceptOptionIndex same-value no-op)

## Verified code facts (actions.ts, current)
- `acceptOptionIndex(panel, q, optionIndex): boolean` at :244 (verified full body). Flow: `displayOptions(q)[optionIndex]` (display position seam, D-R13) → `proposed = {value, at}` → `wasUnanswered = status open|reasked` → ripple seam at :255 `if (q.status === "answered" || q.status === "submitted") { if (!panel.confirmRippleEdit(q.id, proposed)) return true; }` → `applyAnswer` → `evaluateDependsOn` → `advanceAfterAccept(panel)` → `maybeAutoSubmit(panel, undefined, {wasUnanswered, questionId})` → return true.
- digit path :190-197: guards (digitQuickSelect, 1..9, choice, n-1 < options.length), moot/withdrawn → consumed no-op, else `return acceptOptionIndex(panel, q, n - 1)` — inherits the no-op automatically.
- `advanceAfterAccept` (:262): nextUnanswered from current index; sets currentId; invalidate. NO-OP path must call exactly this (same Q14 rhythm) and nothing else.
- deep-view.ts:528 acceptFromDeep, :552 `if (q.answer === before) return true;` heuristic reads no-op as VETO — S6's job, but S1 must expose the THREE-OUTCOME result so S6 can distinguish.
- panel-ui-seams.md §Accept-paths (:15-19) is the authoritative seam doc; §Comment-purge notes ~:278 status-agnostic comment in actions.ts.
- Tests: src/panel/actions.test.ts describes: "accept — commit + advance (Q14=A)" :235, "accept on answered — ripple-confirm seam (AC-13)" :339, "digit — quick-select (R5)" :393. Conventions: harness makePanel/seed/makeDeps per bug-hunt docs; ripple rendered through panel harness (seamMock(confirmRippleEdit)) — mock nothing external.
- Upstream contract (P1.M1.T1.S1, COMPLETE): `initialCursorIndex` (short-view.ts:127) pins caret to the recorded answer — enter/digit land on the recorded row by default. S3/S1 schema string changes irrelevant here.
- FR-35/h2.34: same-value enter/digit on recorded value = state no-op, advance only, NO modal/state-write/answer.at/auto-submit. Custom write-in answers: `answer.custom === true` means answer.value is free text, never equal to an option value — same-value check only applies when `!answer.custom && answer.value === opt.value`.

## Design
- New exported enum/type `AcceptOutcome = "noop" | "accept" | "veto"` (or boolean-returning wrapper + separate outcome — enum cleaner for S6). Keep `acceptOptionIndex` signature compatible: either return `AcceptOutcome` (breaking internal callers: accept :265 and digit :196 currently treat boolean) or add `acceptOptionIndexOutcome` returning the enum with `acceptOptionIndex` wrapping to boolean. PRP chooses: change return to `AcceptOutcome` and update the two internal call sites (`truthy` handling: "veto"|"accept" were true, "noop" was also true-as-consumed — all three consumed, so wrappers keep `return true` semantics; digit/accept both just return consumed-ness).
- No-op branch placement: AFTER computing `opt` (need its value) and BEFORE the answered/submitted ripple seam (:255). Condition: `q.answer !== undefined && q.answer.custom !== true && q.answer.value === opt.value` → `advanceAfterAccept(panel); return "noop";` — skips confirmRippleEdit/applyAnswer/evaluateDependsOn/maybeAutoSubmit entirely; NO fresh answer.at (applyAnswer never runs).
- advanceOnly on no-op: yes per FR-35 ("state no-op that may advance").

## Tests (actions.test.ts, new describe "acceptOptionIndex — same-value no-op (ANSWER-PIN-001/FR-D9)")
1. enter on recorded value: seed answered q1 (value a, at T); caret pinned (S1) → accept(panel) → consumed; state unchanged: q1.answer.at === T, status "answered", epoch unchanged, confirmRippleEdit NOT called (seam spy), no sendMessage/deliver, currentId advanced to next unanswered.
2. digit on recorded value (digit 1 where option 1 is recorded): same zero-change assertions; consumed.
3. different option on answered question still raises the seam (regression: FR-18 fires only on DIFFERENT choice).
4. maybeAutoSubmit never fires from no-op: zero-unanswered complete set + no-op commit → no delivery (transition-gated context never reached).
5. no answer present (unanswered q): normal accept path unchanged (regression).
6. write-in answered question (custom:true) + digit/enter on any option row ≠ no-op → routes through seam as an edit (custom value never matches option values).
7. moot/withdrawn status-agnostic guard untouched.

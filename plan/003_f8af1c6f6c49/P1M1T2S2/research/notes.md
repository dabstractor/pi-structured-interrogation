# Research notes — P1.M1.T2.S5 (writeInEnter: byte-identical re-commit inert + buffer consume)

## Verified facts (working tree, line-exact)

1. **src/panel/actions.ts `writeInEnter` (:295-340)** — current shape:
   - currentQuestion guard → blur, return true
   - empty-buffer branch (trim gate, RAW commit elsewhere): commitTextDraft + return true (NO consume — correct, nothing was committed)
   - FR-18 branch: `(status === "answered" || "submitted") && rippleVictims > 0` → beginWriteInConfirm (deferred)
   - direct commit: applyAnswer({value: text, custom: true, at}) → evaluateDependsOn →
     **consumeCommittedBuffer(q.id) (:328, BEFORE advanceAfterAccept — VAL-002)** → advanceAfterAccept →
     blurTextField → maybeAutoSubmit({wasUnanswered: open||reasked, questionId})
   - Today a byte-identical re-commit runs the FULL commit path (fresh `at`, possibly the FR-18
     modal) — violates ANSWER-PIN-001 (h2.65/FR-35: "a byte-identical write-in re-commit is
     equally inert"; h2.34: "An identical re-commit … is not a change: no modal, no state write,
     advance only").
2. **`consumeCommittedBuffer(questionId)` (panel.ts :962)** — guarded no-op unless
   `bufferOwner === questionId`; seeds editor "", deletes draftSlots entry, clears DraftStore
   draft (`explicit: true`), disowns buffer. Already used by writeInEnter direct path and
   ripple-confirm's applyWriteInConfirm (ripple-confirm.ts :300). The VAL-002 reason: the
   advance's currentId setter runs syncBufferToQuestion which write-throughs the buffer into
   the NEXT question's slot — committed text must never land in a draft slot.
3. **Sibling contract S4→S1 PRP** (`plan/003_f8af1c6f6c49/P1M1T2S1/PRP.md` — acceptOptionIndex
   same-value no-op, in flight/landing): no-op branch inserted BEFORE the ripple seam; calls
   ONLY advanceAfterAccept; three-outcome type `AcceptOutcome = "noop" | "accept" | "veto"`
   consumed by S6 (acceptFromDeep). writeInEnter keeps its plain `boolean` (nothing downstream
   needs outcome triage on the editor path).
4. **Test landscape**: item's cited line refs (~:1684-1685, ~:1829-1836) are from the pre-D1
   tree and have DRIFTED. Current anchors: actions.test.ts ~:918-960 (writein modal gating),
   ~:1653-1700 (commitWriteIn harness + WRITEIN-002 submits), ripple-confirm.test.ts ~:600-700
   (wi confirm apply/esc/direct). The rows to FLIP assert same-value write-in re-commit
   behavior (fresh `at` / modal / auto-submit). Locate via grep (in PRP) — do not trust the
   old line numbers.
5. **Divergence guard**: the no-op must match S1's option semantics — condition needs
   `q.answer` present (ANY status with an answer: answered/submitted/closed — moot keeps a
   dimmed answer too but moot questions aren't advance-commit surfaces; keep the branch
   simple: any answer present) and byte equality on the RAW buffer (not trimmed — the commit
   path commits raw; equality must be against what a commit WOULD have shipped).
6. **Text questions**: `type:"text"` commits also flow through writeInEnter (accept on text
   question opens writein duty; FR-D8/BUG-008). Their answers have `value` without `custom` —
   the item's second predicate `q.type === "text" && q.answer.value === text`.
7. **P1.M1.T5.S10 (AC-16)** consumes this: "a byte-identical write-in re-commit is inert" —
   the consumed-buffer guarantee is part of that scenario.

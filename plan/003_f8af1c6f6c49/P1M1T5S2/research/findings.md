# P1.M1.T5.S10 (dir P1M1T5S2) — research findings, verified at HEAD f3e00c5

Task: "AC-16 scripted test + binding green gates". tasks.json id = **P1.M1.T5.S10**
(status "Planned"; enum values in use: Complete / Planned / Researching).
NOTE: PRP directory is `P1M1T5S2` (orchestrator path); the tasks.json entry is
`P1.M1.T5.S10` — flip THAT entry, located by title "AC-16 scripted test + binding green gates".

## 1. Verified production seams the AC-16 test drives

- `src/panel/actions.ts:260` — `export type AcceptOutcome = "noop" | "accept" | "veto" | false;`
- `acceptOptionIndex` no-op branch (actions.ts ~:288-296): `recorded !== undefined &&
  recorded.custom !== true && recorded.value === opt.value` → `advanceAfterAccept(panel); return "noop"`
  — checked BEFORE the ripple seam; skips confirmRippleEdit/applyAnswer/evaluateDependsOn/maybeAutoSubmit.
- Ripple seam: actions.ts ~:303 `if (!panel.confirmRippleEdit(q.id, proposed)) return "veto";`
  — fires only when `q.status === "answered" || "submitted"`; default seam raises the modal when
  `rippleVictims(panel, q.id).length > 0`.
- Modal state: `panel.confirmMode: RippleConfirmState | null` (panel.ts ~:507). Non-null ⇒ MODAL:
  handleInput consumes every key (enter=keep, esc=cancel); null ⇒ resting state.
- `accept(panel)` (exported wrapper, used by AC-13 e2e): boolean-coerced — `expect(accept(panel)).toBe(true)`.
- Advance: `advanceAfterAccept` → next UNANSWERED question (Q14 rhythm).
- Nav: fixed ←/→ keys → `actions.prevQuestion` / `nextQuestion` (keys.ts ~:404; R1 full-list).
  Raw sequences: LEFT `"\u001b[D"`, RIGHT `"\u001b[C"`, ENTER `"\r"`, ESC `"\u001b"`.
  (Phantom suite already defines DOWN/ENTER/CTRL_S constants — mirror that convention.)
- Write-in via REAL accept path (AC-13 e2e pattern, ac-scripted.test.ts ~:770-775):
  `panel.currentId = id; panel.cursorIndex = options.length;` (✎ row)
  `accept(panel)` → true → `panel.focus === "text"`, `panel.textDuty === "writein"`,
  `panel.textField.setText(text)`, `panel.handleInput("\r")` commits.
- `writeInEnter` byte-identical re-commit inert (T2.S5, commit 2d7a98f): `answer.custom === true &&
  buffer === answer.value` → advance only + buffer consumed (never staged into the draft slot).
- Epoch bumps ONLY inside buildSubmission (a submission) — commits/edits/no-ops never bump.
- Auto-submit: `maybeAutoSubmit` in the commit tail fires only at completeness (zero open/reasked,
  AUTOSUBMIT-003 transition/edit conditions). Keeping one question permanently OPEN silences it —
  `sendMessage` must then stay silent for the whole AC-16 flow (no phantom submissions from any path).
- Display rows D-R13: recommended-first. options [a,b] + recommendation "a" → rows: 0=a(★), 1=b, 2=✎ Other.
  Write-in (custom) answer seeds row `options.length`; stale value clamps row 0 (never ★).
- Panel ctor (AC-13 e2e convention): `new InterrogationPanel({ tui: { requestRender: vi.fn() },
  theme: stubTheme, done: () => {}, state, config: DEFAULT_CONFIG, delivery: deps })` where
  `makeSubmitDeps()` → `{ deps: { sendMessage, isIdle: () => true }, sendMessage }`.
- `panel.cursorIndex` is a public settable field (AC-13 e2e + phantom writeIn helper both set it).

## 2. Stale rows found (stabilization targets)

### src/ac-scripted.test.ts (1062 lines; Mode A per-AC results table at :16-35)
- **:770 STALE** — `panel2.currentId = "q1"; // setter re-seeds cursorIndex to the ★ preselect`
  Context: q1 is CLOSED with recorded answer "b" (committed at :730 via cursorIndex 1). Under
  ANSWER-PIN-001 the setter seeds the RECORDED "b" display row **1**, not ★ row 0.
  Fix: flip comment + ADD `expect(panel2.cursorIndex).toBe(1);` (discriminating: rec "a" = row 0).
- **:728 accurate** — same comment text but q1 is UNANSWERED at that moment (first answer).
  Fix: relabel comment to name the unanswered case (★ preselect survives while unanswered).
- Header table (:16-35): add an AC-16 row (verdict PASS, FR proven FR-35, evidence = new test name).
- "Interactive-only leftovers" comment (~:41) does not list AC-16 — no change needed there.

### src/regression-phantom-submissions.test.ts (385 lines)
- :290 `expect(panel.cursorIndex).toBe(0); // seeds to ★ recommended` — target `cancel-trigger`
  is UNANSWERED at that moment → accurate post-pin (optional clarifier "(unanswered — FR-35)").
- `writeIn` helper (~:174-181) sets `panel.cursorIndex = options.length` EXPLICITLY → immune to
  seeding changes. No row in this suite re-commits an existing answer → audit expects ZERO
  behavioral flips. `panelOf()` (~:153-172) wires drafts + fakeEditor editorFactory + delivery.
- ADDITIVE no-op row (the phantom × pinning bridge — "no phantom submissions from no-op paths"):
  in "one genuine answer" after settle (cancel-trigger CLOSED with "alt"): fresh panelOf(),
  `currentId = "cancel-trigger"` → seeds row **1** (recorded "alt"; ★ "rec" stays row 0 — a
  phantom re-proposal would sit row 0); ENTER on it → no-op advance; assert sendMessage call-count
  unchanged, epoch unchanged (2 after the ctrl+s submission), answer.at unchanged.

## 3. Guard tests (binding gates) — verified scopes
- `src/no-hardcoded-keys.test.ts` scans NON-test `.ts` under src/ only (:184 filters
  `*.test.ts` out) → raw escape-sequence constants in test files are safe.
- `src/keymap-guard.test.ts` asserts `DEFAULT_CONFIG.keys` (ten actions, accelerator grammar,
  guard-list curation) → a test-only diff keeps it green trivially; still MUST be run (binding).

## 4. Concurrency / scope walls
- T5.S9 (dir P1M1T5S1, in flight in parallel) owns ALL src/panel/*.test.ts flips — never touch them.
- T4.S8 landed (f3e00c5 comment sweep). T6.S11 owns README — never touch. Production sources:
  test-only task — if a red test implies a production bug, STOP and report.
- Gates must not regress T5.S9's greps: `grep -rn "cursor_resets_to_star" src/` stays 0-hit.

## 5. AC-16 fixture design (derived from contract §AC-16 + FR-D9 seams)
q1 choice [a,b] rec "a" (pin target) · q2 choice [x,y] rec "x" (write-in target — rec makes the
✎-row pin discriminating: ★ row 0 exists and is NOT seeded) · q3 choice (permanently open —
completeness blocker) · q4 choice [x,y] dependsOn [{id:"q1", equals:"b"}] answered "x" early
(the FR-18 ripple victim). Phases: 0 seed q4 via panel → 1 answer q1 "b" (non-rec) → 2 ← back,
caret row 1 ≠ ★ row 0 → 3 ENTER no-op advance (epoch/at/confirmMode/sendMessage all unchanged) →
4 q2 write-in commit, ← back seeds ✎ row 2 + dim preview → 5 byte-identical re-commit inert →
6 different choice "a" on q1 → FR-18 modal (victims [q4]), esc cancels clean, enter=keep applies,
q4 mootered instantly, still zero submissions.

Full walkthrough with assertions lives in the PRP Implementation Blueprint.

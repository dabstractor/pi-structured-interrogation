# System Context — pi-interrogator bugfix changeset 001_c0ff03282c6f

Synthesized from 4 verification scouts (sibling `bug-00*.md` + `testing-and-docs.md` are the
authoritative per-bug dossiers). Ground truth: repo at commit `613437d` (tracked tree clean),
`npm test` = `vitest run` (1224 tests, 48 files), `npm run typecheck` = `tsc --noEmit`.

## Scope

8 post-validation bugs against the shipped M8 delta (WRITEIN/AUTOSUBMIT/SURFACE):
3 Major (BUG-001 gate-hold dead code, BUG-002 R4 draft loss on 3 gestures, BUG-003 AC-13
`(changed)` unreachable) + 5 Minor (BUG-004 duty persistence across navigation, BUG-005
write-in invisibility/✎ parity, BUG-006 unbounded multi-line delta, BUG-007 swallowed bridge
errors, BUG-008 enter no-op on text questions). **Every PRD claim was verified CONFIRMED at
HEAD 613437d** — no corrections. No new dependencies, no new config surface, no new pi APIs.

## Verified fix seams (exact symbols @ 613437d)

| Bug | Primary seam | Fix |
|---|---|---|
| BUG-001 | `maybeAutoSubmit` actions.ts:604-641 — `if (unanswered > 0) return;` at :611 precedes hold arming :624-635 | Reorder: gate-hold (`countUnansweredGate` gate.ts:100, `gateHoldLine` gate.ts:143, `panel.gateWarning` panel.ts:479-481 rendered `footerNoticeLine` panel.ts:1204-1220 non-expiring, any-key dismiss panel.ts:778-781) arms whenever unanswered gates exist at commit + pending>0; keep zero-pending silence. Invert pinned deviation test actions.test.ts:2042; :2023 stays green. Callers inherit: actions.ts:251,311; ripple-confirm.ts:160,304; remote-submit.ts:165,181; index.ts:107-109 |
| BUG-002 | ctrl+c panel.ts:748-751 → `suspend()` :903-907 (no staging); discuss.ts:~105-126 `discussInChat` (keys.ts step-4 intercept ungated); `enterNoteMode` panel.ts:1110-1116 `textField.seed(note)` overwrites buffer | Ungated write-through helper modeled on `commitTextDraft(questionId,text)` panel.ts:881-901 (slot + DraftStore seam; SKIP blur/invalidate side effects; SKIP `stageText` :866-879 — FR-18 modal deferral would orphan pre-suspend) called at top of `suspend()` (focus==='text' guard) and pre-seed in `enterNoteMode`; note-focus exits write the note buffer symmetrically. `draftSlots` Map panel.ts:402; DraftStore seam panel.ts:126-135 (src/draft-store.ts) |
| BUG-003 | `editedArchived` snapshots.ts:209 (`before?.status === 'closed'`); snapshots only at delivery.ts:185 + fallback.ts:261 (both post-`markSubmitted`); close pass `closeSubmitted` merge.ts:282 ← lifecycle.ts:227 takes NO snapshot; baseline = `submissionBaselineOf` snapshots.ts:43-49 (last of ring, state.ts:247-248, size 10) | Option (a) recommended: `takeSnapshot(state)` in `runClosePass` after `closeSubmitted` when `toClose.length>0`. Renders: delta delivery.ts:147 ` (changed)`; card renderers.ts:70/177. RISK: second-snapshot-same-epoch may break consumers assuming one-per-epoch / 'snapshots hold submitted' (fallback.ts:260 invariant comment) → audit is a dedicated first subtask |
| BUG-004 | `textDuty` panel.ts:427, reset only `blurTextField` :1086; nav keys ungated in editor focus (keys.ts step 4) → `currentId` setter panel.ts:352-363 reseeds cursorIndex=`initialCursorIndex(q)` (★) then `syncBufferToQuestion` panel.ts:985-1019 (never re-derives duty); enter fork panel.ts:794-803 trusts duty | Re-derive duty at end of `syncBufferToQuestion` (guard focus==='text') from new question type + cursorIndex via pure predicate extracted from `desiredTextDuty` keys.ts:288 (extract to shared module — direct keys.ts→panel.ts import risks cycle). Labels `renderDutyLabel` layout.ts:277-290 |
| BUG-005 | `hasTextAnswer` layout.ts:181-186 misses `answer.custom`; `answerPreviewLine` short-view.ts:259-269 reads only `q.answer?.text` (write-ins commit `{value, custom:true}` actions.ts:304); overview.ts:130-141 `markerParts` already uses `custom===true \|\| type text` | hasTextAnswer add `custom === true`; preview renders dimmed first line of `(custom || type text) ? answer.value : answer.text` via `truncateVisible` layout.ts:95. Cursor never pins to answers (panel.ts:368, by design — fix is preview, not cursor) |
| BUG-006 | Budget loop delivery.ts:156-181 guard `entries.length - dropped > 1` keeps ≥1 entry whole; `SUBMISSION_LIST_MAX_CHARS=240` delivery.ts:53; `answerSummary` snapshots.ts:128-154 embeds raw value (newlines preserved, actions.ts:255) | Flatten `\n+`/tabs to `" / "` in `answerSummary` (precedent delivery.ts:176-178 note line); add per-entry cap w/ ellipsis in the budget loop. Golden tests delivery.test.ts:79,:600 pin grammar for SHORT entries — must stay byte-identical; delivery.test.ts:133 pins the unbounded behavior (flip) |
| BUG-007 | Bare `catch {}` remote-bridge.ts:261-267; `recordRemoteSubmission` remote-submit.ts mutates state first (applyAnswer :130 → markSubmitted :155 → deliverSubmission :173 → noteSubmissionDelivered :176 → maybeAutoSubmit :181), no rollback possible (snapshot ring/epoch not undoable) | Wrap `recordRemoteSubmission` call (remote-bridge.ts:~348) in try/catch → `emitSubmitResult` (:287-298) nack with widened error literal (union :289 = `"flow_not_found" \| "invalid_answer"` → add `"internal_error"`) + `completeFlow(flowId)`; correlation `requestId`+`flowId` parsed :303-304; keep outer catch as last-resort bus guard. No test pins the swallow today |
| BUG-008 | `accept()` actions.ts:217-218 `if (q.type === 'text') return true;` no-op; affordance short-view.ts:245-252 ('✎ answer…' cursor 0); footer 'enter accept' layout.ts:462; ctrl+t → panel.ts:628 `focusTextField(desiredTextDuty(p))` | Mirror the Other-row branch (actions.ts:~223): set `panel.textDuty = 'writein'; panel.focusTextField();` (do NOT import keys.ts into actions.ts — cycle). Ripple/modal handled downstream `writeInEnter` actions.ts:282-313. Rewrite pinned noop test actions.test.ts:268 |

## Binding constraints (all subtasks)

- **AUTOMATION-POLICY** (plan/001_0d6760db6bc5/AUTOMATION-POLICY.md): scripted vitest only — never
  live TUI, never real `interrogate`, never waiting on user answers.
- **Implicit TDD**: every subtask = failing test → implement → green. No 'write tests' subtasks.
- **no-hardcoded-keys guard** (src/no-hardcoded-keys.test.ts): any runtime string naming a key
  (e.g. `Ctrl+S` in hold lines/flashes) must interpolate `resolveKeyLabels(config)` (config.ts:449);
  only `DEFAULT_CONFIG` allowlisted. `keymap-guard.test.ts` pins defaults.
- **Test harness patterns** (no shared test-utils): panel = `makePanel`/`seed`/`makeDeps` stubs
  (src/panel/actions.test.ts:29-112, `{requestRender: vi.fn()}` TUI stub + `stubTheme`); bridge =
  `FakeBus` + `makePi` + `makeBridge` (src/remote-bridge.test.ts:21-75); throwing deps injectable
  via `RemoteBridgeOptions.getState`.
- **Deliberate test flips in this changeset** (expected, not regressions): actions.test.ts:2042
  (invert hold-line deviation pin), actions.test.ts:268 (rewrite enter-on-text noop), delivery.test.ts:133
  (re-pin bounded entry), short-view.test.ts:197 (extend beyond hand-set answer.text).
- **Snapshot ordering contract**: takeSnapshot BEFORE bumpEpoch (unchanged by BUG-003 — close pass
  never bumps).
- **Answer shape**: write-ins commit `{value, custom?: true, at}` (no `text`); `reviveQuestion`
  state.ts:558 must already carry `custom` (shipped in M8).

## Docs map (Mode A rides with work; Mode B = final task)

spec/ is LIVING documentation (git log shows spec commits riding fixes). Targets:
- README.md: gate-hold 52-54+253 · drafts/R4 66-68, 212, 254-255 · AC-13 262 · write-ins 36,
  43-47, 198-204 · delta shape 55-57 · hotkeys 151-162.
- spec/product-requirements.md: FR-3 :27 · FR-12 :38 · FR-32 :66 · AC-13 :91 · AC-2 :76-77 ·
  AC-2c :79. spec/ui-spec.md: :39, 56-65, 72, 129. spec/decisions.md: :13, 21, 27, 40-41.
  spec/architecture.md: 149-162. spec/state-and-persistence.md: 126-130 (snapshot invariant —
  Mode A with BUG-003). spec/tool-protocol.md: submit-result error values (Mode A with BUG-007
  if documented there).
- README has NO bridge-ack passage (BUG-007 needs no README change).

## Build order rationale

M1 (majors) first: BUG-003's snapshot change must land before BUG-006's golden-delta churn
(cross-dependency M2.T3.S1 → M1.T3.S2); BUG-002's write-through helper precedes BUG-004's
panel.ts duty work (M2.T1.S1 → M1.T2.S3) to serialize panel.ts edits. M2 minors are otherwise
independent seams. M3 = full-suite regression gate then changeset-level docs sweep (Mode B,
depends on everything). Docs already PROMISE the fixed behavior (README:52-53, ui-spec:72) —
most fixes need no doc change beyond the final verification sweep.

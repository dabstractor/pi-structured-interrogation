# README.md sweep — verification record (Mode B, P1.M3.T2.S1 / wave 001_64331ded9ddb)

Swept the four doc-sync areas (a–d) from the PRP against `spec/decisions.md`
pins (wording source of truth) and the landed tree. Navigation by quoted text
(research-time line anchors had drifted).

Result: **6 passages edited, 8 verified as-is.** `git diff --stat` shows
README.md only (plus this note); `npm run typecheck` + `npm test` green.

## decisions.md pin verification (read-only; gaps flagged, not written)

| Pin | BUG | Status |
|-----|-----|--------|
| D-R6 panel-parity (pending ids flush → submitted even on empty diff; zero-pending early return unchanged) | BUG-002 | ✅ present ("D-R6 parity, panel path (2026 wave 001_64331ded9ddb / BUG-002)") |
| ANSWER-PIN-001 reasked exception (same-value enter/digit/write-in on `reasked` = re-confirmation commit; settled statuses stay inert; kind-preserving write-in twin) | BUG-001 | ✅ present ("answer pinning re-ask amendment", 2026-10-05) |
| FR-18 closed-edit pin (gate widened to `answered\|submitted\|closed` on accept/digit; writeInEnter + stageText twins; same-value no-op runs before the gate) | BUG-003 | ✅ present ("FR-18 closed-edit ripple", 2026-10-06) |
| Moot-reason persistence (`moot: {depId}={value}` on `Question.mootReason`, rendered verbatim with prefix) | BUG-004 | ✅ present ("moot reason persistence", 2026-10-06) |
| Epoch-echo exemption (fresh receiver + all-new ids accepts any sent epoch) | BUG-005 | ⚠️ **MISSING from decisions.md** — the fix itself HAS landed (guards.ts BUG-005 exemption docstring; guards.test.ts "BUG-005: fresh state (epoch 1, empty) + all-new ids accepts any sent epoch" + conjunction test), but the parallel P1.M3.T1.S1 subtask has not appended its pin (its plan dir does not exist yet at sweep time). **Flagged only — spec/ is not this task's edit surface.** The README edit for area (d) describes the landed, test-pinned behavior. |

## Passage-by-passage record

| # | Area | Passage (quote anchor) | BUG | Status | Change |
|---|------|------------------------|-----|--------|--------|
| 1 | (a) | Usage §2 revisit ("`enter` or a digit on the recorded value just moves you along — no state change, no resubmission, no confirm.") | BUG-001/002 | **edited** | Appended the re-ask exception: "Re-asks are the exception: when the agent re-asks a question, re-selecting your answer re-confirms it — the same value (`enter`, a digit, or a byte-identical write-in) on an unchanged option list, or a re-answer after the options changed — and the re-confirmed answer ships; a re-asked question never strands." Covers rule-1 re-confirm AND rule-2 truthful delivery (D-R6 panel parity) without internals. |
| 2 | (b) | Usage §2 ripple sentence ("…raises the invalidation confirm when it would moot dependent questions.") | BUG-003 | **edited** | Extended: "— any edited question with a recorded answer counts, archived (closed) ones included." Matches AC-16's different-choice language; no seam internals (status-list gate form stays in decisions.md). |
| 3 | (a) | AC-3 ("Agent reply closes answered questions / re-asks preserve drafts.") | BUG-001 | **edited** | One-line extension: "; a re-asked question re-confirms on same-value `enter`." |
| 4 | (c) | AC-6 ("Contradicting a `dependsOn` → dependent greys as moot instantly; overview shows ⊘.") | BUG-004 | **edited** | Inserted the real reason format: ", with the real reason (`moot: {dep}={value}`)". |
| 5 | (b) | AC-13 ("Editing an archived answer re-marks it pending; next diff card highlights the change.") | BUG-003 | **edited** | Inserted: "; a different choice raises the same invalidation confirm as a live edit". |
| 6 | (a) | AC-16 ("…`enter`/digit on the recorded value is a zero-state-change advance; a byte-identical write-in re-commit is inert; …") | BUG-001 | **edited (correction — the priority edit)** | The unqualified "zero-state-change advance / inert" wording was wrong post-BUG-001. Now: "…is a zero-state-change advance and a byte-identical write-in re-commit is inert — except on a re-asked question, where same-value `enter`/digit (or a byte-identical write-in) re-confirms and ships; …" Matches the ANSWER-PIN-001 reasked-exception pin (both seams). |
| 7 | (d) | Model note, completed-swap ("an upsert sent after completion starts a fresh interrogation (the epoch restarts at 1) that completes normally.") | BUG-005 | **edited** | "(the epoch restarts at 1; its first upsert may echo the previous epoch — accepted)". Behavior verified landed in tree (guards.ts BUG-005 exemption + tests); decisions.md pin flagged missing above. |
| 8 | (d) | Model note, :98 ("`rev`- and epoch-guarded — upserts touching existing ids must echo the current epoch") | BUG-005 | verified-as-is | NOT weakened — the exemption is narrow (fresh receiver + all-new ids); this guidance is still correct for existing-id upserts. |
| 9 | (a) | Usage §3 submitting paragraph ("`ctrl+s` still submits partial sets — unanswered questions stay open.") | BUG-001/002 | verified-as-is | Still true; re-confirmed/re-answered re-asks are pending, so they ship. "Nothing to submit" flash was never README-documented; the never-strand consequence is carried by edit #1. |
| 10 | (a) | AC-2 ("Partial `ctrl+s` → compact delta + reminder; epoch bumps; remainder stays open.") | BUG-002 | verified-as-is | Consistent with D-R6 parity: with pending answers the submit always flushes. |
| 11 | (a) | AC-2c ("answering the LAST question ships with no keypress beyond the answer…") | BUG-001 | verified-as-is | A re-confirm on a re-asked last question IS "answering the last question" — line remains true (re-confirm may fire the transition). |
| 12 | (a) | Usage :85 surfacing allow-list ("unanswered (open/reasked) questions") | BUG-001 | verified-as-is | Re-asked counts as unanswered — unchanged. |
| 13 | (b) | AC-7 ("Edit invalidating dependents → confirm dialog; esc cancels cleanly.") | BUG-003 | verified-as-is | Scope-silent but accurate; AC-13 + Usage sentence carry the archived coverage (avoiding redundancy). |
| 14 | (d) | AC-8 ("Stale upsert (wrong `rev`/`epoch`) → rejected with current text/rev; re-apply heals.") | BUG-005 | verified-as-is | Its scenario (stale update to existing ids) still rejects — the exemption only covers fresh receivers + all-new ids. |
| 15 | (c) | Usage-level moot passages | BUG-004 | verified-as-is | No Usage-level moot passage exists (verified); the ignored-answers report in Limitations' TUI bullet is correct as-is (statuses, not reasons). |
| 16 | audit | `## Limitations` (3 bullets) | — | verified-as-is (audited) | No bullet claims a now-fixed wedge (nothing implies re-asked questions strand or epoch echoes get rejected after completion). "Drafts of questions the agent re-asked survive a panel submit" still true. |
| 17 | — | Keymap/Config/Development/Project structure | — | verified-as-is | Unaffected by the wave. |

## Discipline notes

- No internals documented (no pendingIds fall-through, seam gate names,
  evaluateDependsOn, guards.ts mechanics, fixtures) — user-visible outcomes only.
- Voice/format preserved: second-person walkthrough, backticked keys, one-line
  AC summaries, `{submit}`-style placeholders untouched (none in edited passages).
- spec/ untouched (verify + flag only); per-file Mode A docs rode with each subtask.
- :98 epoch-guard guidance not weakened.

# Validation Report — pi-interrogator

**Date:** 2026-09-24 · **Validator scope:** PRD bug-fix delta (WRITEIN-001/002, AUTOSUBMIT-001/002, SURFACE-001/002, remote bridge parity, lifecycle/protocol) plus fresh adversarial hunting.

## Executive Summary

The bugfix wave (commits `c4f39e0`..`73ded89`) genuinely fixes **all 8 issues** from the PRD. I verified each fix end-to-end through the real modules — real `InterrogationPanel` driven by raw terminal bytes through the config key router, real `InterrogationState`/`DraftStore`, real lifecycle close passes on a fake `agent_settled` event stream, and the real remote bridge on a fake events bus — not just the repo's unit fixtures. The repo's own suite (1278 tests) and `tsc --noEmit` pass.

Fresh hunting found **2 new minor issues** (not regressions of the wave; both live in code paths the wave touched or rely on):

1. The new per-entry delta cap can split a UTF-16 surrogate pair, emitting a broken character in the model-visible submission line for emoji-heavy write-ins.
2. A committed write-in's text is copied into the question's draft slot by the advance write-through, so later superseding the write-in with an option silently ships the stale write-in as an "elaboration" of the option.

## Validation Approach

`./validate.sh` runs three phases (no linter/formatter configs exist in this repo, so those phases are intentionally absent):

| Phase | What | Result |
|---|---|---|
| 1. Type check | `npx tsc --noEmit` (package.json `typecheck`) | ✅ PASS |
| 2. Unit tests | `npx vitest run` — 48 files, **1278 tests** | ✅ PASS |
| 3. E2E journeys | 23 runtime-materialized scenario tests driving the REAL modules (raw key bytes, real lifecycle, real bridge) | ⚠️ 21 pass / 2 fail (the 2 open issues below, pinned as failing tests) |

Phase 3 scenarios mirror documented README workflows and the PRD acceptance criteria: full answer→auto-submit→settle→completion lifecycle, gate-hold hold/override flow, draft sacredness on every editor exit (ctrl+c, discuss, note swap, esc-esc, suspend/reopen), archived-edit "(changed)" marker through the real submit/close-pass pipeline, write-in duty re-derivation on navigation, write-in visibility on revisit, bounded/single-line deltas (3000-char, multi-line, unicode), bridge ack/nack/resurface parity, and text-question enter.

## PRD Bug Verification (all 8 FIXED ✅)

| PRD ID | Claim | Verdict | Evidence (E2E, real flows) |
|---|---|---|---|
| BUG-001 (Major) | Gate-hold ⚠ line dead code in natural flows | **FIXED** | Canonical scenario (gate `g1` open, answering later-group `n1`/`n2`) now arms `gateWarning {kind:"hold", count:1}` and renders `⚠ 1 foundational unanswered — answer them or Ctrl+S to submit now`; auto-submit withheld, no flash; any key dismisses; answering the gate ships `Submitted 3:`; ctrl+s override delivers and re-arms the legacy `kind:"submit"` warning. `maybeAutoSubmit` computes the gate count before the completeness return (actions.ts). |
| BUG-002 (Major) | ctrl+c / discuss / note-mode destroy in-flight drafts (R4) | **FIXED** | `writeThroughCurrentDraft()` runs at the top of `suspend()`, `enterNoteMode()`, and `discussInChat`'s suspend. Verified live: typed text survives ctrl+c (`done(null)` + `DraftStore.getDraft` intact), survives the discuss handoff (template preload still lands), and survives the note swap in BOTH directions (question draft staged before the note seed; note written through on exit; re-opening the editor re-seeds the question draft). Also verified esc-esc exit and suspend→fresh-panel reopen re-seeding. |
| BUG-003 (Major) | AC-13 "(changed)" marker unreachable through real pipeline | **FIXED** | `runClosePass` now takes a close-pass snapshot (statuses "closed") gated on `toClose.length > 0`. Real journey verified: submit → agent follow-up upsert → settle (closes q1/q2, snapshot ring holds "closed") → write-in edit of the closed answer → ctrl+s → content line `q1: ✎ edited archived answer (changed)` and `details.changed[].editedArchived === true`; final settle emits the completion record carrying the edited value. |
| BUG-004 (Minor) | Write-in duty persists across navigation | **FIXED** | `syncBufferToQuestion` re-derives `textDuty` via `desiredTextDuty` from the new question's freshly-seeded cursor when the editor is focused. Verified: write-in session on q1's Other row → shift+tab to q2 (cursor ★ Beta) → duty flips to elaboration; enter saves+blurs and does NOT answer q2; the in-flight q1 buffer is written through to q1's slot on the switch. |
| BUG-005 (Minor) | Write-in answers invisible on revisit; inconsistent ✎ | **FIXED** | `hasTextAnswer` includes `answer.custom === true`; `answerPreviewLine` reads `answer.value` for custom/text answers (first line, dimmed). Verified: choice write-in shows `✎ text answer` on the question line AND the value preview; text answer previews; overview marker agrees. |
| BUG-006 (Minor) | Unbounded / multi-line model delta for write-ins | **FIXED (with a new edge — see Issue A)** | 3000-char write-in → content line capped to ≤240 chars with `…`; card `to` untruncated; multi-line write-in flattens (`line one / line two`) keeping the delta at 1 content line + reminder. |
| BUG-007 (Minor) | Bridge internal errors swallowed, client hangs | **FIXED** | `handleSubmit` wraps `recordRemoteSubmission`; an internal throw (verified with a throwing state-change listener mid-`applyAnswer`) emits `submit-result {ok:false, error:"internal_error"}` + `pi-ask:completed`, no delivery, documented half-mutated state. Valid path re-verified: ok ack, one submission delta with `✎ customText` write-in parity, flow completion, resurface of remaining live questions; invalid answers nack `invalid_answer` + replay. |
| BUG-008 (Minor) | Enter on text-question affordance is a silent no-op | **FIXED** | `accept()` on `type:"text"` opens the editor in write-in duty (duty label renders); enter commits `{value, custom:true}` and the complete set auto-submits. Empty-buffer enter still saves+blurs without committing. |

## New Issues Found

### Issue A: Per-entry delta cap can split a UTF-16 surrogate pair (broken character in the model-visible line)
**Severity**: Minor · **ID**: VAL-001
**Location**: `src/delivery.ts:212-215` — `first.to.slice(0, allowance)` in the BUG-006 per-entry cap.

The cap reserves UTF-16 code-unit budget and slices `first.to` at an arbitrary unit boundary. When the boundary lands inside an astral character (emoji), the emitted line contains a lone surrogate: invalid UTF-16 that renders as U+FFFD (�) in the terminal and reaches the model as an escape-sequence artifact. Verified live with a 300×🚀 write-in: the 240-char line contains a lone surrogate (depends on prefix parity — `"x"+🚀×300` happens to land clean, `🚀×300` and `"xx"+🚀×300` split). Pinned as a failing E2E test (`ISSUE A` in `validate.sh`).

**Repro**: choice q1+q2; accept Other on q1; type `🚀`×300; enter; answer q2. Line 1 of the submission contains a lone high surrogate just before the `…`.
**Fix direction**: make the slice code-point-safe (back off one unit when `charCodeAt(allowance-1)` is a high surrogate without its low), or slice over `[...first.to]` code points.

### Issue B: Superseding a committed write-in with an option silently ships the stale write-in as an "elaboration"
**Severity**: Minor · **ID**: VAL-002
**Location**: `src/panel/panel.ts` (`syncBufferToQuestion` write-through firing from `writeInEnter`'s advance) + `src/panel/actions.ts` (`reconcileDraftsForSubmit`'s kept-slot re-binding); amplified by `draftSlots` not being cleared when `shipDrafts` flushes the store.

When a write-in commits, `writeInEnter` → `advanceAfterAccept` changes `currentId`, and the setter's draft write-through copies the just-committed buffer into the outgoing question's draft slot (+ DraftStore). The user never performed a draft gesture — the text already became the answer. If the user later changes their mind and accepts a real option on that question, `reconcileDraftsForSubmit` finds the stale slot and attaches it as `answer.text`, so the submission ships `q1: Alpha — my custom answer` — presenting the abandoned write-in as the rationale for the new choice. Verified live end-to-end (auto-submit after the supersede delivered exactly that line). Pinned as a failing E2E test (`ISSUE B` in `validate.sh`).

**Repro**: choice q1+q2; Other-row write-in "my custom answer" on q1; answer q2 (auto-submit ships the store slot, but the panel-local slot persists); revisit q1, enter on ★ Alpha → the edit ships immediately as `Submitted 1: q1: Alpha — my custom answer (state epoch 3)`.
**Fix direction**: skip the write-through when the buffer was just committed as the answer (or clear the question's slot when an option accept supersedes a `custom:true` answer), so only user-held drafts re-bind.

## Testing Summary
- Repo suite: 1278 tests, all passing; `tsc --noEmit` clean.
- E2E journeys written for this validation: 23 (21 passing, 2 pinning the open issues above).
- Total issues found in this validation: **2** (0 critical, 0 major, 2 minor).
- All 8 PRD issues verified fixed through real user-level flows.

## Recommendations
- Make the delta-cap slice code-point-aware (Issue A) — one-line guard or code-point slicing.
- Prevent the committed-write-in → draft-slot copy (Issue B), or clear the slot on option supersede, so kept-text re-binding only applies to drafts the user actually held.
- Optional polish observed but not counted as defects: the note `NOTE:` line collapses `\n` but not `\t`; `shipDrafts` clears the store but not `draftSlots` (benign today beyond Issue B's amplifier role).

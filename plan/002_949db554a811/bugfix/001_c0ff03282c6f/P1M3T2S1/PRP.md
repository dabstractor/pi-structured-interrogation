# PRP — P1.M3.T2.S1: README.md sweep — verify all behavior passages match the fixed semantics

---
name: "P1.M3.T2.S1 — README.md sweep: verify all behavior passages match the fixed semantics"
description: "The Mode B documentation task for README.md after Bugfix Wave 1 (BUG-001..BUG-008, all fixed + certified green by P1.M3.T1.S1). Walk each of the ~8 doc-sync passage groups (gate-hold 52-54 + 253 · drafts/R4 66-68, 212, 254-255 · AC-13 '(changed)' 262 · write-ins 36, 43-47, 198-204 · delta shape 55-57 · hotkey table 151-162 · config ref 98-150 · Limitations 214-267) and verify each states the FIXED behavior; adjust wording where old text implied the buggy limitations (enter-on-text discoverability, write-in invisibility on revisit, '(changed)' reachability, delta line bounds, draft loss on ctrl+c/discuss/note-mode). Correct drift only — do not invent features. README has NO bridge-ack passage (BUG-007 needs none). No mocks, no code changes."
---

## Goal

**Feature Goal**: README.md is consistent with the shipped behavior of the integrated Bugfix Wave 1 changeset across every passage that touches the 8 fixed bugs. Every claim the README makes about gate-hold, draft sacredness, '(changed)' markers, write-in surfacing, delta shape, and enter-on-text is true of the code as certified by P1.M3.T1.S1's green sweep.

**Deliverable**: Edited `README.md` (wording corrections only where drift exists), plus a verification checklist in this task's research notes (`research/readme-sweep.md`) recording each passage: verified-as-is / corrected (old → new).

**Success Definition**: All ~8 passage groups walked and recorded; no README passage documents behavior the code does not deliver (the bug-report's specific complaint class — README:52-53 and :253 documented a gate-hold line that was dead code); no new features invented; `npm test` + `npm run typecheck` still green (README edits touch nothing else, but the gate confirms no accidental source edits).

## Why

- The bug report (h2.0, h2.2 Issue 1) explicitly cites the README as documenting undelivered behavior: "The README (lines 52-53) and AC-2d (line 253) document the behavior the code does not deliver." After the fixes, the inverse risk is drift in the other direction — passages that hedged or implied the buggy limitations (write-ins invisible on revisit, enter no-op on text questions, '(changed)' never firing, unbounded delta lines) must now state the fixed semantics.
- This is the changeset's Mode B README task: "no further README work elsewhere" — spec/ living documents are P1.M3.T2.S2's scope, NOT this task's.

## What

### Inputs

- The **green integrated tree** certified by P1.M3.T1.S1 (its PRP is the contract: `npm test` + `npm run typecheck` exit 0, flip inventory verified). Its triage note (`P1M3T1S1/research/triage-note.md`, if written) documents final semantics.
- Final behavior of all 8 fixes (summary below, authoritative semantics = bug report h2.5 Recommendations + the implementing subtasks' PRPs).

### The fixed semantics each passage must match

1. **Gate-hold ⚠ line (BUG-001)** — README:52-54 and AC 2d at :253.
   Now TRUE as written: while gate-group questions are unanswered, every commit (option accept, ripple edit, bridge submit — P1.M1.T1.S2 pinned inheritance across entry points) shows the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line and auto-submit withholds; answering the gate releases the next commit; `ctrl+s` overrides. Verify the passage says "commits show" (any commit, not only completeness-adjacent ones) — the fix moved arming BEFORE the completeness return, so the line renders in the canonical fill-later-groups-first scenario. Adjust wording if the old text scoped it narrowly (e.g. implied only shown when everything else is answered).
2. **Draft sacredness / R4 (BUG-002)** — README:66-68, :212, :254-255 (AC 3/4).
   Now true for ctrl+c, ctrl+shift+e (discuss), and ctrl+shift+m (note mode) too: every editor exit is a draft write-through. If any passage enumerates which gestures preserve drafts or implies some exit loses text, extend to cover all three (or state the invariant generically: "every exit — esc, ctrl+c, discuss, note mode — saves the in-flight text to its question's draft"). README:212's "switching questions while typing saves the text" stays true (textDuty fix BUG-004 doesn't change preservation, only commit semantics).
3. **AC-13 '(changed)' (BUG-003)** — README:262 (AC 13 summary line).
   Now reachable through the real pipeline (the close pass takes a snapshot — P1.M1.T3.S2 — so editing an archived answer diffs against a closed baseline). The summary line "Editing an archived answer re-marks it pending; next diff card highlights the change" is now TRUE as written — verify, likely no edit. Do not add the literal `(changed)` render string (that lives in spec/ui-spec.md:129 — S2's scope).
4. **Write-ins (BUG-004/BUG-005)** — README:36, :43-47, :198-204, :250 (AC 2a).
   - BUG-004 (duty re-derivation on navigation): the duty now follows the cursor on question change — enter after tabbing to a question whose cursor sits on a real option is elaboration, never a write-in commit. If README:43-47's duty description ("the duty follows context/entry path") is consistent, no edit; only fix text implying duty persists.
   - BUG-005 (revisit visibility): the short view now shows the recorded write-in/text answer as a dimmed preview and the question-line ✎ appears for `custom:true` answers (marker parity with the overview). README:198-204 says "every surface that shows the answer … renders it as `✎ {text}`" — verify this now includes the revisit short view; if the passage enumerated surfaces, ensure it's accurate (or leave generic if already generic and now true).
5. **Delta shape (BUG-006)** — README:55-57.
   The ≤3-line (spec FR-3a "~2 lines") shape is RESTORED: answerSummary flattens newlines/tabs and the budget loop enforces a per-entry cap. README's "compact delta message … ending with `(state epoch {n})`" is now accurate — verify; if any nearby text implies long write-ins ship verbatim/multi-line (unlikely — README never hedged this), correct it. No edit expected here beyond verification.
6. **Enter-on-text discoverability (BUG-008)** — README:36-47 region + AC 2c at :252.
   Enter on a text question's `✎ answer…` affordance now OPENS the editor in write-in duty (P1.M2.T5.S1) instead of a silent no-op. README:36-37 already says text questions use the write-in duty via ctrl+t — check whether the passage implies ctrl+t is the ONLY entry; if so, add that `enter` on the affordance opens it too (it now matches the footer's "enter accept"). AC 2c's summary ("answering the LAST question … by text `enter`") is now reachable via plain enter — verify wording still accurate (it is; possibly now MORE true).
7. **Bridge acks (BUG-007)** — NO README passage exists; bridge appears only at :408-409 (Project structure). **Add nothing** — the fix is internal robustness (nack on internal errors), not user-facing panel behavior. Verify no passage claims bridge submissions can hang silently (none does).
8. **Cross-cutting sweeps**:
   - **Hotkey table** (README:151-162 region, `## Keymap` at :168 area): every row's described behavior must match fixed semantics — esp. `ctrl+c` row ("Closes the prompt (suspend)") now preserves the draft; the tab/shift+tab rows (duty re-derivation); enter/accept behavior on text questions if listed.
   - **Config reference** (`## Configuration` :115-150ish): unchanged by the wave — verify no passage drifts (keys names, defaults).
   - **Limitations** (:214-267, `## Limitations` at :268 per map): confirm no listed limitation is now FIXED behavior (e.g. if Limitations once said write-in answers aren't visible on revisit or enter doesn't work on text questions — remove/adjust any such entry).

### Rules

- **Correct drift only — do not invent features.** Every wording change must trace to one of the 8 fixes' final semantics (h2.5 Recommendations + implementing PRPs).
- **No key labels hardcoded in prose that claims remappability**: README prose MAY name default keys when explaining them (existing convention), but any sentence of the form "shows `{submit}`/`{deep}`" style placeholders must stay placeholder-style where they already are (README:53 uses `{submit}` — keep that convention).
- No code, test, or spec/ changes (spec/ is P1.M3.T2.S2).

### Success Criteria

- [ ] All ~8 passage groups walked; each recorded as verified-as-is or corrected (old → new) in `research/readme-sweep.md`.
- [ ] Gate-hold passages (:52-54, :253) state commit-scope arming (any commit while gate unanswered).
- [ ] Draft passages cover all exits including ctrl+c/discuss/note-mode (or state the generic invariant).
- [ ] AC-13 line verified true (no hedge like "best-effort").
- [ ] Write-in passages reflect revisit visibility + duty-follows-cursor + enter-on-text.
- [ ] No passage claims a now-fixed behavior as a limitation; Limitations section audited.
- [ ] No bridge-ack passage added.
- [ ] `npm run typecheck` + `npm test` still green (no accidental non-README edits: `git diff --stat` shows README.md only).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact README passage locations and current text, the final fixed semantics per bug, the map of what NOT to touch (spec/, code), and the sweep workflow. All below.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/testing-and-docs.md
  why: §2 — the authoritative README structure map + doc-sync passage inventory (headings at lines 1/11/30/115/168/225/241/268/289/309/380; quote targets per bug). THIS is the sweep checklist
  critical: "README does NOT document [bridge acks] … No README sync needed for BUG-007"

- file: README.md
  why: the artifact being swept — read fully once (it's ~420 lines), then edit passage by passage
  pattern: existing prose conventions — `{submit}`-style placeholders for remappable keys in behavior copy; literal key names allowed in the Keymap table + Usage walkthrough

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/prd_snapshot.md
  why: h2.0/h2.2/h2.3 (each bug's repro — what the OLD buggy behavior was, i.e. what drift to look for) + h2.5 (Recommendations = the fixed semantics each passage must now state)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M3T1S1/PRP.md
  why: the regression-sweep contract — certifies the tree this docs task runs against; its flip inventory lists the final test-asserted semantics per bug
  gotcha: if the sweep found+fixed fallout, read its triage note (research/triage-note.md) — fallout fixes may have nuanced the semantics

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T5S1/PRP.md
  why: the enter-on-text fix contract (editor opens in write-in duty, two replacement tests) — the exact semantics for the Usage/AC 2c passages

- dossiers: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/ (other per-bug files)
  why: when unsure how a fix landed, read that bug's dossier before touching its README passage
```

### Current Codebase tree (relevant excerpt)

```bash
README.md            # THE artifact (edit only this)
spec/                # P1.M3.T2.S2's scope — DO NOT TOUCH here
src/                 # read-only reference for verifying claims
plan/002_949db554a811/bugfix/001_c0ff03282c6f/
  architecture/testing-and-docs.md   # passage map
  P1M3T1S1/research/triage-note.md   # certified final semantics (if present)
  P1M3T2S1/research/readme-sweep.md  # CREATE: the verification record
```

### Known Gotchas

```bash
# Line numbers in the passage map are from HEAD 613437d; the fix wave may
# have shifted them a few lines — navigate by QUOTED TEXT (testing-and-docs.md
# §2 gives exact quotes), not line numbers.
# README's AC summary section (:241-267) is a SUMMARY of spec/product-
# requirements.md — if a summary line drifts from the spec's AC text, the
# spec fix belongs to P1.M3.T2.S2; here only make the summary match BEHAVIOR.
# The '(changed)' literal render string lives in spec/ui-spec.md:129 — do not
# import it into README; README:262's summary wording suffices.
# git diff at the end must show README.md (and nothing else) — the plan/ dir
# is untracked and stays untracked.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — full README.md once + testing-and-docs.md §2 passage map
Task 2: BUILD the sweep checklist — one row per passage group: location (by quote), current claim, required fixed semantics, bug id
Task 3: VERIFY/CORRECT per group (order: gate-hold → drafts → AC-13 → write-ins → delta → enter-on-text → keymap table → config ref → Limitations)
  - For each: if the passage already states the fixed behavior → mark verified-as-is
  - Else edit minimally, keeping surrounding prose style, {key} placeholder convention, and markdown structure
Task 4: AUDIT Limitations + AC summary sections for entries invalidated by the fixes
Task 5: RECORD research/readme-sweep.md — table of passage | status | old→new | BUG id
Task 6: GATE — npm run typecheck && npm test (green, proves no source touched); git diff --stat shows README.md only
```

### Implementation Patterns & Key Details

```markdown
<!-- Example correction style (minimal, keeps voice): -->
<!-- OLD: "While a foundational gate question is unanswered, auto-submit holds:
     commits show ⚠ … (any key dismisses it)" -->
<!-- Already correct post-fix — mark verified. Only edit where the OLD text
     scoped the line to a scenario the dead-code branch actually served
     (e.g. "when everything else is answered"). -->

<!-- Draft passages: prefer the generic invariant over an exhaustive list:
     "every editor exit — esc, ctrl+c, discuss, note mode, question switch —
     saves the in-flight text to its question's draft (R4)." -->
```

### Integration Points

```yaml
EDIT: README.md only
CREATE: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M3T2S1/research/readme-sweep.md
CONSUMED: P1.M3.T1.S1's certified green tree + triage note
HANDOFF: P1.M3.T2.S2 (spec/ sweep) builds on the same fixed semantics —
  do not start it; this task is README-only (Mode B).
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat          # README.md only
npx prettier --check README.md 2>/dev/null || true   # if the repo formats md; skip if not configured
```

### Level 2: No collateral damage

```bash
npm run typecheck && npm test   # must remain green — proves zero source edits
```

### Level 3: Semantic spot-checks (read-back)

```bash
# For each corrected passage, grep the final README for the fixed claim:
grep -n "foundational unanswered" README.md      # gate-hold present, commit-scoped
grep -n "draft" README.md                        # invariant covers ctrl+c/discuss/note
grep -n "highlights the change" README.md        # AC-13 unhedged
grep -n "✎ Other" README.md                      # write-in passages coherent
grep -n "" README.md | sed -n '250,266p'         # AC 2c/2d/13 summary review
```

### Level 4: Not applicable — pure documentation task (no live TUI; AUTOMATION-POLICY).

## Final Validation Checklist

- [ ] All ~8 passage groups walked; readme-sweep.md record written
- [ ] No passage documents undelivered behavior; no invented features
- [ ] `{key}` placeholder convention preserved in behavior copy
- [ ] Limitations section audited — no fixed-behavior entries remain
- [ ] No bridge-ack passage added
- [ ] `git diff --stat`: README.md only; `npm test` + typecheck green
- [ ] spec/ untouched (P1.M3.T2.S2's scope)

## Anti-Patterns to Avoid

- ❌ Don't invent features or over-promise — every edit traces to a landed fix (h2.5 semantics)
- ❌ Don't touch spec/, src/, or tests
- ❌ Don't import spec-only render literals (`(changed)` from ui-spec.md:129) into README
- ❌ Don't renumber/restructure README sections — passage-level wording fixes only
- ❌ Don't add a bridge submit-ack section (README never documented acks; BUG-007 is internal)
- ❌ Don't trust the passage map's line numbers — navigate by quoted text

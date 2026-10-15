# PRP — P1.M3.T2.S1: README.md changeset sweep — hotkey context rows, editor/AC-2b wording, no-caps coherence

---
name: "P1.M3.T2.S1 — README.md changeset sweep (bugfix changeset 001_5dde9b4d7329)"
description: "The Mode B README sync after the full changeset (restored WRITEIN-002 re-bind P1.M1, ctrl+g any-duty note routing P1.M2, caps purge P1.M3.T1). Minimal edits only — the README already PROMISES this behavior; the sweep verifies wording now matches and fixes at most one line per spot: (a) external-editor hotkey contexts must read duty-agnostic ('any editor duty' — answer/elaboration/note; the note duty routes completed text to the batch note); (b) Editor-section re-bind sentence (:225-228) and AC-2b (:279) verified true, with at most one clarifying line for the visible-✎ staged-draft nuance and the same-gesture auto-submit on a complete set; (c) no residual caps claims (P1.M3.T1.S1 already removed the :114 clause — confirm; cross-check Configuration 'No caps' block stays coherent). Gate: grep for stale 'text focus'-only and caps wording returns nothing; npm test + npx tsc --noEmit green; git diff shows README.md only."
---

## Goal

**Feature Goal**: README.md is coherent with the shipped changeset 001_5dde9b4d7329 (WRITEIN-002 re-bind restored, ctrl+g live in note duty with note routing, caps purge complete). The README already advertises this behavior — this sweep verifies each affected passage states it accurately and makes at most one-line clarifications, no section rewrites.

**Deliverable**: Edited `README.md` (0–4 one-line edits expected) + sweep record at `plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T2S1/research/readme-sweep.md` (passage | status | old→new | BUG id).

**Success Definition**: All three sweep areas walked and recorded; `grep -n "text focus" README.md` returns nothing stale in hotkey contexts; no residual goal-cap claims (`grep -n "capped at 400\|400-char" README.md` empty); `npm test` + `npx tsc --noEmit` green; `git diff --stat` shows README.md only.

## Why

- House pattern (conventions-and-testing.md §(d), commit 7aca309 precedent): every wave lands code+tests, then a doc/README sync — this is that sync for changeset 001.
- The changeset made previously-false README sentences TRUE (bug001-writein-supersede.md §(b) quotes README :225-228 and :279 as documents the code now honors), so the sweep is mostly verification; the real edit surface is the visible-✎ nuance and the note-duty hotkey context.

## What

### Sweep areas (verify-first, minimal-edit)

**(a) External-editor hotkey contexts (BUG-002 fix surface)**

Current state (verified in tree):
- Usage :39-40 — "`ctrl+g` finishes the draft in an external editor" — duty-silent, **correct as-is**.
- Keymap table :190 — "External editor | `keys.externalEditor` | `ctrl+g` | Open the draft in an external editor" — duty-silent, correct; OPTIONALLY extend the Effect cell to "Open the draft in an external editor (works in any editor duty — answer, elaboration, or note; in note duty the finished text lands in the batch note)" — only if it stays one table-cell line.
- Batch note row :193 — "Attach a batch note shipped with the next submit" — OPTIONALLY append "editable via `ctrl+g`" if one cell allows.
- Keymap-conflict table :363 — "its only valid context is editor focus" — TRUE post-fix (text OR note focus); no edit needed.
- Two-tier intercept paragraph :245 — "Modifier-bearing config keys (`ctrl+s`, `ctrl+g`) intercept everywhere, including while the editor holds focus" — TRUE and now includes note focus; no edit.
- RULE: fix ONLY a spot that says or implies text-focus-only. Run `grep -n "text focus" README.md` — any hit in an external-editor context gets that one line fixed; hits describing other keys (e.g. submit "must fire from text focus" :362 — about typing contexts, correct) stay.

**(b) Editor section (:225-228) and AC-2b (:279) — the re-bind sentences (BUG-001 fix surface)**

- :227-228 — "Accepting an option after a committed write-in supersedes the answer and re-binds the kept slot text as elaboration." — NOW TRUE by code (stageSupersededWriteIn, four guards). Verify wording matches restored semantics; no rewrite expected.
- AT MOST ONE clarifying line (append to that sentence or the paragraph): the staged slot is a **visible ordinary draft** — "the re-bound text appears as that question's draft (✎ marker; editable or clearable before it ships), and on an already-complete set the same gesture can auto-submit it immediately (you may not get a chance to edit first — the text ships verbatim as your elaboration)". Compress to README voice; this covers both nuances from bug001-writein-supersede.md §(b) item 3 ("UX call worth flagging") and the Visible ruling (:191).
- AC-2b :279 — "a real option after a committed write-in re-binds the slot as elaboration" — true as-is; no edit unless the visible-✎ nuance fits in one clause without bloating the one-line summary (prefer leaving AC lines terse — the Usage paragraph carries the nuance).

**(c) No-caps coherence (BUG-003 surface — P1.M3.T1.S1 owns the main fix)**

- Model behavior note :114 — P1.M3.T1.S1 (parallel/landed) already replaced the clause; verified live text reads "it is stored verbatim, with no length limits (CAPS-OUT-001)". **Confirm, don't re-edit.**
- Cross-check the Configuration section's "No caps" block still reads coherently next to the corrected note (no contradiction, no duplication awkwardness).
- `grep -n "capped at 400\|400-char\|truncated with a warning" README.md` → empty.

### Rules

- **Minimal edits only** — the README already promises this behavior; do not rewrite sections, do not add features, do not document internals (stageSupersededWriteIn, keys.ts gates, routing forks).
- Keep voice/format: table-cell brevity, one-line AC summaries, backticked key names, `{key}` placeholders where existing.
- README.md ONLY — spec/ coherence is P1.M3.T2.S2's scope; source comments are P1.M3.T1.S2's.

### Success Criteria

- [ ] Sweep record written: every passage in areas (a)/(b)/(c) marked verified-as-is or corrected (old→new, BUG id).
- [ ] `grep -n "text focus" README.md` — no stale external-editor context (the :362 submit row is exempt — it's about typing, correct).
- [ ] Re-bind sentences (:227-228, :279) verified true; at most one added clarifying line for visible-✎ + same-gesture auto-submit.
- [ ] `grep -n "capped at 400\|400-char\|truncated with a warning" README.md` empty; "No caps" config block coherent.
- [ ] `git diff --stat`: README.md only; `npm test` + `npx tsc --noEmit` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: current README passage text (quoted below), the changed semantics, the minimal-edit rule, and the boundary against sibling tasks. Fully contained.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/conventions-and-testing.md
  why: §(d) :53-55 — README section order + the house README-sweep-after-behavior-change pattern (7aca309 precedent); :68 — commit arc context
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: §(b) :95-99 quotes README :225-228 and :279 verbatim; :191 the "Visible" ruling (✎ marker lights, editable/clearable — the nuance to convey); :227 the same-gesture auto-submit UX note; :234 the rejected alternative (deleting the sentences — NOT this task's direction)
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug002-003-ctrlg-and-stale-caps.md
  why: BUG-002 semantics — any-duty gate + note routing (completed external-editor text goes to batchNote/setNote, never the question slot); BUG-003 stale sites
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T1S2/PRP.md
  why: CONTRACT — sibling task purging src/state.ts:324-328 + tool.ts:201 stale caps comments; do not touch those (or any src/) here
  gotcha: P1.M3.T1.S1 (README :114 clause removal) is also parallel/landed — verify its edit exists rather than redoing it
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/prd_snapshot.md
  why: h2.0/h2.2/h2.3 — the three bugs' repros (what stale README wording looked like); h2.5 recommendations
- file: README.md
  why: THE artifact. Verified current spots: :39-40 usage, :113-116 model-note (already caps-clean), :190 external-editor row, :193 batch-note row, :227-228 re-bind sentence, :245 two-tier intercept, :279 AC-2b, :362-363 conflict table, "No caps" config block
```

### Current Codebase tree (relevant excerpt)

```bash
README.md   # THE artifact (edit only this)
spec/       # P1.M3.T2.S2's scope — DO NOT TOUCH
src/        # P1.M3.T1.S2's scope — DO NOT TOUCH
plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T2S1/research/readme-sweep.md  # CREATE
```

### Known Gotchas

```bash
# All README line anchors verified at research time but may drift from the
# parallel subtasks — navigate by QUOTED TEXT.
# The :362 "submit must fire from text focus" hit is CORRECT (typing-context
# reasoning) — the grep gate is about external-editor contexts only.
# AC lines stay one-line terse — the visible-✎/auto-submit nuance belongs in
# the Usage editor paragraph, not AC-2b, if it doesn't fit one clause.
# npm test baseline: 1321 tests green pre-changeset; expect >1321 post-wave.
# Do not document: stageSupersededWriteIn, keys.ts:566 gate, note-routing
# fork internals — user-visible outcomes only.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — README.md fully; bug001 §(b)/:191/:227; bug002-003 dossier; confirm P1.M3.T1.S1's :114 edit landed
Task 2: SWEEP (a) — every external-editor mention: :39-40, :149, :190, :193, :245, :363; fix only text-focus-only wording; optionally extend :190 Effect cell with any-duty + note-routing in one line
Task 3: SWEEP (b) — :227-228 verify + at most one clarifying line (visible ✎ draft, editable/clearable, same-gesture auto-submit on a complete set); :279 verify
Task 4: SWEEP (c) — confirm :114 caps-clean; "No caps" block coherent; grep gates
Task 5: WRITE research/readme-sweep.md (passage | status | old→new | BUG id)
Task 6: GATE — grep checks; npm test && npx tsc --noEmit; git diff --stat (README.md only)
```

### Implementation Patterns & Key Details

```markdown
<!-- Optional :190 Effect cell (keep table-cell terse): -->
<!-- "Open the draft in an external editor — any editor duty (answer,
     elaboration, note; note duty lands the text in the batch note)" -->
<!-- Optional :227-228 append: -->
<!-- "…as elaboration — the re-bound text is that question's draft (✎ marker,
     editable or clearable until it ships; on an already-complete set the
     same gesture auto-submits it verbatim)." -->
```

### Integration Points

```yaml
EDIT: README.md only
CREATE: research/readme-sweep.md
CONSUMED: the complete landed changeset (P1.M1.* restore, P1.M2.T1 ctrl+g,
  P1.M3.T1.S1 README clause removal — verify it exists)
DO NOT TOUCH: spec/ (P1.M3.T2.S2), src/ (P1.M3.T1.S2), tests
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat     # README.md only
```

### Level 2: No collateral damage

```bash
npm test && npx tsc --noEmit    # green — proves zero source edits
```

### Level 3: Grep gates

```bash
grep -n "text focus" README.md            # only the correct :362-style typing-context hits
grep -n "capped at 400\|400-char\|truncated with a warning" README.md   # empty
grep -n "re-binds the kept slot text" README.md   # present and verified
```

### Level 4: Not applicable — pure docs task (no live TUI).

## Final Validation Checklist

- [ ] Sweep record written; all three areas walked with BUG ids
- [ ] No stale external-editor context wording; caps grep clean
- [ ] Re-bind sentences verified; ≤1 added clarifying line for the visible-✎ nuance
- [ ] No internals documented; README voice/format/table-cell brevity preserved
- [ ] spec/ and src/ untouched (sibling tasks own them)
- [ ] `git diff --stat`: README.md only; `npm test` + `npx tsc --noEmit` green

## Anti-Patterns to Avoid

- ❌ Don't rewrite sections — the README already promises this behavior; one-line fixes only
- ❌ Don't document internals (stageSupersededWriteIn, keys.ts gates, routing forks)
- ❌ Don't touch spec/ (P1.M3.T2.S2) or src/ (P1.M3.T1.S2)
- ❌ Don't redo P1.M3.T1.S1's :114 edit — verify it landed
- ❌ Don't "fix" the :362 "text focus" hit — it's about typing contexts, not the external editor
- ❌ Don't trust line anchors — navigate by quoted text

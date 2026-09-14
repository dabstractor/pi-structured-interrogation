# PRP — P1.M5.T2.S1: README.md — update behavior claims touched by this changeset

---

## Goal

**Feature Goal**: Bring README.md's behavior claims into exact agreement with HEAD after the 12-defect bugfix changeset. Nine shipped behaviors drifted from (or were absent in) the README; update ONLY those claims — do not rewrite unrelated sections, do not touch `spec/` files (P1.M5.T2.S2 owns decisions.md), no code changes.

**Deliverable**: Edited `README.md` (same structure, same sections) in which every claim about goal, epoch/guards, submissions, non-TUI mode, suspend/resume, drafts, restart recovery, and ctrl+t scope matches the shipped code. No stale claim from the 12 fixed defects remains.

**Success Definition**: A reader diffing README vs HEAD behavior finds zero contradictions for the nine changed behaviors (list below); `npm test` and `npm run typecheck` still pass (docs-only change must not break anything); grep checks for stale phrasings come back empty.

## User Persona

**Target User**: A pi user (and the model itself) reading README to learn what the extension does and how to drive the `interrogate` tool.
**Use Case**: Install/configure the extension; the model reads agent-facing behavioral contracts (guards, epoch, completion).
**Pain Points Addressed**: README currently under-documents or mis-documents the fixed behaviors — a model following it would omit epoch on upserts and hit stale rejections.

## Why

- The changeset fixed 12 defects (8 major, 4 minor — see plan PRD h2.0/h2.4); README is the user-facing behavior surface and must not contradict HEAD.
- This IS the changeset-level docs task ([Mode B]); the only docs deliverable of P1.M5.T2.

## What

Nine behavior updates, each mapped to the exact README location:

1. **Goal updatable, capped 400** — `tool.ts` applies a parsed `goal` on ANY upsert via `state.setGoal(capped.goal)`; the 400-char cap (`caps.goal`) is enforced on stored state with a truncation warning. → Update the `caps.goal` config comment and add a sentence to the "Model behavior note" (goal may be updated on any upsert; truncated at 400).
2. **Second interrogation completes** — an upsert arriving after completion swaps to fresh state (epoch restarts at 1, `completed=false`) so a new interrogation in the same session completes normally. → One sentence in the Usage step 5 area or the model note.
3. **'(state epoch {n})' in submissions** — every submission delta's content line ends `(state epoch {n})` with the POST-bump epoch, so re-asks need only echo it (one-round-trip re-asks; BUG-003 fix). → Extend Usage step 3 ("Each submit streams a compact delta message …" → mention the epoch segment and that the model must echo it on re-asks).
4. **Epoch required on upserts touching existing ids** — `assertFresh` rejects epoch-less upserts touching existing ids (BUG-010). → Change "`rev`-guarded" in the model note to "`rev`- and `epoch`-guarded (upserts touching existing ids must echo the current epoch)".
5. **Non-TUI closes + completes** — in `pi -p`/rpc/json, `answers[]` chat-recording marks recorded ids `submitted`, so the auto-close pass fires and the completion record is injected when the agent settles; moot/withdrawn/closed ids are refused into an `ignored` bucket (BUG-004/BUG-012). → Rewrite the Limitations "TUI-first" bullet's last clause: you answer in your next message, and once recorded the interrogation closes and injects the completion record at settle.
6. **Fully-answered suspended panels resumable** — a shared resumable predicate over active statuses (open/answered/submitted/reasked) drives `/interrogate`, the break-out key, `{reopen:true}`, and widget visibility (BUG-005). → Extend Usage step 4: resumable even when every question is answered but not yet submitted.
7. **ctrl+t short-view-only** — focusText dispatch is gated on `panel.view === "short"` (no blind typing from deep/overview; BUG-011). → Qualify Usage step 2 and the Keymap `Focus text editor` row ("short view only").
8. **Restart restores exact answer values** — reconstruction replays raw `DiffEntry.value` (labels were the legacy fallback; BUG-007). → Sharpen the Limitations drafts bullet: restart restores questions and submitted answers with their exact values — never in-progress drafts.
9. **Drafts of re-asked questions survive submit** — panel submit flushes drafts ONLY for actually-shipped pending ids; agent-caused answer resets are filtered out of the delta (BUG-008). → Extend Usage step 4 "drafts intact" and/or the Limitations drafts bullet: drafts of questions the agent re-asked (that never shipped) survive a submit.

DO NOT touch: Install, Development commands, the keymap conflict re-verification section (no default keys changed), the Keymap tables beyond the focusText row wording, the "Avoided keys" content, Project structure, and `spec/decisions.md`.

### Success Criteria

- [ ] All nine behavior updates present and accurate against HEAD code
- [ ] No other README content semantically changed
- [ ] `npm test` and `npm run typecheck` pass (unchanged)
- [ ] `grep -n "rev-guarded\|rev`-guarded" README.md` finds no un-qualified old guard claim; no stale claim like "answer in your next message" implying non-TUI never completes remains without the settle/completion clause

## All Needed Context

### Context Completeness Check

Verified: the PRP lists every drift point with its exact README location and the code evidence for the new wording. An agent needs only README.md + this PRP.

### Documentation & References

```yaml
- file: README.md
  why: THE file to edit — sections Usage (steps 2/3/4/5 + model note), Configuration (caps.goal comment), Keymap (focusText row), Limitations (drafts + TUI-first bullets)
  pattern: existing concise, claim-per-sentence style; JSONC comments in config block
  gotcha: minimal surgical edits — preserve tone, tables, and anchors; do not restructure

- file: src/tool.ts
  why: evidence for goal-on-any-upsert + 400 cap (JSDoc ~line 200-205, "capped.goal is the single truncation authority"), fresh-state swap on completed upsert (~line 266), read-action shape
  gotcha: wording must say the goal updates whenever present on an upsert, omitted goal keeps the current one

- file: src/delivery.ts
  why: evidence for "(state epoch {n})" — lines ~46/64/91: submission content line ends with the POST-bump epoch
  gotcha: POST-bump epoch — the number the model must echo on the next upsert

- file: src/guards.ts
  why: assertFresh — epoch-less upserts touching existing ids are rejected (BUG-010)

- file: src/fallback.ts
  why: recordAnswers marks recorded ids submitted (~line 187 JSDoc); ignored bucket for moot/withdrawn/closed (~line 197); close pass fires at settle → completion injection

- file: src/command.ts + src/index.ts
  why: shared resumable predicate over active statuses (open/answered/submitted/reasked) drives /interrogate, breakOut, reopen:true, and widget visibility (~command.ts:55, index.ts:151/174)

- file: src/panel/keys.ts
  why: focusText gated on panel.view === "short" (BUG-011)

- file: src/panel/actions.ts
  why: submit ships drafts only for pendingIds (status answered); agent-reset entries filtered from delta (~lines 330-375)

- file: src/reconstruct.ts
  why: replaySubmission prefers DiffEntry.value (raw) with legacy label tolerance — CONTRACT per P1.M5.T1.S1 PRP (in flight; assume landed exactly as specified)
  gotcha: README wording "restores submitted answers with their exact values" is safe regardless of the legacy tolerance detail

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M5T1S1/PRP.md
  why: contract for the in-flight reconstruction fix — its OUTPUT defines behavior 8's final wording
```

### Current Codebase tree (relevant slice)

```bash
README.md              # the ONLY file to edit
src/{tool,delivery,guards,fallback,command,reconstruct}.ts   # behavior evidence
src/panel/{keys,actions}.ts
src/index.ts
spec/                  # DO NOT TOUCH (P1.M5.T2.S2 owns decisions.md)
```

### Desired Codebase tree

```bash
README.md              # MODIFIED — surgical edits only, no new files
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: this is a docs-only task — NO source edits, NO spec/ edits.
// CRITICAL: the keymap re-verification section and "Verified {date}" record stay
//   untouched — no default keys changed in this changeset.
// CRITICAL: keep table formatting (markdown alignment) intact when editing the
//   focusText Keymap row.
// CRITICAL: the config JSONC block's caps.goal comment is documentation too —
//   update it to say the cap is ENFORCED on stored state, not just "max characters".
```

## Implementation Blueprint

### Data models and structure

None — documentation only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — Usage section (steps 2/3/4/5 + model note)
  - STEP 2: qualify ctrl+t: "press `ctrl+t` to focus the free-text editor (short view)"
  - STEP 3: extend the submit sentence: delta messages end with `(state epoch {n})`;
    the model echoes that epoch when upserting existing questions after a submit
  - STEP 4: add resumability clause (answered-but-unsubmitted panels resumable via
    /interrogate, break-out key, or agent reopen) and draft-survival clause (drafts of
    agent-re-asked questions survive a submit)
  - STEP 5 / model note: second interrogation in a session completes (fresh state,
    epoch restarts); goal updatable on any upsert, truncated at 400 chars; change
    "rev-guarded" → "rev- and epoch-guarded (existing ids require the current epoch)"
  - FOLLOW pattern: existing sentence-per-claim concise style

Task 2: EDIT README.md — Configuration block
  - caps.goal comment: "...max characters for the goal statement (enforced on stored
    state; updates past 400 are truncated with a warning)"
  - keys.focusText comment: "focus the free-text editor (short view)"

Task 3: EDIT README.md — Keymap table
  - `Focus text editor` row Effect: "Focus the free-text editor (short view only)"

Task 4: EDIT README.md — Limitations bullets
  - drafts bullet: "...restarting pi mid-interrogation restores questions and
    submitted answers with their exact values — never in-progress drafts. Drafts of
    questions the agent re-asked survive a panel submit (only shipped answers flush)."
  - TUI-first bullet: append "...you answer in your next message; once recorded, the
    interrogation closes and the completion record is injected when the agent settles
    (moot/withdrawn/closed questions are reported as ignored)."

Task 5: VERIFY — no stale claims, no collateral damage
  - grep README.md for: "rev-guarded" (must be gone or qualified), and confirm the
    nine behaviors each appear
  - git diff README.md — confirm edits confined to Usage/Configuration/Keymap/Limitations
```

### Implementation Patterns & Key Details

```markdown
<!-- Style: one claim per sentence, imperative for keys, past-free tense for behavior.
     Example edit (Usage step 3):
     "Each submit streams a compact delta message to the model (rendered as a diff
     card in your transcript) ending with `(state epoch {n})` — the epoch the model
     must echo when upserting existing questions afterwards." -->
```

### Integration Points

```yaml
DOCS: spec/decisions.md is P1.M5.T2.S2 — do NOT touch spec/
KEYMAP RECORD: unchanged (no default keys altered by this changeset)
CODE: zero source changes; npm test / npm run typecheck must stay green
```

## Validation Loop

### Level 1: Render check

```bash
# Markdown sanity (no broken tables/links introduced)
npx tsc --noEmit && npm test     # unchanged and green — proves docs-only
git diff README.md               # review: edits confined to the four sections
```

### Level 2: Stale-claim grep (the real gate)

```bash
grep -n "rev-guarded" README.md                 # expect no unqualified hit
grep -n "state epoch" README.md                 # expect the submission claim present
grep -n "short view" README.md                  # expect ctrl+t qualifiers present
grep -n "completion record\|completion recap" README.md   # non-TUI + second-interrogation claims present
```

### Level 3: Behavioral cross-check

Read each of the nine behaviors in the final README next to its code evidence (files listed in References) and confirm zero contradiction; record the result in the final response for the AC runbook.

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` and `npm run typecheck` green (docs-only change)
- [ ] `git diff` confined to README.md Usage / Configuration / Keymap / Limitations

### Feature Validation

- [ ] All nine behavior claims updated and accurate (goal cap+mutability, second-interrogation completion, epoch in submissions, epoch-required upserts, non-TUI close+complete, resumable answered-pending panels, ctrl+t short-view-only, exact restart values, re-asked-draft survival)
- [ ] No stale claim from the 12 fixed defects remains
- [ ] spec/ untouched; keymap re-verification section untouched

### Code Quality Validation

- [ ] Markdown tables and headings intact
- [ ] Existing voice/tone preserved; no unrelated rewrites

## Anti-Patterns to Avoid

- ❌ Don't rewrite sections the changeset didn't touch (Install, Development, keymap conflict tables, Project structure)
- ❌ Don't document the legacy label-summary fallback as current behavior (raw values are; legacy is tolerance-only)
- ❌ Don't touch spec/decisions.md — that's P1.M5.T2.S2
- ❌ Don't change the keymap re-verification date/record — no keys changed

name: "P1.M6.T1.S1 — README.md: sync side-chat, keymap, and limitations sections"
description: Documentation-only task — update every README.md sentence the bugfix round 001 changeset made stale (side-chat lifecycle, confirm-row gestures, streaming esc, /clear semantics, overview chat targeting, reconstruction degradation). No code changes.

---

## Goal

**Feature Goal**: README.md at HEAD is consistent with the landed bugfix round (all implementing subtasks P1.M1–P1.M5 complete): every user-facing behavior sentence in §Side chat, §Keymap, §Limitations, and §Acceptance criteria reflects the tested behavior, with no stale gesture claims, no invented features, and no aspirational wording.

**Deliverable**: Edited `README.md` only (sections: Side chat :275, Keymap :181 — the `e` row :192, Limitations :342, Acceptance criteria :314; spot-check Configuration :133/Usage :30). Research notes at `plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M6T1S1/research/notes.md`.

**Success Definition**: A reader of README.md alone gets the correct gestures: single-`esc` streaming abort in the default state, confirm-row enter/esc working without pre-blur, transition-aware chat discard, no-op apply consuming the confirm, abort+usage-notice on replace and `/clear`·`/new` (zero-usage included), typed input preserved on refused sends, overview `e` on the cursor row, and degrade-to-next-older reconstruction. Code gates stay green (`npm test`, `npm run typecheck`, lint, `scripts/verify-keymap-conflicts.sh`) — untouched, but run as the final gate per contract 4.

## User Persona

**Target User**: pi-interrogator users reading the README to learn the side chat and reconstruction behavior.
**Use Case**: User opens a side chat, gets a converged answer, presses enter on the confirm row — it must work as documented.
**User Journey**: README says single `esc` aborts a streaming reply → user tries it in the default focused state → it works (post-fix).
**Pain Points Addressed**: docs advertising gestures that needed undocumented workarounds (double-esc/blur); docs contradicting tested behavior.

## Why

- Contract 4: this README sync is the changeset's final user-facing gate alongside the code gates.
- The round's fixes changed eight user-visible behaviors (BUG-001..008); the README still documents the pre-fix behavior in several sentences (enumerated below with line anchors).
- Spec alignment (`spec/ui-spec.md`) is P1.M6.T1.S2 — do NOT touch spec/ in this task ([Mode B]: README.md only).

## What

Update exactly these claims (line anchors from architecture/test-infra-and-docs.md §Docs map; re-grep at edit time — HEAD may have drifted a few lines):

1. **§Side chat :279-281 ("One chat at a time" bullet)** — post P1.M1/M2/M3:
   - Discard is now TRANSITION-AWARE: the chat is discarded when its question transitions open→answered/closed by any path; a chat opened on an ALREADY-answered question survives unrelated mutations (answering other questions, re-asks) and same-value re-answers keep it (P1.M2.T1.S1).
   - Replacement (`e` on another question) now ABORTS the replaced chat's in-flight stream and fires its usage-close notice before replacing — no orphaned LLM calls (P1.M3.T1.S1).
   - Keep "it survives suspend/resume" (unchanged, true).
2. **§Side chat :295 ("/clear" and "/new" bullet)** — add: while a reply is streaming, `/clear`·`/new` abort the in-flight stream first and fire the usage-close notice; the notice is unconditional (a fresh/zero-usage chat still toasts `chat closed · 0 in · 0 out · $0.00`) (P1.M3.T1.S1 + P1.M3.T2.S1).
3. **§Side chat :296 (streaming esc)** — already correct post-fix (single `esc` aborts in the DEFAULT focused state, P1.M1.T2.S1; footer hint now true). Verify wording; do not add a workaround mention.
4. **§Side chat :301-305 (confirm row / converged answers)** — add:
   - The confirm row's gestures (`enter` = apply, `esc` = decline) work immediately in the default focused state — the input blurs itself when a converged answer lands; no pre-blur/double-esc needed (P1.M1.T1.S1).
   - A same-value no-op apply (question already answered with that value) consumes the confirm row and closes the chat cleanly — no stuck `apply ★` row (P1.M2.T2.S1).
5. **§Side chat (send/typing prose)** — add one sentence: pressing `enter` while a reply is streaming is refused and PRESERVES the typed input; re-press after the stream settles (or abort with `esc`) sends it. `/clear`·`/new` and empty-buffer enter still clear the buffer (P1.M4.T1.S1).
6. **§Keymap :192 (`Side chat` / `keys.chat` row)** — append the overview clause: "in the overview, `e` opens the chat on the cursor row's question" (P1.M4.T2.S1).
7. **§Limitations :342+** — reconstruction: state reconstruction pools every state-carrying interrogate tool result (newest-first); when the newest fails to deserialize, it degrades to the next-older valid tool result (bounded degradation — P1.M5.T1.S1). Adjust any wording implying reconstruction collapses when the newest tool result is bad.
8. **§Acceptance criteria :314** — mirror the behavioral changes in the AC summary only where an AC-17.x item changed meaning (17.4 tail: no-op apply consumes + closes; esc-abort now works in the default state; input preservation on refused send). Keep the list format; the authoritative text lives in spec/product-requirements.md — do not fork it.
9. **Sweep**: `grep -n 'confirm row\|double-esc\|chat closed\|/clear' README.md` — the only remaining `double-esc` mention must be the editor-context `escExitWindowMs` note (~:216), which is about closing the embedded editor, NOT the side-chat workaround. Fix anything else stale.

### Success Criteria

- [ ] Every fix above reflected with user-visible wording matching the tested behavior (no internal identifiers like BUG-00x, no file names in user sections)
- [ ] No invented features; aspirational claims aligned to tested behavior only
- [ ] The `e` keymap row mentions overview cursor-row targeting
- [ ] Limitations states the bounded degrade-to-next-older reconstruction
- [ ] Zero-usage policy stated (unconditional close notice)
- [ ] No stale gesture claims remain (grep sweep clean except the editor double-esc note)
- [ ] No spec/ or code files touched; `npm test`, `npm run typecheck`, lint, `scripts/verify-keymap-conflicts.sh` all green

## All Needed Context

### Context Completeness Check

An implementer with zero codebase knowledge gets: exact README line anchors, the enumerated stale sentences, the final behavior of each fix (quoted from the landed subtask PRPs), the zero-usage policy decision, and the verification greps. ✅

### Documentation & References

```yaml
- file: README.md
  why: THE deliverable — sections at :181 (Keymap), :275 (Side chat), :314 (Acceptance criteria), :342 (Limitations); :216 double-esc editor note (leave); :133/:161 config (verify only)
  pattern: match the existing voice — tight bullets, backticked keys, em-dash asides
  gotcha: [Mode B] README.md ONLY; spec/ui-spec.md is P1.M6.T1.S2 — do not touch it

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/test-infra-and-docs.md
  why: §Docs map (:56-70) — README heading/line map + gates list
  section: "Docs map (Mode A / Mode B planning)"

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M6T1S1/research/notes.md
  why: per-fix final behaviors + stale-claim enumeration (the contract-2 input, condensed)

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M1T1S1/PRP.md
  why: confirm-row default-state fix — settle BLURS the input; no pre-blur workaround
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M1T2S1/PRP.md
  why: CHOSEN esc shape (i) — single esc aborts while streaming in chat view; footer hint now true
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M2T1S1/PRP.md
  why: transition-aware discard (non-terminal→terminal); same-status re-answers keep the chat
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M2T2S1/PRP.md
  why: no-op apply consumes pendingConfirm + closes + notifies once
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M3T1S1/PRP.md
  why: abort-then-notify-before-replace; zero-usage policy PINNED as unconditional notify
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M3T2S1/PRP.md
  why: /clear·/new abort+notify before resetChat
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M4T1S1/PRP.md
  why: refused send preserves the buffer; command/empty paths still clear
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M4T2S1/PRP.md
  why: overview e → cursor-row question (overviewSelectedQuestionId)
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M5T1S1/PRP.md
  why: array-collect tool results, newest-first pool, degrade-to-next-older
  gotcha: P1.M5.T1.S1 is landing IN PARALLEL — treat its PRP as contract; its behavior sentences are fixed regardless of landing order
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                        # the file to edit (533 lines)
spec/                            # authority docs — NOT touched (P1.M6.T1.S2)
plan/005_af804251f18d/bugfix/001_7ea23709b4e7/   # subtask PRPs + architecture/
scripts/verify-keymap-conflicts.sh                # gate (run, don't edit)
```

### Desired Codebase tree with files to be added

```bash
# NONE — README.md edits only. No new files except research/ notes (already written).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: [Mode B] edit README.md ONLY — spec/ is P1.M6.T1.S2's scope.
# CRITICAL: line anchors are from the docs map; re-grep headings before editing (HEAD drift).
# Do NOT mention bug IDs, PRP paths, or internal function names in user-facing README prose.
# The :216 "double-esc" mention is the EDITOR escExitWindowMs feature — correct, leave it.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-ANCHOR — grep README.md headings and the four target sections to get current line numbers
  - grep -n '^## ' README.md; grep -n 'confirm row\|double-esc\|chat closed\|/clear' README.md

Task 2: EDIT §Side chat (~:275-312)
  - "One chat at a time" bullet: transition-aware discard + survived-unrelated-mutations
    + replaced-stream abort + usage notice on replace
  - Escape-hatches bullet: /clear·/new abort in-flight stream + unconditional usage notice
    (zero-usage included); verify streaming-esc sentence is correct as-is
  - Converged-answers bullet: gestures work in the default focused state (self-blur on settle);
    no-op apply consumes + closes
  - Add: refused enter mid-stream preserves typed input; re-press sends after settle/abort

Task 3: EDIT §Keymap (~:192 `Side chat` row)
  - append overview cursor-row targeting clause to the Effect cell

Task 4: EDIT §Limitations (~:342+)
  - reconstruction paragraph: pooled state-carrying tool results, degrade-to-next-older bounded

Task 5: EDIT §Acceptance criteria (~:314) — mirror changed AC-17.x behaviors only (17.4 tail,
  default-state esc abort, input preservation); keep summary format, don't fork the spec text

Task 6: SWEEP + GATES
  - grep -n 'confirm row\|double-esc\|chat closed\|/clear' README.md → only the editor note remains for double-esc
  - npm test && npm run typecheck && npm run lint && scripts/verify-keymap-conflicts.sh
```

### Implementation Patterns & Key Details

```markdown
<!-- Example wording (§Side chat, replacement — follow the existing voice) -->
- **One chat at a time.** Opening `e` on another question aborts the current
  chat's in-flight reply, announces its usage, and replaces it without confirm.
  It is discarded when its question *becomes* answered or closed by any path —
  a chat already open on an answered question survives unrelated changes and
  same-value re-answers. It survives suspend/resume (`esc`, then `/interrogate`).

<!-- Example wording (§Side chat, input preservation) -->
Pressing `enter` while a reply is streaming is refused — your typed text stays
in the input; press `enter` again once the stream settles (or abort it with
`esc`) to send.
```

### Integration Points

```yaml
DOCS:
  - README.md sections: Keymap, Side chat, Acceptance criteria, Limitations (edit)
  - spec/ui-spec.md: DO NOT TOUCH (P1.M6.T1.S2)
GATES:
  - npm test / npm run typecheck / npm run lint / scripts/verify-keymap-conflicts.sh — run all, expect green
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown sanity — no broken heading anchors: the Limitations link in §Side chat
# ("See [Limitations](#limitations)") must still resolve.
grep -n '^## ' README.md
```

### Level 2: Unit Tests (Component Validation)

```bash
# Docs-only change — but these must stay green (the changeset's final gate, contract 4):
npm test
npm run typecheck
npm run lint
scripts/verify-keymap-conflicts.sh
```

### Level 3: Integration Testing (System Validation)

```bash
# The sweep is the integration check — no stale gesture claims repo-wide in README:
grep -n 'confirm row\|double-esc\|chat closed\|/clear' README.md
# Expected: every hit reflects post-fix behavior; the only double-esc hit is the
# editor escExitWindowMs note (~:216).
# Cross-check against the landed subtask PRPs' "user-visible" descriptions (research/notes.md table).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Fresh-eyes read: someone who has NOT seen the fixes reads §Side chat top-to-bottom
# and can operate every documented gesture without a workaround. Every sentence
# must be verifiable against a test in src/panel/ac-sidechat.test.ts (or the
# reconstruction tests for the Limitations claim).
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `scripts/verify-keymap-conflicts.sh` green

### Feature Validation

- [ ] All 9 "What" items reflected; no stale gestures (grep sweep clean)
- [ ] Zero-usage close-notice policy stated
- [ ] Overview `e` cursor-row clause in the Keymap table
- [ ] Degrade-to-next-older reconstruction in Limitations
- [ ] No bug IDs / internal names in user-facing prose; no invented features

### Code Quality Validation

- [ ] README voice/format consistent with surrounding sections (bullets, backticks, em-dashes)
- [ ] Only README.md modified (`git status` shows one file)
- [ ] spec/ untouched (P1.M6.T1.S2 scope preserved)

## Anti-Patterns to Avoid

- ❌ Don't document implementation internals (BUG-xxx, function names, PRP paths) in README prose
- ❌ Don't edit spec/ — that's the sibling task's scope
- ❌ Don't "improve" unrelated README sections while in there
- ❌ Don't leave an aspirational claim that a fix made true stated as future/conditional — state it as behavior
- ❌ Don't touch the editor double-esc note at :216 (different feature)

---

**Confidence Score**: 9/10 — the docs map gives exact anchors, every fix's final user-visible behavior is pinned in the landed subtask PRPs (incl. the parallel M5 item, treated as contract), and the sweep greps make staleness detectable. Residual risk: minor line drift in README between the docs map and edit time (mitigated by Task 1 re-anchoring).

# PRP — bugfix P1.M2.T3.S1: Flatten newlines/tabs in answerSummary (BUG-006 flatten half)

---
name: "bugfix P1.M2.T3.S1 — Flatten newlines/tabs in answerSummary so every delta entry is single-line"
description: "In src/snapshots.ts answerSummary (:135), flatten runs of newlines (\\n+) and tabs (\\t) to ' / ' — matching the in-module precedent at src/delivery.ts:176-178 (note line: note.replace(/\\n+/g, ' / ')) — applied to the FINAL composed summary (base value AND the ' — {text}' elaboration suffix), so every summary, and therefore every 'Submitted {k}: …' content entry and every card to/from field, is single-line. Golden tests delivery.test.ts:90 and :600-region pins must stay byte-identical for short/option answers (flatten is a no-op without newlines). No mocks. Mode A JSDoc update on answerSummary. This is the FLATTEN half of BUG-006; the per-entry char CAP is P1.M2.T3.S2 (do NOT implement it here)."
---

## Goal

**Feature Goal**: PRD h3.5 (flatten half) / h2.5 recommendation ("flatten newlines and enforce a per-entry cap in the submission list line so the model delta stays ≤3 short lines" — this item delivers ONLY the flatten part): every answer summary produced by `answerSummary` is single-line, so a multi-line write-in like `'line one\nline two 🚀'` renders as `✎ line one / line two 🚀` in the delta content entry and the card `to`/`from` fields — the submission content keeps the 2-line (+optional NOTE) shape instead of spilling to 3+ content lines.

**Deliverable**: Modified `src/snapshots.ts` (`answerSummary` + its JSDoc), new tests in `src/snapshots.test.ts` and `src/delivery.test.ts`. No other file changes.

**Success Definition**: `npm run typecheck` + `npm test` green. TDD pinned: multi-line write-in `'line one\nline two 🚀'` committed via Other → `buildSubmission` content is exactly 2 lines (+1 if a note ships) with the entry reading `q1: ✎ line one / line two 🚀`; card `to` field contains no `\n` and no `\t`; golden tests (delivery.test.ts `:90` happy-path exact content, and the `:600`-region golden content/envelope test) remain byte-identical (flatten is a no-op on newline-free strings).

## User Persona

**Target User**: The model receiving submission deltas — FR-3/AC-2's "≤3-line delta + reminder" shape is a hard budget; a multi-line write-in currently breaks the content grammar and inflates the resident delta.

**Use Case**: User writes a multi-line free-text answer (write-ins "keep their newlines" in the committed value per actions.ts:255 JSDoc); the DELTA and CARD summaries must still be single-line.

**User Journey**: unchanged for the user — committed `answer.value` keeps raw newlines (untouched); only summaries (delta + card rendering surfaces) flatten.

**Pain Points Addressed**: BUG-006 multi-line half — "a two-line write-in rendered a 3-line content block + reminder (4 lines total), violating FR-3/AC-2's ≤3-line delta + reminder shape; the card's `to` field also carries raw newlines/tabs."

## Why

- Bug report h3.5 / h2.5: summaries must be single-line; write-ins embed arbitrary user text with raw newlines/tabs.
- `answerSummary` is THE shared seam: it feeds `computeEntries` `from`/`to` (snapshots.ts:229-230) which feed BOTH the delta content entries AND `details.card` — one flatten covers every summary-rendering surface. No downstream consumer changes.
- In-module precedent: delivery.ts:176-178 note line already does `note.replace(/\n+/g, " / ")` — same grammar, same module family.
- Ordering: depends on P1.M1.T3.S2 (close-pass snapshot — Complete) so golden-delta churn from that change has settled; P1.M2.T3.S2 (per-entry cap) consumes this and layers the budget on top.

## What

### Exact change in `src/snapshots.ts` `answerSummary` (:135-154)

Current shape (verified): composes either `✎ ${answer.value}` (+ optional ` — ${answer.text}`), or label/raw-value summary (+ optional ` — ${answer.text}`), or `"(unanswered)"`.

Change: flatten the FINAL composed string before returning:

```ts
/** Flatten runs of newlines and tabs to the single-line separator —
 * BUG-006 (h3.5): write-ins commit raw newlines ("multi-line values keep
 * their newlines"), but every summary surface (delta content entries,
 * card to/from) must be single-line so the model delta keeps the ≤3-line
 * shape (FR-3/AC-2). Same grammar as the NOTE line (delivery.ts):
 * runs of \n (and tabs) collapse to " / ". */
const flatten = (s: string): string => s.replace(/[\n\t]+/g, " / ");
```

Apply `flatten(...)` to every non-`UNANSWERED` return (the `✎` base, its ` — text` composite, the choice/text summary, its ` — text` composite). Cleanest: compute the composed string into a local and `return flatten(composed)` at each exit, or wrap the whole tail. `UNANSWERED` ("(unanswered)") needs no flattening but applying it is a no-op — either way, keep it simple and total.

Notes:

- Regex `[\n\t]+` collapses MIXED runs (`"a\n\tb"` → `"a / b"`). `\r` is not expected in buffers (pi-tui normalizes), but `[\n\t\r]+` is acceptable if you prefer belt-and-braces — pick one and mirror it in the test expectations.
- Tabs: the item title says "newlines/tabs" — include `\t` (a tab inside a summary would still break column-aligned card rendering).
- Do NOT truncate — "No truncation — display truncation is the renderer's job" stays true; length bounding is P1.M2.T3.S2's per-entry cap, NOT this item. Do not add `…`, do not measure `SUBMISSION_LIST_MAX_CHARS` here.
- Do NOT flatten `answer.value` itself in state, drafts, `answerSignature`, or `computeDiff`'s change predicate — only the summary string. `answerSignature` (snapshots.ts ~:120, `${answer.value}\u0000${answer.text ?? ""}`) must stay raw or diff/change detection corrupts.
- `digestSince` (snapshots.ts:238) also renders via `computeEntries` → flattens for free; verify no digest test expects raw newlines (grep first — see Task 1).

### Success Criteria

- [ ] Multi-line write-in delta entry is single-line: `q1: ✎ line one / line two 🚀`; content line count = 2 (+1 with note)
- [ ] Card `to`/`from` (DiffEntry) contain no `\n`/`\t` for any answered question
- [ ] Tab-only runs flatten too (`"a\tb"` → `"a / b"`)
- [ ] Elaboration suffix flattens: `A — first\nsecond` → `A — first / second`
- [ ] Golden tests byte-identical for newline-free answers (delivery.test.ts:90, golden content test ~:600)
- [ ] `answer.value` in state still carries raw newlines (untouched)
- [ ] Per-entry cap NOT implemented (S2's job; no `…`/length logic added)

## All Needed Context

### Context Completeness Check

An implementer needs: the current answerSummary code, the seam's consumers, the delivery.ts flatten precedent, the golden-test pins, and the boundary against S2. All anchored below.

### Documentation & References

```yaml
- file: src/snapshots.ts
  why: THE edit site — answerSummary :135-154 (full current logic quoted in this PRP's Why/What); computeEntries :219-231 (from/to consumers :229-230); answerSignature ~:120 (RAW — do not flatten); digestSince :238; UNANSWERED const ~:33
  pattern: add the flatten helper next to answerSummary; apply to composed returns only
  gotcha: flattening answerSignature would corrupt the diff change predicate — it compares raw value+text with \u0000 separator

- file: src/delivery.ts
  why: the precedent — note line :176-178 `note.replace(/\n+/g, " / ")` (same " / " grammar); buildSubmission content assembly :162-186 (entries from diff.changed titles/from/to; budget loop :170-180 keeps ≥1 entry whole — S2's cap site, NOT yours)
  pattern: " / " separator, collapse RUNS (+ in the regex)
  gotcha: SUBMISSION_LIST_MAX_CHARS budgeting stays exactly as-is; the unbounded-long-entry test at delivery.test.ts:144 ("x".repeat(MAX*2), NO ellipsis) must STILL PASS unchanged — it proves you did not sneak the cap in

- file: src/delivery.test.ts
  why: golden pins — :90 happy-path exact content ("Submitted 2: q1: SQLite; q2: Postgres (state epoch 2)\nConsider…"); ~:600 golden_record_multi_group_byte_exact_content_and_envelope; :144 unbounded-entry pin (keep passing); :791/:823 epoch-suffix pins
  pattern: byte-exact toBe assertions — your change must be a no-op for these fixtures
  gotcha: if any existing test fixtures include \n or \t in answer values/text, those expectations FLIP (correctly) — grep '"\\n"' in delivery.test.ts / snapshots.test.ts first and update only the flipped ones

- file: src/snapshots.test.ts
  why: computeDiff/digestSince fixtures — label lookups, editedArchived, write-in ✎ entries; run and triage which exact-match entries need " / "
  pattern: colocated vitest, no mocks

- file: src/panel/actions.ts:255-region JSDoc
  why: documents write-ins "multi-line values keep their newlines" — the committed-value contract you must NOT change (context only)

- docfile: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-006-delta-bounds.md (if present)
  why: the research note this PRP's contract cites — answerSummary embeds raw answer.value; card fields (snapshots.ts:208 to/from) also carry raw newlines

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T2S2/PRP.md
  why: parallel item (revisit answer preview, BUG-005) — reads answer values for panel display; it renders the RAW value (panel-side), you flatten only SUMMARY surfaces. Confirm no overlap: it touches layout.ts/short-view.ts, you touch snapshots.ts only
```

### Current Codebase tree (relevant slice)

```bash
src/
  snapshots.ts          # EDIT — answerSummary + JSDoc (+flatten helper)
  snapshots.test.ts     # MODIFY — new flatten tests + triaged fixtures
  delivery.test.ts      # MODIFY — multi-line delta test + triaged fixtures
  delivery.ts           # read-only (precedent + budget loop = S2's site)
```

### Desired Codebase tree

```bash
# no new files
src/snapshots.ts        # MODIFIED
src/snapshots.test.ts   # MODIFIED
src/delivery.test.ts    # MODIFIED
```

### Known Gotchas

```ts
// CRITICAL: flatten the SUMMARY string only. answerSignature (~:120) uses
// raw `${answer.value}\u0000${answer.text}` for change detection — flatten
// there and diffs silently stop firing (or fire forever).

// CRITICAL: do NOT add truncation. delivery.test.ts:144 pins an UNBOUNDED
// 2*MAX entry with no ellipsis — it must keep passing. The cap is S2.

// CRITICAL: golden tests are byte-exact toBe — the flatten regex must be a
// strict no-op on strings without \n/\t (it is, by construction).

// Collapse RUNS with + : "a\n\n\nb" → "a / b" (one separator), matching
// delivery.ts's /\n+/g grammar extended to tabs.

// Unicode (🚀) inside the value is untouched — only \n/\t runs are replaced.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: TRIAGE pass (read-only)
  - GREP snapshots.test.ts / delivery.test.ts / results.ts / fallback.ts / renderers.ts / completion (delivery.ts buildCompletion) for fixtures or assertions containing literal "\n" or "\t" inside answer values/text — list every test that will flip
  - NOTE: buildCompletion's answer summaries (delivery.ts completionAnswerSummary) may have their OWN summary path — check whether it routes through snapshots.answerSummary (then it flattens for free) or duplicates the logic (then file the divergence; per P1.M1 display plumbing it was routed through shared surfaces — verify, and if duplicated, flatten ONLY if it shares the seam; otherwise leave it and note it for S2)

Task 2: MODIFY src/snapshots.ts
  - Add flatten helper + apply to answerSummary's composed returns (per What §)
  - Mode A JSDoc update on answerSummary: single-line flattening, " / " grammar, delivery.ts note-line precedent, no truncation (cap = S2)

Task 3: ADD tests (TDD — write the failing multi-line test FIRST if preferred)
  - snapshots.test.ts:
    - answer_summary write-in multi-line: applyAnswer({value:"line one\nline two 🚀", custom:true}) → diff entry to === "✎ line one / line two 🚀"
    - tab run: value "a\t\tb" → "✎ a / b"
    - elaboration newline: answer {value:"a"} + text "first\nsecond" → "a — first / second"
    - mixed run "x\n\ty" → "x / y"
    - no-newline entries byte-identical (existing goldens cover; add one explicit write-in single-line pin "✎ plain" if none exists)
  - delivery.test.ts:
    - bug006_multi_line_write_in_delta_stays_two_lines: q1 choice write-in "line one\nline two 🚀" + q2 "A" → msg.content === "Submitted 2: q1: ✎ line one / line two 🚀; q2: A (state epoch 2)\nConsider how these affect your other questions."
    - content.split("\n").length === 2 (3 with a note)
    - card to/from contain no \n (assert !includes("\n"))
  - UPDATE only the tests Task 1 identified as flipping (expect " / " in place of raw \n/\t)

Task 4: RUN validation; fix until green
```

### Integration Points

```yaml
NONE in production code beyond snapshots.ts:
  - delta content + details.card + digestSince: flatten via the shared seam, no consumer edits
  - P1.M2.T3.S2 (next): per-entry cap in delivery.ts budget loop — consumes
    single-line entries; keep the seam untouched so its change is local
  - panel preview (parallel P1.M2.T2.S2) renders RAW values — different
    surface, no conflict
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # expected: zero errors
```

### Level 2: Unit Tests

```bash
npm test
npx vitest run src/snapshots.test.ts src/delivery.test.ts -v
# Expected: new flatten tests pass; goldens :90/:600 byte-identical; :144 unbounded pin still green
```

### Level 3: Scenario replay (the bug report's steps)

```bash
# scripted (tsx probe or vitest): upsert q1(choice)+q2 → accept Other on q1 →
# commit "line one\nline two 🚀" → answer q2 → auto-submit →
# content lines === 2; entry "q1: ✎ line one / line two 🚀"; card to single-line
```

### Level 4: Regression sweep

```bash
npx vitest run   # full suite — renderers/fallback/completion surfaces unchanged (or only via the shared seam)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green

### Feature Validation (BUG-006 flatten half)

- [ ] Multi-line write-in → single-line delta entry + single-line card fields
- [ ] Tabs flatten; runs collapse to one " / "
- [ ] Goldens byte-identical; :144 unbounded pin still green (no cap smuggled in)
- [ ] `answer.value` in state keeps raw newlines; answerSignature untouched
- [ ] Mode A JSDoc documents single-line flattening

### Code Quality Validation

- [ ] Only snapshots.ts (+ its test + delivery.test.ts fixtures) changed
- [ ] No truncation/length logic (S2's scope)
- [ ] Anti-patterns: no flattening of raw state, no regex beyond \n/\t runs

## Anti-Patterns to Avoid

- ❌ Flattening `answer.value`/`answer.text` in state, drafts, or `answerSignature` (corrupts diff detection)
- ❌ Adding truncation, `…`, or `SUBMISSION_LIST_MAX_CHARS` logic (S2's contract; :144 pins its absence)
- ❌ Editing delivery.ts producers (the seam already routes through answerSummary)
- ❌ A different separator than " / " (breaks grammar parity with the NOTE line)
- ❌ Updating golden expectations preemptively — only flip tests that actually contain \n/\t after grep-triage

---

**Confidence Score**: 9/10 — one-function change at a single shared seam with the precedent regex, the golden pins, and the S2 boundary all explicitly identified; the only diligence step is the Task 1 grep-triage of fixtures that legitimately flip.

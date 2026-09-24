# PRP — bugfix P1.M2.T3.S2: Per-entry char cap in the delivery budget loop (BUG-006 cap half)

---
name: "bugfix P1.M2.T3.S2 — per-entry ellipsis-terminated truncation inside buildSubmission's budget loop so even the last kept entry is bounded"
description: "In src/delivery.ts buildSubmission (budget loop ~:156-181), add per-entry truncation (ellipsis-terminated) so the surviving final entry is capped to the remaining budget instead of being kept whole — relax the `entries.length - dropped > 1` guard's side effect (unbounded last entry). Flip the pinning test delivery.test.ts:133 (`single_huge_entry_still_fits_budget_rule_at_least_one_survives`) to assert the bound. Preserve exact content grammar for short entries (`{id}: {to}` / ` (changed)` suffix, `+{m} more` rollup, epoch suffix never dropped) — goldens :79-ish happy path, :115 truncation_30, :~600 completion goldens stay green. Depends on P1.M2.T3.S1 (entries are now single-line). No mocks."
---

## Goal

**Feature Goal**: PRD h3.5 cap half / h2.5 recommendation ("flatten newlines and enforce a per-entry cap in the submission list line so the model delta stays ≤3 short lines" — this item delivers ONLY the cap). After P1.M2.T3.S1, every entry is single-line but a long write-in entry (e.g. `'X'.repeat(3000)`) still renders as a 3044-char content line with no ellipsis because the budget loop's guard `entries.length - dropped > 1` always keeps ≥1 entry whole. Implement per-entry truncation within the budget loop so the final kept entry is truncated to the remaining budget with an ellipsis terminator — line 1 of the delta NEVER exceeds `SUBMISSION_LIST_MAX_CHARS` for arbitrary write-in text, restoring FR-3/AC-2's "≤3-line delta + reminder" shape.

**Deliverable**: Modified `src/delivery.ts` (budget loop + per-entry truncate helper + JSDoc on `SUBMISSION_LIST_MAX_CHARS`/`buildSubmission`), modified `src/delivery.test.ts` (flip the :133 pin; new cap tests). No other files.

**Success Definition**: `npm run typecheck` + `npm test` green. TDD pins: `'X'.repeat(3000)` write-in → first content line length ≤ `SUBMISSION_LIST_MAX_CHARS`, ends with `…` before the epoch suffix; combined long-entry + multi-entry cases: `+{m} more` rollup still precedes the never-dropped epoch suffix; short entries byte-identical to current goldens.

## User Persona

**Target User**: The model receiving submission deltas — line 1 must never wrap into >2 display lines (Mode A ≤3-line budget).

**Use Case**: User submits a long free-text write-in; auto-submit delivers a bounded single-line entry.

**Pain Points Addressed**: BUG-006 unbounded half — "a 3000-char write-in produced a 3044-char first content line with no truncation/ellipsis".

## Why

- h3.5/Recommendation 5: flatten (S1, in flight) + per-entry cap (THIS item) together bound the model delta.
- The loop already drops entries from the END when the joined list overflows; the only hole is the ≥1-entry-whole guarantee (`entries.length - dropped > 1`). Write-ins made that hole visible (pre-delta entries were short option labels).
- Boundary: S1 flattens in `snapshots.ts` `answerSummary` (summary seam); S2 caps in `delivery.ts` content assembly (budget seam). Do not add flattening here; entries arriving are already single-line per S1's contract.

## What

### Current code (verified, delivery.ts:~156-181)

```ts
let list = entries.join("; ");
let dropped = 0;
while (
  `Submitted ${k}: ${list}${epochSuffix}`.length > SUBMISSION_LIST_MAX_CHARS &&
  entries.length - dropped > 1
) {
  dropped++;
  list = entries.slice(0, entries.length - dropped).join("; ");
}
if (dropped > 0) list += `; +${dropped} more`;
const content = `Submitted ${k}: ${k === 0 ? "(no changes)" : list}${epochSuffix}\n${SUBMISSION_REMINDER}${noteLine}`;
```

### Required behavior

1. Keep the existing drop-from-the-end loop for the MULTI-entry case (unchanged grammar: `+{m} more` rollup, true `k`, epoch suffix never dropped).
2. After the loop can no longer help (only the first entry remains and the line still overflows), TRUNCATE the first/kept entry so the FULL line 1 — `Submitted {k}: {list}[; +{m} more]{epochSuffix}` — fits within `SUBMISSION_LIST_MAX_CHARS`, appending `…` to the truncated entry. The epoch suffix and rollup are never truncated; budget is computed over the whole suffixed line (already the loop's measurement).
3. Short entries (line fits 240) must be byte-identical — no ellipsis, no reflow. This keeps goldens (:79 happy path, :115 truncation_30, editedArchived `(changed)` suffix test, zero-changes test) green.
4. Simplest compliant design (recommended): after the drop loop, if the line still overflows, truncate entry 0's text in place:
   - Build `entry[0]` from `diff.changed[0]` as `${id}: ${to}${changed}` — truncate the `to` segment (never the id prefix, never the ` (changed)` suffix if budget allows; if the budget is so tight the id+suffix alone overflows, keep at least `id: ` + as much of `to` as fits + `…`).
   - Compute allowance: `SUBMISSION_LIST_MAX_CHARS - ("Submitted {k}: ".length + "; ".length*0 + epochSuffix.length)` then set `to` slice of that length minus 1 for the `…`.
   - The `…` is a single UTF-16 char (U+2026) — `.length` arithmetic in code units is fine here (S1 already flattened; wide chars/ANSI are not present in builder output — `truncateVisible` ANSI machinery in panel/layout.ts is unnecessary; do NOT import panel code into delivery.ts, h2.13 UI-free discipline).
5. Update JSDoc: `SUBMISSION_LIST_MAX_CHARS` const comment + `buildSubmission` doc — replace "never below 1 / always keeps ≥1 entry whole" language with "the last kept entry is ellipsis-truncated to the remaining budget". Also update the module-header line-1 comment if it repeats the old rule.

### Success Criteria

- [ ] `'X'.repeat(3000)` single write-in → `lines[0].length <= SUBMISSION_LIST_MAX_CHARS`, entry rendered `q1: X…`-style truncated, epoch suffix present, 2 content lines total
- [ ] `single_huge_entry…` test re-pinned to assert the bound (no `+1 more`, length ≤ 240, contains `…`)
- [ ] truncation_30 test still green (rollup before suffix, true k)
- [ ] Happy-path/editedArchived/zero-changes goldens byte-identical
- [ ] Combined case: one huge + several normal entries → first entry truncated (not dropped), others dropped with `+{m} more`, line ≤ 240
- [ ] `details.card` / `details.changed` still carry the UNTRUNCATED `to` (card is user-only and drawn from details — h2.36 decision Q2=A); only `content` is capped
- [ ] No mocks; no changes outside delivery.ts + delivery.test.ts

## All Needed Context

### Context Completeness Check

Implementer needs: exact loop code (quoted above), the constant, the pinning tests, S1's contract, and the details-vs-content split. All anchored here.

### Documentation & References

```yaml
- file: src/delivery.ts
  why: THE edit site — budget loop :~156-181; SUBMISSION_LIST_MAX_CHARS = 240 at :53 (exported); buildSubmission doc-comment (drop-loop description must be revised); note-line flatten precedent :~176 (S1 counterpart, context only)
  pattern: modify loop tail only; measurement stays `Submitted {k}: {list}{epochSuffix}`.length
  gotcha: transport half below the TRANSPORT marker is off-limits; builder must stay UI-free (no panel/layout.ts truncateVisible import)

- file: src/delivery.test.ts
  why: :133 single_huge_entry_still_fits_budget_rule_at_least_one_survives — currently asserts the FULL 480-char entry passes through; FLIP it to assert the cap. :115 truncation_30 (keep green). ~:79 happy_path byte-exact (keep green). editedArchived test (~:102) pins " (changed)" suffix grammar. ans()/q()/choice() fixtures at :40-70; SUBMISSION_LIST_MAX_CHARS imported at :17
  pattern: byte-exact toBe for content lines; construct state via upsertQuestion + applyAnswer + computeDiff/diffFrom
  gotcha: applyAnswer with custom write-in needs {value, custom:true, at} shape — see snapshots.test.ts write-in fixtures for the ✎ prefix rendering (`✎ X…`)

- file: src/snapshots.ts
  why: answerSummary ✎ write-in rule (context): custom:true → `✎ ${value}` — the entry `to` arriving in the loop. S1 (in flight) makes it single-line; assume S1's contract
  gotcha: do NOT truncate or flatten here — that's S1/S2's split; your cap lives only in delivery.ts content assembly

- docfile: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-006-delta-bounds.md
  why: research note — loop quote, test inventory, spec lines (spec/product-requirements.md:27 FR-3, :76 AC-2, :77 AC-2a ✎ grammar), existing truncate helpers (all panel-side — replicate trivially instead of importing)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T3S1/PRP.md
  why: CONTRACT for the flatten half running in parallel — entries arrive single-line; its delivery.test.ts additions (multi-line write-in → 2-line content, `✎ line one / line two 🚀`) must stay green under your cap (short strings: cap is a no-op)
  gotcha: coordinate test edits in delivery.test.ts — your flip of :133 is independent of its fixture additions
```

### Current Codebase tree (relevant slice)

```bash
src/delivery.ts         # EDIT — budget loop + truncate helper + JSDoc
src/delivery.test.ts    # EDIT — flip :133 pin, add cap tests
```

### Desired Codebase tree

```bash
# no new files
```

### Known Gotchas

```ts
// CRITICAL: truncate the CONTENT entry only — details.changed / details.card
// keep the full `to` (h2.36: card is drawn from details, not content).
// CRITICAL: the epoch suffix is never dropped/truncated; budget measures the
// suffixed line (keep the existing measurement expression).
// CRITICAL: do not import panel/layout.ts truncateVisible — delivery.ts is
// UI-free by design (delivery.test.ts module hygiene). A plain slice + "…" is
// correct here: builder output has no ANSI/wide-char concerns post-S1.
// CRITICAL: `+{m} more` rollup precedes the suffix and is not truncated.
// "…" is U+2026, one UTF-16 code unit — .length math is safe.
// Edge: budget so tight that even `q1: …` + suffix overflows — degenerate
// (id alone can't exceed 240 with realistic ids); still, never produce a
// line LONGER than the untruncated original.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: TDD — add failing tests FIRST in src/delivery.test.ts
  - bug006_single_3000_char_write_in_entry_is_capped:
      q1 answered {value: "X".repeat(3000), custom:true} →
      lines[0].length <= SUBMISSION_LIST_MAX_CHARS; lines[0].startsWith("Submitted 1: q1: ✎ X");
      lines[0].includes("…"); lines[0].toMatch(/\(state epoch 2\)$/); not.toContain("+1 more");
      lines[1] === SUBMISSION_REMINDER; content.split("\n").length === 2
  - bug006_huge_plus_normal_entries_truncate_then_rollup:
      q1 huge write-in + q2..q4 short answers →
      lines[0].length <= 240; contains "+3 more"; epoch suffix at end; k === 4 in header
  - bug006_short_entries_byte_identical (guard): two short answers →
      exact same content as happy-path golden (may already be covered by :79 — assert anyway)
  - details carry full text: msg.details.changed[0].to === `✎ ${"X".repeat(3000)}` (post-S1: no newlines anyway)

Task 2: MODIFY src/delivery.ts budget loop
  - After the existing drop loop, if `Submitted ${k}: ${list}${epochSuffix}` still overflows:
    recompute entry 0 with truncated `to` (slice allowance minus 1, append "…"), keeping
    `${id}: ` prefix and appending the rollup/suffix unchanged
  - Keep the drop loop intact for the multi-entry path
  - Update JSDoc on SUBMISSION_LIST_MAX_CHARS + buildSubmission (new "last kept entry is
    ellipsis-truncated to the remaining budget" contract; drop the "never below 1 entry whole" phrasing)

Task 3: FLIP the pin at delivery.test.ts:133
  - Rename test to e.g. single_huge_entry_is_ellipsis_truncated_to_budget
  - Assert bound (≤ SUBMISSION_LIST_MAX_CHARS), "…" presence, epoch suffix, no rollup, 2 lines

Task 4: RUN validation; fix until green (including S1's multi-line tests if both landed)
```

### Implementation Patterns & Key Details

```ts
// Sketch (adjust to final code reality):
const header = `Submitted ${k}: `;
const overflows = (l: string) => `${header}${l}${epochSuffix}`.length > SUBMISSION_LIST_MAX_CHARS;
// ... existing drop loop ...
if (overflows(list)) {
  const fixed = header.length + epochSuffix.length; // suffix + header reserved
  const avail = Math.max(0, SUBMISSION_LIST_MAX_CHARS - fixed);
  // truncate entry 0's `to` to avail-1 code units + "…"; rejoin list
}
```

### Integration Points

```yaml
NONE: content-only change; card/details/renderer/transport untouched.
README delta-shape passage (55-57) is explicitly swept later in P1.M3.T2 — do NOT edit README.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/delivery.test.ts -v
npm test            # full suite; S1's snapshots/delivery flatten tests stay green
```

### Level 3: Scenario replay (bug report)

```bash
# scripted: q1 choice + q2; accept Other on q1; commit "X".repeat(3000); answer q2;
# auto-submit fires → first content line ≤ 240 chars, ends "(state epoch n)" after "…",
# 2 content lines + reminder shape restored (FR-3/AC-2)
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` green
- [ ] :133 pin flipped to assert the bound; new cap tests pass
- [ ] Goldens (:79, :115, editedArchived, zero-changes, ~:600 completion) byte-identical
- [ ] details/card untruncated; epoch suffix + rollup never truncated; k reports true count
- [ ] JSDoc updated (const + function); no README/spec edits (P1.M3.T2's sweep)
- [ ] Only delivery.ts + delivery.test.ts changed

## Anti-Patterns to Avoid

- ❌ Keeping the ≥1-entry-whole behavior (that IS the bug)
- ❌ Truncating `details`/card data (model-only cap; card renders full text)
- ❌ Importing panel truncate helpers (breaks UI-free builder discipline)
- ❌ Dropping the epoch suffix or truncating the reminder/NOTE lines (budget is line 1 only)
- ❌ Re-flattening entries (S1's contract; duplicate grammar would drift)
- ❌ Editing snapshots.ts / README / spec (out of scope)

---

**Confidence Score**: 9/10 — single-function change at a well-documented seam, exact loop/test anchors verified against the codebase, S1 boundary explicit, only judgment call is the tight-budget edge case (guarded with a never-longer invariant).

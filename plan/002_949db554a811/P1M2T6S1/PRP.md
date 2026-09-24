# PRP — P1.M2.T6.S1: Deep view Other section with verbatim ramification, selectable → write-in duty

---
name: "P1.M2.T6.S1 — FR-D1 deep view: synthetic ✎ Other section"
description: "Add the synthetic Other section to the deep view (src/panel/deep-view.ts): render it AFTER the last option with the same sticky-header pattern (`✎ Other — write your own` header + VERBATIM extension-supplied ramification), extend the deep cursor domain to include index options.length (deepSeedCursorIndex, stepDeepSelection), and make `enter` on the Other section enter the write-in duty (return to short form with the editor focused, textDuty=\"writein\") — mirroring actions.ts accept()'s Other-row branch. Selecting a real option from deep view behaves exactly as today (acceptOptionIndex → return to short + advance). Update the Mode A JSDoc (currently states 'NO ✎' in deep view). Mock nothing."
---

## Goal

**Feature Goal**: FR-D1 / h2.29 / AC-5 — the deep view renders the synthetic `✎ Other — write your own` section after the last option with the VERBATIM extension-supplied ramification; the section is selectable (same cursor/highlight/sticky-header machinery as real options); `enter` on it enters the write-in duty (short form + editor focused, `textDuty = "writein"`); `enter` on a real option is unchanged.

**Deliverable**: Modified `src/panel/deep-view.ts` (Other section in `buildDeepContent`, cursor-domain extension in `stepDeepSelection` + `deepSeedCursorIndex`, Other branch in `acceptFromDeep`, updated Mode A JSDoc), a one-word export change in `src/panel/short-view.ts` (`OTHER_AFFORDANCE`), and new tests in `src/panel/deep-view.test.ts`. No new files. No mocks.

**Success Definition**: `npm run typecheck` + `npm test` green; scripted AC-5 coverage: deep view shows the Other section with the exact ramification string, scrolling reaches it (sticky header), cursor can highlight it, `enter` on it returns to short form with the editor focused in write-in duty, and `enter` on a real option still commits + returns + advances (existing tests stay green).

## User Persona

**Target User**: The TUI answerer reading full ramifications in deep view before deciding.

**Use Case**: User presses `ctrl+d`, scrolls through options, realizes none fit, highlights the Other section, presses `enter` — and lands in the write-in editor without ever dropping back to count rows manually.

**Pain Points Addressed**: Deep view previously clamped the cursor to the last real option (no way to reach the write-in from deep view); user had to `esc` back to short form to choose Other.

## Why

- PRD h2.29 Layout: "then the synthetic Other section (`✎ Other — write your own`) with the extension-supplied ramification … Rows remain selectable: highlight + `enter` selects, returns to short form, advances (Q14)."
- AC-5: "Deep view: toggle, scroll all ramifications (incl. the Other section), select an option from deep view → returns to short form, advances."
- Milestone M8 (h2.51): "`short-view.ts`/`deep-view.ts`/`overview.ts`: synthetic `✎ Other — write your own` trailing row (cursor index `options.length` — the old ✎ slot), extension-supplied deep-view ramification".
- Upstream landed: P1.M2.T1.S1 (short-view Other row, `cursorDomainSize`), P1.M2.T2.S1 (`writeInEnter`, write-in duty), P1.M2.T3.S1 (duty-follows-cursor in keys.ts — already treats `cursorIndex === options.length` as writein). This item completes the triad for the deep surface. Parallel P1.M2.T5.S1 (draft role binding) does not touch deep-view.ts — no conflict.

## What

### Behavior contract (exact)

1. **Other section rendering** (`buildDeepContent`): for `q.type === "choice"`, AFTER the loop over real options, append one synthetic section:
   - Header body (theme-free, into `sectionHeaders`): the short-view row label `✎ Other — write your own`. Reuse the constant: in `src/panel/short-view.ts:73` change `const OTHER_AFFORDANCE` to `export const OTHER_AFFORDANCE` and import it in deep-view.ts (single source of truth — the string must never drift between views).
   - Register its header line in `sectionHeaderLineIndex` at slot `options.length` (so `clampScroll` sticky math and `renderDeepWindow`'s `▸ ` re-render work with zero further changes).
   - Ramification: the VERBATIM fixed string (new exported constant in deep-view.ts, e.g. `OTHER_RAMIFICATION`):

     ```
     None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them.
     ```

     Note the em-dashes (`—`). Render it through the SAME pipeline as option ramifications: `capText(maxChars)` → `wrapText` → dim → `RAM_INDENT` indent. No ★ (never recommended).
   - Also render the Other section when a choice question has `options: undefined` or zero options (matches `cursorDomainSize` = `options.length + 1`; short view renders the row in that case too). Withdrawn (collapsed pane) and `type:"text"` (goal+description only) are unchanged — NO Other section there.
   - Moot: the Other section renders like other sections, dimmed via the existing `dimAll`.
2. **Cursor domain** (`stepDeepSelection`): clamp moves to `[0, options.length]` (was `count - 1`), i.e. the Other index is reachable via `deepSelectionUp/Down`. Zero options on a choice question: domain `{0}` = the Other row (step returns consumed `true`, no movement). Update the stale comments that say "the ✎ affordance index does NOT exist here" / "clamped at the last option".
3. **Seed** (`deepSeedCursorIndex`): clamp changes from `count - 1` to `count` — the ★ preselect (`initialCursorIndex`) never exceeds options anyway, but a stale cursorIndex of `options.length` (left there from deep Other, then re-entering deep) must survive the re-seed rather than snapping back. (Choose `Math.min(initialCursorIndex(q), count)`.)
4. **Enter routing** (`acceptFromDeep`): when the clamped index equals `q.options.length` → do NOT call `acceptOptionIndex` (there is no option). Instead mirror actions.ts `accept()`'s Other branch: `panel.textDuty = "writein"; panel.setView("short"); panel.scrollOffset = 0; panel.focusTextField();` — return to short form with the editor focused in write-in duty (h2.32: accepting Other makes the editor the answer surface; seeding from the freshest draft is `focusTextField`'s job). Return `true`. Real-option indexes behave exactly as today (ripple veto keeps the user in deep view, unchanged).
5. **JSDoc [Mode A]** on deep-view.ts: update the glyph vocabulary block — remove the "NO `✎`" bullet and document: the synthetic Other section (index `options.length`) is extension-supplied (label shared with short-view.ts via `OTHER_AFFORDANCE`; ramification is the fixed `OTHER_RAMIFICATION` string, h2.29), selectable, and `enter` on it enters the write-in duty returning to the short form (P1.M2.T6.S1). Also update the builder's and `acceptFromDeep`'s doc comments.
6. **Mock nothing**: tests use the real `InterrogationPanel`/state/draft seams per existing deep-view.test.ts fixtures (`choiceQ`, `textQ`, `panelArgsFor`).

### Success Criteria

- [ ] Deep view on a choice question renders a final sticky section header `✎ Other — write your own` whose body is reachable by `deepSelectionDown` past the last option (cursorIndex === options.length) and carries the `▸ ` prefix.
- [ ] The rendered lines contain the exact ramification sentence (em-dashes intact), wrapped/indented like option ramifications.
- [ ] `enter` on the Other section: view becomes `"short"`, `textDuty === "writein"`, the editor is focused (panel's text-field focus state), scrollOffset 0, and NOTHING was answered.
- [ ] `enter` on a real option from deep view: unchanged (commit + return to short + advance + scrollOffset 0) — existing acceptFromDeep tests stay green.
- [ ] `clampScroll` pins the Other section's header while its ramification scrolls (it just works via `sectionHeaderLineIndex[options.length]`; add an assertion).
- [ ] Withdrawn / text questions: NO Other section; text questions still goal+description only.
- [ ] `deepSeedCursorIndex` tolerates the Other index (no snap-back below `options.length` when re-entering deep).

## All Needed Context

### Context Completeness Check

Every edit site is enumerated with current anchors, the exact strings (verbatim, em-dashes), the index-registration pattern that makes scroll/render work for free, and the test fixtures to copy. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: src/panel/deep-view.ts
  why: the whole item — buildDeepContent (Other section + registration), stepDeepSelection/acceptFromDeep/deepSeedCursorIndex (domain + routing), Mode A JSDoc blocks to update
  pattern: register the synthetic section exactly like a real one (push body into sectionHeaders, lines.length into sectionHeaderLineIndex, placeholder header with CURSOR/BLANK prefix); renderDeepWindow + clampScroll then need NO changes
  gotcha: the top-of-file JSDoc currently asserts "NO `✎` — the free-text affordance belongs to the short form" — this item deliberately reverses that; update the doc, don't leave a contradiction

- file: src/panel/short-view.ts
  why: OTHER_AFFORDANCE const at :73 (add `export`); the canonical Other-row rendering the deep section must match textually
  pattern: one-word change (`const` → `export const`); do NOT duplicate the string in deep-view.ts
  gotcha: OTHER_AFFORDANCE already includes the `✎ ` glyph; the deep header body is the same full label (no extra ★)

- file: src/panel/actions.ts
  why: read-only reference — accept() :198–226 (the Other-row branch to mirror: textDuty="writein" + focusTextField), cursorDomainSize :127 (options.length+1), writeInEnter :280+ (what enter-in-duty does next)
  pattern: mirror the accept() branch ORDER for acceptFromDeep: set textDuty, setView("short"), scrollOffset=0, focusTextField()
  gotcha: do NOT commit from deep view — enter on Other only OPENS the duty; the commit happens at writeInEnter when the user presses enter in the editor (h2.32)

- file: src/panel/keys.ts
  why: read-only — desiredTextDuty (:274–292) already maps cursorIndex === options.length → "writein" (duty-follows-cursor parity for P1.M2.T3.S1 lands free)
  pattern: no change needed; verify no test asserts deep-view ✎-absence here

- file: src/panel/deep-view.test.ts
  why: fixtures (choiceQ/textQ/panelArgsFor at top) and the suites to extend: buildDeepContent, clampScroll, renderDeepWindow, deepSelectionUp/Down, acceptFromDeep, deepSeedCursorIndex
  pattern: copy the acceptFromDeep setup() helper (createInterrogationState + upsertQuestion + setStatus discipline); assert editor focus via the panel's focus state (see text-field tests for the seam)
  gotcha: upsertQuestion normalizes status to "open" — answered/submitted fixtures need the two-step upsert+applyAnswer pattern used by existing tests
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  deep-view.ts        # MODIFY — Other section, cursor domain, enter routing, JSDoc
  deep-view.test.ts   # MODIFY — new coverage
  short-view.ts       # MODIFY — export OTHER_AFFORDANCE (one word)
  actions.ts          # read-only (writeInEnter, accept, cursorDomainSize)
  panel.ts            # read-only (focusTextField, textDuty, setView)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: em-dashes — the ramification string uses `—` (U+2014), not `-`;
// assert with the exact literal, and copy it from this PRP verbatim.
// CRITICAL: sectionHeaders entries are THEME-FREE plain bodies; renderDeepWindow
// composes prefix + body. Push the label WITHOUT the INSET/prefix.
// CRITICAL: renderDeepWindow re-renders headers by section INDEX — the Other
// section MUST be the LAST entry (index options.length) or the cursor prefix
// lands on the wrong header.
// GOTCHA: capText caps SOURCE chars — the fixed ramification (~145 chars) may
// exceed small config caps and get `…`-truncated in render; that is correct
// per h2.51 row 2 (do not special-case it), but tests asserting the full
// sentence must use a fixture/config where the cap fits (default is generous).
// GOTCHA: panel.cursorIndex is SHARED between short and deep views (same field);
// extending the deep domain aligns it with cursorDomainSize(options.length+1) —
// short-view digit handling already excludes Other, so no regression there.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/short-view.ts
  - EXPORT: `export const OTHER_AFFORDANCE = "✎ Other — write your own";` (:73)
  - one-word change; no behavior change

Task 2: MODIFY src/panel/deep-view.ts — buildDeepContent
  - ADD exported constant OTHER_RAMIFICATION = the verbatim string (see contract §1)
  - IMPORT OTHER_AFFORDANCE from ./short-view.js
  - IN the `q.type === "choice"` block, AFTER the options loop: push the synthetic
    section (header body = OTHER_AFFORDANCE into sectionHeaders; header line index
    into sectionHeaderLineIndex at position options.length; placeholder header with
    build-time cursor prefix; ramification via pushBlock(..., dim=true, RAM_INDENT))
  - KEEP zero-options choice questions rendering the Other section (loop empty,
    section still pushed)
  - UPDATE the buildDeepContent JSDoc variant bullets (choice now includes the
    synthetic Other section; withdrawn/text unchanged)

Task 3: MODIFY src/panel/deep-view.ts — cursor domain + seed + routing
  - stepDeepSelection: clamp to `options.length` (cursorDomainSize(q)-1 semantics);
    zero-options choice → domain {0}, consumed no-op moves
  - deepSeedCursorIndex: `Math.min(initialCursorIndex(q), count)` (allow Other index)
  - acceptFromDeep: when clamped index === options.length → textDuty="writein";
    setView("short"); scrollOffset=0; focusTextField(); return true
    (BEFORE the acceptOptionIndex call; keep the ripple-veto/stay-in-deep logic
    untouched for real options)
  - UPDATE stale comments ("does NOT exist here", "clamped at the last option") and
    the top-of-file Mode A glyph-vocabulary JSDoc (remove "NO ✎" bullet; document
    the synthetic selectable Other section + write-in routing, cite P1.M2.T6.S1)

Task 4: MODIFY src/panel/deep-view.test.ts
  - buildDeepContent: Other section rendered after last option (header body in
    sectionHeaders at index options.length; ramification string present in lines,
    wrapped + RAM_INDENT-indented + dim); withdrawn/text: absent; zero-options
    choice: present as the only section
  - clampScroll/renderDeepWindow: cursorIndex = options.length pins/renders the
    Other header with `▸ ` prefix
  - deepSelectionUp/Down: can traverse onto and past the last option onto Other;
    clamped there (no wrap)
  - acceptFromDeep: Other → view "short", textDuty "writein", editor focused,
    answer undefined, scrollOffset 0; real option → existing assertions unchanged
    (existing tests must stay green)
  - deepSeedCursorIndex: choice question with stale index options.length tolerated
```

### Implementation Patterns & Key Details

```ts
// buildDeepContent — the synthetic section (after the options loop):
if (q.type === "choice") {
  const options = q.options ?? [];
  for (let i = 0; i < options.length; i++) { /* unchanged */ }
  // P1.M2.T6.S1: synthetic Other section — index options.length (WRITEIN-001)
  sectionHeaders.push(OTHER_AFFORDANCE);
  sectionHeaderLineIndex.push(lines.length);
  const prefix = options.length === input.cursorIndex ? CURSOR : BLANK;
  const composed = `${INSET}${prefix}${OTHER_AFFORDANCE}`;
  lines.push(dimAll ? theme.fg("dim", composed) : composed);
  pushBlock(lines, OTHER_RAMIFICATION, theme, budget, maxChars, true, RAM_INDENT);
}

// acceptFromDeep — Other branch (before the real-option path):
if (index === (q.options?.length ?? 0)) {
  // WRITEIN-001 deep parity: enter on Other opens the write-in duty —
  // short form + editor focused; commit happens at writeInEnter (h2.32).
  panel.textDuty = "writein";
  panel.setView("short");
  panel.scrollOffset = 0;
  panel.focusTextField();
  return true;
}
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck      # tsconfig strict — expected: zero errors
npx tsc --noEmit 2>&1 | head   # if no npm script alias exists
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/deep-view.test.ts -v        # new + existing suites
npx vitest run src/panel/ -v                          # no panel-wide regressions (keys, panel, short-view, actions)
```

### Level 3: Integration (scripted AC-5 slice)

```bash
npx vitest run src/panel/ac-panel.test.ts -v   # AC-5 script if present in this suite; otherwise the deep-view.test.ts accept/scroll tests ARE the scripted AC-5 coverage
```

### Level 4: Documentation gate

- JSDoc grep: `grep -n "NO \`✎\`" src/panel/deep-view.ts` must return nothing; new Mode A Other-section doc present.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] Other section renders after the last option with the VERBATIM ramification (em-dashes).
- [ ] Cursor traverses onto the Other section; sticky header + scroll work (clampScroll parity).
- [ ] `enter` on Other → short form + editor focused in write-in duty, nothing committed.
- [ ] `enter` on a real option from deep → commit + return + advance (unchanged).
- [ ] Withdrawn / text questions: no Other section.
- [ ] `OTHER_AFFORDANCE` exported and single-sourced; no duplicated label strings.
- [ ] Mode A JSDoc updated (no stale "NO ✎" claim).

## Anti-Patterns to Avoid

- ❌ Don't commit the write-in from deep view — enter only opens the duty; `writeInEnter` owns the commit.
- ❌ Don't duplicate the label/ramification strings across files — import/export.
- ❌ Don't special-case the fixed ramification past capText/wrapText — it flows through the same budget pipeline.
- ❌ Don't touch `acceptOptionIndex`, `writeInEnter`, or the ripple seam — this item only routes to them.
- ❌ Don't break the section-order invariant (Other MUST be the last sectionHeaderLineIndex entry).

---

**Confidence Score**: 9/10 — all edit sites are enumerated with anchors, the index-registration pattern makes scroll/render work for free, and the routing branch mirrors an already-landed branch (actions.ts accept()); the only mild uncertainty is the editor-focus assertion seam in tests, which existing text-field tests provide.

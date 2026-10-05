# Delta PRD — pi-interrogator: answer pinning (ANSWER-PIN-001, spec M9)

**Driver:** spec commit `de633b0515c4` ("Spec corpus adopts the answer-pinning ruling", 2026-10-04 — FR-35 / R7 / AC-16 / M9). The spec/ directory already contains the full amended PRD; this delta covers ONLY the gap between the shipped code and that spec.

## Diff analysis (previous PRD → current PRD)

The raw PRD diff is large, but **all of it except one ruling is already implemented**. Verified against the repo (git log through `c7d44c0`; working tree clean):

**Already shipped — NO tasks in this delta** (cite, don't rebuild):
- Bugfix wave BUG-001..008 + spec sweep (`954c9af`..`2143c38`, `cf2d258`): gate-hold arming on every commit, ctrl+c/discuss/note draft staging, close-pass snapshots + digest no-ops, text-duty re-derivation on navigation (BUG-004), ✎ marker + dim write-in preview (BUG-005), one-line flattened/capped delta entries (BUG-006).
- D-R11–D-R14 locked visuals, recommended-first display order, accent highlight on the recorded answer's row (`32a1f6e`) — the *visual* half of answer pinning already exists.
- AUTOSUBMIT-003 narrowed trigger — transition or review-flow exit only (`2bc2e7c`).
- Remote bridge surface removed, FR-31..34 struck (`f4969c7`) — `remote-bridge.ts`/`remote-submit.ts` deleted, config `remote` key gone.
- D-R14 amendment 9 selection glyphs (▸ + heavy ┃) + wayfinding restructure (`98398af`).
- Submission card first-answer sentinel fix (`265ecf9`).
- FR-3d post-submit exit — every real delivery suspends the panel (`2aae6ea`).
- Record-derived `answered` counter semantics shared across results/footer/widget (shipped with the 2026-10-02 wave).

**This delta — the unshipped remainder (spec M9; `de633b0` touched spec only):**
1. **ANSWER-PIN-001 / FR-35** — a recorded answer owns the caret in every view and on every entry path; `enter`/digit on the already-recorded value is a state NO-OP (advance only); ★ preselect survives only on unanswered questions; the FR-18 modal fires only on an explicit DIFFERENT choice; a stale answer value clamps to display row 0, never the recommendation.
2. Supporting: ★ answered marker on the short-view question line; purge of every status-agnostic-preselect comment; test flips; AC-16.

**Removals (awareness, no tasks):** none remaining in code — the PRD's removal deltas (bridge surface, two-stage machinery) shipped in prior commits.

## Existing work to modify (seams verified in code; prior research: `plan/002_949db554a811/architecture/panel-ui-seams.md` still accurate for these seams)

| Seam | Location | Change |
|---|---|---|
| `initialCursorIndex` | `src/panel/short-view.ts:119` (status-agnostic ★ preselect today) | recorded answer pins the cursor; ★ only when unanswered |
| `displayOptions` (D-R13 order) | `src/panel/short-view.ts` | pinning must map `answer.value` through DISPLAY order (recommended-first) |
| currentId setter seed | `src/panel/panel.ts:357` | inherits new `initialCursorIndex` automatically; JSDoc purge only |
| editor-close re-seed (EXPLAIN-003 site) | `src/panel/panel.ts:~888-896` ("next enter should ACCEPT the recommendation") | inherits automatically; comment purge — re-seeds to the RECORDED answer when one exists |
| deep seed | `src/panel/deep-view.ts:568` `deepSeedCursorIndex` | inherits (clamp bound `count` already tolerates the ✎ index); JSDoc purge |
| `acceptOptionIndex` | `src/panel/actions.ts:244` | same-value short-circuit BEFORE the ripple seam: no `confirmRippleEdit`, no `applyAnswer`, no `answer.at` rewrite, no `evaluateDependsOn`, no `maybeAutoSubmit`; advance only |
| `digit` | `src/panel/actions.ts:189` | routes through `acceptOptionIndex` — inherits; add explicit no-op test |
| `writeInEnter` | `src/panel/actions.ts:295` | byte-identical write-in re-commit inert BEFORE the ripple-victims branch; advance only; buffer must not stage into the draft slot (consume per the VAL-002 pattern so the advance's write-through can't resurrect committed text as a draft) |
| `acceptFromDeep` veto detection | `src/panel/deep-view.ts:528-556` | `if (q.answer === before)` reads a same-value no-op as a VETO (user stuck in deep view) — must distinguish no-op (return to short + advance) from veto (stay in deep) |
| `statusMarkers` | `src/panel/layout.ts:309` | add `★ answered` marker — parity with the overview rule (`overview.ts:132`: `answer` present and status not moot/withdrawn; ⟳ overrides) |
| tool-schema `recommendation` description | `src/tool-schema.ts:62` (agent-visible string) | match spec verbatim: "marked ★; preselected only while unanswered — a recorded answer always owns the cursor" |
| Comment purge | short-view.ts:22-28 & 117-123, panel.ts:~888, actions.ts:278/305/329/338-339/353/371, deep-view.ts:559-566, keys.ts:440, overview.ts:390/405 | every "answers never pin the cursor" / status-agnostic-preselect claim |
| Tests to flip | short-view, two-stage, deep-view, overview, ac-panel, actions, panel (all `src/panel/*.test.ts`), `src/ac-scripted.test.ts`, `src/regression-phantom-submissions.test.ts` | assertions pinning ★-preselect-on-revisit and same-value edit behavior — they were pinning the bug |

## Phase D1 — Answer pinning (FR-D8..D10; continues the FR-D numbering from the 002 delta)

### Milestone D1.M1 — The caret follows the recorded answer (single milestone)

**FR-D8 (FR-35; modifies FR-7, FR-12):** A recorded answer owns the cursor.
- `initialCursorIndex(q)`: when `q.answer` is present (any status carrying an answer — answered/submitted/closed; moot keeps its dimmed answer too): choice + `custom: true` → `options.length` (the ✎ Other row); choice + option value → the DISPLAY row of `answer.value` (`displayOptions` order); value no longer in `options` → clamp to row 0 (NEVER the recommendation); `type:"text"` → 0 (the text affordance). No answer → today's ★ preselect unchanged (display row of `recommendation`, clamp 0).
- All three seed sites (currentId setter, editor-close re-seed, `deepSeedCursorIndex`) inherit the new behavior automatically — their JSDoc/comments are the only edits there.
- The ★ recommendation stays visible on its own row everywhere (R2 intact) but may never own the caret or preselect once an answer exists.
- **Docs Mode A:** JSDoc on `initialCursorIndex` + the "WHY ★ AND PRESELECT COEXIST" block (short-view.ts), the three seed sites, and the `tool-schema.ts:62` recommendation description (spec-verbatim string above).

**FR-D9 (FR-35/FR-18; modifies the accept paths):** Same-value commits are inert; the modal guards only different choices.
- `acceptOptionIndex`: when the question carries an answer whose value equals the proposed option value (a non-custom recorded choice) → state NO-OP that advances (Q14 rhythm): skip the ripple seam, `applyAnswer`, `evaluateDependsOn`, and `maybeAutoSubmit` entirely; no fresh `answer.at`. The `digit` path inherits (same seam).
- `writeInEnter`: a byte-identical write-in re-commit (`answer.custom === true && text === answer.value`; likewise `answer.value === text` on text questions) is equally inert — checked BEFORE the ripple-victims branch; advance only; consume/neutralize the buffer so the advance's draft write-through cannot stage committed text into the draft slot.
- `acceptFromDeep`: the same-value no-op is an ACCEPT, not a veto — return to short form and advance; only a ripple veto keeps the user in deep view (the `q.answer === before` heuristic needs a third outcome or an explicit signal from `acceptOptionIndex`).
- The FR-18 confirm now fires only on an explicit, DIFFERENT user choice (caret moved to another row, different digit, changed write-in text).
- **Docs Mode A:** JSDoc on `acceptOptionIndex`, `writeInEnter`, `acceptFromDeep` stating the no-op contract (cite ANSWER-PIN-001).

**FR-D10 (FR-35 final clause):** The short-view question line carries the answered marker (★) — parity with the overview's answered rows: `answer` present and status ∈ {answered, submitted, closed} (moot/withdrawn excluded; ⟳ re-asked overrides, as in the overview vocabulary). Implemented in `statusMarkers` (layout.ts); composes with the existing `✎ text answer` marker for write-ins.
- **Docs Mode A:** JSDoc on `statusMarkers` (marker semantics + overview-parity rule).

**Acceptance (spec AC-16):** answer q1 with a NON-recommended option, advance, `←` back → caret + accent highlight sit on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to the next unanswered with zero state change (no modal, no epoch bump, no `answer.at` rewrite). A write-in answer pins the caret to the `✎ Other` row with its dim preview; a byte-identical write-in re-commit is inert. Choosing a DIFFERENT option on the answered question still raises the FR-18 confirm.

## Verification (binding: `plan/001_0d6760db6bc5/AUTOMATION-POLICY.md` still applies)

- Scripted vitest only — no live TUI, no live tool calls, never waiting on user answers; interactive checks defer to the human runbook.
- **Flip** the ★-preselect-on-revisit assertions that were pinning the bug — e.g. `actions.test.ts:541` (`test_d_cursor_resets_to_star_preselect_on_every_change`), :1684-1685, :1829-1836, :1878, :1948, :995 (EXPLAIN-003 re-seed → re-seeds to the recorded answer when one exists); `deep-view.test.ts:420`; `overview.test.ts:412/452`; `panel.test.ts:618`; `ac-panel.test.ts:477`; plus matching rows in short-view/two-stage/ac-scripted/regression-phantom.
- **New scripted tests:** AC-16 (cites FR-35); digit-on-recorded-value no-op (consumed, advance, zero state change); `acceptFromDeep` same-value returns to short + advances (vs. veto stays in deep); stale answer value clamps to display row 0 with a ★ recommendation present; `maybeAutoSubmit` never fires from a no-op path; `★ answered` question-line marker (incl. write-in composition and moot/withdrawn/⟳ exclusions).
- Full suite + `npm run typecheck` + keymap guard (`src/no-hardcoded-keys.test.ts`) stay green — no new key labels ship.

## Sync changeset-level documentation (Mode B — final task, depends on all above)

`README.md`: (1) Usage — a sentence/step covering revisits: the caret sits on the recorded answer in every view, `enter` on it just advances, and changing an answer requires an explicit different choice (which raises the invalidation confirm); (2) the acceptance-criteria summary list gains AC-16. No config keys, hotkey table rows, or limitations change in this delta.

## Non-goals for this delta

No new config surface · no changes to auto-submit triggers, surfacing gates, or the (removed) bridge · no overview marker changes (already correct) · no bulk-accept affordance (Q15=A stands) · no changes to state machine, rev/epoch, or persistence.

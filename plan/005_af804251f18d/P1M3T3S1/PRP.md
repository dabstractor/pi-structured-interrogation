# PRP — P1.M3.T3.S1: README sync — Side chat section, keymap row, sample settings, limitations, conflict record

---
name: "P1.M3.T3.S1 — README changeset-level documentation sync (Mode B, side chat)"
description: "Update README.md to fully reflect the side-chat changeset (plan 005_af804251f18d): (a) rewrite the ~:39 usage sentence — `e` opens the in-panel side chat (no suspend, no chat handoff); (b) NEW '## Side chat' section: entry key (keys.chat, renamed from keys.discuss with silent compat alias), singleton/replacement semantics, /clear and /new, the answer-block confirm row + sideChatAutoApply, usage-on-close notification, ephemerality (lost on restart, never persisted, TUI-only); (c) keymap table row :189 → 'Side chat / keys.chat / e'; (d) sample settings JSON :148 → `\"chat\": \"e\"` plus sideChatModel + sideChatAutoApply (mirror spec implementation-plan.md §Config reference JSONC verbatim); (e) ## Limitations (:300) += side-chat ephemerality + mid-chat snapshot staleness (accepted v1) + TUI-only; (f) reword the :237 R4 write-through sentence for the new `e` exit gesture; (g) refresh ### Keymap conflict re-verification (:341/:364) with the P1.M3.T2.S2 run record (label `e (chat)`, date, expected-unchanged result). The word `discuss` must NOT appear anywhere in README when done (final grep gate). Project-structure section :417 and the final residual sweep belong to sibling S2 — do NOT touch them. Anchors are line-verified at HEAD in plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md §README anchors."
---

## Goal

**Feature Goal**: README.md is the complete, accurate user-facing record of the side-chat changeset: every mention of the old discuss-in-chat behavior is replaced with side-chat reality, the new section documents the full UX contract, config samples match the shipped `src/config.ts` defaults, limitations are honest, and the keymap-conflict record reflects the real re-verification run from P1.M3.T2.S2.

**Deliverable**: Edits to `README.md` only (plus optional research notes under `plan/005_af804251f18d/P1M3T3S1/research/`). No source files.

**Success Definition**: `grep -ri discuss README.md` → zero matches; the seven edit points (a)–(g) below all landed; every key/toggle string in the sample JSON matches `src/config.ts` DEFAULT_CONFIG exactly; `## Side chat` section covers all contract items (entry, singleton, /clear /new, confirm row + autoApply, usage-on-close, ephemerality, TUI-only); conflict record carries the S2 run's date and the "`e` unchanged" result.

## Why

Mode B documentation sync: this changeset renamed a config key (`discuss`→`chat` with a silent alias), deleted discuss-in-chat, and added a substantial feature. The README currently *documents the deleted feature at four separate anchors* (:39, :148, :189, :364) — stale docs that name a removed key are worse than none. Sibling S2 does the final `discuss` sweep across the repo and the project-structure section; this task hands it a README that is already clean.

## What

Seven edit points, anchored at HEAD (re-verify line numbers before editing — S2-era drift is possible; anchors come from `guards-tests-and-docs-surface.md` §README anchors):

### (a) Usage sentence — README.md ~:39

Current: "`m` attaches a batch note, `e` discusses the current question in chat, `ctrl+g` finishes the draft…"

Replace the `e` clause with: "`e` opens the side chat on the current question (see [Side chat](#side-chat))". Keep the surrounding sentence structure and all other keys untouched.

### (b) NEW `## Side chat` section

Insert after `## Keymap`'s content ends (before whatever section follows — place it as its own `##` sibling near Keymap; exact placement: after the fixed-keys paragraph that follows the keymap table, so key docs stay together). Content, condensed from ui-spec §Side chat (prd_snapshot h2.38, lines 548–558 — quote-level accuracy matters):

- **Entry**: `e` (`keys.chat`, default `e`; a settings file still carrying the old `discuss` name maps silently to `chat` — the same compat-alias precedent as `focusText`→`elaborate`). Opens from any non-editor focus; while an editor holds focus, `e` types. No suspend — the chat is a view INSIDE the panel.
- **What it is**: a short private conversation about ONE question with a side model, rendered in-panel (header `chat · q3 — {prompt, truncated}`, transcript with `you ›` prefixes, its own composed-editor input; `enter` sends, `shift+enter`/`ctrl+j` newline).
- **Singleton**: exactly ONE chat exists. Opening `e` on another question replaces it wholesale, no confirm. It discards automatically when its question is answered or closed by any path (panel accept, write-in, side-chat apply itself, moot/withdraw/upsert close). It survives panel suspend/resume (`esc` then `/interrogate`).
- **Answer protocol**: the side model ends a converged reply with a fenced ```answer block (`{"value": …}` byte-matching an option, or `{"text": …}`); the panel parses the LAST block and shows an inline confirm row `apply ★ …? · enter = yes · esc = no`; `enter` applies through the ordinary accept seams — ripple confirms, advance, auto-submit, and the submission/completion records behave (and look) exactly as for a hand-made selection. `interrogator.sideChatAutoApply: true` (default `false`) skips the confirm.
- **`/clear` and `/new`**: byte-exact first-token matches reset the chat fresh on the current question (a `/usr/bin` path is just a message).
- **Esc ladder**: streaming → first `esc` aborts the in-flight reply; idle → `esc` exits the view (chat retained).
- **Model**: the session's current model at chat open, overridable via `sideChatModel: "provider/model-id"` (invalid → notify + session model).
- **Usage on close**: any close/discard notifies compactly (`chat closed · 12.4K in · 3.1K out · $0.07`); usage never enters session stats.
- **Ephemerality + isolation**: the chat lives in extension memory only — never written to the session file, lost silently on pi restart. Nested model calls only; never writes to the main conversation.

Style: follow the README's existing voice (see the Free-text field / Auto-submit paragraphs above :237 — second person, present tense, backticked keys). Aim ~2 short paragraphs + a compact bullet list, NOT a spec dump.

### (c) Keymap table row — :189

Replace `| Discuss in chat      | keys.discuss        | e             | Discuss the current question in chat          |` with:

```
| Side chat            | `keys.chat`           | `e`             | Open the in-panel side chat on the current question (one chat at a time; applies converged answers through the confirm row) |
```

(Match the table's existing column widths loosely — alignment padding just needs to be consistent; keep the Effect wording short.)

### (d) Sample settings JSON — :148 (block :132–150)

In the `"keys"` object: replace `"discuss": "e",             // discuss the current question in chat` with `"chat": "e",                // open the in-panel side chat on the current question`. Elsewhere in the same JSONC block add (comment style matching the block): `"sideChatModel": ""` isn't right — mirror the SPEC's Config reference JSONC (prd_snapshot :807–816 / spec implementation-plan.md §Config reference):

```jsonc
"sideChatModel": "",          // optional "provider/model-id" override for the side chat (default: the session's current model)
"sideChatAutoApply": false    // skip the answer confirm row and apply converged answers immediately
```

Verify the actual defaults in `src/config.ts` (`sideChatModel?: string` — optional/empty default; `sideChatAutoApply: false` at :134) and keep the sample consistent with the code, using the spec JSONC as wording authority. The spec's example value `"anthropic/claude-sonnet-4-5"` may be shown as the illustrative value in the comment if the existing block's style prefers concrete examples — but the DEFAULT documented must match the code.

### (e) `## Limitations` (:300)

Append to the limitation bullets/paragraphs (after the existing drafts bullet):

- The side chat is ephemeral: it lives only for the session — restarting pi mid-interrogation restores questions and answers but never an open chat, and nothing about a chat is written to the session file.
- The chat's view of the main conversation is snapshotted once at chat creation; submissions made while chatting do not refresh it (accepted v1).
- The side chat is TUI-only — inert in non-TUI modes (and without a model seam it opens with an inert notice).

### (f) R4 write-through sentence — :237

Current: "Every editor exit is a draft write-through (R4): question switches, `esc`, `ctrl+c`, discuss in chat, note mode — typed-but-unsubmitted text always lands in its question's draft; no exit gesture destroys it."

Replace "discuss in chat" with "the side chat" in that list (`e` no longer exits the editor — it's a view switch; the list item stays because leaving the editor to reach the side chat still write-throughs the draft). Final sentence: "…question switches, `esc`, `ctrl+c`, the side chat, note mode — typed-but-unsubmitted text always lands in its question's draft; no exit gesture destroys it."

### (g) `### Keymap conflict re-verification` — :341/:364

- Update the dated paragraph (:343–352 region): new run date, same method (`bash scripts/verify-keymap-conflicts.sh`, exit 0), note "all defaults clear; `e` unchanged — passes untouched (bare panel-owned letter, no global claim possible)". Pull the exact date, commit hash (if recorded), and any findings from **P1.M3.T2.S2's run record**: `plan/005_af804251f18d/P1M3T2S2/research/keymap-run-record.md` (treat as the source of truth; if it doesn't exist yet — S2 is implementing in parallel — write everything else and leave a `TODO(P1.M3.T2.S2)` marker ONLY on the date/findings fields, never invent a date).
- Table row :364: `| e (discuss) … |` → `| e (chat) … |` with the same panel-owned rationale text.
- Also scan the "Verified defaults" intro sentence and the "Drift since…" paragraph for discuss mentions — reword to the new run without fabricating drift findings (the S2 record owns the facts).

### Success Criteria

- [ ] `grep -ri discuss README.md` → 0 matches.
- [ ] All seven edit points (a)–(g) landed at their anchors.
- [ ] Sample settings keys/values byte-match `src/config.ts` DEFAULT_CONFIG semantics (chat default "e", sideChatModel optional, sideChatAutoApply false).
- [ ] Side chat section covers: entry+alias, singleton/replacement/discard, /clear /new, confirm row + autoApply, esc ladder, model override, usage-on-close, ephemerality, TUI-only.
- [ ] Conflict record cites the S2 run (date + expected-unchanged `e` result) or carries an explicit TODO marker for the date only.
- [ ] No edits to the `## Project structure` section (:417 — S2's scope) or any non-README file.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the current README text at each anchor, the side-chat contract (entry/lifecycle/protocol), the shipped config defaults, and the S2 conflict-run record location. All below, verified at HEAD.

### Documentation & References

```yaml
- file: README.md
  why: THE deliverable. Verified anchors at HEAD: usage sentence :39; sample settings block :132-150 (discuss row :148); keymap table :178-192 (row :189); R4 write-through :237; ## Limitations :300; ### Keymap conflict re-verification :341 (table row :364); ## Project structure :417 (DO NOT TOUCH — S2).
  gotcha: line numbers drift as you edit — locate by content (grep for the quoted strings above), not by line number.

- file: plan/005_af804251f18d/prd_snapshot.md (h2.38 "## Side chat", lines 548-558; h2.58 Config reference JSONC :807-816; h2.51 ephemerality :716; FR-15 :89; AC-17 :149)
  why: the authoritative content source for section (b) and the sample JSON (d). Quote-level details: header format `chat · q3 — {prompt, truncated}`, confirm row string `apply ★ sqlite? · enter = yes · esc = no`, close notice `chat closed · 12.4K in · 3.1K out · $0.07`, /clear /new byte-exact-first-token rule.
  gotcha: the snapshot is a merged doc — cite ui-spec §Side chat semantics, not tool-protocol internals, in README prose.

- file: src/config.ts
  why: ground truth for defaults — keys.chat default "e", the discuss→chat silent alias at coerceKeys (:217-219, "explicit valid keys.chat ALWAYS wins"), sideChatModel?: string (:95, optional), sideChatAutoApply: false (:97,:134). README must match the code, not just the spec.
  gotcha: do NOT document the alias mechanics in the keymap table; one sentence in the Side chat section (or the existing alias-mention paragraph near :175 that already covers focusText→elaborate — extend that paragraph's parenthetical if it names renamed keys) is enough.

- file: plan/005_af804251f18d/P1M3T2S2/research/keymap-run-record.md
  why: the conflict-run record (date, exit code, e-unchanged note) consumed by edit (g). S2 is implementing in parallel — the file may not exist yet.
  gotcha: never invent a date or finding; TODO-marker the date only if absent.

- file: plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md (§README anchors)
  why: the line-verified anchor list + the residual-sweep contract ("discuss may appear ONLY at the coerceKeys alias in config.ts" repo-wide; README must reach zero).
  gotcha: the dossier also lists README in the residual-sweep hit list — this task is the fix for that.

- file: plan/005_af804251f18d/P1M3T3S2/ (sibling, planned)
  why: BOUNDARY — S2 owns ## Project structure :417 and the final repo-wide discuss sweep. Leave both alone.
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                      # MODIFY — the seven edit points
src/config.ts                  # read-only: defaults ground truth
plan/005_af804251f18d/
  prd_snapshot.md              # read-only: content authority (h2.38, h2.58)
  architecture/guards-tests-and-docs-surface.md   # read-only: anchors
  P1M3T2S2/research/keymap-run-record.md          # read-only input (may be pending)
  P1M3T3S1/research/            # optional notes
```

### Known Gotchas of our Codebase & Library Quirks

```text
# CRITICAL: the word "discuss" (any case) must not survive anywhere in README —
# the grep gate is case-insensitive and includes table cells and comments.
# GOTCHA: locate anchors by content, not line number — earlier edits shift lines.
# GOTCHA: README sample JSON is JSONC with trailing // comments — match the
# existing block's comment style and key ordering.
# GOTCHA: every display string that names a key is config-derived in code;
# in README, keys appear as backticked defaults — always show the DEFAULT
# (e), never a remapped example, in the keymap table.
# GOTCHA: don't document internal module names (sidechat.ts, chat-view.ts) in
# the user-facing section — that's ## Project structure territory (S2).
# GOTCHA: the alias sentence near :175 already explains the focusText→elaborate
# silent-honor precedent — extend rather than duplicate it if you mention
# discuss→chat compat there (without using the word "discuss"... check the
# existing wording; if naming the old key is unavoidable, phrase it as
# "older configs' previous key name maps silently" and verify the zero-grep
# gate still holds — it won't if you name it. So: describe the alias WITHOUT
# the old name, e.g. "an older config's pre-rename key is silently honored".)
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RESEARCH snapshot — re-verify anchors
  - grep README.md for each quoted current string (:39 clause, :148 row, :189 row, :237 sentence, :300 heading, :341 heading, :364 row)
  - read src/config.ts defaults block + the alias comment (:217-219)
  - read P1M3T2S2/research/keymap-run-record.md if present; else note PENDING

Task 2: EDIT README.md — the four mechanical replacements
  - (a) :39 usage clause; (c) :189 keymap row; (d) :148 sample JSON key + new sideChat* settings; (f) :237 write-through list item

Task 3: EDIT README.md — the two content sections
  - (b) NEW ## Side chat section per the contract bullet list (place after the keymap fixed-keys paragraph)
  - (e) ## Limitations additions (three bullets: ephemerality, snapshot staleness accepted-v1, TUI-only)

Task 4: EDIT README.md — (g) conflict record refresh
  - dated paragraph + `e (chat)` table row + drift-paragraph reword, sourced from the S2 run record (or TODO-marker the date)

Task 5: VERIFY
  - grep -ri discuss README.md → must be empty
  - diff-check: sample JSON keys vs src/config.ts DEFAULT_CONFIG
  - confirm ## Project structure untouched
```

### Implementation Patterns & Key Details

```text
# Sample JSON additions (d) — final shape inside the existing "interrogator" block:
    "sideChatModel": "",          // optional "provider/model-id" for the side chat (default: the session's current model)
    "sideChatAutoApply": false    // apply the side chat's converged answer without the confirm row
# (place after the existing toggles; adjust the value illustration to the
#  block's existing convention — the spec JSONC at prd_snapshot :807-816 uses
#  "anthropic/claude-sonnet-4-5" as an example value, which is fine in a
#  comment, but the documented default must be "unset → session model".)

# Side chat section opening (b) — suggested lead:
# "Press `e` on any question to open a side chat — a short private
#  conversation about that one question, rendered inside the panel. It never
#  suspends the panel and never writes to the main conversation."
```

### Integration Points

```yaml
README: the only file modified.
S2 (P1.M3.T3.S2, next): consumes this README for the final `discuss` sweep +
  updates ## Project structure :417 — hand it a zero-discuss README.
S2-gates (P1.M3.T2.S2): supplies keymap-run-record.md — the (g) data source.
NO source/config/spec changes in this task.
```

## Validation Loop

### Level 1: Content gates

```bash
grep -ri discuss README.md          # expected: no output (exit 1)
grep -n "keys.chat\|sideChatModel\|sideChatAutoApply\|## Side chat" README.md   # expected: all present
```

### Level 2: Consistency gates

```bash
# Sample JSON must match shipped defaults
grep -n '"chat": "e"' README.md
grep -n 'sideChatAutoApply: false' src/config.ts   # cross-check the documented default
# Anchors: each edit point found by content
grep -n "opens the side chat on the current question" README.md
grep -n "e (chat)" README.md
# Boundary: project structure untouched
git diff README.md | grep -c "Project structure"   # expected: 0 (if git available)
```

### Level 3: Review pass

Read the full README top-to-bottom once: no dangling references to the removed handoff (suspend + editor preload + reopen round-trip), no section ordering oddities from the new insertion, the Limitations list reads coherently.

### Level 4: Domain-specific

- AC-17 read-through (prd_snapshot :149): confirm the README section doesn't contradict any scripted AC-17 clause (singleton replacement, apply-through-seams indistinguishability, no session-file residue).
- If P1.M3.T2.S2's record is still pending, the TODO-marker must be the ONLY unfinished string in the README.

## Final Validation Checklist

- [ ] `grep -ri discuss README.md` → zero matches (the hard gate).
- [ ] All seven edits (a)–(g) landed; anchors located by content.
- [ ] Side chat section covers all nine contract items (entry+alias, view, singleton, answer protocol+confirm row+autoApply, /clear /new, esc ladder, model override, usage close notice, ephemerality/isolation, TUI-only).
- [ ] Sample settings match src/config.ts defaults; spec JSONC wording mirrored.
- [ ] Limitations gained ephemerality + snapshot-staleness + TUI-only.
- [ ] Conflict record refreshed from the S2 run (date, e-unchanged) or TODO-marked.
- [ ] `## Project structure` and all non-README files untouched (S2 scope preserved).
- [ ] README reads coherently end-to-end (Level 3 pass done).

## Anti-Patterns to Avoid

- ❌ Don't invent a conflict-run date or findings — only the S2 record is truth.
- ❌ Don't name the old `discuss` key in README prose — the grep gate is absolute; describe the alias as "a pre-rename key is silently honored".
- ❌ Don't dump the spec into the Side chat section — README voice, ~half a screen.
- ❌ Don't touch ## Project structure, source files, or the spec/plan documents.
- ❌ Don't document internals (module names, seam functions) in user-facing sections.
- ❌ Don't reorder or renumber existing sections — insert surgically.

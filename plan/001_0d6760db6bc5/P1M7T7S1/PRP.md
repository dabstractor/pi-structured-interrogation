---
name: "PRP — P1.M7.T7.S1: README.md (install, config reference, usage, limitations)"
description: "Write the single changeset-level documentation deliverable: README.md at repo root for pi-interrogator v1.0. Pure docs task — no source changes."
---

## Goal

**Feature Goal**: A complete, accurate `README.md` at the repo root documenting pi-interrogator v1.0: what/why, install, the user workflow (`/interrogate` + `interrogate` tool), a model-behavior note, the full config reference, the keymap table, verbatim limitations, and a development section.

**Deliverable**: `README.md` (new file, repo root: `~/projects/pi-structured-interrogation/README.md`).

**Success Definition**: A user with no prior knowledge can install the extension both ways, use `/interrogate`, remap any key via settings, and knows exactly what the extension does not do. Every key label, cap default, and toggle documented matches `src/config.ts` `DEFAULT_CONFIG`. All validation commands in the dev section are executable.

## Why

- README is the single doc deliverable in the PRD file checklist (h2.49); per-feature docs rode with subtasks as JSDoc (Mode A). This is the Mode B docs task that runs last and depends on all implementing subtasks.
- Without it, users have no install instructions, no config reference, and no statement of limitations.

## What

A README with these sections, in order:

1. **What & why** — the problem (PRD h2.5, summarized in ≤3 lines): question lists scroll off screen, user loses the input box re-reading them, requirements end up scattered and contradictory; pi-interrogator keeps the question set front-and-center in a panel while you answer at your own pace.
2. **Install** — both paths (see Blueprint).
3. **Usage** — the `/interrogate` + `interrogate` tool workflow for *users*, plus a short **model-behavior note** explaining that the model drives the tool (upserts questions, reads state, receives submissions) and the user answers in the panel; submissions are delivered back to the model as delta messages, completed interrogations deliver one full completion record.
4. **Configuration reference** — the full `settings.json` → `"interrogator"` surface: keymap (all 10 actions + defaults), caps (with meaning of each formula parameter), toggles (incl. `compactionPreservation`, which exists in code beyond the h2.52 sample), `editorMode`. Include precedence (defaults ← global `~/.pi/agent/settings.json` ← project `.pi/settings.json`), tolerance of malformed config, and the rule that footer/dialog key labels are generated from resolved config (no restart-needed footnote: AC-12 verified remaps apply without restart).
5. **Keymap table** — three groups: (a) remappable actions with config key + default, (b) fixed keys (enter, esc, arrows, digits — not configurable, h2.34), (c) navigation defaults tab/shift+tab.
6. **Limitations** — VERBATIM from PRD h2.4 non-goals: no chat-text answer parsing while panel open; no concurrent interrogations; no images in answers; no mouse input; drafts NOT persisted across restart (in-session draft survival is guaranteed); public extension APIs only (no pi core modification); no per-request state injection. PLUS: TUI-first — non-TUI/`-p` mode gets the fallback digest instead of the panel; and a compaction note — `/compact` triggers preservation instructions and state reconstructs from the mirror (adapted FR-29).
7. **Development** — `npm install`, `npm test` (vitest run), `npm run typecheck` (tsc --noEmit); debug commands `/interrogate-debug-upsert <json>`, `/interrogate-debug-submit id=value,…`, `/interrogate-debug-state`, `/interrogate-ping`; pointer to `plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md` for the human acceptance runbook. Leave a clearly-delimited empty subsection `### Keymap conflict re-verification` (S2 will fill it — do NOT write it yourself).
8. **Project structure** — one-line map of `src/` modules (optional but cheap; derive from file names + JSDoc headers).

### Success Criteria

- [ ] README.md exists at repo root with all sections above
- [ ] Every default key/cap/toggle in the config reference matches `DEFAULT_CONFIG` in `src/config.ts` exactly
- [ ] Both install paths documented (`pi -e src/index.ts` and `packages` entry)
- [ ] Limitations section reproduces h2.4 non-goals verbatim
- [ ] `### Keymap conflict re-verification` subsection exists and is left for S2
- [ ] No source files modified

## All Needed Context

### Context Completeness Check

This is a docs-only task on an existing, complete codebase. The executor needs: the config surface (source of truth `src/config.ts`), install paths, debug commands, limitations text, and runbook pointer — all provided below verbatim or with exact read locations.

### Documentation & References

```yaml
- file: src/config.ts
  why: SOURCE OF TRUTH for the config reference. Read DEFAULT_CONFIG (≈line 128), InterrogatorConfig interface, KeyAction, EditorMode, SETTINGS_KEY, and the file header JSDoc (precedence + tolerant loading semantics).
  gotcha: toggles include `compactionPreservation: true` — present in code but absent from the PRD h2.52 sample. Document it.

- file: src/index.ts
  why: Registration surface — what actually ships (command, tool, renderers, persistence). Header JSDoc summarizes the architecture; useful for the what/why and structure sections.

- file: src/debug-commands.ts
  why: Exact debug command names + usage strings for the dev section (header JSDoc lines 1–35 list all three).

- file: src/no-hardcoded-keys.test.ts
  why: Documents the "display labels generated from resolved config" guarantee and the fixed-key set (enter/esc/arrows/digits) — basis for keymap table groups (b)/(c).

- file: plan/001_0d6760db6bc5/architecture/external-deps.md
  why: §Loading for development — verbatim install paths (both) and the npm-install-for-devDeps note.
  section: "Loading for development"

- file: plan/001_0d6760db6bc5/prd_snapshot.md
  why: h2.4 (non-goals — copy VERBATIM), h2.5 (problem statement), h2.52 (config reference sample).
  section: h2.4 / h2.5 / h2.52

- file: plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md
  why: Dev-section pointer target; do not duplicate its content.
```

### Current Codebase tree (relevant subset)

```bash
README.md            # ← TO CREATE (does not exist yet)
package.json         # name pi-interrogator, main ./src/index.ts, scripts: test/typecheck
src/                 # all implementing modules (state, tool, panel/, delivery, persistence, …)
plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md
```

### Desired Codebase tree

```bash
README.md            # NEW — install, config reference, usage, keymap, limitations, dev
```

### Known Gotchas

- **README.md does not exist yet** — verified. Create it; do not look for one to edit.
- `compactionPreservation` is in DEFAULT_CONFIG but not in the PRD h2.52 JSONC sample — document it as a toggle; do not silently copy the h2.52 block.
- Sibling subtask **S2 (keymap conflict re-verification record)** is planned and runs after this — leave `### Keymap conflict re-verification` as an empty placeholder subsection so S2 can append without merge conflicts.
- P1.M7.T6.S2 is being implemented in parallel and may add vitest coverage; reference `npm test` generally, never enumerate test file counts.
- This is a docs-only task: **do not modify any src/ file, package.json, PRD, or tasks.json**.

## Implementation Blueprint

### Task 1: VERIFY facts (read-only)

- Read `src/config.ts` (DEFAULT_CONFIG + interface + header), `src/debug-commands.ts` header, `plan/001_0d6760db6bc5/prd_snapshot.md` h2.4/h2.5/h2.52, `plan/001_0d6760db6bc5/architecture/external-deps.md` §Loading.

### Task 2: WRITE README.md

Use this exact skeleton (fill from verified facts):

```markdown
# pi-interrogator

Structured interrogation for [pi](https://github.com/earendil-works/pi-coding-agent):
when a model needs clarifying questions, they stay in a panel — not scrolled-away chat text.

<!-- What & why: ≤3 lines from PRD h2.5 -->
Long question lists scroll off screen as soon as you answer the first batch; you
scroll up to re-read and lose the input box; requirements end up scattered,
contradictory, and forgotten. pi-interrogator keeps the question set
front-and-center in a panel while you answer at your own pace.

## Install

Option A — quick, single session:

    pi -e src/index.ts

Option B — persistent local package reference. Append to `packages` in
`~/.pi/agent/settings.json` (paths resolve against the settings file's
directory; the directory resolves to a package via its `pi.extensions` manifest):

    { "packages": [ "../../projects/pi-structured-interrogation" ] }

Then run `npm install` in the package once so devDependencies (typecheck/vitest)
materialize; runtime loads via jiti against pi's tree.

## Usage
<!-- /interrogate opens/resumes the panel; the model upserts questions via the
     `interrogate` tool and gets compact non-blocking results; you answer in
     the panel (options with digits/enter, free text, batch note); submissions
     stream to the model as deltas; completion delivers one full record.
     Include the model-behavior note and that the panel auto-opens when the
     model first upserts questions, and the widget + reopen flow (breakOut key). -->

## Configuration
<!-- Full JSONC block mirroring src/config.ts DEFAULT_CONFIG, with per-field
     comments; precedence: defaults ← global settings.json ← project .pi/settings.json;
     tolerant loading; remaps apply without restart. -->

## Keymap
<!-- Table: remappable (action, config key, default) | Fixed: enter, esc, arrows, digits | nav: tab / shift+tab -->

## Limitations
<!-- VERBATIM from h2.4 non-goals + drafts-not-persisted + TUI-first/non-TUI digest + compaction note -->

## Development
    npm install
    npm test          # vitest run
    npm run typecheck # tsc --noEmit

Debug commands: /interrogate-ping, /interrogate-debug-upsert <json>,
/interrogate-debug-submit id=value,…, /interrogate-debug-state

Human acceptance runbook: plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md

### Keymap conflict re-verification
<!-- Reserved: recorded by P1.M7.T7.S2. Leave empty. -->
```

### Task 3: SELF-CHECK

- Diff every default in the README config block against `DEFAULT_CONFIG` (`grep -n "DEFAULT_CONFIG" -A 25 src/config.ts`).
- Confirm limitations wording matches h2.4 verbatim.
- Confirm the S2 placeholder subsection exists.

## Validation Loop

### Level 1–2: Docs consistency (no lint applies to .md)

```bash
# Every default documented == DEFAULT_CONFIG
grep -n "DEFAULT_CONFIG" -A 25 src/config.ts
# Compare against README config block field by field.

# Dead links / paths referenced by README exist
test -f package.json && test -f src/index.ts && test -f plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md

# No source files modified
git status --porcelain   # only README.md (and possibly untracked plan/ artifacts)
```

### Level 3: Rendered-doc smoke test

```bash
# Markdown renders sanely (headings ordered, code fences closed)
grep -c '^```' README.md   # must be even
```

### Level 4: Project still green (README task must not break anything)

```bash
npm test && npm run typecheck
```

## Final Validation Checklist

- [ ] README.md exists at repo root with sections: what/why, install (both paths), usage + model-behavior note, configuration, keymap, limitations, development
- [ ] Config block matches `src/config.ts` DEFAULT_CONFIG exactly (incl. `compactionPreservation`, `editorMode`)
- [ ] Keymap table covers all 10 remappable actions + fixed keys + nav keys
- [ ] Limitations verbatim from h2.4, plus drafts-not-persisted, TUI-first digest, compaction note
- [ ] `### Keymap conflict re-verification` placeholder present and empty (S2's slot)
- [ ] Dev section: `npm test`, `npm run typecheck`, all four debug commands, runbook pointer
- [ ] `npm test && npm run typecheck` still pass
- [ ] No files other than README.md modified

## Anti-Patterns to Avoid

- ❌ Don't copy the h2.52 JSONC sample blindly — code has `compactionPreservation`; code is truth
- ❌ Don't hardcode counts of tests/files that S2 or parallel work may change
- ❌ Don't write S2's keymap-conflict record
- ❌ Don't editorialize limitations ("small", "minor") — report them as stated
- ❌ Don't modify any source file — docs only

---

**Confidence Score**: 9/10 — docs-only task with all facts verified directly against `src/config.ts`, `src/index.ts`, `src/debug-commands.ts`, external-deps.md, and the PRD snapshot.

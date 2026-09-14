---
name: "PRP — P1.M7.T7.S2: Keymap conflict re-verification record in README"
description: "Re-verify pi-interrogator's default keymap against pi built-ins and installed extensions at build time; record the verified conflict table, avoided-keys list, panel-intercept rationale, and a regression-guard script in README's keymap section. Near-docs-only task (one small script + one test)."
---

## Goal

**Feature Goal**: Satisfy PRD h2.34's binding instruction — "Dev agent must re-verify at build time and record findings" — by actually re-running the conflict verification (grep installed extensions' `registerShortcut` calls + pi `docs/keybindings.md`) against the shipped defaults in `src/config.ts`, and recording the verified result in README's `### Keymap conflict re-verification` section.

**Deliverable**:
1. `scripts/verify-keymap-conflicts.sh` — re-runnable regression guard script (grep-based) that exits nonzero if a shipped default collides with a known-taken key.
2. `src/keymap-guard.test.ts` — vitest guard asserting our defaults ∉ the avoided-keys list (regression guard for future key additions).
3. README `### Keymap conflict re-verification` section filled with: verified conflict table, avoided-keys list, panel-intercept rationale, verification date, and how to re-run the guard.

**Success Definition**: Running `bash scripts/verify-keymap-conflicts.sh` exits 0 against current defaults; changing any default to a taken key (e.g. `ctrl+b`) in a scratch edit makes it fail; the README section reproduces the verified table with evidence paths; `npm test` and `npm run typecheck` stay green.

## Why

- PRD h2.34 mandates build-time re-verification with recorded findings; h2.50 lists "keymap conflict re-verification … recorded in README" as the regression guard.
- The baseline (plan research, done at planning time) may drift: extensions get installed/updated, pi defaults change. A recorded, re-runnable check protects future key additions.

## What

- **Re-verification (do this live, don't trust the baseline blindly)**: grep `registerShortcut` across all installed extension trees and pi's `docs/keybindings.md` for each of the 10 default keys in `DEFAULT_CONFIG.keys` (`src/config.ts:128-140`). Compare findings against the planning baseline in `plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md` §keymap-conflict-table; note any drift in the README record.
- **README section content** (fills the `### Keymap conflict re-verification` placeholder left by P1.M7.T7.S1):
  - Verified table: key → status (panel-safe-conflict / free / avoided) → owner → evidence (file:line or docs/keybindings.md section).
  - Avoided-keys list with reasons: `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+j`, `shift+down`, `ctrl+shift+x` (pi-patty-bg-tasks `src/shortcuts.ts:27-44`); `ctrl+shift+s`, `ctrl+shift+w` (pi-web-access `index.ts:99`); `ctrl+m` (sends `\r`); `ctrl+shift+f` (transcript search), `ctrl+shift+up/down` (transcript nav).
  - Panel-intercept rationale: panel-scoped keys (`ctrl+d/l/t/s/m/e`, `ctrl+g` in text focus, fixed `enter/esc/arrows/digits/tab`) intentionally reuse pi built-ins — safe because the `custom()` panel component consumes input first (intercept-before-forward, `src/panel/keys.ts` header + `src/index.ts` panel wiring); collisions exist only while the panel is open and vanish on suspend. Only the GLOBAL registration (`breakOut: ctrl+shift+q` via `pi.registerShortcut`) must be genuinely unclaimed — verified free.
  - Re-run instructions: `bash scripts/verify-keymap-conflicts.sh` plus the manual grep commands, and the rule "any new default key MUST be checked against this script + pi keybindings.md before shipping".
- **Regression guard**: script + test (below) so future key additions fail loudly if they hit a taken key.

### Success Criteria

- [ ] `bash scripts/verify-keymap-conflicts.sh` exits 0 on current defaults
- [ ] Script fails if a default is set to a taken key (verify manually with a scratch edit, then revert)
- [ ] `src/keymap-guard.test.ts` passes and blocks future defaults in the avoided list
- [ ] README `### Keymap conflict re-verification` contains table + avoided list + rationale + date + re-run instructions
- [ ] `npm test && npm run typecheck` green; no other files modified

## All Needed Context

### Context Completeness Check

Executor needs: the shipped default keys, the baseline conflict findings, the exact grep commands/paths to re-verify, and where the README placeholder lives. All provided below.

### Documentation & References

```yaml
- file: src/config.ts
  why: DEFAULT_CONFIG.keys (lines ~128-140) — the 10 defaults being verified; the guard test imports this object.
  pattern: import { DEFAULT_CONFIG } from "./config.js"; (check actual import style used by sibling tests, e.g. src/config.test.ts)

- file: plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md
  why: BASELINE conflict table to re-verify against — §keymap-conflict-table lists every finding with file:line evidence (patty-bg-tasks shortcuts.ts:27-44, pi-web-access index.ts:99, pi built-ins from docs/keybindings.md, user keybindings.json rebinds).
  gotcha: baseline was captured at planning time; re-run the greps yourself and record what you find NOW, noting drift.

- file: README.md
  why: S1 (P1.M7.T7.S1) creates it with an empty "### Keymap conflict re-verification" placeholder under Development. Append your content under that exact heading.
  gotcha: S1 runs in PARALLEL — README may not exist yet when you start. If absent, wait/re-check; do not create the rest of the README yourself. Only fill your section. If S1's placeholder is missing, insert your section under "## Development".

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md
  why: pi built-in defaults (installed pi 0.85.1). Relevant confirmed bindings: ctrl+s=app.session.toggleSort; ctrl+d=app.exit/deleteCharForward/session.delete; ctrl+l=app.model.select; ctrl+t=app.thinking.toggle; ctrl+g=app.editor.external + searchNext; ctrl+b=tui.editor.cursorLeft; ctrl+shift+m/q/e=NO default; digits 1-9=NO default; ctrl+shift+f=transcript search; ctrl+shift+up/down=transcript nav.
  gotcha: mirror copy exists at ~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md — script should check both with fallback.

- file: ~/.pi/agent/keybindings.json
  why: user rebinds — baseline found only cursorLeft/right, pageUp, altScreen.pageUp, select.pageUp; none touch our keys. Re-check.

- file: src/no-hardcoded-keys.test.ts
  why: existing guard pattern to follow for the new keymap-guard test (how sibling tests import config and assert).

- file: src/panel/keys.ts
  why: header JSDoc documents intercept-before-forward semantics — the rationale paragraph cites this.
```

### Current Codebase tree (relevant)

```bash
README.md                          # created by parallel S1; has empty "### Keymap conflict re-verification"
scripts/                           # does not exist yet
src/config.ts                      # DEFAULT_CONFIG.keys — object under verification
src/no-hardcoded-keys.test.ts      # guard-test pattern to follow
```

### Desired Codebase tree

```bash
scripts/verify-keymap-conflicts.sh # NEW — re-runnable grep-based conflict guard
src/keymap-guard.test.ts           # NEW — vitest regression guard (defaults ∉ avoided list)
README.md                          # MODIFIED — fill the "### Keymap conflict re-verification" section only
```

### Known Gotchas

- **README may not exist yet** (S1 parallel). Poll for it; only edit your section. Never write S1's sections.
- pi install path is machine-local; script must not hardcode a single path — try `~/.local/lib/node_modules/...` then `~/.pi/agent/npm/node_modules/...` and degrade to a warning (not failure) if keybindings.md is unreadable.
- Extension trees to grep: `~/.pi/agent/npm/node_modules`, `~/.pi/agent/git`, `~/.pi/extensions`. Exclude `node_modules` sub-hits of pi-coding-agent itself (its own examples). pi-vim/mcp-adapter consume keys editor-internally — only `registerShortcut(` calls count as global claims.
- Avoided list in the guard test must be the curated set: `ctrl+b, ctrl+shift+b, ctrl+shift+x, ctrl+shift+j, shift+down, ctrl+shift+s, ctrl+shift+w, ctrl+m, ctrl+shift+f, ctrl+shift+up, ctrl+shift+down` — NOT the pi built-ins our panel intentionally shadows (ctrl+s/d/l/t/g are deliberately reused; they're safe only because of panel interception).
- Fixed keys (enter/esc/arrows/digits/tab) are NOT config keys — exclude from guard.
- This task must not modify `src/config.ts`, PRD, or tasks.json.

## Implementation Blueprint

### Task 1: RE-VERIFY (live greps — do these, record actual findings)

```bash
# 1. Extension-registered global shortcuts
grep -rn "registerShortcut(" ~/.pi/agent/npm/node_modules ~/.pi/agent/git ~/.pi/extensions 2>/dev/null | grep -v "pi-coding-agent/dist" | grep -v "node_modules/.*examples"
# Expect: patty-bg-tasks src/shortcuts.ts:27-44 (ctrl+b, ctrl+shift+b/j/x, shift+down); pi-web-access index.ts:99 (ctrl+shift+s/w)

# 2. Pi built-in defaults for our keys
for k in ctrl+s ctrl+d ctrl+l ctrl+t ctrl+g ctrl+shift+m ctrl+shift+q ctrl+shift+e; do
  echo "== $k =="; grep -n "\`$k\`" ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md || echo "  (no default)"
done

# 3. User rebinds
cat ~/.pi/agent/keybindings.json
```

Note drift vs. baseline; the README table records what YOU found.

### Task 2: CREATE `scripts/verify-keymap-conflicts.sh`

- Read the 10 defaults from `src/config.ts` (grep the `keys: { … }` block of DEFAULT_CONFIG — parse with grep/sed, no node dependency needed, or use `node -e` if simpler).
- Grep the extension trees + keybindings.md as in Task 1 for each default.
- FAIL (exit 1, print offending key + owner + evidence) if any default is in the avoided/taken list (`ctrl+b`, `ctrl+shift+b`, `ctrl+shift+x`, `ctrl+shift+j`, `shift+down`, `ctrl+shift+s`, `ctrl+shift+w`, `ctrl+m`, `ctrl+shift+f`, `ctrl+shift+up`, `ctrl+shift+down`) OR matches an extension `registerShortcut` accelerator found live.
- PASS with summary table on stdout. Degrade gracefully if keybindings.md unreadable.
- `#!/usr/bin/env bash`, `set -euo pipefail`, `chmod +x`.

### Task 3: CREATE `src/keymap-guard.test.ts`

- Follow `src/no-hardcoded-keys.test.ts` import/style conventions.
- Define `AVOIDED_KEYS` array (the curated list above). Assert `Object.values(DEFAULT_CONFIG.keys).every(k => !AVOIDED_KEYS.includes(k))`, with a per-key message naming the owner/reason. Also assert every default matches `/^([a-z0-9]+\+)*[a-z0-9]+$/` (pi accelerator grammar — see `src/panel/keys.ts:155-168`).

### Task 4: FILL README section

Under `### Keymap conflict re-verification` (create if S1 placeholder missing — then insert under `## Development`), write:

1. One-line summary + verification date + pi version (0.85.1).
2. Verified table (key | default | status | owner/evidence) — three statuses: **panel-safe reuse** (ctrl+d/l/t/s, ctrl+g text-focus — pi built-in exists but panel intercepts first), **free** (ctrl+shift+m/q/e — no binding anywhere), **fixed/nav** (enter/esc/arrows/digits/tab — consumed only inside panel).
3. Avoided keys list with owners.
4. Panel-intercept rationale paragraph (cite `src/panel/keys.ts` intercept-before-forward; breakOut is the only global `registerShortcut` and was verified free).
5. Regression guard: "run `bash scripts/verify-keymap-conflicts.sh` before adding/rebinding any default key; `src/keymap-guard.test.ts` fails CI on collisions."

## Validation Loop

### Level 1: Script & types

```bash
bash scripts/verify-keymap-conflicts.sh && echo PASS   # expect exit 0 + summary table
# Negative test (then revert!):
#   sed -i 's/deep: "ctrl+d"/deep: "ctrl+b"/' src/config.ts && bash scripts/verify-keymap-conflicts.sh  # expect exit 1
#   git checkout -- src/config.ts  (or restore the line)
npm run typecheck
```

### Level 2: Tests

```bash
npx vitest run src/keymap-guard.test.ts -v
npm test   # full suite green — confirms no regression from the new file
```

### Level 3: README consistency

```bash
grep -n "### Keymap conflict re-verification" README.md   # section present
grep -c '^```' README.md   # even (fences closed)
git status --porcelain     # only scripts/verify-keymap-conflicts.sh, src/keymap-guard.test.ts, README.md (+plan/ artifacts)
```

## Final Validation Checklist

- [ ] Live re-verification greps executed; findings (incl. any drift from baseline) recorded in README
- [ ] `scripts/verify-keymap-conflicts.sh` executable, exits 0 now, exits 1 on a planted conflict
- [ ] `src/keymap-guard.test.ts` passes; covers avoided list + accelerator grammar
- [ ] README section: verified table + avoided list + panel-intercept rationale + date + re-run instructions
- [ ] `npm test && npm run typecheck` green
- [ ] No files besides the three deliverables modified; S1's sections untouched

## Anti-Patterns to Avoid

- ❌ Don't copy the planning baseline into README without re-running the greps — the PRD demands build-time re-verification
- ❌ Don't add pi built-ins (ctrl+s/d/l/t/g) to the avoided list — they're intentionally shadowed panel-side
- ❌ Don't write or modify S1's README sections (parallel task)
- ❌ Don't fail the script when keybindings.md is missing — warn and continue
- ❌ Don't modify src/config.ts or any implementation file

---

**Confidence Score**: 9/10 — all verification targets are local files already inspected during this research; the deliverables are a small script, a small test, and a README section with content fully determined by live greps.

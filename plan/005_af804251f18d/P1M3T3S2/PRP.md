---
name: "P1.M3.T3.S2 — Project-structure update and the final `discuss` sweep (Mode B close-out)"
description: "Final documentation close-out of the side-chat changeset (plan/005_af804251f18d): (1) update README.md ## Project structure (~:417, the fenced src/ tree) to reflect the shipped panel/ module set — the contract names +panel/sidechat.ts (singleton engine/lifecycle) and +panel/chat-view.ts (view/render), −panel/discuss.ts (deleted in P1.M2.T7.S1); ALSO add the other new panel modules the tree already contains at HEAD (sidechat-engine.ts, sidechat-prompt.ts, branch-snapshot.ts) for coherence — and refresh the panel/ summary comment line to mention the side-chat view; (2) run the final residual sweep `grep -ri discuss` repo-wide (excluding node_modules/, plan/, .git/): in src/ the ONLY feature-reference occurrence permitted is the coerceKeys alias site in src/config.ts (~:216-224) plus the config.test.ts alias fixtures that MUST type the legacy `keys.discuss` wire name to exercise the alias, plus non-feature English prose ('keep discussing' in sidechat-prompt.ts:120, 'as discussed' in tool-schema.ts:45 and compaction.ts:100 — the architecture dossier pre-classifies these as NOT real mentions); README/docs/marketing prose must be at ZERO (S1's contract delivers a zero-discuss README — verify, don't rewrite); spec/ files keep their historical decision-ledger mentions (decisions.md, implementation-plan.md, architecture.md, ui-spec.md SIDECHAT-001 history — authority record, NOT changeset docs; verify no NEW mentions were introduced by this changeset). Fix anything the sweep finds; if an implementing subtask missed a site, fix it directly if it's a comment/test-name rename, else route back. This subtask VERIFIES and closes — M1/M2 handled all real sites."
---

## Goal

**Feature Goal**: The changeset ships with coherent documentation: the README project-structure tree matches the actual `src/` layout after the side-chat changeset, and the repo-wide `discuss` sweep comes back clean under the permitted-occurrence policy.

**Deliverable**: Edits to `README.md` `## Project structure` (plus any stray fix-ups the sweep finds, e.g. stale comments or test names in src/). No new files, no behavior changes.

**Success Definition**:
- README `## Project structure` tree lists every file that exists under `src/` and `src/panel/` at HEAD, including the new side-chat modules, with accurate one-line descriptions; `panel/discuss.ts` is gone from the tree (and from disk).
- The sweep (`grep -ri discuss --exclude-dir={node_modules,plan,.git} -r .`) yields only the whitelisted occurrences defined below; every other hit is fixed or was already fixed by M1/M2.
- `npm run typecheck` + `npm test` still green if any src file was touched.

## Why

Mode B changeset-level documentation close-out. The changeset deleted `panel/discuss.ts`, added several side-chat modules, and renamed a config key; the README's `## Project structure` section still describes the pre-changeset tree. The architecture dossier (`plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md`, lines 23 and 35) pins this as the final task: the sweep table listed every file that carried `discuss` at HEAD — all were handled by M1/M2 implementing subtasks — so this subtask VERIFIES the final state and closes the loop, fixing stragglers rather than re-doing the sweep.

## What

### (1) README `## Project structure` update (~:417)

Verified state at HEAD: the fenced tree ends with:

```
├── external-editor.ts # external editor handoff
├── depends-on.ts      # question dependency / moot-ness data layer
└── panel/             # the TUI panel: layout, key routing, actions, views
                       # (short / deep / overview), text field, gates, ripple
                       # confirm, suspend widget, terminal budget
```

Do:

- **Confirm `panel/discuss.ts` is absent from the tree AND from disk** (`ls src/panel/discuss.ts` → not found; deleted by P1.M2.T7.S1). If it somehow still exists on disk, that's an M2 regression — STOP and route back rather than deleting source files yourself.
- **Expand the `panel/` entry into a sub-tree** matching the actual directory (`ls src/panel/` at implementation time is the ground truth). The contract names two additions; the directory at HEAD also contains `sidechat-engine.ts`, `sidechat-prompt.ts`, and `branch-snapshot.ts` — a coherent tree lists them all. Suggested shape (verify each file exists; align comment column like the parent tree):

```
└── panel/             # the TUI panel: layout, key routing, actions, views
                       # (short / deep / overview / chat), text field, gates,
                       # ripple confirm, suspend widget, terminal budget
    ├── sidechat.ts         # side-chat singleton store + lifecycle + /clear //new reset
    ├── sidechat-engine.ts  # nested LLM loop: turn dispatch, streaming, abort, usage tally
    ├── sidechat-prompt.ts  # side-chat system prompt builder (question, goal, digest, answer protocol)
    ├── branch-snapshot.ts  # one-shot branch snapshot feeding the side chat's context
    ├── chat-view.ts        # the chat view render module: transcript, footer, confirm row
    ├── ... (keep/condense the pre-existing entries: actions, keys, layout, short/deep/overview views, text-field, gate, ripple-confirm, suspend, terminal-budget, panel, editor-preservation, ac-* tests as currently implied)
```

  - Do NOT list every `*.test.ts` file if the existing tree doesn't (it currently doesn't — keep that convention; the `ac-sidechat.test.ts` / `sidechat-*.test.ts` files stay implicit).
  - One-line descriptions must be accurate — read each file's header JSDoc before writing its line.
- **Update the panel/ summary comment** to include `chat` in the views list (see shape above).

### (2) The final `discuss` sweep

Run:

```bash
grep -ri discuss . --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git -l
# then per-file: grep -rin discuss <file>
```

Classify every hit against this whitelist (verified at HEAD + the dossier's line 23 classification):

**Permitted (leave untouched):**
- `src/config.ts` ~:216-224 — the coerceKeys silent `discuss`→`chat` compat alias (P1.M1.T1.S2). THE sanctioned site per the contract.
- `src/config.test.ts` :257-337 — the alias fixture block: these tests MUST type the literal legacy key `keys.discuss` in settings JSON to exercise the alias (`test_alias_legacy_discuss_feeds_chat_when_new_name_absent` etc.). The legacy wire name is the test's input data; renaming it would break the alias coverage.
- English prose that is NOT about the removed feature: `src/panel/sidechat-prompt.ts:120` ("keep discussing without emitting the block"), `src/tool-schema.ts:45` / `spec/tool-protocol.md:11` ("no 'as discussed'"), `src/compaction.ts:100` ("goals and objectives discussed"), `src/panel/ac-sidechat.test.ts:34-36,512` (comments narrating the successor history — they NAME the deletion, which is the point; leave).
- `spec/` decision-ledger and spec-history mentions: `spec/decisions.md` (Q36, BAREKEYS-001, SIDECHAT-001 entries), `spec/implementation-plan.md:23`, `spec/architecture.md:75,88,176`, `spec/ui-spec.md:84,106,112` ("renamed from `keys.discuss`", "supersedes the old discuss-in-chat handoff"). These are the authority record of WHAT changed — they must keep the history. Verify only that no NEW `discuss` mention was introduced by THIS changeset beyond the SIDECHAT-001 historical notes (the ones quoted above are all historical/renaming context — correct as-is). `spec/SPEC.md:3` and `spec/product-requirements.md:12,19` use "discusses/discussion" as English verbs about the side chat — permitted prose.
- `README.md` — must be ZERO (P1.M3.T3.S1 contract, hard gate `grep -ri discuss README.md` empty). Verify only; if S1's output somehow still contains one, fix it (it's a README edit — your file).

**Must be fixed:**
- Any `discuss` in `README.md` (should be none after S1).
- Any feature reference in src/ outside the whitelist — e.g. stale comments in `panel/panel.ts` (:224-225 setEditorText JSDoc, :326, :941), `keys.ts` rename-era comments, `layout.ts:70`, `suspend.ts:22`, `editor-preservation.ts:32`, `keymap-guard.test.ts:46` — the dossier's sweep table (line 23) says M1/M2 handled all of these; VERIFY by grep. A straggler is a comment/test-title rename → fix it directly (comment-only, per contract §5 "DOCS: none — comment-only"). If a straggler is a functional code path (not a comment/name), do NOT fix — route back to the orchestrator naming the subtask that missed it.
- After any fix: re-run the sweep.

### Success Criteria

- [ ] README `## Project structure` tree matches `ls src/ src/panel/` exactly (no missing, no phantom files); descriptions accurate; `chat` added to the views list.
- [ ] `grep -ri discuss . --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git` — every hit is in the whitelist above; README is zero.
- [ ] `panel/discuss.ts` confirmed absent from disk and tree.
- [ ] If src/ was touched (comment/test-title fixes only): `npm run typecheck && npm test` green.
- [ ] No functional source changes, no spec/plan edits.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact README section and its current shape, the actual panel/ directory contents, the whitelist of permitted `discuss` occurrences with reasons, and the dossier's sweep table. All below, verified at HEAD.

### Documentation & References

```yaml
- file: README.md
  why: THE primary deliverable — ## Project structure fenced tree at ~:417-448 (verified shape quoted in "What"). Follow the existing entry style: "├── name.ts # one-line description" with aligned comment columns.
  gotcha: locate the section by the heading `## Project structure`, not line number (S1 edits shift lines). S1 owns everything ABOVE this section — touch only this section (and any stray discuss straggler it left).

- file: plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md
  why: the dossier — line 23 (residual sweep table + "Final state: discuss may appear ONLY at the coerceKeys alias site in config.ts" + the NOT-real-mentions list: compaction.ts:100, tool-schema.ts:45), line 35 (the :417 row: "+ panel/sidechat.ts, + panel/chat-view.ts; − panel/discuss.ts"). This subtask's charter.
  gotcha: the dossier's line-23 list predates M1/M2 completion — most listed files should ALREADY be clean at implementation time; verify, don't re-sweep-fix.

- file: src/config.ts (~:216-224)
  why: the ONE sanctioned src/ feature mention — coerceKeys silent discuss→chat alias. Read to recognize the site in sweep output.
  gotcha: config.test.ts's literal `keys.discuss` fixtures are functionally required (the legacy key IS the input under test) — treat as permitted despite the strict "only config.ts" wording in the dossier; the intent is "only alias-implementation and alias-coverage sites".

- file: plan/005_af804251f18d/P1M3T3S1/PRP.md
  why: SIBLING CONTRACT — S1 rewrites README's user-facing sections (usage, Side chat section, keymap row, sample JSON, limitations, conflict record) and guarantees grep-zero README. Assume delivered exactly as written; your section is below all of theirs.
  gotcha: do not edit any of S1's seven edit points; if their output contains "discuss", that's a straggler — fix minimally in their spirit.

- cmd: ls src/panel/
  why: ground truth for the tree. Verified at research time: sidechat.ts, sidechat-engine.ts, sidechat-prompt.ts, branch-snapshot.ts, chat-view.ts (+test counterparts), alongside the pre-existing panel modules (panel, actions, keys, layout, short/deep/overview-view, text-field, gate, ripple-confirm, suspend, terminal-budget, editor-preservation, ac-panel/ac-sidechat/keymap-ac tests).
  gotcha: read each new file's header JSDoc before writing its one-liner — descriptions must be accurate, not guessed.
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                      # MODIFY — ## Project structure section only (+ any straggler)
src/panel/                     # read-only ground truth for the tree
src/                           # comment/test-title straggler fixes ONLY if sweep finds them
plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md   # read-only charter
```

### Desired Codebase tree with files to be added and responsibility of file

No files added or deleted. Only content edits (README tree, possible comment stragglers).

### Known Gotchas of our Codebase & Library Quirks

```text
# CRITICAL: exclude node_modules/, plan/, and .git from the sweep — plan/ and
# spec decision ledgers legitimately contain "discuss" (they ARE the record).
# GOTCHA: the sweep is case-insensitive (-i): "Discuss", "DISCUSS" count too.
# GOTCHA: distinguish FEATURE references (keys.discuss, discuss.ts,
# discussInChat, "discuss in chat") from ENGLISH prose ("keep discussing",
# "as discussed", "goals discussed"). Only feature references are violations
# outside the whitelist. The dossier pre-classifies compaction.ts:100 and
# tool-schema.ts:45 as prose — leave.
# GOTCHA: config.test.ts MUST keep typing keys.discuss — it's the alias's
# input fixture; "fixing" it deletes alias coverage (P1.M1.T1.S2's deliverable).
# GOTCHA: README alignment: the existing tree uses aligned "# comment" columns;
# keep the panel/ sub-tree's indentation consistent with the parent (├──/└──).
# GOTCHA: if panel/discuss.ts still EXISTS on disk, an implementing subtask
# (P1.M2.T7.S1) regressed — do not delete source yourself; route back.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY disk state
  - ls src/panel/ | sort  → ground truth list
  - test ! -f src/panel/discuss.ts → must pass (else ROUTE BACK, P1.M2.T7.S1 regression)
  - read header JSDoc of sidechat.ts, sidechat-engine.ts, sidechat-prompt.ts, branch-snapshot.ts, chat-view.ts

Task 2: EDIT README.md ## Project structure
  - EXPAND panel/ into a sub-tree listing every non-test module (contract two + engine/prompt/snapshot for coherence), accurate one-liners
  - UPDATE the panel/ summary comment: views "(short / deep / overview / chat)"
  - CROSS-CHECK the top-level src/ entries against `ls src/*.ts` — add anything the changeset introduced that's missing; remove anything deleted

Task 3: RUN the sweep
  - grep -ri discuss . --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git -n
  - CLASSIFY each hit against the whitelist ("What" §2)
  - FIX stragglers: README prose (should be none after S1); src/ comment/test-title renames
  - RE-RUN until only whitelisted hits remain

Task 4: VERIFY
  - grep -ri discuss README.md → empty
  - npm run typecheck && npm test   (only if Task 3 touched src/)
  - visual diff of the tree vs ls output
```

### Implementation Patterns & Key Details

```text
# The sweep whitelist, one line each (paste into the verification record):
#   src/config.ts:216-224      — coerceKeys alias implementation (sanctioned)
#   src/config.test.ts:257-337 — alias fixtures (legacy wire name = test input)
#   src/panel/sidechat-prompt.ts:120 — prose "keep discussing"
#   src/tool-schema.ts:45, src/compaction.ts:100 — prose "as discussed"/"discussed"
#   src/panel/ac-sidechat.test.ts:34-36,512 — successor-history comments
#   spec/decisions.md, spec/implementation-plan.md, spec/architecture.md,
#   spec/ui-spec.md — decision-ledger history (authority record)
#   spec/SPEC.md:3, spec/product-requirements.md:12,19 — English prose
# Everything else: violation → fix (comment/title) or route back (functional).
```

### Integration Points

```yaml
README: ## Project structure — the only section this task owns (S1 owns the rest).
DOSSIER: architecture/guards-tests-and-docs-surface.md line 35 is the exact
  charter row for this section; line 23 is the sweep contract.
NO source/spec/plan changes beyond comment/title stragglers.
```

## Validation Loop

### Level 1: The sweep gate (the deliverable)

```bash
grep -ri discuss . --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git -n
# EXPECT: only whitelisted lines (config.ts alias, config.test.ts fixtures,
# prose lines, spec/ ledger files). README: zero.
grep -ri discuss README.md   # EXPECT: no output (exit 1)
```

### Level 2: Tree accuracy gate

```bash
# every non-test module in src/ and src/panel/ appears in the README tree
ls src/*.ts | sed 's|src/||;s|\.ts||' | while read m; do grep -q "$m.ts" README.md || echo "MISSING: $m"; done
ls src/panel/*.ts | grep -v test | sed 's|.*panel/||' | while read m; do grep -q "$m" README.md || echo "MISSING: panel/$m"; done
# EXPECT: no MISSING lines (test files exempt per the tree's convention)
```

### Level 3: Build/test gate (if src/ touched)

```bash
npm run typecheck && npm test   # all green
```

### Level 4: Review pass

Read the full `## Project structure` section once: tree renders correctly (code fence intact, box-drawing chars consistent), descriptions read at the same altitude as the pre-existing entries, `chat` appears in the views parenthetical.

## Final Validation Checklist

- [ ] `grep -ri discuss README.md` → zero matches.
- [ ] Repo sweep: only whitelisted occurrences remain; each justified.
- [ ] README tree matches `ls src/ src/panel/` (non-test convention); `panel/discuss.ts` absent from disk and tree.
- [ ] New side-chat modules listed with accurate one-liners; `chat` in the views list.
- [ ] No functional source changes; spec/plan untouched.
- [ ] `npm run typecheck && npm test` green (if anything in src/ was touched).
- [ ] No conflicts with S1's seven README edit points.

## Anti-Patterns to Avoid

- ❌ Don't delete or "clean" the alias in config.ts or its fixtures in config.test.ts — they're the compat deliverable.
- ❌ Don't scrub `spec/` decision-ledger history — it's the authority record, not changeset docs.
- ❌ Don't list test files in the project-structure tree (convention: they're implicit).
- ❌ Don't delete source files if the sweep finds one — route back to the orchestrator.
- ❌ Don't rewrite README sections S1 owns; touch only ## Project structure and genuine stragglers.
- ❌ Don't treat English prose ("discussing", "as discussed") as violations — the sweep is about the removed FEATURE's identifiers and behavior references.

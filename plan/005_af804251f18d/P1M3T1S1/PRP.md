# PRP — P1.M3.T1.S1: Side-chat cache-isolation static guard (SIDECHAT-005)

---
name: "P1.M3.T1.S1 — Clone the no-hardcoded-keys scanner pattern with the banned-API list over the side-chat module set"
description: "Create src/panel/sidechat-cache-isolation.test.ts enforcing SIDECHAT-005 (h2.16 binding contract: the side chat must NEVER touch the main conversation — no model-context mutation APIs). Clone the src/no-hardcoded-keys.test.ts scanner anatomy: stripComments frame-stack scanner (:45-137, string/template-aware, newlines preserved), a TARGETED file set (NOT repo-wide) = the side-chat cluster modules (src/panel/sidechat.ts, chat-view.ts, sidechat-engine.ts, sidechat-prompt.ts — enumerate at implementation time, .test.ts excluded), per-name word-boundary regexes over comment-stripped source with file:line messages for the five banned identifiers: sendMessage, sendUserMessage, setActiveTools, registerTool, setModel (identifier references catch both pi.* and ctx-borne uses). Self-tests: planted-literal-fails, comment-only-passes, string-context pinning. No allowlist carve-out expected."
---

## Goal

**Feature Goal**: SIDECHAT-005 — the binding cache-isolation contract ("the side chat never touches the main conversation") gains a static guard: any commit that introduces a reference to a main-conversation-mutating pi API (`sendMessage`, `sendUserMessage`, `setActiveTools`, `registerTool`, `setModel`) inside the side-chat modules fails the suite with a file:line message.

**Deliverable**: One new test file `src/panel/sidechat-cache-isolation.test.ts` (scanner + targeted scan + self-tests). No production code changes.

**Success Definition**: `npm test` + `npm run typecheck` green; the guard passes on the current clean side-chat modules (enumerated below — verify at implementation time); a planted `sendMessage` reference in a self-test fixture is flagged; comment-only mentions pass; `git diff` shows exactly one new test file.

## User Persona

**Target User**: The maintainer — the guard makes the architecture contract regression-proof rather than convention-reliant.

**Use Case**: A future edit adds "just one" `pi.sendMessage` call inside sidechat.ts to surface something in the main transcript — the suite fails before merge with an exact file:line.

**User Journey**: run `npm test` → guard scans the side-chat modules → clean pass; later, an offending edit → red with `panel/sidechat.ts:123: banned identifier 'sendMessage' (SIDECHAT-005: side chat must not touch the main conversation)`.

**Pain Points Addressed**: SIDECHAT-005 is a BINDING spec contract (h2.16) with no enforcement today; the nested LLM loop runs on an injected seam precisely so these APIs are never needed.

## Why

- Spec h2.16 (Side chat cache-isolation contract, SIDECHAT-005 — binding): the side chat is architecturally forbidden from model-context mutation; the only sanctioned entry to the main conversation is the answer-apply path through the ordinary seams (acceptOptionIndex / write-in commit, landed P1.M2.T6.S1).
- Plan dossier `architecture/guards-tests-and-docs-surface.md` §Cache-isolation guard (R5) gives the exact clone recipe (scanner anatomy, targeted file set, ban list, self-tests, carve-out policy).
- The engine design (P1.M1.T5.S1) deliberately routes all model calls through an injected nested-call seam — so the ban list is exhaustive against the real ExtensionAPI surface for these modules; zero legitimate uses expected.

## What

### File set (targeted, NOT repo-wide)

The side-chat cluster as it exists in the tree (verified today):

```bash
src/panel/sidechat.ts            # singleton store + lifecycle
src/panel/chat-view.ts           # render module
src/panel/sidechat-engine.ts     # nested LLM loop (P1.M1.T5)
src/panel/sidechat-prompt.ts     # system prompt builder (P1.M1.T4)
```

Enumerate at implementation time (the cluster may have grown a non-test helper — include any `src/panel/*sidechat*` / cluster-imported helper module; the spec wording is "side-chat modules … and their non-test helpers"). `.test.ts` files are excluded — other modules' legit uses live in tests and must not false-positive. If the file set is computed dynamically, keep it targeted by explicit module list (mirror how no-hardcoded-keys lists `listSourceFiles(SRC_ROOT)` but narrowed); do NOT scan repo-wide.

### The scanner (clone, do not re-invent)

Copy from `src/no-hardcoded-keys.test.ts`:

- `stripComments(src)` (:45-137) — single-pass char scanner with a frame stack (`'"' | "'" | "`" | "${"`); `//` and `/*…*/` blanked with newlines PRESERVED (accurate line numbers); backslash escapes consumed verbatim; `${` pushes / `}` pops; only the matching delimiter pops a string frame. It is string- and template-aware so comments, URLs (`https://…//…`), and JSDoc tables inside literals never corrupt the scan. Keep it even though identifier matching alone might not need it — a JSDoc comment mentioning `sendMessage` must not trip the guard, and URLs/braces in strings must not desync line counting.
- The file-reading helpers (`fs.readFile`, `path.relative(SRC_ROOT, …)` reporting style, :193-198).

### Detection

```ts
/**
 * SIDECHAT-005 (h2.16, binding): the side chat NEVER touches the main
 * conversation. These identifiers are the model-context-mutating ExtensionAPI
 * surface; an identifier reference catches both `pi.sendMessage(...)` and
 * ctx-borne destructured uses (`const { sendMessage } = ctx`). The side-chat
 * modules run their LLM loop on an injected nested-call seam — there is NO
 * legitimate use; a hit is always a contract violation.
 */
const BANNED_API = [
  "sendMessage",
  "sendUserMessage",
  "setActiveTools",
  "registerTool",
  "setModel",
] as const;

// Per-name, word-boundary, over comment-stripped source, file:line output:
function violationsIn(src: string): string[] {
  const problems: string[] = [];
  for (const name of BANNED_API) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      problems.push(`line ${line}: banned identifier '${name}' (SIDECHAT-005: side chat must not touch the main conversation)`);
    }
  }
  return problems;
}
```

Word boundaries (`\b`) are required: bare substring matching would flag e.g. a `registerToolbar`-style false positive. Note the scan runs over comment-stripped source where STRING CONTENTS ARE PRESERVED — intentional: a prompt string embedding "use sendMessage" is just as much a violation surface to review; if a legitimate string mention ever appears, use the documented carve-out (below), never a silent widening.

### Self-tests (clone the no-hardcoded-keys self-test trio)

1. **Main scan** — iterate the targeted file set; `expect(files.length).toBeGreaterThan(1)` sanity; collect `${relpath}: ${violation}`; `expect(problems).toEqual([])`.
2. **Planted-literal-fails** — `violationsIn(stripComments("await pi.sendMessage(m);"))` non-empty for EACH of the five names; also a destructured form `const { sendMessage } = ctx;` and a property form `pi.setModel(id)` (proves identifier coverage regardless of access shape).
3. **Comment-only-passes** — `violationsIn(stripComments("// sendMessage would be wrong here\nconst x = 1;"))` empty; also `/* registerTool note */ const y = 2;` empty; a comment AND a planted use together still trips.
4. **String/template pinning** (clone the no-hardcoded-keys pins so the scanner itself stays regression-proof): URL-with-`//` inside a string doesn't desync; nested template `` `a ${ cond ? `${x} ("q")` : "y" } b` `` stays balanced; a banned name inside a template interpolation `` `${x}` ``-adjacent comment context behaves per stripComments semantics (banned name IN a live string/interpolation still trips — pin that).

### Carve-out policy

No allowlist carve-out is expected — the modules must be clean. If one becomes genuinely necessary, follow `blankDefaultConfigBlock` (:141-154 in no-hardcoded-keys.test.ts) shape: a narrow, line-bounded blanking helper with a comment documenting WHY, and a self-test proving the carve-out is the block, not the file.

### Out of scope

- The parallel P1.M2.T7.S1 (discuss.ts deletion + residual sweep) touches `src/panel/discuss.ts`/`discuss.test.ts` and wiring — your guard does not scan those files; no interaction. If discuss.ts is already deleted when you implement, fine; either way do not include it in the file set.
- AC-17 scripted coverage is P1.M3.T2.S1; docs is P1.M3.T3.
- Do not modify `src/no-hardcoded-keys.test.ts` (clone, don't share — a shared import would let an edit to one guard silently change the other; both files keeping their own ~90-line scanner is the deliberate pattern).

### Success Criteria

- [ ] New file `src/panel/sidechat-cache-isolation.test.ts`; `npm test` + `npm run typecheck` green.
- [ ] Guard scans exactly the side-chat cluster (non-test); repo-wide modules NOT scanned.
- [ ] All five banned identifiers detected in all three access shapes (pi.*, destructured, property).
- [ ] Comment-only mentions pass; strings/templates don't desync the scanner (pinned).
- [ ] No carve-out present.
- [ ] `git diff` = one new test file.

## All Needed Context

### Context Completeness Check

A fresh implementer has: the exact scanner to clone (with its file:line range and semantics), the exact ban list with rationale, the word-boundary detection code, the self-test matrix, the targeted file set as verified today, and the carve-out policy. Nothing to research beyond confirming the final module list.

### Documentation & References

```yaml
- docfile: plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md
  why: THE dossier — §Cache-isolation guard (R5) clone recipe: scanner anatomy (:45-137 mapping), targeted file set rule, ban list with the pi.*/ctx-borne rationale, self-tests to clone (:193-241), carve-out policy (blankDefaultConfigBlock shape)
  critical: 'File set: targeted … plus any NON-test helper modules the side-chat cluster grows; .test.ts excluded (repo-wide scanning would false-positive)'

- file: src/no-hardcoded-keys.test.ts
  why: THE clone source — stripComments (:45-137), blankDefaultConfigBlock (:141-154, carve-out shape only), main scan + self-tests (:193-241); the reporting style (path.relative + file:line problems[])
  pattern: copy stripComments VERBATIM (it is a tested, regression-pinned scanner); copy the self-test trio structure, swap the violation surface
  gotcha: clone, do NOT import from it — each guard owns its scanner (a shared module would couple the two guards' evolutions)

- file: src/panel/sidechat.ts, src/panel/chat-view.ts, src/panel/sidechat-engine.ts, src/panel/sidechat-prompt.ts
  why: the guard targets; enumerate + verify at implementation time (all four exist today, verified)
  gotcha: sidechat-engine.ts runs the LLM loop on an INJECTED nested-call seam (P1.M1.T5.S1) — if its parameter/type names mention the banned words only in COMMENTS, stripComments already tolerates them

- prd_snapshot: h2.16 (Side chat cache-isolation contract, SIDECHAT-005 — binding), h2.9 (Side chat flow, h3.9), h2.38 (Side chat UI, SIDECHAT-001…005), h2.51 (ephemeral by design), h2.80 (2026-10-15 interrogation — the SIDECHAT rulings)
  why: the contract authority — the guard enforces h2.16 verbatim; the README/docs sweeps (P1.M3.T3) cite the same section

- file: src/panel/discuss.ts (or its absence)
  why: the parallel P1.M2.T7.S1 deletes it — do NOT add it to the file set either way
```

### Current Codebase tree (relevant excerpt)

```bash
src/no-hardcoded-keys.test.ts          # the pattern to clone (241 lines)
src/panel/sidechat.ts                  # guard target
src/panel/chat-view.ts                 # guard target
src/panel/sidechat-engine.ts           # guard target (nested LLM loop)
src/panel/sidechat-prompt.ts           # guard target (system prompt builder)
src/panel/sidechat*.test.ts, chat-view.test.ts   # excluded from the scan
```

### Desired Codebase tree

```bash
src/panel/sidechat-cache-isolation.test.ts   # NEW — scanner + targeted scan + self-tests
```

### Known Gotchas

```ts
// Word-boundary regexes (\b) — substring matching false-positives on
//   longer identifiers (registerToolbar-style).
// stripComments preserves STRING CONTENTS — a banned name inside a live
//   string/interpolation is still flagged (intentional; see carve-out policy).
// The scanner must keep newlines when blanking comments — violation line
//   numbers are computed from the stripped source.
// Clone, never import, the scanner — the two guards evolve independently.
// File set is TARGETED; repo-wide scanning false-positives on every other
//   module's legit pi.sendMessage usage (index.ts, delivery.ts use it freely).
// vitest test files are themselves excluded — a test planting a banned name
//   in a fixture must not fail the MAIN scan (self-tests use violationsIn()
//   directly on fixture strings, not on real files — same as the cloned trio).
```

## Implementation Blueprint

### Data models

None — test-only. `const BANNED_API = [...] as const`; `type Frame` (cloned).

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE src/panel/sidechat-cache-isolation.test.ts — scanner
  - COPY verbatim: stripComments + Frame type from no-hardcoded-keys.test.ts:30-137 (drop MODIFIER_STRING/CTRL_ANYWHERE/SHIFT_TAB — wrong surface for this guard)
  - DO NOT import from no-hardcoded-keys.test.ts (clone contract)
Task 2: ADD the ban list + violationsIn (exact code in What) — word-boundary per-name regexes, file:line messages, SIDECHAT-005 citation in each message
Task 3: ENUMERATE the file set — the four verified modules + re-glob src/panel for side-chat-cluster helpers grown since; explicit list, .test.ts excluded
Task 4: ADD the test quartet — main scan (sanity length check, problems[] toEqual([])), planted-literal-fails (all five names × three access shapes), comment-only-passes (+ combined comment-and-use still trips), string/template pinning (URL //, nested templates, banned-name-in-interpolation trips)
Task 5: VALIDATE — npx vitest run src/panel/sidechat-cache-isolation.test.ts; npm test + npm run typecheck; negative check: temporarily plant `pi.sendMessage` in sidechat.ts, watch it fail, revert
```

### Implementation Patterns & Key Details

Detection code and message format are given verbatim in What. Reporting follows the cloned file: `path.relative(SRC_ROOT, file)` prefix — for this guard SRC_ROOT resolves relative to `src/panel/`, so messages read `sidechat.ts:12: …` (define SRC_ROOT as the panel dir, or the repo src root — pick one and keep messages unambiguous).

### Integration Points

```yaml
SUITE: plain vitest file — no config/registration needed (vitest picks up *.test.ts)
DOWNSTREAM:
  - P1.M3.T2.S2 full-gate sweep runs this guard with the rest of the suite
  - P1.M3.T3 docs: README's side-chat limitations section may cite the guard's existence
CONTRACT: spec h2.16 (binding) is the authority; the guard is enforcement, not definition
DO NOT TOUCH: src/no-hardcoded-keys.test.ts, any production module, spec/
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors (test file typechecks too)
```

### Level 2: Unit Tests (the guard IS the test)

```bash
npx vitest run src/panel/sidechat-cache-isolation.test.ts   # all four tests pass
npm test             # full suite green
```

### Level 3: Negative verification (prove the guard bites)

```bash
# Temporarily append `export const _probe = (pi: { sendMessage(x: unknown): void }) => pi.sendMessage;`
# to src/panel/sidechat.ts, run the guard test — EXPECT a failure naming
# sidechat.ts:<line> 'sendMessage'; then revert. Record the probe in the result.
```

### Level 4: Not applicable — static test-only.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] Negative probe (Level 3) performed and reverted; failure message cites file:line + SIDECHAT-005
- [ ] File set targeted (side-chat cluster, non-test); no repo-wide scan
- [ ] All five banned names detected in pi.*/destructured/property shapes (pinned)
- [ ] Comment-only mentions pass; scanner string/template pins cloned
- [ ] No carve-out; scanner cloned (not imported) from no-hardcoded-keys.test.ts
- [ ] `git diff` = exactly one new file

## Anti-Patterns to Avoid

- ❌ Don't scan repo-wide — every other module legitimately uses sendMessage
- ❌ Don't share/import the scanner — clone it (independent guard evolution)
- ❌ Don't drop stripComments because "identifier matching doesn't need it" — comment mentions must pass and line numbers must stay accurate
- ❌ Don't use substring matching — word boundaries only
- ❌ Don't add a preemptive carve-out — one becomes necessary only with a documented reason
- ❌ Don't modify no-hardcoded-keys.test.ts or any production file

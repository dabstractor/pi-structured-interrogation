# PRP — P1.M1.T1.S3: tool-schema `recommendation` description → spec-verbatim string

## Goal

**Feature Goal**: Replace the status-agnostic preselect claim in the `recommendation` field description of `QuestionSchema` (`src/tool-schema.ts:62`) with the spec-verbatim pinning sentence from h2.19, and pin it byte-exact in `src/tool-schema.test.ts`. This string is agent-visible documentation (it rides the registered tool schema into the model's context) of the caret-pinning behavior shipped by P1.M1.T1.S1.

**Deliverable**: One edited line in `src/tool-schema.ts` + one new `it(...)` string assertion in `src/tool-schema.test.ts`'s `describe("schema exports")` block. Nothing else. [Mode A docs: the description string IS the agent-facing doc — no further docs work.]

**Success Definition**:
- `src/tool-schema.ts:62` reads exactly:
  `recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor" })),`
- The new test asserts that string byte-exact against `QuestionSchema.properties.recommendation.description` and passes
- `npx vitest run src/tool-schema.test.ts src/tool.test.ts` green; full `npm test` + `npm run typecheck` green
- `grep -rn "marked ★ and preselected" src/` returns zero hits

## User Persona

**Target User**: The AI agent that calls `interrogate` — it reads this field description when composing `questions[]` and must know that a `recommendation` is display-only once a question carries an answer.

**Use Case**: The model decides whether to keep sending `recommendation` on re-asks of answered questions; the description tells it the ★ never displaces a recorded answer, so recommending is always safe.

**Pain Points Addressed**: The current string ("marked ★ and preselected") documents the superseded status-agnostic contract (reversed by ANSWER-PIN-001, h2.65) and would mislead the model into believing its recommendation re-seeds the caret on answered questions.

## Why

- ANSWER-PIN-001 (h2.65, 2026-10-04) reverses the status-agnostic ★ preselect contract; h2.65 explicitly rules that "every doc/test asserting status-agnostic preselect … those tests were testing the bug." The schema description is one of those docs.
- S1 ships the runtime behavior (recorded answer owns the caret; ★ preselect only while unanswered). This subtask makes the agent-facing schema state that contract, so the tool's self-description matches what the panel actually does.
- The string is resident agent-facing text visible on every tool registration — a one-line change with permanent documentation value.

## What

Replace the `description` of the `recommendation` field in `QuestionSchema` with the spec-verbatim sentence, then add a byte-exact regression assertion. **Spec-wins protocol**: before pasting, re-read `spec/tool-protocol.md:21` (§Schema). If the spec text differs in ANY byte from the string in this PRP, the SPEC wins — quote it verbatim, never paraphrase. (Verified at research time: spec/tool-protocol.md:21 and plan/003_f8af1c6f6c49/prd_snapshot.md:324 [PRD h2.19] both carry exactly the string below.)

### Success Criteria

- [ ] `src/tool-schema.ts:62` description is byte-identical to: `Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor`
- [ ] New test in `describe("schema exports")` pins that exact string; passes
- [ ] `src/tool.test.ts` h2.24 resident-text suite (byte-identical tool description + ≤120 words) still green — untouched by this change, but verified
- [ ] Full suite + typecheck green
- [ ] Zero occurrences of the old string `marked ★ and preselected` under `src/`

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green. This is a one-string source edit plus one test. Every line reference below was verified against the working tree. An implementing agent needs this PRP plus `src/tool-schema.ts`, `src/tool-schema.test.ts`, and read access to `spec/tool-protocol.md` for the spec-wins check.

### Documentation & References

```yaml
- file: spec/tool-protocol.md
  why: "§Schema (line 21) — the AUTHORITATIVE byte-exact source of the replacement string; re-read before pasting (spec-wins protocol)"
  pattern: "recommendation: Type.Optional(Type.String({ description: \"Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor\" }))"
  gotcha: "Em-dash U+2014 with a space each side; ★ U+2605 followed by semicolon (old string had '★ and'); NO trailing period"

- file: src/tool-schema.ts
  why: "Line 62 — the ONLY line to edit (inside QuestionSchema). Line ~144 JSDoc on QuestionInput.recommendation states validation semantics ('must equal one option value') — accurate, DO NOT touch"
  pattern: "Type.Optional(Type.String({ description: ... })) inline in the Type.Object literal"
  gotcha: "Other descriptions here deliberately differ from PRD h2.19 (goal/epoch/answers amended by later pins) — change ONLY the recommendation description; do not 'normalize' neighbors"

- file: src/tool-schema.test.ts
  why: "describe(\"schema exports\") block at :36-54 — add the string assertion after the rev pass-through test (:51-53). Uses it() + inline expect literals, vitest"
  pattern: "(QuestionSchema as { properties: Record<string, unknown> }).properties — existing cast style"
  gotcha: "TypeBox 1.3.7 verified empirically: Type.Optional(Type.String({description})) hoists description onto the object ({type:'string', description}) — NO anyOf indirection; .properties.recommendation.description reads the string directly"

- file: plan/003_f8af1c6f6c49/P1M1T1S3/research/notes.md
  why: "Verified research: string sources, TypeBox access shape, grep gates, scope boundaries"

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "§Agent-facing-schema — the architecture mandate for this exact change"

- file: plan/003_f8af1c6f6c49/P1M1T1S1/PRP.md
  why: "The pinning contract this string documents (input dependency): recorded answer owns the caret; ★ preselect only while unanswered"

- file: src/tool.test.ts
  why: ":127-129 — the ≤120-word resident agent-facing-text constraint (INTERROGATE_TOOL_DESCRIPTION vs PRD_H2_24_DESCRIPTION); unaffected but must stay green"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── tool-schema.ts        # line 62 = the target; QuestionSchema + OptionSchema + parse layer
├── tool-schema.test.ts   # :36-54 describe("schema exports") — assertion goes here
├── tool.ts               # :464 parameters: InterrogateParams (registration; no edit)
└── tool.test.ts          # h2.24 resident-text suite (no edit; must stay green)
spec/tool-protocol.md     # :21 — authoritative spec string (read-only)
```

### Desired Codebase tree with files to be added

```bash
src/
├── tool-schema.ts        # MODIFIED: line 62 description string only
└── tool-schema.test.ts   # MODIFIED: +1 it() in describe("schema exports")
# No new files. No other file changes.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: byte-exactness is the contract. The string contains:
//   - "★" (U+2605 BLACK STAR) followed by ";" — the OLD string had "★ and"
//   - "—" (U+2014 EM DASH) with one space on EACH side: "unanswered — a recorded"
//   - NO trailing period; ends with "cursor"
// Pasting a paraphrase, ASCII "-", "--", or "*/" damage = implementation failure.

// GOTCHA: do NOT also change the JSDoc at src/tool-schema.ts:~144
// (`/** Recommended option value; must equal one option `value` ... */`) —
// that documents validation semantics (still true), not the preselect claim.

// GOTCHA: plan/001_*, plan/002_* snapshots and plan/003 architecture notes
// still contain the OLD string — they are read-only planning artifacts. Leave them.
// The post-change grep gate scopes to src/ only.

// GOTCHA: vitest 1.x, TypeScript 5, ESM (.js import specifiers). No new imports
// needed for the test — QuestionSchema is already imported in tool-schema.test.ts.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tool-schema.ts (line 62 only)
  - REPLACE: description: "Recommended option value; marked ★ and preselected"
  - WITH (spec-verbatim, re-verify against spec/tool-protocol.md:21 first — SPEC WINS):
      description: "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor"
  - PRESERVE: everything else on the line and in QuestionSchema/OptionSchema/InterrogateParams
  - NO other edits to this file

Task 2: MODIFY src/tool-schema.test.ts — add string pin in describe("schema exports")
  - PLACEMENT: immediately after the "QuestionSchema carries the optional rev pass-through field" it() (:51-53)
  - IMPLEMENT (follow the file's existing cast style):
      it("recommendation description is the ANSWER-PIN-001 spec-verbatim string (h2.19)", () => {
        const rec = (QuestionSchema as { properties: Record<string, { description?: string }> })
          .properties.recommendation;
        expect(rec?.description).toBe(
          "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor",
        );
      });
  - NAMING: sentence-case it() description, matching neighbors
  - GOTCHA: TypeBox 1.3.7 hoists description onto the Optional-wrapped object —
    .properties.recommendation.description works directly (verified; no anyOf hop)
  - NO new imports (QuestionSchema already imported at :6)

Task 3: VALIDATE (see Validation Loop) — no other code exists in this subtask
```

### Implementation Patterns & Key Details

```ts
// The single source edit (src/tool-schema.ts:62, inside QuestionSchema):
// BEFORE (status-agnostic claim — the bug h2.65 supersedes):
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" })),
// AFTER (spec h2.19 verbatim — documents S1's shipped pinning behavior):
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor" })),

// The test pin guards against regression to the dead contract; a future editor
// who "simplifies" the sentence fails the suite. If the spec ever changes the
// sentence, BOTH the source line and this assertion update together (spec wins).
```

### Integration Points

```yaml
TOOL REGISTRATION: none — src/tool.ts:464 already registers `parameters: InterrogateParams`;
  the new description string flows to the model automatically on next registration.
CONFIG: none. DATABASE: none. ROUTES: none. DOCS: none (Mode A — the string IS the doc).
PARALLEL WORK: P1.M1.T1.S2 edits src/panel/{panel,deep-view}.ts + panel tests —
  zero file overlap; no merge-conflict surface.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — expected: zero errors
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/tool-schema.test.ts   # new string pin + all existing rows green
npx vitest run src/tool.test.ts          # h2.24 resident-text suite (≤120-word constraint) green
```

### Level 3: Full Suite & Grep Gates (System Validation)

```bash
npm test                                            # full vitest run — zero failures
grep -rn "marked ★ and preselected" src/            # expected: NO output (zero hits)
grep -rn "preselected only while unanswered" src/    # expected: exactly 2 hits
#   (src/tool-schema.ts:62 + the new test assertion)
```

### Level 4: Spec Conformance (Domain-Specific Validation)

```bash
# Byte-compare the shipped string against the spec source (must print twice, identical):
grep -o '"Recommended option value[^"]*"' spec/tool-protocol.md
grep -o '"Recommended option value[^"]*"' src/tool-schema.ts
# Expected: both print "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor"
# If they differ in any byte: the SPEC string wins — fix src/ and the test to match.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green (including tool-schema.test.ts and tool.test.ts)
- [ ] Level 4 byte-compare identical between spec/tool-protocol.md and src/tool-schema.ts
- [ ] Grep gates: old string 0 hits in src/; new string exactly 2 hits in src/

### Feature Validation

- [ ] All Success Criteria in "What" met
- [ ] Only `src/tool-schema.ts:62` (description string) and the one new `it()` changed — `git diff` shows nothing else
- [ ] Sibling schema descriptions, the :~144 JSDoc, and all planning artifacts untouched
- [ ] Mode A satisfied: the description string is the agent-facing documentation

### Code Quality Validation

- [ ] Follows existing test style (it(), inline literals, existing cast pattern)
- [ ] No new imports, dependencies, or files
- [ ] Em-dash/★ characters preserved byte-exact (not mangled by editor encoding)

## Anti-Patterns to Avoid

- ❌ Don't paraphrase, shorten, or "clean up" the spec sentence — byte-exact is the contract
- ❌ Don't touch any other schema description, the QuestionInput JSDoc, or tool.ts — one string, one test
- ❌ Don't update historical plan snapshots containing the old string — they are read-only records
- ❌ Don't add the assertion outside `describe("schema exports")` or with a new describe block — belong with siblings
- ❌ Don't skip the spec re-read (Level 4): if spec and PRP disagree, SPEC WINS

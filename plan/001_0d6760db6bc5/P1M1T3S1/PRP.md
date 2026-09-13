---
name: "P1.M1.T3.S1 — interrogate schema + action routing + validation"
description: "TypeBox parameter schema, four-action discriminator, and validation for the `interrogate` tool. Pure layer: no state mutation, no UI."
---

## Goal

**Feature Goal**: Create `src/tool-schema.ts` (schema + routing + validation for the `interrogate` tool): the exact TypeBox `InterrogateParams` schema per PRD h2.19, an exported `parseInterrogateParams(args)` that returns a discriminated action union (`upsert` / `read` / `reopen` / `record`), and question-level validation (choice/options uniqueness/recommendation match/non-empty ids) plus question-count caps truncation-with-warning.

**Deliverable**: `src/tool-schema.ts` + `src/tool-schema.test.ts`. Exports:
- `OptionSchema`, `QuestionSchema`, `InterrogateParams` (TypeBox schema objects, per h2.19 verbatim)
- Static types `InterrogateParamsValue`, `ParsedAction` (discriminated union)
- `parseInterrogateParams(args: unknown, config: InterrogatorConfig): ParseResult`

**Success Definition**: All vitest tests pass and `tsc --noEmit` is clean; the four action shapes from h2.20 route deterministically; invalid questions are collected as structured errors (never thrown raw); over-cap question counts truncate with a warning entry, never reject. Downstream items (P1.M1.T3.S2–S5, P1.M2.T3.S1) can consume `parseInterrogateParams` without touching TypeBox.

## User Persona (if applicable)

**Target User**: The AI coding agent calling the `interrogate` tool (primary); the extension developer wiring tool.ts (secondary).

**Use Case**: Every `interrogate` tool call enters through this layer — the agent's raw JSON args are validated, routed to one of four actions, and reduced to a typed object the tool executor switch-cases on.

**User Journey**: Agent sends `{questions: [...], goal, epoch}` → parse validates each question → returns `{action: "upsert", questions, goal, epoch, warnings}` → S2 guards check rev/epoch → merge applies.

**Pain Points Addressed**: Eliminates ambiguity in the four action shapes; keeps validation rules (choice requires options, recommendation must match) in ONE tested place; protects state engine from malformed input.

## Why

- Foundation of the entire `interrogate` tool (P1.M1.T3) — S2–S6 all consume the discriminator this item exports.
- Validation-before-mutation keeps the state engine (state.ts/merge.ts) pure of TypeBox concerns; those modules must never import typebox (architectural boundary, h2.13 spirit).
- Caps enforcement "truncate, never reject" (h2.23) is a hard user requirement (Q27=A) — this item implements it for question count.

## What

1. TypeBox schemas exactly per h2.19 (see Context §PRD excerpt in All Needed Context): `OptionSchema`, `QuestionSchema` (with optional `rev`), `InterrogateParams` (top-level `goal`/`epoch`/`questions`/`reopen`/`answers`). Use `Type` from **bare `typebox`** and `StringEnum` from **`@earendil-works/pi-ai`** for `type: ["choice","text"]` (Google provider compat).
2. `parseInterrogateParams(args, config)`:
   - Coerce/validate against `InterrogateParams` (use typebox's `Value`/`Errors` or `TypeCompiler` from `typebox` — check available exports; fallback: hand-rolled tolerant narrowing like `state.ts` `reviveQuestion`).
   - Route per precedence: **questions (non-empty array) present → `upsert`**; else **answers present → `record`**; else **`reopen === true` → `reopen`**; else **`read`** (includes `{}` and `questions: []`).
   - Per-question validation errors (collected, message-indexed, not first-fail): non-empty `id` and `prompt`; `type: "choice"` requires non-empty `options` with unique `value`s; `recommendation` (when present) must equal one option `value`; `type: "text"` must NOT require options (options allowed but ignored).
   - Caps: if `questions.length > config.caps.questions`, keep the FIRST `caps.questions` questions and add a warning: `questions truncated at N — restructure if essential` (h2.23 tone; exact string in test). **Never reject.**
   - TUI/`answers` note: `answers` action is "non-TUI only, ignored in TUI" — routing returns `record` regardless; the TUI-ignore decision belongs to the executor (S5), NOT this layer. Document this in JSDoc.
3. **JSDoc (Mode A docs)** on `InterrogateParams` describing the four action shapes verbatim from h2.20 — this text is the agent-facing contract source.

### Success Criteria

- [ ] `import { Type } from "typebox"` (NOT `@sinclair/typebox`) and `import { StringEnum } from "@earendil-works/pi-ai"` both resolve under `npm run typecheck`
- [ ] All four h2.20 action shapes route correctly; `{}` and `{questions: []}` → `read`
- [ ] Duplicate option values and bad recommendation produce structured errors identifying the offending question id
- [ ] 50 questions with `caps.questions: 40` → 40 kept + truncation warning, result still `action: "upsert"`
- [ ] `npm test` and `npm run typecheck` pass; no UI/state imports in tool-schema.ts (only type-only imports from state.ts allowed)

## All Needed Context

### Context Completeness Check

An agent with no codebase knowledge gets: the verbatim h2.19 schema (below), the exact import rules, existing module interfaces (`Question`, `InterrogatorConfig`), test conventions, and routing/validation rules. No guessing required.

### Documentation & References

```yaml
- file: src/state.ts
  why: Source of Question/QuestionOption/DependsOn/QuestionAnswer types (field names verbatim h2.17)
  pattern: interface Question { id, title?, prompt, description?, type, options?, recommendation?, group?, gate?, dependsOn?, rev, status, answer? }
  gotcha: import types ONLY (`import type { ... } from "./state.js"`) — do not instantiate state here; use .js ESM suffix

- file: src/config.ts
  why: InterrogatorConfig / CapsConfig consumed for caps.questions; DEFAULT_CONFIG for tests
  pattern: config.caps.questions (number, default 40)

- file: src/merge.ts
  why: DOWNSTREAM consumer (S2 wiring): applyUpsert(state, incoming: Question[]) — do not duplicate its logic
  gotcha: applyUpsert expects full Question[]; parse layer outputs wire-shaped questions (no rev/status synthesis needed for new ids — state.upsertQuestion forces rev 1/open)

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts
  why: Reference for TypeBox tool param schemas (Type.Object / Type.Optional / Type.Array with description strings)
  pattern: registerTool({ parameters: QuestionnaireParams, ... }) — registration is S6, NOT this item

- docfile: plan/001_0d6760db6bc5/architecture/external-deps.md
  why: Dependency rules — bare `typebox` 1.3.7 (pi dep), StringEnum from @earendil-works/pi-ai (Google-compatible enums)

- url: https://github.com/sinclairzx81/typebox (v1 docs)
  why: Type.Object/Optional/Array/Integer/String, Value module for validation/errors
  critical: We use bare package name `typebox` v1.3.7; verify `Value.Check`/`Value.Errors` (or `Errors`/`TypeCompiler`) exist in installed version via node_modules before relying on them; otherwise fall back to tolerant hand-rolled narrowing (state.ts reviveQuestion pattern)

- file: src/state.test.ts, src/merge.test.ts
  why: Test conventions — vitest, colocated src/*.test.ts, describe/it style
  pattern: plain imports from "./state.js" etc., no fixtures needed
```

### Current Codebase tree

```bash
src/
  index.ts        # extension factory (registers nothing yet relevant)
  config.ts       # InterrogatorConfig, loadConfig, DEFAULT_CONFIG
  state.ts        # InterrogationState + types (P1.M1.T2.S1)
  merge.ts        # applyUpsert + transitions (P1.M1.T2.S2)
  *.test.ts       # colocated vitest suites
```

### Desired Codebase tree

```bash
src/
  tool-schema.ts       # NEW — h2.19 schemas, ParsedAction union, parseInterrogateParams
  tool-schema.test.ts  # NEW — routing + validation + caps tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: import { Type } from "typebox" — BARE specifier (pi 0.85.1 dep), NOT @sinclair/typebox
// CRITICAL: import { StringEnum } from "@earendil-works/pi-ai" — required for Google provider enum compat
// ESM: relative imports need .js suffix (see src/merge.ts: import ... from "./state.js")
// typebox v1: verify validation API (Value/Errors/TypeCompiler) exists in installed node_modules/typebox
//   before use — it is a peer/dev dep resolved via jiti; if unavailable, hand-roll narrowing.
// Never throw raw from parseInterrogateParams — collect {path/message} errors so the tool can return isError results (S4/S5 format them).
// Stale rev/epoch guard errors are P1.M1.T3.S2 — this layer only PASSES THROUGH epoch/rev values.
// Truncation order for questions cap: keep the FIRST N in agent-supplied order (stable, predictable).
```

## Implementation Blueprint

### Data models and structure

```ts
// Wire types derived from the TypeBox schema (h2.19 verbatim — see PRD excerpt below)
import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export const OptionSchema = Type.Object({ /* value, label, ramification? */ });
export const QuestionSchema = Type.Object({ /* ..., rev: Type.Optional(Type.Integer(...)) */ });
export const InterrogateParams = Type.Object({ /* goal?, epoch?, questions?, reopen?, answers? */ });
export type InterrogateParamsValue = Static<typeof InterrogateParams>;

/** h2.20 discriminator — consumed by S2–S5 and P1.M2.T3.S1 debug commands. */
export type ParsedAction =
  | { action: "upsert"; goal?: string; epoch?: number; questions: QuestionInput[] }
  | { action: "read" }
  | { action: "reopen" }
  | { action: "record"; epoch?: number; answers: AnswerInput[] };

export interface ParseResult {
  ok: boolean;
  action?: ParsedAction;
  /** Structured validation problems: [{ path: "questions[2].options", message: "duplicate option value \"x\"" }] */
  errors: { path: string; message: string }[];
  /** Non-fatal notices, e.g. caps truncation (h2.23) */
  warnings: string[];
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/tool-schema.ts — schemas
  - IMPLEMENT: OptionSchema, QuestionSchema, InterrogateParams exactly per h2.19 (text reproduced in "What"/PRD; descriptions verbatim from h2.19 including "REQUIRED when updating an existing question: the rev you last saw")
  - USE: Type from "typebox" (bare), StringEnum(["choice","text"]) from "@earendil-works/pi-ai"
  - JSDOC (Mode A): document the four action shapes on InterrogateParams (table from h2.20) — this is the agent-facing contract text
  - NAMING: export names exactly OptionSchema/QuestionSchema/InterrogateParams (h2.19 verbatim)

Task 2: CREATE src/tool-schema.ts — parseInterrogateParams
  - IMPLEMENT: signature parseInterrogateParams(args: unknown, config: InterrogatorConfig): ParseResult
  - ROUTE (precedence): non-empty questions → upsert; answers present → record; reopen===true → reopen; else read
  - VALIDATE per-question (collect ALL errors, tagged with question index+id): non-empty id/prompt; type=choice ⇒ non-empty options with unique values; recommendation ⇒ must equal an option value
  - CAPS: questions.length > config.caps.questions ⇒ truncate to first N + warning "questions truncated at {N} — restructure if essential"; NEVER reject
  - NON-GOALS: no rev/epoch staleness throws (S2), no state mutation, no TUI/mode checks (S5 decides answers-in-TUI ignore)
  - IMPORTS: import type { ... } from "./state.js" if reusing types; import type { InterrogatorConfig } from "./config.js"

Task 3: CREATE src/tool-schema.test.ts
  - FOLLOW pattern: src/state.test.ts (vitest describe/it, DEFAULT_CONFIG import)
  - CASES: each of 4 action shapes incl. {} and {questions: []} → read; precedence when multiple flags present; duplicate option values; recommendation mismatch; empty id; choice without options; text question without options OK; 50-question truncation to 40 + warning + still upsert; malformed args (null, string, wrong types) → ok:false with errors; epoch/rev passthrough on upsert
  - NAMING: test file colocated src/tool-schema.test.ts
```

### Implementation Patterns & Key Details

```ts
// Routing core (pure, deterministic):
function route(v: InterrogateParamsValue): ParsedAction {
  if (Array.isArray(v.questions) && v.questions.length > 0) return { action: "upsert", ... };
  if (Array.isArray(v.answers) && v.answers.length > 0) return { action: "record", ... };
  if (v.reopen === true) return { action: "reopen" };
  return { action: "read" };
}

// Error collection pattern — mirror state.ts tolerant-narrowing spirit:
// never throw on malformed input; accumulate {path, message} and return ok:false.
// Unique option values: new Set(options.map(o => o.value)).size === options.length
// Recommendation check: options.some(o => o.value === recommendation)
```

### Integration Points

```yaml
TYPEBOX:
  - No new dependency: "typebox" already in peerDependencies/devDependencies (package.json)

CONSUMERS (do NOT implement here):
  - P1.M1.T3.S2 stale guards read action.epoch + per-question rev
  - P1.M1.T3.S3 caps engine extends warnings for description/ramification/options/goal
  - P1.M1.T3.S4/S5 executors switch on action.action
  - P1.M1.T3.S6 registers the tool with parameters: InterrogateParams
  - P1.M2.T3.S1 debug commands call parseInterrogateParams directly

EXPORTS (src/index.ts): NOT yet — tool registration (and therefore schema re-export decisions) is S6. Keep exports module-local this item unless index.ts already re-exports config/state; if it does, follow suit.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — must be clean; confirms typebox + StringEnum imports resolve
npx vitest run src/tool-schema.test.ts   # immediate feedback while writing tests
```

### Level 2: Unit Tests

```bash
npm test            # full suite — all existing tests still pass (no regressions to state/merge/config)
npx vitest run src/tool-schema.test.ts -v
```

### Level 3: Integration Testing

Not applicable — pure module, no runtime integration until S6 registers the tool. Optional smoke: `node -e` import check is unnecessary because jiti/typecheck covers it.

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the two critical imports actually resolve in the installed tree:
node -e "import('typebox').then(m => console.log(typeof m.Type))"        # expect: function
node -e "import('@earendil-works/pi-ai').then(m => console.log(typeof m.StringEnum))"  # expect: function
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` — all suites pass, including new tool-schema.test.ts

### Feature Validation

- [ ] All four h2.20 action shapes route per the precedence rule; `{}`/`{questions: []}` → read
- [ ] Structured error collection (choice/options-uniqueness/recommendation/ids), no raw throws
- [ ] Question-count truncation-with-warning works and never rejects
- [ ] InterrogateParams JSDoc documents the four action shapes (Mode A)

### Code Quality Validation

- [ ] No UI imports, no state mutation, no typebox import leaked into state.ts/merge.ts/config.ts
- [ ] Bare `typebox` + `@earendil-works/pi-ai` StringEnum only (no @sinclair/*)
- [ ] ESM `.js` suffixes on relative imports; colocated test file

### Documentation & Deployment

- [ ] JSDoc on InterrogateParams covers the four action shapes and caps-truncation behavior
- [ ] No new dependencies, no config changes

---

## Anti-Patterns to Avoid

- ❌ Don't install `@sinclair/typebox` or import from it — bare `typebox` only
- ❌ Don't implement rev/epoch stale guards here (S2) or the full caps engine here (S3)
- ❌ Don't throw on invalid input — collect errors; the tool result layer decides isError formatting
- ❌ Don't reject over-cap batches — truncate with warning (h2.23: "Never a hard reject")
- ❌ Don't decide TUI-vs-non-TUI `answers` handling here — routing only; executor (S5) ignores answers in TUI
- ❌ Don't synthesize rev/status for new questions — state.ts/merge.ts own that

## Appendix — h2.19 schema (verbatim, transcribe descriptions exactly)

```ts
const OptionSchema = Type.Object({
  value: Type.String({ description: "Option value returned when selected" }),
  label: Type.String({ description: "One-line display label (short form)" }),
  ramification: Type.Optional(Type.String({ description: "Deep-view text: consequences, blast radius" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable identity you choose; never reuse for a different question" }),
  title: Type.Optional(Type.String({ description: "Short label used in digests and overview" })),
  prompt: Type.String({ description: "Short-form question text shown by default" }),
  description: Type.Optional(Type.String({ description: "Long-form context; first sentence shows as a hint in short form" })),
  type: StringEnum(["choice", "text"]),
  options: Type.Optional(Type.Array(OptionSchema, { description: "Required for type=choice" })),
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" })),
  group: Type.Optional(Type.String({ description: "Grouping label; groups render as sections" })),
  gate: Type.Optional(Type.Boolean({ description: "Mark this question's group as the foundational gate group" })),
  dependsOn: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ description: "Question this one depends on" }),
    equals: Type.Optional(Type.String()),
    notEquals: Type.Optional(Type.String()),
  }), { description: "Moot conditions evaluated locally as the user answers" })),
  rev: Type.Optional(Type.Integer({ description: "REQUIRED when updating an existing question: the rev you last saw" })),
});

const InterrogateParams = Type.Object({
  goal: Type.Optional(Type.String({ description: "What these questions drive toward; shown in the panel header" })),
  epoch: Type.Optional(Type.Integer({ description: "REQUIRED with questions/answers: the session epoch you last saw (guards stale updates)" })),
  questions: Type.Optional(Type.Array(QuestionSchema, { description: "Upsert. Omitting an existing id withdraws it" })),
  reopen: Type.Optional(Type.Boolean({ description: "Resurface the panel with existing state" })),
  answers: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), value: Type.String(), text: Type.Optional(Type.String()),
  }), { description: "Non-TUI fallback only: record the user's chat answers" })),
});
```

Action table (h2.20): `{questions:[...], goal?}` → upsert; `{}` → read; `{reopen:true}` → resurface; `{answers:[...]}` → record (non-TUI only; ignored in TUI).

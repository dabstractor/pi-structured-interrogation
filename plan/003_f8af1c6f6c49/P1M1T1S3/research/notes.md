# Research notes — P1.M1.T1.S3 (tool-schema recommendation description → spec-verbatim)

Verified against working tree, 2026-10-05. All line refs checked live.

## 1. The target line (verified)

`src/tool-schema.ts:62` (inside `QuestionSchema`, the only hit in `src/`):

```ts
recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" })),
```

This is the status-agnostic preselect claim that ANSWER-PIN-001 (h2.65, 2026-10-04) supersedes.

## 2. The spec-verbatim replacement string (verified in TWO authoritative sources)

- `spec/tool-protocol.md:21` (§Schema block):
  `recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor" })),`
- `plan/003_f8af1c6f6c49/prd_snapshot.md:324` (merged PRD h2.19): identical string.
- Selected PRD content h2.19 in the task prompt: identical string.

Byte-exactness notes: em-dash `—` (U+2014) with a space on each side; `★` (U+2605)
followed by `;` (the old string had `★ and`); NO trailing period; ends `...owns the cursor`.

## 3. Test landscape (verified)

- `src/tool-schema.test.ts` (451 lines): `describe("schema exports")` at :36-54 asserts
  structure only (`OptionSchema`/`QuestionSchema`/`InterrogateParams` defined; property
  key sets). **NO string assertion on any schema field description exists** — the task's
  "update string assertions" means ADD the spec-verbatim pin. `grep -n "description"
  src/tool-schema.test.ts` → zero matches.
- The ≤120-word resident-text constraint lives in `src/tool.test.ts:127-129`
  (`INTERROGATE_TOOL_DESCRIPTION` byte-identical to `PRD_H2_24_DESCRIPTION` + word
  count ≤ 120 via `.trim().split(/\s+/).length`). Our change does not touch that string;
  the suite must simply stay green.
- No snapshot tests of the schema; no meta-test iterating descriptions; `scripts/` has
  nothing pinning the string (demo-deep-selection.ts mentions ★ only in demo prose).

## 4. TypeBox 1.3.7 access shape (verified empirically with node)

`Type.Optional(Type.String({ description }))` produces `{ type: "string", description }`
— description is hoisted onto the wrapped object, NO `anyOf` indirection. So
`QuestionSchema.properties.recommendation.description` yields the string directly.
Existing tests already cast: `(QuestionSchema as { properties: Record<string, unknown> }).properties`.

## 5. Scope boundaries / conflicts

- Old string `"marked ★ and preselected"` exists in CODE only at tool-schema.ts:62.
  Other hits (plan/001_*/, plan/002_*/ snapshots, plan/003 architecture note) are
  read-only planning artifacts — do not touch.
- `src/tool-schema.ts:~144` JSDoc `/** Recommended option value; must equal one option
  \`value\` for choice questions. */` on `QuestionInput.recommendation` states VALIDATION
  semantics, not the preselect claim — accurate, stays as-is.
- Other schema descriptions that differ from PRD h2.19 (e.g., `goal` carries extra
  updatable/caps text; `epoch`/`answers[].custom` were amended by later pins) are
  DELIBERATE — out of scope; change ONLY the recommendation description.
- S2 (parallel): touches `src/panel/panel.ts`, `src/panel/deep-view.ts`,
  `src/panel/actions.test.ts`, `src/panel/panel.test.ts` — zero file overlap with S3.
- S1 (input contract): `initialCursorIndex` pinning — behavior this string documents.

## 6. Validation commands (verified in package.json)

- `npm test` → `vitest run`
- `npm run typecheck` → `tsc --noEmit`
- Targeted: `npx vitest run src/tool-schema.test.ts src/tool.test.ts`

## 7. Post-change grep gate

`grep -rn "marked ★ and preselected" src/` → must return zero hits.
`grep -rn "preselected only while unanswered" src/` → exactly 2 hits
(tool-schema.ts:62 + the new test assertion).

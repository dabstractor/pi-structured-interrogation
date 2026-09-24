# PRP — P1.M1.T1.S1: Add `custom?: true` to AnswerInput, QuestionAnswer, and the state commit path

## Goal

**Feature Goal**: Implement FR-D3 / spec h2.42 (WRITEIN-001) at the data layer: an optional `custom` marker on answers marking a WRITE-IN whose `value` holds the user's free text (never checked against option lists). The field must round-trip through the typebox tool schema, the `narrowAnswer` parse path, `applyAnswer`, and `reviveQuestion` (reconstruction).

**Deliverable**: Modified `src/tool-schema.ts` (schema + AnswerInput + narrowAnswer), `src/state.ts` (QuestionAnswer + reviveQuestion), `src/fallback.ts` (recordAnswers carry-through), plus tests in `src/state.test.ts` and `src/tool-schema.test.ts`.

**Success Definition**:
- `npm run typecheck` and full vitest suite green (all existing tests + new ones)
- `{id, value: "my own text", custom: true}` survives: parse → recordAnswers → applyAnswer → `serialize()` → `deserialize(reviveQuestion)` with `custom === true`
- Answers without `custom` are byte-identical to before (no serialization-shape change)
- Downstream consumers (P1.M1.T2 display, P1.M2.T2 write-in commit, P2.M1.T3 bridge parity) can rely on `q.answer.custom`

## Why

WRITEIN-001 (spec h2.42 + core commitment 6): every choice question ends in a synthetic "✎ Other — write your own" row whose committed text IS the answer. Nothing can build on that until the answer shape can *carry* the marker — this is the leaf subtask everything else in P1/P2 consumes. No `custom` concept exists anywhere in the codebase today (verified by audit: `grep custom src/state.ts` hits only an unrelated docblock about "persisted custom entries").

## What

1. `QuestionAnswer` (src/state.ts:42–49): add `custom?: boolean`
2. `AnswerInput` (src/tool-schema.ts:156): add `custom?: boolean`
3. Typebox schema `answers` items (src/tool-schema.ts:118): add `custom: Type.Optional(Type.Boolean())` with WRITEIN-001 description
4. `narrowAnswer` (src/tool-schema.ts:494–515): tolerant pass-through — `if (raw.custom !== undefined) { typeof raw.custom === "boolean" ? a.custom = raw.custom : errors.push(...) }` (mirror the existing `text` handling exactly)
5. `reviveQuestion` (src/state.ts:557–563): `if (value.answer.custom === true) answer.custom = true;` (strict true — legacy payloads without the field deserialize identically)
6. `recordAnswers` (src/fallback.ts:246): `if (answer.custom !== undefined) applied.custom = answer.custom;` (mirror the `text` line)
7. `applyAnswer` (src/state.ts:354) needs NO change — it spreads `{ ...answer }` wholesale; verify with a test
8. JSDoc [Mode A] on the new field in both files: "WRITEIN-001: value holds free text, not an option value; renders as ✎ {text}. Not checked against option lists anywhere downstream."

### Success Criteria

- [ ] All 6 code changes above in place, `applyAnswer` untouched (verified by test)
- [ ] Round-trip test: schema parse → applyAnswer → serialize → revive keeps `custom: true`
- [ ] Legacy tolerance: answers without `custom` deserialize to objects with NO `custom` key (`'custom' in answer === false`, not `custom: undefined`-vs-absent ambiguity — use `toEqual` without the key)
- [ ] `narrowAnswer` rejects `custom: "yes"` with a type error at `answers[i].custom`
- [ ] No option-list validation added for custom answers anywhere

## All Needed Context

### Context Completeness Check

Repo is fully implemented (930+ green tests). This is a surgical additive typing change with exact line references verified against the working tree; an agent needs only this PRP plus the named files.

### Documentation & References

```yaml
- file: plan/002_949db554a811/architecture/state-display-seams.md
  why: "THE research doc for this delta. Documents every seam (lines 33-34, 58): no custom concept exists; exact insertion strategy for schema/AnswerInput/narrowAnswer/reviveQuestion"
  gotcha: "Line 34: reviveQuestion MUST carry the field or reconstruction silently drops it"

- file: src/tool-schema.ts
  why: "schema object at :118 (answers items — add custom next to text), AnswerInput interface at :156, narrowAnswer at :494-515 (text pattern at :510-513 to mirror)"
  pattern: "tolerant narrowing: check !== undefined, typeof-check, push {path, message} to errors on bad type"

- file: src/state.ts
  why: "QuestionAnswer interface at :42-49, applyAnswer at :354 (spreads { ...answer } — no change needed), reviveQuestion answer rebuild at :557-563 (add custom === true check after the text check)"
  pattern: "reviveQuestion style: field-by-field typeof guards, only set when present"

- file: src/fallback.ts
  why: "recordAnswers at :223-252; the applied: QuestionAnswer build at :246-247 (mirror the text line for custom)"
  gotcha: "terminal-status skip (BUG-012) and unknown buckets come BEFORE applyAnswer — do not touch that logic"

- file: src/state.test.ts
  why: "test conventions; describe('applyAnswer') at :163 shows { value, text, at } literal style"
  pattern: "toEqual for exact-shape assertions (key-absence matters)"

- file: src/tool-schema.test.ts
  why: "narrowAnswer/parse test conventions for the rejection case"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── state.ts          # QuestionAnswer, applyAnswer, reviveQuestion — MODIFY
├── tool-schema.ts    # schema, AnswerInput, narrowAnswer — MODIFY
├── fallback.ts       # recordAnswers carry-through — MODIFY (1 line)
├── state.test.ts     # ADD round-trip/applyAnswer tests
├── tool-schema.test.ts # ADD narrowAnswer custom tests
└── ... (snapshots/delivery/renderers/display — P1.M1.T2's job, NOT here)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: applyAnswer (state.ts:354) does `q.answer = { ...answer }` — the
//   spread carries custom automatically. Do NOT add explicit field handling there;
//   just add a regression test proving it.
// GOTCHA: reviveQuestion must check `=== true` strictly, not truthiness, so
//   corrupt `custom: "yes"` in a persisted mirror doesn't leak into state.
// GOTCHA: serialization shape must not gain `custom: undefined` keys for legacy
//   answers — applyAnswer spread only includes the key when the caller set it.
// GOTCHA: answerSignature (snapshots.ts:111-115) is `${value}\0${text}` — a
//   custom boolean alone does NOT change the diff signature. That is correct:
//   a write-in always changes `value` anyway. Do NOT touch snapshots.ts here
//   (display seams are P1.M1.T2).
// GOTCHA: the typebox schema answers items (tool-schema.ts:118) is an inline
//   Type.Object — not a named AnswerSchema export. Add the field inline.
// GOTCHA: value for write-ins is user free text; narrowAnswer's existing
//   non-empty value check stays (write-ins can't be empty strings).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tool-schema.ts — typebox schema (line ~118)
  - ADD inside the answers items Type.Object, after text:
      custom: Type.Optional(Type.Boolean({ description: "WRITEIN-001: marks a write-in — value holds the user's free text (not an option value); renders as ✎ {text}" }))

Task 2: MODIFY src/tool-schema.ts — AnswerInput interface (line ~156)
  - ADD after text?: string;:
      /** WRITEIN-001: value holds free text, not an option value; renders as ✎ {text}. */
      custom?: boolean;

Task 3: MODIFY src/tool-schema.ts — narrowAnswer (line ~510)
  - MIRROR the text handling immediately after it:
      if (raw.custom !== undefined) {
        if (typeof raw.custom === "boolean") a.custom = raw.custom;
        else errors.push({ path: `${path}.custom`, message: "custom must be a boolean" });
      }

Task 4: MODIFY src/state.ts — QuestionAnswer interface (line ~49)
  - ADD after text?: string;:
      /** WRITEIN-001: value holds free text, not an option value; renders as ✎ {text}. */
      custom?: boolean;

Task 5: MODIFY src/state.ts — reviveQuestion (line ~561, after the text check)
  - ADD: if (value.answer.custom === true) answer.custom = true;

Task 6: MODIFY src/fallback.ts — recordAnswers (line ~247, after the text line)
  - ADD: if (answer.custom !== undefined) applied.custom = answer.custom;

Task 7: ADD tests — src/tool-schema.test.ts (describe "narrowAnswer custom")
  - CASES: custom:true parsed through; custom absent → no key (toEqual exact);
    custom:"yes" → error path answers[i].custom; custom:false preserved as false

Task 8: ADD tests — src/state.test.ts (describe "custom answers")
  - CASES:
    1. applyAnswer({value, custom:true, at}) → getQuestion().answer.custom === true,
       serialize() carries it, 'changed' emitted
    2. round-trip: serialize → deserialize → answer.custom === true (reviveQuestion)
    3. legacy: applyAnswer({value, at}) → serialize → deserialize → answer has NO
       custom key (toEqual without it)
    4. recordAnswers path (via fallback.test.ts if that's where answers[] tests
       live — otherwise direct applyAnswer covers it): custom carried to state

Task 9: RUN npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// narrowAnswer tolerant pattern to mirror (tool-schema.ts :510-513):
if (raw.text !== undefined) {
  if (typeof raw.text === "string") a.text = raw.text;
  else errors.push({ path: `${path}.text`, message: "text must be a string" });
}
// custom follows byte-for-byte with "boolean"/"custom must be a boolean".

// reviveQuestion strict-true (state.ts :557-563):
const answer: QuestionAnswer = { value: value.answer.value, at: value.answer.at };
if (typeof value.answer.text === "string") answer.text = value.answer.text;
if (value.answer.custom === true) answer.custom = true;  // ADD — strict true
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors — proves every QuestionAnswer/AnswerInput
                    # construction site still compiles with the optional field
```

### Level 2: Unit Tests

```bash
npx vitest run src/state.test.ts src/tool-schema.test.ts   # focused
npm test                                                    # full suite green
```

### Level 3: Regression sweep (downstream consumers must be untouched)

```bash
npx vitest run src/fallback.test.ts src/snapshots.test.ts src/delivery.test.ts src/renderers.test.ts
# All green WITHOUT modifying those modules — the optional field is additive.
```

### Level 4: Load smoke (optional)

```bash
pi -e src/index.ts   # extension loads; nothing calls custom yet
```

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] custom round-trips: schema → state → serialize → revive
- [ ] Legacy answers deserialize without the key (exact-shape toEqual)
- [ ] applyAnswer body untouched (spread carries custom) — proven by test
- [ ] No option-list validation anywhere for custom values
- [ ] No changes to snapshots.ts, delivery.ts, renderers.ts, panel/* (P1.M1.T2+)
- [ ] JSDoc WRITEIN-001 note present on the field in tool-schema.ts and state.ts

## Anti-Patterns to Avoid

- ❌ Don't touch applyAnswer's body — the `{ ...answer }` spread already carries it
- ❌ Don't use truthiness in reviveQuestion (`custom === true` only)
- ❌ Don't add `custom: undefined` keys on legacy paths (shape must stay byte-identical)
- ❌ Don't render ✎ anywhere in this subtask — display is P1.M1.T2
- ❌ Don't validate write-in values against option lists, here or anywhere
- ❌ Don't touch answerSignature/diff logic (snapshots.ts)

---

**Confidence Score**: 9/10 — purely additive optional field, every insertion point verified with exact line numbers, tolerant-parse pattern exists to copy verbatim, and the seams doc (state-display-seams.md) confirms the audit. Only mild risk: an unknown construction site asserting exact answer shapes — covered by the full-suite gate.

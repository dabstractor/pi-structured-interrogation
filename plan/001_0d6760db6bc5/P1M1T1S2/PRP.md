# PRP — P1.M1.T1.S2: config.ts — defaults, settings load, deep-merge

## Goal

**Feature Goal**: A self-contained `src/config.ts` module exporting `InterrogatorConfig`, `loadConfig(cwd)`, and `resolveKeyLabels(config)` — the single source of truth for every hotkey, cap, and toggle in the extension, loaded by manually reading pi's settings files (no ctx.settings API exists) and deep-merging project over global over defaults.

**Deliverable**: `src/config.ts` + `src/config.test.ts` passing typecheck and vitest. No wiring into index.ts yet (consumers arrive in later subtasks).

**Success Definition**:
- `npm run typecheck` → zero errors
- `npm test` → all config tests pass (defaults, merge precedence, tolerance, labels)
- A small manual script confirms reading real `~/.pi/agent/settings.json` yields defaults when no `interrogator` key is present

## Why

Everything user-visible and every cap flows from config: tool caps engine (P1.M1.T3.S3), panel key dispatch (P1.M3.T3.S1), footer/widget/dialog labels (P1.M3.T1.S2, P1.M6.T1.S1), round detection toggle (P1.M7.T4.S1), README config reference (P1.M7.T7.S1). PRD h2.52 mandates: every display string naming a key is generated from the resolved config — never hardcoded.

## What

- `src/config.ts` exports:
  - `type InterrogatorConfig` (with nested `keys`, `caps`, toggles, `editorMode`)
  - `DEFAULT_CONFIG: InterrogatorConfig` — verbatim from PRD h2.52
  - `async function loadConfig(cwd: string): Promise<InterrogatorConfig>` — reads `~/.pi/agent/settings.json` then `<cwd>/.pi/settings.json`, deep-merges project over global over defaults, extracts the `"interrogator"` key. Tolerant: missing files, malformed JSON, non-object values, missing keys → contribute nothing. NEVER throws.
  - `function resolveKeyLabels(config: InterrogatorConfig): Record<ActionName, string>` — display labels for every `config.keys.*` entry.
  - Full JSDoc on `loadConfig` (and on the type) documenting EVERY config key = the config reference source of truth for the README (Mode A docs, P1.M7.T7.S1).
- `src/config.test.ts` — vitest unit tests using temp directories.

### Success Criteria

- [ ] All h2.52 defaults exported verbatim (10 keys, 6 caps, 3 toggles, editorMode "composed")
- [ ] Deep merge: project `{"interrogator":{"caps":{"description":2000}}}` overrides only that nested field; all other defaults survive
- [ ] Project settings win over global settings; global over defaults
- [ ] Malformed JSON / missing file / non-object `"interrogator"` value / array value → defaults survive, no throw
- [ ] `resolveKeyLabels` returns a label for every action in `keys`, derived from the resolved (possibly rebound) config
- [ ] Typecheck + tests green

## All Needed Context

### Context Completeness Check

Greenfield repo; scaffold (package.json, tsconfig, vitest config, src/index.ts) arrives from P1.M1.T1.S1 exactly as its PRP specifies. This PRP contains the full config schema, the exact load pattern, and test approach — no prior knowledge needed.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/P1M1T1S2/research/notes.md
  why: condensed research — exports verification, file-injector pattern line refs, h2.52 defaults
  critical: getAgentDir + CONFIG_DIR_NAME are named exports of @earendil-works/pi-coding-agent (verified in dist/index.d.ts)

- file: /home/dustin/projects/pi-file-injector/file-injector.ts (lines 307–356)
  why: THE precedent for reading pi settings manually (tryReadNamespaced pattern, SETTINGS_KEY extraction, try/catch → {})
  pattern: tryReadNamespaced(p): JSON.parse → object guard (not null/array) → take key sub-object with same guard → {} on any failure
  gotcha: that code uses SHALLOW spread merge; our PRD (h2.18) requires DEEP merge — do not copy the spread verbatim for the merge step

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md (§Mismatch 4)
  why: documents there is NO ctx.settings API — manual fs read is the sanctioned approach

- file: plan/001_0d6760db6bc5/architecture/system-context.md (§Module layout, config.ts line)
  why: placement and responsibility of this module in the architecture

- docfile: PRD h2.52 (verbatim config reference), h2.18, h2.34, h2.23 — reproduced in full below

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md
  why: settings.json semantics (open-schema, deep-merged by pi itself for its own keys)
```

**h2.52 config reference (AUTHORITATIVE defaults — copy verbatim):**
```jsonc
{
  "keys": { "deep": "ctrl+d", "overview": "ctrl+l", "focusText": "ctrl+t",
            "batchNote": "ctrl+shift+m", "submit": "ctrl+s", "breakOut": "ctrl+shift+q",
            "discuss": "ctrl+shift+e", "externalEditor": "ctrl+g",
            "prevQuestion": "tab", "nextQuestion": "shift+tab" },
  "caps": { "description": 1200, "ramification": 600, "options": 7,
            "questions": 40, "goal": 400, "contextBudgetPct": 4 },
  "gateWarnings": true, "roundDetection": true, "digitQuickSelect": true,
  "editorMode": "composed"
}
```

### Current Codebase tree (after P1.M1.T1.S1 lands)

```bash
pi-structured-interrogation/
├── package.json / tsconfig.json / vitest.config.ts
├── src/
│   └── index.ts        # factory + interrogate-ping stub (do not modify)
├── plan/  spec/  .pi/  .envrc  .gitignore
```

### Desired Codebase tree

```bash
src/
├── index.ts            # unchanged this subtask
├── config.ts           # NEW: InterrogatorConfig, DEFAULT_CONFIG, loadConfig, resolveKeyLabels
└── config.test.ts      # NEW: vitest unit tests (temp-dir fixtures)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: there is NO ctx.settings API — manual fs read is required (pi-api-validation.md Mismatch 4).
// CRITICAL: getAgentDir() and CONFIG_DIR_NAME are named exports of "@earendil-works/pi-coding-agent" (verified dist/index.d.ts).
//   Project settings path is path.join(cwd, CONFIG_DIR_NAME, "settings.json") — do not hardcode ".pi".
// GOTCHA: use node:fs/promises readFile + JSON.parse; JSON.parse is `any` — narrow with an
//   object guard (typeof "object", not null, !Array.isArray) BEFORE casting, file-injector pattern lines 340–342.
// GOTCHA: deep-merge must recurse only into PLAIN OBJECTS; config schema has no arrays —
//   anything non-object replaces wholesale. Cap values may arrive as strings from JSON
//   ("description": "2000") — coerce numbers via Number() when field is numeric, defaulting to the
//   default value if the result is NaN. (Tolerant, never throw.)
// GOTCHA: vitest tests must NOT read the real ~/.pi — inject paths. Make loadConfig take
//   explicit paths OR accept an optional overrides param; see test strategy below.
// GOTCHA: runtime is jiti TS — no build step; keep imports to node builtins + pi package types only.
```

## Implementation Blueprint

### Data models and structure

```ts
import type {} from "@earendil-works/pi-coding-agent"; // getAgentDir, CONFIG_DIR_NAME at runtime

export type EditorMode = "composed" | "stock";

export type KeyAction =
  | "deep" | "overview" | "focusText" | "batchNote" | "submit" | "breakOut"
  | "discuss" | "externalEditor" | "prevQuestion" | "nextQuestion";

export interface InterrogatorConfig {
  keys: Record<KeyAction, string>;       // accelerator strings, pi lowercase form "ctrl+shift+q"
  caps: {
    description: number; ramification: number; options: number;
    questions: number; goal: number; contextBudgetPct: number;
  };
  gateWarnings: boolean;
  roundDetection: boolean;
  digitQuickSelect: boolean;
  editorMode: EditorMode;
}

export const DEFAULT_CONFIG: InterrogatorConfig = { /* h2.52 verbatim, editorMode: "composed" */ };

export async function loadConfig(cwd: string): Promise<InterrogatorConfig>;
export function resolveKeyLabels(config: InterrogatorConfig): Record<KeyAction, string>;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/config.ts — types + defaults
  - IMPLEMENT: KeyAction, EditorMode, InterrogatorConfig, DEFAULT_CONFIG (h2.52 VERBATIM)
  - NAMING: exported PascalCase types/constants; file at src/config.ts
  - JSDOC on DEFAULT_CONFIG/InterrogatorConfig documenting EVERY key (defaults, meaning, consumer)
    — this is the README config reference source of truth (P1.M7.T7.S1, Mode A docs)

Task 2: IMPLEMENT deepMerge + tolerant read in src/config.ts
  - deepMerge(base, override): plain-object recursion; non-object overrides replace; returns new object (no mutation)
  - tryReadInterrogator(p: string): Promise<Partial<InterrogatorConfig>> — file-injector
    tryReadNamespaced pattern: try { readFile → trim || "{}" → JSON.parse → object guard →
    take "interrogator" key → object guard → return } catch { return {} }

Task 3: IMPLEMENT loadConfig(cwd)
  - global = tryReadInterrogator(path.join(getAgentDir(), "settings.json"))
  - project = tryReadInterrogator(path.join(cwd, CONFIG_DIR_NAME, "settings.json"))
  - return deepMerge(deepMerge(DEFAULT_CONFIG, global), project)
  - Apply numeric coercion for caps fields and boolean coercion for toggles (bad values → defaults)
  - FULL JSDoc: file precedence, key reference, tolerance guarantees, consumers list
  - Never throws on any filesystem/parse/shape error

Task 4: IMPLEMENT resolveKeyLabels(config)
  - For each KeyAction, produce a display label from config.keys[action]
  - Normalization: "ctrl+shift+q" → "Ctrl+Shift+Q"; "tab" → "Tab"; "shift+tab" → "Shift+Tab"
    (split on "+", trim, lowercase→capitalize each token; special-case "ctrl"→"Ctrl" is just capitalize)
  - Purpose: footer/widget/dialogs NEVER hardcode a key label (h2.52 last line)
  - JSDoc notes consumers: panel footer (P1.M3.T1.S2), widget (P1.M6.T1.S1), dialogs

Task 5: CREATE src/config.test.ts (vitest)
  - Since loadConfig calls getAgentDir() (real home dir), make the settings PATHS injectable for tests:
    either export internal `loadConfigFrom(paths: {global?: string; project?: string})` used by loadConfig,
    or accept an optional second param. Prefer the exported-internal approach; loadConfig delegates.
  - TESTS (fixtures written to os.tmpdir() via fs.mkdtemp, cleaned up in afterEach):
    1. no files anywhere → DEFAULT_CONFIG returned exactly
    2. global-only override: {"interrogator":{"keys":{"submit":"ctrl+enter"}}} → only keys.submit changes
    3. deep merge: project overrides caps.description only; global keys override survives
    4. precedence: same key in global+project → project wins
    5. malformed JSON file → defaults survive (no throw)
    6. "interrogator" key present but array / string / null → defaults survive
    7. file exists but no "interrogator" key → defaults
    8. numeric-as-string cap: {"caps":{"description":"2000"}} → 2000 (number)
    9. NaN-ish cap value → default
    10. resolveKeyLabels: default config → labels for all 10 actions; rebound key reflected;
        ctrl+shift+q → "Ctrl+Shift+Q", tab → "Tab", shift+tab → "Shift+Tab"
  - NAMING: test_<behavior> functions; PLACEMENT: src/config.test.ts (co-located)

Task 6: VALIDATE
  - npm run typecheck && npm test
  - Level 3 manual probe (below)
```

### Implementation Patterns & Key Details

```ts
// Tolerant namespaced read — follow file-injector.ts:337-344 EXACTLY in spirit:
const tryReadInterrogator = async (p: string): Promise<Partial<InterrogatorConfig>> => {
  try {
    const v = JSON.parse((await fs.readFile(p, "utf8")).trim() || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const sub = (v as Record<string, unknown>)["interrogator"];
    return sub && typeof sub === "object" && !Array.isArray(sub)
      ? (sub as Partial<InterrogatorConfig>) : {};
  } catch { return {}; }   // missing file, bad JSON — both land here
};

// Deep merge — PLAIN OBJECTS ONLY; never mutate:
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function deepMerge<T>(base: T, override: unknown): T { /* recurse per key; non-object override replaces */ }

// resolveKeyLabels normalization:
function labelFor(accel: string): string {
  return accel.split("+").map(t => t.charAt(0).toUpperCase() + t.slice(1)).join("+");
}
// "ctrl+shift+q" → "Ctrl+Shift+Q"; "shift+tab" → "Shift+Tab"; "tab" → "Tab"
```

### Integration Points

```yaml
MODULES (no file changes now — contracts only):
  - P1.M1.T3.S3 tool.ts caps: imports { InterrogatorConfig, loadConfig } → uses config.caps
  - P1.M3.T3.S1 panel/keys.ts: uses config.keys (matched against pi Key/matchesKey at that layer, not here)
  - P1.M3.T1.S2 / P1.M6.T1.S1 footer & widget: imports { resolveKeyLabels } for every key-naming string
  - P1.M7.T4.S1 detect.ts: config.roundDetection
  - P1.M7.T7.S1 README: config reference is generated from loadConfig JSDoc
NO CHANGES to: src/index.ts, package.json (no new deps — node builtins + existing pi package only)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # tsc --noEmit → zero errors (covers src/config.ts + config.test.ts)
```

### Level 2: Unit Tests

```bash
npm test             # vitest run → all ~10 config tests green
npx vitest run src/config.test.ts -v   # targeted while iterating
```

### Level 3: Integration (real-environment probe)

```bash
# Temporary probe script (delete after): confirm real-home load yields defaults (no "interrogator" key there today)
node --input-type=module -e "
import('./src/config.ts').then(async m => {
  const cfg = await m.loadConfig(process.cwd());
  console.log(JSON.stringify(cfg, null, 2));
  console.log(m.resolveKeyLabels(cfg));
});"
# EXPECT: JSON matching h2.52 defaults verbatim + label map with 10 entries; no exception.
# Then optionally: create a scratch dir with .pi/settings.json containing an "interrogator" override,
# and verify project-path loading via the testable internal loader.
```

### Level 4: Domain validation

- [ ] JSDoc on loadConfig covers every key in h2.52 (count: 10 keys + 6 caps + 3 toggles + editorMode)
- [ ] No display-string consumer will ever need a hardcoded key label (resolveKeyLabels covers all KeyActions)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm test` → all pass; nothing under spec/ or plan/ modified; src/index.ts untouched
- [ ] DEFAULT_CONFIG matches h2.52 field-for-field
- [ ] loadConfig never throws for any malformed input (test coverage proves it)
- [ ] Deep merge proven by tests (nested override isolation + project>global>defaults precedence)
- [ ] resolveKeyLabels covers all 10 KeyActions, rebound keys reflected
- [ ] Full JSDoc config reference present (feeds P1.M7.T7.S1 README)
- [ ] No new dependencies added

## Anti-Patterns to Avoid

- ❌ Don't use ctx.settings — it does not exist (pi-api-validation.md Mismatch 4)
- ❌ Don't shallow-spread merge like file-injector — PRD h2.18 explicitly requires deep merge
- ❌ Don't let loadConfig throw — tolerance is contractual
- ❌ Don't hardcode "ctrl+s" etc. in any string that names a key — always resolveKeyLabels
- ❌ Don't read the real ~/.pi in unit tests — use temp dirs + injectable paths
- ❌ Don't cast JSON.parse results without the object/array guard narrowing
- ❌ Don't add a build step or new deps — node builtins only

---

**Confidence Score**: 9/10 — defaults are contractual (h2.52 verbatim), the load pattern is a verified in-repo precedent (pi-file-injector lines 307–356), exports getAgentDir/CONFIG_DIR_NAME confirmed against installed pi 0.85.1 typings. Only mild uncertainty: exact test-injection seam shape (implementer's choice between two equivalent options given above).

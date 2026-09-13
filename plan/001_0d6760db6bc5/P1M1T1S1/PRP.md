# PRP — P1.M1.T1.S1: Package scaffold + index.ts factory smoke-load

## Goal

**Feature Goal**: A loadable, typechecked `pi-interrogator` extension package skeleton (package.json, tsconfig, vitest config, `src/index.ts` factory) that smoke-loads in pi and proves registration via a `/interrogate-ping` notify stub. All later subtasks register into this skeleton.

**Deliverable**: Repo root scaffold — `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` — passing `npm run typecheck`, `npm test` (0 tests, green), and manual smoke-load `pi -e src/index.ts` → `/interrogate-ping` shows a notify.

**Success Definition**:
- `npm install` completes cleanly
- `npm run typecheck` → zero errors
- `npm test` → vitest runs, "no tests" reported as success (add one trivial smoke test if vitest exits non-zero on 0 tests — `passWithNoTests: true` in vitest.config.ts)
- `pi -e src/index.ts` loads; `/interrogate-ping` in the TUI fires `ctx.ui.notify("pi-interrogator: pong", "info")`

## Why

This is the first subtask of a greenfield repo (no package.json/src exist). Every subsequent module (config.ts, state.ts, tool.ts, panel/*, …) is imported/registered through this factory. Getting the pi extension packaging contract exactly right now (manifest, peer deps, type imports, jiti-loaded TS) unblocks the entire milestone tree (consumed by P1.M1.T1.S2 and every later subtask).

## What

- `package.json` exactly per `plan/001_0d6760db6bc5/architecture/external-deps.md` §Package skeleton
- `tsconfig.json`: strict TypeScript, `moduleResolution: "bundler"`, `noEmit: true`, `module: "esnext"`, `target: "es2022"`, include `src/**/*`
- `vitest.config.ts` with `test.passWithNoTests: true`
- `src/index.ts`: JSDoc header (h2.0 core commitments summary) + default-export factory registering a single stub command `interrogate-ping`
- spec/ files are READ-ONLY context — do not modify

### Success Criteria

- [ ] Package name `pi-interrogator`, `type: module`, `main`/`exports` → `./src/index.ts`, `pi.extensions` manifest `["./src/index.ts"]`, engines node `>=22.19.0`
- [ ] peerDeps `@earendil-works/pi-coding-agent` + `typebox` (bare, NOT `@sinclair/typebox`); devDeps per skeleton incl. `typescript ^5`, `vitest ^1`
- [ ] `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"` — named type import, default-export factory `(pi: ExtensionAPI): void`
- [ ] `pi.registerCommand("interrogate-ping", ...)` with handler calling `ctx.ui.notify(..., "info")`
- [ ] All validation gates green (typecheck, vitest, smoke-load)

## All Needed Context

### Context Completeness Check

Repo is greenfield: only `.envrc`, `.gitignore`, `.pi/`, `plan/`, `spec/` exist. No source files, no tests. This PRP contains the full file contents / exact patterns needed; no prior codebase knowledge required.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/architecture/external-deps.md
  why: "AUTHORITATIVE package skeleton (§Package skeleton lines 24–52): exact package.json contents, index.ts factory shape, and dev-load instructions (§Loading for development)"
  critical: "Follow it EXACTLY — package name, manifest, engines, peer/dev dep split are contractual for all later subtasks"

- file: plan/001_0d6760db6bc5/architecture/reference-patterns.md
  why: pi extension conventions and reference example mapping
  gotcha: read before inventing any pattern

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  why: "pi extension API. §~line 88–105 shows exact registerCommand + ctx.ui.notify pattern; §pi.registerCommand(name, options) at line 1525"
  critical: "command handler signature: async (args: string, ctx) => void; notify takes (message, level: 'info'|'error'|'warn'|'success')"

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/commands.ts
  why: canonical registerCommand example — import style, factory export, getArgumentCompletions (not needed yet)
  pattern: default-export function taking ExtensionAPI

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts
  why: reference for later milestones (embedded Editor in ctx.ui.custom) — read-only orientation

- file: plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md
  why: environment quirks (node version, pi install path) if typecheck fails on dep resolution
```

### Current Codebase tree

```bash
pi-structured-interrogation/
├── .envrc
├── .gitignore
├── .pi/
├── plan/001_0d6760db6bc5/   # PRPs, tasks, architecture docs
└── spec/                     # SPEC.md, tool-protocol.md, ui-spec.md, ... (READ-ONLY)
```

### Desired Codebase tree

```bash
pi-structured-interrogator root:
├── package.json          # pi extension package manifest + scripts (skeleton above)
├── tsconfig.json         # strict, bundler resolution, noEmit
├── vitest.config.ts      # passWithNoTests
└── src/
    └── index.ts          # factory: JSDoc header + single registerCommand stub
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: runtime is jiti loading raw .ts — no build step, no dist/. main/exports point at ./src/index.ts.
// CRITICAL: peer dep is bare `typebox` (the standalone package), NOT `@sinclair/typebox`.
//   (StringEnum helper comes from `@earendil-works/pi-ai` — NOT needed in this subtask; do not add imports for it yet.)
// CRITICAL: engines node ">=22.19.0" — exact floor from external-deps.md; verify with `node -v`.
// GOTCHA: vitest ^1 exits 1 with "No test files found" unless vitest.config.ts sets `test: { passWithNoTests: true }`.
// GOTCHA: TypeScript must resolve "@earendil-works/pi-coding-agent" from node_modules after `npm install`
//   (it is in devDependencies). If typecheck can't find it, confirm npm install ran and pi install version is ~0.85.1.
// GOTCHA: `pi -e src/index.ts` is the quick dev-load path; do NOT edit ~/.pi/agent/settings.json in this subtask.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE package.json (repo root)
  - COPY VERBATIM the skeleton from plan/001_0d6760db6bc5/architecture/external-deps.md lines 27–45
    (name pi-interrogator, version 0.1.0, type module, main/exports ./src/index.ts,
    "pi": {"extensions": ["./src/index.ts"]}, engines node >=22.19.0,
    peerDeps @earendil-works/pi-coding-agent "*" + typebox "*",
    devDeps @earendil-works/pi-coding-agent ~0.85.1, @earendil-works/pi-ai ~0.85.1,
    typebox 1.3.7, @types/node ^22, typescript ^5, vitest ^1,
    scripts test "vitest run" / typecheck "tsc --noEmit")

Task 2: CREATE tsconfig.json
  - compilerOptions: strict true, target es2022, module esnext,
    moduleResolution bundler, noEmit true, skipLibCheck true,
    esModuleInterop true, types ["node"]
  - include: ["src/**/*"]

Task 3: CREATE vitest.config.ts
  - import { defineConfig } from "vitest/config";
    export default defineConfig({ test: { passWithNoTests: true } });

Task 4: CREATE src/index.ts
  - JSDoc header (Mode A doc) describing the extension per h2.0 core commitments:
    /interrogate panel, interrogate tool, rev/epoch guards, draft sacredness,
    single in-memory state source of truth, TUI-first with non-TUI fallback.
    Note: "This file is the factory; module registrations land in later subtasks."
  - import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
    export default function interrogatorExtension(pi: ExtensionAPI): void {
      pi.registerCommand("interrogate-ping", {
        description: "Smoke-test: proves the pi-interrogator extension loaded",
        handler: async (_args, ctx) => { ctx.ui.notify("pi-interrogator: pong", "info"); },
      });
    }
  - FOLLOW pattern: examples/extensions/commands.ts (factory shape) and hello pattern from extensions.md ~line 93

Task 5: RUN npm install && npm run typecheck && npm test
  - Fix any resolution/type errors before proceeding

Task 6: SMOKE-LOAD validation (Level 3 below)
```

### Implementation Patterns & Key Details

```ts
// Factory pattern (exact — from extensions.md / commands.ts):
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function interrogatorExtension(pi: ExtensionAPI): void {
  pi.registerCommand("interrogate-ping", {
    description: "Smoke-test: proves the pi-interrogator extension loaded",
    handler: async (_args: string, ctx) => {
      ctx.ui.notify("pi-interrogator: pong", "info");
    },
  });
}
// GOTCHA: registerCommand's first arg is the bare name ("interrogate-ping"),
// invoked by the user as /interrogate-ping. Do NOT include the slash.
// GOTCHA: later subtasks will name the real command "interrogate" (h2.3); this stub is ping-only and temporary.
```

### Integration Points

```yaml
NPM: "npm install materializes devDeps (pi types, typescript, vitest); runtime loads via jiti in pi's tree"
PI: "dev-load via `pi -e src/index.ts`; persistent packages-load is a LATER task, do not configure now"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
node -v                       # expect >= 22.19.0
npm install
npm run typecheck             # tsc --noEmit → zero errors
npx prettier --check src/ 2>/dev/null || true   # optional; repo has no formatter yet — skip if absent
```

### Level 2: Unit Tests

```bash
npm test                      # vitest run; 0 tests must report green (passWithNoTests)
```

### Level 3: Integration (smoke-load — REQUIRED)

```bash
# From repo root, run interactively (needs a TTY):
pi -e src/index.ts
# In the pi TUI: type /interrogate-ping <enter>
# EXPECT: notify bubble "pi-interrogator: pong" appears
# Then check the command list: /commands should list interrogate-ping (source: extension)
# Exit pi.
```

### Level 4: Manual acceptance

- [ ] `pi -e src/index.ts` starts with no load/parse errors in the console
- [ ] `/interrogate-ping` notify fires exactly once per invocation

## Final Validation Checklist

- [ ] package.json matches external-deps.md skeleton field-for-field
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm test` → green (no tests)
- [ ] Smoke-load + `/interrogate-ping` notify confirmed manually
- [ ] No files under spec/ or plan/ modified
- [ ] src/index.ts carries the JSDoc header describing the extension (h2.0 commitments)

## Anti-Patterns to Avoid

- ❌ Don't use `@sinclair/typebox` — this ecosystem uses standalone `typebox`
- ❌ Don't add a build/dist step — jiti loads TS directly; main points at src/index.ts
- ❌ Don't register the real `/interrogate` command yet — that's P1.M6.T1.S2; only the ping stub
- ❌ Don't pre-create empty stub files for future modules (state.ts etc.) — each later subtask creates its own
- ❌ Don't modify ~/.pi settings or spec/ files

---

**Confidence Score**: 9/10 — package contents are contractual (verbatim in external-deps.md), registerCommand pattern verified against installed pi docs and examples. The only manual step is the TUI smoke-load.

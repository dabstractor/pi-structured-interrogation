# Validation Report — pi-interrogator

**Date:** 2026-10-15 · **Validator:** comprehensive project validation (deep analysis + scripted gates + live E2E)
**Repo:** `/home/dustin/projects/pi-structured-interrogation` · **pi runtime:** 1.0.2 · **node:** v26.10.0

## What this project is

A pi coding-agent extension (`pi-interrogator`) providing structured interrogation:
an `interrogate` tool (upsert/read/reopen/record), a TUI answer panel (short/deep/overview
views, embedded editor with write-in/elaboration/note duties, answer pinning, ripple
confirms, auto-submit), submission-delta + completion-record delivery, staleness guards
(rev/epoch), persistence/reconstruction, and a non-TUI markdown-digest fallback. The spec
suite lives in `spec/*.md` with a decision ledger; plans/tasks live in `plan/`.

## Validation performed

### Scripted — `./validate.sh` (20 checks, ALL GREEN, reproduced twice)

| Phase | Result |
|---|---|
| 0 Environment | node 26.10.0, node_modules present, pi 1.0.2 on PATH |
| 1 Linting | ⚠ none configured (see Issue 4) |
| 2 Type checking | ✅ `tsc --noEmit` clean (strict mode) |
| 3 Style checking | ⚠ none configured (see Issue 4) |
| 4 Unit testing | ✅ vitest: **47 files / 1337 tests passed** |
| 5 Static guards | ✅ `verify-keymap-conflicts.sh` PASS · README free of removed-key vocabulary (ctrl+t/ctrl+d/ctrl+l/focusText/digit — task P1.M4.T2.S1 gate) · no `registerShortcut` in production source · no `digitQuickSelect`/caps residue in config · `DEFAULT_CONFIG` matches the locked BAREKEYS-001 keymap · demo script runs |
| 6 E2E (headless pi) | ✅ 9/9 probes green (below) |

### Live E2E — real `pi -p` processes with the real extension loaded

Per `plan/001_0d6760db6bc5/AUTOMATION-POLICY.md`, automated runs must never open a TUI
panel or wait on a human; the sanctioned E2E surface is headless one-shot `pi -p` probes
(non-TUI fallback path). Each probe below launched a fresh real pi process, drove the
model to call the real `interrogate` tool, and asserted tool-side invariants from the
JSON event stream:

- **E1 smoke** — extension loads under pi 1.0.2; tool registered with the resident
  description; upsert returns the status line + digest.
- **E2 fallback digest (FR-25)** — recommended option renders `★` + `Recommendation:` line.
- **E3 record answers (AC-2 non-TUI)** — `answers[]` records both answers; epoch bumps 1→2.
- **E4 completion record (AC-11/AC-14, FR-5)** — after settle, exactly one
  `interrogation-completion` custom message injected with the full Q&A record, notes and
  withdrawn/moot sections.
- **E5 stale guard (AC-8)** — wrong-epoch record rejected: `isError:true` toolResult with
  `STALE: session epoch is 1 (you sent 99)…Re-apply`; model self-heals with the correct
  epoch and the re-apply succeeds.
- **E6 TRUST-001 full fidelity** — a >200-char write-in recorded with `custom:true`
  surfaces in the read result as BOTH the 60-char one-liner slice AND the full
  untruncated `  answer:` detail line.
- **E7 merge rules (FR-17/FR-19/FR-21)** — `dependsOn` moot evaluated instantly (q3 moot,
  reason preserved); options-change upsert resets the answer and marks `reasked` (rev
  bumps); `withdrawOmitted:true` withdraws the omitted non-moot id with a notice while
  keeping its recorded answer; moot is deliberately non-withdrawable (documented design).
- **E8 moot-completion amendment (2026-10-07 Issue-3)** — a standing moot does NOT block
  the completion record; it is listed under `Withdrawn/moot: q2 (moot: q1=fs)`.
- **E9 session restart (FR-28 read side / AC-9)** — a fresh pi process resuming a saved
  session reconstructs goal, question statuses, and revs (verified via read), proving the
  tool-result `details.state` persistence layer + reconstruction walk.

### Manual deep-review — code and spec cross-checks

- TRUST-001 continuation-line logic in `delivery.ts` (code-point-safe cap, full-text
  continuation) — implemented and unit-tested; verified E2E on the read side.
- MIRROR-SILENT-001 — no entry renderer registered; comment-documented in `renderers.ts`.
- Widget line format `{n} open · {m} answered — /interrogate to resume` — command-only,
  no key chord (matches the naming contract).
- Key router two-tier intercept (BAREKEYS-001), fixed hjkl branches (VIMNAV-001), digit
  removal (DIGIT-OUT-001) — code inspected; behavior covered by the suite.
- Status-line record-derived counting rule (2026-10-02 pin) — `isRecordAnswered`
  implemented as specified.
- Latest bugfix changeset (WRITEIN-002 re-bind restore, note-duty ctrl+g, caps purge) —
  PRP claims verified against the tree (`stageSupersededWriteIn` wired at both apply
  sites, tests present); all tasks marked Complete.
- Spec coherence greps (caps contradictions, "text focus" scopes) — clean of live claims
  in the authoritative docs; drift found only in the two planning docs (Issues 1–2).
- `npm audit --omit=dev`: **0 production vulnerabilities**. Dev-chain findings
  (vitest/vite/tinypool/esbuild transitives + pi 0.85.1's undici) affect the local
  toolchain only.

### Three probe-script bugs during validation (fixed in `validate.sh`, NOT codebase bugs)

An ERE `ctrl+s` quantifier misparse, backtick command-substitution in a probe string, and
a model-mangled `recommendation` placement (the tool correctly strips a `recommendation`
hoisted inside an option object; honest tolerant-parse behavior). After fixing the script:
20/20 green, twice.

## Issue tracker

No critical or major findings. **All functional paths validated green.** Six minor
findings, five of them documentation/hygiene-level:

### 1. [Minor · spec drift] `spec/architecture.md` contradicts MIRROR-SILENT-001
- **Where:** `spec/architecture.md:22` (module table: "renderers.ts — registerMessageRenderer / registerEntryRenderer cards") and `spec/architecture.md:130` (API surface: "`pi.registerMessageRenderer` ×2, `pi.registerEntryRenderer` ×1").
- **Reality:** The 2026-10-08 owner ruling MIRROR-SILENT-001 (`spec/decisions.md:105`) removed the state-mirror entry renderer; `spec/ui-spec.md:127` says "NO renderer"; the code registers **zero** entry renderers (verified by grep; the removal is comment-documented in `src/renderers.ts:263-269`).
- **Impact:** A reader of architecture.md alone would expect a visible `· interrogation state @ epoch {n}` transcript marker that intentionally no longer exists.
- **Fix:** One-line edits in architecture.md (spec is read-only to the dev agent; owner should sync). Code is correct per the later ruling.

### 2. [Minor · spec drift] `spec/architecture.md` + `spec/implementation-plan.md` contradict CAPS-OUT-001
- **Where:** architecture.md:10/12/31/43/151 still describe a caps pipeline ("enforces caps", "validate → caps → guards", "Config surface (all hotkeys + caps…)") and :131 claims `ctx.model.contextWindow` is used "for cap scaling". implementation-plan.md:13 ("caps truncate with warnings"), :41/:43 (checklist "caps"), :57 ("caps formula" in the test list), :82-83 (config reference still shows the deleted `"caps": { … }` block).
- **Reality:** CAPS-OUT-001 (2026-10-08, `spec/decisions.md:107`) deleted the caps engine entirely; `spec/product-requirements.md` FR-23 and `spec/tool-protocol.md` §No caps record the deletion; the code has no caps module and no caps config.
- **Impact:** Same as Issue 1 — stale planning docs; the authoritative PRD/protocol/ledger are consistent. The decisions ledger supersedes, so traceability survives.
- **Fix:** Sweep the two planning docs for "caps" (spec sync by owner).

### 3. [Minor · dead code] Vestigial `ExecutorContext.model` field in `src/tool.ts`
- **Where:** `src/tool.ts:102-103` — `model?: { contextWindow?: number }` declared for "cap scaling"; its JSDoc claims "only `contextWindow` … is read".
- **Reality:** Nothing reads it anywhere since the caps engine deletion (grep: the only two mentions are the declaration and its comment). The JSDoc claim is now false.
- **Impact:** None functionally (optional field). Misleading to maintainers; invites reimplementing a cap.
- **Fix:** Delete the field (and the `model?` mentions in JSDoc), or re-comment it as reserved. (Not fixed: validation agent must not modify source.)

### 4. [Minor · tooling gap] No linter or formatter configured
- **Where:** No `.eslintrc*`/`eslint.config.*`/`.prettierrc*`/biome config anywhere in the repo.
- **Reality:** Code-quality gates are `tsc --noEmit` + vitest, plus two ad-hoc source-scan guard tests (`no-hardcoded-keys.test.ts`, `keymap-guard.test.ts`). validate.sh phases 1 and 3 can therefore only warn.
- **Impact:** Style/idiom regressions and some bug classes (unused vars, `==` slips) are not machine-gated. Given the codebase's unusually high documentation discipline, risk is low — but an eslint (typescript-eslint recommended) pass would be cheap insurance.
- **Fix:** Add eslint + a `npm run lint` script; wire into validate.sh phase 1.

### 5. [Minor · repo hygiene] Uncommitted changeset bookkeeping
- **Where:** `git status`: staged new file `plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T2S2/PRP.md` + research note, and an unstaged `tasks.json` status flip for that subtask. Branch is 17 commits ahead of `origin/main`.
- **Reality:** The last bugfix changeset's closing bookkeeping is complete on disk (all tasks Complete, suite green, spec-coherence verification recorded) but was never committed/pushed.
- **Impact:** None at runtime; the record is not durable and the remote is stale.
- **Fix:** Commit the staged plan changes and push.

### 6. [Observation · dependency posture] devDeps pin pi ~0.85.1 while runtime pi is 1.0.2
- **Where:** `package.json` devDependencies `@earendil-works/pi-*: ~0.85.1`; the installed pi binary is 1.0.2.
- **Reality:** The extension is loaded at runtime via jiti against the **user's** pi tree (1.0.2) — all 9 E2E probes passed under 1.0.2, so compatibility is empirically verified. Typecheck/tests, however, run against the 0.85.1 type surface, which could theoretically mask a type-level incompatibility introduced by a future pi release.
- **Impact:** None today. Watch on pi upgrades; consider bumping the dev pins when convenient.
- **Fix:** None required (peerDependencies are `*` by design).

## Verdict

**PASS with 6 minor findings (0 critical, 0 major).** The codebase is functionally
excellent: every scripted gate is green, the 1337-test suite covers the panel/state/
delivery/persistence surface deeply, and nine live end-to-end probes in a real pi 1.0.2
process confirmed the complete non-TUI user journey (upsert → digest → chat answers →
record → completion injection) plus guards, merge rules, moot semantics, write-in
fidelity, and cross-restart reconstruction. Interactive TUI behaviors (panel keymap,
answer pinning, auto-submit, ripple confirms) are covered by the scripted AC suites and
deferred to the human runbook (`plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md`) per the
binding AUTOMATION-POLICY. The findings above are documentation drift, dead code, and
hygiene — none affects production behavior.

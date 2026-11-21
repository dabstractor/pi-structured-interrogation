# PRP — P3.M5.T1.S2: README + docs sync — limitations row flips, AC-9 wording, config reference

---

## Goal

**Feature Goal**: Make README.md tell the truth about the now-shipped local input
recovery (P3 changeset): the limitations list loses its "cross-restart draft
persistence" / memory-only-drafts qualifier, AC-9's "drafts gone (documented)" is
replaced by the PRD's "editor recovery is tested separately (FR-28)" wording, the
side-chat limitation prose keeps the conversation-vs-composer distinction
(SIDECHAT-002), the config reference is verified against the ACTUALLY implemented
config surface (which is: zero new settings), and the project-structure tree gains
the three new recovery modules — with the final diff confined to README.md.

**Deliverable**: An updated `README.md` (the changeset's docs deliverable, Mode B)
consistent with shipped recovery behavior, plus the confirming scope check
(`git diff --stat` → README.md only). No other file changes.

**Success Definition**:
- The gate verdict from P3.M5.T1.S1 is confirmed green (pre-condition; see Task 0).
- README no longer claims drafts are memory-only/in-session-only/restart-lost
  anywhere (residue greps empty — Task 7).
- AC-9 row matches `spec/product-requirements.md:94` wording.
- The side-chat prose keeps BOTH facts: the CONVERSATION remains restart-lost
  (SIDECHAT-002); the COMPOSER's saved edit recovers.
- Recovery prose states: extension-local files (never the session file), exact
  string per session/branch/question/field, five editor duties, and NO side effects
  (never commits/submits/sends/calls a model).
- Config reference unchanged unless a probe proves a new setting exists in
  `src/config.ts` (verified at PRP-research time: none does).
- `npm run lint` exit 0; `git diff --stat` shows only README.md.

## User Persona (if applicable)

**Target User**: (a) the extension's human users reading README to learn what
survives a crash; (b) future maintainers auditing README claims against the spec.

**Use Case**: a user hard-kills pi mid-elaboration, restarts, reopens the field —
README told them their draft would come back (and what would NOT come back: the
side-chat transcript).

**User Journey**: user reads Usage/Limitations → learns drafts persist across
restarts via local files → learns the side-chat conversation is still ephemeral but
its composer recovers → restarts confidently.

**Pain Points Addressed**: README currently promises the OPPOSITE of shipped
behavior ("drafts gone (documented)", "never in-progress drafts") — every restart
is a surprise data-loss event the docs lied about.

## Why

- P3.M2–P3.M4 shipped durable editor-input capture/restore/retirement and blank
  rejection; S1 (running in parallel) proves it green. This is the changeset's
  closing docs deliverable — the PRD file checklist row
  (`spec/implementation-plan.md:56`) reads "shipped limitations (TUI-first;
  memory-only drafts until local input recovery ships)" and the memory-only
  qualifier must now go.
- The updated PRD AC-9 (`spec/product-requirements.md:94`) already re-words the
  criterion; README's summary row must flip to match, not drift.
- Docs-only changeset closure: no code may change here.

## What

Edit README.md only, at the six surfaces located during research (line numbers at
HEAD during PRP research; **verify by grep anchor, lines drift**):

1. **AC-9 row** (grep `drafts gone`): replace
   `…/interrogate` reopens restored state (answers with their elaborations and ✎
   write-ins); drafts gone (documented); pending answers ship…`
   with the PRD wording:
   `9. Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget
   line shows live counts; \`/interrogate\` reopens with questions/answers restored
   (any status mix); editor recovery is tested separately (FR-28); pending
   answers ship on the next commit or submit (AUTOSUBMIT-001).`
2. **Limitations blockquote** (grep `cross-restart draft persistence`): delete the
   `cross-restart draft persistence (documented limitation)` item from the list;
   every other item stays (the TUI-first bullet below the quote stays too).
3. **Drafts bullet** (grep `Drafts are in-session only`): rewrite — suggested prose:
   > - Drafts survive restarts (local input recovery, FR-28): every editor duty —
   >   `✎ Other`/write-in, text answer, elaboration, batch note, and the
   >   side-chat composer — saves its full text as you type (debounced, hard-flushed
   >   within ~1s of continuous typing) to extension-local files under
   >   `<agentDir>/data/interrogator/` — never the session file, written atomically
   >   (temp file + fsync + rename). After a crash or restart, reopening the field
   >   restores the exact saved string — newlines, Unicode, surrounding whitespace —
   >   to its originating session, branch, question, and field. Recovery is inert:
   >   it never commits, submits, sends, or calls a model; a recovered draft ships
   >   only when you act on it. Blank edits are still rejected at commit
   >   (`Answer cannot be blank`).
4. **Side-chat ephemeral bullet** (grep `The side chat is ephemeral`): keep
   conversation-restart-lost, add the distinction:
   > - The side chat's CONVERSATION is ephemeral: it lives only for the session —
   >   restarting pi mid-interrogation restores questions and answers but never an
   >   open chat, and nothing about a chat is written to the session file. Its
   >   COMPOSER's saved edit recovers like any other draft (SIDECHAT-002: recovery
   >   concerns your input, not the conversation).
5. **Optional one-phrase touches** (only if they read naturally):
   - Side chat § closing line ("The chat lives in extension memory only…") — may
     append "(its composer's saved draft still recovers — see Limitations)".
   - Usage restart prose (grep `come right back`) — may extend to
     "questions, answers, and in-progress editor drafts come right back".
6. **Project structure tree** (grep `draft-store.ts`): add three rows alongside it:
   `input-capture.ts` (edit-event capture, debounce pacing), `input-durability.ts`
   (atomic recovery-point store + retirement), `input-restore.ts` (seeding ladder on
   field open / session start). The tree lists source files only — do NOT add
   test files.

### Success Criteria

- [ ] Residue greps empty: `grep -n "drafts gone\|in-session only\|cross-restart draft persistence\|memory-only" README.md`
- [ ] AC-9 row matches spec/product-requirements.md:94 (editor recovery tested separately, FR-28)
- [ ] Limitations list no longer contains the draft-persistence non-goal; TUI-first stays
- [ ] Conversation-vs-composer distinction present in BOTH the side-chat bullet and recovery prose
- [ ] Recovery prose covers: five duties, exact string, session/branch/question/field keying, `<agentDir>/data/interrogator/`, never the session file, no commit/submit/send side effects, blank rejection unchanged
- [ ] Config JSONC block unchanged (or exactly matches any probe-proven new setting)
- [ ] Project tree contains input-capture/input-durability/input-restore
- [ ] `git diff --stat` → README.md only; `npm run lint` exit 0

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they complete this docs sync?"
Yes: every edit target is located by grep anchor with current-text quotes, the new
wording is pre-drafted from the read-only spec, and the config-surface question is
resolved by a probe command with a verified answer (zero new settings).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: plan/006_45773b259b06/P3M5T1S1/PRP.md
  why: the S1 contract — its report-only gate verdict JSON is this item's pre-condition
  pattern: verdict keys {head, cases 1-5, suite, typecheck, lint, guards, diffConfined, anomalies}
  gotcha: S1 writes NO repo file; obtain the verdict from the orchestrator handoff /
    plan status (S1 Complete) — do not re-run the whole gate

- file: spec/state-and-persistence.md
  why: §Local input recovery — the five requirement bullets your prose must summarize;
    §Side chat — "Recovery concerns the user's input, not the conversation" (SIDECHAT-002)
  pattern: capture-on-edit / recovery-point / drafts-are-not-answers / re-edit ladder / blank rejection
  gotcha: READ-ONLY (resolved PRD). Its preamble still says "New requirements, not
    shipped" — do NOT mirror that framing; the README documents SHIPPED behavior

- file: spec/product-requirements.md
  why: :94 = AC-9 authoritative wording (copy it); :60 = FR-28
  gotcha: READ-ONLY

- file: spec/implementation-plan.md
  why: :56 = README file-checklist row whose "memory-only drafts" qualifier this item removes
  gotcha: READ-ONLY

- file: README.md
  why: THE deliverable — six edit surfaces: AC-9 row (~:409, grep "drafts gone");
    limitations blockquote (~:423, grep "cross-restart draft persistence"); drafts
    bullet (~:425-431, grep "in-session only"); side-chat bullet (~:432-435);
    project tree (~:557+, grep "draft-store.ts"); optional Usage/Side-chat phrases
  pattern: existing bullets' register — terse, backticked keys, spec-IDs in parens
  gotcha: do NOT touch the keymap-conflict re-verification section or the config
    JSONC block (unless the probe in Task 1 finds a new setting)

- file: src/config.ts
  why: the ACTUAL config surface — InterrogatorConfig + DEFAULT_CONFIG
  pattern: probe with `git diff <P3-base> -- src/config.ts` and grep for recovery keys
  gotcha: verified EMPTY at PRP time — zero new settings shipped; document nothing new

- file: src/input-capture.ts
  why: facts for prose — five editor duties; pacing constants DEBOUNCE_MS=250,
    MAX_DIRTY_AGE_MS=1000 (lines ~96-97) — hardcoded, NOT config
- file: src/input-durability.ts
  why: facts for prose — storage at <agentDir>/data/interrogator/, atomic
    tmp+fsync+rename, never the session file (header comment lines ~13-32)

- file: plan/006_45773b259b06/P3M5T1S2/research/readme-sync-facts.md
  why: this item's research note — verified line numbers, spec anchors, prose facts
```

### Current Codebase tree (run `tree` in the root of the project — or `ls`) to get an overview

```bash
# Docs-relevant slice (P3 changeset files, verified via git diff vs base 11e864d):
# src/input-capture.ts | src/input-durability.ts | src/input-restore.ts   ← new modules (tree additions)
# src/no-recovery-side-effects.test.ts | src/input-retirement.test.ts |
# src/blank-rejection.test.ts | src/panel/session-restore.test.ts |
# src/panel/retirement-sidechat.test.ts                                     ← tests (NOT in README tree)
# README.md 625 lines; spec/ read-only; plan/006_45773b259b06/ orchestrator-owned
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. ONE modified file: README.md (docs-only changeset closure).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: spec/ is READ-ONLY (resolved PRD, hash-pinned). plan/ and tasks.json are
#   orchestrator-owned. scripts/, package.json, src/ — all out of scope. README.md ONLY.
# CRITICAL: line numbers drift — locate every edit by its grep anchor, not the line number.
# GOTCHA: the spec's recovery section preamble still says "not shipped" — the spec lags
#   the implementation by design here; README documents what IS shipped (S1 proved green).
# GOTCHA: do not invent config rows — pacing (250ms debounce / 1s hard flush) is
#   hardcoded in src/input-capture.ts, deliberately not configurable in this changeset.
# GOTCHA: keep the TUI-first limitation — recovery rides editor/composer surfaces that
#   only exist in the TUI; non-TUI digest flow is unchanged.
# GOTCHA: `npm run lint` = eslint src scripts *.ts — does NOT lint markdown; it is a
#   sanity no-op here, run it anyway.
```

## Implementation Blueprint

### Data models and structure

None — documentation-only. The "model" is the six edit surfaces + grep anchors above.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION — S1 gate verdict green
  - CONFIRM: P3.M5.T1.S1 verdict green (orchestrator status Complete, or the S1
    report's JSON shows cases 1-5 green + suite/typecheck/lint green + diffConfined true).
  - IF S1 failed or is absent → STOP and report; never document unshipped behavior.

Task 1: PROBE the actual config surface (decides the "config reference" work)
  - RUN: BASE=$(git log --format=%H --grep="capture-on-edit lands" -1)^
         git diff --name-only $BASE -- src/config.ts        # expect: EMPTY
         grep -n -iE "recovery|pacing|debounce|flush" src/config.ts   # expect: no hits
  - IF (and only if) a new setting exists: add ONE comment line + row to the config
    JSONC block matching its actual default and behavior from src/config.ts.
  - ELSE (expected): config block stays byte-identical; note the negative result
    in your report.

Task 2: AC-9 row flip (README ~:409; grep "drafts gone")
  - REPLACE with the spec/product-requirements.md:94 wording (quoted in §What).

Task 3: Limitations section (README ~:419-435)
  - DELETE "cross-restart draft persistence (documented limitation)" from the blockquote.
  - REWRITE the "Drafts are in-session only" bullet → recovery-shipped prose (§What #3).
  - REWORK the side-chat ephemeral bullet → conversation-lost + composer-recovers (§What #4).
  - PRESERVE: TUI-first bullet, chat-snapshot bullet, all other list items verbatim.

Task 4: Optional one-phrase touches (§What #5) — only where they read naturally;
  skip any that would bloat or duplicate the Limitations prose.

Task 5: Project structure tree (grep "draft-store.ts")
  - ADD input-capture.ts / input-durability.ts / input-restore.ts rows, one-line
    comments each (capture+pacing / atomic store+retirement / restore+seeding ladder).
  - MATCH the tree's existing comment style; no test files.

Task 6: READ-THROUGH pass — read the full README once; fix any sentence elsewhere
  that now contradicts shipped recovery (e.g. stale "never in-progress drafts"
  phrasing outside the located surfaces). Keep edits surgical.
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: README bullet register — terse, backticked keys, spec-IDs in parens:
- Drafts survive restarts (local input recovery, FR-28): every editor duty —
  `✎ Other`/write-in, text answer, elaboration, batch note, and the side-chat
  composer — saves its full text as you type …
<!-- PATTERN: distinction sentence (must survive editing):
  the CONVERSATION remains restart-lost (SIDECHAT-002); the COMPOSER's saved edit recovers.
<!-- CRITICAL: never claim recovery submits/queues/sends anything — "Saved locally"
  is not "queued" (spec: drafts are not answers or messages).
```

### Integration Points

```yaml
CODE: none — README.md is the only writable path
CONFIG: none (Task 1 documents the verified-negative)
PLAN ARTIFACTS: none — plan/ is orchestrator-owned; this PRP's research/ already holds notes
PREDECESSOR: P3.M5.T1.S1 gate verdict (report-only) — pre-condition, Task 0
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint   # eslint src scripts *.ts — does not lint README; sanity that nothing
               # outside README changed. Expected: exit 0.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Docs-only: no tests. S1's verdict is the suite's green record.
# Optional cheap insurance (README cannot affect it): npm run typecheck
```

### Level 3: Integration Testing (System Validation)

```bash
# Residue greps — MUST all return nothing:
grep -n "drafts gone\|in-session only\|cross-restart draft persistence\|memory-only" README.md

# Positive greps — MUST return hits:
grep -cn "FR-28" README.md                                   # AC-9 row
grep -n "input-capture.ts\|input-durability.ts\|input-restore.ts" README.md   # tree
grep -n "data/interrogator" README.md                        # storage prose

# Distinction check — both halves present:
grep -n "conversation" README.md | grep -i ephemeral   # conversation restart-lost
grep -n -i "composer" README.md                        # composer recovers

# Scope gate:
git diff --stat            # ONLY README.md (never audit plan/ paths)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Read-through audit (Task 6): every claim in the final README about restart behavior
# must match ONE of: (a) shipped recovery (drafts/composer recover, extension-local
# files, no side effects, blank rejection), (b) still-true limitations (conversation
# ephemeral, TUI-first, chat snapshot frozen). No third category may remain.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run lint` exit 0
- [ ] `git diff --stat` shows README.md only
- [ ] All residue greps empty; all positive greps hit

### Feature Validation

- [ ] AC-9 row matches spec/product-requirements.md:94
- [ ] Limitations blockquote item removed; TUI-first preserved
- [ ] Drafts bullet rewritten with storage/atomicity/no-side-effects/blank facts
- [ ] Conversation-vs-composer distinction intact
- [ ] Config block matches probed reality (expected: unchanged)
- [ ] Project tree has the three recovery modules
- [ ] S1 verdict confirmed green before any edit (Task 0)

### Code Quality Validation

- [ ] Register/style matches surrounding README bullets
- [ ] No speculative features documented (only shipped behavior)
- [ ] spec/, plan/, scripts/, src/, package.json untouched

### Documentation & Deployment

- [ ] No environment variables or config documented that don't exist
- [ ] Changeset docs deliverable (Mode B) complete — P3 closes

## Anti-Patterns to Avoid

- ❌ Don't edit anything except README.md — spec/ is read-only PRD, plan/ is orchestrator-owned
- ❌ Don't document unshipped behavior — Task 0 gates on S1's green verdict
- ❌ Don't invent config knobs — pacing is hardcoded; probe before documenting (expected: nothing new)
- ❌ Don't claim the side-chat conversation recovers, and don't drop its restart-lost limitation
- ❌ Don't imply recovery auto-submits, queues, or sends — it is inert by spec
- ❌ Don't touch the keymap-conflict re-verification section, keymap tables, or config JSONC (beyond a probe-proven addition)
- ❌ Don't chase line numbers — locate surfaces by grep anchor
- ❌ Don't mirror the spec's stale "not shipped" preamble — README documents what shipped

---

**Confidence Score: 9/10** — every edit surface was located and quoted at HEAD; the new
wording is pre-drafted from read-only spec anchors; the one open variable (new config
surface) is resolved by a probe with a verified negative, and the PRP handles the
positive branch anyway. Residual risk: minor line drift between research and
implementation, neutralized by grep anchors.

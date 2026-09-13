name: "P1.M6.T2.S2 — Discuss-in-chat handoff (ctrl+shift+e)"
description: FR-15/h2.35 Q36 — ctrl+shift+e from any view suspends the panel and preloads the current question + options into the main editor via ctx.ui.setEditorText using the EXACT h2.35 template, for a focused side chat the user then submits as their own turn. [Mode A] JSDoc quoting the preload template.
---

## Goal

**Feature Goal**: Pressing the configured `keys.discuss` (default `ctrl+shift+e`) from ANY panel view (short / deep / overview, any focus) suspends the panel (S1's suspend path, widget appears) and preloads the main editor with the EXACT h2.35 discuss template quoting the current question. The user then edits/submits normally — their turn, their words; the agent side-chats freely and reopens the panel when done.

**Deliverable**:
- CREATE `src/panel/discuss.ts` — pure template builder + handoff coordinator.
- EDIT `src/panel/keys.ts` — replace the no-op `onDiscuss` in `defaultRoutedActions` with an injected seam (keep keys.ts itself UI-free, mirroring the existing seam style).
- EDIT `src/panel/panel.ts` — add optional `setEditorText?` to `PiUISurface`; wire `routed.onDiscuss` at the router-construction site using the established host-refinement pattern.
- CREATE `src/panel/discuss.test.ts` — template builder unit tests + handoff coordinator tests.

**Success Definition**: With the panel open on question q3 (choice, 2 options, one recommended), pressing `ctrl+shift+e` closes the panel, the suspend widget line appears, and the main editor contains exactly:

```
> Should we use sqlite or json?
★ sqlite
json
(discussing q3 — agent: side-chat freely; reopen panel when done)
```

`npx tsc --noEmit` clean; `npx vitest run` fully green (including S1 suspend suite, S2-command suite, and S1-reopen tool tests — parallel item, do not touch `src/tool.ts`/`src/index.ts`).

## User Persona

**Target User**: pi TUI user deep in the interrogation panel who wants the agent's take on one question before answering.
**Use Case**: FR-15 per-question "discuss in chat" — suspend + preload the question as a quoted prompt for a focused side chat.
**User Journey**: press `ctrl+shift+e` → panel suspends (widget shows resume hint) → editor pre-filled with the quoted question + options + handoff note → user edits freely and submits (their turn) → agent side-chats → user resumes via `ctrl+shift+q` / `/interrogate` / agent `{reopen:true}` with drafts intact.
**Pain Points Addressed**: previously the only escape was a bare break-out — the user lost the question context the moment they left the panel, and the agent had no idea which question was under discussion.

## Why

- h2.35 (final bullet, EXACT contract): "Discuss-in-chat (`ctrl+shift+e`): suspend + `setEditorText` with: `> {prompt}` / options one per line, ★ marked / `(discussing q{id} — agent: side-chat freely; reopen panel when done)`".
- h2.55 Q36: discuss-in-chat handoff preloads the question into the editor — setEditorText confirmed available (pi-api-validation.md §ctx.ui line 43).
- h3.1 FR-15: per-question handoff as a quoted prompt for a focused side chat.
- AC-4 (break-out/resume cycle) side-chat entry step; part of the P1.M7.T6 runbook.
- The router dispatch for `keys.discuss` already exists and works (keys.ts:364) — only the action body is a no-op placeholder, so this is a precise, low-risk wire-up.

## What

- **Template builder (pure)**: `buildDiscussTemplate(question: Question): string` —
  - Line 1: `> {prompt}` (prompt verbatim).
  - Then, iff `type === "choice"` and options exist: one line per option, using `option.label`, with `★ ` prefix (star + single space) on the option whose `value === question.recommendation` (same value-match rule as short-view.ts:90/:192), plain label otherwise. No cursor `▸`, no ramification text — the template is for chat, not the panel.
  - Text questions / undefined options: no option lines (prompt line straight to footer).
  - Final line: `(discussing q{id} — agent: side-chat freely; reopen panel when done)` with the literal question id and an em dash `—`.
- **Handoff coordinator**: `discussInChat(pi: PiUISurface, panel: InterrogationPanel): boolean` —
  1. Read `panel.currentId`; if undefined or the question is missing from state → return false (no handoff, panel stays open).
  2. Build the template from the question.
  3. Suspend via the panel's own suspend path (`panel.suspend()` — `done(null)`, identical to the `onBreakOut` action at keys.ts:266-268; the floating `.then` in openPanel runs `markSuspended` + `updateSuspendWidget`).
  4. DEFER the editor write: `void Promise.resolve().then(() => pi.ui.setEditorText?.(template))` — the custom() session must resolve (editor restored) before we overwrite its text, or the restore clobbers the template. Microtask deferral is the minimum; if the TUI runbook (P1.M7.T6) shows clobbering, escalate to `setTimeout(0)` — the seam is one line.
  5. Return true.
- **Wiring**: panel.ts's router-construction site (line ~449) refines the seam exactly like the existing `routed.onFocusText` override: `routed.onDiscuss = (p) => discussInChat(pi, p)` (the `pi` captured in `openPanel` — `PiUISurface` carrier, same value passed to `pi.ui.custom`). keys.ts keeps its interface; only `defaultRoutedActions`'s no-op body is removed/replaced by an injectable hook.
- **Do NOT modify**: `src/tool.ts`, `src/index.ts` (S1-reopen, parallel), `src/command.ts`, `src/panel/suspend.ts`, `src/config.ts` (discuss key fully plumbed), `src/panel/layout.ts`.
- **[Mode A] JSDoc** on `buildDiscussTemplate` / `discussInChat` quoting the exact h2.35 template and explaining: the user submits normally (their turn, their words — we never sendMessage), the overwrite of editor text is deliberate (S3 must preserve it, not revert it), and the deferral ordering (custom() resolution before setEditorText).

### Success Criteria

- [ ] `ctrl+shift+e` from short view with a choice question → panel suspends (widget line visible), editor text = EXACT template (star on recommended option)
- [ ] Works from deep view and overview too — same question (currentId), same template
- [ ] Text question (no options) → prompt line + footer line only
- [ ] Question with options but no `recommendation` → no star anywhere
- [ ] Undefined/missing currentId → no suspend, no editor write, returns false
- [ ] Editor text is NOT clobbered by the custom() editor restore (deferred write)
- [ ] `setEditorText`-less surface (test fake / RPC) → suspend still happens, write silently skipped (optional seam, like setWidget)
- [ ] [Mode A] JSDoc quoting the template
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green

## All Needed Context

### Context Completeness Check

Implementer gets: exact current no-op location, the established host-refinement wiring pattern with line anchors, the exact template with the exact star/recommendation matching rule, the async-suspend deferral gotcha, the PiUISurface extension pattern, and test fixture shapes. ✅

### Documentation & References

```yaml
- file: src/panel/keys.ts
  why: RoutedActions.onDiscuss declared :105; no-op body :272 ("M6.T2.S2 wires the discuss flow"); router dispatch :364 (already returns true); onBreakOut pattern :266-268 (p.suspend())
  pattern: replace no-op with injectable seam — keep keys.ts free of pi/UI imports
  gotcha: do NOT change the router itself or the collision order

- file: src/panel/panel.ts
  why: PiUISurface interface :166-190 (add optional setEditorText after setWidget, same JSDoc style); router-construction site :449-451 (routed.onFocusText override pattern to mirror); module host record :1037+; suspendPanel export :1237
  pattern: optional UI method + guard at call site (`?.`), exactly like setWidget
  gotcha: custom() resolution is ASYNC — openPanel's floating .then runs markSuspended/widget update; the editor write must be deferred past it

- file: src/panel/suspend.ts
  why: S1 contract — suspend semantics, widget rule; header names this item as a suspendPanel consumer; resumePanel untouched
  gotcha: we suspend through panel.suspend() (done(null)), NOT host.suspend() — the key handler already holds the live panel

- file: src/panel/short-view.ts
  why: recommendation matching rule — :90 findIndex((o) => o.value === q.recommendation); :192 star render `opt.value === q.recommendation ? STAR : ""`, STAR = "★ "
  pattern: reuse the SAME value-match rule so panel and template never disagree

- file: src/state.ts
  why: Question/QuestionOption shapes (:31-100) — prompt, type, options[{value,label,ramification?}], recommendation

- docfile: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: ctx.ui.setEditorText confirmed (line 43); editor persistence across custom() sessions open question belongs to S3, not us
  section: "UI" / lines 43, 75

- docfile: plan/001_0d6760db6bc5/prd_snapshot.md
  why: h2.35 exact template; h3.1 FR-15; h2.55 Q36
  section: h2.35, h3.1

- file: plan/001_0d6760db6bc5/P1M6T2S1/PRP.md
  why: parallel item — edits src/tool.ts + src/index.ts only; confirm no overlap before committing
- file: plan/001_0d6760db6bc5/P1M6T2S2/research/notes.md
  why: verified line anchors + deferral rationale + template decisions
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  panel/
    keys.ts        # RoutedActions + router; onDiscuss no-op (EDIT: seam body)
    panel.ts       # PiUISurface (EDIT: + setEditorText?); router wiring :449 (EDIT: onDiscuss override)
    suspend.ts     # S1 suspend/resume (consume, no edits)
    short-view.ts  # ★/recommendation rule reference (no edits)
    discuss.ts     # NEW: template builder + discussInChat coordinator
    discuss.test.ts# NEW
```

### Desired Codebase tree with files to added

```bash
src/panel/
  discuss.ts       # buildDiscussTemplate (pure) + discussInChat (coordinator) + Mode A JSDoc
  discuss.test.ts  # template tests (choice/text/no-recommendation/id footer) + coordinator tests (suspend+deferred write, missing id, optional setEditorText)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: suspend is ASYNC — pi.ui.custom()'s promise resolves later and
// pi restores the editor in that resolution. Writing setEditorText inside
// the key handler BEFORE resolution gets clobbered. Defer via
// `void Promise.resolve().then(() => ...)`; escalate to setTimeout(0) only
// if the TUI runbook shows clobbering.
// CRITICAL: recommendation matches option by VALUE, not label
// (short-view.ts:90). A label match silently drops the star on renames.
// CRITICAL: keys.ts must stay UI-free — inject the discuss closure from
// panel.ts (mirror routed.onFocusText refinement at panel.ts:450).
// CRITICAL: setEditorText is OPTIONAL on PiUISurface (test fakes, RPC) —
// always call with `?.` and never throw when absent.
// Template strings are EXACT contracts (h2.35): `> ` prefix, `★ ` star,
// `— ` em dash, `/interrogate` lowercase, `(discussing q{id} — ...)`.
// Editor overwrite is DELIBERATE and must win over any preservation logic —
// P1.M6.T2.S3 preserves editor drafts on PLAIN suspend, never reverts the
// discuss handoff. Document this in the Mode A JSDoc.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/discuss.ts
  - IMPLEMENT buildDiscussTemplate(question: Question): string  (pure, exported)
      * `> ${question.prompt}` (prompt verbatim, no trimming)
      * iff choice && options?.length: options.map(o => (o.value === question.recommendation ? "★ " : "") + o.label).join("\n")
      * `(discussing q${question.id} — agent: side-chat freely; reopen panel when done)`
      * join blocks with "\n", no trailing newline
  - IMPLEMENT discussInChat(pi: PiUISurface, panel: InterrogationPanel): boolean
      * const id = panel.currentId; const q = id ? panel.state (state accessor — see InterrogationPanel's public state surface, panel.ts) .questions-by-id lookup : undefined
        (check how panel accessors expose the current Question — reuse existing getter; do NOT re-derive from orderedQuestions if a current-question getter exists)
      * if (!q) return false
      * const text = buildDiscussTemplate(q)
      * panel.suspend()                      // done(null), same as onBreakOut
      * void Promise.resolve().then(() => pi.ui.setEditorText?.(text))
      * return true
  - [Mode A] JSDoc on both exports: quote the h2.35 template verbatim; user-submits-normally rationale (no sendMessage, their turn their words); deferral ordering; deliberate editor overwrite (S3 note)

Task 2: EDIT src/panel/panel.ts — surface + wiring
  - PiUISurface.ui: add after setWidget:
      /** Editor preload (h2.35 discuss handoff). Optional: test fakes / RPC. */
      setEditorText?(text: string): void;
  - At the router-construction site (~:449), after the onFocusText refinement:
      routed.onDiscuss = (p) => { discussInChat(pi, p); };
    (pi = openPanel's PiUISurface parameter; import discussInChat from "./discuss.js")
  - PRESERVE: args.keys host override still wins wholesale; everything else untouched

Task 3: EDIT src/panel/keys.ts — seam body only
  - defaultRoutedActions: accept the discuss closure OR keep the no-op default and let panel.ts refine (RECOMMENDED: keep no-op default — existing tests of defaultRoutedActions stay valid; remove the stale "M6.T2.S2 wires" comment, point to panel.ts wiring + discuss.ts)
  - Do NOT touch the router function, collision order, or RoutedActions types

Task 4: CREATE src/panel/discuss.test.ts
  - FOLLOW pattern: src/panel/suspend.test.ts (pure builder + coordinator split) and existing panel.test.ts fake-pi shapes
  - TEMPLATE TESTS (buildDiscussTemplate):
      * choice with recommendation → exact 4-line string (assert full equality against a template literal)
      * choice without recommendation → no "★" anywhere
      * text question (no options) → 2 lines only (prompt + footer)
      * footer exactness: `(discussing q3 — agent: side-chat freely; reopen panel when done)` — em dash, no trailing newline
  - COORDINATOR TESTS (discussInChat):
      * fake panel { currentId: "q3", suspend: vi.fn(), question lookup } + fake pi { ui: { setEditorText: vi.fn() } }
        → returns true; suspend called once; setEditorText called AFTER a microtask tick with the exact template (await Promise.resolve() before asserting — mirrors the deferral)
      * currentId undefined → false, no suspend, no setEditorText
      * pi without setEditorText → returns true, suspend still called, no throw
      * suspend NOT called before template build failure paths (order: lookup → build → suspend → deferred write)

Task 5: RUN gates
  - npx tsc --noEmit && npx vitest run
  - Verify no edits to src/tool.ts / src/index.ts / src/command.ts / src/panel/suspend.ts
```

### Implementation Patterns & Key Details

```ts
// discuss.ts — the two load-bearing details:
// 1) star rule = VALUE match (short-view.ts:90), label shown to the user
const line = (opt.value === q.recommendation ? "★ " : "") + opt.label;
// 2) suspend-then-deferred-write (custom() resolution restores the editor
//    asynchronously; an immediate write is clobbered)
panel.suspend();
void Promise.resolve().then(() => pi.ui.setEditorText?.(text));
```

### Integration Points

```yaml
CONSUMES:
  - keys.discuss routing (config.ts :129 default ctrl+shift+e — complete)
  - panel.suspend() (done(null) suspend path, S1)
  - ctx.ui.setEditorText (pi-api-validation.md :43)
COORDINATES WITH:
  - P1.M6.T2.S1 (parallel): src/tool.ts + src/index.ts edits — zero overlap
  - P1.M6.T2.S3 (later): editor draft preservation must NOT revert this handoff
  - resume path (S1 resumePanel / S2 command / S1 reopen:true) unchanged — resume works identically after a discuss suspend
FUTURE (do not implement): P1.M7.T6 runbook exercises this for AC-4
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit                     # Expected: zero errors
npx vitest run src/panel/discuss.test.ts -v
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/discuss.test.ts -v
npx vitest run src/panel/ -v         # keys/panel/suspend suites unharmed
npx vitest run                       # FULL suite green
```

### Level 3: Integration Testing (System Validation)

```bash
# Factory smoke-load unchanged path still loads
npx tsc --noEmit && node --input-type=module -e "
import factory from './src/index.ts';
const pi = new Proxy({}, { get: (_t, k) => (k === 'on' ? () => {} : () => {}) }) as any;
await factory(pi);
console.log('factory loaded ok');
"
grep -n "onDiscuss" src/panel/panel.ts src/panel/keys.ts src/panel/discuss.ts   # all three present
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual TUI (deferred to P1.M7.T6 runbook, quick sanity here if possible):
# 1. /interrogate-debug-upsert a choice question with recommendation
# 2. panel opens → ctrl+shift+e
# 3. EXPECT: panel closes, widget line appears, editor shows the exact template
#    (star on recommended), user can edit+enter to submit the side chat
# 4. ctrl+shift+q → panel resumes on the same question, drafts intact
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all green
- [ ] Factory smoke-load passes
- [ ] No edits to tool.ts / index.ts / command.ts / suspend.ts / config.ts

### Feature Validation

- [ ] Template byte-exact per h2.35 (prompt line, ★ option lines, footer with em dash)
- [ ] Works from short/deep/overview views (router intercept rule already guarantees)
- [ ] Editor write deferred past custom() resolution (microtask)
- [ ] Missing question → graceful false, no suspend
- [ ] Optional setEditorText guarded with `?.`
- [ ] [Mode A] JSDoc present quoting the template

### Code Quality Validation

- [ ] Pure builder separate from coordinator (mirrors suspend.ts structure)
- [ ] keys.ts stays UI-free; wiring at the panel.ts seam (onFocusText pattern)
- [ ] Reuses value-match recommendation rule (no divergence from short-view)

## Anti-Patterns to Avoid

- ❌ Don't `pi.sendMessage` / trigger a turn — the USER submits the side chat (Q36: their turn, their words)
- ❌ Don't write the editor synchronously inside the key handler (restore clobber)
- ❌ Don't match recommendation by label — value only
- ❌ Don't touch the router, config, or S1/S1-reopen/S2-command files
- ❌ Don't strip or "clean up" the deliberate editor overwrite for S3

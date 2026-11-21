---
name: "P3.M1.T1.S1 — Research storage mechanism, edit-event seams, and write pacing; write the architecture note"
description: "NO-CODE research + architecture-note item. Binding text: spec/state-and-persistence.md §Local input recovery (:133-149). Resolve the seven design axes — storagePath (extension-local dir under the agent dir, NEVER the session file), atomicity (tmp+fsync+rename), captureSeams (TextField onChange wrap-and-chain — covers paste), pacing (debounce + bounded max dirty age, never idle/blur/shutdown-dependent), ordering (per-key monotonic seq; incidental empties never overwrite), keying (session/branch + question + field), retirement + failureSemantics — against the REAL composed-editor API and pi's documented storage rules, then write plan/006_45773b259b06/architecture/input-recovery.md with exactly those keys. Consumed by P3.M2.T1.* and P3.M3.T1.*."
---

## Goal

**Feature Goal**: Produce the complete, implementable design for local input recovery (durable capture of editor input across crash/hibernation) so that P3.M2 (capture + recovery-point engine) and P3.M3 (restore/seeding) can be implemented one-pass without re-researching any seam. Every open design question in the item contract is RESOLVED in the note with evidence from the real code and pi docs — not deferred.

**Deliverable**: `plan/006_45773b259b06/architecture/input-recovery.md` — a single architecture note with top-level keys `{storagePath, atomicity, captureSeams, pacing, ordering, keying, retirement, failureSemantics}` (plus a short consumers section mapping each to its P3.M2/P3.M3 task and the acceptance cases it unlocks). NO source-code changes, NO README/spec edits.

**Success Definition**: A reader who knows nothing but the note + codebase can implement P3.M2.T1.S1-S3 and P3.M3.T1.S1-S2 without inventing any mechanism decision: the note names the exact files/classes to touch (TextField, DraftStore, panel duty tracking, sidechat composer), the exact pi API surfaces (getEditorComponent, onChange, getExpandedText, sessionManager.getBranch, PI_CODING_AGENT_DIR), the exact write protocol, and the retirement/no-side-effects rules. Gates (`npm test`, `npm run typecheck`, `npm run lint`) remain green with ZERO source diff (`git diff --name-only` shows no tracked src/README changes).

## User Persona

**Target User**: The P3.M2/P3.M3 implementer agents (primary), and the human owner reviewing the design before implementation money is spent (secondary).

**Use Case**: Implementation of crash-safe draft capture must not stall on unresolved questions like "does the composed editor even expose an on-change hook?" or "where on disk may an extension write?".

**User Journey**: implementer opens the note → reads storagePath (resolved, with env override) → reads captureSeams (TextField wrap-and-chain, with the never-clobber caveat and the paste argument) → reads pacing/ordering/atomicity protocols → implements each P3.M2 subtask against its named section.

**Pain Points Addressed**: Under-specified context is why implementations stall at 80% — this item front-loads ALL mechanism decisions so P3.M2/P3.M3 are pure execution.

## Why

- spec/state-and-persistence.md §Local input recovery is marked "**New requirements, not shipped**" — the shipped DraftStore is explicitly memory-only by design (draft-store.ts: "Restart loss is a documented limitation (Q6=B)"; "nothing in this module touches disk or persistence.ts"). The PRD delta supersedes Q6=B for input recovery.
- The plan (P3.M1 "Research and architecture") gates P3.M2/P3.M3 on this note; without resolved seams the capture wiring risks breaking the cache-isolation guard tests (SIDECHAT-002: nothing may write to the session file) and the composed-editor contract (never clobber the composed factory's onChange — text-field.ts:130-136 comment is the warning).
- Core commitment 6 ("drafts are sacred") extends to abrupt process termination and failed hibernation.

## What

### Behavior contract for the NOTE (the item itself is a document)

The note MUST resolve, with evidence, exactly these axes (item contract §1a-g):

1. **storagePath** — an extension-local directory. Resolution (already researched; verify then record): agent dir via `process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent")` (env-vars.md:81 documents the override; config.ts:10/:326 show the extension already resolves this dir for settings), under e.g. `<agentDir>/data/interrogator/`. MUST state: never the session file, never `pi.appendEntry()` (that writes session-file entries — pi extensions.md §State table routes "Data outside one session" to External storage; SIDECHAT-002 + sidechat-cache-isolation.test.ts are the guard tests that would fail). Record that this is the extension's FIRST fs user (draft-store.ts and persistence.ts both avoid fs today).
2. **atomicity** — temp file in the SAME directory, `fs.writeFileSync`-equivalent + `fsyncSync` on the fd before close, then `fs.renameSync` (atomic on POSIX), optional dir-fsync. Interrupted write ⇒ previous or new complete value, never torn; stray `.tmp` files are ignored on recovery.
3. **captureSeams** — the real composed-editor API (verified): `EditorComponent` exposes optional `onChange` and `getExpandedText?.()` (text-field.ts:112-136 feature-detects both; panel.ts:3031 captures `pi.ui.getEditorComponent?.()` once per openPanel). Capture installs a **wrap-and-chain** onChange: `const prev = editor.onChange; editor.onChange = () => { prev?.(); capture(...); }` — this is the ONLY safe pattern given TextField's rule "never clobber a callback the composed editor's factory already installed". onChange fires on every buffer mutation, which INCLUDES paste — no separate paste event needed. All five editor duties flow through TextField instances (panel write-in | elaboration | batch note, duty tracked by panel.ts's buffer-ownership comment block; side-chat composer: sidechat.ts:109 imports createEditorComponent/TextField) — so ONE hook + per-instance key context covers everything. If verification of the stock Editor's onChange behavior differs, record the discrepancy and the fallback (capture also on every TextField.handleInput forwarding / render-cycle dirty check).
4. **pacing** — debounce with a bounded max dirty age: flush within N ms of the FIRST unsaved edit (recommend 250ms debounce / 1000ms hard interval; record the chosen numbers as defaults, overridable via config later — do NOT add config keys in this item). Suspend/send-cleanup/navigation flushes are accelerators ONLY. The requirement is "progress during continuous typing" — an implementation that waits for idle/blur/shutdown violates the spec bullet. Timer cancelled idempotently in session_shutdown (extensions.md cleanup rules).
5. **ordering** — per-key monotonic `seq` (in-memory counter, per store instance, seeded from the durable file's last seq on load). Replace durable value only when `seq >= durable.seq`. Incidental empty buffers (initialization, view change, send cleanup) never mint a seq ⇒ never saved; a deliberate deletion-to-empty DOES mint a seq and saves `""` (spec:140 "an intentional deletion to empty is an edit"). A delayed older write can therefore never clobber a newer edit (acceptance case 3).
6. **keying** — `{branchId, questionId | "-", field}` with field ∈ {writein, elaboration, note, sidechat-composer}; branchId derived from `ctx.sessionManager.getBranch()` (types at reconstruct.ts:259-260; semantics documented reconstruct.ts:17-25 — newest entry identifies the leaf). One JSON file per key (or per branch, with keys inside — pick one and justify: per-key files make atomic replace independent and cheap). Cross-branch restore forbidden even for identical question ids (case 3).
7. **retirement + failureSemantics** — retire a recovery value ONLY on: deliberate discard (explicit user clear — mirror DraftStore's `{explicit: true}` destruction guard, draft-store.ts), replacement by the user's newer durable save, or successful handoff (commit as answer / successful chat send) — and never delete the only durable copy BEFORE the handoff itself is durably recorded. Failure: keep last durable value + live edit; never render any "saved" indication (no widget, no flash); recovery guarantees only the latest COMPLETED save. No-side-effects rule (spec:139): save/restore must not advance, commit, queue, submit, send, resend or call a model — include an explicit audit checklist mapping to the code paths that are FORBIDDEN to be called (applyAnswer, sendMessage, the submit pipeline, modelRuntime.streamSimple, panel advance). Also note the P3.M4 interaction: recovered blank drafts seed the editor but never become answers (blank rejection is applied at applyAnswer, sibling item — one sentence, no design).

Also required in the note: a **consumers map** (each axis → P3.M2.T1.S1/S2/S3 and P3.M3.T1.S1/S2, and which acceptance cases 1-5 each unblocks) and a short **verification log** (what was read to confirm each seam: file:line for code, doc heading for pi docs).

### Success Criteria

- [ ] `plan/006_45773b259b06/architecture/input-recovery.md` exists with all seven top-level keys + consumers map + verification log.
- [ ] Every axis carries evidence anchors (file:line or doc section), not bare assertions.
- [ ] Storage is extension-local; the note explicitly forbids the session file / appendEntry and cites the isolation guard tests.
- [ ] Capture design is validated against the actual `EditorComponent` surface (onChange presence, getExpandedText optionality) — if the real API lacks a needed hook, the note records the fallback rather than assuming.
- [ ] Pacing design satisfies "progress during continuous typing" with concrete default numbers.
- [ ] Ordering design provably prevents older-write/incidental-empty clobber (per-key seq rule stated precisely).
- [ ] Zero source/README/spec changes: `git diff --name-only` shows no tracked files modified (plan/ artifacts only).

## All Needed Context

### Context Completeness Check

Validated: the binding spec section was read in full; every seam question was answered against the real tree (TextField onChange/getExpandedText, panel.ts editorFactory capture, sidechat composer construction, DraftStore inertness/destruction guards, sessionManager.getBranch typing, agent-dir resolution, pi extensions.md storage table + cleanup rules, env-vars PI_CODING_AGENT_DIR). Resolutions are pre-made in the research note; the implementer verifies, drafts, and writes the architecture note.

### Documentation & References

```yaml
- file: spec/state-and-persistence.md
  why: §Local input recovery (:133-149) — the BINDING text (capture-on-edit incl. paste; recovery point atomicity/monotonicity; drafts-not-answers + retirement; re-edit/commit seeding; blank rejection) + acceptance cases 1-5 that the note's design must make implementable
  gotcha: READ-ONLY — never edit spec/

- file: src/panel/text-field.ts
  why: THE capture seam — TextField wraps EditorComponent; feature-detects onChange/getExpandedText (:112-136); installs onChange only-if-undefined (:133-136) with the "never clobber" comment — the wrap-and-chain design exists precisely because of this
  pattern: createEditorComponent (:42-98) — stock Editor fallback when no composed factory

- file: src/panel/panel.ts
  why: editorFactory captured once per openPanel (:3031, `pi.ui.getEditorComponent?.()`); buffer-ownership/duty tracking comment (~:803-811) — where per-duty key context lives; DraftStore seam
  gotcha: the note must name WHERE capture key context (question/duty) is injected without coupling the store to panel internals

- file: src/panel/sidechat.ts
  why: side-chat composer uses the SAME TextField/createEditorComponent machinery (:109 import) — one capture hook covers the fifth duty; chat-view.ts is pure render (no editor)
  gotcha: SIDECHAT-002 — composer recovery must restore input only, never the ephemeral conversation

- file: src/draft-store.ts
  why: the shipped memory-only store the design extends; "Deliberately inert" module contract (no events, no fs) and the {explicit:true} destruction guard to mirror for retirement
  gotcha: restart loss is Q6=B BY DESIGN today — the note supersedes it for input recovery and must say so

- file: src/reconstruct.ts
  why: sessionManager.getBranch typing (:259-260) + branch-walk semantics (:17-25) — the branchId derivation source; session-start seam for P3.M3 restore

- file: src/config.ts
  why: agent-dir resolution precedent (:10 global <agentDir>/settings.json; :326 API) — storagePath follows the same dir

- docfile: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  why: §State table (tool-result details / appendEntry / sendMessage / EXTERNAL STORAGE routing — why durable drafts are external storage, never appendEntry); §Context and session changes (ctx.sessionManager); §Errors and cleanup (idempotent session_shutdown cleanup)
  section: "State", "Context and session changes", "Errors and cleanup"
- docfile: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md
  why: component/invalidate contract if the render-cycle fallback seam is needed; PI_TUI_WRITE_LOG for diagnostics
- docfile: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/environment-variables.md
  why: :81 — PI_CODING_AGENT_DIR overrides the agent dir (default ~/.pi/agent); storagePath must honor it
  section: env table row PI_CODING_AGENT_DIR

- file: src/panel/sidechat-cache-isolation.test.ts
  why: the guard tests the design must keep green — anything touching the session file or cache bytes fails here

- file: plan/006_45773b259b06/P3M1T1S1/research/findings.md
  why: this item's pre-research — all seven axes resolved with anchors; the implementer verifies then transcribes into the note
- file: plan/006_45773b259b06/P2M1T1S2/PRP.md
  why: parallel sibling (README-only, docs audit) — disjoint scope; the note must NOT edit README (its limitations "drafts gone" row is fenced for P3.M5.T1.S2)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/text-field.ts   # TextField + createEditorComponent — the capture seam (READ)
src/panel/panel.ts        # editorFactory capture, duty tracking, DraftStore seam (READ)
src/panel/sidechat.ts     # composer = same TextField machinery (READ)
src/draft-store.ts        # memory-only store; destruction guards; inertness contract (READ)
src/reconstruct.ts        # getBranch typing + semantics (READ)
src/persistence.ts        # existing persistence = session entries ONLY (anti-pattern reference) (READ)
spec/state-and-persistence.md  # binding requirements (READ-ONLY)
```

### Desired Codebase tree

```bash
plan/006_45773b259b06/architecture/input-recovery.md   # CREATE — the sole deliverable
plan/006_45773b259b06/P3M1T1S1/research/findings.md    # already written (may be extended)
# NOTHING under src/, README.md, spec/ changes
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: never write the session file or use pi.appendEntry() for drafts
// (extensions.md State table + SIDECHAT-002; sidechat-cache-isolation.test.ts fails).
// CRITICAL: composed editors (pi-vim) already install their OWN onChange —
// wrap-and-chain, never replace (text-field.ts:130-136 comment is the precedent).
// GOTCHA: EditorComponent extras are OPTIONAL (getExpandedText?, focused, onChange) —
// every read must feature-detect; the note must state the fallback when absent.
// GOTCHA: paste is just a buffer mutation — onChange covers it; do not design a
// separate paste event.
// GOTCHA: "progress during continuous typing" forbids idle/blur/shutdown-triggered-only
// saves; bounded max dirty age is the requirement-shape.
// GOTCHA: incidental empty buffers (init/view-change/send-cleanup) must not mint a
// sequence number; deliberate delete-to-empty MUST (spec :140).
// GOTCHA: fs is safe from an extension (plain in-process TS) but this is the codebase's
// FIRST fs usage — note the precedent.
// GOTCHA: this item writes a PLAN ARTIFACT only; README/spec/src untouched.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the pre-research (read pass, no writes)
  - READ: spec/state-and-persistence.md :133-149 (binding text + acceptance cases 1-5)
  - READ: src/panel/text-field.ts (full — onChange/getExpandedText seams), src/panel/panel.ts
    (:3031 editorFactory, :~803-811 duty tracking), src/panel/sidechat.ts (:109 import — composer),
    src/draft-store.ts (inertness + {explicit:true} guard), src/reconstruct.ts (:259-260, :17-25),
    src/persistence.ts (what existing persistence does — and why drafts must NOT join it)
  - READ: pi docs extensions.md §State/§Context/§Errors and cleanup; environment-variables.md
    PI_CODING_AGENT_DIR row; tui.md (only if exploring the render-cycle fallback)
  - IF any pre-researched seam contradicts the code (e.g. EditorComponent lacks onChange in the
    installed @pi-tui version — check node_modules type defs), record the discrepancy and design
    the fallback in the note instead of proceeding on a false assumption

Task 2: WRITE plan/006_45773b259b06/architecture/input-recovery.md
  - STRUCTURE: front-matter header (one paragraph: what this note is, binding spec pointer) +
    top-level sections EXACTLY {storagePath, atomicity, captureSeams, pacing, ordering, keying,
    retirement, failureSemantics} + "No-side-effects audit" + "Consumers map" + "Verification log"
  - EVERY section: the resolved decision, the evidence anchors (file:line / doc heading), and the
    downstream task(s) it unblocks — use research/findings.md as the draft, sharpened against
    anything Task 1 corrected
  - INCLUDE: acceptance-case cross-reference (which design element makes cases 1-5 testable);
    one-sentence P3.M4 interaction note (recovered blanks seed editors, never become answers)
  - DO NOT: restate spec prose verbatim at length; design P3.M4's applyAnswer guard; add config
    keys; touch README

Task 3: SELF-REVIEW against the "No Prior Knowledge" test
  - CHECK: could an agent with ONLY this note + codebase implement P3.M2.T1.S1 (capture wiring)
    without asking a question? storagePath, the wrap-and-chain snippet shape, the duty→key mapping,
    the pacing numbers, the seq rule, the retirement triggers — all named?
  - CHECK: every open question in the item contract §1 (a)-(g) has a RESOLVED answer, not options

Task 4: VALIDATE
  - git diff --name-only → NO tracked src/, README.md, spec/ changes
  - npm test && npm run typecheck && npm run lint → green (nothing should have changed; proves it)
```

### Implementation Patterns & Key Details

```ts
// The capture seam the note must specify (shape, not shipped code):
// const prev = editor.onChange;              // may be the composed factory's own callback
// editor.onChange = () => { prev?.(); capture(getExpandedText(editor), currentKey); };
// currentKey = { branchId, questionId | "-", field: "writein"|"elaboration"|"note"|"sidechat" }
// Full text: editor.getExpandedText?.() ?? editor.getText() — expanded (real newlines/Unicode),
// never the display preview.

// The write protocol (shape):
// seq = nextSeq(key)                       // monotonic per key; skipped for incidental empties
// tmp = `${file}.tmp`; write+fsyncSync; renameSync(tmp, file)   // atomic replace
// on error: keep durable + live; lastSaveFailed = true; NO "saved" surface ever

// Pacing (shape): 250ms trailing debounce + 1000ms max dirty age; accelerators (suspend,
// navigation write-through, send cleanup) flush early but are never the only trigger;
// session_shutdown cancels timers idempotently.
```

### Integration Points

```yaml
PLAN-ONLY (no source integration in this item):
  - plan/006_45773b259b06/P3M2.T1.S1/.S2/.S3: consume captureSeams / (atomicity+ordering+failureSemantics) / (retirement + audit)
  - plan/006_45773b259b06/P3.M3.T1.S1/.S2: consume keying + seeding rules + session-start restore seam
  - P3.M5.T1.*: the note's verification log feeds the final docs sync
```

## Validation Loop

### Level 1: Syntax & Style

```bash
# Markdown only — no lint target; sanity:
npx prettier --check plan/006_45773b259b06/architecture/input-recovery.md 2>/dev/null || true
```

### Level 2: Unit Tests (regression proof of no-code)

```bash
npm test && npm run typecheck && npm run lint
# Expected: green, identical to pre-item baseline (this item changes no code)
```

### Level 3: Integration (scope guard)

```bash
git diff --name-only
# Expected: NO tracked file changes (only untracked plan/006_* artifacts)
git status --porcelain spec/ README.md src/
# Expected: empty
```

### Level 4: Domain validation (note quality)

```bash
# Manual checklist — every axis {storagePath, atomicity, captureSeams, pacing, ordering, keying,
# retirement, failureSemantics} present with file:line or doc-heading evidence; acceptance cases
# 1-5 cross-referenced; no unresolved "options" language ("A or B") left in decision sections.
grep -n "storagePath\|atomicity\|captureSeams\|pacing\|ordering\|keying\|retirement\|failureSemantics" \
  plan/006_45773b259b06/architecture/input-recovery.md
```

## Final Validation Checklist

- [ ] `architecture/input-recovery.md` written with all seven keys + consumers map + verification log.
- [ ] Every decision evidence-anchored; no open question from the item contract left unresolved.
- [ ] Session-file/appendEntry explicitly ruled out with guard-test citation.
- [ ] Wrap-and-chain capture specified; paste argument stated; fallback documented if onChange is absent in the installed pi-tui.
- [ ] Pacing numbers concrete; ordering rule precise (seq minting rules).
- [ ] Retirement triggers + never-clear-before-handoff + never-claim-saved stated.
- [ ] No-side-effects audit list enumerates forbidden call targets.
- [ ] Zero tracked-file diff; gates green.

## Anti-Patterns to Avoid

- ❌ Don't write design options ("A or B") — the note's job is resolutions; if genuinely blocked, escalate instead of hedging.
- ❌ Don't design P3.M4's applyAnswer blank guard or add config keys — out of scope.
- ❌ Don't touch src/, README.md, or spec/ — this is a plan artifact; P3.M5.T1.S2 owns the README flip.
- ❌ Don't restate spec prose at length — operationalize it (mechanisms, anchors, consumers).
- ❌ Don't assume the composed editor's API — feature-detect/verify against installed type defs first.

---

**Confidence Score**: 9/10 — all seven axes were pre-researched against the live tree and pi docs with exact anchors (findings.md); the implementer's residual work is verification + transcription, and the single identified risk (installed @pi-tui's exact EditorComponent surface) is flagged with an explicit verify-then-fallback instruction.

# PRP — Bugfix P1.M1.T2.S1: Align the chat view's streaming esc gesture with ui-spec §Side chat Esc ladder

## Goal

**Feature Goal**: Make the chat view's advertised streaming-abort gesture (`esc abort` in the footer) work in the DEFAULT focused state. Today a single esc in chat focus forwards to the editor (ESC-002 generic rule, keys.ts :534-540), so aborting a runaway reply requires the undocumented blur-then-esc. Fix shape (i) — spec-verbatim: while `view === "chat"` AND the live record is streaming, a single esc aborts the in-flight reply (chat-view esc-ladder rung takes precedence over generic editor forwarding; the abort rung does NOT consume the `lastEscAt` double-esc window; insert-mode esc returns when idle).

**Deliverable**: One streaming pre-check inside the keys.ts fixed-esc branch + JSDoc updates (esc branch ~:520-541, escapeDescend's SIDECHAT-001 comment) + regression test in `src/panel/ac-sidechat.test.ts`. Footer hint unchanged (now true).

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Streaming + chat input focused + single esc → abort fired (`signal.aborted` on the fake port's captured AbortSignal)
- Idle + chat focus + single esc → still forwards to the editor (pi-vim insert-exit intact)
- Streaming + OPTIONS focus in chat view → escapeDescend's existing rung still aborts (regression)
- Double-esc blur window behavior unchanged when idle; abort rung never touches `lastEscAt`

## Why

PRD BUG-001's "same focus-blind pattern" clause: the footer advertises `esc abort` while streaming regardless of focus, but the focused single esc forwards to the editor. ui-spec.md:115 ("Esc ladder. Streaming: first `esc` aborts the in-flight reply") is the chat-view-specific rule and wins over the generic ESC-002 editor-forwarding (ui-spec:44/86) inside the chat view while streaming; ESC-002 forwarding resumes when the stream is idle. This restores spec truth without disturbing pi-vim semantics at rest.

## What

In `src/panel/keys.ts` fixed-esc branch (~:527-541), add a streaming pre-check BEFORE the editor-focused double-esc logic:

```ts
if (matchesKey(data, Key.escape)) {
  // SIDECHAT-001 esc ladder (ui-spec:115): inside the chat view a single
  // esc ABORTS the in-flight reply — the chat-view rule outranks ESC-002's
  // generic editor forwarding while streaming; forwarding returns when the
  // stream is idle (abortChatStream itself gates on streaming and returns
  // false → fall through untouched). The abort rung never touches
  // lastEscAt — the double-esc blur window stays intact when idle.
  if (editorFocused && panel.view === "chat" && panel.abortChatStream()) return true;
  ... existing !editorFocused / double-esc / return false logic unchanged ...
}
```

`abortChatStream()` (panel.ts:1768) returns `false` unless `getSidechatRecord()?.streamState === "streaming"` — it is its own gate, so idle falls through cleanly. keys.ts stays free of sidechat imports (both are panel methods).

Docs ([Mode A]): update the fixed-esc branch JSDoc (~:520-541) and the escapeDescend SIDECHAT-001 comment to document shape (i) precedence. The footer hint string stays `esc {abort|exit}` — it is now true. README §Side chat prose is P1.M6.T1's; record the chosen shape in the JSDoc for that task to consume.

### Success Criteria

- [ ] Focused + streaming + one esc → `signal.aborted === true`, view stays "chat", no blur
- [ ] Focused + idle + one esc → `route===false` (editor forwarding; regression)
- [ ] Options focus + streaming in chat view → escapeDescend abort rung unchanged (regression)
- [ ] Abort rung does not set `panel.lastEscAt` (idle double-esc window intact)
- [ ] JSDoc updated in both sites; full suite + typecheck green

## All Needed Context

### Context Completeness Check

Small, single-seam fix; all line references verified (research/notes.md holds verbatim excerpts). Agent needs this PRP plus `src/panel/keys.ts`, `src/panel/panel.ts` (read-only: abortChatStream), `src/panel/ac-sidechat.test.ts`.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-focus.md
  why: "§Streaming-abort half (:97-111) — the two sanctioned shapes, the spec-tension analysis, and the regression requirement"

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M1T2S1/research/notes.md
  why: verbatim esc-branch/escapeDescend/abortChatStream excerpts + chosen implementation

- file: src/panel/keys.ts
  why: "the ONLY source file. Fixed-esc branch :520-541 (pre-check goes first inside the branch); escapeDescend :297-315 comment update"
  gotcha: "keys.ts must stay free of sidechat imports — abortChatStream is a panel method"

- file: src/panel/panel.ts
  why: "READ-ONLY: abortChatStream :1768 (self-gating on streamState — returns false when idle); blurChatInput :329-336"

- file: src/panel/ac-sidechat.test.ts
  why: "fake-port idioms (also sidechat-engine.test.ts :324-394 controller describes): held-open stream with a captured AbortSignal"
  gotcha: "independent of P1.M1.T1.S1/S2 (enter/confirm seam) — do not touch their tests"
```

### Current/Derived Codebase tree

```bash
src/panel/
├── keys.ts             # MODIFY: streaming pre-check + JSDoc ×2
└── ac-sidechat.test.ts # MODIFY: + regression tests
```

### Known Gotchas

```ts
// CRITICAL: order the pre-check BEFORE the double-esc window check — the
//   abort must win while streaming; a focused user pressing esc once aborts.
// CRITICAL: do NOT set panel.lastEscAt on the abort rung — when the stream
//   goes idle, the ordinary esc-forwarding + double-esc blur window must be
//   exactly as before.
// GOTCHA: rely on abortChatStream's own streaming gate — never read
//   getSidechatRecord from keys.ts (import discipline).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: FAILING REGRESSION TEST FIRST (src/panel/ac-sidechat.test.ts)
  - fixture: panel over a choice question, fake streaming port held open with
    a captured AbortSignal (engine-test idiom); open chat ('e'), send a message,
    confirm streamState "streaming" and focus "chat"
  - handleInput("\u001b") → expect route consumed AND signal.aborted === true
    (FAILS today: esc forwards, no abort)
  - siblings: idle + focused esc → route === false; options-focus streaming esc
    → abort (existing ladder); post-abort idle esc forwards

Task 2: IMPLEMENT the pre-check in keys.ts fixed-esc branch (+ JSDoc both sites)

Task 3: RUN gates: npx vitest run src/panel/ac-sidechat.test.ts src/panel/keys.test.ts -v;
  npm run typecheck && npm test
```

### Integration Points

```yaml
MODULES (contracts only):
  - P1.M6.T1/P1.M6.T1.S2: "README/spec prose records the chosen shape (i) from the JSDoc; hint string unchanged so S2 needs no flip unless wording review disagrees"
NO CHANGES to: panel.ts, chat-view.ts hint, escapeDescend logic, confirm-row seams (T1.S1/S2)
```

## Validation Loop

```bash
npm run typecheck
npx vitest run src/panel/ac-sidechat.test.ts src/panel/keys.test.ts -v
npm test
```

## Final Validation Checklist

- [ ] TDD red→green: focused streaming single-esc aborts (signal.aborted)
- [ ] Idle forwarding, options-focus rung, double-esc window all regression-green
- [ ] JSDoc documents shape (i) precedence at both sites; only keys.ts + ac-sidechat.test.ts touched

## Anti-Patterns to Avoid

- ❌ Don't import sidechat modules into keys.ts — use the panel method
- ❌ Don't touch lastEscAt on the abort rung
- ❌ Don't reword the footer hint (shape i keeps it true) or touch T1's enter seams
- ❌ Don't gate on anything but view === "chat" + abortChatStream's own streaming check

---

**Confidence Score**: 10/10 — single-seam fix with a self-gating panel method, verbatim excerpts and test idioms verified in the working tree.

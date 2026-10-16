---
name: "P1.M2.T2.S1 — Second TextField via the shared EditorFactory with chat-focus discipline (SIDECHAT-001 chat input)"
description: "In src/panel/panel.ts: build a SECOND TextField (this.chatField) in the constructor via the same createEditorComponent path/factory (the architecture doc's sanctioned pattern — two factory calls per panel); add \"chat\" as a fourth PanelFocus member with focusChatInput()/blurChatInput() methods; focusChatInput is a NO-OP unless view === \"chat\" (invisible-editor hazard) and setView to any non-chat view blurs chat focus; handleInput gains a chat-focus branch — enter is intercepted at panel level (interim: consumed with the P1.M2.T3.S1 seam marker; never reaches accept/saveTextDraft/writeInEnter), all other unmatched input (incl. up/down arrows) forwards to chatField, blur never suspends. NO DraftStore/draftSlots/history interaction. Tests: two distinct instances from one fake factory, focus exclusivity, enter commits no draft, arrows forwarded to the editor. Mode A focus-model doc note (fourth focus target)."
---

## Goal

**Feature Goal**: The side-chat view (SIDECHAT-001) needs a text input surface. Per the architecture ruling, that is a SECOND `TextField` instance built from the SAME captured `EditorFactory` in the panel constructor — with strict chat-focus discipline: the chat editor is focused ONLY while the panel is in the chat view (adding that view is P1.M2.T4.S1), never interacts with drafts or history, and its enter key is intercepted at panel level so it can never answer a question.

**Deliverable**: Modified `src/panel/panel.ts` (second TextField, `"chat"` PanelFocus member, focusChatInput/blurChatInput, handleInput chat branch, setView blur hook, Mode A focus-model doc note) + tests in `src/panel/panel.test.ts` (or a new `chat-input` describe in actions.test.ts — follow where editor-construction tests live today).

**Success Definition**: `npm test` + `npm run typecheck` green; one fake factory yields TWO distinct editor instances (embedded + chat); `focusChatInput()` is a no-op while `view !== "chat"` and focuses+claims `"chat"` focus otherwise; `setView` away from chat releases chat focus; `enter` in chat focus consumes without committing any draft or answer; up/down/other unmatched input reaches the chat editor, not the transcript router; blurring never resolves the custom() promise.

## User Persona

**Target User**: TUI user mid-side-chat (`e` on a question, SIDECHAT-001) — they type a message to the side model in their OWN composed editor (vim modes etc. preserved, same as the answer editor) and press enter to send.

**Use Case**: Chat view opens (P1.M2.T4.S1) → focus moves to the chat input → user types (multi-line via shift+enter/ctrl+j stock behavior) → enter sends (routing lands in P1.M2.T3.S1) → they keep typing the next message; esc ladder (S3) exits.

**User Journey**: type → enter → type → enter; the chat editor never touches question drafts; leaving the view (or the view being replaced) blurs the chat input so it can never hold invisible focus (BUG-011 class).

**Pain Points Addressed**: Without a second instance, the side chat would have to reuse the answer editor (entangling drafts/duties/buffer scoping — R4 hazard) or a bare non-composed input (loses the user's vim keybindings).

## Why

- Architecture `panel-view-integration.md` §Second editor (verbatim rulings): "A second `TextField` built in the same constructor with the same factory is the sanctioned pattern"; "only focus it while `view === 'chat'`"; "the embedded editor's history API is never invoked — same for the chat editor"; "Enter is intercepted at panel level in `handleInput` BEFORE the router — the chat-input enter/send branch goes there".
- One-editor-per-panel-lifetime is LOAD-BEARING (panel.ts:611–614 comment; BUG-011 invisible-editor note at keys.ts:534–538) — the discipline here (view-gated focus + blur-on-view-exit) is what keeps the second instance safe.
- Consumed by: P1.M2.T3.S1 (enter/send + esc-ladder routing replace the interim enter body) and P1.M2.T4.S1 (PanelView "chat" member; render branch embeds `chatField.render(width)`; its open/replace path calls `focusChatInput`).

## What

All changes in `src/panel/panel.ts` (plus tests). The `"chat"` PanelView union member does NOT land here (P1.M2.T4.S1) — this item works against `view === "chat"` as a compile-time-impossible-today comparison; see Gotcha G1 for the interim typing strategy.

### 1. Constructor — the second instance (:606–631 region)

Immediately after the existing `this.textField = new TextField({...})` block:

```ts
// SIDECHAT-001 (P1.M2.T2.S1) — the CHAT INPUT: a second TextField from the
// SAME captured factory (architecture ruling: sanctioned pattern). It shares
// live tui/theme/keybindings (both factory calls happen here inside the
// custom() body), and it is focused ONLY while the panel is in the chat view
// (P1.M2.T4.S1) — a focused-but-unrendered editor is the BUG-011 hazard.
// History isolation (h2.31 discipline): its history API is never invoked;
// messages are sent, not recalled. It NEVER touches draftSlots or the
// DraftStore seam — chat content is ephemeral by design (SIDECHAT-002).
this.chatField = new TextField({
  editor: createEditorComponent(
    args.editorFactory,
    args.config,
    args.tui,
    args.theme,
    args.keybindings as KeybindingsManager,
  ),
  theme: args.theme,
  onInvalidate: () => this.invalidate(),
});
```

Declare the field beside `textField` with the same visibility style (`private readonly chatField: TextField` — expose a readonly getter or make it `readonly` public if S4's render branch reads it; prefer a public readonly field `readonly chatField: TextField` so P1.M2.T4.S1 renders it without new accessors).

### 2. Focus model — fourth member (:111–112)

```ts
/**
 * Focus region inside the panel. "chat" is the SIDECHAT-001 input target
 * (fourth focus target): exclusive with the three answer-side duties,
 * reachable only while view === "chat" (P1.M2.T4.S1) via
 * {@link focusChatInput}. While "chat" holds focus, unmatched input
 * (including up/down arrows — ESC-002-family discipline) forwards to the
 * chat editor, and `enter` is intercepted at panel level (send routing:
 * P1.M2.T3.S1) — it can NEVER commit an answer or a draft. See the
 * SIDECHAT contract (spec h2.38 / sidechat-contracts.md).
 */
export type PanelFocus = "options" | "text" | "note" | "chat";
```

Two methods, beside `focusTextField`/`blurTextField` (~:1031–1060):

```ts
/** [Mode A] Focus the chat input — NO-OP unless view === "chat" (the
 *  invisible-editor discipline: focusing an editor the layout does not
 *  render is the BUG-011 class). Seeds nothing and scopes nothing: chat
 *  content is ephemeral (SIDECHAT-002), never a draft. */
focusChatInput(): void {
  if (this.view !== ("chat" as PanelView)) return; // G1: literal compare; see gotcha
  this.focus = "chat";
  this.chatField.focus();
  this.invalidate();
}

/** Release chat focus back to options. NEVER suspends the panel and never
 *  touches textDuty/bufferOwner/lastEscAt (those belong to the answer-side
 *  editor's lifecycle). */
blurChatInput(): void {
  if (this.focus !== "chat") return;
  this.focus = "options";
  this.chatField.blur();
  this.invalidate();
}
```

### 3. setView hook (:1053)

In `setView(view)`, when the target is not the chat view and `this.focus === "chat"`, call `this.blurChatInput()` FIRST (before assigning the view) — the chat editor must never retain focus into another view. (Guard for `view === "chat"` is P1.M2.T4.S1's concern; today every PanelView is non-chat so the blur always fires when chat focus is held.)

### 4. handleInput — the chat branch (:755–800 region)

Follow the existing structure (ctrl+c → confirm-mode → enter byte-guard → duty enters → router → editor fall-through):

```ts
// CHAT focus (SIDECHAT-001): enter is intercepted BEFORE the router — the
// send action is P1.M2.T3.S1's seam. Interim body: consume enter (it must
// NEVER fall through to accept/saveTextDraft/writeInEnter — a chat message
// is not an answer). The "\n" newline byte is NOT enter (same guard as the
// duty branches above).
if (this.focus === "chat" && key === "enter" && data !== "\n") {
  return true; // consumed — P1.M2.T3.S1 replaces this body with sendChat()
}
// Unmatched input while chat holds focus forwards to the CHAT editor
// (arrows included — ESC-002-family: the focused editor owns caret keys).
if (this.focus === "chat") {
  this.chatField.handleInput(data);
  return true;
}
```

Placement: AFTER the confirm-mode/duty-enter branches and BEFORE `this.keys(data, this)` + the text/note editor fall-through. Confirm the `key === "enter" && data !== "\n"` guard matches the file's existing pattern (`parseKey(data)` + raw-byte exclusion). Also verify ctrl+c's first-position check already covers chat focus (it precedes everything — no change needed) and the confirm-mode ordering stays ahead (a pending ripple modal must outrank chat typing).

### 5. Explicitly OUT of scope (guard rails)

- PanelView `"chat"` union member, setView("chat") seeding, render branch embedding chatField.render — P1.M2.T4.S1.
- Enter/send routing (sendChat, message pipeline), esc-ladder rung, streaming abort — P1.M2.T3.S1 (they REPLACE the interim enter body in-place).
- keys.ts `editorFocused` re-derivation and tier branches for "chat" — P1.M2.T3.S1.
- Any DraftStore/draftSlots/bufferOwner interaction; any history API call; any sidechat.ts store call — none of these are the input's business.
- The chat-view render module (parallel P1.M2.T1.S1/S2, chat-view.ts) — disjoint.

### Success Criteria

- [ ] One fake factory → TWO factory invocations → two DISTINCT editor components; both TextFields alive for the panel lifetime
- [ ] `focusChatInput()` no-ops (focus stays "options", no editor.focus call) while view ≠ chat; with view forced to chat (test casts), focus becomes "chat"
- [ ] `setView("short")` while focus === "chat" blurs chat (focus → "options")
- [ ] `enter` (`"\r"`) in chat focus: consumed (`handleInput` returns true), NO applyAnswer/status change, NO draftSlots/DraftStore write, writeInEnter/saveTextDraft/accept never invoked
- [ ] `"\n"` (newline byte) and ordinary characters in chat focus forward to chatField.handleInput, return true
- [ ] Up (`"\x1b[A"`) / down arrows in chat focus forward to chatField, NOT the options cursor / transcript navigation
- [ ] `blurChatInput` never resolves `done`; textDuty/bufferOwner untouched by chat focus lifecycle
- [ ] Existing three duties (options/text/note) byte-identical behavior — full suite green
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the sanctioned-pattern ruling quoted, the exact constructor block to mirror, the interim-typing strategy for the not-yet-existing view member, the load-bearing ordering inside handleInput, the hazard list (invisible editor, draft entanglement, history), the consumer seams, and the no-mock test recipe with a fake factory. No guessing.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: §Second editor — the binding rulings (sanctioned second instance; view-gated focus; panel-level enter interception; history silence)
- file: src/panel/panel.ts
  why: constructor :606-631 (mirror for the second instance), PanelFocus :111-112, view :344, setView :1053, handleInput :755-800 (ordering: ctrl+c → confirm → enter duties → router → editor fall-through), blurTextField pattern (~:1050-1060)
  gotcha: enter byte-guard `data !== "\n"` is load-bearing in every enter branch — copy it
- file: src/panel/text-field.ts
  why: EditorFactory :45-51, createEditorComponent :88-98 (composed path calls factory per editor — two calls is correct), TextField surface (getText/setText/handleInput/render + feature-detected focused/onChange), TextFieldArgs
- file: src/panel/keys.ts
  why: editorFocused derivation :431 (text|note only — S3 extends; NOT this item); tier-2 gating :527/:532; BUG-011 invisible-editor note :534-538
- file: plan/005_af804251f18d/prd_snapshot.md (h2.38 Side chat, h2.32 duties, h2.15 API surface)
  why: SIDECHAT-001..005 contract the input serves; three-duties + one-more-target focus model
- file: plan/005_af804251f18d/P1M2T1S2/PRP.md
  why: parallel sibling (chat-view.ts render module) — disjoint files; confirms pendingConfirm/confirm-row world the chat view renders
- file: plan/005_af804251f18d/P1M2T3.S1 / P1M2.T4.S1 entries in tasks tree
  why: consumers of this item's seams (interim enter body, focusChatInput, chatField field)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ panel.ts text-field.ts keys.ts chat-view.ts(partial, parallel) sidechat.ts(+test, engine complete) (+ panel.test.ts actions.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/panel.ts   # MODIFIED: chatField, PanelFocus "chat", focusChatInput/blurChatInput, setView hook, handleInput branch, doc note
# tests extended in panel.test.ts (or actions.test.ts where editor-construction tests live)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// G1 (interim typing): PanelView has no "chat" member yet (P1.M2.T4.S1 adds it).
//   Compare with a literal cast — `this.view !== ("chat" as PanelView)` — and leave a
//   one-line comment "P1.M2.T4.S1 adds the member; drop the cast". When S4 lands, the
//   cast becomes a plain comparison with zero logic change.
// Two factory invocations per panel is CORRECT (createEditorComponent is per-editor,
// not per-panel) — do not cache/share one component between the two TextFields.
// A shared component would entangle buffers/history between answer and chat editors.
// chatField must be PUBLIC readonly (S4's render branch reads it) — no getter boilerplate.
// Never seed chatField from drafts and never write its buffer anywhere: chat content is
//   ephemeral (SIDECHAT-002); TextField.seed exists but is NOT called on chatField.
// blurChatInput must NOT clear lastEscAt or textDuty (answer-editor lifecycle state) —
//   only focus + chatField.blur + invalidate.
// The confirm-mode (ripple modal) ordering must stay ABOVE the chat branches: a pending
//   FR-18 modal outranks chat typing. ctrl+c above everything (unchanged).
// Stock-Editor fallback: with no factory, createEditorComponent returns new Editor(...) —
//   the fake-factory test asserts the composed path; a no-factory test asserts the panel
//   still constructs (two stock editors).
```

## Implementation Blueprint

### Data models and structure

No data models — one new public readonly field (`chatField: TextField`), one union member on `PanelFocus`, two methods, two branch sites.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD failing tests first (panel.test.ts, follow the existing editor/focus describe style)
  - second_instance_from_shared_factory: fake factory vi.fn returning distinct stub components;
     construct panel → factory called TWICE, panel.chatField !== panel.textField internals
     (assert via distinct stub identity: capture the two created components in an array)
  - focus_chat_input_noop_outside_chat_view: focus stays "options"; stub's focus flag untouched
  - focus_chat_input_inside_chat_view: (cast view as any → "chat" per G1) focus === "chat", stub focused
  - setView_blurs_chat_focus: force chat focus → setView("short") → focus "options", stub blurred
  - enter_in_chat_focus_commits_nothing: seed state with an open question; focus chat; handleInput("\r")
     returns true; state.serialize() unchanged; draftSlots/DraftStore seam (fake) untouched
  - newline_and_plain_input_forward_to_chat_editor: handleInput("\n")/"x"/"\x1b[A" → stub's
     handleInput received the data; return true; options cursorIndex unchanged
  - blur_chat_input_never_suspends: done never called; textDuty/bufferOwner unchanged

Task 2: MODIFY src/panel/panel.ts — chatField construction (What §1) + field declaration

Task 3: MODIFY PanelFocus + focusChatInput/blurChatInput (What §2) + setView hook (What §3)

Task 4: MODIFY handleInput chat branches (What §4) — placement AFTER confirm/duty-enters, BEFORE router

Task 5: Mode A doc note — extend the PanelFocus/focus-model docblock naming the fourth target
  and the SIDECHAT contract reference (spec h2.38)

Task 6: GATES
  - npx vitest run src/panel/panel.test.ts src/panel/actions.test.ts src/panel/keys.test.ts
  - npm test && npm run typecheck   # keys.test.ts / duties untouched and green
```

### Implementation Patterns & Key Details

See What §1–§4 for exact code. EditorComponent stub recipe for tests:

```ts
const created: EditorComponent[] = [];
const fakeFactory: EditorFactory = (tui, theme, kb) => {
  const stub = {
    getText: () => text,
    setText: (t: string) => { text = t; },
    handleInput: vi.fn(),
    render: () => [],
    invalidate: () => {},
    focused: false,
  } as unknown as EditorComponent;
  created.push(stub);
  return stub;
};
// assert created.length === 2 and created[0] !== created[1]
```

### Integration Points

```yaml
CONSUMERS (do NOT implement):
  - P1.M2.T3.S1: replaces the interim `return true` enter body with sendChat routing;
    adds the esc-ladder rung and streaming-abort; extends keys.ts editorFocused for "chat"
  - P1.M2.T4.S1: adds PanelView "chat" (drop the G1 cast), setView("chat") seeding +
    render branch embedding panel.chatField.render(width); open/replace calls focusChatInput
STATE/DRAFTS/CONFIG/EVENTS: none — pure panel-internal surface
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/panel.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/   # duties/two-stage/keys suites must stay green — zero behavior change for existing focuses
npm test
```

### Level 3: Integration Testing

Not applicable yet — the chat view does not render until P1.M2.T4.S1; the live send flow is P1.M2.T3.S1. This item's surface is constructor + focus + forwarding, fully covered by the unit harness.

### Level 4: Domain Validation

Review against the architecture §Second editor checklist: same-factory second instance ✓, view-gated focus ✓, panel-level enter interception ✓, history silence ✓, no draft entanglement ✓, never-suspend blur ✓.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] Two distinct editor components from one factory; both live for the panel lifetime
- [ ] Focus exclusivity: no-op outside chat view; blur on view exit; enter commits nothing
- [ ] Arrows/plain input forward to chatField only; confirm-mode + ctrl+c ordering preserved
- [ ] No DraftStore/draftSlots/history/sidechat-store interaction anywhere in the diff
- [ ] Mode A focus-model doc note (fourth target + SIDECHAT reference)
- [ ] G1 cast documented for P1.M2.T4.S1 removal

---

## Anti-Patterns to Avoid

- ❌ Don't share ONE editor component between the two TextFields — buffer/history entanglement is exactly what two instances prevent
- ❌ Don't let enter reach the router or the duty branches — a chat message must never answer a question or stage a draft
- ❌ Don't seed chatField from drafts or persist its buffer — chat is ephemeral (SIDECHAT-002)
- ❌ Don't reuse blurTextField for chat (it resets answer-editor lifecycle state: textDuty, lastEscAt)
- ❌ Don't add the PanelView "chat" member or any render/routing here — S4/S3 own those; keep this item compile-clean against the current union
- ❌ Don't focus the chat editor outside the chat view — the invisible-editor (BUG-011) hazard the architecture doc names
- ❌ Don't invoke the editor's history API anywhere (h2.31 discipline now covering two editors)

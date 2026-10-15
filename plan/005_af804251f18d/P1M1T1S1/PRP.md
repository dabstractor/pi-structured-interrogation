# PRP — P1.M1.T1.S1: Rename `keys.discuss` → `keys.chat` (KeyAction member, defaults, dispatch seam, label maps, every fixture)

## Goal

**Feature Goal**: Execute the mechanical rename half of SIDECHAT-001 (spec h2.38/h2.80): the config action key `discuss` becomes `chat` everywhere — KeyAction union, KEY_ACTIONS, DEFAULT_CONFIG field, loadConfig JSDoc row + count string, `RoutedActions.onDiscuss`→`onChat`, default stub, bare tier map, dispatch arm, ACTION_WORDS, keymap-guard ALL_ACTIONS, host refinement in panel.ts, and every test fixture/comment. **The VALUE stays `"e"`** and the routed handler still calls `discussInChat(pi, p)` — the discuss engine deletion is P1.M2.T7.S1, the new chat view is P1.M2.T4.S1, and the `discuss`→`chat` compat alias is P1.M1.T1.S2. Behavior byte-identical after the rename.

**Deliverable**: Renamed identifiers across `src/config.ts`, `src/panel/keys.ts`, `src/panel/layout.ts`, `src/panel/panel.ts` (override property only), `src/keymap-guard.test.ts`, and fixtures in keys.test / config.test / config-surface.test / keymap-ac.test / ac-panel.test / layout.test.

**Success Definition**:
- `DEFAULT_CONFIG.keys.chat === "e"`; zero `discuss`/`onDiscuss` identifiers remain in src/ (grep clean — see exceptions below)
- Two-tier dispatch shape preserved verbatim: `if (matchesKey(data, b.chat)) { if (bare.chat && editorFocused) return false; actions.onChat(panel); }`
- keys.test.ts, config.test.ts, config-surface.test.ts, keymap-ac.test.ts, ac-panel.test.ts, layout.test.ts, keymap-guard.test.ts green after mechanical flips
- `npm run typecheck` + full `npm test` green
- Letter-vs-letter ordering pin (keys.test.ts:751, deep-before-discuss) carries to deep-before-chat

## Why

SIDECHAT-001 (h2.80, 2026-10-15): the per-question side-channel chat replaces discuss-in-chat; the config key renames `discuss`→`chat` so the action names what it now does. Landing rename-before-alias (S2) and before the view (P1.M2.T4) keeps each later subtask a pure addition on the final name. The discuss engine (`discuss.ts`, `discussInChat`) is deliberately NOT deleted here — the renamed `onChat` seam still routes to it until P1.M2.T7.S1 removes it end-to-end.

## What

Mechanical renames (values and behavior unchanged):

| Site | Old | New |
|---|---|---|
| config.ts :54 | `\| "discuss"` in KeyAction union | `\| "chat"` |
| config.ts :97 | `"discuss",` in KEY_ACTIONS | `"chat",` |
| config.ts :114 | `discuss: "e",` in DEFAULT_CONFIG.keys | `chat: "e",` (VALUE UNCHANGED) |
| config.ts :289 | JSDoc row `` `discuss` `` "Discuss the current question in chat" | `` `chat` `` + purpose: "Open the per-question side chat" |
| config.ts :263 | count string "9 keys + 3 toggles…" | true final surface: "9 keys + 3 toggles (gateWarnings/roundDetection/compactionPreservation) + editorMode + escExitWindowMs + sideChatModel + sideChatAutoApply" (the rename adds no key; sideChat fields land in P1.M1.T2.S1 — write the string to the FINAL surface) |
| keys.ts :144-146 | `onDiscuss(p: InterrogationPanel): void;` + JSDoc | `onChat(...)` + "Open the per-question side chat. Wired host-side at panel.ts's router-construction… until SIDECHAT's own action lands" |
| keys.ts :372-377 | `onDiscuss: () => {...}` default stub (incl. its discussInChat comment) | `onChat: () => {...}` — body: keep the needs-PiUISurface closure comment, note it still routes to discussInChat until P1.M2.T4/P1.M2.T7 |
| keys.ts :414 | `discuss: isBareBinding(b.discuss),` in bare tier map | `chat: isBareBinding(b.chat),` |
| keys.ts :558-561 | dispatch arm | `if (matchesKey(data, b.chat)) { if (bare.chat && editorFocused) return false; // tier 2: must type` / `actions.onChat(panel); }` — exact two-tier shape |
| keys.ts :95/:120 | module-doc dispatch-order list "…submit, discuss," + owning-tasks comment | `…submit, chat,` + side-chat wording |
| layout.ts :70 | `discuss: "discuss",` in ACTION_WORDS | `chat: "chat",` |
| keymap-guard.test.ts :46 | `"discuss",` in ALL_ACTIONS (:41-52) | `"chat",` |
| panel.ts :658-661 | `routed.onDiscuss = (p) => { discussInChat(pi, p); };` | `routed.onChat = (p) => { discussInChat(pi, p); };` — the CALL to discussInChat stays (deleted in P1.M2.T4.S1/P1.M2.T7.S1); keep/update the surrounding comment |
| keys.test.ts :34 | `discuss: "e",` in DEFAULT_DATA | `chat: "e",` |
| keys.test.ts :262/:327/:389/:404 | `DEFAULT_DATA.discuss` / `"discuss"` in KeyAction arrays | `DEFAULT_DATA.chat` / `"chat"` |
| keys.test.ts :751-760 | collision test: comment "deep (earlier) vs discuss (later)", `actions.onDiscuss` assertion | deep-vs-chat wording, `actions.onChat` — the pin itself (deep wins, one dispatch) unchanged |
| config.test.ts :145 | `expect(labels.discuss).toBe("E");` | `expect(labels.chat).toBe("E");` |
| config-surface.test.ts :24/:100/:117/:139/:152/:547/:551/:554 | doc table row, DEFAULT fixture, kitty-protocol override fixture, SPY map `discuss: "onDiscuss"`, WORDS map, raw-settings test (`keys: { submit: "ctrl+", discuss: … }` — the RAW INPUT `discuss` key in the settings JSON becomes S2's alias test material; here flip the fixture AND the expectations to `chat` since the alias lands in S2) | mechanical flips to chat |
| keymap-ac.test.ts :89 | `discuss: "e",` fixture | `chat: "e",` |
| ac-panel.test.ts :423-:430 | remap clone `discuss: "ctrl+q"` + `labels.discuss === "Ctrl+Q"` | `chat: "ctrl+q"` / `labels.chat` |
| layout.test.ts :79 | `discuss: "e",` fixture | `chat: "e",` |
| editor-preservation.test.ts :143/:274ff | comment "pi's discuss-style" + test names `test_discuss_*` using discussInChat flows | KEEP the discussInChat-based tests (they exercise the still-present engine via the renamed seam); reword comments to "side-chat seam (pre-SIDECHAT)" only where they name the config key |

**DO NOT rename/delete**: `discussInChat` (src/panel/discuss.ts), `discuss.test.ts`, or their internal machinery — consumed by the renamed `onChat` until P1.M2.T7.S1.

### Success Criteria

- [ ] `grep -rn '"discuss"\|discuss:\|onDiscuss\|\.discuss\b\|DEFAULT_DATA.discuss' src/ | grep -v discussInChat | grep -v discuss.ts | grep -v discuss.test` → EMPTY
- [ ] `DEFAULT_CONFIG.keys.chat === "e"`; `resolveKeyLabels(...).chat === "E"`
- [ ] keymap-guard exhaustiveness green (ALL_ACTIONS flipped in lockstep with DEFAULT_CONFIG)
- [ ] The three `Record<KeyAction, …>` maps in config-surface.test.ts force the sweep via typecheck
- [ ] Full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo at HEAD d18bc39, suite green. This is a grep+typecheck-driven mechanical rename with the complete verified inventory above. The three `Record<KeyAction, …>` hand-duplicates (config-surface.test.ts :139/:152) plus the union rename make typecheck the exhaustive verifier.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/config-and-keys-rename.md
  why: "THE verified touchpoint inventory at HEAD d18bc39 — every site in the table above; the Record<KeyAction,…> note about TS forcing the sweep"

- file: src/config.ts
  why: "union :54, KEY_ACTIONS :97, DEFAULT_CONFIG.keys :114, JSDoc row :289, count string :263/277 ('9 keys + 3 toggles'), resolveKeyLabels :~355 (generic over KEY_ACTIONS — no direct edit)"

- file: src/panel/keys.ts
  why: "RoutedActions.onDiscuss :144-146, default stub :372-377, bare tier map :414, dispatch arm :558-561 (exact two-tier shape to preserve), module docs :95/:120"

- file: src/panel/panel.ts
  why: "host refinement :658-661 — rename the PROPERTY only; the discussInChat(pi, p) call body survives until P1.M2.T7.S1"

- file: src/panel/layout.ts
  why: "ACTION_WORDS :70"

- file: src/keymap-guard.test.ts
  why: "ALL_ACTIONS :41-52 (:46) — hand-duplicated; its completeness test asserts the DEFAULT_CONFIG.keys key set"

- file: src/panel/keys.test.ts
  why: "DEFAULT_DATA :34, dispatch rows :262/:327/:389/:404, the letter-vs-letter ordering pin :751 (deep wins over discuss — becomes chat)"

- file: src/config-surface.test.ts
  why: "three hand-duplicated maps (fixtures :100/:117, SPY :139, WORDS :152) + raw-settings test :547-554"

- file: src/panel/ac-panel.test.ts, src/panel/keymap-ac.test.ts, src/panel/layout.test.ts
  why: "remaining discuss fixtures (:426/:430, :89, :79)"

- file: src/panel/editor-preservation.test.ts
  why: "discussInChat-based tests :274+ — KEEP green (engine still present); only reword comments that name the config key"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── config.ts               # union/list/default/JSDoc/count — RENAME
├── panel/keys.ts            # seam/stub/tier/dispatch/docs — RENAME
├── panel/layout.ts          # ACTION_WORDS — RENAME
├── panel/panel.ts           # override property only — RENAME
├── panel/discuss.ts         # discussInChat engine — NO CHANGE (deleted in M2.T7)
├── keymap-guard.test.ts     # ALL_ACTIONS — RENAME
└── *.test.ts (5 files)      # fixtures/spies — RENAME
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: value stays "e" — no default change; the side-chat key keeps its
//   BAREKEYS-001 bare default, so the tier-2 gate (bare keys type in editor
//   focus) must survive verbatim.
// CRITICAL: config-surface.test.ts has THREE Record<KeyAction,…> maps — TS
//   rejects missing 'chat' members, forcing the sweep; don't silence with
//   Partial<Record<...>>.
// GOTCHA: the raw-settings test :547 sends `discuss: " Ctrl+Shift+P "` as a
//   user JSON key — after the rename, that fixture must send `chat` (the
//   discuss-key alias behavior is S2's to add; S1 asserts the new name only).
// GOTCHA: panel.ts's onChat still calls discussInChat — intentional bridge;
//   P1.M2.T4.S1 replaces the body, P1.M2.T7.S1 deletes the engine.
// GOTCHA: the JSDoc count string should state the FINAL surface (incl.
//   sideChatModel/sideChatAutoApply) even though T2 adds those fields next —
//   the contract explicitly says the rename adds no key and the string
//   should not need a second edit.
// GOTCHA: editor-preservation.test.ts discuss* tests must stay green — the
//   engine is alive; only comment wording changes.
// GOTCHA: keep the dispatch arm's exact shape — `if (bare.chat &&
//   editorFocused) return false; // tier 2: must type` then the action call.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: BASELINE
  - grep -rn "discuss\|onDiscuss" src/ | grep -v discussInChat | grep -v "discuss.ts" | grep -v "discuss.test"  → inventory
  - npm test → green before touching anything

Task 2: RENAME src/config.ts (union :54, KEY_ACTIONS :97, default :114,
  JSDoc row :289, count string :263)
Task 3: RENAME src/panel/keys.ts (interface :144-146, stub :372-377,
  bare map :414, dispatch :558-561, docs :95/:120)
Task 4: RENAME src/panel/layout.ts ACTION_WORDS :70
Task 5: RENAME src/panel/panel.ts override :658 (property only; discussInChat
  call stays)
Task 6: RENAME tests: keymap-guard ALL_ACTIONS :46; keys.test (:34, :262,
  :327, :389, :404, :751 pin); config.test :145; config-surface (:24, :100,
  :117, :139, :152, :547-554); keymap-ac :89; ac-panel :426/:430; layout :79
Task 7: VERIFY
  - grep completion check (see Success Criteria) → EMPTY
  - npm run typecheck (the exhaustive gate — the Record maps + union force it)
  - npx vitest run src/panel/keys.test.ts src/config.test.ts src/config-surface.test.ts src/keymap-guard.test.ts src/panel/keymap-ac.test.ts src/panel/ac-panel.test.ts src/panel/layout.test.ts src/panel/editor-preservation.test.ts
  - npm test (full suite)
```

### Implementation Patterns & Key Details

```ts
// keys.ts dispatch arm after (exact shape):
if (matchesKey(data, b.chat)) {
  if (bare.chat && editorFocused) return false; // tier 2: must type
  actions.onChat(panel);
}

// panel.ts host bridge after (body deliberately unchanged):
routed.onChat = (p) => {
  discussInChat(pi, p);   // SIDECHAT bridge — replaced in P1.M2.T4.S1, engine deleted in P1.M2.T7.S1
};
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck       # exhaustive rename gate
grep -rn '"discuss"\|discuss:\|onDiscuss\|\.discuss\b' src/ | grep -v discussInChat | grep -v 'discuss\.ts'   # expect empty
grep -rn 'discussInChat' src/panel/panel.ts   # expect the one bridge call still present
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts src/config.test.ts src/config-surface.test.ts src/keymap-guard.test.ts
npx vitest run src/panel/keymap-ac.test.ts src/panel/ac-panel.test.ts src/panel/layout.test.ts src/panel/editor-preservation.test.ts
npm test
```

### Level 3: Behavior-identical spot checks

```bash
npx vitest run src/panel/keys.test.ts -t "letter_vs_letter"   # deep-before-chat ordering pin
npx vitest run src/panel/keys.test.ts -t "editor"             # tier-2 typing gate intact
npx vitest run src/panel/editor-preservation.test.ts          # discussInChat flows still green via onChat
```

### Level 4: Not applicable (rename only — no user-visible change until M2 lands the view)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] grep completion check empty; discussInChat bridge intact in panel.ts
- [ ] `DEFAULT_CONFIG.keys.chat === "e"`; `labels.chat === "E"` (config.test flipped row green)
- [ ] keymap-guard ALL_ACTIONS flipped in lockstep; exhaustiveness green
- [ ] Two-tier dispatch shape verbatim; letter-vs-letter pin carried to chat
- [ ] count string states the final surface (9 keys + 3 toggles + editorMode + escExitWindowMs + sideChatModel + sideChatAutoApply)
- [ ] discuss.ts / discuss.test.ts untouched; editor-preservation discuss tests green
- [ ] JSDoc row + module docs updated (Mode A); README NOT touched (Mode B, P1.M3.T3)

## Anti-Patterns to Avoid

- ❌ Don't change the default value or the two-tier gate — behavior byte-identical
- ❌ Don't delete discuss.ts / discussInChat — P1.M2.T7.S1 owns that
- ❌ Don't add the discuss→chat compat alias here — that's P1.M1.T1.S2 (coerceKeys)
- ❌ Don't build any side-chat view/engine here — M1.T3+/M2 own those
- ❌ Don't silence the Record<KeyAction,…> type errors with Partial<> — flip the fixtures
- ❌ Don't edit README.md or spec/ — README is Mode B (P1.M3.T3); spec already on `chat`

---

**Confidence Score**: 9/10 — pure mechanical rename with the verified inventory, typecheck + the Record-map generics as exhaustive verifiers, and a definitive grep completion check. Residual risk (string-literal references grep can't see) is covered by the full-suite run.

# Test infrastructure, gates, and docs map — bugfix round 001

## Test infrastructure (verified)

- Runner: **vitest** (`vitest.config.ts` is bare: `{test:{passWithNoTests:true}}`;
  config-free discovery of `*.test.ts`). Run: `npm test` (=`vitest run`),
  single file: `npx vitest run src/panel/ac-sidechat.test.ts`. Gate state at
  HEAD per PRD: 1551/1551 passing.
- The canonical side-chat harness is `src/panel/ac-sidechat.test.ts`:
  - Constants (~83-88): `ENTER = "\r"`, `ESCAPE = "\u001b"`,
    `RIGHT = "\u001b[C"`, `CHAT_KEY = "e"` (DEFAULT_CONFIG.keys.chat).
  - `makeHarness({config?, delivery?, focusQuestionId?, port?})` (~387-436):
    builds real `createInterrogationState` (7 choice questions q1..q7 via
    `sideState()`), a real `createSidechatEngine` over `opts.port ?? doneStream("ok")`
    with `fakeRegistry([fakeModel("prov","mdl-1")])`, and a REAL
    `InterrogationPanel` via `panelArgsFor(state, {...})` threading
    `sidechatEngine` + `chatRebindDeps` (`{resolveModelSnapshot: () => ({provider:"prov",
    modelId:"mdl-1"}), buildSystemPrompt: () => "SYS", buildBranchSnapshot: () => []}`)
    + `sidechatNotify: notify` (vi.fn). Returns `{state, panel, notify, delivery}`.
  - Port helpers: `doneStream(text, usage?)` (~318) — a completed fake stream;
    `answerReply(value)` (~370) — reply text ending in a fenced
    ```answer {"value": ...}``` block; `convergePort()` (~607) — first turn
    converges on `{"value":"sqlite"}` with usage `{input:10,output:5,totalCost:0.07}`.
  - Gesture helpers: `openChat(panel)` — real `e` keypress; `blurChatBox(panel)`
    — double-esc (TWO `handleInput(ESCAPE)` within the window);
    `sendChat(panel, text)` — `panel.chatField.setText(text); handleInput(ENTER)`.
  - Isolation (~beforeEach ~452): `resetState(); resetSidechatForTests();
    createPanelHost(makeMockLifecycle().lifecycle);` — the sidechat module
    singleton and the panel host record are reset between tests. ANY new test
    touching the store MUST rely on these resets.
  - Streaming/gated ports for BUG-005/006 repros: pattern to follow — a fake
    port that returns an async iterable held open until the test resolves it,
    capturing the `options.signal` (AbortSignal) it was handed so the test can
    assert `signal.aborted`. See `sidechat-engine.test.ts` controller/guard
    describes (~324-394) for the established fake-port idioms.
- Config surface (`src/config.ts`): `DEFAULT_CONFIG` (~117) —
  `escExitWindowMs: 500` (:133), `sideChatAutoApply: false` (:134),
  `keys.chat` default `"e"`. Tests toggle `{...DEFAULT_CONFIG,
  sideChatAutoApply: true}` (see AC-17.4_autoapply test).

## Gates (all must stay green; CI parity with the PRD's validation round)

```bash
npm test                    # vitest run (1551/1551 at HEAD)
npm run typecheck           # tsc --noEmit
npm run lint                # eslint src scripts *.ts
bash scripts/verify-keymap-conflicts.sh   # exit 0; checks DEFAULT_CONFIG.keys
                            # against an AVOIDED chord list + live
                            # `pi.registerShortcut(` grep across installed
                            # extensions. Adding VIEW BRANCHES to existing
                            # config-driven keys (e.g. an overview branch on
                            # keys.chat) does NOT trip it (keys-overview.md §
                            # verified). Adding NO new default keys.
```

## Docs map (Mode A / Mode B planning)

### README.md (37,139 bytes; headings with line numbers)

| Section | Line | Relevant to |
|---------|------|-------------|
| `## Usage` | 30 | panel interaction prose (may mention side chat gestures) |
| `## Configuration` | 133 | `sideChatAutoApply`, `escExitWindowMs`, `sideChatModel` |
| `## Keymap` | 181 | `e` (keys.chat) documentation — overview targeting fix may need a clause |
| `## Side chat` | 275 | **primary** — confirm row, esc ladder, /clear, close notices |
| `## Acceptance criteria (spec)` | 314 | AC-17.x mirrors |
| `## Limitations` | 342 | reconstruction degradation notes (BUG-008 makes degrade-to-next-older actually hold for tool results) |
| `## Development` | 370 | gates list incl. keymap script |
| `### Keymap conflict re-verification` | 390 | unchanged |
| `## Project structure` | 467 | unchanged |

Changeset-level (Mode B) README sync needed for: confirm-row gestures now work
focused (M1), answered-question chat lifecycle + no-op apply consume (M2),
replace//close usage notices + abort ownership (M3), input preservation +
overview `e` targeting (M4), reconstruction robustness (M5).

### spec/ (authority documents — the fixes bring code INTO compliance)

| File | Sections this round touches |
|------|------------------------------|
| `spec/ui-spec.md` | §Side chat (~112-118): View & entry (112: `e` "opens ... from any non-editor focus" — silent on overview targeting; the BUG-004 fix should gain a clause "targets the overview cursor row"), Singleton lifecycle (113: discard-on-answer rule), Slash escape hatches (114), Esc ladder (115: "Streaming: first `esc` aborts"), Answer protocol (116: confirm row enter/esc), Usage & close (118: any close/discard notifies). §Overview (~20, 75-76): cursor-row interaction convention. |
| `spec/implementation-plan.md` | risk table "esc aborts; singleton + one-shot snapshot cap the blast radius" (BUG-005 context) — reference only |
| `spec/product-requirements.md` | FR-15/SIDECHAT-002 discard rule; commitment 6 / R4 draft-sacredness (BUG-006) — reference only |

Spec edits this round: MINIMAL — the code moves toward the spec, not vice
versa. Only genuinely new behavioral clauses: (a) overview `e` targets the
cursor row; (b) if BUG-001's streaming fix chooses routing (single esc aborts
while streaming in the chat view), ui-spec.md:115 already says exactly that —
no edit; if it chooses hint-honesty, add the hint wording. Everything else is
README sync (Mode B final task).

## Prior-round artifacts (for lineage)

`git log`: `e298920` (restart resurrection fixed; validation round done) ←
`0a51abd` (sidechat project tree lands) ← ... The current round's PRD is the
validation report of `e298920`. Bug report staged as commit `c050382`
("Add bug report: 001_7ea23709b4e7"). No plan/ docs from the prior round are
inputs to this one; this architecture/ set is the single source of research
truth for the round.

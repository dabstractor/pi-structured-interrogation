# Guards, tests, and docs surface

## Cache-isolation guard (R5) — clone recipe

Clone `src/no-hardcoded-keys.test.ts` (241 lines):
- `stripComments(src)` (:45–137): single-pass char scanner, frame stack (`'"' | "'" | "`" | "${"`); `//` and `/*…*/` blanked (newlines kept → line numbers stay accurate); backslash escapes consumed verbatim; `${` pushes, `}` pops; only the matching delimiter pops a string frame. Keep it even though identifier matching alone would suffice — comments/URLs must not trip the scan.
- File set: **targeted** — `src/panel/sidechat.ts`, `src/panel/chat-view.ts`, plus any NON-test helper modules the side-chat cluster grows (spec wording: "side-chat modules … and their non-test helpers"); `.test.ts` excluded (repo-wide scanning would false-positive on other modules' legit uses).
- Detection: per-name regexes over comment-stripped source with file:line messages. Ban list: `sendMessage`, `sendUserMessage`, `setActiveTools`, `registerTool`, `setModel` (identifier references; catches both `pi.sendMessage` and ctx-borne uses).
- Self-tests to clone (:193–241): main scan + planted-literal-fails + comment-only-mention-passes + interpolation/nested-template pinning.
- No allowlist carve-out expected (side-chat modules must be clean); if one becomes necessary, follow `blankDefaultConfigBlock` (:141–154) shape with a documented reason.

## Discuss deletion inventory

**Dies:** `src/panel/discuss.ts` (whole file — `buildDiscussTemplate`, `discussFooter`, `discussInChat`); `src/panel/discuss.test.ts` (whole file, 583 lines); `panel.ts:74` import; `panel.ts:652–661` host refinement; keys.ts discuss remnants after rename (all covered by M1.T1).

**Stays (verify, do not break):**
- `PiUISurface.setEditorText` declaration `panel.ts:229` — STILL CONSUMED by `src/panel/editor-preservation.ts:99` (main-editor preservation, S3). Only reword the JSDoc :224–225 ("ONLY sanctioned writer … (discuss.ts discussInChat)" → editor-preservation is the writer).
- Test fakes using setEditorText in non-discuss suites: `src/tree-nav-repro.test.ts:76`, `src/ac-scripted.test.ts:977`, `src/panel/ac-panel.test.ts:258`, `src/panel/editor-preservation.test.ts:179/312/347/387` (the :282–284 discuss-era rationale comment needs rewording, tests stay).
- The esc break-out main-conversation flow (FR-14/FR-16) — untouched.

**Discuss.test.ts suite verdicts:** template-contract suite (:183–255) DIE; suspend+preload suite (:256–311) DIE; router-wiring suite (:312–448) DIE (`e`-dispatches-per-view coverage survives via `keys.test.ts:389` — keep it green through the rename); R4/BUG-002 draft write-through suite (:449–583) — general editor-exit invariants, coverage equivalently held by `editor-preservation.test.ts`; the "no double staging after simulated resume" pin needs a side-chat-era successor test (chat open must not stage drafts either).

**Residual sweep (grep -ri discuss, excl. node_modules/plan/.git):** keys.ts (:95,:120,:373–374 after rename comments), keys.test.ts, config-surface.test.ts, panel.ts comments (:224–225,:326,:941), config.ts, keymap-ac.test.ts, ac-panel.test.ts, editor-preservation{.ts,:32/.test.ts:143,274–284}, layout.ts:70, layout.test.ts:79, keymap-guard.test.ts:46, config.test.ts:145, suspend.ts:22, README (below). NOT real mentions (leave): compaction.ts:100, tool-schema.ts:45 prose. Final state: `discuss` may appear ONLY at the `coerceKeys` alias site in config.ts.

## README anchors (Mode B sweep)

| Anchor | Line(s) | Action |
| --- | --- | --- |
| Usage paragraph "e discusses the current question in chat" | 39 | rewrite → in-panel side chat |
| Sample settings JSON `"discuss": "e"` | ~148 (block 132–150) | → `"chat": "e"` + add `sideChatModel` / `sideChatAutoApply` |
| Keymap table row `keys.discuss` | 189 (table 178–192) | → Side chat row `keys.chat` |
| R4 write-through sentence (discuss in chat among exits) | 237 | reword for the new `e` exit gesture |
| `## Limitations` | 300 | + side-chat ephemerality, stale snapshot (accepted v1), no transcript renderer |
| `### Keymap conflict re-verification` table `e (discuss)` + run record | 341, 364 | re-run `scripts/verify-keymap-conflicts.sh` (expected: `e` unchanged, passes untouched), refresh label + date |
| `## Project structure` | 417 | + `panel/sidechat.ts`, `panel/chat-view.ts`; − `panel/discuss.ts` |

New README "Side chat" section content (from ui-spec §Side chat): entry key, singleton/replacement
semantics, `/clear` `/new`, answer-block confirm + `sideChatAutoApply`, usage-on-close, ephemerality.

## Suite gates

- `npm test` (vitest), typecheck, lint (`eslint.config.js`), `scripts/verify-keymap-conflicts.sh`.
- AUTOMATION-POLICY (plan/001): no live TUI sessions in automation; ACs proven by scripted vitest tests over the same code paths; interactive-only checks go to the human runbook.

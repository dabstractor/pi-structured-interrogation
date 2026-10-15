# Panel view integration (chat-view.ts, PanelView "chat", hooks, suspend)

## Add-a-view recipe (precedents: "deep", "overview")

1. **Union** — `src/panel/panel.ts:108` `PanelView = "short" | "deep" | "overview"` → add `"chat"`. Per-view state on the panel class (~:344–413): add `chatScroll` (transcript scroll offset).
2. **Entry seeding** — `setView()` at `panel.ts:1051–1083`: add a `"chat"` branch (seed scroll to bottom/latest; unchanged-view no-op guarantees once-only seeding).
3. **Render dispatch** — `buildLines(width)` at `panel.ts:1443+` (`"short"` :1462, `"deep"` :1529, overview :1563): add a `"chat"` branch between shared header and view-aware footer, delegating to a new `src/panel/chat-view.ts` `buildChatContent(...)` (deep-view/overview pattern: module owns height cap + scroll clamp, e.g. `CHAT_VIEW_HEIGHT ≈ 20`).
4. **Render budget** — `src/panel/terminal-budget.ts` (`terminalBudget(width, rows)`, `HINT_SUPPRESS_ROWS=24`, `NARROW_COLS=60`); rows re-read per render (`currentRows()` :711–718). Cached-render discipline: `render()`/`invalidate()` (:679–703) rebuild only on width/rows/state change — sidechat store mutations must call `panel.invalidate()`.
5. **Footer** — `layout.ts:488` `renderFooter(snapshot, view, …)`; per-view action sets `layout.ts:43–49` (+narrow :61): add `chat: [...]` set + `ACTION_WORDS` entries. Chat footer: `enter send · /clear · esc` — esc hint `abort` while streaming, `exit` idle; names the binding when current ≠ bound (`e reopens the chat on q3`).
6. **Key routing** — `keys.ts:433–505` fixed branches are view-aware (`panel.view` checks); fixed enter :505–509; esc ladder `escapeDescend` :276–283. NO streaming-abort precedent exists — the chat rung is new: streaming → abort; idle → exit view (chat retained); underlying view's ladder unchanged.

## Second editor (chat input)

- `EditorFactory` restated at `src/panel/text-field.ts:47–51`; host captures once per `openPanel` (`panel.ts:1884` `pi.ui.getEditorComponent?.()`, passed via args :321/:1899). The panel builds ONE `TextField` in its constructor (:615–629) via `createEditorComponent(...)` (text-field.ts:88–95). **A second `TextField` built in the same constructor with the same factory is the sanctioned pattern** — both share live tui/theme/keybindings; feature-detect (TextField only assumes getText/setText/handleInput/render, optional `focused`/`onChange`).
- History: the embedded editor's history API is never invoked (panel.ts:758–759) — same for the chat editor (no history; messages are sent, not recalled).
- Focus: `PanelFocus = "options" | "text" | "note"` (panel.ts:111) rides ONE editor today. Add a distinct chat-editor focus state; `keys.ts` derives `editorFocused` from `panel.focus` — every tier-2 branch + the esc/enter interception must account for it. **Enter is intercepted at panel level in `handleInput` BEFORE the router** (WRITEIN-001 commit-at-enter, panel.ts ~:725–830) — the chat-input enter/send branch goes there; so do ctrl+c and CONFIRM-MODE ordering checks.
- One-editor-per-panel-lifetime is load-bearing (panel.ts:611–614; BUG-011 invisible-editor note keys.ts:534–538) — a focused-but-unrendered chat editor is the hazard to avoid: only focus it while `view === "chat"`.

## Open/replace/discard wiring

- `e` (non-editor focus, any view) → `actions.onChat(panel)` seam (renamed from `onDiscuss`): if singleton lives on CURRENT question → just `setView("chat")`; else replace wholesale (snapshot NOW, once) then open. No suspend, no editor preload, main editor untouched.
- **Discard when its question is answered/closed by ANY path** (option accept, write-in, side-chat apply, moot/withdraw/upsert close): agent-side upserts never pass through keys.ts — hook the STATE mutation seams (`applyAnswer`, `evaluateDependsOn`, the `questions-upserted` host subscription `handleUpserted` at panel.ts:1880–1883) or the universal `state.on("changed")` bus (panel.ts:669–670 already invalidates on it). Mid-stream: abort the AbortController FIRST, then discard. On discard: close the view (land where the accept machinery's advance already points), fire the usage notify.
- Apply path (SIDECHAT-004): `acceptOptionIndex` — `src/panel/actions.ts:268–331` (chain: `applyAnswer` :315 → `evaluateDependsOn` :319 → `advanceAfterAccept` :320 → `stageSupersededWriteIn` :326 → `maybeAutoSubmit` :327; ripple veto seam `panel.confirmRippleEdit` :313). Write-in commit — `writeInEnter`/`commitTextDraft` region actions.ts:384–518 (same post-commit ordering :508–518). Routing the parsed answer through these two seams verbatim makes provenance indistinguishable BY CONSTRUCTION — no new answer path may be added.

## Suspend/resume + non-TUI

- Suspend: `done(null)` → module-scoped host record survives (panel.ts ~:1830–1850: `phase`, `currentPanel`, `activePi`, `lastOpts`, `lastFocusId`, `openSeq`); `resumeOpenPanel` reuses `lastOpts` (same state/config/drafts) — the panel INSTANCE dies, so the sidechat singleton MUST live in `sidechat.ts` module scope (not on the panel) to survive; the fresh panel's chat view rebinds to it. Completion dismissal / esc-suspend keep it; pi restart loses it (nothing to do — no persistence by design).
- Non-TUI: `openPanel` first line `panel.ts:1861` `if (pi.mode !== undefined && pi.mode !== "tui") return false;` — the panel never mounts, the router is unreachable → `e` is inert by construction; keep the guard untouched. No-model-seam (RPC/test fakes, `!ctx.model`): chat view opens INERT with a one-line notice (spec edge state).

# Research findings — P3.M1.T1.S1 (input-recovery architecture note)

## Binding spec text

`spec/state-and-persistence.md` §Local input recovery (:133-149) — four bullets (capture on edit incl. paste; recovery point atomicity/monotonicity; drafts-are-not-answers + retirement; re-edit/commit seeding + blank rejection) + acceptance cases 1-5. The note must operationalize these, not restate them.

## Storage location — what pi exposes

- pi docs `extensions.md` §State table: "Data outside one session → External storage" — durable per-extension data NOT in the conversation is explicitly external storage (files), NOT `pi.appendEntry()` (that stores session-file entries = FORBIDDEN: SIDECHAT-002/cache-isolation; also model-visible surface rules). NEVER the session file.
- Config dir facts (config.ts:10, :326): the extension already resolves `~/.pi/agent/settings.json` (global) and `<cwd>/.pi/settings.json` (project). `PI_CODING_AGENT_DIR` env overrides the agent dir (env-vars.md:81). Recommended storage root: `path.join(agentDir, "data", "interrogator")` where agentDir = `process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent")` — extension-local, honors the override, session-independent. node `fs` is available (extensions run as plain TS/JS in-process; draft-store.ts deliberately avoids fs today, persistence.ts uses appendEntry — the new store is the FIRST fs user; note that).
- Keying source for session/branch identity: `ctx.sessionManager.getBranch()` (reconstruct.ts:259-260 types it; reconstruct.ts:17-25 documents semantics). Branch identity = newest entry id on the branch walk (or a hash of it) — derive, don't invent new ids.

## Capture seam — the composed editor

- `src/panel/text-field.ts` is THE choke point: TextField wraps `EditorComponent` (stock `Editor` from createEditorComponent :98, or composed via `ctx.ui.getEditorComponent()` captured in panel.ts:3031). EditorComponent exposes optional extras feature-detected: `getExpandedText?.()`, `focused`, `onChange` (text-field.ts:124-136: TextField installs `editor.onChange = () => onInvalidate()` ONLY when undefined — "never clobber a callback the composed editor's factory already installed").
- **The seam for capture**: a wrap-and-chain installer — install `editor.onChange = () => { previous?.(); capture(...); }` regardless of whether one exists (chain, never replace). Because onChange fires on every buffer mutation (keystrokes AND paste — paste is a buffer change), this satisfies "capture-on-edit including paste" without a separate paste event. Full expanded string via `editor.getExpandedText?.()` (fallback: `getText()`).
- ALL five editor duties flow through TextField instances: panel embedded editor (write-in | elaboration | batch note — duty field tracked in panel.ts :803-811 "which question (or duty) the TextField's buffer currently" holds) and the side-chat composer (`src/panel/sidechat.ts:109` imports createEditorComponent/TextField). So ONE capture hook in TextField (+ duty/key context injection) covers everything. chat-view.ts is pure render (no editor).

## Pacing

- Requirement: progress during continuous typing; never wait indefinitely for idle/send/blur/suspend/shutdown. Standard shape: debounced trailing write with a MAX dirty age — flush within N ms of the first unsaved edit (e.g. 250-500ms debounce, 1000ms max-interval) using `setTimeout` per store; plus opportunistic flush on known sync points (question navigation EXPLAIN-002 write-through, suspend, send cleanup) as accelerators ONLY, never as the sole trigger. Timer must be cancellable on shutdown (persistence.ts:87 shows the cancel-timer seam pattern; extensions.md cleanup: "release resources in session_shutdown even when normal cleanup was attempted; keep it idempotent").

## Atomicity + ordering + failure

- Atomic replace: write to `<file>.tmp` in same dir, `fs.fsyncSync(fd)` before close, `fs.renameSync(tmp, dest)` (POSIX atomic), then optionally fsync the dir fd. Interrupted at any point → previous or new complete value, never torn. One JSON file per key (keying below) keeps writes small and independent.
- Monotonic ordering: each save entry carries a monotonically increasing per-key `seq` (or `Date.now()` max with in-memory counter). The writer only replaces the durable file if `seq >= durable.seq` — an older in-flight write (delayed timer) and incidental empty buffers can never overwrite newer edits. Incidental empties: initialization/view-change/send-cleanup writes of "" must either be skipped (no prior capture for that key ⇒ nothing to save) or carry a seq only minted AFTER real user input (mint seq on first non-init capture; init seeding writes carry no seq ⇒ never saved). Deleting-to-empty IS a real edit (mint seq, save "") per spec :140.
- Failure: wrap fs in try/catch; on failure keep last durable value + live edit, set an internal `lastSaveFailed` flag, NEVER surface "saved" (no widget/flash claims). Recovery reads only fully-renamed files; `.tmp` leftovers ignored/cleaned.

## Keying

`{sessionId/branchId, questionId | "-", field}` where field ∈ {writein, elaboration, note, sidechat-composer}. Branch id derived from `sessionManager.getBranch()` newest entry; cross-branch restore forbidden even with same question id (acceptance case 3).

## Retirement + no-side-effects

- Retirement ONLY on: deliberate discard (explicit user clear — mirror DraftStore's `{explicit:true}` guard, draft-store.ts clearDraft semantics), replacement by the user (newer durable save), successful handoff (commit as answer / successful chat send) — and never clear the only durable copy BEFORE the handoff persists (delete after the answer/send is durably recorded, or mark-retired-after-handoff).
- No-side-effects audit list for the note: save/restore must not call applyAnswer, sendMessage, modelRuntime, submit pipeline, queue, advance, or any panel action — the store is inert like DraftStore ("Deliberately inert" doc block, draft-store.ts).

## Consumers

- P3.M2.T1.S1 (capture wiring, all five duties), S2 (atomic/monotonic/honest failure), S3 (retirement + audit + AC 2/3/4-send-half); P3.M3.T1.S1 (seeding rules: newer draft > recorded answer > blank; intentional-empty preserved), S2 (session-start restore + side-chat composer + AC 1/4-commit-half).

## Untouched / out of scope

- No code in this item — the note is the deliverable. README/spec untouched. P2.M1.T1.S2 (parallel, README-only) is disjoint.
- Blank-answer rejection (P3.M4) is a sibling — the note should mention the interaction (recovered blank drafts seed the editor but never become answers) but not design P3.M4.

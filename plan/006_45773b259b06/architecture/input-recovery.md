# Input recovery — architecture note (P3.M1.T1.S1)

**What this is.** The complete, implementable mechanism design for local input recovery
(durable capture of editor input across crash/hibernation) so P3.M2 (capture + recovery-point
engine) and P3.M3 (restore/seeding) are pure execution. **Binding text**:
`spec/state-and-persistence.md` §Local input recovery (:133-141) + acceptance cases 1-5
(:143-153). This note supersedes the shipped Q6=B restart-loss ruling (draft-store.ts:30-33)
for input recovery ONLY — the in-memory DraftStore seam, its survival matrix, and its
`{explicit: true}` destruction guard remain exactly as shipped. **Scope**: plan artifact;
no source, README, or spec changes. P3.M4 boundary (one sentence, no design): recovered
blank drafts seed the editor but never become answers — blank rejection lives at
`applyAnswer` (sibling item).

---

## storagePath

**Decision**: an extension-local directory `<agentDir>/data/interrogator/input-recovery/`,
where `agentDir = getAgentDir()` imported from `@earendil-works/pi-coding-agent`.

- `getAgentDir()` is ALREADY this extension's resolution precedent: `src/config.ts:27`
  (import) and `src/config.ts:390` (`path.join(getAgentDir(), "settings.json")`). It honors
  the `PI_CODING_AGENT_DIR` override internally (pi dist `config.js:453-459`: env var →
  `expandTildePath`, else `join(homedir(), CONFIG_DIR_NAME, "agent")`) — do NOT hand-roll
  `process.env.PI_CODING_AGENT_DIR ?? ~/.pi/agent`; reuse the export. The override is
  documented for users at `docs/environment-variables.md:81`.
- **Never the session file, never `pi.appendEntry()`**: pi's State table routes "Data
  outside one session" → **External storage** (`docs/extensions.md` §State, :231);
  `appendEntry` rows (:80, :229) write session-file entries, which durable drafts must
  never be (model-context and cache-isolation hazards). Guard tests that would fail on a
  violation: `src/panel/sidechat-cache-isolation.test.ts` (SIDECHAT-005 static scanner,
  :1-30) and the SIDECHAT-002 ephemerality contract (`src/panel/panel.ts:1214`, spec
  :128-130).
- **First fs user**: this is the codebase's FIRST direct filesystem use —
  `src/draft-store.ts:57-59` ("Deliberately inert: NO EventEmitter … NO filesystem") and
  `src/persistence.ts` (appendEntry-only, :14/:61/:108-113) both avoid fs today. Plain
  `node:fs` sync APIs are available (extensions run as in-process TS). Create the directory
  with `fs.mkdirSync(dir, { recursive: true })` at store init; tolerate EEXIST.
- Session-independent by construction: nothing under this directory is tied to the session
  file's lifecycle; `/new`, `/clear`, and reload never touch it (retirement is governed by
  the **retirement** section only).

## atomicity

**Decision**: temp-file + fsync + same-directory rename per write; one JSON document per
recovery file.

Write protocol (per flushed key):

1. Serialize the complete record (see **ordering** for fields: `{key fields, branchTipId,
   seq, text, savedAt}`) to a string in memory.
2. `const tmp = file + ".tmp"` in the SAME directory (same filesystem ⇒ rename is atomic).
3. `fd = fs.openSync(tmp, "w")` → `fs.writeSync(fd, json)` → `fs.fsyncSync(fd)` →
   `fs.closeSync(fd)`.
4. `fs.renameSync(tmp, file)` — atomic on POSIX; readers observe either the previous or the
   new complete file, never a torn one (spec :138).
5. Best-effort directory fsync (`fs.openSync(dir, "r")` → `fs.fsyncSync` → close), wrapped
   in try/catch (value on Linux; harmless no-op elsewhere). Crash between step 4 and 5 is
   covered by spec :138's "within the OS and storage system's durability guarantees".
6. Every fs call in try/catch — failure handling is **failureSemantics**, never a throw
   into the editor path.

Load/recovery protocol: read only files that completed their rename (a `.tmp` never
qualifies); ignore `.tmp` leftovers on read, and opportunistically unlink stray `.tmp`
files in the directory at store init. Node's `readFileSync` of a fully-renamed file yields
a complete document or throws (→ treat as absent, keep defaults — never a partial parse
blessed as data: parse failures are handled as "no recovery value", preserving the
previous-or-new invariant end to end).

## captureSeams

**Decision**: capture via **wrap-and-chain** `onChange` on the two `TextField` instances the
panel already owns, with the key context resolved at capture time and the full expanded
string read through the TextField's feature-detected getter.

Verified real API (installed `@earendil-works/pi-tui/dist/editor-component.d.ts`):

- `onChange?: (text: string) => void` (:20) — OPTIONAL; the handler receives the new text.
- `getExpandedText?(): string` (:29) — OPTIONAL; expands paste markers (real newlines /
  Unicode), vs `getText()` display preview.
- `focused?: boolean` (Focusable surface).

`EditorComponent` is wrapped by `TextField` (`src/panel/text-field.ts:102-208`), which
feature-detects both extras: it installs `editor.onChange = () => this.onInvalidate()`
ONLY when undefined (:131-135, "never clobber a callback the composed editor's factory
already installed") and reads `getExpandedText?.() ?? getText()` (:171). The editor
component itself comes from `createEditorComponent` (text-field.ts:88-99): the composed
factory captured ONCE per openPanel (`src/panel/panel.ts:3031`,
`pi.ui.getEditorComponent?.()`), else the stock pi-tui `Editor`.

**The two instances** (all five editor duties flow through exactly these):

| Instance | Site | Duty → field |
|---|---|---|
| `this.textField` | panel.ts:1192-1203 | `writein` / `elaboration` per `textDuty` (panel.ts:833, declared by `desiredTextDuty` keys.ts:387-392); `note` when `bufferOwner === "note"` (panel.ts:820) |
| `this.chatField` | panel.ts:1215-1227 | `sidechat-composer` (SIDECHAT-001 second TextField from the SAME factory; focused only in chat view; never touches draftSlots/DraftStore — :1208-1214) |

`chat-view.ts` is pure render (no editor) — nothing else constructs an editor. The batch
note is `textField` under `bufferOwner === "note"`; write-in vs elaboration is
`textDuty`; both are panel state the capture provider reads live.

**Installation pattern** (in the panel constructor, AFTER both TextFields are built, per
instance):

```ts
const prev = editor.onChange;                     // TextField's invalidate closure,
editor.onChange = (text) => {                     // or the composed factory's own
  prev?.(text);                                   // callback — CHAIN, never replace
  recovery.capture(field.getText(), currentKey()); // text = expanded text (getExpandedText)
};
```

- Chaining preserves the precedent rule (text-field.ts:131-135): whatever was installed
  first keeps firing; capture is additive. Install after TextField construction so `prev`
  includes TextField's invalidate (render liveness) or the composed factory's callback.
- `currentKey()` is a PROVIDER resolved at capture time — it must read the panel's live
  `bufferOwner` + `textDuty` (textField) and the active chat record's questionId
  (chatField), never a snapshot taken at install time (the buffer's owner changes as the
  user navigates).
- **Paste needs no separate event**: onChange fires on every buffer mutation, and paste IS
  a buffer mutation; `getExpandedText()` returns the expanded string, so the paste
  placeholder/preview never gets saved (spec :137).
- Fallback seam (documented, not primary): if a composed editor is ever found that does not
  invoke `onChange`, ALSO capture on `TextField.handleInput` forwarding
  (text-field.ts:160-163) with a dirty-diff (`lastCaptured !== getText()`). This covers
  every input path through the panel wrapper. Stock `Editor` fires `onChange`; the
  fallback exists so the design does not depend on composed-editor goodwill. Render-cycle
  polling is NOT part of the design (tui.md §"Keep rendering responsive" — invalidate-driven
  rendering; do not add per-frame fs attempts).

## pacing

**Decision**: trailing debounce **250 ms** plus a **hard max dirty age of 1000 ms**,
measured from the FIRST unsaved edit; store constants (not config keys in this item; a
config surface may be added later without protocol changes).

- One flush timer per store instance (not per key): an edit marks its key dirty and arms
  the trailing 250 ms timer; a second deadline timer guarantees a flush within 1000 ms of
  the first-dirty moment even while typing never pauses. This is the requirement-shape for
  spec :137 "Saving must progress during continuous typing; do not wait indefinitely for
  idle, send, blur, suspend or shutdown" — idle/blur/suspend/shutdown MUST NOT be the only
  triggers.
- **Accelerators ONLY** (flush early when they occur, never relied upon): panel suspend
  (`done(null)`), question/navigation switch write-through (the `syncBufferToQuestion`
  switch points behind `bufferOwner`, panel.ts:820/:824-832 — EXPLAIN-002), send cleanup,
  and a best-effort synchronous flush in `session_shutdown` before teardown.
- Timer hygiene mirrors the shipped StateMirror seam (`src/persistence.ts:80-95`):
  `flush()` (synchronous, no awaits) and `dispose()` (cancel pending timers, idempotent,
  safe to call twice). `session_shutdown` calls flush-then-dispose per pi's cleanup rule
  (`docs/extensions.md` §Errors and cleanup: "Release resources in `session_shutdown` …
  Keep cleanup idempotent because cancellation, reload, session replacement, and process
  exit can converge on the same path").
- Seq numbers are minted at CAPTURE time (edit time), not flush time — see **ordering**.

## ordering

**Decision**: per-key monotonic `seq`, minted at capture, enforced at write; incidental
empties never mint; deliberate delete-to-empty does.

- `seq` = a per-key monotonic integer from an in-memory counter held by the store
  instance; on init the counter is seeded from the highest `seq` found on disk for that
  key (across the key's lineage files — see **keying**). Never timestamps (clock skew
  across hibernation); never global (keys evolve independently).
- **Minting rule**: a capture mints `seq = ++counter[key]` ONLY when it represents user
  edit work — an onChange/handleInput-driven capture whose text differs from the last
  captured value for that key. Incidental empty buffers — initialization seeding, view
  change, send cleanup, navigation buffer swaps — capture NOTHING (no mint, no write;
  spec :138 "incidental empty buffers … must not overwrite newer user edits").
- **Deliberate deletion-to-empty IS an edit**: a user-edit capture that lands on `""`
  (previous captured value non-empty) mints a seq and durably saves `""` (spec :140 "An
  intentional deletion to empty is an edit, not an absent draft"). Restore then preserves
  the empty editor over the recorded answer text.
- **Write guard**: the atomic replace (see **atomicity**) proceeds only when
  `payload.seq >= durable.seq` for that key; a lower-seq payload is dropped (a delayed
  older flush can never clobber a newer edit — acceptance case 3). Because seq is minted
  at capture and a flush carries the newest pending payload per key, a stale payload
  normally never reaches disk at all; the guard makes the on-disk invariant unconditional.
- One JSON file per key keeps the comparison trivial (whole-file replace; no read-modify-
  write across keys ⇒ no cross-key lost update).

## keying

**Decision**: key = `{branchId, questionId | "-", field}`, `field ∈ {"writein",
"elaboration", "note", "sidechat-composer"}`; storage = one JSON file per key under a
per-lineage directory; restore accepts a file only when its capture tip is on the current
branch's ancestry.

- `questionId` is the panel question id; `"-"` for the note duty (no question). `field`
  is the duty (see the **captureSeams** table).
- **branchId derivation** (from documented seams only — no invented ids): let `walk =
  ctx.sessionManager.getBranch()` (typed `src/reconstruct.ts:259-261`; walk semantics
  reconstruct.ts:17-25 — the RAW branch, newest entry identifies the leaf). Every entry
  carries a unique string `id` (`SessionEntryBase`, pi dist `session-manager.d.ts:17-22`).
  Capture-time branch tip = `walk[walk.length - 1].id`; `branchKey` = first 16 hex chars
  of `sha256(branchTipId)`. Entry-id uniqueness across sessions makes the lineage check
  session-safe automatically (a `/new` session's ids can never appear in another
  session's walk) — satisfying spec :137 "originating session, branch" with one
  mechanism.
- **Layout**: `<storagePath>/<branchKey>/<questionId>__<field>.json` (questionId
  sanitized to `[A-Za-z0-9._-]{1,80}`, other chars → `_`, with an 8-char sha256 suffix of
  the raw id appended when sanitization changed it). Per-key files make atomic replace
  independent and cheap (chosen over per-branch bundles: no read-modify-write of a shared
  file, no cross-key torn update, retirement = single unlink).
- **Tip growth (resolved)**: the tip id changes as the turn appends entries, so a capture
  during a later turn lands in a NEW `<branchKey>` directory. On write of key K at tip T,
  the store ALSO unlinks K's file in same-lineage ancestor dirs (dirs whose stored
  `branchTipId` is an ancestor-or-equal of T in the current walk) — AFTER the new file's
  rename completed, so a durable copy exists at every instant. Sibling-branch directories
  are never touched. Net effect: typing on a branch keeps exactly one live file per key
  on that branch's lineage.
- **Restore matching** (consumed by P3.M3): for key (questionId, field), scan
  `<storagePath>/*/` for that key's file; accept candidates whose stored `branchTipId` is
  an ancestor-or-equal of the CURRENT tip in the current walk (i.e. the capture happened
  on this very branch, before further growth); pick the highest `seq`. A capture made
  before a fork (tip in the shared prefix) restores into either descendant — resolved
  intentionally: it is the shared lineage's draft, and the case-3 hazard (typing on branch
  A, switching to sibling B, seeing A's text) is still blocked because A's post-fork tips
  are NOT ancestors of B. Exact-tip candidates win ties over deeper ancestors via seq.
- **Cross-branch restore is forbidden** even for identical question ids (acceptance case
  3): a sibling branch's tips fail the ancestry test by construction.

## retirement

**Decision**: a recovery value is retired ONLY by (1) deliberate discard, (2) replacement
by a newer durable save, or (3) successful handoff — and the durable copy is never
removed before the handoff itself is durably recorded.

1. **Deliberate discard** — an explicit user clear of the field mirrors DraftStore's
   destruction guard (`src/draft-store.ts:27-29, :46-52, :111 clearDraft` — destructive
   calls are NO-OPS without `{explicit: true}`): retirement runs ONLY on the explicit
   clear path (minted-seq empty save with a `discarded` marker, or unlink). Nothing
   implicit retires: navigation, view toggles, upserts, suspend (survival matrix
   draft-store.ts:15-25), esc-exit of the editor (that abandons the BUFFER; the seeded
   draft and its durable copy stand — spec :140 "Discarding the edit leaves the recorded
   answer intact").
2. **Replacement** — a newer-seq save for the same key atomically replaces the value in
   place (same path; not a delete-then-write). Includes the migrated ancestor-dir cleanup
   in **keying**.
3. **Successful handoff** — commit-as-answer or successful chat send. ORDER IS
   LOAD-BEARING (acceptance case 4, "kill on either side of the save/commit handoff"):
   first the handoff becomes durably recorded through its OWN ordinary pipeline (answer
   committed into state / send accepted), THEN the key's recovery file is unlinked. Kill
   before handoff-persist ⇒ file intact ⇒ text recoverable as draft; kill after ⇒ answer
   durable, file gone ⇒ restart neither resurrects the draft nor repeats the commit. For
   the side-chat composer: a refused/failed send or aborted turn retires NOTHING — the
   prompt stays recoverable for manual retry without overwriting newer typing (spec :139).
   Side-chat retirement covers input only; no transcript archive exists or is needed
   (spec :128-130, :139).
4. **Restore does NOT retire**: a successful restore leaves the file in place (the user
   may restart again before any handoff); files on non-current lineages are left untouched
   (they belong to branches the user may return to). There is no time-based GC in this
   design.

## failureSemantics

**Decision**: fail silent-and-honest — keep the last durable value and the live edit,
never surface any "saved" indication, guarantee only the latest completed save.

- Every fs operation is individually try/catch-wrapped; on write failure: the pending edit
  stays pending (dirty), `lastSaveFailed` is set internally, and the next flush tick
  (debounce or max-dirty-age) retries naturally — no retry storm, no background loop.
  Read/parse failure on load ⇒ treat as no recovery value for that key (defaults stand).
- **Never claim saved**: no widget line, no flash, no notify, no status text about save
  state anywhere in the UI (spec :138 "never claim the edit was saved"). The ONLY
  durable-state surface in the extension remains the existing interrogation widget; input
  recovery adds none.
- Recovery guarantees the latest COMPLETED save only — never keystrokes the editor never
  received and never a write still in flight (spec :138 tail). A `.tmp` mid-crash is
  discarded (see **atomicity**).
- Store construction and all capture paths are throw-safe into the editor: capture
  failures degrade to memory-only behavior identical to today's DraftStore, never break
  typing, focus, or rendering.
- Isolation failure modes are impossible by construction: the store writes ONLY under its
  own `storagePath` directory (see **storagePath**); it never calls appendEntry,
  sendMessage, or any model surface (audit below).

## No-side-effects audit

Saving and restoring are INERT — the store and its capture hooks must not advance, commit,
queue, submit, send, resend, or call a model (spec :139). P3.M2.T1.S3 ships a static
scanner test (anatomy cloned from `src/panel/sidechat-cache-isolation.test.ts:1-30`, which
proves the pattern) asserting the recovery modules reference NONE of:

- `applyAnswer` / `writeInEnter` / `acceptOptionIndex` / `panelActions.submit` — no answer
  application, no advance, no submission (`src/panel/actions.ts`).
- `state.setStatus` / `state.upsertQuestion` / any `InterrogationState` mutation — no
  state commits or queueing (`src/state.ts`).
- `sendMessage` / `sendUserMessage` / `SubmitDeps` delivery — no message or submission
  transport.
- `streamSimple` / sidechat engine turn APIs (`src/panel/sidechat-engine.ts`) — no model
  calls.
- `pi.appendEntry` / session-manager write APIs — no session-file writes (isolation).
- `shipDrafts` / `clearDraft` / `clearAll` without `{explicit: true}` — the memory
  DraftStore is not the durable store and is never mutated as a side effect of capture or
  restore (`src/draft-store.ts:111, :117`).
- `noteSubmissionDelivered` / completion-trigger / auto-close lifecycle — no lifecycle
  side effects (`src/lifecycle.ts`, `src/completion.ts`).
- Panel navigation/advance helpers (`nextUnanswered`-driven movement) — restore seeds
  buffers only; it never moves the panel cursor or changes answers.

Allowed surface: `fs` under `storagePath`, timers, `getBranch()` reads, and the two
TextField hooks. Restored content is editor TEXT only (`setText`/`seed`), applied through
the existing draft-seeding seams in P3.M3 — never through an answer path.

## Consumers map

| Consumer | Sections it implements | Acceptance cases unblocked |
|---|---|---|
| P3.M2.T1.S1 — capture wiring, all five duties | captureSeams (wrap-and-chain, per-instance key provider), keying (key fields) | 1, 2 |
| P3.M2.T1.S2 — write protocol engine | storagePath, atomicity, pacing, ordering, failureSemantics | 1, 2, 3 (no-false-saved), 4 (recoverable both sides) |
| P3.M2.T1.S3 — retirement + no-side-effects guard | retirement, No-side-effects audit | 3 (discard/delay), 4 (handoff order, failed/aborted send) |
| P3.M3.T1.S1 — re-edit/commit seeding | ordering (delete-to-empty preserved), retirement (discard semantics), spec :140 seeding ladder: newer draft > exact `answer.value` > blank | 4 (no repeat commit), 5 (newer edit wins, prior answer intact) |
| P3.M3.T1.S2 — session-start restore + composer restore | keying (ancestry restore rule), captureSeams (chatField), failureSemantics, storagePath | 1 (exact draft), 3 (no cross-branch restore) |

(P3.M5.T1.S2 consumes the Verification log for the final README/spec docs sync.)

## Verification log

| # | Seam | Read | Result |
|---|---|---|---|
| 1 | Binding text | `spec/state-and-persistence.md:133-153` | §Local input recovery bullets :137-141 + acceptance cases :143-153 confirmed |
| 2 | TextField seams | `src/panel/text-field.ts` (full) | onChange only-if-undefined :131-135 ("never clobber"); `getExpandedText?.() ?? getText()` :171; handleInput :160-163; createEditorComponent :88-99 |
| 3 | Installed EditorComponent API | `node_modules/@earendil-works/pi-tui/dist/editor-component.d.ts:20, :29` | `onChange?: (text: string) => void`, `getExpandedText?(): string` — both OPTIONAL, feature-detect confirmed |
| 4 | Composed factory capture | `src/panel/panel.ts:3031` | `pi.ui.getEditorComponent?.()` captured once per openPanel confirmed |
| 5 | Duty tracking | `src/panel/panel.ts:820, :824-833`; `src/panel/keys.ts:387-392` | `bufferOwner: string \| "note"`; `textDuty: "writein" \| "elaboration"`; `desiredTextDuty` confirmed |
| 6 | Side-chat composer | `src/panel/panel.ts:1208-1227` | **CORRECTION vs findings.md**: `sidechat.ts:109` does NOT import TextField — `sidechat.ts:4` is a "pure leaf module: ZERO pi imports". The composer is `this.chatField` (panel.ts:1215-1227, second TextField from the same factory; :1214 SIDECHAT-002 ephemerality). All-five-duties-via-TextField conclusion HOLDS with the corrected anchor. Note recorded here per the verify-then-fallback instruction |
| 7 | DraftStore contract | `src/draft-store.ts:15-33, :46-52, :57-59, :111` | memory-only, `{explicit: true}` guard, "Deliberately inert", Q6=B restart loss confirmed (superseded by this note for recovery only) |
| 8 | Branch identity | `src/reconstruct.ts:17-25, :259-261`; pi dist `session-manager.d.ts:17-22` | raw `getBranch()` walk, newest entry = leaf; `SessionEntryBase.id: string` unique per entry |
| 9 | Agent dir | `src/config.ts:27, :390`; pi dist `config.js:436-437, :453-459`; `docs/environment-variables.md:81` | `getAgentDir()` export honors `PI_CODING_AGENT_DIR` (default `~/.pi/agent`); extension already imports it |
| 10 | pi storage rules | `docs/extensions.md` §Choose an integration point (:71-87), §State (:222-234), §Errors and cleanup (:259-264) | `appendEntry` = session entries (:80, :229); "Data outside one session → External storage" (:231); restore-from-getBranch precedent (:234); idempotent `session_shutdown` cleanup (:263-264) |
| 11 | Debounce/dispose precedent | `src/persistence.ts:14, :61, :80-95, :108-113` | flush()/dispose() idempotent-cancel seam; appendEntry-only persistence (drafts must not join it) |
| 12 | Isolation guard | `src/panel/sidechat-cache-isolation.test.ts:1-30` | SIDECHAT-005 static scanner — the audit-test template; session-file writes forbidden |
| 13 | Render contract | `docs/tui.md` §"Keep rendering responsive" (:106) | invalidate-driven rendering — render-cycle polling excluded from the capture design |

# Research — P3.M5.T1.S2 (README + docs sync for local input recovery)

All facts verified against working tree at HEAD (2026-11-21) and the P3 base commit
`11e864d` ("seven recovery axes resolved; capture track opens").

## 1. S1 gate verdict contract (input this item consumes)

`plan/006_45773b259b06/P3M5T1S1/PRP.md` — S1 produces a **report-only JSON verdict**
(no repo file): head sha, cases 1-5 results, suite counts, typecheck/lint, five guard
results, diffConfined, anomalies. Marked "consumed by P3.M5.T1.S2". S2's pre-condition
is that verdict being green (or orchestrator status showing S1 Complete).

## 2. Exact README edit targets (line numbers at current HEAD; grep anchors provided)

| Line(s) | Current text | Action |
|---|---|---|
| :409 | AC-9 row: "…reopens restored state (answers with their elaborations and ✎ write-ins); **drafts gone (documented)**; pending answers ship…" | Reword to mirror spec/product-requirements.md:94 → "…`/interrogate` reopens with questions/answers restored (any status mix); **editor recovery is tested separately (FR-28)**; pending answers ship on the next commit or submit (AUTOSUBMIT-001)." |
| :423 | Limitations blockquote contains "**cross-restart draft persistence (documented limitation)**" | DELETE that item from the list (others stay) |
| :425-431 | Bullet "**Drafts are in-session only**: …restores questions and submitted answers … **never in-progress drafts**" | REWRITE — recovery shipped (suggested prose in PRP) |
| :432-435 | Side-chat ephemeral bullet ("lives only for the session … never an open chat") | KEEP restart-lost for the conversation; ADD composer-recovers distinction (SIDECHAT-002) |
| :386-388 | Side chat § closing: "The chat lives in extension memory only — nothing about it is written to the session file" | Still TRUE; optionally add composer carve-out cross-ref |
| :113-115 | Usage restart prose: "run `/interrogate` and the restored questions and answers come right back" | Optional one-phrase extension: drafts too |
| :557+ | Project structure tree — missing `input-capture.ts`, `input-durability.ts`, `input-restore.ts` | ADD 3 rows (tree lists source files only, no tests) |
| :151-183 | Config JSONC reference | NO CHANGE — see §3 |

## 3. Config surface: ZERO new settings (verified negative)

- `git diff 11e864d -- src/config.ts` → **EMPTY**. `InterrogatorConfig` has no
  recovery/pacing keys.
- Pacing is hardcoded: `src/input-capture.ts:96-97` — `DEBOUNCE_MS = 250`,
  `MAX_DIRTY_AGE_MS = 1000`.
- P3.M1 architecture note ruled: "do NOT add config keys in this item — overridable
  via config later" (`plan/006_45773b259b06/architecture/input-recovery.md`, pacing axis).
- So the item's "config reference additions for any new settings **as actually
  implemented**" = document nothing new; verify, don't invent.

## 4. Spec anchors (READ-ONLY — never edit)

- `spec/state-and-persistence.md` §Local input recovery — five bullets (capture on
  edit; recovery point; drafts-not-answers; re-edit/commit ladder; blank rejection)
  + acceptance cases 1-5. NOTE: its preamble still says "**New requirements, not
  shipped.**" — spec/ is read-only; README must NOT mirror that stale framing.
- `spec/state-and-persistence.md` §Side chat (SIDECHAT-002): "Recovery concerns the
  user's input, not the conversation."
- `spec/product-requirements.md:60` — FR-28 (silent restore + editor draft recovery).
- `spec/product-requirements.md:94` — AC-9 authoritative wording (the flip target).
- `spec/implementation-plan.md:56` — README checklist row: "shipped limitations
  (TUI-first; **memory-only drafts until local input recovery ships**)" — qualifier goes.

## 5. Facts for the usage prose

- Storage: `<agentDir>/data/interrogator/` (getAgentDir honors PI_CODING_AGENT_DIR);
  atomic tmp+fsync+rename; NEVER the session file (src/input-durability.ts:13-32;
  enforced by src/no-recovery-side-effects.test.ts).
- Recovery covers five editor duties: ✎ Other/write-in, text answer, elaboration,
  batch note, side-chat composer (src/input-capture.ts).
- Keyed to session/branch + question + field; restores exact string incl. newlines/
  Unicode/whitespace.
- No side effects: recovery never advances/commits/queues/submits/sends/calls a model.
- Blank still rejected at commit (`Answer cannot be blank`).
- TUI-first limitation stays (non-TUI digest flow unchanged).
- New modules for project tree: src/input-capture.ts, src/input-durability.ts,
  src/input-restore.ts (retirement logic lives in input-durability; tests
  input-retirement.test.ts, blank-rejection.test.ts, panel/session-restore.test.ts,
  panel/retirement-sidechat.test.ts, no-recovery-side-effects.test.ts are not listed
  in the README tree — it lists source files only).

## 6. Validation facts

- `npm run lint` = `eslint src scripts *.ts` — does NOT lint README.md; run as a
  no-change sanity gate. typecheck/test unaffected by a README-only diff (S1's
  verdict is the green record).
- Scope gate: `git diff --stat` must show ONLY README.md (plan/ artifacts are
  orchestrator-owned, never audited/edited).
- Residue greps must come back empty: "drafts gone", "in-session only",
  "cross-restart draft persistence", "memory-only".

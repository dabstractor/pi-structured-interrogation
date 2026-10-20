# Research notes — P1.M1.T2.S1 (README keymap record rewrite)

## Verified facts
- Block: README.md:428-504, heading `### Keymap conflict re-verification` at :428; next heading (`## Project structure`) at :505. Read in full.
- Stale items confirmed: :430 header (2026-10-16 / 378b9ee "the side-chat changeset" / pi 1.0.2); :437 "`e` unchanged — passes untouched" (predates KEYMNEMONICS-001 — `e` is now `explain/elaborate`, chat moved to `c`); per-key rows :449-452 show `o`/`t`/`m`/`e` → must be `i` (overview) / `e` (elaborate) / `n` (batchNote) / `c` (chat); :480 letter set "(d o t m e)" → "(d i e n c)".
- Already correct (keep verbatim): `d` row :448; ctrl+s/ctrl+g/tab/shift+tab rows :453-456; avoided-keys table :466-475; fixed-keys prose; panel-intercept rationale structure (only its letter set changes); regression-guard section.
- New defaults (h2.36 table + KEYMNEMONICS-001): deep `d`, overview `i`, elaborate `e`, batchNote `n`, chat `c` (config names UNCHANGED: keys.overview etc.).
- INPUT CONTRACT (P1.M1.T1.S2): VerificationRecord { date (fresh, post-2026-10-16 — expect 2026-10-20), headCommit (ACTUAL git rev-parse — expect eb09516; contract's 7377318 stale), piVersion (expect 1.0.2), perKeyStatus[9] all "ok", driftSince20261016: [] (expected — pi-patty-bg-tasks' five unchanged), exitCode 0 }. Every fact in the block comes from that record; if drift is non-empty, S1's protocol says STOP — do not write around a collision.
- Header wording: replace "the side-chat changeset" with the KEYMNEMONICS-001 changeset reference; method line unchanged (`bash scripts/verify-keymap-conflicts.sh`, exit 0, 9/9 clear).
- Drift prose :438-441: re-derive from the fresh grep — expected shape: "Drift since the 2026-10-16 record: none — only pi-patty-bg-tasks' five… pi-subagents variable-indirect note." Keep the pi-subagents manual-check sentence (still true) but re-derive, don't copy blindly.
- Per-key row status labels: keep "panel-owned" for the 5 bare letters; the bare-letter evidence text ("no global claim possible… never intercept in editor focus") stays valid — only the letters/actions change. `c` (chat) row: same construction.
- Scope guard: docs-only, ONLY README.md within 428-504; spec/ (stale AC-2b/M8 `t` prose) and plan/004_* notes NEVER touched; no code, no tests. Consumers: T2.S2 cross-check + T3.S1 sweep.

## Edit checklist
1. :428-437 header + intro: fresh date/commit/pi + KEYMNEMONICS-001 wording; drop the "`e` unchanged" clause → all five letters are new-ish; state "no default collides; the five bare letters are panel-owned by construction".
2. Rows :448-452: d/i/e/n/c (labels deep/overview/elaborate/batchNote/chat) with fresh statuses.
3. :480 letter set → `d` `i` `e` `n` `c`.
4. Drift prose re-derived; drift sentence baseline "since the 2026-10-16 record".
5. Verify script output lines cited match the record verbatim (9/9, exit 0).

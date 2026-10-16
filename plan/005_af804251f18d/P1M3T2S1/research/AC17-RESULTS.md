# AC17-RESULTS — scripted side-chat acceptance evidence (P1.M3.T2.S1)

Suite: `src/panel/ac-sidechat.test.ts` — 13 tests, all passing, over the REAL
landed modules (sidechat store singleton, createSidechatEngine with an
injected fake SidechatModelPort, chat-view renders, the real InterrogationPanel
key routing / confirm-row / discard hooks). AUTOMATION-POLICY honored: no live
TUI, no real model calls — the fake port is the only model behavior.

Gate at write time: `npm run typecheck` exit 0 · `npm test` 1544/1544 green
(includes this suite + parallel siblings' suites).

## Results table

| AC-17 item | verdict | SIDECHAT | evidence (test) |
|---|---|---|---|
| `e` on q3 → chat opens, NO suspend | PASS | 001 | `AC-17.1_chat_open_no_suspend` (host path: done never resolves, editor surface untouched, no second mount) |
| two-turn exchange streams in-view | PASS | 001/003 | `AC-17.2_two_turn_exchange_streams_in_view` (transcript grows in `get()` + renders via the real view; usage tallies completed turns only) |
| `/clear` resets on the CURRENT question | PASS | 005 | `AC-17.2_slash_clear_resets_on_current_question` (rebound to q4 after navigation; messages+usage zeroed; view stays open) |
| `e` on q5 replaces the singleton | PASS | 002 | `AC-17.3_chat_on_other_question_replaces_singleton` (wholesale: messages gone, usage zeroed, no confirm) |
| answer block → confirm row → enter applies | PASS | 004 | `AC-17.4_confirm_row_and_apply_byte_identical` (`apply ★ sqlite? · enter = yes · esc = no` rendered; apply routes through `acceptOptionIndex`) |
| provenance byte-identity (delta + card) | PASS | 004 | same test — captured `sendMessage` payloads (content AND details) `toEqual` between chat-applied and user-selected fixtures |
| advance + auto-submit + chat vanishes | PASS | 004 | same test (status flushed to `submitted` by the auto-submit; record discarded; close-notice usage line fired) |
| `sideChatAutoApply: true` skips the confirm | PASS | 004 | `AC-17.4_autoapply_skips_confirm` (no confirm row ever rendered; direct apply; auto-submit as usual) |
| esc declines, chat stays open | PASS | 004 | `AC-17.4_esc_declines_keeps_chat` (pendingConfirm+lastRejection cleared, transcript retained, answer NOT applied) |
| panel answer discards the open chat | PASS | 002 | `AC-17.5_panel_answer_discards_open_chat` (driven through the ordinary accept path, never the hook; close-notice fired; no auto-submit while others open) |
| esc-suspend + `/interrogate` resume returns the chat | PASS | 002 | `AC-17.6_suspend_resume_returns_chat` (record survives suspend by identity; fresh rehydrated panel reopens onto the same transcript via the same-question reuse guard) |
| pi restart → no chat, NO session-file residue | PASS | 002 | `AC-17.6_restart_no_chat_no_residue` (structural: state serialize unchanged by the chat; the persistence mirror appended NOTHING during the chat; the only entry type it ever writes is `interrogation-state`; usage never left the record) |
| malformed answer block → in-view notice, chat stays open | PASS | 004 | `AC-17.7_malformed_answer_notice_chat_stays_open` (malformed-json + value-mismatch rounds; `ANSWER_REJECTION_NOTICES` rendered; no pendingConfirm) |
| esc aborts a streaming reply (turn never happened) | PASS | 004/FR-15 | `AC-17.8_esc_aborts_streaming` (buffer visible + `esc abort` hint mid-flight; abort signal fires; full rollback: user turn popped, no assistant row, zero notices, `esc exit` restored) |
| `/usr/bin` path is a message, never a command | PASS | 005 | `AC-17.8_usr_bin_path_is_a_message` (classifier pins for the contract exemplars + the panel send path) |

## Defect log

None — no scenario exposed a production defect; zero seam fixes were needed.
Two test-side iterations during authoring (not product defects): the AC-17.4
fixture initially left q4–q7 open so the completeness transition never fired
(fixed by seeding every non-target question pending), and the restart test
compared serialize() after its own control bumpEpoch (fixed by asserting
pre-bump). The mid-stream buffer/`esc abort` hint proof was consolidated in
AC-17.8, which owns the held-stream machinery.

## Discuss-successor pins (P1.M2.T7.S1) — already landed, not duplicated

- `src/config.test.ts` "discuss→chat legacy alias (SIDECHAT-001)" pins the
  coerceKeys alias (legacy `keys.discuss` feeds `keys.chat` when absent;
  explicit `keys.chat` wins) and that no `discuss` key survives resolution.
- `discuss.ts` is deleted from src/panel/ (verified by directory listing).
- AC-17.1 here additionally pins the no-suspend/no-preload replacement
  behavior (the old discuss handoff is gone end-to-end).

## Manual residuals (for the human runbook — never scripted here)

- Real streaming feel: token cadence, the ▌ cursor while a live provider
  streams, and real-provider abort latency (scripted streams are
  deterministic pushes).
- Real `$EDITOR` round-trip for `ctrl+g` from the chat input's sibling
  editors (external-editor is vi.mock'd in the panel harness world).
- Real model protocol behavior: whether an actual model reliably ends with a
  fenced ```answer block (the fake port scripts conformant replies).
- Visual confirm-row/footer styling at narrow widths and terminal fallbacks
  (render asserts cover content, not palette/geometry feel).
- Actual pi restart residue: scripted as module-reset + mirror/serialize
  structural absence; a human restart checks the real session file.

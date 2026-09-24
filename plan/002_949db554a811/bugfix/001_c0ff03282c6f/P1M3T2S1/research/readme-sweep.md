# README.md sweep — verification record (Mode B, P1.M3.T2.S1)

Swept every doc-sync passage group from `architecture/testing-and-docs.md` §2
against the certified fixed semantics (P1.M3.T1.S1 triage note + h2.5
Recommendations). Line numbers from the passage map drifted with the fix
wave; all navigation was by quoted text.

Result: **5 passages corrected, 10+ verified as-is.** `git diff --stat`
shows README.md only; `npm run typecheck` + `npm test` green after the sweep
(no source touched).

| # | Passage (quote anchor) | BUG | Status | Change |
|---|------------------------|-----|--------|--------|
| 1 | Usage step 3, gate-hold ("While a foundational gate question is unanswered, auto-submit holds: commits show ⚠ …") | BUG-001 | verified-as-is | Already commit-scoped ("commits show" — any commit, not only completeness-adjacent) and names the `ctrl+s` override; matches the re-armed-before-completeness-return fix exactly. `{submit}` placeholder convention kept. |
| 2 | AC 2d ("with a gate question unanswered, commits show ⚠ … and do NOT auto-submit; answering it releases the next commit") | BUG-001 | verified-as-is | Commit-scoped wording already correct. |
| 3 | Usage step 4 ("A submit flushes only the answers that actually shipped — drafts of questions the agent re-asked survive") | BUG-002 | verified-as-is | Submit-flush semantics unchanged by the fix; no gesture enumeration present. |
| 4 | AC 3 ("re-asks preserve drafts") / AC 4 ("drafts intact") | BUG-002 | verified-as-is | True post-fix; AC-9's "drafts gone (documented)" restart limitation is untouched (in-session sacredness only — correct). |
| 5 | Keymap `ctrl+c` row ("Closes the prompt (suspend) and stays unconsumed …") | BUG-002 | **corrected** | OLD implied a bare suspend with no draft mention → NEW: "Closes the prompt (suspend) — the in-flight text is written to its question's draft first (R4) — and stays unconsumed; pi's own ctrl+c flow … resumes on the restored editor". |
| 6 | Keymap editor paragraph ("switching questions while typing saves the text to its question automatically.") | BUG-002 | **corrected (extension)** | Appended the generic invariant: "Every editor exit is a draft write-through (R4): question switches, `esc`, `ctrl+c`, discuss in chat, note mode — typed-but-unsubmitted text always lands in its question's draft; no exit gesture destroys it." (Generic form preferred over enumerating per-gesture rows, per PRP.) |
| 7 | AC 13 ("Editing an archived answer re-marks it pending; next diff card highlights the change.") | BUG-003 | verified-as-is | Reachable post close-pass-snapshot fix; no hedge ("best-effort") present. `(changed)` render literal NOT imported (spec/ui-spec.md is S2's scope). |
| 8 | Usage step 2 duty description ("the duty follows context …") | BUG-004 | verified-as-is | "Follows context" is the fixed rule (duty re-derived from cursor on navigation); no persistence implication to remove. |
| 9 | Keymap focusText row + tab/shift+tab rows | BUG-004 | verified-as-is | "duty follows context — elaboration on a selected option, write-in on the `✎ Other` row or a text question" already matches cursor-follow; nav rows make no duty claims. |
| 10 | Usage step 2, write-in duty sentence ("…the text IS the answer and `enter` commits it immediately.") | BUG-008 | **corrected (extension)** | Appended: "On a `type:"text"` question, `enter` on the `✎ answer…` affordance itself opens the editor in the write-in duty — `ctrl+t` is not the only entry." (Traces to P1.M2.T5.S1: accept() opens the editor, write-in duty, seeded from draft.) |
| 11 | Keymap `enter` row ("Accept + advance; confirm dialogs; in the editor, per duty: …") | BUG-008 | **corrected** | Inserted: "on a text question's `✎ answer…` affordance it opens the editor (write-in duty)" between dialogs and the in-editor duty list — the row previously omitted enter's new (fixed) behavior on the text affordance. |
| 12 | Keymap write-in paragraph surface list ("every surface that shows the answer (submission diff cards, `{}` reads, the completion record and recap card, the overview)") | BUG-005 | **corrected** | Added the short view to the enumerated surfaces: "…, the overview, and the short view on revisit — `✎` on the question line plus a dimmed preview of the recorded value". Careful NOT to claim the cursor re-seeds to the recorded answer (BUG-005 fixed visibility only). |
| 13 | AC 2a ("card/delta render `✎ {text}`") | BUG-005/006 | verified-as-is | Summary wording compatible with capped/flattened rendering; no unbounded-render claim to fix. |
| 14 | Usage step 3, delta shape ("compact delta message … ending with `(state epoch {n})`") | BUG-006 | verified-as-is | "Compact" + epoch-suffix claims are now enforced behavior (per-entry cap + newline flattening + suffix pinned); README never hedged about multi-line write-ins, so no drift existed. |
| 15 | AC 2c ("answering the LAST question ships with no keypress beyond the answer … by … text `enter`") | BUG-008 | verified-as-is | Wording accurate — now MORE true (plain enter reaches the text flow via the affordance). |
| 16 | Bridge acks | BUG-007 | verified-as-is (no passage) | README documents the bridge only in Project structure (`remote-bridge.ts` / `remote-submit.ts` one-liners); no ack/hang claims anywhere. **Nothing added** — internal robustness fix, not user-facing panel behavior. |
| 17 | `## Configuration` block + bullets | — | verified-as-is | Key names/defaults/coercion text unchanged by the wave; `gateWarnings` line ("display-only, never blocks") remains accurate post-BUG-001. |
| 18 | `## Limitations` (3 bullets) | — | verified-as-is (audited) | Drafts bullet: in-session-only claim still true (BUG-002 improved in-session sacredness, not restart persistence). Non-TUI bullet: "once recorded, the interrogation closes and the completion record is injected when the agent settles" — TRUE post-fallback markSubmitted fix. No entry documents a now-fixed behavior as a limitation. |

## Explicit non-edits (drift-only discipline)

- No spec/ file touched (P1.M3.T2.S2's scope); `(changed)` literal not imported.
- No key labels hardcoded in behavior copy: `{submit}` placeholder preserved at the
  gate-hold line; literal key names only where the Keymap table / fixed-key rows
  already use them.
- No section renumbering/restructuring; no bridge-ack section added.
- No claim that the revisit cursor moves to the recorded answer (BUG-005 scope).

## Gate

- `git diff --stat` → README.md only.
- `npm run typecheck` → exit 0. `npm test` → all green (proves zero source edits).

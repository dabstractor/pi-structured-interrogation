# Research — P1.M1.T3.S1 (README stale key-fossil sweep)

## Verified current README state (live read; line numbers drift slightly if S1/S2 land first)

### Canonical letter set (KEYMNEMONICS-001, h2.83; config.ts DEFAULT_CONFIG via P1.M1.T2.S2 cross-check)
`d` deep · `i` list (overview) · `e` explain (elaborate) · `n` note (batchNote) · `c` chat. Config FIELD names unchanged (`keys.overview` default `i`, `keys.chat` default `c`, `keys.elaborate` default `e`, `keys.batchNote` default `n`).

### Elaborate `t` → `e` fossils (verified present)
- :45 "a re-pressed `t` just types the letter" → `e`
- :50 "`t` is not the only entry" (write-in duty sentence) → `e`
- :83 "the elaborations you attached with `t`" → `e`
- :263 bare-key set "(`d`, `o`, `t`, `m`, `e`)" → "(`d`, `i`, `e`, `n`, `c`)"
- :265-266 "typing `t` in an answer must insert a `t`" → "typing `e` ... an `e`" (sentence keeps its generic-bare-key point)
- :358 AC 2b row "`t`, type, `enter`" → "`e`, type, `enter`"

### Chat `e` → `c` fossils (side-chat prose predates KEYMNEMONICS-001; verified present)
- :296 "Like every bare key, `e` works from non-editor focus" → `c`
- :301 "Opening `e` on another question aborts the…" → `c`
- :340 "pressing `e` again re-focuses the chat input" → `c`
- :375 AC 17 "`e` opens the per-question in-panel chat" → `c`
- :393 "in non-TUI modes `e` is inert" → `c`

### Already-correct surfaces (DO NOT churn — verified)
:37-38 usage paragraph (`d`/`i`/`e` correct), :288 ("Press `c` on any question"), :297 ("config key is `keys.chat` (default `c`)"), keymap table :194-203, sample settings :147-160 (S2's domain; assume verified).

### BOUNDARY — the record block (:428-504) is S1's deliverable
Lines ~449-451 (`o`/`t`/`m` rows) and ~480 ("`d` `o` `t` `m` `e`") currently show OLD letters — they sit INSIDE the record block that P1.M1.T2.S1 (status Complete; may land in-tree after this research) rewrites. NOT this sweep's territory: if the implementer still sees old letters there, S1's rewrite hasn't landed — VERIFY and REPORT in the subtask result; do not double-edit S1's block.

### DO-NOT-TOUCH
- spec/*.md (declared stale prose, human-owned; PRD names spec fossils at product-requirements.md:84, implementation-plan.md:29, ui-spec.md:94/:135)
- plan/004_*/architecture/*.md (past-changeset history)
- No docs/ directory exists; README is the only overview doc.

## Re-grep recipe (contract: "re-grep until zero stale hits remain outside DO-NOT-TOUCH")
```bash
grep -n '`t`\|`o`\|`m`' README.md | grep -v 'ctrl\|shift'   # expect only record-block rows (S1's) after the sweep
grep -n '`e` opens\|`e` works\|`e` on\|`e` again\|`e` is inert\|bare.*`e`' README.md  # expect no chat-e prose
grep -n '`c`' README.md  # confirm the five chat sites now read c
```
Also confirm `git diff --name-only` ⊆ {README.md}.

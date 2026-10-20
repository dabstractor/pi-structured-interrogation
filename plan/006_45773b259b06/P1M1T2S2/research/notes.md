# Research notes — P1.M1.T2.S2 (README keymap table + sample settings vs config.ts)

## Verified comparison (working tree, this session)

**src/config.ts DEFAULT_CONFIG.keys (:118-128)**:
deep `d` · overview `i` · elaborate `e` · batchNote `n` · submit `ctrl+s` ·
chat `c` · externalEditor `ctrl+g` · prevQuestion `tab` · nextQuestion `shift+tab`

**README.md sample settings block (:147-179, key lines :152-160)**: `deep: "d"`,
`overview: "i"`, `elaborate: "e"`, `batchNote: "n"`, `submit: "ctrl+s"`,
`chat: "c"`, `externalEditor: "ctrl+g"`, `prevQuestion: "tab"`,
`nextQuestion: "shift+tab"` — **9/9 MATCH**, same field names, same lowercase
verbatim accelerator spelling, per-key comments consistent with actions.

**README.md keymap table (:194-203)**: rows read d / i / e / n / ctrl+s / c /
ctrl+g / tab / shift+tab against keys.deep/overview/elaborate/batchNote/submit/
chat/externalEditor/prevQuestion/nextQuestion — **9/9 MATCH** including config
field NAMES (KEYMNEMONICS-001 moved letters, not names — keys.overview stays
"overview" etc.; README correctly does NOT rename fields to match letters).

**Record block (:428-504)**: being rewritten by S1 (parallel) from the fresh
VerificationRecord (2026-10-20 run, per-key d/i/e/n/c + chords) — its per-key
rows will match by construction; S2 verifies, doesn't edit that block.

**Item contract's "Keys must read" list** matches all three surfaces exactly.

## Verdict
Expected outcome: **verification no-op** (PRD AC-2 requires the check regardless).
If drift is found: fix in README.md ONLY, in place, this subtask.

## Ordering risk
S1 edits README :428-504 concurrently. S2 touches at most :152-160 / :194-203 —
disjoint hunks. Verify against the POST-S1 README (or the shared working tree) so
no false drift is reported from a mid-flight state.

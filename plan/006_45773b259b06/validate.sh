#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate.sh — pi-interrogator comprehensive validation
#
# Phases (only those that exist in this codebase):
#   1. Linting            — eslint (typescript-eslint recommended) via npm run lint
#   2. Type checking      — tsc --noEmit (npm run typecheck)
#   3. Style checking     — none configured (no prettier/biome config) — noted
#   4. Unit testing       — vitest run (npm test) — 54 files / 1624 tests expected
#   5. Static guards      — keymap conflict script + README/spec/source gates:
#                            5.1 scripts/verify-keymap-conflicts.sh (README regression guard)
#                            5.2 README free of removed-chord vocabulary (ctrl+t/d/l, focusText, digit)
#                            5.3 no pi.registerShortcut in production source (breakOut removal)
#                            5.4 README keymap table + sample settings match src/config.ts defaults
#                            5.5 caps engine stays deleted (CAPS-OUT-001: no caps.ts / applyCaps / caps config)
#                            5.6 side-chat production modules never touch the session (cache-isolation ban list)
#   6. E2E (headless pi)  — the AUTOMATION-POLICY-sanctioned surface:
#                           headless `pi -p` one-shot probes driving the REAL
#                           extension in a REAL pi process (non-TUI fallback
#                           path: digest + answers[] + guards + completion
#                           injection + restart reconstruction). NEVER opens a
#                           TUI panel, NEVER waits on a human
#                           (plan/001_0d6760db6bc5/AUTOMATION-POLICY.md).
#
# Usage:  bash validate.sh               (full run; E2E needs `pi` on PATH + model access)
#         SKIP_E2E=1 bash validate.sh    (skip phase 6)
#
# Exit code: 0 iff every executed phase passes.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ENTRY="$REPO_ROOT/src/index.ts"
WORK="$(mktemp -d /tmp/pi-interrogator-validate.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0
FAILED_PHASES=()

log()  { printf '%s\n' "$*"; }
ok()   { PASS_COUNT=$((PASS_COUNT+1)); printf '  %sPASS%s  %s\n' "$GREEN" "$RESET" "$1"; }
bad()  { FAIL_COUNT=$((FAIL_COUNT+1)); printf '  %sFAIL%s  %s\n' "$RED" "$RESET" "$1"; }
warn() { WARN_COUNT=$((WARN_COUNT+1)); printf '  %sWARN%s  %s\n' "$YELLOW" "$RESET" "$1"; }
section() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RESET"; }

# ---------------------------------------------------------------------------
# Phase 0 — environment
# ---------------------------------------------------------------------------
section "Phase 0: environment"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || { bad "node not found"; exit 1; }
[ -d "$REPO_ROOT/node_modules" ] && ok "node_modules present" || { bad "node_modules missing — run npm install"; exit 1; }
if command -v pi >/dev/null 2>&1; then ok "pi $(pi --version 2>/dev/null | head -1)"; else warn "pi not on PATH — E2E phase will fail (or SKIP_E2E=1)"; fi

# ---------------------------------------------------------------------------
# Phase 1 — linting (eslint, typescript-eslint recommended)
# ---------------------------------------------------------------------------
section "Phase 1: linting (eslint — typescript-eslint recommended)"
if (cd "$REPO_ROOT" && npm run --silent lint >"$WORK/lint.log" 2>&1); then
  ok "eslint clean"
else
  bad "eslint failed"; sed 's/^/      /' "$WORK/lint.log" | head -30
  FAILED_PHASES+=("lint")
fi

# ---------------------------------------------------------------------------
# Phase 2 — type checking
# ---------------------------------------------------------------------------
section "Phase 2: type checking (tsc --noEmit)"
if (cd "$REPO_ROOT" && npm run --silent typecheck >"$WORK/typecheck.log" 2>&1); then
  ok "tsc --noEmit clean"
else
  bad "typecheck failed"; sed 's/^/      /' "$WORK/typecheck.log" | head -30
  FAILED_PHASES+=("typecheck")
fi

# ---------------------------------------------------------------------------
# Phase 3 — style checking (none configured)
# ---------------------------------------------------------------------------
section "Phase 3: style checking"
if [ -f "$REPO_ROOT/.prettierrc" ] || ls "$REPO_ROOT"/.prettierrc* >/dev/null 2>&1 || [ -f "$REPO_ROOT/biome.json" ]; then
  warn "formatter config exists but no format-check npm script — formatter not gated here"
else
  warn "no formatter/linter config (.prettierrc*/biome) — no style gate exists for this repo"
fi

# ---------------------------------------------------------------------------
# Phase 4 — unit tests
# ---------------------------------------------------------------------------
section "Phase 4: unit tests (vitest run)"
if (cd "$REPO_ROOT" && npm test >"$WORK/test.log" 2>&1); then
  TESTS_SUMMARY="$(grep -E 'Tests +[0-9]+ passed' "$WORK/test.log" | tail -1 | tr -s ' ')"
  FILES_SUMMARY="$(grep -E 'Test Files +[0-9]+ passed' "$WORK/test.log" | tail -1 | tr -s ' ')"
  ok "vitest green — ${FILES_SUMMARY:-files}, ${TESTS_SUMMARY:-tests}"
else
  bad "vitest failed"; grep -E "FAIL|✗|×|AssertionError" "$WORK/test.log" | head -20 | sed 's/^/      /'
  FAILED_PHASES+=("unit-tests")
fi

# ---------------------------------------------------------------------------
# Phase 5 — static guards (spec gates that must hold at every commit)
# ---------------------------------------------------------------------------
section "Phase 5: static guards"

# 5.1 keymap conflict verification (README regression guard)
if (cd "$REPO_ROOT" && bash scripts/verify-keymap-conflicts.sh >"$WORK/keymap.log" 2>&1); then
  ok "verify-keymap-conflicts.sh PASS (no default collides with a global claim)"
else
  bad "verify-keymap-conflicts.sh failed"; tail -15 "$WORK/keymap.log" | sed 's/^/      /'
  FAILED_PHASES+=("keymap-conflicts")
fi

# 5.2 README removed-chord vocabulary gate (regex wanted here)
if ! grep -qE -- 'ctrl\+t|ctrl\+d|ctrl\+l|focusText|digitQuickSelect|advanceArmed' "$REPO_ROOT/README.md"; then
  ok "README free of removed-chord vocabulary (ctrl+t/d/l, focusText, digitQuickSelect, advanceArmed)"
else
  bad "README still names removed keys/machinery:"; grep -nE 'ctrl\+t|ctrl\+d|ctrl\+l|focusText|digitQuickSelect|advanceArmed' "$REPO_ROOT/README.md" | head -5 | sed 's/^/      /'
  FAILED_PHASES+=("readme-chord-gate")
fi

# 5.3 no global shortcut registration in production source (breakOut removal)
if ! grep -rn "registerShortcut(" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | grep -q .; then
  ok "no pi.registerShortcut call in production source (ctrl+shift+q chord stays removed)"
else
  bad "production source registers a global shortcut:"; grep -rn "registerShortcut(" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | head -3 | sed 's/^/      /'
  FAILED_PHASES+=("no-register-shortcut")
fi

# 5.4 README keymap table + sample settings must match src/config.ts DEFAULT_CONFIG
#     (KEYMNEMONICS-001: deep d, overview i, elaborate e, batchNote n, submit
#      ctrl+s, chat c, externalEditor ctrl+g, prevQuestion tab, nextQuestion shift+tab)
README_KEYMAP_OK=1
while IFS=' ' read -r action key; do
  # sample settings line: "deep": "d",   OR table row: | `keys.deep`  | `d` |
  if ! grep -q "\"$action\":" "$REPO_ROOT/README.md" || \
     ! grep -q "\"$action\": *\"$key\"" "$REPO_ROOT/README.md"; then
    bad "README config sample missing keys.$action = \"$key\""; README_KEYMAP_OK=0
  fi
  if ! grep -q "keys\.$action" "$REPO_ROOT/README.md"; then
    bad "README keymap table missing keys.$action"; README_KEYMAP_OK=0
  fi
done <<'KEYS'
deep d
overview i
elaborate e
batchNote n
submit ctrl+s
chat c
externalEditor ctrl+g
prevQuestion tab
nextQuestion shift+tab
KEYS
if grep -q '"overview": *"i"' "$REPO_ROOT/README.md" && grep -q '"chat": *"c"' "$REPO_ROOT/README.md"; then
  :
else
  bad "README sample settings do not carry the KEYMNEMONICS-001 defaults (i/c)"; README_KEYMAP_OK=0
fi
[ $README_KEYMAP_OK -eq 1 ] && ok "README keymap table + sample settings match src/config.ts DEFAULT_CONFIG (9/9 keys)" \
  || FAILED_PHASES+=("readme-keymap-sync")

# 5.5 caps engine stays deleted (CAPS-OUT-001, 2026-10-08 owner ruling)
if [ ! -f "$REPO_ROOT/src/caps.ts" ] && \
   ! grep -rn "applyCaps\|descriptionCap\|minRamification\|minDescription\|CapsConfig" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | grep -q .; then
  ok "caps engine stays deleted — no caps.ts, no caps config/type refs in production source (CAPS-OUT-001)"
else
  bad "caps engine residue found:"; { ls "$REPO_ROOT/src/caps.ts" 2>/dev/null; grep -rn "applyCaps\|descriptionCap\|minRamification\|minDescription\|CapsConfig" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | head -5; } | sed 's/^/      /'
  FAILED_PHASES+=("caps-deleted")
fi

# 5.6 side-chat cache-isolation ban list (SIDECHAT-005) — production modules
#     in panel/sidechat*, panel/chat-view* must never touch the session.
if ! grep -rnE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
     "$REPO_ROOT/src/panel/sidechat.ts" "$REPO_ROOT/src/panel/sidechat-engine.ts" \
     "$REPO_ROOT/src/panel/sidechat-prompt.ts" "$REPO_ROOT/src/panel/chat-view.ts" \
     "$REPO_ROOT/src/panel/branch-snapshot.ts" 2>/dev/null | grep -v '^\s*//' | grep -v '\* ' | grep -q .; then
  ok "side-chat production modules contain no session-touching calls (SIDECHAT-005 ban list)"
else
  bad "side-chat module references a banned session call:"; grep -rnE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" "$REPO_ROOT/src/panel/sidechat.ts" "$REPO_ROOT/src/panel/sidechat-engine.ts" "$REPO_ROOT/src/panel/sidechat-prompt.ts" "$REPO_ROOT/src/panel/chat-view.ts" 2>/dev/null | grep -v '^\s*//' | head -5 | sed 's/^/      /'
  FAILED_PHASES+=("sidechat-isolation")
fi

# ---------------------------------------------------------------------------
# Phase 6 — E2E: headless pi probes (AUTOMATION-POLICY §scripted equivalents)
#
# Each probe launches a REAL `pi -p` process with the REAL extension loaded,
# drives the model to call the REAL `interrogate` tool, and asserts on the
# tool-side invariants in the JSON event stream. No TUI, no panel, no human.
# ---------------------------------------------------------------------------
section "Phase 6: E2E — headless pi one-shot probes"

run_pi() { # run_pi <outfile> <timeout-secs> <prompt>...
  local out=$1; local tmo=$2; shift 2
  (cd "$WORK" && timeout "$tmo" pi -p --no-session --mode json \
     -e "$EXT_ENTRY" --tools interrogate "$@" >"$out" 2>&1)
}

# probe <name> <expected-in-tool-result> <prompt>
# Asserts that at least one tool_execution_end result content matches ALL
# newline-free fragments in the ||-separated expected string (grep -F each).
probe() {
  local name=$1 expected=$2 prompt=$3
  local out="$WORK/e2e-${name// /_}.jsonl"
  if ! run_pi "$out" 240 "$prompt"; then
    bad "$name — pi process failed (exit $?)"
    FAILED_PHASES+=("e2e:$name"); return 1
  fi
  python3 - "$out" "$expected" <<'PYEOF'
import json, sys
outfile, expected = sys.argv[1], sys.argv[2]
frags = expected.split("||")
texts = []
try:
    with open(outfile) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: ev = json.loads(line)
            except: continue
            if ev.get("type") == "tool_execution_end":
                for c in ev.get("result", {}).get("content", []):
                    if c.get("type") == "text":
                        texts.append(c.get("text", ""))
except FileNotFoundError:
    sys.exit(2)
joined = "\n===\n".join(texts)
missing = [fr for fr in frags if fr not in joined]
sys.exit(0 if not missing else 1)
PYEOF
  local rc=$?
  if [ $rc -eq 0 ]; then
    ok "$name"
  else
    bad "$name — expected fragment(s) missing from tool results"
    FAILED_PHASES+=("e2e:$name")
  fi
}

# probe_custom <name> <customType> <expected> <prompt> — assert an injected
# custom message (submission/completion) with the expected content fragment.
probe_custom() {
  local name=$1 ctype=$2 expected=$3 prompt=$4
  local out="$WORK/e2e-${name// /_}.jsonl"
  if ! run_pi "$out" 240 "$prompt"; then
    bad "$name — pi process failed (exit $?)"
    FAILED_PHASES+=("e2e:$name"); return 1
  fi
  python3 - "$out" "$ctype" "$expected" <<'PYEOF'
import json, sys
outfile, ctype, expected = sys.argv[1], sys.argv[2], sys.argv[3]
found = False
try:
    with open(outfile) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: ev = json.loads(line)
            except: continue
            msg = ev.get("message", ev)
            if msg.get("role") == "custom" and msg.get("customType") == ctype:
                if expected in msg.get("content", ""):
                    found = True
except FileNotFoundError:
    pass
sys.exit(0 if found else 1)
PYEOF
  local rc=$?
  if [ $rc -eq 0 ]; then ok "$name"; else bad "$name — $ctype message with expected content not observed"; FAILED_PHASES+=("e2e:$name"); fi
}

if [ "${SKIP_E2E:-0}" = "1" ]; then
  warn "SKIP_E2E=1 — headless E2E phase skipped"
elif ! command -v pi >/dev/null 2>&1; then
  bad "pi not on PATH — cannot run E2E"
  FAILED_PHASES+=("e2e-missing-pi")
else
  # E1 — smoke: extension loads and tool registers; digest produced (FR-25)
  probe "E1 smoke: extension loads, tool registered, digest emitted" \
    "0/1 answered · 0 re-asked · 0 moot · epoch 1||Relay this digest verbatim" \
    'Call the interrogate tool ONCE with exactly this argument (every question MUST have a non-empty "description" field): {"goal":"E2E validation probe","questions":[{"id":"q1","title":"engine","prompt":"Which database engine?","description":"Choosing the storage engine for the new service; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"}]}. Then reply with exactly the word DONE and nothing else.'

  # E2 — digest marks the recommended option with ★ (FR-25 / fallback digest).
  probe "E2 fallback digest: recommendation renders ★ + Recommendation line" \
    'SQLite (`sqlite`) ★||Recommendation: SQLite' \
    'Call the interrogate tool ONCE with EXACTLY this JSON argument (copy verbatim; "recommendation" is a field of the QUESTION object, at the same level as "options", never inside an option): {"goal":"stars","questions":[{"id":"q1","prompt":"Which engine?","description":"Picking the storage engine; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"}]}. Then reply DONE.'

  # E3 — record answers: epoch bump (AC-2 non-TUI variant)
  probe "E3 record answers: answered counts + epoch bumps 1→2" \
    "2/2 answered · 0 re-asked · 0 moot · epoch 2" \
    'Do these two tool calls in order, then reply DONE: (1) interrogate with {"goal":"E2E roundtrip","questions":[{"id":"q1","title":"engine","prompt":"Which database engine?","description":"Choosing the storage engine; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"},{"id":"q2","title":"migrations","prompt":"How are migrations run?","description":"How schema changes get applied in environments.","type":"text"}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"postgres"},{"id":"q2","value":"flyway from CLI"}]}.'

  # E4 — completion record injected once with full Q&A (AC-11/AC-14, FR-5)
  probe_custom "E4 completion record injected (non-TUI settle)" \
    "interrogation-completion" \
    "INTERROGATION COMPLETE — E2E roundtrip" \
    'Do these two tool calls in order, then reply DONE: (1) interrogate with {"goal":"E2E roundtrip","questions":[{"id":"q1","title":"engine","prompt":"Which database engine?","description":"Choosing the storage engine; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"},{"id":"q2","title":"migrations","prompt":"How are migrations run?","description":"How schema changes get applied in environments.","type":"text"}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"postgres"},{"id":"q2","value":"flyway from CLI"}]}.'

  # E5 — stale epoch guard: isError + self-heal + recovery (AC-8)
  probe "E5 stale guard: STALE message, then self-heal with correct epoch" \
    "STALE: session epoch is 1 (you sent 99)||1/1 answered · 0 re-asked · 0 moot · epoch 2" \
    'Do these three tool calls in order, then reply DONE: (1) interrogate with {"questions":[{"id":"q1","prompt":"Pick?","description":"A simple preference question between two options.","type":"choice","options":[{"value":"a","label":"A"},{"value":"b","label":"B"}]}]}. (2) interrogate with {"epoch":99,"answers":[{"id":"q1","value":"a"}]} — this will fail with a stale error; that is expected. (3) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"a"}]}.'

  # E6 — TRUST-001: long write-in reaches the model INTACT via read result,
  #      rendered as ✎ in the scan line (WRITEIN-001)
  probe "E6 TRUST-001: long write-in full text in read detail + ✎ scan line" \
    "  answer: We deploy via GitHub Actions on every merge to main: build, run vitest, then a canary pod for 15 minutes absorbing 5% of traffic before full rollout, with automatic rollback on error-rate regression beyond two standard deviations of the seven-day baseline.||✎ We deploy via GitHub Actions" \
    'Do these three tool calls in order, then reply DONE: (1) interrogate with {"goal":"trust","questions":[{"id":"q1","prompt":"Describe the deployment pipeline in detail?","description":"Free-text answer describing the deployment pipeline end to end.","type":"text"}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"We deploy via GitHub Actions on every merge to main: build, run vitest, then a canary pod for 15 minutes absorbing 5% of traffic before full rollout, with automatic rollback on error-rate regression beyond two standard deviations of the seven-day baseline.","custom":true}]}. (3) interrogate with {} — a read.'

  # E7 — dependsOn moot + withdrawOmitted keeps answers + options-change re-ask (FR-17/FR-21/FR-19)
  probe "E7 moot + withdrawOmitted + reasked (merge rules)" \
    "0/3 answered · 1 re-asked · 1 moot · epoch 2||withdrew (withdrawOmitted): q2||q2: ORM? — withdrawn (rev 1) · answered: prisma||q1: Storage? — reasked (rev 2)" \
    'Do these tool calls in order, then reply DONE: (1) interrogate with {"goal":"prune","questions":[{"id":"q1","prompt":"Storage?","description":"Where data lives; sqlite enables litestream backups, filesystem does not.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"fs","label":"Filesystem"}]},{"id":"q2","prompt":"ORM?","description":"Which object-relational mapper to standardize on.","type":"choice","options":[{"value":"prisma","label":"Prisma"}]},{"id":"q3","prompt":"Backup tool?","description":"Continuous backup; only meaningful for sqlite storage.","type":"choice","options":[{"value":"litestream","label":"Litestream"}],"dependsOn":[{"id":"q1","equals":"sqlite"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"fs"},{"id":"q2","value":"prisma"}]}. (3) interrogate with {"epoch":2,"questions":[{"id":"q1","rev":1,"prompt":"Storage?","description":"Where data lives; filesystem only now.","type":"choice","options":[{"value":"fs","label":"Filesystem"}]}],"withdrawOmitted":true}. (4) interrogate with {} — a read.'

  # E8 — standing moot does NOT block completion (2026-10-07 amendment).
  #      Prompt pins the user's choice (fs) so q2 goes moot deterministically.
  probe_custom "E8 standing moot does not block completion record" \
    "interrogation-completion" \
    "Withdrawn/moot: q2 (moot: q1=fs)" \
    'Do these tool calls in order then reply DONE: (1) interrogate with {"goal":"moot complete","questions":[{"id":"q1","prompt":"Storage?","description":"Where data lives; sqlite enables litestream backups, filesystem does not.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"fs","label":"FS"}]},{"id":"q2","prompt":"Backup?","description":"Continuous backup; only meaningful for sqlite storage.","type":"choice","options":[{"value":"litestream","label":"Litestream"}],"dependsOn":[{"id":"q1","equals":"sqlite"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"fs"}]} — the user chose fs; record exactly that answer and nothing else.'

  # E9 — session restart reconstruction: state survives a fresh process (FR-28 read side / AC-9)
  SESSDIR="$WORK/sessions"; mkdir -p "$SESSDIR"
  (cd "$WORK" && timeout 240 pi -p --session-dir "$SESSDIR" --name validate-restart --mode json \
     -e "$EXT_ENTRY" --tools interrogate \
     'Call interrogate ONCE with {"goal":"restart probe","questions":[{"id":"q1","prompt":"Engine?","description":"Which engine to use.","type":"choice","options":[{"value":"a","label":"A"}]},{"id":"q2","prompt":"Scale?","description":"Expected scale of deployment.","type":"text"}]} then reply DONE.' \
     >"$WORK/e2e-restart-a.jsonl" 2>&1)
  SESS_FILE="$(ls -t "$SESSDIR"/*.jsonl 2>/dev/null | head -1)"
  if [ -n "${SESS_FILE:-}" ] && [ -f "$SESS_FILE" ]; then
    (cd "$WORK" && timeout 240 pi -p --session "$SESS_FILE" --mode json \
       -e "$EXT_ENTRY" --tools interrogate \
       'Call interrogate with {} — a read — then reply DONE.' \
       >"$WORK/e2e-restart-b.jsonl" 2>&1)
    if python3 - "$WORK/e2e-restart-b.jsonl" <<'PYEOF'
import json, sys
found = False
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try: ev = json.loads(line)
        except: continue
        if ev.get("type") == "tool_execution_end":
            for c in ev.get("result", {}).get("content", []):
                t = c.get("text", "")
                if "Goal: restart probe" in t and "q1: Engine? — open (rev 1)" in t and "q2: Scale? — open (rev 1)" in t:
                    found = True
sys.exit(0 if found else 1)
PYEOF
    then ok "E9 session restart: state reconstructs in a fresh process (goal+questions+revs)"; else
      bad "E9 session restart: read after resume did not return reconstructed state"; FAILED_PHASES+=("e2e:E9-restart"); fi
  else
    bad "E9 session restart: first session file not created"; FAILED_PHASES+=("e2e:E9-restart")
  fi

  # E10 — description REQUIRED (owner ruling 2026-10-20, commit 7377318):
  #       absent field — rejected by pi's typebox schema layer BEFORE the
  #       extension parses (the wire schema marks it required); isError text
  #       names the offending path questions.0.description.
  probe "E10 description-required: absent field rejected at the wire schema" \
    "questions.0.description||must have required properties description" \
    'Call the interrogate tool ONCE with exactly this argument: {"goal":"bare","questions":[{"id":"q1","prompt":"Pick?","type":"choice","options":[{"value":"a","label":"A"}]}]} — it will be rejected with an error; that is expected. Then reply DONE.'

  # E10b — whitespace-only description passes the typebox layer (it IS a
  #       string) and must be rejected by the EXTENSION's own parse gate,
  #       whose message names the question id (the self-heal signal).
  probe "E10b description-required: whitespace-only rejected by extension gate, id named" \
    "description is REQUIRED and must be a non-empty string (question \"q1\")" \
    'Call the interrogate tool ONCE with exactly this argument: {"goal":"ws","questions":[{"id":"q1","prompt":"Pick?","description":"   ","type":"choice","options":[{"value":"a","label":"A"}]}]} — it will be rejected with an error; that is expected. Then reply DONE.'

  # E11 — write-in elaboration via answers[].text reaches the read result
  #       in full (TRUST-001 elaboration channel)
  probe "E11 elaboration text attaches to recorded answer (read detail)" \
    "  elaboration: We need zero-ops local dev above all else." \
    'Do these three tool calls in order, then reply DONE: (1) interrogate with {"goal":"elab","questions":[{"id":"q1","prompt":"Engine?","description":"Choosing the storage engine.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"sqlite","text":"We need zero-ops local dev above all else."}]}. (3) interrogate with {} — a read.'
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"
log "passed: $PASS_COUNT   failed: $FAIL_COUNT   warnings: $WARN_COUNT"
if [ ${#FAILED_PHASES[@]} -gt 0 ]; then
  log "failed phases: ${FAILED_PHASES[*]}"
  exit 1
fi
log "ALL PHASES GREEN"
exit 0

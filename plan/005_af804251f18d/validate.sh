#!/usr/bin/env bash
# ============================================================================
# validate.sh — pi-interrogator comprehensive validation
#
# Phases (only those that exist in this codebase):
#   1. Lint            — eslint (npm run lint)
#   2. Type checking   — tsc --noEmit (npm run typecheck)
#   3. Unit testing    — vitest run (npm test)
#   4. Keymap conflicts — scripts/verify-keymap-conflicts.sh
#   5. Structural/spec conformance — discuss sweep, registerShortcut ban,
#                                     sidechat isolation module set
#   6. E2E: live pi journeys — real `pi -p` one-shot probes driving the
#      actual extension (jiti load, tool calls, session persistence,
#      reconstruction). Headless print-mode ONLY, per the project's
#      AUTOMATION-POLICY (plan/001_0d6760db6bc5/: no live TUI sessions in
#      automated runs; `pi -p` probes are explicitly sanctioned).
#
# Usage: bash validate.sh [--skip-e2e]
# Exit code: 0 iff every phase passed (E2E skip due to no model provider is
# reported but does not fail the run; every executed check must pass).
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
PASS_COUNT=0; FAIL_COUNT=0; SKIP_COUNT=0
declare -a FAILURES=()

pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  %sPASS%s  %s\n" "$GREEN" "$RESET" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES+=("$1"); printf "  %sFAIL%s  %s\n" "$RED" "$RESET" "$1"; }
skip() { SKIP_COUNT=$((SKIP_COUNT+1)); printf "  %sSKIP%s  %s\n" "$YELLOW" "$RESET" "$1"; }
phase() { printf "\n%s== %s ==%s\n" "$BOLD" "$1" "$RESET"; }

# Helper: count interrogation-completion custom messages in a session JSONL.
completion_count() { # $1 = session file
  node -e '
    const fs=require("fs");
    let n=0;
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);
        if(e.type==="custom_message"&&e.customType==="interrogation-completion")n++;
      }catch{}
    }
    console.log(n);
  ' "$1"
}

# Helper: dump all interrogate toolResult texts (joined by \x01 separators).
toolresult_texts() { # $1 = session file
  node -e '
    const fs=require("fs");
    const out=[];
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);
        if(e.type==="message"&&e.message&&e.message.role==="toolResult"&&e.message.toolName==="interrogate"){
          const c=e.message.content;
          const txt=typeof c==="string"?c:(Array.isArray(c)?c.map(b=>b&&b.text||"").join("\n"):"");
          out.push(txt);
        }
      }catch{}
    }
    console.log(out.join("\x01"));
  ' "$1"
}

# Helper: print ONLY the LAST interrogate toolResult text (robust selection,
# no shell text munging).
last_toolresult() { # $1 = session file
  node -e '
    const fs=require("fs");
    let last="";
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);
        if(e.type==="message"&&e.message&&e.message.role==="toolResult"&&e.message.toolName==="interrogate"){
          const c=e.message.content;
          last=typeof c==="string"?c:(Array.isArray(c)?c.map(b=>b&&b.text||"").join("\n"):"");
        }
      }catch{}
    }
    console.log(last);
  ' "$1"
}

# Helper: newest session file in a dir.
newest_session() { ls -t "$1"/*.jsonl 2>/dev/null | head -1; }

# Helper: run one pi print-mode turn. $1=session-dir $2=extra-flags $3=prompt
pi_turn() {
  local dir="$1"; shift
  local flags="$1"; shift
  local prompt="$1"; shift
  mkdir -p "$dir"
  timeout 240 pi -p --session-dir "$dir" -e "$ROOT/src/index.ts" $flags "$prompt" 2>&1
}

SKIP_E2E=0
for arg in "$@"; do [ "$arg" = "--skip-e2e" ] && SKIP_E2E=1; done

printf "%s╔══════════════════════════════════════════════════════════╗
║  pi-interrogator — comprehensive validation               ║
╚══════════════════════════════════════════════════════════╝%s\n" "$BOLD" "$RESET"

# ============================================================================
phase "Phase 1: Linting (eslint)"
if npm run lint >/tmp/itg-lint.log 2>&1; then
  pass "eslint clean (src scripts *.ts)"
else
  fail "eslint reported issues:"$'\n'"$(tail -30 /tmp/itg-lint.log)"
fi

# ============================================================================
phase "Phase 2: Type checking (tsc --noEmit)"
if npm run typecheck >/tmp/itg-tsc.log 2>&1; then
  pass "tsc --noEmit clean"
else
  fail "tsc reported errors:"$'\n'"$(tail -30 /tmp/itg-tsc.log)"
fi

# ============================================================================
phase "Phase 3: Unit / integration tests (vitest)"
if npm test >/tmp/itg-vitest.log 2>&1; then
  pass "vitest run: $(grep -E "Tests  [0-9]+ passed" /tmp/itg-vitest.log | tail -1 | tr -s ' ')"
else
  fail "vitest failures:"$'\n'"$(grep -E "FAIL|Tests  |Test Files  " /tmp/itg-vitest.log | tail -10)"
fi

# ============================================================================
phase "Phase 4: Keymap conflict re-verification"
if bash scripts/verify-keymap-conflicts.sh >/tmp/itg-keymap.log 2>&1 \
   && grep -q "^PASS:" /tmp/itg-keymap.log; then
  pass "no default key collides with an avoided or extension-claimed key"
else
  fail "keymap conflict verification failed:"$'\n'"$(tail -20 /tmp/itg-keymap.log)"
fi

# ============================================================================
phase "Phase 5: Structural / spec conformance"

# 5a. README must carry zero `discuss` mentions (P1.M3.T3.S1/S2 contract).
if grep -qi "discuss" README.md; then
  fail "README.md still mentions 'discuss': $(grep -in discuss README.md | head -3)"
else
  pass "README.md carries zero 'discuss' mentions"
fi

# 5b. The deleted discuss module must stay gone.
if [ -e src/panel/discuss.ts ]; then
  fail "src/panel/discuss.ts still exists (deleted in P1.M2.T7.S1)"
else
  pass "src/panel/discuss.ts is gone"
fi

# 5c. In src/, 'discuss' may appear ONLY at the config alias site, its
#     fixtures, and non-feature English prose (pre-classified whitelist).
BAD_DISCUSS=$(grep -rn "discuss" src --include="*.ts" -i \
  | grep -v "src/config.ts" \
  | grep -v "src/config.test.ts" \
  | grep -v "keep discussing" \
  | grep -v "as discussed" \
  | grep -v "objectives discussed" \
  | grep -v "ac-sidechat.test.ts" || true)
if [ -n "$BAD_DISCUSS" ]; then
  fail "unexpected 'discuss' mentions in src/:"$'\n'"$BAD_DISCUSS"
else
  pass "src/ 'discuss' sweep clean (alias + fixtures + prose only)"
fi

# 5d. No global registerShortcut call may exist (comments aside).
RS=$(grep -rn "registerShortcut(" src --include="*.ts" \
  | grep -v "\.test\.ts" \
  | grep -vE "^\S+:\s*[0-9]*\s*[*//]|:\s*//" || true)
if [ -n "$RS" ]; then
  fail "registerShortcut call found (spec: none may exist):"$'\n'"$RS"
else
  pass "no registerShortcut call in src/"
fi

# 5e. SIDECHAT-005: the side-chat cluster (ALL five modules, including
#     branch-snapshot.ts) must reference no main-conversation API.
SIDECHAT_MODULES="src/panel/sidechat.ts src/panel/chat-view.ts src/panel/sidechat-engine.ts src/panel/sidechat-prompt.ts src/panel/branch-snapshot.ts"
BANNED_HITS=""
for m in $SIDECHAT_MODULES; do
  if [ ! -e "$m" ]; then BANNED_HITS="$BANNED_HITS
missing module: $m"; continue; fi
  # strip //-comments crudely (the shipped guard does this string-aware; this
  # is a belt-and-braces external check on the same file set)
  hits=$(sed -e 's://.*$::' -e 's:/\*[^*]*\*/: :g' "$m" \
    | grep -nE '\b(sendMessage|sendUserMessage|setActiveTools|registerTool|setModel)\b' || true)
  [ -n "$hits" ] && BANNED_HITS="$BANNED_HITS
$m: $hits"
done
if [ -n "$BANNED_HITS" ]; then
  fail "SIDECHAT-005 banned-API hits:"$'\n'"$BANNED_HITS"
else
  pass "SIDECHAT-005: all 5 side-chat modules clean of banned APIs"
fi

# 5f. The shipped guard's file list should cover the whole cluster
#     (branch-snapshot.ts included).
if grep -q '"branch-snapshot.ts"' src/panel/sidechat-cache-isolation.test.ts; then
  pass "shipped cache-isolation guard covers branch-snapshot.ts"
else
  fail "shipped sidechat-cache-isolation.test.ts SIDECHAT_FILES omits 'branch-snapshot.ts' (cluster module; the guard's own contract says to grow the list)"
fi

# ============================================================================
phase "Phase 6: E2E — live pi journeys (print mode, real model)"

E2E_DIR=$(mktemp -d /tmp/itg-validate-XXXXXX)

if [ "$SKIP_E2E" -eq 1 ]; then
  skip "E2E disabled via --skip-e2e"
else
  # Provider availability probe.
  if ! timeout 120 pi -p --no-session "Reply with exactly: OK" >/tmp/itg-probe.log 2>&1 \
     || ! grep -q "OK" /tmp/itg-probe.log; then
    skip "no usable model provider for live E2E probes (baseline probe failed) — see /tmp/itg-probe.log"
  else
    pass "baseline model probe (default provider)"

    # ---- 6.1 Extension load under the INSTALLED pi (jiti factory) --------
    OUT=$(timeout 120 pi -p --no-session -e "$ROOT/src/index.ts" "Reply with exactly: OK" 2>&1)
    if echo "$OUT" | grep -q "OK" && ! echo "$OUT" | grep -qiE "^(Error|Cannot|extension.*fail)"; then
      pass "extension loads cleanly under installed pi (factory + registrations)"
    else
      fail "extension load probe produced errors: $(echo "$OUT" | head -5)"
    fi

    # ---- 6.2 Read {} on a stateless session is graceful -------------------
    D="$E2E_DIR/read-empty"; mkdir -p "$D"
    pi_turn "$D" "" "Call the interrogate tool with an empty object {} right now (a read). Report the exact tool result text verbatim, then stop." >/dev/null 2>&1
    S=$(newest_session "$D")
    if [ -n "$S" ] && toolresult_texts "$S" | grep -q "0/0 answered"; then
      pass "read {} with no state is graceful (0/0 status line)"
    else
      fail "read {} on stateless session: no graceful 0/0 tool result found (session: $S)"
    fi

    # ---- 6.3 Full lifecycle: upsert -> digest -> answers -> completion ----
    D="$E2E_DIR/lifecycle"; mkdir -p "$D"
    pi_turn "$D" "" "Call the interrogate tool exactly once with goal 'E2E validation test' and exactly these two questions (send nothing else in the questions array): question 1: id 'q1', title 'Color', prompt 'Pick a color', type 'choice', options [value 'red' label 'Red', value 'blue' label 'Blue'], recommendation 'red'; question 2: id 'q2', title 'Note', prompt 'Any final note?', type 'text'. Then end your turn immediately without further tool calls." >/dev/null 2>&1
    S=$(newest_session "$D")
    T=$(toolresult_texts "$S")
    if echo "$T" | grep -q "INTERROGATION — E2E validation test" && echo "$T" | grep -q "epoch 1"; then
      pass "upsert: numbered digest + epoch 1 in tool result (FR-25 fallback)"
    else
      fail "upsert: digest/epoch 1 missing from tool results (session: $S)"
    fi
    if grep -q '"customType":"interrogation-state"' "$S" 2>/dev/null; then
      pass "state mirror entries persisted (FR-27 layer 3)"
    else
      fail "no interrogation-state mirror entries in session file"
    fi

    pi_turn "$D" "-c" "My answers: q1 = blue, q2 = 'ship it on Friday'. Record them now via the interrogate tool's answers parameter in one call, then end your turn." >/dev/null 2>&1
    S=$(newest_session "$D")
    T=$(toolresult_texts "$S")
    if echo "$T" | grep -q "2/2 answered" && echo "$T" | grep -q "epoch 2"; then
      pass "answers[]: recorded, epoch bumped to 2 (non-TUI submission)"
    else
      fail "answers[]: 2/2 answered / epoch 2 not found in tool results"
    fi
    N=$(completion_count "$S")
    if [ "$N" -eq 1 ]; then
      pass "completion record injected exactly once at close (FR-5)"
    else
      fail "expected exactly 1 interrogation-completion after answering everything, found $N"
    fi

    # ---- 6.4 REGRESSION: duplicate completion after restart ---------------
    # Restart the process with a plain turn (no interrogation activity) and
    # re-count completion injections. Spec (commitment 2 / FR-5): still 1.
    pi_turn "$D" "-c" "Just say 'hello' — no tool calls." >/dev/null 2>&1
    S=$(newest_session "$D")
    N=$(completion_count "$S")
    if [ "$N" -eq 1 ]; then
      pass "restart + plain turn: still exactly 1 completion (exactly-once survives restart)"
    else
      fail "REPRODUCED duplicate completion injection: $N interrogation-completion messages after restart + plain turn (spec: exactly 1). Reconstruction resurrects the completed state (completed flag lost), the close pass re-archives it, and attemptCompletion re-fires."
    fi

    # ---- 6.5 New interrogation after completion should start FRESH -------
    # (2026-09-14 pin: fresh epoch 1, empty questions after completion.)
    pi_turn "$D" "-c" "Call interrogate with a brand new question: id 'n1', title 'Fresh', prompt 'Start over?', type 'choice', options [value 'yes' label 'Yes', value 'no' label 'No']. Report the epoch shown in the tool result." >/dev/null 2>&1
    S=$(newest_session "$D")
    LAST=$(last_toolresult "$S")
    if echo "$LAST" | head -1 | grep -q "0/1 answered" && echo "$LAST" | grep -q "epoch 1"; then
      pass "post-completion upsert started a fresh interrogation (0/1 answered, epoch 1)"
    else
      fail "REPRODUCED stale-resurrection: post-restart upsert after completion did NOT start fresh (2026-09-14 pin: fresh state, epoch 1). Last upsert result begins: $(echo "$LAST" | head -2 | tr '\n' ' ')"
    fi

    # ---- 6.6 Stale epoch guard + self-heal (AC-8) --------------------------
    D="$E2E_DIR/stale"; mkdir -p "$D"
    pi_turn "$D" "" "Call the interrogate tool exactly once with goal 'Stale test' and two questions: id 's1', title 'Lang', prompt 'Which language?', type 'choice', options [value 'ts' label 'TypeScript', value 'py' label 'Python']; id 's2', title 'Size', prompt 'Team size?', type 'text'. Then end your turn." >/dev/null 2>&1
    # Bump the epoch with a partial submission first, so the next update's
    # epoch 1 is genuinely stale.
    pi_turn "$D" "-c" "Record one answer via the interrogate answers parameter: s2 = 'about ten people' (with the current epoch). Do not answer s1. Then end your turn." >/dev/null 2>&1
    pi_turn "$D" "-c" "Now call interrogate to update question s1: send questions:[{id 's1', title 'Lang', prompt 'Which language? (v2)', type 'choice', options [value 'ts' label 'TypeScript', value 'py' label 'Python', value 'go' label 'Go'], rev 1}] with epoch 1 (deliberately the WRONG epoch). Report the exact tool result text. Then re-apply correctly against current state (same edit) and report that result too." >/dev/null 2>&1
    S=$(newest_session "$D")
    T=$(toolresult_texts "$S")
    if echo "$T" | grep -q "STALE:"; then
      pass "stale epoch upsert rejected with STALE + current state (FR-22)"
    else
      fail "stale upsert: no STALE rejection found in tool results"
    fi
    LAST=$(last_toolresult "$S")
    if echo "$LAST" | grep -q "1 re-asked"; then
      pass "healed re-apply: changed options reset answer + re-asked marker (merge rule 2)"
    else
      fail "healed re-apply: expected '1 re-asked' in final result"
    fi

    # ---- 6.7 Restart reconstruction with live questions (AC-9 core) -------
    D="$E2E_DIR/reconstruct"; mkdir -p "$D"
    pi_turn "$D" "" "Call the interrogate tool exactly once with goal 'Restart test' and exactly two questions: id 'r1', title 'Lang', prompt 'Which language?', type 'choice', options [value 'ts' label 'TypeScript', value 'py' label 'Python']; id 'r2', title 'Size', prompt 'Team size?', type 'text'. Then end your turn." >/dev/null 2>&1
    pi_turn "$D" "-c" "Record only one answer via the interrogate answers parameter: r1 = py. Do not answer r2. Then end your turn." >/dev/null 2>&1
    pi_turn "$D" "-c" "Call the interrogate tool with an empty object {} to read current state, then report exactly: the epoch number, and for each question its id and status. Nothing else." >/dev/null 2>&1
    S=$(newest_session "$D")
    LAST=$(last_toolresult "$S")
    if echo "$LAST" | grep -q "1/2 answered" && echo "$LAST" | grep -q "epoch 2"; then
      pass "restart reconstruction: partial state restored (1/2 answered, epoch 2)"
    else
      fail "restart reconstruction: read after restart missing 1/2 answered + epoch 2 (got: $(echo "$LAST" | head -2 | tr '\n' ' '))"
    fi

    # ---- 6.8 Deliberate withdrawal (withdrawOmitted) ------------------------
    pi_turn "$D" "-c" "Send ONE upsert with questions=[{id 'r2', title 'Size', prompt 'Team size? (final)', type 'text'}] plus withdrawOmitted: true and the current epoch — this should withdraw r1 and update r2's prompt. Report the tool result's withdrawal notice line." >/dev/null 2>&1
    S=$(newest_session "$D")
    T=$(toolresult_texts "$S")
    if echo "$T" | grep -q "withdrew (withdrawOmitted): r1"; then
      pass "withdrawOmitted: set-replace withdrawal reported (patch-semantics pin)"
    else
      fail "withdrawOmitted: 'withdrew (withdrawOmitted): r1' notice not found"
    fi
  fi
fi

# ============================================================================
phase "Summary"
printf "  checks passed: %s%d%s   failed: %s%d%s   skipped: %s%d%s\n" \
  "$GREEN" "$PASS_COUNT" "$RESET" "$RED" "$FAIL_COUNT" "$RESET" "$YELLOW" "$SKIP_COUNT" "$RESET"
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "\n  %sFailures:%s\n" "$RED" "$RESET"
  for f in "${FAILURES[@]}"; do printf "  - %s\n" "$(echo "$f" | head -3 | tr '\n' ' ')"; done
  exit 1
fi
printf "\n  %sALL CHECKS PASSED%s\n" "$GREEN" "$RESET"
exit 0

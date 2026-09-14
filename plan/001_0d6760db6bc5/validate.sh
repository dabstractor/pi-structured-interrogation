#!/usr/bin/env bash
# ============================================================================
# validate.sh — pi-interrogator comprehensive validation
#
# Phases (only what exists in this codebase):
#   1. Type checking            (npm run typecheck)
#   2. Unit / integration tests (npm test — 43 files, vitest)
#   3. Keymap conflict guard    (scripts/verify-keymap-conflicts.sh)
#   4. Extension headless load  (pi -p --no-session -e src/index.ts)
#   5. Scripted E2E journey     (jiti harness driving the REAL exported
#                                modules end-to-end, with REAL pi event arg
#                                shapes — the automation-policy-compliant
#                                equivalent of a live TUI pass)
#   6. Real-model headless probes (pi -p one-shots: tool digest relay +
#                                answers[] round trip). Set SKIP_LLM_PROBES=1
#                                to skip (requires the configured LLM).
#
# Per AUTOMATION-POLICY.md: never a live TUI session, never a live
# interrogate tool call waiting on a human, never a turn left pending.
# The pi -p probes exercise the non-TUI fallback (digest + answers[]),
# which returns immediately and never waits.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
FAILURES=0
declare -a FAILED_PHASES=()

fail()   { echo "  ✗ FAIL: $*"; FAILURES=$((FAILURES+1)); FAILED_PHASES+=("$*"); }
pass()   { echo "  ✓ PASS: $*"; }
header() { echo ""; echo "════════════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════════════"; }

# ---------------------------------------------------------------------------
header "Phase 0: Environment"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -ge 22 ]; then pass "node v$(node --version) (>= 22 required)"; else fail "node too old: $(node --version)"; fi
[ -d node_modules ] && pass "node_modules present" || { echo "  … installing"; npm install >/dev/null 2>&1 || fail "npm install"; }
command -v pi >/dev/null && pass "pi CLI on PATH ($(pi --version 2>/dev/null | head -1))" || fail "pi CLI not on PATH"

# ---------------------------------------------------------------------------
header "Phase 1: Type checking (tsc --noEmit)"
if npm run --silent typecheck >/tmp/v-typecheck.log 2>&1; then
  pass "typecheck clean"
else
  fail "typecheck"; tail -30 /tmp/v-typecheck.log
fi

# ---------------------------------------------------------------------------
header "Phase 2: Unit + integration tests (vitest)"
if npm test >/tmp/v-tests.log 2>&1; then
  pass "$(grep -E 'Tests\s+[0-9]+ passed' /tmp/v-tests.log | tail -1 | tr -s ' ')"
else
  fail "vitest suite"; grep -E 'FAIL|✗|×' /tmp/v-tests.log | head -20; tail -20 /tmp/v-tests.log
fi

# ---------------------------------------------------------------------------
header "Phase 3: Keymap conflict regression guard"
if bash scripts/verify-keymap-conflicts.sh >/tmp/v-keymap.log 2>&1; then
  pass "no default key collides with an avoided or extension-claimed key"
else
  fail "keymap conflict guard"; cat /tmp/v-keymap.log
fi

# ---------------------------------------------------------------------------
header "Phase 4: Extension headless load probe"
OUT="$(timeout 90 pi -p --no-session -e src/index.ts "Reply with exactly: LOADED" 2>&1 | tail -3)"
if echo "$OUT" | grep -q "LOADED"; then
  pass "extension loads headless via pi -p (factory, tool, commands, renderers all register)"
else
  fail "headless load probe — output: $OUT"
fi

# ---------------------------------------------------------------------------
header "Phase 5: Scripted E2E journey (real modules, real event shapes)"
# Generates a jiti harness in /tmp (no project files touched) that drives the
# same exported functions the pi runtime drives: executeInterrogate,
# buildSubmission/deliverSubmission, createLifecycle/createCompletionTrigger,
# with tool_execution_* events carrying the args shape the real tool schema
# produces ({questions:[...], epoch} — NO synthetic "action" field).
cat > /tmp/pi-interrogator-e2e.mjs <<'HARNESS'
const BASE = "/home/dustin/projects/pi-structured-interrogation/";
const results = [];
const check = (name, cond, detail = "") => {
  results.push([cond ? "PASS" : "FAIL", name, detail]);
  if (!cond) process.exitCode = 1;
};

// ---- module loading via jiti (same loader pi uses for extensions)
let jitiFactory;
const candidates = [
  BASE + "node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs",
];
let jitiUrl;
for (const c of candidates) { try { jitiUrl = (await import(c)).createJiti; jitiFactory = c; break; } catch {} }
if (!jitiUrl) { console.error("cannot locate jiti"); process.exit(2); }
const jiti = jitiUrl(import.meta.url);
const load = (p) => jiti.import(BASE + p);

const stateMod = await load("src/state.ts");
const { createInterrogationState, getState, setState, resetState } = stateMod;
const { executeInterrogate, createInterrogateTool } = await load("src/tool.ts");
const { buildSubmission, deliverSubmission } = await load("src/delivery.ts");
const { createLifecycle } = await load("src/lifecycle.ts");
const { createCompletionTrigger } = await load("src/completion.ts");
const { DEFAULT_CONFIG } = await load("src/config.ts");

const TUI = { mode: "tui", hasUI: true, model: { contextWindow: 200000 } };
const PRINT = { mode: "print", hasUI: false, model: { contextWindow: 200000 } };

function freshState(goal, n = 30, groups = 4) {
  resetState();
  const qs = [];
  for (let i = 1; i <= n; i++) {
    qs.push({
      id: `q${i}`, title: `t${i}`, prompt: `Question ${i}?`, type: "choice",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      recommendation: "a", group: `g${(i - 1) % groups + 1}`, gate: i === 1 ? true : undefined,
    });
  }
  return executeInterrogate({ goal, questions: qs }, TUI, DEFAULT_CONFIG);
}

// ============ J1: first upsert (AC-1 state level) ============
{
  const r = freshState("migration plan");
  check("J1 upsert returns immediately with status + details.state", r.details?.action === "upsert" && r.details.state.order.length === 30);
  check("J1 state registered as singleton, epoch 1", getState()?.epoch === 1);
  check("J1 goal recorded", getState()?.goal === "migration plan");
}

// ============ J2: partial submit → delta ≤3 lines, epoch bump (AC-2) ============
{
  const st = getState();
  st.applyAnswer("q1", { value: "a", at: new Date() });
  st.applyAnswer("q2", { value: "b", at: new Date() });
  const { computeDiff } = await load("src/snapshots.ts");
  const diff = computeDiff(st.serialize(), st.serialize()); // baseline empty; use direct pending diff below instead
  // diff vs last snapshot: first submission — diff against pre-answer baseline
  const preSnap = st.serialize();
  const sent = [];
  const fakePi = { sendMessage: (m, o) => sent.push({ m, o }) };
  // build diff via snapshots computeDiff of (empty baseline, current state)
  const diff2 = computeDiff({ goal: "migration plan", epoch: 1, order: [], questions: {}, completed: false }, st.serialize());
  const msg = buildSubmission(st, diff2, "note one");
  deliverSubmission(fakePi, msg, { isIdle: () => true });
  check("J2 submission content ≤3 lines", msg.content.split("\n").length <= 3, `lines=${msg.content.split("\n").length}`);
  check("J2 reminder line present verbatim", msg.content.includes("Consider how these affect your other questions."));
  check("J2 NOTE line model-visible (R3)", /NOTE: note one/.test(msg.content));
  check("J2 epoch bumped once", st.epoch === 2, `epoch=${st.epoch}`);
  check("J2 sendMessage opts: idle → triggerTurn+followUp", JSON.stringify(sent[0]?.o) === JSON.stringify({ triggerTurn: true, deliverAs: "followUp" }), JSON.stringify(sent[0]?.o));
  const sentBusy = [];
  deliverSubmission({ sendMessage: (m, o) => sentBusy.push(o) }, msg, { isIdle: () => false });
  check("J2 sendMessage opts: busy → steer (no triggerTurn)", JSON.stringify(sentBusy[0]) === JSON.stringify({ deliverAs: "steer" }), JSON.stringify(sentBusy[0]));
  const read = executeInterrogate({}, TUI, DEFAULT_CONFIG);
  const openCount = Object.values(read.details.state.questions).filter(q => q.status === "open").length;
  check("J2 28 questions remain open", openCount === 28, `open=${openCount}`);
}

// ============ J3: auto-close vs re-ask with REAL event args (AC-3, h2.44) ============
{
  freshState("ac3", 4, 2);
  const st = getState();
  st.applyAnswer("q1", { value: "a", at: new Date() });
  st.applyAnswer("q2", { value: "a", at: new Date() });
  st.setStatus("q1", "submitted"); st.setStatus("q2", "submitted");

  const handlers = {};
  const sent2 = [];
  const pi2 = { on: (ev, h) => { (lc2handlers[ev] ??= []).push(h); }, sendMessage: (m) => sent2.push(m) };
  const lc2handlers = handlers;
  const lc2 = createLifecycle({ on: (ev, h) => { (handlers[ev] ??= []).push(h); }, sendMessage: (m) => sent2.push(m) }, {
    onAfterClosePass: createCompletionTrigger(pi2, { lifecycle: { dismissPanel: () => {} }, getState: () => getState() }),
  });
  lc2.noteSubmissionDelivered();

  // Agent reply: rule-1 re-ask of q1 (SAME options, text update only).
  // Per merge rule 4, an upsert that omits ids withdraws them — a re-ask
  // always resends the FULL set (commitment 4: commit-everything-up-front).
  const fullResend = st.orderedQuestions().map(q => ({
    id: q.id, prompt: q.id === "q1" ? "Question 1 (clarified)?" : q.prompt,
    type: q.type, rev: q.rev,
    options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
  }));
  const r = executeInterrogate({ epoch: st.epoch, questions: fullResend }, TUI, DEFAULT_CONFIG);
  check("J3 rule-1 re-ask keeps answer + submitted status (merge rule 1)", st.getQuestion("q1").status === "submitted" && st.getQuestion("q1").answer?.value === "a", `status=${st.getQuestion("q1").status}`);

  // Real event arg shape: the tool schema has NO `action` field — args are
  // exactly what the model sent. (h2.44 expects end-of-run marking.)
  const realArgs = { epoch: st.epoch, questions: fullResend.map(q => ({ ...q })) };
  lc2handlers["tool_execution_start"]?.forEach(h => h({ type: "tool_execution_start", toolCallId: "t1", toolName: "interrogate", args: realArgs }));
  lc2handlers["tool_execution_end"]?.forEach(h => h({ type: "tool_execution_end", toolCallId: "t1", toolName: "interrogate", isError: false }));
  check("J3 upsertedThisRun() true after real-args tool_execution_end (h2.44 / FR-26 input)", lc2.upsertedThisRun() === true, `got ${lc2.upsertedThisRun()}`);

  lc2handlers["agent_settled"]?.forEach(h => h({ type: "agent_settled" }));
  check("J3 rule-1 re-asked q1 NOT closed by the settle pass (h2.44: touched submitted → reasked)", st.getQuestion("q1").status === "reasked", `status=${st.getQuestion("q1").status}`);
  check("J3 untouched submitted q2 closed (archived)", st.getQuestion("q2").status === "closed", `status=${st.getQuestion("q2").status}`);
  check("J3 no completion injected (questions remain open)", sent2.every(m => m.customType !== "interrogation-completion"));
}

// ============ J4: stale guards + self-heal (AC-8) ============
{
  freshState("ac8", 3, 1);
  const st = getState();
  const q1 = st.getQuestion("q1");
  let threw = "";
  try {
    executeInterrogate({ epoch: st.epoch, questions: [{ id: "q1", prompt: "x?", type: "choice", rev: q1.rev + 5, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] }, TUI, DEFAULT_CONFIG);
  } catch (e) { threw = String(e.message); }
  check("J4 stale rev rejected with STALE + current state", threw.includes("STALE") && /rev/.test(threw), threw.slice(0, 80));
  try {
    executeInterrogate({ epoch: 999, questions: [{ id: "q1", prompt: "x?", type: "choice", rev: q1.rev, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] }, TUI, DEFAULT_CONFIG);
    threw = "";
  } catch (e) { threw = String(e.message); }
  check("J4 stale epoch rejected", threw.includes("STALE") || threw.includes("epoch"), threw.slice(0, 80));
  const ok = executeInterrogate({ epoch: st.epoch, questions: [{ id: "q1", prompt: "x?", type: "choice", rev: st.getQuestion("q1").rev, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] }, TUI, DEFAULT_CONFIG);
  check("J4 self-heal re-apply with current rev+epoch succeeds", ok.details.action === "upsert");
}

// ============ J5: non-TUI record answers[] (AC-11 state level) ============
{
  freshState("ac11", 2, 1);
  const st = getState();
  const first = executeInterrogate({ epoch: st.epoch, answers: [{ id: "q1", value: "a" }, { id: "q2", value: "b" }] }, PRINT, DEFAULT_CONFIG);
  check("J5 answers[] recorded in print mode", first.details.state.questions["q1"]?.answer?.value === "a" && first.details.state.questions["q2"]?.answer?.value === "b");
  check("J5 epoch bumped by record", first.details.epoch === st.epoch && st.epoch === 2, `epoch=${st.epoch}`);
  const tuiIgn = executeInterrogate({ epoch: st.epoch, answers: [{ id: "q1", value: "b" }] }, TUI, DEFAULT_CONFIG);
  check("J5 answers[] IGNORED in TUI (h2.20)", tuiIgn.details.state.questions["q1"]?.answer?.value === "a" && /ignored/i.test(tuiIgn.content));
  const read = executeInterrogate({}, PRINT, DEFAULT_CONFIG);
  check("J5 read shows 2/2 answered", /2\/2 answered/.test(read.content), read.content.split("\n")[0]);
}

// ============ J6: completion exactly-once + record format (AC-14) ============
{
  freshState("ac14", 3, 1);
  const st = getState();
  const { markSubmitted } = await load("src/merge.ts");
  st.applyAnswer("q1", { value: "a", at: new Date() });
  st.applyAnswer("q2", { value: "b", at: new Date() });
  st.applyAnswer("q3", { value: "a", at: new Date() });
  markSubmitted(st, ["q1", "q2", "q3"]); // panel submit flush step
  const handlers = {}; const sent = [];
  const pi = { on: (ev, h) => { (handlers[ev] ??= []).push(h); }, sendMessage: (m) => sent.push(m) };
  createLifecycle(pi, { onAfterClosePass: createCompletionTrigger(pi, { lifecycle: { dismissPanel: () => {} }, getState: () => getState() }) });
  const { computeDiff } = await load("src/snapshots.ts");
  const diff = computeDiff({ goal: "ac14", epoch: st.epoch, order: [], questions: {}, completed: false }, st.serialize());
  deliverSubmission(pi, buildSubmission(st, diff));
  handlers["agent_settled"]?.forEach(h => h({ type: "agent_settled" }));
  handlers["agent_settled"]?.forEach(h => h({ type: "agent_settled" })); // double settle: idempotent
  const comps = sent.filter(m => m.customType === "interrogation-completion");
  check("J6 completion injected EXACTLY once", comps.length === 1, `count=${comps.length}`);
  check("J6 record header verbatim (h2.46)", comps[0]?.content?.startsWith("INTERROGATION COMPLETE — ac14"));
  check("J6 every question in record", (comps[0]?.content?.match(/^\[.*\] q\d /gm) || []).length === 3);
  check("J6 state cleared + completed flag", getState().completed === true && getState().orderedQuestions().length === 0);
}

// ============ J7: caps warnings present by default (h2.23 unconditional) ============
{
  resetState();
  const long = "x".repeat(3000);
  // small window (10k tokens) so the scaled budget (0.04×10000×4 = 1600
  // chars) falls below the 3000-char description and truncation engages
  const SMALL = { mode: "tui", hasUI: true, model: { contextWindow: 10000 } };
  const r = executeInterrogate({ goal: "caps", questions: [{ id: "q1", prompt: "p?", type: "choice", description: long, options: [{ value: "a", label: "A" }] }] }, SMALL, DEFAULT_CONFIG);
  check("J7 over-budget description truncated WITH warning (h2.23)", /truncated/i.test(r.content), r.content.split("\n").find(l => /truncat/i.test(l)) ?? "(no warning)");
  check("J7 truncation actually applied", r.details.state.questions["q1"].description.length <= 1600, `len=${r.details.state.questions["q1"].description.length}`);
}

console.log(results.map(([s, n, d]) => `${s === "PASS" ? "✓" : "✗"} ${n}${d ? `  [${d}]` : ""}`).join("\n"));
const failed = results.filter(r => r[0] === "FAIL").length;
console.log(failed === 0 ? "JOURNEY: ALL PASS" : `JOURNEY: ${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
HARNESS
if node /tmp/pi-interrogator-e2e.mjs > /tmp/v-journey.log 2>&1; then
  pass "scripted E2E journey (J1–J7) all green"
  grep -E '^[✓✗]' /tmp/v-journey.log | sed 's/^/    /'
else
  fail "scripted E2E journey — see failures below"
  cat /tmp/v-journey.log
fi

# ---------------------------------------------------------------------------
header "Phase 6: Real-model headless probes (pi -p, non-TUI fallback)"
if [ "${SKIP_LLM_PROBES:-0}" = "1" ]; then
  echo "  − SKIPPED (SKIP_LLM_PROBES=1)"
else
  # P1: model calls interrogate once and relays the digest (AC-11)
  OUT="$(timeout 150 pi -p -e src/index.ts "Call the interrogate tool ONCE with exactly one question: {id:'q1', title:'drink', prompt:'Tea or coffee?', type:'choice', options:[{value:'tea',label:'Tea'},{value:'coffee',label:'Coffee'}], recommendation:'tea', group:'basics'}, goal:'drink preference'. Then relay the tool's digest verbatim in your reply. Do nothing else." 2>&1)"
  if echo "$OUT" | grep -q "★" && echo "$OUT" | grep -qi "tea"; then
    pass "P1 model→tool→digest relay (non-TUI upsert path, ★ recommendation marks)"
  else
    fail "P1 digest relay probe — last lines: $(echo "$OUT" | tail -5 | tr '\n' ' ')"
  fi

  # P2: upsert → answers[] (epoch-guarded) → read (AC-11 full round trip)
  OUT="$(timeout 150 pi -p -e src/index.ts "1) Call interrogate with exactly one question: {id:'q1', title:'drink', prompt:'Tea or coffee?', type:'choice', options:[{value:'tea',label:'Tea'},{value:'coffee',label:'Coffee'}], recommendation:'tea'}. 2) My answer is: tea. Call interrogate again with answers:[{id:'q1', value:'tea'}] plus the epoch from the first result. 3) Then call interrogate with {} to read state. End by printing the final status line from step 3 verbatim on its own line prefixed STATUS:" 2>&1)"
  if echo "$OUT" | grep -q "STATUS: 1/1 answered.*epoch 2"; then
    pass "P2 answers[] + epoch bump + read round trip (STATUS line matches spec format)"
  else
    fail "P2 answers[] round trip — got: $(echo "$OUT" | grep STATUS | tail -1)"
  fi
fi

# ---------------------------------------------------------------------------
header "VERDICT"
if [ "$FAILURES" -eq 0 ]; then
  echo "  ALL PHASES PASSED — codebase validation clean."
  exit 0
else
  echo "  $FAILURES failure(s):"
  for p in "${FAILED_PHASES[@]}"; do echo "   - $p"; done
  exit 1
fi

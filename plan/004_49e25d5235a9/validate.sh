#!/usr/bin/env bash
#
# validate.sh — pi-interrogator comprehensive validation.
#
# Phases (only those the project actually has — no lint/style configs exist):
#   1. Type checking        (tsc --noEmit, per package.json "typecheck")
#   2. Unit + integration   (vitest run, per package.json "test" — 47 files,
#                            incl. the scripted AC suites, guards, regressions)
#   3. Keymap conflict guard (scripts/verify-keymap-conflicts.sh)
#   4. Static spec gates    (README grep gate from P1.M4.T2.S1; no
#                            registerShortcut in source; forbidden-name
#                            residue checks)
#   5. E2E — real runtime   (pi 1.0.2 print-mode probes: extension loads via
#                            jiti, command registered, normal operation
#                            unaffected)
#   6. E2E — factory journey (real factory + real tool executor + real panel
#                            component driven end-to-end against capture
#                            fakes, per AUTOMATION-POLICY: no live TUI, no
#                            real model tool calls, never waits on a human)
#
# Exits nonzero if ANY phase fails.

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PASS=0; FAIL=0
phase() {
  echo
  echo "==================================================================="
  echo "== $1"
  echo "==================================================================="
}
check() { # check <label> <exit-code>
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1"; FAIL=$((FAIL+1)); fi
}

# ---------------------------------------------------------------- Phase 1
phase "Phase 1: Type checking (tsc --noEmit)"
npm run --silent typecheck >/tmp/itg-validate-typecheck.log 2>&1
check "tsc --noEmit" $?

# ---------------------------------------------------------------- Phase 2
phase "Phase 2: Unit + integration tests (vitest run)"
npm test >/tmp/itg-validate-vitest.log 2>&1
rc=$?
tail -6 /tmp/itg-validate-vitest.log | sed 's/^/      /'
check "vitest run (full suite)" $rc
if [ $rc -eq 0 ]; then
  grep -q "Tests  " /tmp/itg-validate-vitest.log \
    && grep "Tests  " /tmp/itg-validate-vitest.log | sed 's/^/      /'
fi

# ---------------------------------------------------------------- Phase 3
phase "Phase 3: Keymap conflict re-verification"
bash scripts/verify-keymap-conflicts.sh >/tmp/itg-validate-keymap.log 2>&1
check "verify-keymap-conflicts.sh" $?

# ---------------------------------------------------------------- Phase 4
phase "Phase 4: Static spec gates"
# P1.M4.T2.S1 README gate — verbatim from the PRD subtask contract.
if grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md >/tmp/itg-validate-readme-grep.log 2>&1; then
  echo "      matched lines:"; sed 's/^/        /' /tmp/itg-validate-readme-grep.log
  check "README grep gate (zero stale keymap names)" 1
else
  check "README grep gate (zero stale keymap names)" 0
fi
# No global shortcut registration may exist in source.
if grep -rn "registerShortcut(" src --include="*.ts" | grep -v "\.test\.ts" | grep -v "^\s*\*" | grep -q "pi\.registerShortcut\|registerShortcut(\""; then
  check "no registerShortcut call in source" 1
else
  check "no registerShortcut call in source" 0
fi
# digitQuickSelect and the digit action must be gone from source.
if grep -rn "digitQuickSelect\|actions\.digit\|\.digit(" src --include="*.ts" | grep -v "\.test\.ts" | grep -qv "digit-quick\|DIGIT-OUT"; then
  grep -rn "digitQuickSelect\|actions\.digit" src --include="*.ts" | grep -v "\.test\.ts" | sed 's/^/        /'
  check "digit quick-select fully removed from source" 1
else
  check "digit quick-select fully removed from source" 0
fi
# hjkl must NOT be configurable (absent from the config schema surface).
if grep -n '"h"\|"j"\|"k"\|"l"' src/config.ts >/dev/null 2>&1; then
  check "hjkl absent from config schema (fixed family)" 1
else
  check "hjkl absent from config schema (fixed family)" 0
fi

# ---------------------------------------------------------------- Phase 5
phase "Phase 5: E2E — real pi runtime (print mode, automation-policy-safe)"
PI_BIN="$(command -v pi || true)"
if [ -z "$PI_BIN" ]; then
  check "pi binary available" 1
else
  check "pi binary available ($(pi --version 2>/dev/null | head -1))" 0
  # 5a. Baseline sanity WITHOUT the extension.
  out="$(timeout 120 pi -p "Reply with exactly: PONG" 2>&1 | tail -1)"
  [ "$out" = "PONG" ]; check "baseline pi -p responds" $?
  # 5b. Extension loads through real jiti; /interrogate is recognized
  #     (a recognized command produces NO 'not a recognized command' text;
  #      its output is a TUI notify, legitimately silent in print mode).
  timeout 120 pi -e src/index.ts -p "/interrogate ping" >/tmp/itg-validate-ping.log 2>&1
  if grep -q "not a recognized command" /tmp/itg-validate-ping.log; then
    check "extension loads; /interrogate command recognized" 1
  else
    check "extension loads; /interrogate command recognized" 0
  fi
  # 5c. Debug subcommand surface registered and harmless on empty state.
  timeout 120 pi -e src/index.ts -p "/interrogate debug state" >/tmp/itg-validate-dbg.log 2>&1
  if grep -q "not a recognized command" /tmp/itg-validate-dbg.log; then
    check "debug subcommand surface registered" 1
  else
    check "debug subcommand surface registered" 0
  fi
  # 5d. Negative control — an unknown command DOES produce the error line
  #     (proves 5b/5c discriminated rather than silently no-op'd).
  timeout 120 pi -e src/index.ts -p "/nonexistent-command-xyz" >/tmp/itg-validate-neg.log 2>&1
  grep -qi "recognized command" /tmp/itg-validate-neg.log
  check "negative control: unknown command is rejected" $?
  # 5e. Normal model operation unaffected with the extension loaded
  #     (round detector, prompt guidelines, event wiring stay inert).
  out="$(timeout 120 pi -e src/index.ts -p "Say OK and nothing else" 2>&1 | tail -1)"
  [ "$out" = "OK" ]; check "normal operation with extension loaded" $?
fi

# ---------------------------------------------------------------- Phase 6
phase "Phase 6: E2E — factory journey (real factory, tool, events, panel)"
# Generates the probe into a temp dir (repo stays untouched) and runs it.
PROBE_DIR="$(mktemp -d /tmp/itg-e2e-validate.XXXXXX)"
cat > "$PROBE_DIR/e2e.mjs" <<'PROBE_EOF'
/**
 * pi-interrogator — factory-level E2E probe.
 * Drives the REAL extension factory (src/index.ts, jiti-loaded exactly like
 * pi loads it) against capture-only fakes, through the journeys the
 * AUTOMATION-POLICY allows: no live TUI session, no real model tool calls,
 * no waiting on humans. Panel mount uses the panel.test.ts fake pattern.
 *   A. Factory wiring  (command/shortcut/tool/events/description/guidelines)
 *   B. Non-TUI journey (AC-11/8/14: digest, read, STALE guards, surgical
 *      upsert, answers[], completion injection + turn trigger)
 *   C. TUI surfacing + keymap (AC-1/15/16; SURFACE-001/002; VIMNAV/
 *      BAREKEYS/DIGIT; ANSWER-PIN; esc ladder; widget format)
 */
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = process.env.ITG_ROOT;
const require = createRequire(
  "/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json",
);
const { createJiti } = require("jiti");
const jiti = createJiti(path.join(ROOT, "src", "index.ts"));
const mod = await jiti.import(path.join(ROOT, "src", "index.ts"));
const factory = mod.default;
if (typeof factory !== "function") { console.error("FAIL: default export is not a function"); process.exit(1); }

class FakePi {
  commands = new Map(); shortcutCalls = []; tools = new Map(); events = new Map();
  sentMessages = []; entries = []; messageRenderers = []; entryRenderers = [];
  widget = undefined; notifies = []; customMounts = []; editorText = undefined;
  ui = {
    custom: (fn) => { let resolve; const p = new Promise((r) => (resolve = r)); this.customMounts.push({ fn, resolve }); return p; },
    setWidget: (key, lines) => { this.widget = { key, lines }; },
    notify: (text, severity) => this.notifies.push({ text, severity }),
    getEditorComponent: () => () => ({ handleInput() { return true; }, focus() {}, blur() {}, focused: false, getText: () => "", setText() {}, render: () => null }),
    setEditorText: (t) => { this.editorText = t; },
  };
  registerCommand(n, d) { this.commands.set(n, d); }
  registerShortcut(...a) { this.shortcutCalls.push(a); }
  registerTool(t) { this.tools.set(t.name, t); }
  on(e, h) { if (!this.events.has(e)) this.events.set(e, []); this.events.get(e).push(h); return () => {}; }
  sendMessage(msg, opts) { this.sentMessages.push({ msg, opts }); }
  appendEntry(e) { this.entries.push(e); }
  registerMessageRenderer(t, f) { this.messageRenderers.push({ type: t, fn: f }); }
  registerEntryRenderer(t, f) { this.entryRenderers.push({ type: t, fn: f }); }
  fire(e, p, c) { for (const h of this.events.get(e) ?? []) h(p, c); }
}
const mkCtx = (mode, extra = {}) => ({
  mode, hasUI: mode === "tui", model: { contextWindow: 200000 }, isIdle: () => true,
  sessionManager: { getBranch: () => [] }, ...extra,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };
const theme = { fg: (_n, s) => s, bold: (s) => s, bg: (_n, s) => s };

// ============================ A. factory wiring
const pi = new FakePi();
await factory(pi);
ok(pi.commands.size === 1 && pi.commands.has("interrogate"), "A1: exactly one command /interrogate");
ok(pi.shortcutCalls.length === 0, "A2: NO global shortcut registered");
ok(pi.tools.size === 1 && pi.tools.has("interrogate"), "A3: interrogate tool registered");
for (const ev of ["session_start", "session_tree", "agent_settled", "tool_execution_start", "tool_execution_end", "session_before_compact", "session_shutdown"])
  ok(pi.events.has(ev), `A4: event subscribed: ${ev}`);
const tool = pi.tools.get("interrogate");
ok(tool.description.trim().split(/\s+/).length <= 120, "A5: tool description <= 120 words");
ok(Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length === 4, "A6: 4 promptGuidelines bullets");
const exec = async (params, ctx, toolCallId = "tc1") => {
  pi.fire("tool_execution_start", { toolName: "interrogate", toolCallId, args: params }, ctx);
  let result, threw = null;
  try { result = await tool.execute(toolCallId, params, undefined, undefined, ctx); } catch (e) { threw = e; }
  pi.fire("tool_execution_end", { toolName: "interrogate", toolCallId, isError: threw !== null }, ctx);
  return { result, threw };
};

// ============================ B. non-TUI journey (print mode)
const printCtx = mkCtx("print");
const qs = [
  { id: "q1", prompt: "Storage engine?", type: "choice", group: "core", gate: true,
    options: [{ value: "sqlite", label: "SQLite" }, { value: "postgres", label: "Postgres" }], recommendation: "sqlite" },
  { id: "q2", prompt: "Runtime?", type: "choice",
    options: [{ value: "node", label: "Node" }, { value: "bun", label: "Bun" }] },
  { id: "q3", prompt: "Codename?", type: "text" },
];
const up1 = await exec({ goal: "validate", questions: qs }, printCtx);
const c1 = up1.result?.content?.[0]?.text ?? "";
ok(up1.threw === null && /\*\*1\./.test(c1) && /Relay this digest verbatim/.test(c1), "B1: print-mode upsert returns numbered digest + relay line");
ok(up1.result?.details?.state?.epoch === 1, "B2: details carry full state, epoch 1");
const rd = await exec({}, printCtx, "tc2");
ok(rd.threw === null && (rd.result?.content?.[0]?.text ?? "").includes("q1: Storage engine?"), "B3: read {} returns full state");
const Q1 = { id: "q1", rev: 1, type: "choice", options: [{ value: "sqlite", label: "SQLite" }, { value: "postgres", label: "Postgres" }] };
const stale = await exec({ epoch: 99, questions: [{ ...Q1, prompt: "x?" }] }, printCtx, "tc3");
ok(stale.threw !== null && /STALE/.test(String(stale.threw.message)), "B4: stale epoch upsert rejected with STALE");
const staleRev = await exec({ epoch: 1, questions: [{ ...Q1, rev: 7, prompt: "x?" }] }, printCtx, "tc4");
ok(staleRev.threw !== null && /STALE/.test(String(staleRev.threw.message)), "B5: stale rev upsert rejected with STALE");
const patch = await exec({ epoch: 1, questions: [{ id: "q2", rev: 1, type: "choice", options: [{ value: "node", label: "Node" }, { value: "bun", label: "Bun" }], prompt: "Runtime (updated)?" }] }, printCtx, "tc5");
ok(patch.threw === null && !/withdraw/i.test(patch.result?.content?.[0]?.text ?? ""), "B6: surgical upsert — omission does NOT withdraw");
const badAns = await exec({ epoch: 5, answers: [{ id: "q1", value: "postgres" }] }, printCtx, "tc6");
ok(badAns.threw !== null && /STALE/.test(String(badAns.threw.message)), "B7: answers[] with stale epoch rejected");
const ans = await exec({ epoch: 1, answers: [{ id: "q1", value: "postgres" }, { id: "q2", value: "node" }, { id: "q3", value: "Falcon" }] }, printCtx, "tc7");
ok(ans.threw === null, "B8: answers[] records with fresh epoch");
pi.fire("agent_settled", {}, printCtx);
await flush();
const completion = pi.sentMessages.find((m) => m.msg.customType === "interrogation-completion");
ok(!!completion, "B9: completion record injected once (AC-14)");
ok(completion && /Falcon/.test(completion.msg.content) && /Postgres/.test(completion.msg.content), "B10: completion record carries the answers");
ok(completion && completion.opts && completion.opts.triggerTurn === true && completion.opts.deliverAs === "followUp", "B11: completion triggers a model turn (followUp)");
ok(pi.sentMessages.filter((m) => m.msg.customType === "interrogation-submission").length === 0, "B12: non-TUI answers[] path ships NO submission delta (model already knows its own record)");

// ============================ C. TUI surfacing + keymap
const pi2 = new FakePi();
await factory(pi2);
const tool2 = pi2.tools.get("interrogate");
const tuiCtx = mkCtx("tui", { ui: pi2.ui });
const exec2 = async (params, ctx, toolCallId = "tc1") => {
  pi2.fire("tool_execution_start", { toolName: "interrogate", toolCallId, args: params }, ctx);
  let result, threw = null;
  try { result = await tool2.execute(toolCallId, params, undefined, undefined, ctx); } catch (e) { threw = e; }
  pi2.fire("tool_execution_end", { toolName: "interrogate", toolCallId, isError: threw !== null }, ctx);
  return { result, threw };
};
pi2.fire("session_start", { reason: "new" }, tuiCtx);
ok(pi2.customMounts.length === 0, "C1: session_start never auto-opens (SURFACE-002)");
const tqs = [
  { id: "t1", prompt: "Pick one", type: "choice",
    options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], recommendation: "a" },
  { id: "t2", prompt: "Free text?", type: "text" },
];
const upT = await exec2({ goal: "tui probe", questions: tqs }, tuiCtx, "tcA");
await flush();
ok(upT.threw === null, "C2: TUI upsert succeeds");
ok(pi2.customMounts.length === 1, "C3: upsert leaving unanswered questions opens the panel (AC-1)");
const mount = pi2.customMounts[0];
const panel = mount.fn(
  { requestRender() {}, terminal: { rows: 30, columns: 80 } },
  theme, undefined,
  (r) => { mount.resolve(r); },
);
ok(!!panel && panel.view === "short", "C4: panel mounts in short view");
ok(panel.handleInput("j") === true, "C5: j moves option cursor (fixed alias)");
ok(panel.handleInput("k") === true, "C6: k moves option cursor");
ok(panel.handleInput("l") === true, "C7: l navigates to next question");
ok(panel.handleInput("h") === true, "C8: h navigates back");
ok(panel.handleInput("d") === true && panel.view === "deep", "C9: bare d opens deep view");
ok(panel.handleInput("\u001b") === true && panel.view === "short", "C10: esc descends deep→short");
ok(panel.handleInput("o") === true && panel.view === "overview", "C11: bare o opens overview");
ok(panel.handleInput("\u001b") === true && panel.view === "deep", "C12: esc descends overview→deep (deepSticky)");
ok(panel.handleInput("\u001b") === true && panel.view === "short", "C12b: esc descends deep→short");
ok(panel.handleInput("3") === false, "C13: digit is inert at panel level (DIGIT-OUT-001)");
ok(panel.handleInput("m") === true && panel.focus === "note", "C14: bare m opens note mode");
ok(panel.handleInput("x") === true, "C15: bare key types into note editor");
ok(panel.handleInput("\r") === true && panel.focus !== "note", "C16: enter saves+exits note mode");
ok(panel.handleInput("t") === true && panel.focus === "text", "C17: bare t enters editor (elaboration)");
ok(panel.handleInput("q") === true, "C18: bare key types into the editor");
ok(panel.handleInput("\u001b") === true && panel.focus === "text", "C19: single esc forwards to editor (ESC-002)");
ok(panel.handleInput("\u001b") === true && panel.focus !== "text", "C20: double-esc closes editor only");
ok(panel.handleInput("\r") === true, "C21: enter accepts option and advances");
const t1 = panel.state.serialize().questions["t1"];
ok(t1 && t1.answer && t1.answer.value === "a", "C22: option accepted (answer recorded)");
panel.currentId = "t1";
ok(panel.cursorIndex === 0, "C23: recorded answer owns the caret (ANSWER-PIN-001)");
const atBefore = t1.answer.at;
panel.handleInput("\r");
ok(panel.state.serialize().questions["t1"].answer.at === atBefore, "C24: enter on recorded value is a state no-op");
panel.view = "short"; panel.focus = "options";
ok(panel.handleInput("\u001b") === true, "C25: esc suspends from short view");
await flush();
ok(pi2.widget && pi2.widget.key === "interrogator", "C26: suspend widget set");
const wline = pi2.widget.lines.join(" ");
ok(/open · \d+ answered — \/interrogate to resume/.test(wline) && !/ctrl/.test(wline), "C27: widget line format — command only, no key chord");
const mountsBefore = pi2.customMounts.length;
const rdT = await exec2({}, tuiCtx, "tcB");
await flush();
ok(rdT.threw === null && pi2.customMounts.length === mountsBefore, "C28: read {} never surfaces the panel (AC-15)");
const roT = await exec2({ reopen: true }, tuiCtx, "tcC");
await flush();
ok(roT.threw === null && pi2.customMounts.length === mountsBefore + 1, "C29: {reopen:true} resurfaces the panel");

console.log(failures === 0 ? "E2E PROBE: ALL PASS" : `E2E PROBE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
PROBE_EOF
ITG_ROOT="$ROOT" timeout 180 node "$PROBE_DIR/e2e.mjs" > /tmp/itg-validate-e2e.log 2>&1
rc=$?
sed 's/^/      /' /tmp/itg-validate-e2e.log
check "factory E2E journey (A+B+C)" $rc
rm -rf "$PROBE_DIR"

# ---------------------------------------------------------------- verdict
echo
echo "==================================================================="
if [ "$FAIL" -eq 0 ]; then
  echo "VALIDATION: ALL PHASES PASS ($PASS checks)"
  exit 0
else
  echo "VALIDATION: $FAIL FAILURE(S) out of $((PASS+FAIL)) checks"
  exit 1
fi

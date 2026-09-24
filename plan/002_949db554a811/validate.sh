#!/usr/bin/env bash
# validate.sh — comprehensive validation for pi-interrogator
#
# Phases (only what exists in this codebase):
#   1. Preflight          — toolchain + dependencies present
#   2. Static guards      — forbidden-residue greps (advanceArmed, retired
#                           command registrations, hardcoded shortcuts)
#   3. Type checking      — tsc --noEmit
#   4. Unit tests         — vitest run (full suite, 48 files)
#   5. Keymap guard       — scripts/verify-keymap-conflicts.sh
#   6. Docs drift         — README must not contradict shipped behavior
#   7. E2E journeys       — scripted user workflows through the REAL
#                           extension factory (fake-ctx harness; sanctioned
#                           by plan/001_.../AUTOMATION-POLICY.md — no live
#                           TUI, no waiting on humans)
#   8. Live RPC round trip— scripts/remote-rpc-itest.mjs (real pi process +
#                           model; SKIP-tolerant when no model is configured)
#
# Exit 0 only if every phase passes. Run from the repo root (or anywhere —
# the script resolves its own location).

set -u

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$ROOT"

FAILED_PHASES=()
PHASE_LOG="$(mktemp)"
trap 'rm -f "$PHASE_LOG"' EXIT

phase() { # phase <name> — banner
  printf '\n========== %s ==========\n' "$1"
}

fail() { # fail <phase> <detail>
  echo "PHASE-FAIL: $1 — $2" | tee -a "$PHASE_LOG"
}

pass() { # pass <phase> <detail>
  echo "PHASE-PASS: $1 — $2" | tee -a "$PHASE_LOG"
}

# ---------------------------------------------------------------- 1 preflight
phase "1/8 preflight"
PREFLIGHT_OK=1
command -v node >/dev/null 2>&1 || { fail preflight "node not found"; PREFLIGHT_OK=0; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail preflight "node >=22.19.0 required (engines), found $(node -v 2>/dev/null || echo none)"
  PREFLIGHT_OK=0
fi
[ -d node_modules/vitest ] || { fail preflight "node_modules missing — run npm install"; PREFLIGHT_OK=0; }
[ -f src/index.ts ] || { fail preflight "src/index.ts not found — wrong directory?"; PREFLIGHT_OK=0; }
if [ "$PREFLIGHT_OK" -eq 1 ]; then pass preflight "node $(node -v), deps present"; fi

# ------------------------------------------------------------- 2 static guards
phase "2/8 static guards"
STATIC_OK=1
# 2a. removed two-stage machinery must be fully gone
if grep -rn "advanceArmed" src/ >/dev/null 2>&1; then
  fail static "advanceArmed references remain (two-stage machinery was removed)"; STATIC_OK=0
fi
# 2b. retired top-level command registrations must not exist in non-test src
if grep -rnE 'registerCommand\("(interrogate-ping|interrogate-debug-[a-z]+)"' src/ --include='*.ts' --exclude='*.test.ts' >/dev/null 2>&1; then
  fail static "retired /interrogate-ping|/interrogate-debug-* registrations found in non-test src"; STATIC_OK=0
fi
# 2c. no global shortcut registration (breakOut chord removed)
if grep -rn "registerShortcut(" src/ --include='*.ts' >/dev/null 2>&1; then
  fail static "registerShortcut call found in src (global shortcuts are forbidden)"; STATIC_OK=0
fi
# 2d. no skipped/only tests hiding failures
if grep -rnE '\.(skip|only|todo)\(' src/*.test.ts src/panel/*.test.ts >/dev/null 2>&1; then
  fail static "skipped/only/todo tests present"; STATIC_OK=0
fi
if [ "$STATIC_OK" -eq 1 ]; then pass static "no forbidden residue (advanceArmed / old commands / shortcuts / skips)"; fi

# ------------------------------------------------------------------ 3 typecheck
phase "3/8 typecheck"
if npm run --silent typecheck >/tmp/itg-typecheck.log 2>&1; then
  pass typecheck "tsc --noEmit clean"
else
  fail typecheck "tsc --noEmit reported errors (see /tmp/itg-typecheck.log)"
fi

# ----------------------------------------------------------------- 4 unit tests
phase "4/8 unit tests (vitest run — full suite)"
if npx vitest run --reporter=basic >/tmp/itg-vitest.log 2>&1; then
  pass unittest "vitest run: all green"
else
  RC=$?
  SUMMARY="$(grep -E 'Tests  ' /tmp/itg-vitest.log | tail -1)"
  FAILFILES="$(grep -E '^ FAIL ' /tmp/itg-vitest.log | sed 's/^ *//' | sort -u | tr '\n' ';')"
  fail unittest "vitest run exited $RC — $SUMMARY — failing: ${FAILFILES:-unknown} (details /tmp/itg-vitest.log)"
fi

# ---------------------------------------------------------------- 5 keymap guard
phase "5/8 keymap conflict guard"
if bash scripts/verify-keymap-conflicts.sh >/tmp/itg-keymap.log 2>&1; then
  pass keymap "no default key collides with pi built-ins or installed extensions"
else
  fail keymap "keymap conflict (see /tmp/itg-keymap.log)"
fi

# ------------------------------------------------------------------ 6 docs drift
phase "6/8 README drift vs shipped behavior"
DOCS_OK=1
check_absent() { # check_absent <pattern> <why>
  if grep -qE "$1" README.md; then
    fail docs "README contains stale claim: $2"
    DOCS_OK=0
  fi
}
# two-stage explain flow was REMOVED (WRITEIN-001, commit-at-enter)
check_absent 'enter, `enter`|Explain then press' "two-stage explain flow (removed by WRITEIN-001)"
# session restart NEVER auto-opens the panel (SURFACE-002)
check_absent 'Auto-\(re\)open' "restart auto-open claim (SURFACE-002 removed it)"
# /interrogate is INVOKE-ONLY, never a toggle
check_absent 'toggles the panel' "toggle semantics (invoke-only since CMD-001)"
# retired top-level debug commands (collapsed into /interrogate subcommands)
check_absent '/interrogate-ping|/interrogate-debug-(upsert|submit|state)' "retired top-level debug command names"
# enter in the editor COMMITS write-in/text answers (not just save+return)
check_absent 'in the editor: save \+ return to options' "stale enter-in-editor semantics (commit-at-enter)"
if [ "$DOCS_OK" -eq 1 ]; then pass docs "no known stale claims found"; fi

# ------------------------------------------------------------------- 7 E2E run
phase "7/8 E2E journeys (scripted, real factory — AUTOMATION-POLICY compliant)"
E2E_DIR="$(mktemp -d /tmp/itg-e2e.XXXXXX)"
trap 'rm -rf "$E2E_DIR" "$PHASE_LOG"' EXIT
cat > "$E2E_DIR/e2e-driver.ts" <<'DRIVER_EOF'
/**
 * E2E driver — scripted user journeys through the REAL extension factory.
 * Fake-ctx harness per AUTOMATION-POLICY (plan/001_0d6760db6bc5): no live
 * TUI, no real interrogate tool turn, no waiting on humans.
 *
 * Journeys (README "Usage" + spec acceptance criteria, scripted form):
 *   J1 planner happy path (TUI): upsert -> panel opens -> suspend -> widget
 *      -> read never surfaces -> /interrogate resumes -> submit all ->
 *      agent_settled -> completion injected exactly once
 *   J2 session restart (SURFACE-002): state restores silently, widget is the
 *      only cue, /interrogate reopens
 *   J3 non-TUI digest fallback (AC-11): print mode digest -> answers[]
 *      recorded -> settle -> completion
 *   J4 staleness guards (AC-8): stale rev rejected, re-apply heals
 *   J5 remote bridge (pi-ask contract): started flow -> conformant submit ->
 *      same submission pipeline -> completed -> resurface; customText-only
 *      answer is a custom write-in (WRITEIN-001 parity)
 *   J6 foreign flowId submit ignored silently
 */
const ROOT = process.env.ITG_E2E_ROOT;

let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string) {
  checks++;
  if (cond) console.log(`  PASS ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}

class FakeEvents {
  handlers = new Map<string, Array<(ev: unknown) => void>>();
  on(name: string, h: (ev: unknown) => void) {
    const l = this.handlers.get(name) ?? [];
    l.push(h as never);
    this.handlers.set(name, l);
    return () => this.handlers.set(name, (this.handlers.get(name) ?? []).filter((x) => x !== h));
  }
  emit(name: string, ev: unknown) {
    for (const h of [...(this.handlers.get(name) ?? [])]) {
      try { (h as (e: unknown) => void)(ev); } catch (e) { console.log(`  [events handler error on ${name}: ${e}]`); }
    }
  }
}

class FakePi {
  commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  shortcutCalls: unknown[][] = [];
  tools = new Map<string, { execute: (id: string, params: unknown, s: unknown, u: unknown, ctx: unknown) => Promise<unknown> }>();
  eventsSubs = new Map<string, Array<(ev: unknown, ctx: unknown) => void>>();
  bus = new FakeEvents();
  widget: string[] | undefined;
  notifies: Array<{ text: string; severity: string }> = [];
  customCalls: Array<{ done: (r: null) => void }> = [];
  messages: Array<{ msg: { role?: string; customType?: string; content?: string }; opts?: unknown }> = [];
  entries: Array<{ type: string; data: unknown }> = [];

  api() {
    return {
      registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => this.commands.set(name, def),
      registerShortcut: (...a: unknown[]) => this.shortcutCalls.push(a),
      registerTool: (tool: { name: string; execute: never }) => this.tools.set(tool.name, tool as never),
      on: (event: string, handler: (ev: unknown, ctx: unknown) => void) => {
        const l = this.eventsSubs.get(event) ?? [];
        l.push(handler);
        this.eventsSubs.set(event, l);
        return undefined;
      },
      events: this.bus,
      sendMessage: (msg: never, opts?: unknown) => { this.messages.push({ msg, opts }); },
      appendEntry: (type: string, data: unknown) => { this.entries.push({ type, data }); },
      registerMessageRenderer: () => {},
      registerEntryRenderer: () => {},
    } as never;
  }
  emitCore(event: string, ev: unknown, ctx: unknown) {
    for (const h of [...(this.eventsSubs.get(event) ?? [])]) h(ev, ctx);
  }
  ctx(mode = "tui", branch: unknown[] = []) {
    return {
      mode,
      hasUI: mode === "tui",
      model: { contextWindow: 200000 },
      sessionManager: { getBranch: () => branch },
      ui: {
        custom: ((factory: (tui: unknown, theme: unknown, kb: unknown, done: (r: null) => void) => unknown) => {
          let resolve!: (r: null | undefined) => void;
          const promise = new Promise<null | undefined>((res) => { resolve = res; });
          factory({ requestRender: () => {}, setEditorText: () => {} }, {}, {}, (r) => resolve(r));
          this.customCalls.push({ done: (r) => resolve(r) });
          return promise;
        }) as never,
        setWidget: (key: string, content: string[] | undefined) => { if (key === "interrogator") this.widget = content; },
        notify: (text: string, severity: string) => this.notifies.push({ text, severity }),
      },
    } as never;
  }
  async callTool(params: unknown, ctx: unknown, id = "c" + Math.random().toString(36).slice(2, 8)) {
    this.emitCore("tool_execution_start", { toolCallId: id, toolName: "interrogate", args: params }, ctx);
    let res: { isError?: boolean; content?: Array<{ type: string; text: string }>; details?: never } | undefined;
    try {
      res = (await this.tools.get("interrogate")!.execute(id, params, undefined, undefined, ctx)) as never;
    } catch (err) {
      // Thrown tool errors are pi's isError path (guards.ts StaleError by design)
      res = { isError: true, content: [{ type: "text", text: String((err as Error)?.message ?? err) }] };
    }
    this.emitCore("tool_execution_end", { toolCallId: id, toolName: "interrogate", isError: res?.isError === true }, ctx);
    return res;
  }
  async invokeCommand(args: string, ctx: unknown) {
    await this.commands.get("interrogate")!.handler(args, ctx);
  }
  submissions() { return this.messages.filter((m) => m.msg?.customType === "interrogation-submission"); }
  completions() { return this.messages.filter((m) => m.msg?.customType === "interrogation-completion"); }
}

function toolResultEntry(state: unknown) {
  return {
    type: "message",
    id: `t${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "interrogate",
      content: [{ type: "text", text: "ok" }],
      details: { state },
    },
  };
}

const settle = () => new Promise<void>((r) => setImmediate(r));

const QUESTIONS = [
  { id: "q1", title: "Engine", prompt: "Which engine?", type: "choice", gate: true, group: "foundational",
    options: [{ value: "sqlite", label: "SQLite" }, { value: "postgres", label: "Postgres" }], recommendation: "sqlite",
    description: "Pick the storage engine for the first release. This is the foundational choice that later questions depend on." },
  { id: "q2", title: "Cloud", prompt: "Which cloud?", type: "choice", group: "runtime",
    options: [{ value: "aws", label: "AWS" }, { value: "gcp", label: "GCP" }] },
  { id: "q3", title: "Notes", prompt: "Anything else?", type: "text", group: "runtime" },
];

interface FlowEvent { version: number; flowId: string; source: string; title: string; questions: Array<{ id: string }> }

async function main() {
  const mod = await import(ROOT + "/src/index.js");
  const stateMod = await import(ROOT + "/src/state.js");

  // ---------- J1: planner happy path (TUI) ----------
  console.log("J1: upsert -> panel opens -> submit all -> settle -> completion injected once");
  {
    const pi = new FakePi();
    await (mod as { default: (api: never) => Promise<void> }).default(pi.api());
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);

    const res = await pi.callTool({ goal: "Ship v1", questions: QUESTIONS }, ctx);
    ok(res?.isError !== true, "upsert succeeds");
    ok(pi.customCalls.length === 1, "panel auto-opens on first upsert (leaves unanswered)");
    ok(pi.shortcutCalls.length === 0, "no global shortcut registered (breakOut removed)");

    pi.customCalls[0].done(null); // esc-equivalent suspend
    await settle();
    ok(Array.isArray(pi.widget) && /\/interrogate to resume/.test(pi.widget[0] ?? ""), "widget line after suspend names /interrogate");
    ok(!/ctrl|alt\+|shift\+/i.test(pi.widget[0] ?? ""), "widget line has no key chord");

    const read = await pi.callTool({}, ctx);
    ok(read?.isError !== true, "read {} succeeds");
    ok(pi.customCalls.length === 1, "read {} never opens the panel (SURFACE-001)");

    await pi.invokeCommand("", pi.ctx("tui"));
    ok(pi.customCalls.length === 2, "/interrogate resumes the suspended panel");

    // User answers everything through the debug submit surface (same pipeline)
    await pi.invokeCommand("debug submit q1=sqlite,q2=gcp,q3=ship it", pi.ctx("tui"));
    const subs = pi.submissions();
    ok(subs.length === 1, "one submission delta delivered");
    ok(/Submitted/.test(subs[0]?.msg?.content ?? "") && /q1/.test(subs[0]?.msg?.content ?? ""), "delta names the answers");
    ok(/state epoch/.test(subs[0]?.msg?.content ?? ""), "delta carries the epoch reminder");

    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    const comps = pi.completions();
    ok(comps.length === 1, "completion record injected exactly once");
    ok(/INTERROGATION COMPLETE — Ship v1/.test(comps[0]?.msg?.content ?? ""), "completion names the goal");
    ok(/SQLite|sqlite/i.test(comps[0]?.msg?.content ?? ""), "completion includes answers");
  }

  // ---------- J2: restart never auto-opens (SURFACE-002) ----------
  console.log("J2: session restart restores state silently; /interrogate reopens");
  {
    const pi1 = new FakePi();
    await (mod as { default: (api: never) => Promise<void> }).default(pi1.api());
    const ctx1 = pi1.ctx("tui");
    pi1.emitCore("session_start", { reason: "startup" }, ctx1);
    await pi1.callTool({ goal: "G", questions: [QUESTIONS[0]] }, ctx1);
    const state1 = (stateMod as { getState: () => { serialize: () => { questions: Record<string, unknown>; epoch: number } } }).getState();
    const branch = [toolResultEntry(state1.serialize())];

    const pi2 = new FakePi(); // fresh host = /reload
    await (mod as { default: (api: never) => Promise<void> }).default(pi2.api());
    pi2.widget = ["stale pre-reload widget"];
    pi2.emitCore("session_start", { reason: "reload" }, pi2.ctx("tui", branch));
    ok(pi2.customCalls.length === 0, "restart NEVER opens the panel (SURFACE-002)");
    ok(Array.isArray(pi2.widget) && /\/interrogate/.test(pi2.widget[0] ?? ""), "restart sets the suspend widget cue");
    const s2 = (stateMod as typeof stateMod).getState();
    ok(s2 !== undefined && Object.keys((s2 as unknown as { serialize: () => { questions: Record<string, unknown> } }).serialize().questions ?? {}).length > 0, "state reconstructed from branch");

    await pi2.invokeCommand("", pi2.ctx("tui", branch));
    ok(pi2.customCalls.length === 1, "/interrogate after restart opens the panel");
  }

  // ---------- J3: non-TUI digest fallback (AC-11) ----------
  console.log("J3: print mode — digest upsert, chat answers recorded, completion injected");
  {
    const pi = new FakePi();
    await (mod as { default: (api: never) => Promise<void> }).default(pi.api());
    const ctxP = pi.ctx("print");
    pi.emitCore("session_start", { reason: "startup" }, ctxP);
    const res = await pi.callTool({ goal: "headless", questions: QUESTIONS }, ctxP, "up1");
    ok(res?.isError !== true, "non-TUI upsert succeeds");
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
    ok(/\d+\./.test(text), "result contains numbered markdown digest");
    ok(pi.customCalls.length === 0, "no panel in print mode");
    ok(/sqlite/i.test(text) && /Which engine\?/.test(text), "digest shows options and prompts");

    const epoch = ((res as { details?: { state?: { epoch: number }; epoch?: number } })?.details?.state?.epoch)
      ?? (res as { details?: { epoch?: number } })?.details?.epoch;
    const rec = await pi.callTool({ answers: [
      { id: "q1", value: "sqlite" }, { id: "q2", value: "gcp" }, { id: "q3", value: "from chat" },
    ], epoch }, ctxP, "up2");
    ok(rec?.isError !== true, "answers[] recorded");
    pi.emitCore("agent_settled", {}, ctxP);
    await settle();
    ok(pi.completions().length === 1, "completion injected after record + settle");
  }

  // ---------- J4: staleness guards self-heal (AC-8) ----------
  console.log("J4: stale rev rejected with current state; re-apply succeeds");
  {
    const pi = new FakePi();
    await (mod as { default: (api: never) => Promise<void> }).default(pi.api());
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "guards", questions: [QUESTIONS[0]] }, ctx, "g1");
    const st = (stateMod as typeof stateMod).getState();
    const epoch = (st as unknown as { serialize: () => { epoch: number } }).serialize().epoch;

    const stale = await pi.callTool({ epoch, questions: [{ ...QUESTIONS[0], rev: 99 }] }, ctx, "g2");
    ok(stale?.isError === true, "stale rev rejected");
    const staleText = (stale?.content ?? []).map((c) => c.text ?? "").join(" ");
    ok(/STALE/i.test(staleText), "rejection says STALE with current rev");

    const fresh = await pi.callTool({ epoch, questions: [{ ...QUESTIONS[0], rev: 1, description: "expanded description for the deep view contract, deliberately longer than the floor so no lint warning fires here." }] }, ctx, "g3");
    ok(fresh?.isError !== true, "re-apply with current rev succeeds");
  }

  // ---------- J5: remote bridge (pi-ask contract) ----------
  console.log("J5: bridge flow started -> submit -> same pipeline -> completed");
  {
    const pi = new FakePi();
    await (mod as { default: (api: never) => Promise<void> }).default(pi.api());
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);

    const seen: { started: FlowEvent[]; results: Array<{ ok?: boolean }>; completed: Array<{ flowId: string }> } = { started: [], results: [], completed: [] };
    pi.bus.on("@eko24ive/pi-ask:started", (e) => seen.started.push(e as FlowEvent));
    pi.bus.on("@eko24ive/pi-ask:submit-result", (e) => seen.results.push(e as { ok?: boolean }));
    pi.bus.on("@eko24ive/pi-ask:completed", (e) => seen.completed.push(e as { flowId: string }));

    await pi.callTool({ goal: "bridge", questions: QUESTIONS }, ctx, "b1");
    ok(seen.started.length === 1, "started flow emitted once on upsert");
    ok(seen.started[0]?.questions?.length === 3, "flow carries all live questions");
    ok(String(seen.started[0]?.flowId ?? "").startsWith("itg:"), "flowId namespaced itg:");

    pi.bus.emit("@eko24ive/pi-ask:submit", {
      version: 1,
      requestId: "req-1",
      flowId: seen.started[0].flowId,
      response: { kind: "answer", mode: "submit", answers: {
        q1: { values: ["postgres"] },
        q3: { customText: "write-in from the phone" },
      } },
    });
    await settle(); await settle();
    ok(seen.results.some((r) => r.ok === true), "submit-result ok:true");
    ok(pi.submissions().length === 1, "bridge submit delivered ONE submission delta");
    ok(/Postgres|postgres/i.test(pi.submissions()[0]?.msg?.content ?? ""), "delta carries the bridged answer");
    ok(seen.completed.some((c) => c.flowId === seen.started[0].flowId), "flow completed after submit");
    ok(seen.started.length === 2 && seen.started[1]?.source === "ask:replay", "resurface flow re-emitted for remaining questions");
    const q3 = ((stateMod as typeof stateMod).getState() as unknown as { serialize: () => { questions: Record<string, { answer?: { custom?: boolean; value?: string } }> } }).serialize().questions.q3;
    ok(q3?.answer?.custom === true && /phone/.test(q3.answer?.value ?? ""), "customText-only answer is a write-in (custom:true)");
  }

  // ---------- J6: foreign/stale bridge submits are inert ----------
  console.log("J6: foreign flowId submit ignored silently");
  {
    const pi = new FakePi();
    await (mod as { default: (api: never) => Promise<void> }).default(pi.api());
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "foreign", questions: [QUESTIONS[0]] }, ctx, "f1");
    const before = pi.submissions().length;
    pi.bus.emit("@eko24ive/pi-ask:submit", {
      version: 1, requestId: "req-x", flowId: "someone-elses-flow",
      response: { kind: "answer", mode: "submit", answers: { q1: { values: ["hacked"] } } },
    });
    await settle();
    ok(pi.submissions().length === before, "foreign flowId submit produced no submission");
    const q1 = ((stateMod as typeof stateMod).getState() as unknown as { serialize: () => { questions: Record<string, { answer?: unknown }> } }).serialize().questions.q1;
    ok(q1?.answer === undefined, "foreign submit changed no state");
  }

  console.log(`\nE2E: ${checks - failures}/${checks} checks passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("DRIVER CRASH:", e); process.exit(2); });
DRIVER_EOF

E2E_STATUS=0
ITG_E2E_ROOT="$ROOT" npx vite-node "$E2E_DIR/e2e-driver.ts" > /tmp/itg-e2e.log 2>&1 || E2E_STATUS=$?
cat /tmp/itg-e2e.log
if [ "$E2E_STATUS" -eq 0 ]; then
  pass e2e "all scripted journeys green"
else
  fail e2e "driver exited $E2E_STATUS (details /tmp/itg-e2e.log)"
fi

# ------------------------------------------------------------- 8 live RPC itest
phase "8/8 live RPC round trip (model-backed; SKIP-tolerant)"
RPC_OUT="$(mktemp)"
if node scripts/remote-rpc-itest.mjs > "$RPC_OUT" 2>&1; then
  if grep -q "SKIP" "$RPC_OUT"; then
    pass rpc "skipped (no model configured) — CI-safe by design"
  else
    pass rpc "live round trip: interrogate -> bridge flow -> submit -> submission -> completion"
  fi
else
  fail rpc "remote-rpc-itest FAILED (output follows)"
  cat "$RPC_OUT"
fi
rm -f "$RPC_OUT"

# -------------------------------------------------------------------- summary
phase "SUMMARY"
if [ -s "$PHASE_LOG" ] && grep -q "PHASE-FAIL" "$PHASE_LOG"; then
  echo "FAILED phases:"
  grep "PHASE-FAIL" "$PHASE_LOG" | sed 's/^/  - /'
  echo
  echo "OVERALL: FAIL"
  exit 1
fi
grep "PHASE-PASS" "$PHASE_LOG" | sed 's/^/  - /'
echo
echo "OVERALL: PASS"
exit 0

#!/usr/bin/env bash
# validate.sh — comprehensive validation for pi-interrogator (2026-10-05 state)
#
# Validates the CURRENT spec contract: ANSWER-PIN-001/FR-35 (plan/003 delta,
# shipped through commit 67eecd7), the remote-bridge removal (2026-10-02),
# write-ins/auto-submit/surfacing gates (plan/002 deltas), and the original
# M1–M7 feature set (plan/001).
#
# Phases (only what exists in this codebase — no eslint/prettier config):
#   1. Preflight       — toolchain + dependencies present
#   2. Static guards   — forbidden-residue greps (removed surfaces, stale
#                        contract claims, skipped tests, schema pin string)
#   3. Type checking   — tsc --noEmit
#   4. Unit tests      — vitest run (full suite)
#   5. Keymap guard    — scripts/verify-keymap-conflicts.sh
#   6. Docs drift      — README must not contradict shipped behavior; must
#                        document the current contract
#   7. E2E journeys    — scripted user workflows through the REAL extension
#                        factory (fake-ctx harness; sanctioned by
#                        plan/001_0d6760db6bc5/AUTOMATION-POLICY.md — no
#                        live TUI, no real interrogate turn, no waiting on
#                        humans)
#
# Exit 0 only if every phase passes. Run from anywhere — the script resolves
# its own location.

set -u

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$ROOT"

FAILED_PHASES=()
PHASE_LOG="$(mktemp)"
E2E_DIR=""
trap 'rm -rf "$PHASE_LOG" "${E2E_DIR:-/nonexistent}"' EXIT

phase() { printf '\n========== %s ==========\n' "$1"; }
fail()  { echo "PHASE-FAIL: $1 — $2" | tee -a "$PHASE_LOG"; }
pass()  { echo "PHASE-PASS: $1 — $2" | tee -a "$PHASE_LOG"; }

# ---------------------------------------------------------------- 1 preflight
phase "1/7 preflight"
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
phase "2/7 static guards"
STATIC_OK=1
# 2a. two-stage arming machinery fully removed (WRITEIN-001)
if grep -rn "advanceArmed" src/ >/dev/null 2>&1; then
  fail static "advanceArmed references remain (two-stage machinery removed)"; STATIC_OK=0
fi
# 2b. no global shortcut registration (ctrl+shift+q chord removed)
if grep -rn "registerShortcut(" src/ --include='*.ts' | grep -v "NO registerShortcut" | grep -qv "test" 2>/dev/null; then
  if grep -rn "registerShortcut(" src/ --include='*.ts' | grep -v "\.test\.ts" | grep -v "NO registerShortcut" >/dev/null 2>&1; then
    fail static "registerShortcut call found in non-test src (global shortcuts forbidden)"; STATIC_OK=0
  fi
fi
# 2c. retired top-level command registrations absent from non-test src
if grep -rnE 'registerCommand\("(interrogate-ping|interrogate-debug-[a-z]+)"' src/ --include='*.ts' --exclude='*.test.ts' >/dev/null 2>&1; then
  fail static "retired /interrogate-ping|/interrogate-debug-* registrations in non-test src"; STATIC_OK=0
fi
# 2d. no skipped/only/todo tests hiding failures
if grep -rnE '\.(skip|only|todo)\(' src/*.test.ts src/panel/*.test.ts >/dev/null 2>&1; then
  fail static "skipped/only/todo tests present"; STATIC_OK=0
fi
# 2e. remote-bridge surface fully removed (2026-10-02): no bridge modules,
#     no pi-ask subscriptions outside the phantom regression guard
if [ -f src/remote-bridge.ts ] || [ -f src/remote-submit.ts ] || [ -f scripts/remote-rpc-itest.mjs ]; then
  fail static "removed remote-bridge artifacts still present (remote-bridge.ts/remote-submit.ts/remote-rpc-itest.mjs)"; STATIC_OK=0
fi
if grep -rln "@eko24ive\|pi-ask" src/ --include='*.ts' | grep -v "regression-phantom-submissions.test.ts" | grep -q .; then
  fail static "pi-ask/bridge references outside the phantom regression guard"; STATIC_OK=0
fi
# 2f. ANSWER-PIN-001 stale claims purged (plan/003 T4.S8 sweep)
if grep -rniE "answers? never pin|status-agnostic preselect|still preselects the recommendation" src/ --include='*.ts' >/dev/null 2>&1; then
  fail static "stale status-agnostic-preselect comment remains (ANSWER-PIN-001 purge incomplete)"; STATIC_OK=0
fi
# 2g. tool-schema pinning string is spec-verbatim (plan/003 T1.S3)
if ! grep -q 'marked ★; preselected only while unanswered — a recorded answer always owns the cursor' src/tool-schema.ts; then
  fail static "tool-schema recommendation description is not the spec-verbatim pinning string"; STATIC_OK=0
fi
if [ "$STATIC_OK" -eq 1 ]; then pass static "no forbidden residue (two-stage / shortcuts / old commands / skips / bridge / stale preselect claims; schema string verbatim)"; fi

# ------------------------------------------------------------------ 3 typecheck
phase "3/7 typecheck"
if npm run --silent typecheck >/tmp/itg-typecheck.log 2>&1; then
  pass typecheck "tsc --noEmit clean"
else
  fail typecheck "tsc --noEmit reported errors (see /tmp/itg-typecheck.log)"
fi

# ----------------------------------------------------------------- 4 unit tests
phase "4/7 unit tests (vitest run — full suite)"
if npx vitest run --reporter=basic >/tmp/itg-vitest.log 2>&1; then
  SUMMARY="$(grep -E 'Tests  ' /tmp/itg-vitest.log | tail -1 | tr -s ' ')"
  pass unittest "vitest run all green — ${SUMMARY:-ok}"
else
  RC=$?
  SUMMARY="$(grep -E 'Tests  ' /tmp/itg-vitest.log | tail -1 | tr -s ' ')"
  FAILFILES="$(grep -E '^ FAIL ' /tmp/itg-vitest.log | sed 's/^ *//' | sort -u | tr '\n' ';')"
  fail unittest "vitest run exited $RC — ${SUMMARY:-unknown} — failing: ${FAILFILES:-unknown} (details /tmp/itg-vitest.log)"
fi

# ---------------------------------------------------------------- 5 keymap guard
phase "5/7 keymap conflict guard"
if bash scripts/verify-keymap-conflicts.sh >/tmp/itg-keymap.log 2>&1; then
  pass keymap "no default key collides with pi built-ins or installed extensions"
else
  fail keymap "keymap conflict (see /tmp/itg-keymap.log)"
fi

# ------------------------------------------------------------------ 6 docs drift
phase "6/7 README drift vs shipped behavior"
DOCS_OK=1
check_absent() {
  if grep -qE "$1" README.md; then fail docs "README contains stale claim: $2"; DOCS_OK=0; fi
}
check_present() {
  if ! grep -qE "$1" README.md; then fail docs "README is missing required claim: $2"; DOCS_OK=0; fi
}
# removed behaviors must not be documented
check_absent 'enter, `enter`|Explain then press' "two-stage explain flow (removed by WRITEIN-001)"
check_absent 'Auto-\(re\)open' "restart auto-open claim (SURFACE-002 removed it)"
check_absent 'toggles the panel' "toggle semantics (invoke-only since CMD-001)"
check_absent '/interrogate-ping|/interrogate-debug-(upsert|submit|state)' "retired top-level debug command names"
check_absent 'in the editor: save \+ return to options' "stale enter-in-editor semantics (commit-at-enter)"
# remote bridge must not be documented (removed 2026-10-02)
check_absent 'remote-bridge|pi-ask|phoneSeen' "removed remote-bridge surface in README"
# current contract must be documented (plan/003 changeset: T6.S11)
check_present '16\. \*\*Answer pinning' "AC-16 in the acceptance-criteria list"
check_present 'Revisits are answer-first' "revisit usage sentence (ANSWER-PIN-001)"
check_present 'recorded answer always owns the cursor|caret and highlight sit on that recorded answer' "answer-pinning usage contract"
check_present '✎ Other — write your own' "write-in row documentation (WRITEIN-001)"
check_present 'foundational unanswered' "gate-hold documentation (AUTOSUBMIT-002)"
check_present 'submitted — \{n\} answer\(s\)|submitted — .* answer' "auto-submit flash documentation (AUTOSUBMIT-001)"
if [ "$DOCS_OK" -eq 1 ]; then pass docs "README matches shipped behavior (no stale claims; current contract documented)"; fi

# ------------------------------------------------------------------- 7 E2E run
phase "7/7 E2E journeys (scripted, real factory — AUTOMATION-POLICY compliant)"
E2E_DIR="$(mktemp -d /tmp/itg-e2e.XXXXXX)"
cat > "$E2E_DIR/e2e-driver.ts" <<'DRIVER_EOF'
/**
 * E2E driver — scripted user journeys through the REAL extension factory
 * (src/index.ts). Fake-ctx harness per AUTOMATION-POLICY (plan/001):
 * no live TUI, no real interrogate tool turn, no waiting on humans.
 *
 * Journeys (README "Usage" + spec acceptance criteria, scripted form):
 *   J1 planner happy path (TUI): upsert -> panel opens -> suspend -> widget
 *      -> read never surfaces -> /interrogate resumes -> submit all ->
 *      agent_settled -> completion injected exactly once
 *   J2 answer pinning (AC-16 / FR-35): non-recommended answer owns the
 *      caret on revisit; enter/digit on the recorded value is an inert
 *      no-op; byte-identical write-in re-commit inert; DIFFERENT choice
 *      raises the FR-18 confirm; FR-17 instant moot + un-moot
 *   J3 auto-submit (AC-2c/2d): last-answer transition ships with no
 *      submit keypress; gate hold shows the hold line and withholds
 *   J4 elaboration duty (AC-2b): ctrl+t draft attaches as answer.text
 *   J5 restart (SURFACE-002): reconstruction installs state silently,
 *      widget is the only cue, /interrogate reopens; {reopen:true} must
 *      also reopen (FR-6 — no deterministic guard, judgment trusted)
 *   J6 tree navigation: session_tree never surfaces; the suspend reminder
 *      line reflects the destination branch for a suspended panel
 *      (spec §Branching); teardown on interrogation-free branch
 *   J7 non-TUI digest (AC-11): print mode digest; answers[] recorded;
 *      completion injected on settle
 *   J8 staleness guards (AC-8): wrong rev rejected with current state;
 *      re-apply heals; wrong epoch rejected
 *   J9 SURFACE-001 matrix + phantom: reads never surface in any state;
 *      description-only edit surfaces nothing; re-ask reopens; reopen:true
 *      works; forged pi-ask submit mutates nothing; /interrogate on dead
 *      state notifies
 */
const ROOT = process.env.ITG_E2E_ROOT!;

let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string) {
  checks++;
  if (cond) console.log(`  PASS ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}
const settle = () => new Promise<void>((r) => setImmediate(r));

// ---------------------------------------------------------------- fake host

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

interface CustomCall {
  component: {
    handleInput(data: string): boolean;
    cursorIndex: number;
    currentId: string;
    confirmMode: unknown;
    gateWarning: { count: number; kind: string } | null;
    footerFlash: { text: string } | undefined;
    textDuty: string;
    focus: string;
    textField: { getText(): string; setText(t: string): void };
    draftTextFor(id: string): string | undefined;
    isResolved(): boolean;
    dispose(): void;
  };
  done: (r: null) => void;
  resolved: boolean;
}

function fakeEditor() {
  let text = "";
  return {
    getText: () => text,
    setText: (t: string) => { text = t; },
    handleInput: () => true,
    render: () => ["e1", "e2", "e3"],
    focused: false,
    focus: () => { },
    blur: () => { },
    invalidate: () => { },
    dispose: () => { },
  };
}

const ALL_CUSTOM_CALLS: CustomCall[] = [];

class FakePi {
  commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  shortcutCalls: unknown[][] = [];
  tools = new Map<string, { name: string; execute: (id: string, params: unknown, s: unknown, u: unknown, ctx: unknown) => Promise<unknown> }>();
  eventsSubs = new Map<string, Array<(ev: unknown, ctx: unknown) => void>>();
  bus = new FakeEvents();
  widget: string[] | undefined;
  notifies: Array<{ text: string; severity: string }> = [];
  customCalls: CustomCall[] = [];
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
      appendEntry: (type: string, data: unknown) => this.entries.push({ type, data }),
      registerMessageRenderer: () => { },
      registerEntryRenderer: () => { },
    } as never;
  }
  emitCore(event: string, ev: unknown, ctx: unknown) {
    for (const h of [...(this.eventsSubs.get(event) ?? [])]) h(ev, ctx);
  }
  ctx(mode = "tui", branch: unknown[] = []) {
    const self = this;
    return {
      mode,
      hasUI: mode === "tui",
      model: { contextWindow: 200000 },
      sessionManager: { getBranch: () => branch },
      isIdle: () => true,
      sendMessage: (msg: never, opts?: unknown) => self.messages.push({ msg, opts }),
      ui: {
        custom: ((factory: (tui: unknown, theme: unknown, kb: unknown, done: (r: null) => void) => unknown) => {
          let resolve!: (r: null | undefined) => void;
          const promise = new Promise<null | undefined>((res) => { resolve = res; });
          const component = factory(
            { requestRender: () => { }, setEditorText: () => { } },
            { fg: (_n: string, s: string) => s, bold: (s: string) => s },
            {},
            (r) => resolve(r),
          ) as CustomCall["component"];
          const call: CustomCall = { component, done: (r) => resolve(r), resolved: false };
          void promise.then(() => { call.resolved = true; });
          self.customCalls.push(call);
          ALL_CUSTOM_CALLS.push(call);
          return promise;
        }) as never,
        setWidget: (key: string, content: string[] | undefined) => { if (key === "interrogator") self.widget = content; },
        notify: (text: string, severity: string) => self.notifies.push({ text, severity }),
        getEditorComponent: () => () => fakeEditor(),
      },
    } as never;
  }
  async callTool(params: unknown, ctx: unknown, id = "c" + Math.random().toString(36).slice(2, 8)) {
    this.emitCore("tool_execution_start", { toolCallId: id, toolName: "interrogate", args: params }, ctx);
    let res: { isError?: boolean; content?: Array<{ type: string; text: string }>; details?: never } | undefined;
    try {
      res = (await this.tools.get("interrogate")!.execute(id, params, undefined, undefined, ctx)) as never;
    } catch (err) {
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

/**
 * Hand-built serialized branch state (NO factory seeding — avoids leaking
 * the module-global panel-host record that a seed factory's upsert would
 * re-arm, which would silently change which scenario later steps test).
 */
function branchState(goal: string, ids: string[]): unknown {
  return {
    goal,
    epoch: 1,
    completed: false,
    order: ids,
    questions: Object.fromEntries(
      ids.map((id) => [id, { id, prompt: `Q ${id}?`, type: "choice", options: [{ value: "a", label: "A" }], rev: 1, status: "open" }]),
    ),
    snapshots: [],
  };
}

// key bytes (fixed panel keys + defaults from src/config.ts)
const UP = "\u001b[A", DOWN = "\u001b[B", RIGHT = "\u001b[C", LEFT = "\u001b[D";
const ENTER = "\r", ESC = "\u001b", CTRL_S = "\u0013", CTRL_T = "\u0014";

const QUESTIONS = [
  { id: "q1", title: "Engine", prompt: "Which engine?", type: "choice", gate: true, group: "foundational",
    options: [{ value: "sqlite", label: "SQLite", ramification: "Standalone consequence text long enough to clear the lint floor and explain the trade-off in full for a reader who has not seen the conversation." }, { value: "postgres", label: "Postgres", ramification: "Standalone consequence text long enough to clear the lint floor and explain the trade-off in full for a reader who has not seen the conversation." }],
    recommendation: "sqlite",
    description: "Pick the storage engine for the first release. This is the foundational choice that later questions depend on, so decide it before the rest." },
  { id: "q2", title: "Cloud", prompt: "Which cloud?", type: "choice", group: "runtime",
    options: [{ value: "aws", label: "AWS", ramification: "Standalone consequence text long enough to clear the lint floor and explain the trade-off in full for a reader who has not seen the conversation." }, { value: "gcp", label: "GCP", ramification: "Standalone consequence text long enough to clear the lint floor and explain the trade-off in full for a reader who has not seen the conversation." }] },
  { id: "q3", title: "Notes", prompt: "Anything else?", type: "text", group: "runtime" },
];

async function main() {
  const mod = (await import(ROOT + "/src/index.js")) as { default: (api: never) => Promise<void> };
  const stateMod = (await import(ROOT + "/src/state.js")) as {
    getState: () => undefined | {
      serialize: () => { questions: Record<string, { status?: string; answer?: { value?: string; custom?: boolean; at?: string; text?: string } }>; epoch: number };
      orderedQuestions: () => Array<{ id: string; status: string; answer?: { value?: string; custom?: boolean; at?: string } }>;
      applyAnswer: (id: string, a: { value: string; at: string }) => void;
    };
    resetState: () => void;
  };

  async function freshPi(mode = "tui"): Promise<FakePi> {
    const pi = new FakePi();
    await mod.default(pi.api() as never);
    return pi;
  }
  async function cleanup() {
    for (const c of ALL_CUSTOM_CALLS) {
      if (!c.resolved) { try { c.done(null); } catch { /* already gone */ } }
    }
    await settle(); await settle();
    stateMod.resetState();
  }

  // ------------------------------------------------ J1: planner happy path
  console.log("J1: upsert -> panel -> suspend -> widget -> read silent -> resume -> submit -> settle -> completion once");
  {
    await cleanup();
    const pi = await freshPi();
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

  // ------------------------------------------- J2: answer pinning (AC-16)
  console.log("J2: answer pinning — recorded answer owns the caret; no-op re-commits; different choice confirms");
  {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    const qs = [
      { id: "p1", title: "Engine", prompt: "Engine?", type: "choice", gate: true, group: "g",
        options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], recommendation: "a" },
      { id: "p2", title: "Deploy", prompt: "Deploy?", type: "choice", group: "g",
        options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }], dependsOn: [{ id: "p1", equals: "b" }] },
      { id: "p3", title: "Extra", prompt: "Extra?", type: "choice", group: "g",
        options: [{ value: "m", label: "M" }, { value: "n", label: "N" }] },
    ];
    await pi.callTool({ goal: "pin", questions: qs }, ctx);
    ok(pi.customCalls.length === 1, "panel opened");
    let st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p2")?.status === "moot", "FR-17: dependent arrives moot at upsert (dependsOn unmet)");

    const panel = pi.customCalls[0].component;
    ok(panel.currentId === "p1", "gate question focused first");
    ok(panel.cursorIndex === 0, "unanswered: caret on ★ preselect row 0");

    // answer p1 with NON-recommended b (display row 1)
    panel.handleInput(DOWN);
    panel.handleInput(ENTER);
    st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p1")?.answer?.value === "b", "p1 answered with non-recommended b");
    ok(st.orderedQuestions().find((q) => q.id === "p2")?.status === "open", "FR-17: dependent un-moots instantly when condition met");
    ok(panel.currentId === "p2", "advance moved to next unanswered");

    // answer p2 with x, leave p3 open (no auto-submit: p3 open)
    panel.handleInput(ENTER);
    st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p2")?.answer?.value === "x", "p2 answered x");
    ok(pi.submissions().length === 0, "no auto-submit while p3 open");

    // revisit p1 -> caret pins to recorded b (row 1), NOT ★ row 0
    panel.handleInput(LEFT); panel.handleInput(LEFT);
    ok(panel.currentId === "p1", "navigated back to answered p1");
    ok(panel.cursorIndex === 1, "ANSWER-PIN-001: caret on recorded answer (row 1), not the ★ row");

    const atBefore = st.orderedQuestions().find((q) => q.id === "p1")?.answer?.at;
    const epochBefore = st.serialize().epoch;
    // enter on the recorded value: inert no-op + advance
    panel.handleInput(ENTER);
    st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p1")?.answer?.at === atBefore, "enter on recorded value: answer.at NOT rewritten");
    ok(st.serialize().epoch === epochBefore, "no epoch bump from no-op enter");
    ok(panel.confirmMode === null || panel.confirmMode === undefined, "no FR-18 modal on same-value enter");
    ok(panel.currentId === "p3", "no-op enter advanced to next unanswered");

    // digit on the recorded value: also inert (move back first)
    panel.handleInput(LEFT); panel.handleInput(LEFT);
    ok(panel.currentId === "p1", "back on p1 for digit test");
    ok(panel.cursorIndex === 1, "caret re-pinned on revisit");
    const consumed = panel.handleInput("2"); // display row 1 = recorded b
    ok(consumed === true, "digit on recorded value consumed");
    st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p1")?.answer?.at === atBefore, "digit on recorded value: answer.at NOT rewritten");
    ok(pi.submissions().length === 0, "no submission from no-op digit");

    // DIFFERENT choice on answered p1 (row 0 = a) with p2 answered via dependsOn -> FR-18 confirm
    panel.handleInput(LEFT); panel.handleInput(LEFT); // back to p1 (advanced to p3 by digit no-op)
    panel.handleInput(UP); // row 0 = a (different value)
    panel.handleInput(ENTER);
    ok(panel.confirmMode !== null && panel.confirmMode !== undefined, "different choice raises FR-18 invalidation confirm");
    panel.handleInput(ESC); // cancel
    st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p1")?.answer?.value === "b", "esc cancels the edit — original answer kept");
    ok(st.serialize().epoch === epochBefore, "epoch unchanged through cancelled edit");

    // write-in on p2: navigate to p2, cursor to Other row, enter, type, enter
    panel.handleInput(RIGHT); // p2
    ok(panel.currentId === "p2", "on p2 for write-in");
    panel.handleInput(DOWN); panel.handleInput(DOWN); // options.length = 2 -> Other row
    ok(panel.cursorIndex === 2, "cursor on the synthetic Other row");
    panel.handleInput(ENTER); // opens editor in write-in duty
    ok(panel.focus === "text" && panel.textDuty === "writein", "Other accept opens write-in duty editor");
    panel.textField.setText("hand written");
    panel.handleInput(ENTER); // commit
    st = stateMod.getState()!;
    const p2a = st.orderedQuestions().find((q) => q.id === "p2")?.answer;
    ok(p2a?.value === "hand written" && p2a?.custom === true, "write-in commits as answer.value with custom:true");
    ok(panel.currentId === "p3", "write-in commit advanced");

    // revisit p2 -> caret pins to the Other row
    panel.handleInput(LEFT);
    ok(panel.currentId === "p2" && panel.cursorIndex === 2, "write-in answer pins caret to the ✎ Other row");

    // byte-identical write-in re-commit is inert
    const at2 = st.orderedQuestions().find((q) => q.id === "p2")?.answer?.at;
    panel.handleInput(ENTER); // Other row -> write-in duty
    panel.textField.setText("hand written");
    panel.handleInput(ENTER);
    st = stateMod.getState()!;
    ok(st.orderedQuestions().find((q) => q.id === "p2")?.answer?.at === at2, "byte-identical write-in re-commit: answer.at unchanged");
    ok(st.serialize().epoch === epochBefore, "no epoch bump from inert write-in re-commit");
    ok(pi.submissions().length === 0, "no submission from inert re-commit");

    // manual ctrl+s ships everything; delta renders the write-in as ✎
    panel.handleInput(CTRL_S);
    await settle(); // done(null) resolution is async — flush before asserting
    const subs = pi.submissions();
    ok(subs.length === 1, "ctrl+s ships the pending set");
    ok(/✎/.test(subs[0]?.msg?.content ?? "") && /hand written/.test(subs[0]?.msg?.content ?? ""), "delta renders the write-in as ✎ {text}");
    ok(pi.customCalls[0].resolved, "post-submit exit: panel auto-suspended after delivery (FR-3d)");
  }

  // --------------------------------- J3: auto-submit transition + gate hold
  console.log("J3: auto-submit — last-answer transition ships; gate hold withholds + warns");
  {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "auto", questions: [
      { id: "a1", prompt: "One?", type: "choice", options: [{ value: "v1", label: "V1" }, { value: "v2", label: "V2" }] },
      { id: "a2", prompt: "Two?", type: "choice", options: [{ value: "w1", label: "W1" }, { value: "w2", label: "W2" }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;
    panel.handleInput(ENTER); // a1 = v1 (row 0)
    ok(pi.submissions().length === 0, "no auto-submit while a2 open");
    panel.handleInput(ENTER); // a2 = w1 — LAST unanswered -> transition
    ok(pi.submissions().length === 1, "AC-2c: last-answer transition auto-submits with no submit keypress");
    ok(panel.footerFlash?.text === "submitted — 2 answer(s)", "footer flashes submitted — 2 answer(s)"); // sync — the suspend landing disposes the panel (and its flash) on the next microtask
    ok(stateMod.getState()?.serialize().epoch === 2, "epoch bumped exactly once per firing");
    await settle(); // post-submit suspend resolves async
    ok(pi.customCalls[0].resolved, "panel auto-suspends after auto-submit (FR-3d)");
  }
  {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "gate", questions: [
      { id: "g1", prompt: "Foundation?", type: "choice", gate: true, group: "core", options: [{ value: "f1", label: "F1" }, { value: "f2", label: "F2" }] },
      { id: "g2", prompt: "Later?", type: "choice", group: "later", options: [{ value: "l1", label: "L1" }, { value: "l2", label: "L2" }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;
    ok(panel.currentId === "g1", "gate group focused first");
    panel.handleInput(RIGHT); // to g2 (fixed key, full list)
    ok(panel.currentId === "g2", "navigated to later group question (soft gate — answerable)");
    panel.handleInput(ENTER); // answer g2 while gate g1 unanswered
    ok(pi.submissions().length === 0, "AC-2d: gate hold — no auto-submit while gate unanswered");
    ok(panel.gateWarning?.kind === "hold" && panel.gateWarning?.count === 1, "hold line armed: 1 foundational unanswered");
    panel.handleInput(LEFT); // back to g1 (any key dismisses hold + acts)
    panel.handleInput(ENTER); // answer the gate — transition
    ok(pi.submissions().length === 1, "answering the gate releases auto-submit on the transition");
    ok(stateMod.getState()?.serialize().epoch === 2, "epoch bumped once");
  }

  // ------------------------------------------ J4: elaboration duty (AC-2b)
  console.log("J4: elaboration — ctrl+t draft attaches to the accepted option as answer.text");
  {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "explain", questions: [
      { id: "e1", prompt: "Pick?", type: "choice", options: [{ value: "o1", label: "O1" }, { value: "o2", label: "O2" }], recommendation: "o1" },
    ] }, ctx);
    const panel = pi.customCalls[0].component;
    panel.handleInput(CTRL_T); // elaboration duty (cursor on real option)
    ok(panel.focus === "text" && panel.textDuty === "elaboration", "ctrl+t opens the editor in elaboration duty");
    panel.textField.setText("because cost");
    panel.handleInput(ENTER); // save + blur — NOT an answer
    let st = stateMod.getState()!;
    ok(st.orderedQuestions()[0].answer === undefined, "elaboration alone never answers the question");
    ok(panel.draftTextFor("e1") === "because cost", "draft saved through the R4 seam");
    ok(panel.focus === "options", "elaboration enter blurs back to options");
    panel.handleInput(ENTER); // accept o1 -> transition auto-submit ships with elaboration attached
    st = stateMod.getState()!;
    const a = st.orderedQuestions()[0].answer;
    ok(a?.value === "o1", "accepted option is the answer");
    ok(a?.text === "because cost", "AC-2b: elaboration attached as answer.text at submit");
    ok(pi.submissions().length === 1, "auto-submit fired on the transition (single question)");
  }

  // -------------------------------------------- J5: restart never surfaces
  console.log("J5: restart (SURFACE-002) — silent install, widget cue only, /interrogate reopens; FR-6 reopen");
  {
    await cleanup();
    const branch = [toolResultEntry(branchState("G", ["q1"]))];
    const pi2 = await freshPi();
    pi2.widget = ["stale pre-reload widget"];
    pi2.emitCore("session_start", { reason: "reload" }, pi2.ctx("tui", branch));
    ok(pi2.customCalls.length === 0, "restart NEVER opens the panel (SURFACE-002)");
    ok(Array.isArray(pi2.widget) && /\/interrogate/.test(pi2.widget[0] ?? ""), "restart sets the suspend widget cue");
    ok(stateMod.getState() !== undefined && Object.keys(stateMod.getState()!.serialize().questions ?? {}).length > 0, "state reconstructed from branch");

    // FR-6 / AC-4: the model's {reopen:true} must bring the panel back on a
    // closed host with live state — a fresh post-restart process is exactly
    // that (panel never opened this process). The /interrogate command
    // handles this row ("closed host ∧ live state → fresh open"); the tool
    // path must not silently fail while reporting success. Run BEFORE any
    // /interrogate invocation so the host is genuinely never-opened.
    const rr = await pi2.callTool({ reopen: true }, pi2.ctx("tui", branch), "rp1");
    const rrText = (rr?.content ?? []).map((c) => c.text ?? "").join(" ");
    ok(rr?.isError !== true, "{reopen:true} post-restart succeeds");
    ok(pi2.customCalls.length === 1, "FR-6: {reopen:true} post-restart opens the panel (closed host, live state)");
    if (pi2.customCalls.length !== 1) {
      console.log(`  [observed] reopen result text: ${JSON.stringify(rrText)} — reported success with no panel`);
    }
    if (pi2.customCalls.length >= 1) pi2.customCalls[0].done(null);
    await settle();

    // The /interrogate command path (the reload row) — must work regardless.
    await pi2.invokeCommand("", pi2.ctx("tui", branch));
    ok(pi2.customCalls.length === 2 || pi2.customCalls.length === 1, "/interrogate after restart opens the panel");
    if (pi2.customCalls.length >= 1) pi2.customCalls[pi2.customCalls.length - 1].done(null);
    await settle();
  }

  // -------------------------------------------- J6: tree navigation silent
  console.log("J6: /tree navigation — never a surface; suspended panel's reminder line reflects the destination branch");
  {
    await cleanup();
    const pi = await freshPi();
    const one = [toolResultEntry(branchState("one", ["q1"]))];
    const five = [toolResultEntry(branchState("five", ["w1", "w2", "w3", "w4", "w5"]))];

    // (a) never opens/reopens the panel (host never opened — trivially clean)
    pi.emitCore("session_tree", { toId: "x" }, pi.ctx("tui", one));
    ok(pi.customCalls.length === 0, "session_tree NEVER opens the panel");
    ok(stateMod.getState() !== undefined && stateMod.getState()!.serialize().questions?.q1 !== undefined, "state follows the destination branch");

    // (b) spec §Branching: "the suspend reminder line reflects the
    // destination branch" — for a panel SUSPENDED at navigation time the
    // displayed line must not keep the abandoned branch's counts.
    await pi.invokeCommand("", pi.ctx("tui", one)); // open the panel legitimately (command path)
    ok(pi.customCalls.length === 1, "panel opened for the suspended-at-nav scenario");
    pi.customCalls[0].done(null); // suspend -> widget line lands ("1 open")
    await settle();
    ok(Array.isArray(pi.widget) && /1 open/.test(pi.widget[0] ?? ""), `suspend widget visible pre-navigation (${JSON.stringify(pi.widget?.[0])})`);

    pi.emitCore("session_tree", { toId: "y" }, pi.ctx("tui", five)); // destination: 5 open
    await settle(); await settle();
    ok(pi.customCalls.length === 1, "tree navigation with suspended panel: nothing opened");
    const widgetLine = pi.widget?.[0] ?? "";
    ok(/5 open/.test(widgetLine), `spec §Branching: suspend reminder line reflects the destination branch (got ${JSON.stringify(widgetLine)})`);

    // (c) teardown on an interrogation-free branch
    pi.emitCore("session_tree", { toId: "z" }, pi.ctx("tui", []));
    await settle();
    ok(pi.customCalls.length === 1, "teardown path opens nothing");
    ok(pi.widget === undefined, "no-residue teardown clears the widget on interrogation-less branch");
  }

  // ------------------------------------------- J7: non-TUI digest (AC-11)
  console.log("J7: print mode — digest, answers[] record, completion on settle");
  {
    await cleanup();
    const pi = await freshPi();
    const ctxP = pi.ctx("print");
    pi.emitCore("session_start", { reason: "startup" }, ctxP);
    const res = await pi.callTool({ goal: "headless", questions: QUESTIONS }, ctxP, "up1");
    ok(res?.isError !== true, "non-TUI upsert succeeds");
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
    ok(/\d+\./.test(text), "result contains numbered markdown digest");
    ok(pi.customCalls.length === 0, "no panel in print mode");
    ok(/sqlite/i.test(text) && /Which engine\?/.test(text), "digest shows options and prompts");

    const epoch = (res as { details?: { state?: { epoch: number } } })?.details?.state?.epoch;
    const rec = await pi.callTool({ answers: [
      { id: "q1", value: "sqlite" }, { id: "q2", value: "gcp" }, { id: "q3", value: "from chat" },
    ], epoch }, ctxP, "up2");
    ok(rec?.isError !== true, "answers[] recorded (epoch-guarded)");
    pi.emitCore("agent_settled", {}, ctxP);
    await settle();
    ok(pi.completions().length === 1, "completion injected after record + settle");
    ok(/from chat/.test(pi.completions()[0]?.msg?.content ?? ""), "completion carries the chat answer");
  }

  // ------------------------------------------- J8: staleness guards (AC-8)
  console.log("J8: stale rev/epoch rejected with current state; re-apply heals");
  {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "guards", questions: [QUESTIONS[0]] }, ctx, "g1");
    const st = stateMod.getState()!;
    const epoch = st.serialize().epoch;

    const staleRev = await pi.callTool({ epoch, questions: [{ ...QUESTIONS[0], rev: 99 }] }, ctx, "g2");
    ok(staleRev?.isError === true, "stale rev rejected");
    ok(/STALE/i.test((staleRev?.content ?? []).map((c) => c.text ?? "").join(" ")), "rejection says STALE");

    const staleEpoch = await pi.callTool({ epoch: epoch + 50, questions: [{ ...QUESTIONS[0], rev: 1, description: "x".repeat(220) }] }, ctx, "g2b");
    ok(staleEpoch?.isError === true, "stale epoch rejected");

    const fresh = await pi.callTool({ epoch, questions: [{ ...QUESTIONS[0], rev: 1, description: "expanded description for the deep view contract, deliberately longer than the floor so no lint warning fires here." }] }, ctx, "g3");
    ok(fresh?.isError !== true, "re-apply with current rev + epoch succeeds");
  }

  // ------------------------------- J9: SURFACE-001 matrix + phantom + empty
  console.log("J9: surfacing matrix — reads never surface in ANY state; re-ask reopens; reopen:true; phantom inert");
  {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "matrix", questions: [
      { id: "m1", prompt: "One?", type: "choice", options: [{ value: "p", label: "P" }, { value: "q", label: "Q" }] },
      { id: "m2", prompt: "Two?", type: "choice", options: [{ value: "r", label: "R" }, { value: "s", label: "S" }] },
    ] }, ctx, "s1");
    ok(pi.customCalls.length === 1, "initial upsert opens the panel");
    pi.customCalls[0].done(null); // suspend
    await settle();

    // (1) read with live open questions
    await pi.callTool({}, ctx, "s2");
    ok(pi.customCalls.length === 1, "read {} with open questions: panel stays closed");

    // (2) all-answered pending
    const st = stateMod.getState()!;
    st.applyAnswer("m1", { value: "p", at: new Date().toISOString() });
    st.applyAnswer("m2", { value: "s", at: new Date().toISOString() });
    await pi.callTool({}, ctx, "s3");
    ok(pi.customCalls.length === 1, "read {} with all answered: panel stays closed");

    // (3) description-only edit over an answered set surfaces nothing
    await pi.callTool({ epoch: st.serialize().epoch, questions: [{ id: "m1", rev: 1, prompt: "One?", type: "choice", options: [{ value: "p", label: "P" }, { value: "q", label: "Q" }], description: "a longer description that only edits display text and leaves the options identical so nothing reopens" }] }, ctx, "s4");
    ok(pi.customCalls.length === 1, "description-only edit over answered set: no surface");

    // (4) re-ask (changed options -> answer reset -> unanswered) reopens
    await pi.callTool({ epoch: stateMod.getState()!.serialize().epoch, questions: [{ id: "m2", rev: 1, prompt: "Two?", type: "choice", options: [{ value: "r", label: "R" }, { value: "t", label: "T" }] }] }, ctx, "s5");
    ok(pi.customCalls.length === 2, "upsert leaving unanswered questions reopens the panel (SURFACE-001 allow-list)");
    ok(stateMod.getState()!.orderedQuestions().find((q) => q.id === "m2")?.status === "reasked", "changed options reset + re-asked marker");
    pi.customCalls[1].done(null);
    await settle();

    // (5) reopen:true resurfaces
    await pi.callTool({ reopen: true }, ctx, "s6");
    ok(pi.customCalls.length === 3, "{reopen:true} resurfaces the panel");
    pi.customCalls[2].done(null);
    await settle();

    // (6) forged pi-ask bridge submit mutates nothing (surface removed)
    const before = pi.messages.length;
    pi.bus.emit("@eko24ive/pi-ask:submit", { version: 1, requestId: "r", flowId: "itg:xyz", response: { kind: "answer", mode: "submit", answers: { m1: { values: ["hacked"] } } } });
    await settle();
    ok(pi.messages.length === before, "forged bridge submit produces no message");
    ok(stateMod.getState()!.orderedQuestions().find((q) => q.id === "m1")?.answer?.value === "p", "forged bridge submit changed no state");

    // (7) complete, then read + /interrogate on dead state
    await pi.invokeCommand("debug submit m1=p,m2=t", pi.ctx("tui"));
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(pi.completions().length === 1, "completion injected once");
    await pi.callTool({}, ctx, "s7");
    ok(pi.customCalls.length === 3, "read {} after completion: panel stays closed");
    await pi.invokeCommand("", pi.ctx("tui"));
    ok(pi.customCalls.length === 3, "/interrogate on dead state opens nothing");
    ok(pi.notifies.some((n) => /No active interrogation/i.test(n.text)), "empty-state notify shown for /interrogate on dead state");
  }

  console.log(`\nE2E: ${checks - failures}/${checks} checks passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("DRIVER CRASH:", e); process.exit(2); });
DRIVER_EOF

E2E_STATUS=0
# Isolate the agent dir so the run is deterministic (defaults only — the real
# ~/.pi may carry user overrides; PI_CODING_AGENT_DIR is pi's documented env).
export PI_CODING_AGENT_DIR="$E2E_DIR/agent-dir"
mkdir -p "$PI_CODING_AGENT_DIR"
ITG_E2E_ROOT="$ROOT" npx vite-node "$E2E_DIR/e2e-driver.ts" > /tmp/itg-e2e.log 2>&1 || E2E_STATUS=$?
cat /tmp/itg-e2e.log
if [ "$E2E_STATUS" -eq 0 ]; then
  pass e2e "all scripted journeys green"
else
  fail e2e "driver exited $E2E_STATUS (details /tmp/itg-e2e.log)"
fi

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

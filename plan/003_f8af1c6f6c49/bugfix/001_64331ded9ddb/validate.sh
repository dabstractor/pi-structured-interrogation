#!/usr/bin/env bash
# validate.sh — comprehensive validation for pi-interrogator (2026-10-07 state)
#
# Validates the CURRENT spec contract end to end:
#   - ANSWER-PIN-001 + the 2026-10-05 re-ask amendment (BUG-001)
#   - DEEP-PIN-001 two-region deep pane (2026-10-05)
#   - FR-18 closed-edit ripple (BUG-003) on option/digit + editor seams
#   - Moot-reason persistence (BUG-004, Option A)
#   - Fresh-receiver epoch acceptance (BUG-005) + BUG-002 panel flush parity
#   - Remote-bridge removal (2026-10-02), write-ins/auto-submit/surfacing
#     gates (plan/002), original M1–M7 feature set (plan/001)
#   - Prior-wave fixes: {reopen:true} on a never-opened host (FR-6) and the
#     /tree suspend-widget refresh (state-and-persistence.md §Branching)
#
# Phases (only what exists in this codebase — no eslint/prettier config):
#   1. Preflight       — toolchain + dependencies present
#   2. Static guards   — forbidden-residue greps (removed surfaces, stale
#                        contract claims, skipped tests, schema pin string)
#   3. Type checking   — tsc --noEmit
#   4. Unit tests      — vitest run (full suite)
#   5. Keymap guard    — scripts/verify-keymap-conflicts.sh
#   6. Docs drift      — README must not contradict shipped behavior
#   7. E2E journeys    — scripted user workflows through the REAL extension
#                        factory + direct panel probes (fake-ctx harness;
#                        sanctioned by plan/001 AUTOMATION-POLICY — no live
#                        TUI, no real interrogate turn, no waiting on humans)
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
# 2b. no global shortcut registration in non-test src (ctrl+shift+q removed)
if grep -rn "registerShortcut(" src/ --include='*.ts' --exclude='*.test.ts' | grep -v "NO registerShortcut" | grep -q .; then
  fail static "registerShortcut call found in non-test src (global shortcuts forbidden)"; STATIC_OK=0
fi
# 2c. retired top-level command registrations absent from non-test src
if grep -rnE 'registerCommand\("(interrogate-ping|interrogate-debug-[a-z]+)"' src/ --include='*.ts' --exclude='*.test.ts' >/dev/null 2>&1; then
  fail static "retired /interrogate-ping|/interrogate-debug-* registrations in non-test src"; STATIC_OK=0
fi
# 2d. no skipped/only/todo tests hiding failures
if grep -rnE '\.(skip|only|todo)\(' src/*.test.ts src/panel/*.test.ts >/dev/null 2>&1; then
  fail static "skipped/only/todo tests present"; STATIC_OK=0
fi
# 2e. remote-bridge surface fully removed (2026-10-02)
if [ -f src/remote-bridge.ts ] || [ -f src/remote-submit.ts ] || [ -f scripts/remote-rpc-itest.mjs ]; then
  fail static "removed remote-bridge artifacts still present (remote-bridge.ts/remote-submit.ts/remote-rpc-itest.mjs)"; STATIC_OK=0
fi
if grep -rln "@eko24ive\|pi-ask" src/ --include='*.ts' | grep -v "regression-phantom-submissions.test.ts" | grep -q .; then
  fail static "pi-ask/bridge references outside the phantom regression guard"; STATIC_OK=0
fi
# 2f. ANSWER-PIN-001 stale claims purged
if grep -rniE "answers? never pin|status-agnostic preselect|still preselects the recommendation" src/ --include='*.ts' >/dev/null 2>&1; then
  fail static "stale status-agnostic-preselect comment remains (ANSWER-PIN-001 purge incomplete)"; STATIC_OK=0
fi
# 2g. tool-schema pinning string is spec-verbatim
if ! grep -q 'marked ★; preselected only while unanswered — a recorded answer always owns the cursor' src/tool-schema.ts; then
  fail static "tool-schema recommendation description is not the spec-verbatim pinning string"; STATIC_OK=0
fi
# 2h. DEEP-PIN-001 constants present (two-region deep pane)
if ! grep -q "MIN_OPTIONS_VIEWPORT" src/panel/deep-view.ts; then
  fail static "deep-view two-region pane constants missing (DEEP-PIN-001)"; STATIC_OK=0
fi
# 2i. mootReason persisted on the Question record (BUG-004 Option A)
if ! grep -q "mootReason" src/state.ts || ! grep -q "mootReason" src/panel/short-view.ts; then
  fail static "mootReason persistence/rendering absent (BUG-004)"; STATIC_OK=0
fi
if [ "$STATIC_OK" -eq 1 ]; then pass static "no forbidden residue (two-stage / shortcuts / old commands / skips / bridge / stale preselect claims; schema string verbatim; deep-pin + moot-reason present)"; fi

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
check_absent 'Explain then press' "two-stage explain flow (removed by WRITEIN-001)"
check_absent 'Auto-\(re\)open' "restart auto-open claim (SURFACE-002 removed it)"
check_absent 'toggles the panel' "toggle semantics (invoke-only since CMD-001)"
check_absent '/interrogate-ping|/interrogate-debug-(upsert|submit|state)' "retired top-level debug command names"
check_absent 'remote-bridge|phoneSeen' "removed remote-bridge surface in README"
# current contract must be documented
check_present '16\. \*\*Answer pinning' "AC-16 in the acceptance-criteria list"
check_present 'Revisits are answer-first' "revisit usage sentence (ANSWER-PIN-001)"
check_present 'Re-asks are the exception' "re-ask re-confirmation usage (BUG-001 amendment)"
check_present 'archived \(closed\) ones included' "closed-edit invalidation confirm (BUG-003)"
check_present '✎ Other — write your own' "write-in row documentation (WRITEIN-001)"
check_present 'foundational unanswered' "gate-hold documentation (AUTOSUBMIT-002)"
check_present 'submitted — \{n\} answer\(s\)|submitted — .* answer' "auto-submit flash documentation (AUTOSUBMIT-001)"
check_present 'moot: \{dep\}=\{value\}' "real moot-reason documentation (BUG-004)"
if [ "$DOCS_OK" -eq 1 ]; then pass docs "README matches shipped behavior (no stale claims; current contract documented)"; fi

# ------------------------------------------------------------------- 7 E2E run
phase "7/7 E2E journeys (scripted, real factory + direct panel probes — AUTOMATION-POLICY compliant)"
E2E_DIR="$(mktemp -d /tmp/itg-e2e.XXXXXX)"
cat > "$E2E_DIR/e2e-driver.ts" <<'DRIVER_EOF'
/**
 * E2E driver — scripted user journeys through the REAL extension factory
 * (src/index.ts) plus direct InterrogationPanel probes, per the AUTOMATION-
 * POLICY (plan/001): no live TUI, no real interrogate tool turn, no waiting
 * on humans.
 *
 *   J1  planner happy path: upsert -> panel -> suspend -> widget -> read
 *       silent -> /interrogate resumes -> answer-all -> auto-submit delta ->
 *       agent_settled -> completion injected exactly once
 *   J2  answer pinning (AC-16/FR-35) + BUG-001 re-ask re-confirmation round
 *       trip + BUG-002 rule-2 same-value re-answer ships (flush parity)
 *   J3  auto-submit rules (AUTOSUBMIT-001/003): last-answer transition,
 *       closed-edit non-last edit ships nothing + manual ctrl+s + (changed)
 *       diff (AC-13), review-flow exit; gate hold + ctrl+s override
 *   J4  editor duties (WRITEIN-001/002): elaboration attach, write-in
 *       commit + supersede re-bind, held-elaboration zero-pending flash
 *   J5  restart (SURFACE-002): silent install + widget only; {reopen:true}
 *       on a never-opened host OPENS the panel (FR-6); /interrogate reopens
 *   J6  tree navigation: silent branch follow; suspended widget line
 *       refreshes to the destination branch; open panel suspends; teardown
 *   J7  non-TUI digest (AC-11): print-mode digest; answers[] epoch-guarded;
 *       completion on settle
 *   J8  staleness guards (AC-8) + BUG-005 fresh-receiver epoch acceptance +
 *       rotation guard still enforced
 *   J9  SURFACE-001 matrix: reads never surface in ANY state; description-
 *       only edit surfaces nothing; re-ask reopens; forged bridge submit
 *       inert; /interrogate on dead state notifies
 *   J10 BUG-003 closed-edit ripple: different-value edits of CLOSED
 *       questions raise the FR-18 confirm on the option, digit, and
 *       write-in seams; same-value stays inert
 *   J11 BUG-004 moot reason: persisted `moot: {dep}={value}`, rendered in
 *       short view + overview, stripped in the completion record, cleared on
 *       reopen
 *   J12 DEEP-PIN-001: pinned question region never scrolls; overflow
 *       truncates bottom-first; MIN_OPTIONS_VIEWPORT floor; text questions
 *       full height; select-from-deep returns + advances
 *   J13 deep-view selection glyphs (D-R14 amendment 9): ▸ prefix + heavy ┃
 *       pipes on the selected section; plain │ elsewhere
 *   J14 D-R13 recommended-first display order: ★ leads; digits follow
 *       display positions
 *   J15 ISSUE-1 repro: session_start on an empty branch severs the panel
 *       host's noteSubmissionDelivered hook; a same-run re-ask + re-confirm
 *       (steer delivery) then wedges the question in `submitted` and blocks
 *       completion
 *   J16 ISSUE-2 repro: after a rule-1 re-ask of a submitted question, the
 *       reopened panel focuses ordered[0] instead of the re-asked question
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
    currentId: string | undefined;
    confirmMode: { kind: string; questionId: string } | null;
    gateWarning: { count: number; kind: string } | null;
    footerFlash: { text: string } | undefined;
    textDuty: string;
    focus: string;
    view: string;
    delivery?: { sendMessage?: unknown; noteSubmissionDelivered?: () => void };
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
        l.push(handler as never);
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
  makeCtx(mode: string, branch: unknown[], idleRef: { v: boolean }) {
    const self = this;
    return {
      mode,
      hasUI: mode === "tui",
      model: { contextWindow: 200000 },
      sessionManager: { getBranch: () => branch },
      isIdle: () => idleRef.v,
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
  ctx(mode = "tui", branch: unknown[] = []) { return this.makeCtx(mode, branch, { v: true }); }
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
  } as never;
}

/** Hand-built serialized branch state (no factory seeding — keeps the
 * module-global panel-host record untouched for later scenarios). */
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
const ENTER = "\r", ESC = "\u001b", CTRL_S = "\u0013", CTRL_T = "\u0014", CTRL_D = "\u0004", CTRL_L = "\u000c";

const RAM = "Standalone consequence text long enough to clear the lint floor and explain the trade-off in full for a reader who has not seen the conversation.";

const QUESTIONS = [
  { id: "q1", title: "Engine", prompt: "Which engine?", type: "choice", gate: true, group: "foundational",
    options: [{ value: "sqlite", label: "SQLite", ramification: RAM }, { value: "postgres", label: "Postgres", ramification: RAM }],
    recommendation: "sqlite",
    description: "Pick the storage engine for the first release. This is the foundational choice that later questions depend on, so decide it before the rest." },
  { id: "q2", title: "Cloud", prompt: "Which cloud?", type: "choice", group: "runtime",
    options: [{ value: "aws", label: "AWS", ramification: RAM }, { value: "gcp", label: "GCP", ramification: RAM }] },
  { id: "q3", title: "Notes", prompt: "Anything else?", type: "text", group: "runtime" },
];

async function main() {
  const mod = (await import(ROOT + "/src/index.js")) as { default: (api: never) => Promise<void> };
  const stateMod = (await import(ROOT + "/src/state.js")) as {
    getState: () => undefined | {
      serialize: () => {
        goal: string; epoch: number; completed: boolean;
        questions: Record<string, { id: string; status?: string; rev?: number; mootReason?: string; answer?: { value?: string; custom?: boolean; at?: string; text?: string } }>;
      };
      orderedQuestions: () => Array<{ id: string; status: string; rev: number; mootReason?: string; answer?: { value?: string; custom?: boolean; at?: string; text?: string } }>;
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
  const q = (id: string) => stateMod.getState()!.orderedQuestions().find((x) => x.id === id);
  const ser = () => stateMod.getState()!.serialize();

  // ------------------------------------------------ J1: planner happy path
  console.log("J1: upsert -> panel -> suspend -> widget -> read silent -> resume -> submit -> settle -> completion once");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);

    const res = await pi.callTool({ goal: "Ship v1", questions: QUESTIONS }, ctx);
    ok(res?.isError !== true, "upsert succeeds");
    ok(pi.customCalls.length === 1, "panel auto-opens on first upsert (leaves unanswered)");
    ok(pi.shortcutCalls.length === 0, "no global shortcut registered (breakOut removed)");
    ok(pi.customCalls[0].component.currentId === "q1", "gate-group question focused first");

    pi.customCalls[0].done(null); // esc-equivalent suspend
    await settle();
    ok(Array.isArray(pi.widget) && /\/interrogate to resume/.test(pi.widget[0] ?? ""), "widget line after suspend names /interrogate");
    ok(!/ctrl|alt\+|shift\+/i.test(pi.widget[0] ?? ""), "widget line has no key chord");

    const read = await pi.callTool({}, ctx);
    ok(read?.isError !== true, "read {} succeeds");
    ok(pi.customCalls.length === 1, "read {} never opens the panel (SURFACE-001)");
    const readText = (read?.content ?? []).map((c) => c.text ?? "").join("\n");
    ok(/sqlite/.test(readText) && /Which engine\?/.test(readText), "read returns FULL question content (patch-semantics pin)");
    ok(/epoch 1/.test(readText), "read reports the epoch");

    await pi.invokeCommand("", pi.ctx("tui"));
    ok(pi.customCalls.length === 2, "/interrogate resumes the suspended panel");
    const panel = pi.customCalls[1].component;
    ok(panel.currentId === "q1", "resume focuses the first unanswered question (RESUME-001)");

    // answer all three via keystrokes: q1 sqlite (digit 1 = display row 0 = ★),
    // q2 gcp (DOWN + ENTER), q3 write-in via text affordance.
    panel.handleInput("1");
    ok(q("q1")?.answer?.value === "sqlite" && q("q1")?.status === "answered", "digit accept answers q1");
    ok(panel.currentId === "q2", "accept advances to next unanswered (Q14)");
    panel.handleInput(DOWN); panel.handleInput(ENTER);
    ok(q("q2")?.answer?.value === "gcp", "arrow+enter answers q2 with gcp");
    ok(panel.currentId === "q3", "advanced to q3 (text question)");
    panel.handleInput(CTRL_T); // text question -> write-in duty
    panel.textField.setText("ship it lean");
    const epoch0 = ser().epoch;
    panel.handleInput(ENTER); // text enter commits -> LAST answered -> auto-submit
    await settle();
    ok(q("q3")?.answer?.value === "ship it lean", "text write-in commits as the answer");
    const subs = pi.submissions();
    ok(subs.length === 1, "auto-submit fired on the last-answer transition (no ctrl+s needed)");
    const delta = String(subs[0]?.msg?.content ?? "");
    const lines = delta.split("\n").filter((l) => l.trim() !== "");
    ok(lines.length <= 3, `delta is <=3 lines (got ${lines.length})`);
    ok(/Consider how these affect your other questions/.test(delta), "delta carries the reminder line");
    ok(/state epoch 2/.test(delta), "delta names the new epoch");
    ok(/q3: ✎ ship it lean/.test(delta), "delta lists the write-in answer as ✎ {text}");
    ok(ser().epoch === epoch0 + 1, "epoch bumped exactly once");

    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(ser().completed === true, "agent_settled archives + completes (FR-4/FR-5; close pass then clearForCompletion)");
    const comps = pi.completions();
    ok(comps.length === 1, "completion record injected exactly once (FR-5)");
    const rec = String(comps[0]?.msg?.content ?? "");
    ok(/INTERROGATION COMPLETE/.test(rec) && /Ship v1/.test(rec), "completion record names the goal");
    ok(/SQLite/.test(rec) && /GCP/.test(rec) && /ship it lean/.test(rec), "completion record carries every answer (labels + write-in)");
    ok(/✎ ship it lean/.test(rec), "completion record renders the write-in as ✎ {text}");
    await pi.callTool({}, ctx);
    ok(pi.customCalls.length === 2, "read after completion surfaces nothing");
  } catch (e) { failures++; console.log(`  FAIL J1 crashed: ${e}`); }

  // ------------------- J2: answer pinning + BUG-001 re-ask re-confirmation
  console.log("J2: AC-16 answer pinning; BUG-001 re-ask same-value re-confirmation ships; BUG-002 rule-2 same-value re-answer ships");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "pinning", questions: [
      { id: "q1", title: "Engine", prompt: "Which engine?", type: "choice", options: [{ value: "sqlite", label: "SQLite", ramification: RAM }, { value: "postgres", label: "Postgres", ramification: RAM }], recommendation: "sqlite" },
      { id: "q2", title: "Cloud", prompt: "Which cloud?", type: "choice", options: [{ value: "aws", label: "AWS", ramification: RAM }, { value: "gcp", label: "GCP", ramification: RAM }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;

    // Non-recommended accept on q1: caret row 0 is ★ sqlite; move DOWN to postgres.
    ok(panel.cursorIndex === 0, "unanswered question preselects the ★ recommendation");
    panel.handleInput(DOWN); panel.handleInput(ENTER);
    ok(q("q1")?.answer?.value === "postgres", "answered q1 with the NON-recommended option");
    ok(panel.currentId === "q2", "advanced after accept");
    panel.handleInput(LEFT);
    ok(panel.currentId === "q1", "LEFT returns to q1 (full-list navigation)");
    ok(panel.cursorIndex === 1, "revisit pins the caret to the RECORDED answer row, not ★ (FR-35)");
    const at0 = q("q1")!.answer!.at!;
    const epoch0 = ser().epoch;
    panel.handleInput(ENTER); // same-value enter -> no-op advance
    ok(q("q1")?.answer?.at === at0, "same-value enter does NOT rewrite answer.at");
    ok(panel.currentId === "q2", "same-value enter advances");
    ok(ser().epoch === epoch0 && pi.submissions().length === 0, "same-value enter: no epoch bump, no submission");
    panel.handleInput(LEFT);
    panel.handleInput("2"); // digit 2 = display row 1 = postgres = recorded
    ok(q("q1")?.answer?.at === at0 && pi.submissions().length === 0, "digit on the recorded value is inert");
    ok(panel.currentId === "q2", "digit no-op advances");

    // write-in pinning: q2 -> ✎ Other row, commit, revisit pins ✎ row; byte-identical inert
    panel.handleInput(DOWN); panel.handleInput(DOWN); // q2 caret -> ✎ Other row (index 2)
    panel.handleInput(ENTER); // write-in duty
    ok(panel.focus === "text" && panel.textDuty === "writein", "accepting ✎ Other opens write-in duty");
    panel.textField.setText("bare metal");
    panel.handleInput(ENTER); // commits (q2 was unanswered -> no FR-18 modal)
    ok(q("q2")?.answer?.value === "bare metal" && q("q2")?.answer?.custom === true, "write-in commits as answer.value custom:true");
    // completeness: q1 answered, q2 answered -> transition auto-submits
    await settle();
    ok(pi.submissions().length === 1, "completeness transition auto-submitted");

    // ---- BUG-001 round trip: agent rule-1 re-ask (same options, new text)
    const st = ser();
    const up1 = await pi.callTool({ epoch: st.epoch, questions: [
      { id: "q1", rev: st.questions["q1"].rev, prompt: "Which engine (re-asked)?", type: "choice", options: [{ value: "sqlite", label: "SQLite", ramification: RAM }, { value: "postgres", label: "Postgres", ramification: RAM }], recommendation: "sqlite" },
    ] }, ctx);
    ok(up1?.isError !== true, "rule-1 re-ask upsert succeeds");
    await settle();
    pi.emitCore("agent_settled", {}, ctx); // the re-ask turn settles (production order)
    await settle();
    const q1 = q("q1");
    ok(q1?.status === "reasked", "touched submitted question flips to reasked (lifecycle marker)");
    ok(q1?.answer?.value === "postgres", "rule-1 re-ask KEEPS the recorded answer");
    ok(pi.customCalls.length >= 2, "re-ask upsert (unanswered remain) resurfaces the panel");
    const rp = pi.customCalls[pi.customCalls.length - 1].component;
    const atR = q("q1")!.answer!.at!;
    rp.handleInput(ENTER); // same-value enter on REASKED -> re-confirmation commit
    await settle();
    ok(q("q1")?.status === "answered" || q("q1")?.status === "submitted", "re-confirmation re-marks the question (transition may have shipped it)");
    ok(q("q1")?.answer?.at !== atR, "re-confirmation writes a fresh answer.at");
    ok(pi.submissions().length === 2, "re-confirmation ships through the auto-submit transition (BUG-001)");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(ser().completed === true, "settle archives after re-confirmation; the round trip completes");

    // ---- BUG-002: rule-2 re-ask (changed options) + same-value re-answer ships
    const st2 = ser();
    ok(st2.completed === true, "previous interrogation completed");
    const up2 = await pi.callTool({ goal: "round two", questions: [
      { id: "z1", title: "Engine", prompt: "Which engine?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      { id: "z2", title: "Cloud", prompt: "Which cloud?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
    ] }, ctx);
    ok(up2?.isError !== true, "fresh interrogation after completion accepted (no epoch echo required)");
    const panel2 = pi.customCalls[pi.customCalls.length - 1].component;
    ok(panel2.currentId === "z1", "new panel for the fresh interrogation");
    panel2.handleInput("1"); // answer z1=a (z2 open -> no transition)
    const st2b = ser();
    const ctrlS1 = pi.customCalls[pi.customCalls.length - 1].component;
    ctrlS1.handleInput(CTRL_S); // partial: z1 submitted, z2 open
    await settle();
    ok(pi.submissions().length === 3, "partial submission ships z1 (2 prior submissions + the partial)");
    pi.emitCore("agent_settled", {}, ctx); // settle closes z1; z2 open blocks completion
    await settle();
    const st3 = ser();
    ok(q("z1")?.status === "closed" && q("z2")?.status === "open", "partial round: z1 archived, z2 open");
    const up3 = await pi.callTool({ epoch: st3.epoch, questions: [
      { id: "z1", rev: st3.questions["z1"].rev, prompt: "Which engine now?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }, { value: "c", label: "C", ramification: RAM }] },
    ] }, ctx);
    ok(up3?.isError !== true, "rule-2 re-ask (changed options) on the closed z1 succeeds");
    await settle();
    ok(q("z1")?.status === "reasked" && q("z1")?.answer === undefined, "changed options reset the answer + re-asked marker");
    const panel3 = pi.customCalls[pi.customCalls.length - 1].component;
    if (panel3.currentId !== "z1") panel3.currentId = "z1";
    const subsBefore = pi.submissions().length;
    panel3.handleInput("1"); // re-answer with the SAME value a (diff vs snapshot is empty)
    await settle();
    ok(q("z1")?.status === "answered" && q("z1")?.answer?.value === "a", "same-value re-answer recorded (pending)");
    ok(pi.submissions().length === subsBefore, "no auto-submit yet (z2 still open)");
    panel3.handleInput(CTRL_S); // manual ship: empty-diff flush must still deliver
    await settle();
    ok(pi.submissions().length === subsBefore + 1, "BUG-002: empty-diff re-answer still SHIPS (flush parity)");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    // answer z2 -> transition -> settle -> completion (resume the suspended panel first)
    await pi.invokeCommand("", pi.ctx("tui"));
    const panel4 = pi.customCalls[pi.customCalls.length - 1].component;
    ok(panel4.currentId === "z2", "resume focuses the open z2");
    panel4.handleInput("1");
    await settle();
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(pi.completions().length === 2, "second interrogation completes");
  } catch (e) { failures++; console.log(`  FAIL J2 crashed: ${e}`); }

  // --------------------------------- J3: auto-submit rules + gate hold
  console.log("J3: transition vs closed-edit non-last (AC-13) vs review-flow exit; gate hold + override");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    const mk = (id: string) => ({ id, prompt: `${id}?`, type: "choice", options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] });
    const a2dep = { id: "a2", prompt: "a2?", type: "choice", dependsOn: [{ id: "a1", equals: "x" }], options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] };
    await pi.callTool({ goal: "autosubmit", questions: [mk("a1"), a2dep, mk("a3"), mk("a4")] }, ctx);
    let panel = pi.customCalls[0].component;
    panel.handleInput("1"); // a1 = x (dependency met: a2 stays answerable)
    ok(pi.submissions().length === 0, "non-last answers do not auto-submit");
    panel.handleInput("1"); // a2
    ok(pi.submissions().length === 0, "still incomplete -> no submit");
    panel.handleInput("2"); // a3 = last ANSWERED (a4 open) -> NOT complete -> no transition
    await settle();
    ok(pi.submissions().length === 0, "an open question blocks the completeness transition");
    panel.handleInput(CTRL_S); // partial submit (a1,a2,a3)
    await settle();
    ok(pi.submissions().length === 1, "ctrl+s partial submission ships");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    const st = ser();
    ok(q("a1")?.status === "closed" && q("a3")?.status === "closed" && q("a4")?.status === "open", "settled partial: 3 archived, a4 open (no completion)");

    // closed-edit (BUG-003) with an ANSWERED victim: round 1 archives a1;
    // round 2 leaves dependent a2 answered-pending; editing the CLOSED a1
    // to a different value must raise the FR-18 modal (victim a2 answered).
    const stA = ser();
    ok(q("a1")?.status === "closed" && q("a2")?.status === "closed" && q("a4")?.status === "open", "round 1 archived a1-a3, a4 open");
    const edit1 = await pi.callTool({ epoch: stA.epoch, questions: [
      { id: "a1", rev: stA.questions["a1"].rev, prompt: "a1?", type: "choice", options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] },
      { id: "a5", prompt: "a5?", type: "choice", dependsOn: [{ id: "a1", equals: "x" }], options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] },
    ] }, ctx);
    ok(edit1?.isError !== true, "reopen a1 + add dependent a5 in one upsert");
    await settle();
    panel = pi.customCalls[pi.customCalls.length - 1].component;
    ok(panel.currentId === "a1", "reopened panel focuses the re-asked question");
    ok(q("a1")?.status === "answered" && q("a1")?.answer?.value === "x", "reopen-same keeps the recorded answer (answered)");
    // answer the dependent a5 (pending, unshipped) so an a1 edit has a victim
    panel.currentId = "a5";
    panel.handleInput("1"); // a5 = x (pending)
    ok(q("a5")?.status === "answered", "a5 answered (pending, unshipped)");
    // edit the reopened a1 (recorded answer x) to y: victim a5 (answered) -> modal
    panel.currentId = "a1"; // setter re-seeds the caret via initialCursorIndex
    ok(panel.currentId === "a1" && panel.cursorIndex === 0, "back on a1, caret pinned to recorded x");
    panel.handleInput(DOWN); panel.handleInput(ENTER); // different choice y
    ok(panel.confirmMode?.kind === "choice", "closed-edit different choice raises the FR-18 confirm (BUG-003; victim a5 answered)");
    panel.handleInput(ESC); // cancel
    ok(q("a1")?.answer?.value === "x" && q("a5")?.status === "answered", "esc cancels with no state change");
    panel.handleInput(DOWN); panel.handleInput(ENTER); // re-raise
    ok(panel.confirmMode?.kind === "choice", "modal re-raised on retry");
    panel.handleInput(ENTER); // apply (keep)
    await settle();
    ok(panel.confirmMode === null, "confirm cleared after apply");
    ok(q("a1")?.status === "answered" && q("a1")?.answer?.value === "y", "applied edit re-marks a1 answered(pending) (AC-13)");
    ok(q("a5")?.status === "moot", "applied edit moots the invalidated dependent (a5 -> moot)");
    ok(pi.submissions().length === 1, "NON-last edit of the set ships NOTHING (AUTOSUBMIT-003; last answerable is a4)");
    panel.handleInput(CTRL_S);
    await settle();
    ok(pi.submissions().length === 2, "manual ctrl+s ships the non-last edit");
    const delta13 = String(pi.submissions()[1]?.msg?.content ?? "");
    ok(/a1: [Yy] \(changed\)/.test(delta13), "diff card highlights the archived edit as (changed) (AC-13)");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();

    // last open question: transition -> settle -> completion
    const stB = ser();
    const edit4 = await pi.callTool({ epoch: stB.epoch, questions: [
      { id: "a4", rev: stB.questions["a4"].rev, prompt: "a4?", type: "choice", options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] },
    ] }, ctx);
    ok(edit4?.isError !== true, "reopen a4 (the last answerable)");
    await settle();
    panel = pi.customCalls[pi.customCalls.length - 1].component;
    ok(panel.currentId === "a4", "panel focuses a4");
    panel.handleInput("2"); // answer a4 = y -> transition (last open; a5 moot does not block completeness)
    await settle();
    ok(q("a4")?.answer?.value === "y", "a4 answered");
    ok(pi.submissions().length === 3, "answering the last open question ships (transition)");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    // a5 is a STANDING MOOT: completion is blocked (moot-inclusive predicate).
    // Documented recovery: the agent re-upserts a5 with CHANGED options (rule 2).
    const stC = ser();
    const edit5 = await pi.callTool({ epoch: stC.epoch, questions: [
      { id: "a5", rev: stC.questions["a5"].rev, prompt: "a5 (rewritten)?", type: "choice", options: [{ value: "x", label: "X", ramification: RAM }, { value: "z", label: "Z", ramification: RAM }] },
    ] }, ctx);
    ok(edit5?.isError !== true, "rule-2 re-upsert of the standing moot a5 succeeds");
    await settle();
    ok(q("a5")?.status === "reasked", "changed options flip the moot question to reasked (recovery path)");
    await pi.invokeCommand("", pi.ctx("tui"));
    panel = pi.customCalls[pi.customCalls.length - 1].component;
    if (panel.currentId !== "a5") panel.currentId = "a5";
    panel.handleInput("1"); // answer a5 -> transition -> settle -> completion
    await settle();
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(pi.completions().length === 1, "interrogation completes after the moot recovery re-ask");

    // review-flow exit: fresh 2-question set; after the transition leaves
    // both submitted (complete, pending-submit), editing the LAST sequential
    // answerable ships immediately; a non-last edit does not.
    const stN = ser();
    ok(stN.completed === true, "first interrogation completed — fresh one next");
    const upB = await pi.callTool({ goal: "review flow", questions: [
      { id: "b1", prompt: "b1?", type: "choice", options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] },
      { id: "b2", prompt: "b2?", type: "choice", options: [{ value: "x", label: "X", ramification: RAM }, { value: "y", label: "Y", ramification: RAM }] },
    ] }, ctx);
    ok(upB?.isError !== true, "fresh interrogation started");
    await settle();
    const bp = pi.customCalls[pi.customCalls.length - 1].component;
    bp.handleInput("1"); // b1 = x
    await settle();
    bp.handleInput("1"); // b2 = x -> transition ships both (complete set)
    await settle();
    const subsR = pi.submissions().length;
    ok(q("b1")?.status === "submitted" && q("b2")?.status === "submitted", "complete set pending-settle (both submitted)");
    await pi.invokeCommand("", pi.ctx("tui")); // resume the pending-submit panel
    const rp2 = pi.customCalls[pi.customCalls.length - 1].component;
    // non-last edit (b1): different choice, no victims -> applies directly, ships nothing
    if (rp2.currentId !== "b1") rp2.currentId = "b1";
    rp2.handleInput(DOWN); rp2.handleInput(ENTER);
    if (rp2.confirmMode?.kind) rp2.handleInput(ENTER);
    await settle();
    ok(q("b1")?.answer?.value === "y" && q("b1")?.status === "answered", "non-last edit applied (re-pended)");
    ok(pi.submissions().length === subsR, "non-last edit of the complete set ships NOTHING (manual ctrl+s territory)");
    // last-answerable edit (b2): review-flow exit ships immediately
    rp2.currentId = "b2";
    rp2.handleInput(DOWN); rp2.handleInput(ENTER);
    if (rp2.confirmMode?.kind) rp2.handleInput(ENTER);
    await settle();
    ok(q("b2")?.answer?.value === "y", "last-answerable edit applied");
    ok(pi.submissions().length === subsR + 1, "review-flow exit: edit of the LAST sequential answerable on a complete set SHIPS (AUTOSUBMIT-003 b)");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(pi.completions().length === 2, "completes again after the review-flow edit");

    // ---- gate hold
    await cleanup();
    const pi2 = await freshPi();
    const ctx2 = pi2.ctx("tui");
    pi2.emitCore("session_start", { reason: "startup" }, ctx2);
    await pi2.callTool({ goal: "gate", questions: [
      { id: "g1", prompt: "Foundational?", type: "choice", gate: true, group: "core", options: [{ value: "p", label: "P", ramification: RAM }, { value: "q", label: "Q", ramification: RAM }] },
      { id: "g2", prompt: "Later?", type: "choice", group: "later", options: [{ value: "r", label: "R", ramification: RAM }, { value: "s", label: "S", ramification: RAM }] },
    ] }, ctx2);
    const gp = pi2.customCalls[0].component;
    ok(gp.currentId === "g1", "gate question focused first");
    gp.handleInput(RIGHT); // navigate to g2 (full-list nav; gate soft)
    ok(gp.currentId === "g2", "later group navigable while gate unanswered (soft gate, R1)");
    gp.handleInput("1"); // answer g2 while gate g1 unanswered
    await settle();
    ok(pi2.submissions().length === 0, "gate hold withholds auto-submit (AUTOSUBMIT-002)");
    ok(gp.gateWarning !== null && gp.gateWarning.count === 1, "non-expiring gate-hold warning armed on commit");
    gp.handleInput(CTRL_S); // deliberate override
    await settle();
    ok(pi2.submissions().length === 1, "ctrl+s overrides the gate hold");
    pi2.emitCore("agent_settled", {}, ctx2);
    await settle();
    const stg = ser();
    const branchQ = await pi2.callTool({ epoch: stg.epoch, questions: [
      { id: "g1", rev: stg.questions["g1"].rev, prompt: "Foundational?", type: "choice", gate: true, group: "core", options: [{ value: "p", label: "P", ramification: RAM }, { value: "q", label: "Q", ramification: RAM }] },
    ] }, ctx2);
    ok(branchQ?.isError !== true, "reopen g1 for answering");
    const gp2 = pi2.customCalls[pi2.customCalls.length - 1].component;
    const before = pi2.submissions().length;
    gp2.handleInput("1"); // answer the gate -> last unanswered -> transition
    await settle();
    ok(pi2.submissions().length === before + 1, "answering the gate releases the transition auto-submit");
    pi2.emitCore("agent_settled", {}, ctx2);
    await settle();
    ok(pi2.completions().length === 1, "gate scenario completes");
  } catch (e) { failures++; console.log(`  FAIL J3 crashed: ${e}`); }

  // ------------------------------------- J4: editor duties (WRITEIN-001/002)
  console.log("J4: elaboration attach; write-in commit + supersede re-bind; held-elaboration flash");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "duties", questions: [
      { id: "d1", prompt: "Pick one?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      { id: "d2", prompt: "Pick another?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      { id: "d3", prompt: "Hold a draft?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;

    // elaboration duty: ctrl+t, type, enter -> draft saved, NOT answered
    panel.handleInput(CTRL_T);
    ok(panel.focus === "text" && panel.textDuty === "elaboration", "ctrl+t opens the editor in elaboration duty (option selected)");
    panel.textField.setText("because of latency");
    panel.handleInput(ENTER);
    ok(q("d1")?.answer === undefined, "elaboration alone never answers (WRITEIN-001)");
    ok(panel.draftTextFor("d1") === "because of latency", "elaboration draft saved to the question's slot");
    panel.handleInput("1"); // accept a -> draft attaches as answer.text at submit
    panel.handleInput(CTRL_S);
    await settle();
    ok(q("d1")?.answer?.text === "because of latency", "elaboration attaches as answer.text (WRITEIN-002 role binding)");

    // write-in duty on d2, then supersede with a real option
    ok(panel.isResolved() === true, "post-submit exit: panel auto-suspended after delivery (FR-3d)");
    await pi.invokeCommand("", pi.ctx("tui"));
    const p2 = pi.customCalls[pi.customCalls.length - 1].component;
    ok(p2.currentId === "d2", "resume focuses first unanswered (d2)");
    p2.handleInput(DOWN); p2.handleInput(DOWN); // to ✎ Other row
    p2.handleInput(ENTER); // enter write-in duty
    ok(p2.focus === "text" && p2.textDuty === "writein", "accepting ✎ Other opens the editor in write-in duty");
    p2.textField.setText("my own answer");
    p2.handleInput(ENTER); // commit
    ok(q("d2")?.answer?.value === "my own answer" && q("d2")?.answer?.custom === true, "write-in commits as answer.value custom:true");
    ok(p2.currentId === "d3", "write-in commit advanced (Q14 parity)");
    p2.handleInput(LEFT); // back to d2; caret pinned on ✎ row (index 2)
    ok(p2.cursorIndex === 2, "write-in answer pins the caret to the ✎ Other row (FR-35)");
    p2.handleInput(UP); p2.handleInput(UP); // to display row 0 = a (different choice)
    p2.handleInput(ENTER); // different choice on answered (custom) -> confirm
    if (p2.confirmMode?.kind === "writein" || p2.confirmMode?.kind === "choice") p2.handleInput(ENTER);
    ok(q("d2")?.answer?.value === "a" && q("d2")?.answer?.custom !== true, "option accept supersedes the write-in");
    // ship d2 so nothing stays pending; then hold a draft on d3 with zero pending
    p2.handleInput(CTRL_S);
    await settle();
    ok(p2.isResolved() === true, "panel suspended after shipping d2");
    await pi.invokeCommand("", pi.ctx("tui")); // resume -> focuses first unanswered d3
    const p3 = pi.customCalls[pi.customCalls.length - 1].component;
    ok(p3.currentId === "d3", "resume focuses d3");
    p3.handleInput(CTRL_T);
    p3.textField.setText("undecided note");
    p3.handleInput(ENTER); // save draft (elaboration on an unanswered question)
    const subsBefore = pi.submissions().length;
    p3.handleInput(CTRL_S); // zero pending -> held flash
    await settle();
    ok(/nothing to submit — 1 question\(s\) have drafts awaiting an option or Other/.test(p3.footerFlash?.text ?? ""), "zero-pending flash names the held elaboration (WRITEIN-002)");
    ok(pi.submissions().length === subsBefore, "held elaboration ships nothing");
  } catch (e) { failures++; console.log(`  FAIL J4 crashed: ${e}`); }

  // ------------------------------- J5: restart (SURFACE-002) + FR-6 reopen
  console.log("J5: restart installs silently; widget only; {reopen:true} on never-opened host OPENS (FR-6); /interrogate reopens");
  try {
    await cleanup();
    const pi = await freshPi();
    const branch = [toolResultEntry(branchState("Resumed goal", ["r1", "r2"]))];
    const ctx = pi.ctx("tui", branch);
    pi.emitCore("session_start", { reason: "resume" }, ctx);
    await settle();
    ok(pi.customCalls.length === 0, "session_start NEVER opens the panel (SURFACE-002)");
    ok(Array.isArray(pi.widget) && /2 open · 0 answered — \/interrogate to resume/.test(pi.widget[0] ?? ""), "suspend widget set with live counts");
    ok(stateMod.getState() !== undefined && ser().goal === "Resumed goal", "state restored from the branch");

    // FR-6: agent reopen on a NEVER-OPENED host must open the panel
    const ro = await pi.callTool({ reopen: true }, ctx);
    ok(ro?.isError !== true, "{reopen:true} succeeds");
    ok(pi.customCalls.length === 1, "{reopen:true} OPENS the panel on a never-opened host (prior-wave Issue 1 fixed)");
    const rp = pi.customCalls[0].component;
    ok(rp.currentId === "r1", "reopen focuses the first unanswered question");
    rp.done(null); await settle();
    ok(Array.isArray(pi.widget), "widget re-set after suspend");

    await pi.invokeCommand("", pi.ctx("tui", branch));
    ok(pi.customCalls.length === 2, "/interrogate reopens restored state");
    pi.customCalls[1].done(null); await settle();
  } catch (e) { failures++; console.log(`  FAIL J5 crashed: ${e}`); }

  // ------------------------------------- J6: tree navigation (silent + widget)
  console.log("J6: session_tree silent; suspended widget refreshes to destination branch; teardown");
  try {
    await cleanup();
    const pi = await freshPi();
    const branchA = [toolResultEntry(branchState("Goal A", ["a1"]))];
    const branchB = [toolResultEntry(branchState("Goal B", ["b1", "b2", "b3", "b4", "b5"]))];
    const branchEmpty: unknown[] = [];
    const ctxA = pi.ctx("tui", branchA);
    pi.emitCore("session_start", { reason: "resume" }, ctxA);
    await settle();
    ok(pi.widget?.[0]?.startsWith("1 open · 0 answered"), "start branch widget: 1 open");
    const ctxB = pi.ctx("tui", branchB);
    pi.emitCore("session_tree", { type: "session_tree" }, ctxB);
    await settle(); await settle();
    ok(pi.customCalls.length === 0, "tree nav never opens the panel (suspended host)");
    ok(pi.widget?.[0]?.startsWith("5 open · 0 answered"), "suspend widget REFRESHES to the destination branch (prior-wave Issue 2 fixed)");
    ok(ser().goal === "Goal B", "state follows the destination branch");

    await pi.invokeCommand("", pi.ctx("tui", branchB));
    ok(pi.customCalls.length === 1, "/interrogate opens on branch B");
    const ctxA2 = pi.ctx("tui", branchA);
    pi.emitCore("session_tree", { type: "session_tree" }, ctxA2);
    await settle(); await settle();
    ok(pi.customCalls[0].resolved === true, "open panel suspends on tree navigation");
    ok(pi.customCalls.length === 1, "no reopen on navigation");
    ok(ser().goal === "Goal A", "state retargeted to branch A");

    const ctxE = pi.ctx("tui", branchEmpty);
    pi.emitCore("session_tree", { type: "session_tree" }, ctxE);
    await settle(); await settle();
    ok(pi.widget === undefined, "widget cleared on an interrogation-free branch");
    ok(pi.customCalls.length === 1, "still no surface on teardown");
  } catch (e) { failures++; console.log(`  FAIL J6 crashed: ${e}`); }

  // ------------------------------------------- J7: non-TUI digest (AC-11)
  console.log("J7: print-mode digest; answers[] epoch-guarded; completion on settle");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctxP = pi.ctx("print");
    pi.emitCore("session_start", { reason: "startup" }, ctxP);
    const res = await pi.callTool({ goal: "print mode", questions: QUESTIONS }, ctxP);
    ok(res?.isError !== true, "print upsert succeeds");
    ok(pi.customCalls.length === 0, "no panel in print mode");
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
    ok(/sqlite/i.test(text) && /Which engine\?/.test(text), "digest shows options and prompts");
    ok(/\d+\./.test(text), "digest is numbered (relay-ready)");

    const epoch = (res as { details?: { state?: { epoch: number } } })?.details?.state?.epoch;
    const badEpoch = await pi.callTool({ answers: [{ id: "q1", value: "sqlite" }], epoch: (epoch ?? 1) + 40 }, ctxP, "bad");
    ok(badEpoch?.isError === true, "stale-epoch answers rejected (guard)");
    const rec = await pi.callTool({ answers: [
      { id: "q1", value: "sqlite" }, { id: "q2", value: "gcp" }, { id: "q3", value: "from chat" },
    ], epoch }, ctxP, "up2");
    ok(rec?.isError !== true, "answers[] recorded (epoch-guarded)");
    pi.emitCore("agent_settled", {}, ctxP);
    await settle();
    ok(pi.completions().length === 1, "completion injected after record + settle (AC-11)");
    ok(/from chat/.test(String(pi.completions()[0]?.msg?.content ?? "")), "completion carries the chat answer");
  } catch (e) { failures++; console.log(`  FAIL J7 crashed: ${e}`); }

  // ------------------ J8: staleness guards + BUG-005 fresh-receiver epoch
  console.log("J8: stale rev/epoch rejected with current state; re-apply heals; fresh-receiver epoch accepted (BUG-005); rotation guard intact");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "guards", questions: [QUESTIONS[0]] }, ctx);
    const st = ser();
    const epoch = st.epoch;

    const staleRev = await pi.callTool({ epoch, questions: [{ ...QUESTIONS[0], rev: 99 }] }, ctx, "g2");
    ok(staleRev?.isError === true, "stale rev rejected");
    ok(/STALE/i.test((staleRev?.content ?? []).map((c) => c.text ?? "").join(" ")), "rejection says STALE");

    const staleEpoch = await pi.callTool({ epoch: epoch + 50, questions: [{ ...QUESTIONS[0], rev: 1, description: "x".repeat(220) }] }, ctx, "g2b");
    ok(staleEpoch?.isError === true, "stale epoch rejected");

    const fresh = await pi.callTool({ epoch, questions: [{ ...QUESTIONS[0], rev: 1, description: "expanded description for the deep view contract, deliberately longer than the floor so no lint warning fires here." }] }, ctx, "g3");
    ok(fresh?.isError !== true, "re-apply with current rev + epoch heals");

    // BUG-005: complete, then first upsert of the NEW interrogation with an
    // honest echoed epoch is accepted (fresh receiver, all-new ids).
    await pi.invokeCommand("debug submit q1=sqlite", pi.ctx("tui"));
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(ser().completed === true, "guards interrogation completed");
    const epochAfter = ser().epoch;
    const echo = await pi.callTool({ goal: "new wave", epoch: epochAfter, questions: [
      { id: "n1", prompt: "New?", type: "choice", options: [{ value: "u", label: "U", ramification: RAM }, { value: "v", label: "V", ramification: RAM }] },
    ] }, ctx, "g5");
    ok(echo?.isError !== true, "BUG-005: fresh receiver accepts the honest echoed epoch (no spurious STALE)");
    ok(ser().epoch === 1 && ser().goal === "new wave", "new interrogation swapped in fresh (epoch 1)");

    // rotation guard still enforced on a LIVE non-empty state: epoch-only
    // mismatch with only new ids stays STALE (guards.test.ts contract).
    const rot = await pi.callTool({ epoch: 42, questions: [
      { id: "m1", prompt: "M?", type: "choice", options: [{ value: "u", label: "U", ramification: RAM }] },
    ] }, ctx, "g8");
    ok(rot?.isError === true && /STALE/.test((rot?.content ?? []).map((c) => c.text ?? "").join(" ")), "rotation guard: epoch-only mismatch with only new ids on non-empty state stays STALE");
  } catch (e) { failures++; console.log(`  FAIL J8 crashed: ${e}`); }

  // ---------------------------- J9: SURFACE-001 matrix + phantom inertness
  console.log("J9: reads never surface in ANY state; description-only edit no surface; re-ask reopens; forged bridge inert; dead-state notify");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "matrix", questions: [
      { id: "m1", prompt: "One?", type: "choice", options: [{ value: "p", label: "P", ramification: RAM }, { value: "q", label: "Q", ramification: RAM }] },
      { id: "m2", prompt: "Two?", type: "choice", options: [{ value: "r", label: "R", ramification: RAM }, { value: "s", label: "S", ramification: RAM }] },
    ] }, ctx);
    ok(pi.customCalls.length === 1, "initial upsert opens the panel");
    pi.customCalls[0].done(null); // suspend
    await settle();

    await pi.callTool({}, ctx);
    ok(pi.customCalls.length === 1, "read {} with open questions: panel stays closed");

    const st = ser();
    stateMod.getState()!.applyAnswer("m1", { value: "p", at: new Date().toISOString() });
    stateMod.getState()!.applyAnswer("m2", { value: "s", at: new Date().toISOString() });
    await pi.callTool({}, ctx);
    ok(pi.customCalls.length === 1, "read {} with all answered: panel stays closed");

    await pi.callTool({ epoch: st.epoch, questions: [{ id: "m1", rev: 1, prompt: "One?", type: "choice", options: [{ value: "p", label: "P", ramification: RAM }, { value: "q", label: "Q", ramification: RAM }], description: "a longer description that only edits display text and leaves the options identical so nothing reopens" }] }, ctx);
    ok(pi.customCalls.length === 1, "description-only edit over answered set: no surface");

    await pi.callTool({ epoch: ser().epoch, questions: [{ id: "m2", rev: 1, prompt: "Two?", type: "choice", options: [{ value: "r", label: "R", ramification: RAM }, { value: "t", label: "T", ramification: RAM }] }] }, ctx);
    ok(pi.customCalls.length === 2, "upsert leaving unanswered questions reopens the panel (SURFACE-001 allow-list)");
    ok(q("m2")?.status === "reasked", "changed options reset + re-asked marker");
    pi.customCalls[1].done(null);
    await settle();

    await pi.callTool({ reopen: true }, ctx);
    ok(pi.customCalls.length === 3, "{reopen:true} resurfaces the panel");
    pi.customCalls[2].done(null);
    await settle();

    const before = pi.messages.length;
    pi.bus.emit("@eko24ive/pi-ask:submit", { version: 1, requestId: "r", flowId: "itg:xyz", response: { kind: "answer", mode: "submit", answers: { m1: { values: ["hacked"] } } } });
    await settle();
    ok(pi.messages.length === before, "forged bridge submit produces no message");
    ok(q("m1")?.answer?.value === "p", "forged bridge submit changed no state");

    await pi.invokeCommand("debug submit m1=p,m2=t", pi.ctx("tui"));
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(pi.completions().length === 1, "completion injected once");
    await pi.callTool({}, ctx);
    ok(pi.customCalls.length === 3, "read {} after completion: panel stays closed");
    await pi.invokeCommand("", pi.ctx("tui"));
    ok(pi.customCalls.length === 3, "/interrogate on dead state opens nothing");
    ok(pi.notifies.some((n) => /No active interrogation/i.test(n.text)), "empty-state notify shown for /interrogate on dead state");
  } catch (e) { failures++; console.log(`  FAIL J9 crashed: ${e}`); }

  // =====================================================================
  // Direct panel probes (real InterrogationPanel + real state, factory-free)
  // =====================================================================
  const panelMod = (await import(ROOT + "/src/panel/panel.js")) as {
    InterrogationPanel: new (args: unknown) => {
      handleInput(d: string): boolean;
      cursorIndex: number;
      currentId: string | undefined;
      confirmMode: { kind: string; questionId: string } | null;
      gateWarning: { count: number; kind: string } | null;
      footerFlash: { text: string } | undefined;
      textDuty: string;
      focus: string;
      view: string;
      textField: { getText(): string; setText(t: string): void };
      draftTextFor(id: string): string | undefined;
      isResolved(): boolean;
      flash(t: string): void;
    };
  };
  const deepMod = (await import(ROOT + "/src/panel/deep-view.js")) as {
    buildDeepContent: (i: unknown) => { questionLines: string[]; lines: string[]; sectionHeaderLineIndex: number[]; viewportHeight: number };
    renderDeepWindow: (c: unknown, cursor: number, offset: number, theme: unknown, width: number) => string[];
    acceptFromDeep: (p: unknown) => boolean;
    DEEP_VIEW_HEIGHT: number;
    MIN_OPTIONS_VIEWPORT: number;
  };
  const shortMod = (await import(ROOT + "/src/panel/short-view.js")) as {
    displayOptions: (q: unknown) => Array<{ value: string; label: string }>;
    renderShortViewOptions: (i: unknown) => string[];
  };
  const overviewMod = (await import(ROOT + "/src/panel/overview.js")) as {
    buildOverviewContent: (i: unknown) => { lines: string[] };
  };
  const layoutMod = (await import(ROOT + "/src/panel/layout.js")) as {
    statusMarkers: (q: unknown, theme: unknown) => string;
  };
  const depMod = (await import(ROOT + "/src/depends-on.js")) as {
    evaluateDependsOn: (s: unknown) => { mootered: Array<{ id: string; reason: string }> };
  };
  const deliveryMod = (await import(ROOT + "/src/delivery.js")) as {
    buildCompletion: (s: unknown, notes?: string[]) => { msg: { content: string } };
  };
  const stateNs = (await import(ROOT + "/src/state.js")) as {
    createInterrogationState: (goal?: string) => {
      goal: string;
      serialize(): { goal: string; epoch: number; completed: boolean; questions: Record<string, { id: string; status: string; rev: number; mootReason?: string; answer?: { value?: string; custom?: boolean; at?: string } }> };
      orderedQuestions(): Array<{ id: string; status: string; rev: number; mootReason?: string; answer?: { value?: string; custom?: boolean; at?: string } }>;
      upsertQuestion(q: unknown): void;
      setStatus(id: string, s: string): void;
      applyAnswer(id: string, a: { value: string; at: string; custom?: boolean }): void;
    };
    resetState(): void;
  };
  const configMod = (await import(ROOT + "/src/config.js")) as { DEFAULT_CONFIG: unknown };

  const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s };
  const OPTS = [
    { value: "a", label: "Alpha", ramification: RAM },
    { value: "b", label: "Beta", ramification: RAM },
  ];
  function mkQ(id: string, o: Partial<{ recommendation: string; dependsOn: unknown }> = {}) {
    return {
      id, prompt: `p:${id}`, type: "choice", rev: 1, status: "open",
      options: OPTS.map((x) => ({ ...x })),
      ...(o.dependsOn ? { dependsOn: o.dependsOn } : {}),
      ...(o.recommendation ? { recommendation: o.recommendation } : {}),
    };
  }
  /** Seed a question with status + answer: upsert forces open on new ids, so
   * applyAnswer + setStatus land the desired terminal/hybrid state. */
  function seed(s: ReturnType<typeof stateNs.createInterrogationState>, id: string, status: string, answer?: { value: string; custom?: boolean }) {
    s.upsertQuestion(mkQ(id));
    if (answer) s.applyAnswer(id, { value: answer.value, at: new Date().toISOString(), custom: answer.custom });
    if (status !== "answered") s.setStatus(id, status);
  }
  function mkPanel(state: unknown, extra: Record<string, unknown> = {}) {
    const messages: unknown[] = [];
    const deps = {
      sendMessage: (m: unknown) => messages.push(m),
      isIdle: () => true,
      noteSubmissionDelivered: () => {},
    };
    const panel = new panelMod.InterrogationPanel({
      tui: { requestRender: () => {} },
      theme: stubTheme,
      done: () => {},
      state,
      config: configMod.DEFAULT_CONFIG,
      editorFactory: () => fakeEditor(),
      delivery: deps,
      ...extra,
    });
    return { panel, messages, deps };
  }

  // ------------------- J10: BUG-003 closed-edit ripple on the seams
  console.log("J10: BUG-003 closed-edit ripple — option, digit, write-in seams; same-value inert");
  try {
    stateNs.resetState();
    // Seed: c1 closed with recorded answer b; v1 answered pending dependsOn c1=b
    const s = stateNs.createInterrogationState("closed edits");
    seed(s, "c1", "closed", { value: "b" });
    s.upsertQuestion({ ...mkQ("v1"), dependsOn: [{ id: "c1", equals: "b" }] });
    s.applyAnswer("v1", { value: "keep", custom: true, at: new Date().toISOString() });
    depMod.evaluateDependsOn(s);
    ok(s.orderedQuestions().find((x) => x.id === "v1")?.status === "answered", "dependent v1 answered while its dependency holds");

    // (1) option path: move to a (different) + enter -> confirm
    const { panel } = mkPanel(s);
    panel.currentId = "c1";
    ok(panel.cursorIndex === 1, "closed question caret pins to recorded b (row 1)");
    panel.handleInput(UP); // to row 0 = a (different)
    panel.handleInput(ENTER);
    ok(panel.confirmMode?.kind === "choice", "option-path different-value edit of CLOSED question raises FR-18 confirm (BUG-003)");
    panel.handleInput(ESC); // cancel
    ok(s.orderedQuestions().find((x) => x.id === "c1")?.answer?.value === "b", "esc cancels with no state change");
    ok(s.orderedQuestions().find((x) => x.id === "v1")?.status === "answered", "dependent untouched after cancel");
    panel.handleInput(UP); panel.handleInput(ENTER); // re-raise + apply
    panel.handleInput(ENTER);
    const c1a = s.orderedQuestions().find((x) => x.id === "c1");
    const v1a = s.orderedQuestions().find((x) => x.id === "v1");
    ok(c1a?.answer?.value === "a" && (c1a?.status === "answered" || c1a?.status === "submitted"), "enter applies the closed edit (re-pends; review-flow exit may ship it)");
    ok(v1a?.status === "moot", "applied edit moots the invalidated dependent (with confirm, not silently)");

    // (2) digit path
    stateNs.resetState();
    const s2 = stateNs.createInterrogationState("digit seam");
    seed(s2, "c1", "closed", { value: "b" });
    s2.upsertQuestion({ ...mkQ("v1"), dependsOn: [{ id: "c1", equals: "b" }] });
    s2.applyAnswer("v1", { value: "keep", custom: true, at: new Date().toISOString() });
    depMod.evaluateDependsOn(s2);
    const p2 = mkPanel(s2).panel;
    p2.currentId = "c1";
    p2.handleInput("1"); // digit 1 = display row 0 = a (different value)
    ok(p2.confirmMode?.kind === "choice", "digit-path different-value edit of CLOSED question raises the confirm (BUG-003)");
    p2.handleInput(ESC);
    ok(s2.orderedQuestions().find((x) => x.id === "c1")?.answer?.value === "b", "digit-path cancel restores");
    // same-value digit stays inert on closed
    p2.handleInput("2"); // display row 1 = b = recorded
    ok(p2.confirmMode === null, "same-value digit on CLOSED stays inert (no modal)");
    ok(s2.orderedQuestions().find((x) => x.id === "c1")?.status === "closed", "closed status untouched by same-value digit");

    // (3) write-in path: closed custom answer, different text -> writein confirm
    stateNs.resetState();
    const s3 = stateNs.createInterrogationState("writein seam");
    seed(s3, "c1", "closed", { value: "old words", custom: true });
    s3.upsertQuestion({ ...mkQ("v1"), dependsOn: [{ id: "c1", equals: "old words" }] });
    s3.applyAnswer("v1", { value: "keep", custom: true, at: new Date().toISOString() });
    depMod.evaluateDependsOn(s3);
    const p3 = mkPanel(s3).panel;
    p3.currentId = "c1";
    ok(p3.cursorIndex === 2, "closed write-in pins caret to the ✎ Other row");
    p3.handleInput(ENTER); // enter write-in duty
    p3.textField.setText("different words");
    p3.handleInput(ENTER); // different text -> confirm
    ok(p3.confirmMode?.kind === "writein", "write-in different-text edit of CLOSED question raises the confirm (BUG-003 editor path)");
    p3.handleInput(ESC);
    ok(s3.orderedQuestions().find((x) => x.id === "c1")?.answer?.value === "old words", "writein-path cancel restores");
    // byte-identical write-in on closed stays inert
    p3.handleInput(ENTER); // write-in duty again
    p3.textField.setText("old words");
    p3.handleInput(ENTER);
    ok(p3.confirmMode === null, "byte-identical write-in re-commit on CLOSED stays inert");
    ok(s3.orderedQuestions().find((x) => x.id === "c1")?.status === "closed", "closed status preserved");
  } catch (e) { failures++; console.log(`  FAIL J10 crashed: ${e}`); }

  // ------------------- J11: BUG-004 moot reason persistence + rendering
  console.log("J11: BUG-004 moot reason — persisted, rendered in short+overview, stripped in completion, cleared on reopen");
  try {
    stateNs.resetState();
    const s = stateNs.createInterrogationState("moot");
    s.upsertQuestion(mkQ("d1"));
    s.applyAnswer("d1", { value: "a", at: new Date().toISOString() });
    s.setStatus("d1", "answered");
    s.upsertQuestion({ ...mkQ("d2"), dependsOn: [{ id: "d1", equals: "b" }] });
    const res = depMod.evaluateDependsOn(s);
    ok(res.mootered.some((m) => m.id === "d2" && m.reason === "moot: d1=a"), "evaluator computes the h2.29 reason");
    const d2 = s.orderedQuestions().find((x) => x.id === "d2");
    ok(d2?.status === "moot" && d2?.mootReason === "moot: d1=a", "reason PERSISTED on Question.mootReason (BUG-004 Option A)");

    // short view renders it
    const shortLines = shortMod.renderShortViewOptions({
      question: d2, cursorIndex: 0, theme: stubTheme, width: 100, dimAll: true,
    });
    ok(shortLines.some((l: string) => l.includes("moot: d1=a")), "short view renders the real moot reason");

    // overview renders it
    const ov = overviewMod.buildOverviewContent({ ordered: s.orderedQuestions(), cursorIndex: 0, theme: stubTheme, width: 100 });
    ok(ov.lines.some((l: string) => l.includes("moot: d1=a")), "overview renders the real moot reason");
    ok(ov.lines.some((l: string) => l.includes("⊘")), "overview shows the ⊘ marker");

    // statusMarkers shows ⊘ moot
    ok(/⊘/.test(layoutMod.statusMarkers(d2, stubTheme)), "statusMarkers carries ⊘ for moot");

    // completion record strips the `moot: ` prefix (status renders it instead)
    const comp = deliveryMod.buildCompletion(s, []);
    ok(/d2 \(moot: d1=a\)/.test(comp.content), "completion record moot entry: `d2 (moot: d1=a)` — prefix stripped, not doubled");

    // reopen clears the reason
    s.upsertQuestion({ ...mkQ("d1"), status: "answered", answer: { value: "b", at: new Date().toISOString() } });
    depMod.evaluateDependsOn(s);
    const d2b = s.orderedQuestions().find((x) => x.id === "d2");
    ok(d2b?.status === "open" && d2b?.mootReason === undefined, "dependency re-met: moot reopens and the reason is cleared");
  } catch (e) { failures++; console.log(`  FAIL J11 crashed: ${e}`); }

  // ------------------- J12: DEEP-PIN-001 two-region deep pane
  console.log("J12: DEEP-PIN-001 — pinned question never scrolls; truncation; viewport floor; text full height; select-from-deep");
  try {
    stateNs.resetState();
    const s = stateNs.createInterrogationState("deep pin");
    const opts = Array.from({ length: 6 }, (_, i) => ({ value: `v${i}`, label: `Opt ${i}`, ramification: "Word ".repeat(30) + String(i) }));
    s.upsertQuestion({ id: "dp1", prompt: "Deep question?", type: "choice", rev: 1, status: "open",
      description: "DESCMARKER the description text explaining the question in full for a standalone reader.", options: opts, recommendation: "v0" });
    const dq = s.orderedQuestions().find((x) => x.id === "dp1");
    const content = deepMod.buildDeepContent({ question: dq, goal: "GOALMARKER the goal text", cursorIndex: 0, scrollOffset: 0, theme: stubTheme, width: 100, maxChars: 600 });
    ok(Array.isArray(content.questionLines) && content.questionLines.length > 0, "DeepContent carries a pinned questionLines region");
    ok(content.questionLines.some((l: string) => l.includes("DESCMARKER")), "pinned region carries the description");
    ok(content.questionLines.some((l: string) => l.includes("GOALMARKER")), "pinned region carries the goal");
    // scroll to the bottom: the question region must STILL render
    const maxOffset = Math.max(0, content.lines.length - content.viewportHeight);
    const bottom = deepMod.renderDeepWindow(content, 5, maxOffset, stubTheme, 100);
    ok(bottom.some((l: string) => l.includes("DESCMARKER")), "question region stays visible at max scroll (DEEP-PIN-001)");
    ok(content.viewportHeight >= deepMod.MIN_OPTIONS_VIEWPORT, "options viewport never shrinks below MIN_OPTIONS_VIEWPORT");
    ok(bottom.length <= deepMod.DEEP_VIEW_HEIGHT, "rendered window respects DEEP_VIEW_HEIGHT budget");

    // overflow: giant description truncates bottom-first with …, description > goal
    const s2 = stateNs.createInterrogationState("overflow");
    s2.upsertQuestion({ id: "big", prompt: "Big?", type: "choice", rev: 1, status: "open",
      description: "D".repeat(4000), options: opts, recommendation: "v0" });
    const bq = s2.orderedQuestions().find((x) => x.id === "big");
    const c2 = deepMod.buildDeepContent({ question: bq, goal: "G".repeat(4000), cursorIndex: 0, scrollOffset: 0, theme: stubTheme, width: 80, maxChars: 6000 });
    ok(c2.questionLines.length < 40, "giant question region is line-truncated");
    ok(c2.questionLines.some((l: string) => l.includes("…")), "truncation carries the dimmed … marker");
    ok(c2.questionLines.some((l: string) => l.includes("D")), "description keeps priority over the goal");
    ok(c2.viewportHeight >= deepMod.MIN_OPTIONS_VIEWPORT, "options floor holds even with a giant pinned region");

    // text question: no options region -> question may use the full pane
    const s3 = stateNs.createInterrogationState("text full");
    s3.upsertQuestion({ id: "t1", prompt: "Text?", type: "text", rev: 1, status: "open", description: "word ".repeat(600) });
    const tq = s3.orderedQuestions().find((x) => x.id === "t1");
    const c3 = deepMod.buildDeepContent({ question: tq, goal: "g", cursorIndex: 0, scrollOffset: 0, theme: stubTheme, width: 80, maxChars: 6000 });
    ok(c3.questionLines.length > deepMod.DEEP_VIEW_HEIGHT - deepMod.MIN_OPTIONS_VIEWPORT, "text question may use (nearly) the full pane height");

    // select-from-deep returns to short + advances
    stateNs.resetState();
    const s4 = stateNs.createInterrogationState("select deep");
    s4.upsertQuestion(mkQ("s1"));
    s4.upsertQuestion(mkQ("s2"));
    const { panel } = mkPanel(s4);
    panel.currentId = "s1";
    panel.handleInput(CTRL_D);
    ok(panel.view === "deep", "ctrl+d opens the deep view");
    deepMod.acceptFromDeep(panel);
    ok(panel.view === "short", "select from deep returns to the short form");
    ok(panel.currentId === "s2", "select from deep advances to the next unanswered");
    ok(s4.orderedQuestions().find((x) => x.id === "s1")?.answer?.value === "a", "deep selection answered s1");
  } catch (e) { failures++; console.log(`  FAIL J12 crashed: ${e}`); }

  // ------------------- J13: deep-view selection glyphs (amendment 9)
  console.log("J13: D-R14 amendment 9 — selected deep section carries ▸ + heavy ┃ pipes; unselected plain │");
  try {
    stateNs.resetState();
    const s = stateNs.createInterrogationState("glyphs");
    const opts = [
      { value: "one", label: "One", ramification: "First consequence prose line one." },
      { value: "two", label: "Two", ramification: "Second consequence prose line two." },
    ];
    s.upsertQuestion({ id: "g1", prompt: "Glyph?", type: "choice", rev: 1, status: "open", options: opts });
    const gq = s.orderedQuestions().find((x) => x.id === "g1");
    const content = deepMod.buildDeepContent({ question: gq, goal: "g", cursorIndex: 0, scrollOffset: 0, theme: stubTheme, width: 90, maxChars: 600 });
    const win = deepMod.renderDeepWindow(content, 0, 0, stubTheme, 90);
    const joined = win.join("\n");
    ok(/▸\s*One|▸ One/.test(joined), "selected section title carries the ▸ glyph");
    ok(joined.includes("┃"), "selected section pipes render heavy ┃");
    ok(joined.includes("│"), "unselected sections keep plain │ pipes");
    const win2 = deepMod.renderDeepWindow(content, 2, 0, stubTheme, 90); // cursor on ✎ Other
    const j2 = win2.join("\n");
    ok(/▸/.test(j2) && j2.includes("┃"), "✎ Other section gets the same selection glyphs when focused");
  } catch (e) { failures++; console.log(`  FAIL J13 crashed: ${e}`); }

  // ------------------- J14: D-R13 recommended-first display order
  console.log("J14: D-R13 — ★ renders first; digits follow display positions");
  try {
    stateNs.resetState();
    const s = stateNs.createInterrogationState("order");
    s.upsertQuestion(mkQ("o1", { recommendation: "b" })); // state order a,b — display becomes b,a
    const oq = s.orderedQuestions().find((x) => x.id === "o1");
    const disp = shortMod.displayOptions(oq);
    ok(disp[0]?.value === "b", "recommended option renders first (display-only reorder)");
    ok(disp[1]?.value === "a", "the rest keep state order");
    const { panel } = mkPanel(s);
    panel.currentId = "o1";
    ok(panel.cursorIndex === 0, "★ preselect sits on display row 0 while unanswered");
    panel.handleInput("1"); // digit 1 = display row 0 = b (the recommendation)
    const o1 = s.orderedQuestions().find((x) => x.id === "o1");
    ok(o1?.answer?.value === "b", "digit 1 maps through DISPLAY order (accepts the ★ option)");
    panel.handleInput(LEFT);
    ok(panel.cursorIndex === 0, "answered question: caret pins to the recorded (★) row 0");
  } catch (e) { failures++; console.log(`  FAIL J14 crashed: ${e}`); }

  // --------------- J15: ISSUE-1 repro — severed noteSubmissionDelivered hook
  console.log("J15: ISSUE-1 — session_start on an empty branch severs the delivery hook; same-run re-ask + re-confirm wedges completion");
  try {
    await cleanup();
    const idleRef = { v: true };
    const pi = await freshPi();
    const ctx = pi.makeCtx("tui", [], idleRef);
    pi.emitCore("session_start", { reason: "startup" }, ctx); // normal startup, empty branch
    await pi.callTool({ goal: "wedge", questions: [
      { id: "q1", prompt: "Which?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      { id: "q2", prompt: "Cloud?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;
    const hook = typeof panel.delivery?.noteSubmissionDelivered;
    ok(hook === "function", `panel submit deps carry noteSubmissionDelivered after a normal startup (got ${hook})`);

    // Same-run interleave (steer): answer both mid-run, model re-asks q1,
    // user re-confirms q1 — all before the single agent_settled.
    idleRef.v = false;
    panel.handleInput("1"); await settle();
    panel.handleInput("1"); await settle(); // transition -> submission #1 (steer)
    ok(pi.submissions().length === 1, "submission #1 delivered (steer branch)");
    const st = ser();
    await pi.callTool({ epoch: st.epoch, questions: [
      { id: "q1", rev: st.questions["q1"].rev, prompt: "Which (re-asked)?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
    ] }, ctx);
    await settle();
    ok(q("q1")?.status === "reasked", "mid-run rule-1 re-ask flips q1 to reasked");
    const rp = pi.customCalls[pi.customCalls.length - 1].component;
    if (rp.currentId !== "q1") rp.currentId = "q1";
    rp.handleInput(ENTER); await settle(); // same-value re-confirm -> submission #2 (steer)
    ok(pi.submissions().length === 2, "re-confirm submission #2 delivered (steer)");
    ok(q("q1")?.status === "submitted", "q1 re-confirmed and submitted");
    pi.emitCore("agent_settled", {}, ctx); await settle(); // the run that answers the steer
    const wedged = stateMod.getState()?.orderedQuestions().some((x) => x.status === "submitted") && pi.completions().length === 0;
    ok(!wedged, "the run's settle closes the re-confirmed question and completion fires (h2.44 line-1 contract)");
    if (wedged) console.log("  (ISSUE-1 reproduced: question wedged in `submitted`, completion never injected)");
  } catch (e) { failures++; console.log(`  FAIL J15 crashed: ${e}`); }

  // ------------------- J16: ISSUE-2 repro — reopen focus after rule-1 re-ask
  console.log("J16: ISSUE-2 — panel reopened by a rule-1 re-ask of a submitted question focuses ordered[0], not the re-asked question");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    await pi.callTool({ goal: "focus", questions: [
      { id: "q0", prompt: "q0?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      { id: "q1", prompt: "q1?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;
    panel.handleInput("1"); await settle();
    panel.handleInput("1"); await settle(); // both answered -> transition -> submission (statuses submitted)
    const st = ser();
    await pi.callTool({ epoch: st.epoch, questions: [
      { id: "q1", rev: st.questions["q1"].rev, prompt: "q1 (re-asked, same options)?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
    ] }, ctx);
    await settle();
    ok(q("q1")?.status === "reasked", "rule-1 re-ask of the submitted q1 flips it to reasked (answer kept)");
    ok(pi.customCalls.length >= 2, "the re-ask resurfaces the panel");
    const rp = pi.customCalls[pi.customCalls.length - 1].component;
    ok(rp.currentId === "q1", `reopened panel focuses the RE-ASKED question q1 (got ${rp.currentId})`);
  } catch (e) { failures++; console.log(`  FAIL J16 crashed: ${e}`); }

  // --------------- J17: ISSUE-3 repro — standing moot wedges completion
  console.log("J17: ISSUE-3 — a standing moot question blocks completion forever and cannot be withdrawn");
  try {
    await cleanup();
    const pi = await freshPi();
    const ctx = pi.ctx("tui");
    pi.emitCore("session_start", { reason: "startup" }, ctx);
    await pi.callTool({ goal: "moot wedge", questions: [
      { id: "q1", prompt: "Which?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      { id: "q2", prompt: "Depends?", type: "choice", dependsOn: [{ id: "q1", equals: "b" }], options: [{ value: "u", label: "U", ramification: RAM }, { value: "v", label: "V", ramification: RAM }] },
    ] }, ctx);
    const panel = pi.customCalls[0].component;
    panel.handleInput("1"); // q1 = a -> q2 moots -> transition ships q1 (moot does not block completeness)
    await settle();
    ok(q("q2")?.status === "moot", "dependent mooted with reason (FR-17)");
    ok(pi.submissions().length === 1, "transition shipped despite the moot");
    pi.emitCore("agent_settled", {}, ctx);
    await settle();
    ok(q("q1")?.status === "closed" && q("q2")?.status === "moot", "settle archives q1; q2 stays a standing moot");
    ok(pi.completions().length === 1 && ser().completed === true, "completion record injected once everything terminal resolves (FR-5)");
    if (pi.completions().length === 0) {
      console.log("  (ISSUE-3 reproduced: completion never fires while a moot stands)");
      // The agent's only prune tool must at least clear it — does it?
      const st = ser();
      const w = await pi.callTool({ epoch: st.epoch, questions: [
        { id: "q1", rev: st.questions["q1"].rev, prompt: "Which?", type: "choice", options: [{ value: "a", label: "A", ramification: RAM }, { value: "b", label: "B", ramification: RAM }] },
      ], withdrawOmitted: true }, ctx);
      ok(q("q2")?.status === "withdrawn" && w?.isError !== true, "withdrawOmitted clears the standing moot (escape hatch)");
      if (q("q2")?.status !== "withdrawn") console.log("  (ISSUE-3 compounded: withdrawOmitted leaves moot ids untouched — no agent-side escape hatch)");
    }
  } catch (e) { failures++; console.log(`  FAIL J17 crashed: ${e}`); }

  console.log(`\nE2E: ${checks - failures}/${checks} checks passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("DRIVER CRASH:", e); process.exit(2); });
DRIVER_EOF

E2E_STATUS=0
# Isolate the agent dir so the run is deterministic (defaults only; the real
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

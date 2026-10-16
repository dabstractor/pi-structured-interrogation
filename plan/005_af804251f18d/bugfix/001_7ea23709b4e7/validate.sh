#!/usr/bin/env bash
# ============================================================================
# validate.sh — pi-interrogator comprehensive validation
#
# Phases:
#   1. Lint            — eslint (npm run lint)
#   2. Type checking   — tsc --noEmit (npm run typecheck)
#   3. Unit testing    — vitest run (npm test)
#   4. Keymap conflicts — scripts/verify-keymap-conflicts.sh
#   5. Structural/spec conformance — registerShortcut ban, sidechat
#      isolation wall, stale-module sweep
#   6. Runtime E2E probes — REAL panel + REAL side-chat engine over fake
#      model ports, driven through the REAL key router. Two port shapes:
#      "thenable" (the shipped harness shape) and "stream" (the PRODUCTION
#      shape streamSimple actually returns — non-thenable). Probe classes:
#        - FIX-PIN probes (the 8 PRD bugfix regressions + core behavior):
#          MUST pass. A failure here is a regression (hard fail).
#        - DEFECT-* probes (open findings; fail while the defect exists):
#          reported as OPEN FINDINGS.
#   7. Live pi journeys — real `pi -p` one-shot probes (extension load,
#      lifecycle upsert→answers→completion-exactly-once, restart
#      exactly-once, fresh-after-completion, restart reconstruction).
#      Skipped gracefully when no model provider is usable.
#
# Usage: bash validate.sh [--skip-live]
# Exit code: 0 iff every gate passes AND zero open findings remain.
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
PASS_COUNT=0; FAIL_COUNT=0; SKIP_COUNT=0; FINDING_COUNT=0
declare -a FAILURES=(); declare -a FINDINGS=()

pass() { PASS_COUNT=$((PASS_COUNT+1)); printf "  %sPASS%s  %s\n" "$GREEN" "$RESET" "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES+=("$1"); printf "  %sFAIL%s  %s\n" "$RED" "$RESET" "$1"; }
skip() { SKIP_COUNT=$((SKIP_COUNT+1)); printf "  %sSKIP%s  %s\n" "$YELLOW" "$RESET" "$1"; }
finding() { FINDING_COUNT=$((FINDING_COUNT+1)); FINDINGS+=("$1"); printf "  %sFINDING%s  %s\n" "$YELLOW" "$RESET" "$1"; }
phase() { printf "\n%s== %s ==%s\n" "$BOLD" "$1" "$RESET"; }

completion_count() { node -e '
    const fs=require("fs"); let n=0;
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);
        if(e.type==="custom_message"&&e.customType==="interrogation-completion")n++;
      }catch{}
    } console.log(n);' "$1"; }
toolresult_texts() { node -e '
    const fs=require("fs"); const out=[];
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);
        if(e.type==="message"&&e.message&&e.message.role==="toolResult"&&e.message.toolName==="interrogate"){
          const c=e.message.content;
          out.push(typeof c==="string"?c:(Array.isArray(c)?c.map(b=>b&&b.text||"").join("\n"):""));
        }}catch{}
    } console.log(out.join("\x01"));' "$1"; }
last_toolresult() { node -e '
    const fs=require("fs"); let last="";
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);
        if(e.type==="message"&&e.message&&e.message.role==="toolResult"&&e.message.toolName==="interrogate"){
          const c=e.message.content;
          last=typeof c==="string"?c:(Array.isArray(c)?c.map(b=>b&&b.text||"").join("\n"):"");
        }}catch{}
    } console.log(last);' "$1"; }
newest_session() { ls -t "$1"/*.jsonl 2>/dev/null | head -1; }
pi_turn() { local dir="$1"; shift; local flags="$1"; shift
  mkdir -p "$dir"; timeout 240 pi -p --session-dir "$dir" -e "$ROOT/src/index.ts" $flags "$*" 2>&1; }

SKIP_LIVE=0
for arg in "$@"; do [ "$arg" = "--skip-live" ] && SKIP_LIVE=1; done

printf "%s\n" "${BOLD}╔══════════════════════════════════════════════════════════╗
║  pi-interrogator — comprehensive validation               ║
╚══════════════════════════════════════════════════════════╝${RESET}"

phase "Phase 1: Linting (eslint)"
if npm run lint >/tmp/itg-lint.log 2>&1; then pass "eslint clean (src scripts *.ts)";
else fail "eslint reported issues:"$'\n'"$(tail -30 /tmp/itg-lint.log)"; fi

phase "Phase 2: Type checking (tsc --noEmit)"
if npm run typecheck >/tmp/itg-tsc.log 2>&1; then pass "tsc --noEmit clean";
else fail "tsc reported errors:"$'\n'"$(tail -30 /tmp/itg-tsc.log)"; fi

phase "Phase 3: Unit / integration tests (vitest)"
if npm test >/tmp/itg-vitest.log 2>&1; then
  pass "vitest run: $(grep -E "Tests  [0-9]+ passed" /tmp/itg-vitest.log | tail -1 | tr -s ' ')"
else
  fail "vitest failures:"$'\n'"$(grep -E "FAIL|Tests  |Test Files  " /tmp/itg-vitest.log | tail -10)"
fi

phase "Phase 4: Keymap conflict re-verification"
if bash scripts/verify-keymap-conflicts.sh >/tmp/itg-keymap.log 2>&1 && grep -q "^PASS:" /tmp/itg-keymap.log; then
  pass "no default key collides with an avoided or extension-claimed key"
else
  fail "keymap conflict verification failed:"$'\n'"$(tail -20 /tmp/itg-keymap.log)"
fi

phase "Phase 5: Structural / spec conformance"
RS=$(grep -rn "registerShortcut(" src --include="*.ts" | grep -v "\.test\.ts" \
  | grep -vE "^\S+:\s*[0-9]*\s*[*//]|:\s*//" || true)
if [ -z "$RS" ]; then pass "no registerShortcut call in src/ (no global key claims)";
else fail "registerShortcut call found:"$'\n'"$RS"; fi
SIDECHAT_MODULES="src/panel/sidechat.ts src/panel/chat-view.ts src/panel/sidechat-engine.ts src/panel/sidechat-prompt.ts src/panel/branch-snapshot.ts"
BANNED_HITS=""
for m in $SIDECHAT_MODULES; do
  [ -e "$m" ] || { BANNED_HITS="$BANNED_HITS
missing module: $m"; continue; }
  hits=$(sed -e 's://.*$::' -e 's:/\*[^*]*\*/: :g' "$m" \
    | grep -nE '\b(sendMessage|sendUserMessage|setActiveTools|registerTool|setModel)\b' || true)
  [ -n "$hits" ] && BANNED_HITS="$BANNED_HITS
$m: $hits"
done
if [ -z "$BANNED_HITS" ]; then pass "SIDECHAT-005: all 5 side-chat modules clean of banned APIs";
else fail "SIDECHAT-005 banned-API hits:"$'\n'"$BANNED_HITS"; fi
if [ ! -e src/panel/discuss.ts ]; then pass "legacy discuss module stays deleted"; else fail "src/panel/discuss.ts resurrected"; fi

# ============================================================================
phase "Phase 6: Runtime E2E probes (real panel + engine, fake model ports)"
PROBE_DIR=$(mktemp -d /tmp/itg-e2e-validate-XXXXXX)
cat > "$PROBE_DIR/e2e.test.ts" <<'PROBE_EOF'
/**
 * E2E validation probes v2 — pi-interrogator.
 * Two port shapes:
 *  - STREAM (production shape): raw AssistantMessageEventStream, non-thenable
 *    — exactly what streamSimplePort returns in production.
 *  - THENABLE (test shape): doneStream(...).result() promise — what the
 *    shipped ac-sidechat harness uses.
 */
import type {
  ExtensionAPI,
  KeybindingsManager,
  Theme,
} from "/home/dustin/projects/pi-structured-interrogation/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts";
import type {
  EditorComponent,
  TUI,
} from "/home/dustin/projects/pi-structured-interrogation/node_modules/@earendil-works/pi-tui/dist/index.d.ts";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "/home/dustin/projects/pi-structured-interrogation/node_modules/@earendil-works/pi-ai/dist/index.js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from "vitest";
import { DEFAULT_CONFIG } from "/home/dustin/projects/pi-structured-interrogation/src/config.ts";
import { markAnswered } from "/home/dustin/projects/pi-structured-interrogation/src/merge.js";
import {
  createInterrogationState,
  getState,
  resetState,
  type InterrogationState,
  type Question,
} from "/home/dustin/projects/pi-structured-interrogation/src/state.js";
import { applyChatAnswer } from "/home/dustin/projects/pi-structured-interrogation/src/panel/actions.js";
import {
  createPanelHost,
  InterrogationPanel,
  settleInvalidatingPort,
  sidechatSettleObservation,
  type InterrogationPanelArgs,
  type PiUISurface,
} from "/home/dustin/projects/pi-structured-interrogation/src/panel/panel.js";
import {
  get as getSidechat,
  resetSidechatForTests,
  type SidechatRebindDeps,
} from "/home/dustin/projects/pi-structured-interrogation/src/panel/sidechat.js";
import {
  createSidechatEngine,
  type SidechatEngineDeps,
  type SidechatModelPort,
  type SidechatRegistryPort,
} from "/home/dustin/projects/pi-structured-interrogation/src/panel/sidechat-engine.js";
import { reconstructFromBranch } from "/home/dustin/projects/pi-structured-interrogation/src/reconstruct.js";

const ENTER = "\r";
const ESCAPE = "\u001b";
const DOWN = "\u001b[B";
const RIGHT = "\u001b[C";
const CHAT_KEY = "e";

const stubTheme = {
  fg: (_n: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;
const OPTS = [
  { value: "sqlite", label: "Sqlite" },
  { value: "postgres", label: "Postgres" },
];

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS.map((o) => ({ ...o })),
    ...overrides,
  };
}

function sideState(): InterrogationState {
  const state = createInterrogationState("E2E validation");
  for (const id of ["q1", "q2", "q3", "q4", "q5"])
    state.upsertQuestion(choiceQ(id));
  return state;
}

type Handler = (event: unknown, ctx: unknown) => void;

function makeMockLifecycle() {
  let cb: (() => void) | undefined;
  return {
    lifecycle: {
      onPanelDismiss: (registered: () => void) => {
        cb = registered;
      },
      dismissPanel: () => cb?.(),
    },
  };
}

function fakePanelEditor(): EditorComponent {
  let text = "";
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["e1", "e2", "e3"]),
    focused: false,
  } as unknown as EditorComponent;
}

function panelArgsFor(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
): InterrogationPanelArgs {
  return {
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    editorFactory: () => fakePanelEditor(),
    ...extra,
  };
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settleWait = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 15));

let seq = 0;
function fakeModel(provider: string, id: string): Model<Api> {
  seq += 1;
  return {
    id,
    name: `${provider}/${id} #${seq}`,
    api: "anthropic-messages",
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

function fakeRegistry(models: Model<Api>[]): SidechatRegistryPort {
  return {
    find: vi.fn((p, id) => models.find((m) => m.provider === p && m.id === id)),
    getAvailable: vi.fn(() => models),
  };
}

function assistantReply(
  text: string,
  usage?: { input: number; output: number; total: number },
): AssistantMessage {
  const u = usage ?? { input: 100, output: 50, total: 0.07 };
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "prov",
    model: "mdl-1",
    usage: {
      input: u.input,
      output: u.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: u.input + u.output,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: u.total,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Production-shaped stream: non-thenable AssistantMessageEventStream. */
function streamReply(
  text: string,
  usage?: { input: number; output: number; total: number },
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: "stop",
    message: assistantReply(text, usage),
  });
  stream.end();
  return stream;
}

/** Test-shaped thenable: the shipped harness's `.result()` promise. */
function thenableReply(
  text: string,
  usage?: { input: number; output: number; total: number },
): Promise<AssistantMessage> {
  return Promise.resolve(assistantReply(text, usage));
}

function gatedStream(signal?: AbortSignal): {
  stream: AssistantMessageEventStream;
  finishWith: (event: AssistantMessageEvent) => void;
} {
  const queue: AssistantMessageEvent[] = [];
  const waiters: Array<() => void> = [];
  let ended = false;
  const wake = (): void => {
    const w = waiters.shift();
    if (w !== undefined) w();
  };
  const stream = {
    async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
      // Real pi-ai streams terminate with error{reason:"aborted"} on abort.
      if (signal !== undefined) {
        void new Promise<void>((r) => {
          signal.addEventListener("abort", () => r(), { once: true });
        }).then(() => {
          if (ended) return;
          ended = true;
          queue.push({
            type: "error",
            reason: "aborted",
            error: assistantReply(""),
          });
          wake();
        });
      }
      while (true) {
        while (queue.length === 0 && !ended)
          await new Promise<void>((r) => waiters.push(r));
        if (queue.length > 0) {
          yield queue.shift() as AssistantMessageEvent;
          continue;
        }
        break;
      }
    },
  } as unknown as AssistantMessageEventStream;
  return {
    stream,
    finishWith: (event) => {
      queue.push(event);
      ended = true;
      wake();
    },
  };
}

/** Gated-port harness: `gate.finishWith(...)` resolves the LATEST stream,
 * wired to that call's abort signal (real pi-ai streams abort this way). */
function makeGatedHarness(
  opts: { focusQuestionId?: string; state?: InterrogationState } = {},
): {
  h: Harness;
  gate: { finishWith: (event: AssistantMessageEvent) => void };
} {
  const holder: { gate?: ReturnType<typeof gatedStream> } = {};
  const h = makeHarness({
    ...opts,
    gated: (sig) => {
      holder.gate = gatedStream(sig);
      return holder.gate.stream;
    },
  });
  return { h, gate: { finishWith: (e) => holder.gate?.finishWith(e) } };
}

function answerReply(value: string): string {
  return `I would go with ${value}.\n\n\`\`\`answer\n{"value": "${value}"}\n\`\`\``;
}

type PortShape = "stream" | "thenable";

interface Harness {
  state: InterrogationState;
  panel: InterrogationPanel;
  notify: Mock;
  flash: Mock;
  port: Mock;
  requestRender: Mock;
}

function makeHarness(
  opts: {
    state?: InterrogationState;
    shape?: PortShape;
    reply?: (call: number) => string;
    gated?: (signal?: AbortSignal) => AssistantMessageEventStream;
    focusQuestionId?: string;
  } = {},
): Harness {
  const state = opts.state ?? sideState();
  const notify = vi.fn();
  const rebindDeps: SidechatRebindDeps = {
    resolveModelSnapshot: () => ({ provider: "prov", modelId: "mdl-1" }),
    buildSystemPrompt: () => "SYS",
    buildBranchSnapshot: () => [] as never,
  };
  const panelRef: { current: InterrogationPanel | undefined } = {
    current: undefined,
  };
  let call = 0;
  const reply = opts.reply ?? (() => "ok");
  const lastSignal: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const portMock = vi.fn(
    (_m: unknown, _c: unknown, options: { signal: AbortSignal }) => {
      lastSignal.current = options.signal;
      if (opts.gated !== undefined) return opts.gated(options.signal);
      const text = reply(call++);
      return opts.shape === "thenable"
        ? thenableReply(text)
        : streamReply(text);
    },
  );
  const engine = createSidechatEngine({
    port: settleInvalidatingPort(portMock as unknown as SidechatModelPort, () =>
      sidechatSettleObservation(panelRef.current),
    ),
    registry: fakeRegistry([fakeModel("prov", "mdl-1")]),
    notify: vi.fn(),
    answerContext: (questionId) => {
      const q = state.getQuestion(questionId);
      return q !== undefined ? { question: q, autoApply: false } : undefined;
    },
    onAutoApply: (decision) => {
      if (panelRef.current !== undefined)
        applyChatAnswer(panelRef.current, decision);
    },
  } satisfies SidechatEngineDeps);
  const requestRender = vi.fn();
  const panel = new InterrogationPanel(
    panelArgsFor(state, {
      tui: { requestRender } as unknown as TUI,
      delivery: { sendMessage: vi.fn(), isIdle: () => true },
      focusQuestionId: opts.focusQuestionId,
      sidechatEngine: engine,
      chatRebindDeps: rebindDeps,
      sidechatNotify: notify,
    }),
  );
  panelRef.current = panel;
  const flash = vi.spyOn(
    panel as unknown as { flash: (m: string) => void },
    "flash",
  );
  return { state, panel, notify, flash, port: portMock, requestRender };
}

function openChat(panel: InterrogationPanel): void {
  expect(panel.handleInput(CHAT_KEY)).toBe(true);
}
function sendChat(panel: InterrogationPanel, text: string): void {
  panel.chatField.setText(text);
  panel.handleInput(ENTER);
}
/** esc ×2 (blur the chat box) — required while the input holds focus. */
function blurChatBox(panel: InterrogationPanel): void {
  panel.handleInput(ESCAPE);
  panel.handleInput(ESCAPE);
}
/** Leave the chat view entirely, from ANY focus state. */
function exitChatView(panel: InterrogationPanel): void {
  if (panel.focus === "chat") panel.blurChatInput();
  panel.handleInput(ESCAPE);
}

beforeEach(() => {
  resetState();
  resetSidechatForTests();
  createPanelHost(makeMockLifecycle().lifecycle);
});
afterEach(() => {
  resetSidechatForTests();
});

// ===========================================================================
// GROUP P — PRODUCTION port shape (non-thenable stream, like streamSimple)
// ===========================================================================
describe("P production stream shape", () => {
  test("DEFECT-N1a P1 settle must blur the chat input for the PRODUCTION stream port", async () => {
    const h = makeHarness({
      shape: "stream",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "thoughts?");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    // DESIRED: S1 blur must fire for the production port shape too
    expect(h.panel.focus).toBe("options");
  });

  test("P2 enter still applies (S2 empty-buffer belt covers production)", async () => {
    const h = makeHarness({
      shape: "stream",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "thoughts?");
    await settleWait();
    expect(h.panel.focus).toBe("chat");
    expect(h.panel.handleInput(ENTER)).toBe(true);
    expect(h.state.getQuestion("q3")?.answer?.value).toBe("sqlite");
    expect(getSidechat()).toBeUndefined();
  });

  test("DEFECT-N1b P3 esc must decline in production's default focused state", async () => {
    const h = makeHarness({
      shape: "stream",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "thoughts?");
    await settleWait();
    expect(h.panel.focus).toBe("chat"); // current production reality (S1 dead)
    h.panel.handleInput(ESCAPE); // the advertised "esc = no"
    // DESIRED: a single esc declines in the default focused state
    expect(getSidechat()?.pendingConfirm).toBeUndefined();
    expect(h.panel.view).toBe("chat");
  });

  test("DEFECT-N1c P4 settled reply + confirm row must repaint after settle (production stream)", async () => {
    const { h, gate } = makeGatedHarness({ focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "thoughts?");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    // The TUI paints the streaming state (the send's invalidate scheduled it):
    const mid = h.panel.render(100).join("\n");
    expect(mid).not.toContain("apply ★");
    // The reply converges:
    gate.finishWith({
      type: "done",
      reason: "stop",
      message: assistantReply(answerReply("sqlite")),
    });
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    // DESIRED: the settle invalidates, so the next render paints the row
    const after = h.panel.render(100).join("\n");
    expect(after).toContain("apply ★");
  });
});

// ===========================================================================
// GROUP A — PRD bugfix regressions on the TEST (thenable) port shape —
// the shape the shipped fix tests use; verifies the fixes AS DESIGNED.
// ===========================================================================
describe("A1 BUG-001 confirm-row gestures (thenable shape)", () => {
  test("A1a enter right after settle applies WITHOUT manual blur", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "thoughts?");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    expect(h.panel.focus).toBe("options"); // S1 blur fired
    expect(h.panel.handleInput(ENTER)).toBe(true);
    expect(h.state.getQuestion("q3")?.answer?.value).toBe("sqlite");
    expect(getSidechat()).toBeUndefined();
    expect(h.panel.view).not.toBe("chat");
  });

  test("A1b esc declines in the default (post-settle) state, chat stays open", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "thoughts?");
    await settleWait();
    expect(h.panel.focus).toBe("options");
    expect(h.panel.handleInput(ESCAPE)).toBe(true);
    expect(getSidechat()?.pendingConfirm).toBeUndefined();
    expect(h.panel.view).toBe("chat");
    expect(h.state.getQuestion("q3")?.status).toBe("open");
  });

  test("A1d single esc aborts a streaming reply while input focused", async () => {
    const { h, gate } = makeGatedHarness({ focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "hold this");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    expect(h.panel.focus).toBe("chat");
    expect(h.panel.handleInput(ESCAPE)).toBe(true);
    await settleWait();
    expect(getSidechat()?.streamState).toBe("idle");
    expect(getSidechat()?.messages.length).toBe(0);
    expect(h.panel.view).toBe("chat");
  });

  test("A1d2 single esc aborts from OPTIONS focus in chat view (escapeDescend rung)", async () => {
    const { h } = makeGatedHarness({ focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "hold this");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    h.panel.blurChatInput(); // user blurred while streaming (esc x2 would abort)
    expect(h.panel.focus).toBe("options");
    expect(h.panel.handleInput(ESCAPE)).toBe(true); // options-focus abort rung
    await settleWait();
    expect(getSidechat()?.streamState).toBe("idle");
    expect(h.panel.view).toBe("chat"); // abort stays in view
  });
});

describe("A2 BUG-002 chat survives unrelated mutations", () => {
  test("A2a answering a DIFFERENT question keeps the chat", async () => {
    const state = sideState();
    markAnswered(state, "q1", {
      value: "postgres",
      at: "2026-01-01T00:00:00.000Z",
    });
    const h = makeHarness({ state, shape: "thenable", focusQuestionId: "q1" });
    openChat(h.panel);
    sendChat(h.panel, "why postgres?");
    await settleWait();
    exitChatView(h.panel);
    expect(h.panel.view).not.toBe("chat");
    markAnswered(h.state, "q2", {
      value: "sqlite",
      at: "2026-01-02T00:00:00.000Z",
    });
    expect(getSidechat()?.questionId).toBe("q1");
    expect(h.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("chat closed"),
    );
  });

  test("A2b chat dies when ITS question transitions to answered", async () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q1" });
    openChat(h.panel);
    sendChat(h.panel, "hm");
    await settleWait();
    exitChatView(h.panel);
    markAnswered(h.state, "q1", {
      value: "sqlite",
      at: "2026-01-03T00:00:00.000Z",
    });
    expect(getSidechat()).toBeUndefined();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining("chat closed"),
    );
  });

  test("A2c re-ask then re-answer transitions correctly", async () => {
    const state = sideState();
    markAnswered(state, "q1", {
      value: "sqlite",
      at: "2026-01-01T00:00:00.000Z",
    });
    const h = makeHarness({ state, shape: "thenable", focusQuestionId: "q1" });
    openChat(h.panel);
    // agent re-asks q1 (status answered -> reasked)
    const q1 = state.getQuestion("q1") as Question;
    state.upsertQuestion({
      ...q1,
      status: "reasked",
      options: [
        ...OPTS.map((o) => ({ ...o })),
        { value: "mysql", label: "MySQL" },
      ],
    });
    expect(getSidechat()?.questionId).toBe("q1"); // survives the re-ask
    // re-answer closes it
    markAnswered(h.state, "q1", {
      value: "mysql",
      at: "2026-01-04T00:00:00.000Z",
    });
    expect(getSidechat()).toBeUndefined();
  });
});

describe("A3 BUG-003 no-op apply consumes and closes", () => {
  test("A3a same-value apply: row consumed, chat closed, notice fired", async () => {
    const state = sideState();
    markAnswered(state, "q3", {
      value: "sqlite",
      at: "2026-01-01T00:00:00.000Z",
    });
    const h = makeHarness({
      state,
      shape: "thenable",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "still sqlite?");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    expect(h.panel.handleInput(ENTER)).toBe(true);
    expect(h.state.getQuestion("q3")?.answer?.value).toBe("sqlite");
    expect(getSidechat()).toBeUndefined();
    expect(h.panel.view).not.toBe("chat");
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringMatching(/chat closed · \d+ in/),
    );
  });
});

describe("A4 BUG-004 overview e targets cursor row", () => {
  test("A4a cursor row, not the background question", () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q1" });
    expect(h.panel.handleInput("o")).toBe(true);
    h.panel.handleInput(DOWN);
    expect(h.panel.handleInput(CHAT_KEY)).toBe(true);
    expect(getSidechat()?.questionId).toBe("q2");
    expect(h.panel.view).toBe("chat");
  });

  test("A4b esc from that chat returns to the overview", async () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q1" });
    h.panel.handleInput("o");
    h.panel.handleInput(DOWN);
    openChat(h.panel);
    await settleWait();
    exitChatView(h.panel);
    expect(h.panel.view).toBe("overview");
  });
});

describe("A5 BUG-005 replace aborts the orphaned stream", () => {
  test("A5a replaced record's in-flight call is aborted", async () => {
    const controllers: AbortController[] = [];
    const h = makeHarness({
      gated: () => {
        const c = new AbortController();
        controllers.push(c);
        return gatedStream(c.signal).stream;
      },
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "streaming on q3");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    const oldController = getSidechat()?.abortController;
    h.panel.blurChatInput();
    h.panel.handleInput("o");
    h.panel.handleInput(DOWN);
    h.panel.handleInput(ENTER); // jump to q2's row question
    expect(h.panel.handleInput(CHAT_KEY)).toBe(true);
    expect(getSidechat()?.questionId).not.toBe("q3");
    await flush();
    const abortedSeen = oldController?.signal.aborted === true;
    console.log("A5a replaced record controller aborted:", abortedSeen);
    expect(abortedSeen).toBe(true); // BUG-005 fixed on the replace path
    expect(getSidechat()?.streamState).toBe("idle");
  });
});

describe("A6 BUG-006 refused send keeps the draft", () => {
  test("A6a enter mid-stream preserves text, flashes, sends after settle", async () => {
    const { h, gate } = makeGatedHarness({ focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "first");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    h.panel.chatField.setText("follow-up question");
    expect(h.panel.handleInput(ENTER)).toBe(true);
    expect(h.panel.chatField.getText()).toBe("follow-up question");
    expect(h.flash).toHaveBeenCalledWith("reply in flight — esc aborts");
    expect(getSidechat()?.messages.length).toBe(1);
    gate.finishWith({
      type: "done",
      reason: "stop",
      message: assistantReply("done text"),
    });
    await settleWait();
    expect(h.panel.handleInput(ENTER)).toBe(true);
    expect(h.panel.chatField.getText()).toBe("");
    await settleWait();
    expect(
      getSidechat()?.messages.filter((m) => m.role === "user").length,
    ).toBe(2);
  });
});

describe("A7 BUG-007 usage-close notices", () => {
  test("A7a replace via `e` on another question fires the notice", async () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "one");
    await settleWait();
    expect(getSidechat()?.usage.input).toBeGreaterThan(0);
    exitChatView(h.panel);
    h.panel.handleInput(RIGHT);
    expect(h.panel.handleInput(CHAT_KEY)).toBe(true);
    expect(getSidechat()?.questionId).toBe("q4");
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringMatching(/chat closed · \d+ in · \d+ out · \$\d/),
    );
  });

  test("A7b /clear fires the notice, resets, keeps the view", async () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "hello");
    await settleWait();
    sendChat(h.panel, "/clear");
    expect(getSidechat()?.messages.length).toBe(0);
    expect(getSidechat()?.usage.input).toBe(0);
    expect(h.panel.view).toBe("chat");
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringMatching(/chat closed · \d+ in · \d+ out/),
    );
  });

  test("A7c /clear mid-stream aborts + notifies zero usage", async () => {
    const { h, gate } = makeGatedHarness({ focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "streaming");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    sendChat(h.panel, "/clear");
    await settleWait();
    expect(getSidechat()?.streamState).toBe("idle");
    expect(getSidechat()?.messages.length).toBe(0);
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining("chat closed · 0 in · 0 out · $0.00"),
    );
  });
});

describe("A8 BUG-008 reconstruction pools all tool results", () => {
  function toolResultEntry(id: string, stateData: unknown) {
    return {
      type: "message",
      id,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult",
        toolCallId: "tc-" + id,
        toolName: "interrogate",
        content: [{ type: "text", text: "ok" }],
        details: { state: stateData },
        isError: false,
        timestamp: Date.now(),
      },
    } as never;
  }
  function mirrorEntry(id: string, stateData: unknown) {
    return {
      type: "custom",
      id,
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: "interrogation-state",
      data: { state: stateData, at: new Date().toISOString() },
    } as never;
  }
  function userTurn() {
    return {
      type: "message",
      id: "u" + Math.random(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: [{ type: "text", text: "hi" }],
        timestamp: Date.now(),
      },
    } as never;
  }
  function liveSerialized(qid?: string, epoch = 1, completed = false): unknown {
    const st = createInterrogationState("G");
    if (qid !== undefined) st.upsertQuestion(choiceQ(qid));
    const ser = st.serialize();
    return { ...ser, epoch, completed };
  }
  function run(branch: unknown[]) {
    return reconstructFromBranch(
      {
        mode: "tui",
        hasUI: true,
        sessionManager: { getBranch: () => branch },
        ui: { setWidget: vi.fn() },
      } as never,
      {
        host: { isOpen: () => false, suspend: () => {}, dispose: () => {} },
      } as never,
    );
  }
  test("A8a-hostile THROWING newest state degrades to older valid tool result (PRD case)", () => {
    const hostile = {
      get goal(): string {
        throw new Error("corrupt payload");
      },
    };
    const r = run([
      toolResultEntry("t1", liveSerialized("q1", 1)),
      userTurn(),
      toolResultEntry("t2", hostile),
    ]);
    expect(r.source).toBe("tool-result");
    expect(getState()?.getQuestion("q1")).toBeDefined();
  });

  test("DEFECT-N4 A8a-garbage plain-object newest state must not beat the older valid tool result", () => {
    const r = run([
      toolResultEntry("t1", liveSerialized("q1", 1)),
      userTurn(),
      toolResultEntry("t2", { garbage: true }),
    ]);
    // DESIRED: a non-state object must not beat the older VALID tool result
    expect(getState()?.getQuestion("q1")).toBeDefined();
  });

  test("A8b newer corrupt tool result degrades to older MIRROR", () => {
    const r = run([
      toolResultEntry("t1", liveSerialized("q1", 1)),
      mirrorEntry("m1", liveSerialized(undefined, 2)),
      toolResultEntry("t2", {
        get goal(): string {
          throw new Error("corrupt payload");
        },
      }),
    ]);
    expect(r.source).toBe("mirror-entry");
    expect(getState()?.getQuestion("q1")).toBeUndefined(); // mirror state governs
  });

  test("A8c all-valid: newest tool result wins (FR-27 last-wins)", () => {
    const r = run([
      toolResultEntry("t1", liveSerialized("q1", 1)),
      toolResultEntry("t2", liveSerialized("q2", 2)),
    ]);
    expect(r.source).toBe("tool-result");
    expect(getState()?.getQuestion("q2")).toBeDefined();
    expect(getState()?.getQuestion("q1")).toBeUndefined();
  });

  test("A8d completed mirror newer than tool result still wins (exactly-once base)", () => {
    const r = run([
      toolResultEntry("t1", liveSerialized("q1", 3)),
      mirrorEntry("m1", { ...liveSerialized(undefined, 3), completed: true }),
    ]);
    expect(r.source).toBe("mirror-entry");
  });
});

// ===========================================================================
// GROUP B — new-bug hunts (thenable shape unless noted)
// ===========================================================================
describe("B1 pendingConfirm gate vs other views", () => {
  async function settleConfirm(h: Harness) {
    openChat(h.panel);
    sendChat(h.panel, "which?");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    expect(h.panel.focus).toBe("options");
  }
  test("DEFECT-N2a B1a overview enter must NOT apply an invisible confirm", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("postgres"),
      focusQuestionId: "q3",
    });
    await settleConfirm(h);
    expect(h.panel.handleInput("o")).toBe(true);
    expect(h.panel.view).toBe("overview");
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    const before = h.state.getQuestion("q3")?.status;
    const consumed = h.panel.handleInput(ENTER);
    const applied = h.state.getQuestion("q3")?.answer?.value === "postgres";
    console.log(
      "B1a overview enter: consumed",
      consumed,
      "q3",
      before,
      "->",
      h.state.getQuestion("q3")?.status,
      "applied:",
      applied,
    );
    if (applied) {
      throw new Error(
        "B1a REPRODUCED: overview enter applied the INVISIBLE pending confirm",
      );
    }
  });
  test("DEFECT-N2b B1b deep-view enter must NOT apply an invisible confirm", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("postgres"),
      focusQuestionId: "q3",
    });
    await settleConfirm(h);
    expect(h.panel.handleInput("d")).toBe(true);
    expect(h.panel.view).toBe("deep");
    h.panel.handleInput(ENTER);
    const applied = h.state.getQuestion("q3")?.answer?.value === "postgres";
    console.log(
      "B1b deep enter applied invisible confirm:",
      applied,
      "view:",
      h.panel.view,
    );
    if (applied) {
      throw new Error(
        "B1b REPRODUCED: deep enter applied the invisible confirm",
      );
    }
  });
  test("DEFECT-N2c B1c esc in overview must not decline an invisible confirm", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("postgres"),
      focusQuestionId: "q3",
    });
    await settleConfirm(h);
    // leave WITHOUT deciding: o opens the overview (record retains the row)
    expect(h.panel.handleInput("o")).toBe(true);
    expect(getSidechat()?.pendingConfirm).toBeDefined(); // retained
    // esc in the OVERVIEW (intent: back to short view) — does it decline?
    h.panel.handleInput(ESCAPE);
    const declinedInvisible = getSidechat()?.pendingConfirm === undefined;
    // DESIRED: esc in the overview must NOT decline an invisible chat confirm
    expect(declinedInvisible).toBe(false);
    // then to short view, and an ordinary option-accept enter:
    while (h.panel.view !== "short") h.panel.handleInput(ESCAPE);
    const before = h.state.getQuestion("q3")?.status;
    h.panel.handleInput(ENTER); // user intends: accept the highlighted option (sqlite)
    const after = h.state.getQuestion("q3");
    console.log(
      "B1c short enter: q3",
      before,
      "->",
      after?.status,
      "value:",
      after?.answer?.value,
    );
  });
});

describe("B2 elaborate editor vs pending confirm", () => {
  test("B2a `t` + typed text + enter while a confirm is pending", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("postgres"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "which?");
    await settleWait();
    expect(h.panel.focus).toBe("options");
    const consumed = h.panel.handleInput("t");
    console.log(
      "B2a 't' consumed:",
      consumed,
      "focus:",
      h.panel.focus,
      "view:",
      h.panel.view,
    );
    if (h.panel.focus === "text") {
      h.panel.textField.setText("my elaboration");
      h.panel.handleInput(ENTER);
      const q3 = h.state.getQuestion("q3");
      console.log(
        "B2a after enter: q3 status",
        q3?.status,
        "value",
        q3?.answer?.value,
        "focus:",
        h.panel.focus,
      );
      if (q3?.answer?.value === "postgres") {
        throw new Error(
          "B2a REPRODUCED: elaboration enter applied the chat confirm instead of saving the draft",
        );
      }
    }
  });
});

describe("B3 settle-blur interrupts typing (thenable shape)", () => {
  test("DEFECT-N3a B3a mid-sentence keystroke must type, not open views", async () => {
    let resolveReply: ((m: AssistantMessage) => void) | undefined;
    const h = makeHarness({ shape: "thenable", reply: () => "x", focusQuestionId: "q3" });
    h.port.mockImplementation(
      () =>
        new Promise<AssistantMessage>((res) => {
          resolveReply = res;
        }),
    );
    openChat(h.panel);
    sendChat(h.panel, "pick one");
    await flush();
    expect(getSidechat()?.streamState).toBe("streaming");
    h.panel.chatField.setText("wait, what about ");
    resolveReply?.(assistantReply(answerReply("sqlite")));
    await settleWait();
    expect(h.panel.chatField.getText()).toBe("wait, what about ");
    console.log("B3a focus after settle:", h.panel.focus);
    if (h.panel.focus !== "chat") {
      const viewBefore = h.panel.view;
      const consumed = h.panel.handleInput("o");
      console.log("B3a 'o' keystroke: consumed:", consumed, "view:", viewBefore, "->", h.panel.view);
      if (h.panel.view !== viewBefore) {
        throw new Error(
          "B3a REPRODUCED: a typed letter opened another view mid-sentence (chat input not refocusable)",
        );
      }
    }
  });
});

describe("B4 misc", () => {
  test("B4a second no-block reply supersedes the pending confirm", async () => {
    let n = 0;
    const h = makeHarness({
      shape: "thenable",
      reply: () => (n++ === 0 ? answerReply("sqlite") : "no block this time"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "first");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    h.panel.focusChatInput();
    sendChat(h.panel, "second");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeUndefined();
    expect(getSidechat()?.lastRejection).toBe("no-block");
  });

  test("B4b non-empty buffer enter with pending confirm sends, keeps confirm", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "q");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    h.panel.focusChatInput();
    sendChat(h.panel, "tell me more");
    expect(h.state.getQuestion("q3")?.status).toBe("open");
    expect(getSidechat()?.pendingConfirm).toBeDefined();
  });

  test("B4c write-in text answer applies via the write-in seam", async () => {
    const state = sideState();
    state.upsertQuestion({
      ...choiceQ("q5"),
      type: "text",
      options: undefined,
    } as Partial<Question>);
    const h = makeHarness({
      state,
      shape: "thenable",
      reply: () => 'Sure.\n\n```answer\n{"text": "my own take"}\n```',
      focusQuestionId: "q5",
    });
    openChat(h.panel);
    sendChat(h.panel, "your take?");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    expect(h.panel.handleInput(ENTER)).toBe(true);
    expect(h.state.getQuestion("q5")?.answer?.value).toBe("my own take");
  });

  test("B4d chat on withdrawn question does not crash", () => {
    const state = sideState();
    state.upsertQuestion({
      ...choiceQ("q2"),
      status: "withdrawn",
    } as Partial<Question>);
    const h = makeHarness({ state, shape: "thenable", focusQuestionId: "q1" });
    h.panel.handleInput("o");
    h.panel.handleInput(DOWN);
    expect(() => h.panel.handleInput(CHAT_KEY)).not.toThrow();
    console.log(
      "B4d chat on withdrawn q2:",
      getSidechat()?.questionId,
      "view:",
      h.panel.view,
    );
  });

  test("B4e after /clear, own-question transition still discards; unrelated does not", async () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "hi");
    await settleWait();
    sendChat(h.panel, "/clear");
    expect(getSidechat()?.questionId).toBe("q3");
    markAnswered(h.state, "q1", {
      value: "sqlite",
      at: "2026-01-05T00:00:00.000Z",
    });
    expect(getSidechat()?.questionId).toBe("q3"); // unrelated survives
    markAnswered(h.state, "q3", {
      value: "sqlite",
      at: "2026-01-06T00:00:00.000Z",
    });
    expect(getSidechat()).toBeUndefined(); // own transition discards
  });

  test("DEFECT-N3b B4h keep-chatting after decline must be possible without exit+reopen", async () => {
    const h = makeHarness({
      shape: "thenable",
      reply: () => answerReply("sqlite"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "q");
    await settleWait();
    expect(h.panel.focus).toBe("options");
    h.panel.handleInput(ESCAPE); // decline ("esc = no" — keep chatting)
    expect(getSidechat()?.pendingConfirm).toBeUndefined();
    // The user starts typing a follow-up message:
    h.panel.handleInput("h"); // fixed ← alias from options focus?
    h.panel.handleInput("e"); // the chat key?
    h.panel.handleInput("x"); // unmatched?
    const buf = h.panel.chatField.getText();
    // DESIRED: after declining ("keep chatting"), the user can keep chatting —
    // some gesture must refocus the chat input and accept typed text.
    expect(h.panel.focus === "chat" || buf !== "").toBe(true);
  });

  test("B4f pendingConfirm + FR-18 different-value apply consumes the row", async () => {
    const state = sideState();
    markAnswered(state, "q3", {
      value: "sqlite",
      at: "2026-01-01T00:00:00.000Z",
    });
    state.upsertQuestion(
      choiceQ("q4", { dependsOn: [{ id: "q3", equals: "sqlite" }] }),
    );
    const h = makeHarness({
      state,
      shape: "thenable",
      reply: () => answerReply("postgres"),
      focusQuestionId: "q3",
    });
    openChat(h.panel);
    sendChat(h.panel, "switch?");
    await settleWait();
    expect(getSidechat()?.pendingConfirm).toBeDefined();
    expect(h.panel.handleInput(ENTER)).toBe(true);
    const confirmMode = (h.panel as unknown as { confirmMode: unknown })
      .confirmMode;
    console.log("B4f confirmMode after different-value apply:", confirmMode);
    const rec = getSidechat();
    if (rec !== undefined) {
      expect(rec.pendingConfirm).toBeUndefined(); // consumed even when deferred
    }
  });

  test("B4g suspend/resume keeps the chat (SIDECHAT-002 retention)", async () => {
    const h = makeHarness({ shape: "thenable", focusQuestionId: "q3" });
    openChat(h.panel);
    sendChat(h.panel, "hello");
    await settleWait();
    exitChatView(h.panel);
    // suspend + resume round-trip (panel rebuilt from lastOpts)
    h.panel.done(null);
    expect(getSidechat()?.questionId).toBe("q3"); // module memory survives
  });
});

PROBE_EOF

cd "$ROOT"
if OUT=$(timeout 300 npx vitest run --root "$PROBE_DIR" 2>&1); then
  pass "all runtime probes pass (0 open findings)"
else
  DEFECT_FAILS=$(echo "$OUT" | grep -E "^ *(×|FAIL).*(DEFECT-N)" | sed 's/^ *//' | sort -u)
  OTHER_FAILS=$(echo "$OUT" | grep -E "^ *(×|FAIL) " | grep -v "DEFECT-N" | sed 's/^ *//' | sort -u)
  NPASS=$(echo "$OUT" | grep -E "Tests  +" | tail -1)
  if [ -n "$DEFECT_FAILS" ]; then
    while IFS= read -r line; do [ -n "$line" ] && finding "$line"; done <<< "$DEFECT_FAILS"
  fi
  if [ -n "$OTHER_FAILS" ]; then
    while IFS= read -r line; do [ -n "$line" ] && fail "probe regression: $line"; done <<< "$OTHER_FAILS"
  fi
  printf "  probe tally: %s\n" "$NPASS"
  [ -z "$OTHER_FAILS" ] && pass "no regressions among FIX-PIN probes ($NPASS)"
fi
rm -rf "$PROBE_DIR"

# ============================================================================
phase "Phase 7: Live pi journeys (print mode, real model)"
E2E_DIR=$(mktemp -d /tmp/itg-live-validate-XXXXXX)
if [ "$SKIP_LIVE" -eq 1 ]; then
  skip "live journeys disabled via --skip-live"
elif ! timeout 120 pi -p --no-session "Reply with exactly: OK" >/tmp/itg-probe.log 2>&1 || ! grep -q "OK" /tmp/itg-probe.log; then
  skip "no usable model provider for live probes — see /tmp/itg-probe.log"
else
  pass "baseline model probe (default provider)"

  OUT=$(timeout 120 pi -p --no-session -e "$ROOT/src/index.ts" "Reply with exactly: OK" 2>&1)
  if echo "$OUT" | grep -q "OK" && ! echo "$OUT" | grep -qiE "^(Error|Cannot|extension.*fail)"; then
    pass "extension loads cleanly under installed pi 1.0.2 (jiti factory)"
  else fail "extension load probe produced errors: $(echo "$OUT" | head -5)"; fi

  D="$E2E_DIR/lifecycle"; mkdir -p "$D"
  pi_turn "$D" "" "Call the interrogate tool exactly once with goal 'E2E validation test' and exactly these two questions (send nothing else in the questions array): question 1: id 'q1', title 'Color', prompt 'Pick a color', type 'choice', options [value 'red' label 'Red', value 'blue' label 'Blue'], recommendation 'red'; question 2: id 'q2', title 'Note', prompt 'Any final note?', type 'text'. Then end your turn immediately without further tool calls." >/dev/null 2>&1
  S=$(newest_session "$D"); T=$(toolresult_texts "$S")
  if echo "$T" | grep -q "INTERROGATION — E2E validation test" && echo "$T" | grep -q "epoch 1"; then
    pass "upsert: numbered digest + epoch 1 (FR-25 fallback)"
  else fail "upsert digest/epoch 1 missing (session: $S)"; fi
  if grep -q '"customType":"interrogation-state"' "$S" 2>/dev/null; then
    pass "state mirror entries persisted (FR-27 layer 3)"
  else fail "no interrogation-state mirror entries in session file"; fi

  pi_turn "$D" "-c" "My answers: q1 = blue, q2 = 'ship it on Friday'. Record them now via the interrogate tool's answers parameter in one call, then end your turn." >/dev/null 2>&1
  S=$(newest_session "$D"); T=$(toolresult_texts "$S")
  if echo "$T" | grep -q "2/2 answered" && echo "$T" | grep -q "epoch 2"; then
    pass "answers[]: recorded, epoch bumped to 2 (non-TUI submission)"
  else fail "answers[]: 2/2 answered / epoch 2 not found in tool results"; fi
  N=$(completion_count "$S")
  if [ "$N" -eq 1 ]; then pass "completion record injected exactly once at close (FR-5)"
  else fail "expected exactly 1 interrogation-completion, found $N"; fi

  pi_turn "$D" "-c" "Just say 'hello' — no tool calls." >/dev/null 2>&1
  S=$(newest_session "$D"); N=$(completion_count "$S")
  if [ "$N" -eq 1 ]; then pass "restart + plain turn: still exactly 1 completion (exactly-once survives restart)"
  else fail "REPRODUCED duplicate completion injection: $N after restart + plain turn"; fi

  pi_turn "$D" "-c" "Call interrogate with a brand new question: id 'n1', title 'Fresh', prompt 'Start over?', type 'choice', options [value 'yes' label 'Yes', value 'no' label 'No']. Report the epoch shown in the tool result." >/dev/null 2>&1
  S=$(newest_session "$D"); LAST=$(last_toolresult "$S")
  if echo "$LAST" | head -1 | grep -q "0/1 answered" && echo "$LAST" | grep -q "epoch 1"; then
    pass "post-completion upsert started a fresh interrogation (0/1 answered, epoch 1)"
  else fail "post-restart upsert after completion did NOT start fresh"; fi

  D="$E2E_DIR/reconstruct"; mkdir -p "$D"
  pi_turn "$D" "" "Call the interrogate tool exactly once with goal 'Restart test' and exactly two questions: id 'r1', title 'Lang', prompt 'Which language?', type 'choice', options [value 'ts' label 'TypeScript', value 'py' label 'Python']; id 'r2', title 'Size', prompt 'Team size?', type 'text'. Then end your turn." >/dev/null 2>&1
  pi_turn "$D" "-c" "Record only one answer via the interrogate answers parameter: r1 = py. Do not answer r2. Then end your turn." >/dev/null 2>&1
  pi_turn "$D" "-c" "Call the interrogate tool with an empty object {} to read current state, then report exactly: the epoch number, and for each question its id and status. Nothing else." >/dev/null 2>&1
  S=$(newest_session "$D"); LAST=$(last_toolresult "$S")
  if echo "$LAST" | grep -q "1/2 answered" && echo "$LAST" | grep -q "epoch 2"; then
    pass "restart reconstruction: partial state restored (1/2 answered, epoch 2)"
  else fail "restart reconstruction missing 1/2 answered + epoch 2"; fi
fi
rm -rf "$E2E_DIR" 2>/dev/null || true

# ============================================================================
phase "Summary"
printf "  checks passed: %s%d%s   failed: %s%d%s   skipped: %s%d%s   open findings: %s%d%s\n" \
  "$GREEN" "$PASS_COUNT" "$RESET" "$RED" "$FAIL_COUNT" "$RESET" "$YELLOW" "$SKIP_COUNT" "$RESET" "$YELLOW" "$FINDING_COUNT" "$RESET"
if [ "$FINDING_COUNT" -gt 0 ]; then
  printf "\n  %sOpen findings (DEFECT-pinned probes — see validation_report.md):%s\n" "$YELLOW" "$RESET"
  for f in "${FINDINGS[@]}"; do printf "  - %s\n" "$(echo "$f" | head -2 | tr '\n' ' ')"; done
fi
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "\n  %sFailures:%s\n" "$RED" "$RESET"
  for f in "${FAILURES[@]}"; do printf "  - %s\n" "$(echo "$f" | head -3 | tr '\n' ' ')"; done
  exit 1
fi
if [ "$FINDING_COUNT" -gt 0 ]; then
  printf "\n  %sVALIDATION INCOMPLETE — %d open finding(s) remain (exit 1)%s\n" "$YELLOW" "$FINDING_COUNT" "$RESET"
  exit 1
fi
printf "\n  %sALL CHECKS PASSED — zero open findings%s\n" "$GREEN" "$RESET"
exit 0

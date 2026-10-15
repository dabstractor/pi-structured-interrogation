#!/usr/bin/env bash
# ============================================================================
# validate.sh — pi-interrogator comprehensive validation
#
# Phases (only those that exist in this codebase are included):
#   0. Environment sanity (node, deps)
#   1. Linting ........ none configured (no eslint/ruff/biome config in repo)
#   2. Type checking .. tsc --noEmit (tsconfig.json)
#   3. Style checking .. none configured (no prettier/editorconfig check)
#   4. Unit testing ... npm test (vitest run — full suite)
#   5. E2E validation .. real-user-workflow probes (generated at runtime into
#                        .ival-probes/, gitignored scratch, auto-removed):
#                        - WRITEIN-002 supersede re-bind journeys (BUG-001)
#                        - ctrl+g external-editor note duty (BUG-002)
#                        - no-caps verbatim storage through the tool (BUG-003)
#                        - baseline keymap-trilogy gates (hjkl/digits/two-tier)
#                        - cross-cutting: deep view, batch note, gate hold
#                        plus the repo's own gates:
#                        - scripts/verify-keymap-conflicts.sh (exit 0)
#                        - README grep gate (no ctrl+t|ctrl+d|ctrl+l|focusText|digit)
#                        - doc coherence greps (no stale 400-char cap claims)
#
# Exit code: 0 only if EVERY phase passes.
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=()
FAIL=()
section() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
ok()      { PASS+=("$1"); printf '\033[32m  PASS\033[0m %s\n' "$1"; }
bad()     { FAIL+=("$1"); printf '\033[31m  FAIL\033[0m %s\n' "$1"; }
run()     { # run <name> <command...>
  local name="$1"; shift
  if "$@" > /tmp/validate-out.log 2>&1; then ok "$name"
  else bad "$name"; tail -25 /tmp/validate-out.log; fi
}

# ---------------------------------------------------------------- Phase 0
section "Phase 0 — environment"
run "node >= 22" node -e 'const [m]=process.versions.node.split(".").map(Number);process.exit(m>=22?0:1)'
[ -d node_modules ] && ok "node_modules present" || bad "node_modules present (run npm install)"

# ---------------------------------------------------------------- Phase 2
section "Phase 2 — type checking (tsc --noEmit)"
run "tsc --noEmit" npx tsc --noEmit

# ---------------------------------------------------------------- Phase 4
section "Phase 4 — unit tests (vitest run)"
run "npm test (full suite)" npm test

# ---------------------------------------------------------------- Phase 5
section "Phase 5a — repo gates"
run "keymap conflict script exits 0" bash scripts/verify-keymap-conflicts.sh

if grep -qE "ctrl\+t|ctrl\+d|ctrl\+l|focusText|\bdigit\b" README.md; then
  bad "README grep gate (removed key names absent)"
else ok "README grep gate (removed key names absent)"; fi

if grep -qE "capped at 400|400-char" README.md; then
  bad "README carries no stale 400-char goal cap claim"
else ok "README carries no stale 400-char goal cap claim"; fi

if grep -q "400-char cap" src/state.ts; then
  bad "src/state.ts carries no stale 400-char cap comment"
else ok "src/state.ts carries no stale 400-char cap comment"; fi

# ------------------------------------------------- Phase 5b — E2E probes
section "Phase 5b — E2E real-user-workflow probes"

PROBE_DIR="$ROOT/.ival-probes"
mkdir -p "$PROBE_DIR"
cleanup() { rm -rf "$PROBE_DIR"; }
trap cleanup EXIT

cat > "$PROBE_DIR/vitest.probes.config.ts" <<'VITESTEOF'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".ival-probes/**/*.test.ts"],
    passWithNoTests: false,
  },
});
VITESTEOF

# ---- shared fixture header for probe files --------------------------------
read -r -d '' FIXTURES <<'FIXEOF' || true
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { vi, type Mock } from "vitest";

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];
FIXEOF

# ============================================================================
# Probe 1 — BUG-001: WRITEIN-002 supersede re-bind (13 journeys)
# ============================================================================
cat > "$PROBE_DIR/probe-writein-supersede.test.ts" <<'PROBEEOF'
/**
 * E2E probe — BUG-001 (WRITEIN-002 supersede re-bind) real-flow journeys.
 * Drives the REAL panel through REAL gestures (panel.handleInput raw keys).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.js";
import { DraftStore } from "../src/draft-store.js";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
} from "../src/state.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "../src/panel/panel.js";
import { submit, type SubmitDeps } from "../src/panel/actions.js";

const T0 = "2025-01-01T00:00:00.000Z";
const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
    ...overrides,
  };
}

function seed(specs: Array<{ id: string; overrides?: Partial<Question> }>): InterrogationState {
  const state = createInterrogationState("goal");
  for (const { id, overrides = {} } of specs) {
    state.upsertQuestion(choiceQ(id, overrides));
    const status = overrides.status ?? "open";
    if (status === "answered") {
      state.applyAnswer(id, { value: overrides.answer?.value ?? "a", at: T0 });
    } else if (status !== "open") {
      state.setStatus(id, status);
    }
  }
  return state;
}

function rig(state: InterrogationState, drafts?: DraftStore) {
  const sendMessage = vi.fn();
  const deps: SubmitDeps = { sendMessage, isIdle: () => true };
  const panel = new InterrogationPanel({
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts: drafts ?? new DraftStore(),
    delivery: deps,
  } as Partial<InterrogationPanelArgs>);
  return { panel, sendMessage, deps };
}

function typeWriteIn(panel: InterrogationPanel, text: string): void {
  expect(panel.handleInput("\r")).toBe(true);
  expect(panel.focus).toBe("text");
  panel.textField.setText(text);
  expect(panel.handleInput("\r")).toBe(true);
}

function acceptRow(panel: InterrogationPanel, row: number): void {
  panel.cursorIndex = row;
  expect(panel.handleInput("\r")).toBe(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("J1 — PRD repro: supersede then transition auto-submit keeps words", () => {
  test("test_j1_supersede_then_answer_q2_autosubmit_carries_elaboration", () => {
    const state = seed([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2" },
    ]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "my own words");
    expect(state.getQuestion("q1")?.answer).toMatchObject({ value: "my own words", custom: true });
    expect(panel.draftTextFor("q1")).toBeUndefined();
    expect(panel.currentId).toBe("q2");

    panel.currentId = "q1";
    expect(panel.cursorIndex).toBe(2);
    panel.handleInput("\u001b[A");
    panel.handleInput("\u001b[A");
    expect(panel.cursorIndex).toBe(0);
    expect(panel.handleInput("\r")).toBe(true);

    expect(state.getQuestion("q1")?.answer).toMatchObject({ value: "a" });
    expect(state.getQuestion("q1")?.answer?.custom).toBeUndefined();
    expect(panel.draftTextFor("q1")).toBe("my own words");
    expect(panel.currentId).toBe("q2");

    acceptRow(panel, 0);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — my own words");
    expect(msg.content).toContain("q2: Alpha");
    const a = state.getQuestion("q1")?.answer;
    expect(a?.text).toBe("my own words");
    expect(a?.custom).toBeUndefined();
  });
});

describe("J2 — complete-set edit (rule b): same-gesture auto-submit ships re-bind", () => {
  test("test_j2_last_answerable_edit_supersede_autosubmits_with_text", () => {
    const state = seed([
      { id: "q1", overrides: { status: "answered", answer: { value: "a", at: T0 } } },
      { id: "q2" },
    ]);
    state.applyAnswer("q2", { value: "flip take", custom: true, at: T0 });
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q2";
    expect(panel.cursorIndex).toBe(2);
    panel.handleInput("\u001b[A");
    panel.handleInput("\u001b[A");
    expect(panel.handleInput("\r")).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q2: Alpha — flip take");
    const a = state.getQuestion("q2")?.answer;
    expect(a?.value).toBe("a");
    expect(a?.text).toBe("flip take");
    expect(a?.custom).toBeUndefined();
    expect(state.epoch).toBe(2);
  });
});

describe("J3 — modal path (FR-18 victims>0): enter keeps, esc cancels", () => {
  test("test_j3a_modal_enter_applies_and_restages", () => {
    const state = seed([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2", overrides: { dependsOn: [{ id: "q1", equals: "a" }] } },
    ]);
    state.applyAnswer("q1", { value: "my way", custom: true, at: T0 });
    state.applyAnswer("q2", { value: "a", at: T0 });
    const { panel, sendMessage, deps } = rig(state);

    panel.currentId = "q1";
    expect(panel.cursorIndex).toBe(2);
    acceptRow(panel, 0);
    expect(panel.confirmMode).not.toBeNull();
    expect(panel.draftTextFor("q1")).toBeUndefined();

    expect(panel.handleInput("\r")).toBe(true);

    expect(panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(panel.draftTextFor("q1")).toBe("my way");

    expect(submit(panel, deps)).toBe(true);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — my way");
  });

  test("test_j3b_modal_esc_is_zero_state_change", () => {
    const state = seed([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2", overrides: { dependsOn: [{ id: "q1", equals: "a" }] } },
    ]);
    state.applyAnswer("q1", { value: "my way", custom: true, at: T0 });
    state.applyAnswer("q2", { value: "a", at: T0 });
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    acceptRow(panel, 0);
    expect(panel.confirmMode).not.toBeNull();

    expect(panel.handleInput("\u001b")).toBe(true);

    expect(panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer).toMatchObject({ value: "my way", custom: true });
    expect(panel.draftTextFor("q1")).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("J4 — user-held elaboration draft wins over the re-stage", () => {
  test("test_j4_user_draft_outranks_superseded_writein", () => {
    const state = seed([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2" },
    ]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "first words");
    expect(panel.currentId).toBe("q2");

    panel.currentId = "q1";
    panel.cursorIndex = 0;
    expect(panel.handleInput("t")).toBe(true);
    expect(panel.focus).toBe("text");
    panel.textField.setText("user override");
    expect(panel.handleInput("\r")).toBe(true);
    expect(panel.focus).toBe("options");
    expect(panel.draftTextFor("q1")).toBe("user override");

    acceptRow(panel, 0);
    expect(panel.draftTextFor("q1")).toBe("user override");

    panel.currentId = "q2";
    acceptRow(panel, 0);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — user override");
    expect(msg.content).not.toContain("first words");
  });
});

describe("J5 — deliberate delete-to-empty draft wins (stays empty)", () => {
  test("test_j5_emptied_slot_blocks_restage", () => {
    const state = seed([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2" },
    ]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "doomed words");
    panel.currentId = "q1";
    panel.cursorIndex = 0;
    expect(panel.handleInput("t")).toBe(true);
    panel.textField.setText("");
    expect(panel.handleInput("\r")).toBe(true);
    expect(panel.draftTextFor("q1")).toBe("");

    acceptRow(panel, 0);
    expect(panel.draftTextFor("q1")).toBe("");

    panel.currentId = "q2";
    acceptRow(panel, 0);

    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha");
    expect(msg.content).not.toContain("doomed words");
    expect(msg.content).not.toContain("Alpha —");
  });
});

describe("J6 — kind-flip (write-in text byte-equals option value) no-ops", () => {
  test("test_j6_no_elaboration_echo_when_text_equals_value", () => {
    const state = seed([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2" },
    ]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "a");
    panel.currentId = "q1";
    acceptRow(panel, 0);
    expect(panel.draftTextFor("q1")).toBeUndefined();

    panel.currentId = "q2";
    acceptRow(panel, 0);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha");
    expect(msg.content).not.toContain("Alpha — a");
  });
});

describe("J7 — closed (archived) supersede also re-binds", () => {
  test("test_j7_closed_custom_answer_supersede_restages", () => {
    const state = seed([{ id: "q1" }, { id: "q2" }]);
    state.applyAnswer("q1", { value: "archived words", custom: true, at: T0 });
    state.setStatus("q1", "closed");
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    acceptRow(panel, 0);

    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(panel.draftTextFor("q1")).toBe("archived words");

    panel.currentId = "q2";
    acceptRow(panel, 0);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — archived words");
  });
});

describe("J8 — reasked custom answer supersede re-binds", () => {
  test("test_j8_reasked_writein_supersede_restages", () => {
    const state = seed([{ id: "q1" }, { id: "q2" }]);
    state.applyAnswer("q1", { value: "kept words", custom: true, at: T0 });
    state.setStatus("q1", "reasked");
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    acceptRow(panel, 0);
    expect(panel.draftTextFor("q1")).toBe("kept words");

    panel.currentId = "q2";
    acceptRow(panel, 0);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — kept words");
  });
});

describe("J9 — write-in → write-in edit never re-stages the old words", () => {
  test("test_j9_custom_to_custom_supersede_no_restage", () => {
    const state = seed([{ id: "q1" }, { id: "q2" }]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "old words");
    panel.currentId = "q1";
    expect(panel.cursorIndex).toBe(2);
    typeWriteIn(panel, "new words");

    expect(state.getQuestion("q1")?.answer).toMatchObject({ value: "new words", custom: true });
    expect(panel.draftTextFor("q1")).toBeUndefined();

    panel.currentId = "q2";
    acceptRow(panel, 0);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("new words");
    expect(msg.content).not.toContain("old words");
  });
});

describe("J10 — VAL-002 consume-at-commit still holds (no regression)", () => {
  test("test_j10_plain_writein_commit_leaves_no_draft_anywhere", () => {
    const state = seed([{ id: "q1" }, { id: "q2" }]);
    const drafts = new DraftStore();
    const { panel } = rig(state, drafts);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "plain commit");
    expect(panel.draftTextFor("q1")).toBeUndefined();
    expect(drafts.getDraft("q1")).toBeUndefined();
  });
});

describe("J11 — submit ships the re-staged draft and exits the panel", () => {
  test("test_j11_rebound_draft_ships_store_drains_panel_suspends", () => {
    const state = seed([{ id: "q1" }, { id: "q2" }]);
    const drafts = new DraftStore();
    const done = vi.fn();
    const sendMessage = vi.fn();
    const panel = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done,
      state,
      config: DEFAULT_CONFIG,
      drafts,
      delivery: { sendMessage, isIdle: () => true },
    } as Partial<InterrogationPanelArgs>);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "one shot words");
    panel.currentId = "q1";
    acceptRow(panel, 0);
    expect(panel.draftTextFor("q1")).toBe("one shot words");

    panel.currentId = "q2";
    acceptRow(panel, 0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — one shot words");
    expect(drafts.getDraft("q1")).toBeUndefined();
    expect(done).toHaveBeenCalledWith(null);
    expect(panel.handleInput("\r")).toBe(false);
  });
});

describe("J12 — re-staged draft survives suspend (R4 durability)", () => {
  test("test_j12_suspend_keeps_rebound_draft_in_store", () => {
    const state = seed([{ id: "q1" }, { id: "q2" }]);
    const drafts = new DraftStore();
    const done = vi.fn();
    const sendMessage = vi.fn();
    const panel = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done,
      state,
      config: DEFAULT_CONFIG,
      drafts,
      delivery: { sendMessage, isIdle: () => true },
    } as Partial<InterrogationPanelArgs>);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "durable words");
    panel.currentId = "q1";
    acceptRow(panel, 0);
    expect(drafts.getDraft("q1")).toBe("durable words");

    panel.suspend();
    expect(done).toHaveBeenCalledWith(null);
    expect(drafts.getDraft("q1")).toBe("durable words");
  });
});
PROBEEOF

# ============================================================================
# Probe 2 — BUG-002: ctrl+g external editor in note duty (6 journeys)
# ============================================================================
cat > "$PROBE_DIR/probe-external-editor.test.ts" <<'PROBEEOF'
/**
 * E2E probe — BUG-002 (ctrl+g external editor in note duty). Mocks ONLY the
 * child-process module; the panel, key router, and note machinery are real.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "../src/config.js";
import { DraftStore } from "../src/draft-store.js";
import { createInterrogationState, type Question } from "../src/state.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "../src/panel/panel.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

vi.mock("../src/external-editor.js", () => ({
  editInExternalEditor: vi.fn(async () => ({ status: "failed" as const })),
  resolveExternalEditorCommand: vi.fn(() => "test-editor"),
}));

import { editInExternalEditor } from "../src/external-editor.js";
const editMock = editInExternalEditor as unknown as Mock;

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function makeState(): ReturnType<typeof createInterrogationState> {
  const state = createInterrogationState("goal");
  const q = (id: string): Question => ({
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
  });
  state.upsertQuestion(q("q1"));
  state.upsertQuestion(q("q2"));
  return state;
}

function rig(config: InterrogatorConfig = DEFAULT_CONFIG) {
  const drafts = new DraftStore();
  const done = vi.fn();
  const stop = vi.fn();
  const start = vi.fn();
  const panel = new InterrogationPanel({
    tui: { requestRender: vi.fn(), stop, start } as unknown as TUI,
    theme: stubTheme,
    done,
    state: makeState(),
    config,
    drafts,
    delivery: { sendMessage: vi.fn(), isIdle: () => true },
  } as Partial<InterrogationPanelArgs>);
  return { panel, drafts, done, stop, start };
}

const CTRL_G = "\u0007";

beforeEach(() => {
  editMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("E1 — ctrl+g in NOTE duty round-trips through $EDITOR", () => {
  test("test_e1_note_duty_opens_editor_and_routes_text_to_note", async () => {
    const { panel, drafts, stop, start } = rig();

    expect(panel.handleInput("m")).toBe(true);
    expect(panel.focus).toBe("note");
    panel.textField.setText("half-written note");

    editMock.mockResolvedValueOnce({ status: "complete", content: "edited note" });
    expect(panel.handleInput(CTRL_G)).toBe(true);

    await vi.waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const arg = editMock.mock.calls[0][0] as { command: string; content: string };
    expect(arg.command).toBe("test-editor");
    expect(arg.content).toBe("half-written note");
    expect(panel.batchNote).toBe("edited note");
    expect(drafts.getNote()).toBe("edited note");
    expect(panel.draftTextFor("q1")).toBeUndefined();
    expect(drafts.getDraft("q1")).toBeUndefined();
    expect(panel.focus).toBe("note");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("E2 — ctrl+g in QUESTION duty (write-in) still works", () => {
  test("test_e2_writein_duty_external_editor_routes_to_slot", async () => {
    const { panel, drafts } = rig();

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    expect(panel.handleInput("\r")).toBe(true);
    panel.textField.setText("half answer");

    editMock.mockResolvedValueOnce({ status: "complete", content: "full answer" });
    expect(panel.handleInput(CTRL_G)).toBe(true);

    await vi.waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const arg = editMock.mock.calls[0][0] as { content: string };
    expect(arg.content).toBe("half answer");
    expect(panel.draftTextFor("q1")).toBe("full answer");
    expect(drafts.getDraft("q1")).toBe("full answer");
    expect(panel.focus).toBe("text");
    expect(panel.textField.getText()).toBe("full answer");

    expect(panel.handleInput("\r")).toBe(true);
    expect(panel.state.getQuestion("q1")?.answer).toMatchObject({
      value: "full answer",
      custom: true,
    });
  });
});

describe("E3 — ctrl+g from OPTIONS focus stays free (no editor)", () => {
  test("test_e3_options_focus_ctrl_g_forwards", async () => {
    const { panel } = rig();
    expect(panel.focus).toBe("options");

    expect(panel.handleInput(CTRL_G)).toBe(false);
    await Promise.resolve();
    expect(editMock).not.toHaveBeenCalled();
  });
});

describe("E4 — failed editor round-trip leaves everything untouched", () => {
  test("test_e4_aborted_editor_no_mutation", async () => {
    const { panel, drafts } = rig();

    panel.handleInput("m");
    panel.textField.setText("precious note");

    editMock.mockResolvedValueOnce({ status: "failed" });
    expect(panel.handleInput(CTRL_G)).toBe(true);
    await vi.waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.batchNote).toBe("");
    expect(drafts.getNote() ?? "").toBe("");
    expect(panel.textField.getText()).toBe("precious note");
    expect(panel.focus).toBe("note");
  });
});

describe("E5 — bare remap of externalEditor types in editor focus (tier 2)", () => {
  test("test_e5_bare_remap_types_in_editor_never_intercepts", async () => {
    const config: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, externalEditor: "x" },
    };
    const { panel } = rig(config);

    panel.handleInput("m");
    expect(panel.handleInput("x")).toBe(true); // consumed BY THE EDITOR (typed)
    expect(panel.textField.getText()).toBe("x");
    expect(editMock).not.toHaveBeenCalled();

    panel.handleInput("\r");
    expect(panel.focus).toBe("options");
    expect(panel.handleInput("x")).toBe(false); // forwarded — no launch
    expect(editMock).not.toHaveBeenCalled();
  });
});

describe("E6 — chord remap of externalEditor intercepts in BOTH editor duties", () => {
  test("test_e6_chord_remapped_external_editor_note_duty", async () => {
    const config: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, externalEditor: "ctrl+e" },
    };
    const { panel } = rig(config);

    panel.handleInput("m");
    expect(panel.focus).toBe("note");
    panel.textField.setText("note via remap");

    editMock.mockResolvedValueOnce({ status: "complete", content: "done via remap" });
    expect(panel.handleInput("\u0005")).toBe(true);

    await vi.waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const arg = editMock.mock.calls[0][0] as { content: string };
    expect(arg.content).toBe("note via remap");
    expect(panel.batchNote).toBe("done via remap");
  });
});
PROBEEOF

# ============================================================================
# Probe 3 — BUG-003: no-caps verbatim storage through the real tool entry
# ============================================================================
cat > "$PROBE_DIR/probe-nocaps.test.ts" <<'PROBEEOF'
/**
 * E2E probe — BUG-003 (no-caps / verbatim storage) through the REAL tool
 * entry (executeInterrogate), plus doc-coherence greps.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { resetState, getState } from "../src/state.js";
import { executeInterrogate, type ExecutorContext } from "../src/tool.js";
import type { QuestionInput } from "../src/tool-schema.js";

function tuiCtx(): ExecutorContext {
  return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };
}

beforeEach(() => {
  resetState();
});

describe("N1 — 50,000-char goal round-trips verbatim", () => {
  test("test_n1_huge_goal_stored_byte_identical", () => {
    const goal = "G".repeat(50_000);
    executeInterrogate(
      { goal, questions: [{ id: "q1", prompt: "p", type: "text" }] },
      tuiCtx(),
    );
    expect(getState()?.goal).toBe(goal);
    const goal2 = "α".repeat(60_000);
    executeInterrogate(
      { goal: goal2, questions: [{ id: "q1", prompt: "p", type: "text", rev: 1 }], epoch: 1 },
      tuiCtx(),
    );
    expect(getState()?.goal).toBe(goal2);
  });
});

describe("N2 — long question text and many options verbatim", () => {
  test("test_n2_long_texts_and_wide_option_sets_pass_through", () => {
    const longPrompt = "P".repeat(8_000);
    const longDesc = "D".repeat(8_000);
    const options = Array.from({ length: 60 }, (_, i) => ({
      value: `v${i}`,
      label: `L${i}`,
      ramification: "x".repeat(500),
    }));
    const q: QuestionInput = {
      id: "q1",
      prompt: longPrompt,
      description: longDesc,
      type: "choice",
      options,
    };
    executeInterrogate({ goal: "g", questions: [q] }, tuiCtx());
    const stored = getState()?.getQuestion("q1");
    expect(stored?.prompt).toBe(longPrompt);
    expect(stored?.description).toBe(longDesc);
    expect(stored?.options?.length).toBe(60);
    expect(stored?.options?.[59]?.ramification).toBe("x".repeat(500));
  });
});

describe("N3 — no residual caps claims in docs or source", () => {
  test("test_n3_readme_and_state_ts_carry_no_400_char_claims", () => {
    const root = resolve(__dirname, "..");
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    expect(readme).not.toMatch(/capped at 400/);
    expect(readme).not.toMatch(/400-char/);
    const stateSrc = readFileSync(resolve(root, "src", "state.ts"), "utf8");
    expect(stateSrc).not.toMatch(/400-char cap/);
  });
});
PROBEEOF

# ============================================================================
# Probe 4 — baseline keymap-trilogy gates (6 probes)
# ============================================================================
cat > "$PROBE_DIR/probe-keymap-baseline.test.ts" <<'PROBEEOF'
/**
 * E2E probe — baseline P1 keymap gates: two-tier intercept classification
 * follows remaps, hjkl view-aware dispatch + editor typing, digits inert.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "../src/config.js";
import { createInterrogationState, type Question } from "../src/state.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "../src/panel/panel.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function makeState(): ReturnType<typeof createInterrogationState> {
  const state = createInterrogationState("goal");
  const q = (id: string): Question => ({
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
  });
  state.upsertQuestion(q("q1"));
  state.upsertQuestion(q("q2"));
  return state;
}

function rig(config: InterrogatorConfig = DEFAULT_CONFIG) {
  const panel = new InterrogationPanel({
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state: makeState(),
    config,
    delivery: { sendMessage: vi.fn(), isIdle: () => true },
  } as Partial<InterrogationPanelArgs>);
  return { panel };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("K1 — hjkl navigation from options focus, typing in editor focus", () => {
  test("test_k1_hl_navigate_and_type_in_editor", () => {
    const { panel } = rig();
    expect(panel.currentId).toBe("q1");
    expect(panel.handleInput("l")).toBe(true);
    expect(panel.currentId).toBe("q2");
    expect(panel.handleInput("h")).toBe(true);
    expect(panel.currentId).toBe("q1");

    panel.cursorIndex = 2;
    panel.handleInput("\r");
    expect(panel.focus).toBe("text");
    panel.textField.setText("");
    expect(panel.handleInput("h")).toBe(true);
    expect(panel.textField.getText()).toBe("h");
    expect(panel.handleInput("j")).toBe(true);
    expect(panel.textField.getText()).toBe("hj");
    expect(panel.handleInput("k")).toBe(true);
    expect(panel.textField.getText()).toBe("hjk");
    expect(panel.handleInput("l")).toBe(true);
    expect(panel.textField.getText()).toBe("hjkl");
    expect(panel.currentId).toBe("q1");
  });

  test("test_k1b_jk_move_option_cursor_from_options_focus", () => {
    const { panel } = rig();
    expect(panel.cursorIndex).toBe(0);
    expect(panel.handleInput("j")).toBe(true);
    expect(panel.cursorIndex).toBe(1);
    expect(panel.handleInput("k")).toBe(true);
    expect(panel.cursorIndex).toBe(0);
  });
});

describe("K2 — digits are inert at panel level", () => {
  test("test_k2_digit_forwards_and_answers_nothing", () => {
    const { panel } = rig();
    expect(panel.handleInput("3")).toBe(false);
    expect(panel.state.getQuestion("q1")?.answer).toBeUndefined();
    expect(panel.state.getQuestion("q2")?.answer).toBeUndefined();
  });
});

describe("K3 — bare remap of elaborate types in editor, acts in options", () => {
  test("test_k3_remap_follows_two_tier", () => {
    const config: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, elaborate: "x" },
    };
    const { panel } = rig(config);

    panel.cursorIndex = 0;
    expect(panel.handleInput("x")).toBe(true);
    expect(panel.focus).toBe("text");

    panel.textField.setText("");
    expect(panel.handleInput("x")).toBe(true);
    expect(panel.textField.getText()).toBe("x");
  });
});

describe("K4 — chord ctrl+s submits even while the editor holds focus", () => {
  test("test_k4_ctrl_s_tier1_from_editor", () => {
    const sendMessage = vi.fn();
    const panel = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state: makeState(),
      config: DEFAULT_CONFIG,
      delivery: { sendMessage, isIdle: () => true },
    } as Partial<InterrogationPanelArgs>);

    panel.cursorIndex = 0;
    panel.handleInput("\r");
    expect(panel.state.getQuestion("q1")?.status).toBe("answered");
    panel.cursorIndex = 2;
    panel.handleInput("\r");
    expect(panel.focus).toBe("text");

    expect(panel.handleInput("\u0013")).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("K5 — README keymap grep gate", () => {
  test("test_k5_readme_carries_no_removed_key_names", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const readme = readFileSync(resolve(__dirname, "..", "README.md"), "utf8");
    expect(readme).not.toMatch(/ctrl\+t/);
    expect(readme).not.toMatch(/ctrl\+d/);
    expect(readme).not.toMatch(/ctrl\+l/);
    expect(readme).not.toMatch(/focusText/);
    expect(readme).not.toMatch(/\bdigit\b/);
  });
});
PROBEEOF

# ============================================================================
# Probe 5 — cross-cutting: deep view, batch note, gate hold (3 journeys)
# ============================================================================
cat > "$PROBE_DIR/probe-crosscut.test.ts" <<'PROBEEOF'
/**
 * E2E probe — cross-cutting interactions around the BUG-001/002 fixes.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { DraftStore } from "../src/draft-store.js";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
} from "../src/state.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "../src/panel/panel.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const T0 = "2025-01-01T00:00:00.000Z";
const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function seed(specs: Array<{ id: string; overrides?: Partial<Question> }>): InterrogationState {
  const state = createInterrogationState("goal");
  for (const { id, overrides = {} } of specs) {
    state.upsertQuestion({
      id,
      prompt: `prompt:${id}`,
      type: "choice",
      rev: 1,
      status: "open",
      options: OPTS_AB.map((o) => ({ ...o })),
      ...overrides,
    });
    const status = overrides.status ?? "open";
    if (status === "answered") {
      state.applyAnswer(id, { value: overrides.answer?.value ?? "a", at: T0 });
    } else if (status !== "open") {
      state.setStatus(id, status);
    }
  }
  return state;
}

function rig(state: InterrogationState, drafts = new DraftStore()) {
  const sendMessage = vi.fn();
  const panel = new InterrogationPanel({
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts,
    delivery: { sendMessage, isIdle: () => true },
  } as Partial<InterrogationPanelArgs>);
  return { panel, sendMessage, drafts };
}

function typeWriteIn(panel: InterrogationPanel, text: string): void {
  expect(panel.handleInput("\r")).toBe(true);
  panel.textField.setText(text);
  expect(panel.handleInput("\r")).toBe(true);
}

function acceptRow(panel: InterrogationPanel, row: number): void {
  panel.cursorIndex = row;
  expect(panel.handleInput("\r")).toBe(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("X1 — supersede from the DEEP view re-binds too", () => {
  test("test_x1_deep_view_accept_restages_writein", () => {
    const state = seed([{ id: "q1", overrides: { recommendation: "a" } }, { id: "q2" }]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "deep words");

    panel.currentId = "q1";
    expect(panel.handleInput("d")).toBe(true);
    expect(panel.view).toBe("deep");
    acceptRow(panel, 0);
    expect(panel.draftTextFor("q1")).toBe("deep words");

    panel.handleInput("d");
    panel.currentId = "q2";
    acceptRow(panel, 0);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — deep words");
  });
});

describe("X2 — held batch note rides the re-bound submission", () => {
  test("test_x2_note_and_elaboration_ship_together", () => {
    const state = seed([{ id: "q1", overrides: { recommendation: "a" } }, { id: "q2" }]);
    const { panel, sendMessage } = rig(state);

    expect(panel.handleInput("m")).toBe(true);
    panel.textField.setText("side comment");
    expect(panel.handleInput("\r")).toBe(true);
    expect(panel.focus).toBe("options");

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "noted words");
    panel.currentId = "q1";
    acceptRow(panel, 0);

    panel.currentId = "q2";
    acceptRow(panel, 0);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — noted words");
    expect(msg.content).toContain("NOTE: side comment");
  });
});

describe("X3 — gate hold: supersede under an unanswered gate does not auto-submit", () => {
  test("test_x3_gate_hold_blocks_then_releases", () => {
    const state = seed([
      { id: "g1", overrides: { gate: true, group: "foundation", recommendation: "a" } },
      { id: "q1", overrides: { group: "later" } },
      { id: "q2", overrides: { group: "later" } },
    ]);
    const { panel, sendMessage } = rig(state);

    panel.currentId = "q1";
    panel.cursorIndex = 2;
    typeWriteIn(panel, "held words");
    panel.currentId = "q1";
    acceptRow(panel, 0);

    panel.currentId = "q2";
    acceptRow(panel, 0);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.gateWarning?.count).toBe(1);

    panel.currentId = "g1";
    acceptRow(panel, 0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — held words");
    expect(msg.content).toContain("g1: Alpha");
  });
});
PROBEEOF

if npx vitest run --config "$PROBE_DIR/vitest.probes.config.ts" > /tmp/validate-probes.log 2>&1; then
  ok "E2E probe suite (31 journeys)"
  grep -E "Tests  " /tmp/validate-probes.log | tail -1 | sed 's/^/    /'
else
  bad "E2E probe suite (31 journeys)"
  tail -40 /tmp/validate-probes.log
fi

# ---------------------------------------------------------------- summary
section "Summary"
printf 'Passed: %d\n' "${#PASS[@]}"
if [ "${#FAIL[@]}" -gt 0 ]; then
  printf 'Failed: %d\n' "${#FAIL[@]}"
  for f in "${FAIL[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
printf 'Failed: 0\n\033[32mVALIDATION PASSED\033[0m\n'
exit 0

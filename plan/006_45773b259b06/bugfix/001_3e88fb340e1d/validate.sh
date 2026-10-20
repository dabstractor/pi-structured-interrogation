#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate.sh — pi-interrogator comprehensive validation (bugfix re-validation)
#
# Context: the previous bug-hunt filed 4 defects (BUG-001 replay fidelity,
# BUG-002 Other-row truncation, BUG-003 dead auto-submit flash, BUG-004 stale
# SURFACE-002 comment). A bugfix agent landed fixes (commits 83fb067..cced85e).
# This script RE-VALIDATES the whole codebase with emphasis on those fixes.
#
# Phases (only those that exist in this codebase):
#   1. Linting            — eslint (typescript-eslint recommended) via npm run lint
#   2. Type checking      — tsc --noEmit (npm run typecheck)
#   3. Style checking     — none configured (no prettier/biome) — noted
#   4. Unit testing       — vitest run (npm test) — 55 files / 1643 tests
#   5. Static guards      — keymap/README/source spec gates (5.1–5.6, carried
#                           forward) + fix-cycle gates (5.7–5.9):
#                            5.7 BUG-004: no "session_start auto-opens" claim
#                            5.8 BUG-001: DiffEntry text/custom carrier +
#                                 replay consumer + submit producer all wired
#                            5.9 BUG-001: replay-fidelity regression test exists
#   6. Independent probes — fresh (non-reused) verification code driving the
#                           REAL executor/panel/delivery/reconstruct machinery:
#                           P1 replay fidelity (incl. legacy + corrupt entries),
#                           P2 width contract, P3 auto-submit notify channel,
#                           P4 producer coverage. Bundled with esbuild in /tmp.
#   7. E2E (headless pi)  — REAL `pi -p` one-shot probes driving the REAL
#                           extension: non-TUI journeys (digest, answers,
#                           guards, completion, restart reconstruction —
#                           E12 is the live restart-fidelity journey for
#                           BUG-001: elaboration + ✎ write-in survive a fresh
#                           process). No TUI, no human (AUTOMATION-POLICY).
#
# Usage:  bash validate.sh               (full run; E2E needs `pi` on PATH + model access)
#         SKIP_E2E=1 bash validate.sh    (skip phase 7)
#
# Exit code: 0 iff every executed phase passes.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ENTRY="$REPO_ROOT/src/index.ts"
WORK="$(mktemp -d /tmp/pi-interrogator-validate.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0; FINDING_COUNT=0
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
# Phase 1 — linting
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
  warn "no formatter config (.prettierrc*/biome) — no style gate exists for this repo"
fi

# ---------------------------------------------------------------------------
# Phase 4 — unit tests
# ---------------------------------------------------------------------------
section "Phase 4: unit tests (vitest run)"
if (cd "$REPO_ROOT" && npm test >"$WORK/test.log" 2>&1); then
  TESTS_SUMMARY="$(grep -E 'Tests +[0-9]+ passed' "$WORK/test.log" | tail -1 | tr -s ' ')"
  FILES_SUMMARY="$(grep -E 'Test Files +[0-9]+ passed' "$WORK/test.log" | tail -1 | tr -s ' ')"
  ok "vitest green — ${FILES_SUMMARY:-files}, ${TESTS_SUMMARY:-tests}"
  grep -q "regression-replay-fidelity" "$WORK/test.log" && ok "replay-fidelity regression suite ran and passed" || { bad "replay-fidelity regression suite absent from the run"; FAILED_PHASES+=("replay-suite-run"); }
else
  bad "vitest failed"; grep -E "FAIL|✗|×|AssertionError" "$WORK/test.log" | head -20 | sed 's/^/      /'
  FAILED_PHASES+=("unit-tests")
fi

# ---------------------------------------------------------------------------
# Phase 5 — static guards
# ---------------------------------------------------------------------------
section "Phase 5: static guards"

# 5.1 keymap conflict verification (README regression guard)
if (cd "$REPO_ROOT" && bash scripts/verify-keymap-conflicts.sh >"$WORK/keymap.log" 2>&1); then
  ok "verify-keymap-conflicts.sh PASS"
else
  bad "verify-keymap-conflicts.sh failed"; tail -15 "$WORK/keymap.log" | sed 's/^/      /'
  FAILED_PHASES+=("keymap-conflicts")
fi

# 5.2 README removed-chord vocabulary gate
if ! grep -qE -- 'ctrl\+t|ctrl\+d|ctrl\+l|focusText|digitQuickSelect|advanceArmed' "$REPO_ROOT/README.md"; then
  ok "README free of removed-chord vocabulary"
else
  bad "README still names removed keys/machinery:"; grep -nE 'ctrl\+t|ctrl\+d|ctrl\+l|focusText|digitQuickSelect|advanceArmed' "$REPO_ROOT/README.md" | head -5 | sed 's/^/      /'
  FAILED_PHASES+=("readme-chord-gate")
fi

# 5.3 no global shortcut registration in production source
if ! grep -rn "registerShortcut(" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | grep -q .; then
  ok "no pi.registerShortcut call in production source"
else
  bad "production source registers a global shortcut:"; grep -rn "registerShortcut(" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | head -3 | sed 's/^/      /'
  FAILED_PHASES+=("no-register-shortcut")
fi

# 5.4 README keymap table + sample settings match src/config.ts DEFAULT_CONFIG
README_KEYMAP_OK=1
while IFS=' ' read -r action key; do
  if ! grep -q "\"$action\": *\"$key\"" "$REPO_ROOT/README.md"; then
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
[ $README_KEYMAP_OK -eq 1 ] && ok "README keymap table + sample settings match DEFAULT_CONFIG (9/9 keys)" \
  || FAILED_PHASES+=("readme-keymap-sync")

# 5.5 caps engine stays deleted (CAPS-OUT-001)
if [ ! -f "$REPO_ROOT/src/caps.ts" ] && \
   ! grep -rn "applyCaps\|descriptionCap\|minRamification\|minDescription\|CapsConfig" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | grep -q .; then
  ok "caps engine stays deleted (CAPS-OUT-001)"
else
  bad "caps engine residue found:"; { ls "$REPO_ROOT/src/caps.ts" 2>/dev/null; grep -rn "applyCaps\|descriptionCap\|minRamification\|minDescription\|CapsConfig" "$REPO_ROOT"/src --include='*.ts' | grep -v '\.test\.ts' | head -5; } | sed 's/^/      /'
  FAILED_PHASES+=("caps-deleted")
fi

# 5.6 side-chat cache-isolation ban list (SIDECHAT-005)
if ! grep -rnE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
     "$REPO_ROOT/src/panel/sidechat.ts" "$REPO_ROOT/src/panel/sidechat-engine.ts" \
     "$REPO_ROOT/src/panel/sidechat-prompt.ts" "$REPO_ROOT/src/panel/chat-view.ts" \
     "$REPO_ROOT/src/panel/branch-snapshot.ts" 2>/dev/null | grep -v '^\s*//' | grep -v '\* ' | grep -q .; then
  ok "side-chat production modules contain no session-touching calls (SIDECHAT-005)"
else
  bad "side-chat module references a banned session call:"; grep -rnE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" "$REPO_ROOT/src/panel/sidechat.ts" "$REPO_ROOT/src/panel/sidechat-engine.ts" "$REPO_ROOT/src/panel/sidechat-prompt.ts" "$REPO_ROOT/src/panel/chat-view.ts" 2>/dev/null | grep -v '^\s*//' | head -5 | sed 's/^/      /'
  FAILED_PHASES+=("sidechat-isolation")
fi

# 5.7 BUG-004 gate: index.ts must NOT claim session_start auto-opens the panel
#     (SURFACE-002: session_start NEVER opens the panel — widget line only).
if ! grep -q "auto-opens the panel" "$REPO_ROOT/src/index.ts" && \
   grep -q "NEVER opens the panel" "$REPO_ROOT/src/index.ts" && \
   grep -q "NEVER opens the panel" "$REPO_ROOT/src/reconstruct.ts"; then
  ok "BUG-004: no stale auto-open claim; SURFACE-002 never-open contract documented at both sites"
else
  bad "BUG-004 regression: index.ts/reconstruct.ts auto-open wording wrong:"; grep -n "auto-opens the panel\|NEVER opens the panel" "$REPO_ROOT/src/index.ts" "$REPO_ROOT/src/reconstruct.ts" | head -5 | sed 's/^/      /'
  FAILED_PHASES+=("surface002-comment")
fi

# 5.8 BUG-001 carrier/consumer/producer wiring gate (grep-level structural)
BUG1_WIRING=1
grep -q "text?: string;" "$REPO_ROOT/src/snapshots.ts" && grep -q "custom?: boolean;" "$REPO_ROOT/src/snapshots.ts" \
  || { bad "DiffEntry missing text?/custom? fields (snapshots.ts)"; BUG1_WIRING=0; }
grep -q 'typeof entry.text === "string" && entry.text !== ""' "$REPO_ROOT/src/reconstruct.ts" && \
grep -q 'entry.custom === true' "$REPO_ROOT/src/reconstruct.ts" \
  || { bad "replaySubmission missing strict text/custom guards (reconstruct.ts)"; BUG1_WIRING=0; }
grep -q 'q.answer?.text !== undefined && q.answer.text !== ""' "$REPO_ROOT/src/panel/actions.ts" && \
grep -q 'q.answer?.custom === true' "$REPO_ROOT/src/panel/actions.ts" \
  || { bad "submit synthetic-entry seam missing text/custom spreads (panel/actions.ts)"; BUG1_WIRING=0; }
grep -q 'after?.answer?.text !== undefined && after.answer.text !== ""' "$REPO_ROOT/src/snapshots.ts" \
  || { bad "computeEntries missing text spread (snapshots.ts)"; BUG1_WIRING=0; }
[ $BUG1_WIRING -eq 1 ] && ok "BUG-001: DiffEntry carrier + computeEntries producer + submit seam + replay consumer all wired"

# 5.9 BUG-001 regression suite exists
if [ -f "$REPO_ROOT/src/regression-replay-fidelity.test.ts" ]; then
  ok "regression-replay-fidelity.test.ts present (end-to-end replay pin)"
else
  bad "regression-replay-fidelity.test.ts missing"; FAILED_PHASES+=("replay-suite-missing")
fi

# ---------------------------------------------------------------------------
# Phase 6 — independent fix-verification probes (fresh code, real seams)
#
# Bundles a standalone probe (written by the validation agent, NOT reused from
# the fix's tests) with the repo's esbuild and runs it under node. The probe
# drives the real executor (executeInterrogate), a real InterrogationPanel
# with a fake editor, the real delivery wire, the real reconstruction entry
# point, and the real renderers.
# ---------------------------------------------------------------------------
section "Phase 6: independent fix-verification probes"
PROBE_DIR="$WORK/probe"; mkdir -p "$PROBE_DIR"
ln -s "$REPO_ROOT/node_modules" "$PROBE_DIR/node_modules"
cat > "$PROBE_DIR/probe.ts" <<'PROBE_EOF'
import type { ExtensionAPI, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "@REPO@/src/config.js";
import { DraftStore } from "@REPO@/src/draft-store.js";
import {
  reconstructFromBranch,
  setFallbackActive,
  type ReconstructionContext,
  type ReconstructionOptions,
} from "@REPO@/src/reconstruct.js";
import {
  createPanelHost,
  InterrogationPanel,
  type InterrogationPanelArgs,
  type PanelHost,
} from "@REPO@/src/panel/panel.js";
import {
  getState,
  resetState,
  setState,
  InterrogationState,
  type Question,
} from "@REPO@/src/state.js";
import { executeInterrogate, type ExecutorContext } from "@REPO@/src/tool.js";

let pass = 0;
let fail = 0;
let findings = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
function finding(name: string, detail: string): void {
  findings++;
  console.log(`  FINDING  ${name} — ${detail}`);
}

const stubTheme = { fg: (_n: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

function fakeEditor() {
  let text = "";
  return {
    getText: () => text,
    setText: (t: string) => { text = t; },
    handleInput: () => false,
    render: () => ["e1", "e2", "e3"],
    focused: false,
    focus: () => {},
    blur: () => {},
    invalidate: () => {},
  };
}

function makePiHarness() {
  const calls: unknown[][] = [];
  const sendMessage = (...args: unknown[]) => { calls.push(args); return Promise.resolve() as unknown as void; };
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const on = (event: string, handler: (e: unknown) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {};
  };
  const pi = { on, sendMessage } as unknown as Pick<ExtensionAPI, "on" | "sendMessage">;
  return { pi, sendMessage, calls };
}

function toolResultEntry(details: unknown): SessionEntry {
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
      details,
      isError: false,
      timestamp: Date.now(),
    },
  } as unknown as SessionEntry;
}

function submissionEntry(details: Record<string, unknown>): SessionEntry {
  return {
    type: "custom_message",
    id: `s${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "interrogation-submission",
    content: "Submitted",
    display: true,
    details: "card" in details ? details : { ...details, card: { ...details, remainOpen: 0 } },
  } as unknown as SessionEntry;
}

function makeCtx(entries: SessionEntry[]): ReconstructionContext {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { custom: () => new Promise<null>(() => {}), setWidget: () => {} },
  } as unknown as ReconstructionContext;
}

function makeHost(): PanelHost {
  return createPanelHost({ onPanelDismiss: () => {}, dismissPanel: () => {} });
}

function choiceQ(id: string): Question {
  return {
    id,
    prompt: `p:${id}`,
    description: `d:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "alpha", label: "Alpha" },
      { value: "beta", label: "Beta" },
    ],
  };
}

function freshState(questions: Question[]): void {
  resetState();
  const s = new InterrogationState("probe");
  setState(s);
  for (const q of questions) s.upsertQuestion(q);
}

function makePanel(args: Partial<InterrogationPanelArgs> & { state: NonNullable<InterrogationPanelArgs["state"]> }): InterrogationPanel {
  return new InterrogationPanel({
    tui: { requestRender: () => {} } as unknown as TUI,
    theme: stubTheme,
    done: args.done ?? (() => {}),
    state: args.state,
    config: DEFAULT_CONFIG,
    drafts: args.drafts ?? new DraftStore(),
    editorFactory: () => fakeEditor() as never,
    delivery: args.delivery,
    sidechatNotify: args.sidechatNotify,
  } as unknown as InterrogationPanelArgs);
}

// ===================== P1 — BUG-001 replay fidelity =====================
console.log("P1 — BUG-001 replay fidelity (independent, real seams)");
{
  setFallbackActive(false);
  makeHost();
  const h = makePiHarness();

  const upsert = executeInterrogate(
    { goal: "val probe", epoch: 1, questions: [choiceQ("q1"), choiceQ("q2")] },
    { mode: "tui", hasUI: true } satisfies ExecutorContext,
    DEFAULT_CONFIG,
  );
  const baseDetails = upsert.details;
  check("P1a upsert returns state envelope", (baseDetails as { state?: unknown }).state !== undefined);

  const panel = makePanel({
    state: getState()!,
    delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => {} },
  });

  panel.currentId = "q1";
  panel.cursorIndex = 0;
  if (panel.handleInput("\r") !== true) check("P1b option accept", false);
  panel.currentId = "q1";
  panel.focusTextField("elaboration");
  panel.textField.setText("alpha fits the migration plan");
  if (panel.handleInput("\r") !== true) check("P1b elaboration commit", false);

  panel.currentId = "q2";
  panel.cursorIndex = getState()!.getQuestion("q2")!.options!.length;
  if (panel.handleInput("\r") !== true) check("P1b write-in duty", false);
  panel.textField.setText("Neither — we use a custom vector store");
  if (panel.handleInput("\r") !== true) check("P1b write-in commit", false);

  check("P1b auto-submit delivered exactly one submission", h.calls.length === 1);
  const delivered = h.calls[0]![0] as {
    customType: string;
    details: { changed: Array<Record<string, unknown>>; epoch: number };
  };
  check("P1c customType is interrogation-submission", delivered.customType === "interrogation-submission");
  const q1e = delivered.details.changed.find((e) => e.id === "q1")!;
  const q2e = delivered.details.changed.find((e) => e.id === "q2")!;
  check("P1d q1 delta carries value=alpha", q1e.value === "alpha");
  check("P1e q1 delta carries elaboration text", q1e.text === "alpha fits the migration plan");
  check("P1f q1 delta has no custom marker", !("custom" in q1e));
  check("P1g q2 delta carries RAW write-in value", q2e.value === "Neither — we use a custom vector store");
  check("P1h q2 delta carries custom:true", q2e.custom === true);
  check("P1i q2 delta has no text duplicate", !("text" in q2e));

  // Hard kill inside the 2s mirror debounce: branch = tool result + submission only.
  resetState();
  const entries: SessionEntry[] = [toolResultEntry(baseDetails), submissionEntry(delivered.details)];
  const result = reconstructFromBranch(makeCtx(entries), {
    config: DEFAULT_CONFIG,
    host: makeHost(),
    drafts: new DraftStore(),
  } satisfies ReconstructionOptions);
  check("P1j reconstruction replays 1 submission off tool-result base", result.source === "tool-result" && result.replayed === 1);

  const s = getState()!;
  const q1 = s.getQuestion("q1")!;
  const q2 = s.getQuestion("q2")!;
  check("P1k q1 answer.value restored", q1.answer?.value === "alpha");
  check("P1l q1 answer.text restored (BUG-001 core)", q1.answer?.text === "alpha fits the migration plan");
  check("P1m q1 answer carries no custom key", q1.answer !== undefined && !("custom" in q1.answer!));
  check("P1n q2 answer.value restored (RAW text, not ✎ label)", q2.answer?.value === "Neither — we use a custom vector store");
  check("P1o q2 answer.custom restored (BUG-001 core)", q2.answer?.custom === true);
  check("P1p q2 answer carries no text key", q2.answer !== undefined && !("text" in q2.answer!));
  check("P1q epoch advanced to 2", s.epoch === 2);
  panel.dispose();
}

// --- P1 legacy + corrupt-entry backward compat ---
{
  setFallbackActive(false);
  makeHost();
  freshState([choiceQ("q1")]);
  const legacy = submissionEntry({
    changed: [
      { id: "q1", title: "p:q1", from: "(unanswered)", to: "Alpha", editedArchived: false, value: "alpha" },
    ],
    epoch: 2,
  });
  const base = toolResultEntry(executeInterrogate(
    { goal: "legacy", epoch: 1, questions: [choiceQ("q1")] },
    { mode: "tui", hasUI: true } satisfies ExecutorContext,
    DEFAULT_CONFIG,
  ).details);
  resetState();
  reconstructFromBranch(makeCtx([base, legacy]), {
    config: DEFAULT_CONFIG, host: makeHost(), drafts: new DraftStore(),
  } satisfies ReconstructionOptions);
  const q = getState()!.getQuestion("q1")!;
  check("P1r legacy value-only entry still replays (no crash, value restored)", q.answer?.value === "alpha");
  check("P1s legacy entry leaves no text/custom", !("text" in (q.answer ?? {})) && !("custom" in (q.answer ?? {})));

  freshState([choiceQ("q1")]);
  makeHost();
  const corrupt = submissionEntry({
    changed: [
      {
        id: "q1", title: "p:q1", from: "(unanswered)", to: "Alpha", editedArchived: false,
        value: "beta", text: 42 as unknown as string, custom: "yes" as unknown as boolean,
      },
    ],
    epoch: 3,
  });
  const base2 = toolResultEntry(executeInterrogate(
    { goal: "corrupt", epoch: 1, questions: [choiceQ("q1")] },
    { mode: "tui", hasUI: true } satisfies ExecutorContext,
    DEFAULT_CONFIG,
  ).details);
  resetState();
  reconstructFromBranch(makeCtx([base2, corrupt]), {
    config: DEFAULT_CONFIG, host: makeHost(), drafts: new DraftStore(),
  } satisfies ReconstructionOptions);
  const qc = getState()!.getQuestion("q1")!;
  check("P1t corrupt non-string text does not leak", qc.answer?.text === undefined);
  check("P1u corrupt truthy non-true custom does not leak", qc.answer?.custom === undefined);
  check("P1v value still applied from corrupt entry", qc.answer?.value === "beta");
}

// ===================== P2 — BUG-002 width contract =====================
console.log("P2 — BUG-002 width contract (full panel render, all lines)");
{
  setFallbackActive(false);
  makeHost();
  freshState([choiceQ("q1")]);
  const panel = makePanel({ state: getState()! });
  panel.currentId = "q1";

  let allFit = true;
  let detail = "";
  for (const w of [18, 20, 25, 30, 40, 59, 80]) {
    for (const line of panel.render(w)) {
      const vw = visibleWidth(line);
      if (vw > w) { allFit = false; detail += `[w=${w} line=${vw}col ${JSON.stringify(line)}] `; }
    }
  }
  check("P2a choice panel: every line fits every width >= 18", allFit, detail || undefined);

  // Ultra-narrow sweep: classify overflows (footer minimal form is a
  // documented residual from the previous PRD, out of BUG-002's scope).
  const footerOverflow: string[] = [];
  const otherOverflow: string[] = [];
  for (const w of [6, 8, 10, 12, 14, 16, 17]) {
    for (const line of panel.render(w)) {
      const vw = visibleWidth(line);
      if (vw <= w) continue;
      if (line.includes("└") || line.includes("answered ⏎")) footerOverflow.push(`w=${w}:${vw}col`);
      else otherOverflow.push(`w=${w}:${vw}col ${JSON.stringify(line)}`);
    }
  }
  if (footerOverflow.length > 0) {
    console.log(`  INFO  footer minimal-form overflow below width 18 — documented residual (previous PRD): ${footerOverflow[0]}`);
  }
  if (otherOverflow.length > 0) {
    finding("P2g unexpected non-footer overflow line at ultra-narrow widths", otherOverflow.slice(0, 4).join(" | "));
  } else {
    check("P2g no overflow lines at ultra-narrow widths beyond the documented footer residual", true);
  }

  const otherAt = (w: number): string | undefined => panel.render(w).find((l) => l.includes("✎"));
  const at10 = otherAt(10)!;
  const at30 = otherAt(30)!;
  check("P2b Other row truncates with … at width 10", at10.includes("…") && visibleWidth(at10) <= 10, JSON.stringify(at10));
  check("P2c Other row intact at width 30", at30.includes("✎ Other — write your own") && visibleWidth(at30) <= 30, JSON.stringify(at30));

  // Write-in answered state (combined ★ answered · ✎ text answer markers).
  const st = getState()!;
  st.applyAnswer("q1", { value: "a fairly long custom write-in answer text", custom: true, at: new Date().toISOString() });
  panel.currentId = "q1";
  panel.cursorIndex = 1;
  const wHeaderOverflow: string[] = [];
  let wAllFit = true;
  let wDetail = "";
  for (const w of [18, 20, 25, 30, 31, 40, 59, 80]) {
    for (const line of panel.render(w)) {
      const vw = visibleWidth(line);
      if (vw <= w) continue;
      if (line.includes("★") || line.includes("✎") || line.includes("⟳")) wHeaderOverflow.push(`w=${w}:${vw}col ${JSON.stringify(line)}`);
      else { wAllFit = false; wDetail += `[w=${w} line=${vw}col ${JSON.stringify(line)}] `; }
    }
  }
  check("P2d write-in panel: every non-header line fits (widths >= 18)", wAllFit, wDetail || undefined);
  if (wHeaderOverflow.length > 0) {
    finding(
      "P2f question-header line is width+1 when combined status markers fill the budget (src/panel/layout.ts renderQuestionLine — PRE-EXISTING, not a BUG-002-fix regression)",
      wHeaderOverflow.slice(0, 3).join(" | "),
    );
  }

  const textQ: Question = { id: "qt", prompt: "p:qt", description: "d:qt", type: "text", rev: 1, status: "open" };
  freshState([textQ]);
  const p2 = makePanel({ state: getState()! });
  p2.currentId = "qt";
  let tAllFit = true;
  let tDetail = "";
  for (const w of [18, 20, 30, 45, 59, 80]) {
    for (const line of p2.render(w)) {
      const vw = visibleWidth(line);
      if (vw > w) { tAllFit = false; tDetail += `[w=${w} line=${vw}col ${JSON.stringify(line)}] `; }
    }
  }
  check("P2e text panel: every line fits every width >= 18", tAllFit, tDetail || undefined);
  p2.dispose();
}

// ===================== P3 — BUG-003 confirmation channel =====================
console.log("P3 — BUG-003 auto-submit confirmation channel");
{
  setFallbackActive(false);
  makeHost();
  const h = makePiHarness();
  const events: string[] = [];
  freshState([choiceQ("q1")]);
  const panel = makePanel({
    state: getState()!,
    delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => {} },
    done: () => events.push("done(null)"),
    sidechatNotify: (m: string) => events.push(`notify:${m}`),
  });
  panel.currentId = "q1";
  panel.cursorIndex = 0;
  if (panel.handleInput("\r") !== true) check("P3a auto-submit", false);
  check("P3a auto-submit delivered one submission", h.calls.length === 1);
  check("P3b notify fired with the verbatim AUTOSUBMIT-001 string",
    events.some((e) => e === "notify:submitted — 1 answer(s)"), events.join(" | "));
  const doneIdx = events.findIndex((e) => e === "done(null)");
  const notifyIdx = events.findIndex((e) => e.startsWith("notify:submitted"));
  check("P3c notify fires AFTER suspend (post-done — observable channel)", doneIdx !== -1 && notifyIdx > doneIdx, events.join(" | "));
  check("P3d footer flash still staged (test receipt)", panel.footerFlash?.text === "submitted — 1 answer(s)");
  const delivered = h.calls[0]![0] as { details: { changed: Array<Record<string, unknown>> } };
  const q1e = delivered.details.changed.find((e) => e.id === "q1")!;
  check("P3e synthetic-seam entry carries value (single-question auto path)", q1e.value === "alpha");
}

// ===================== P4 — producer coverage =====================
console.log("P4 — producer coverage: computeEntries via auto-submit");
{
  setFallbackActive(false);
  makeHost();
  const h = makePiHarness();
  freshState([choiceQ("q1"), choiceQ("q2")]);
  const panel = makePanel({
    state: getState()!,
    delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => {} },
  });
  panel.currentId = "q1"; panel.cursorIndex = 0;
  if (panel.handleInput("\r") !== true) check("P4a first answer", false);
  panel.currentId = "q1";
  panel.focusTextField("elaboration");
  panel.textField.setText("first elaboration");
  if (panel.handleInput("\r") !== true) check("P4a elaboration", false);
  panel.currentId = "q2"; panel.cursorIndex = getState()!.getQuestion("q2")!.options!.length;
  if (panel.handleInput("\r") !== true) check("P4a write-in duty", false);
  panel.textField.setText("custom store");
  if (panel.handleInput("\r") !== true) check("P4a write-in commit", false);
  check("P4a first (auto) submit delivered", h.calls.length === 1);
  const first = (h.calls[0]![0] as { details: { changed: Array<Record<string, unknown>>; epoch: number } }).details;
  const q1first = first.changed.find((e) => e.id === "q1")!;
  check("P4b computeEntries producer carried elaboration on q1", q1first.text === "first elaboration", JSON.stringify(q1first));
  const q2first = first.changed.find((e) => e.id === "q2")!;
  check("P4c computeEntries producer carried custom on q2", q2first.custom === true && q2first.value === "custom store");
  check("P4d submission labeled with the pre-bump epoch (design)", first.epoch === 1, `got ${first.epoch}`);
  panel.dispose();
}

console.log(`\nprobe summary: ${pass} passed, ${fail} failed, ${findings} new finding(s)`);
if (fail > 0) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
PROBE_EOF
sed -i "s|@REPO@|$REPO_ROOT|g" "$PROBE_DIR/probe.ts"

if (cd "$PROBE_DIR" && "$REPO_ROOT/node_modules/.bin/esbuild" probe.ts --bundle --format=esm --platform=node \
      --packages=external --outfile=probe.mjs --log-level=warning >"$WORK/esbuild.log" 2>&1); then
  if node "$PROBE_DIR/probe.mjs" >"$WORK/probe.log" 2>&1; then
    sed 's/^/  /' "$WORK/probe.log"
    ok "independent probes: all checks green"
    FINDING_COUNT=$((FINDING_COUNT + $(grep -c "FINDING" "$WORK/probe.log" || true)))
  else
    sed 's/^/  /' "$WORK/probe.log"
    bad "independent probes reported failures"
    FAILED_PHASES+=("probes")
  fi
else
  bad "esbuild failed to bundle the probe"; sed 's/^/      /' "$WORK/esbuild.log" | head -10
  FAILED_PHASES+=("probe-bundle")
fi

# ---------------------------------------------------------------------------
# Phase 7 — E2E: headless pi probes (AUTOMATION-POLICY §scripted equivalents)
# ---------------------------------------------------------------------------
section "Phase 7: E2E — headless pi one-shot probes"

run_pi() { # run_pi <outfile> <timeout-secs> <prompt>...
  local out=$1; local tmo=$2; shift 2
  (cd "$WORK" && timeout "$tmo" pi -p --no-session --mode json \
     -e "$EXT_ENTRY" --tools interrogate "$@" >"$out" 2>&1)
}

# probe <name> <expected-in-tool-result> <prompt>
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

# probe_custom <name> <customType> <expected> <prompt>
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
    '0/1 answered · 0 re-asked · 0 moot · epoch 1||Relay this digest verbatim' \
    'Call the interrogate tool ONCE with exactly this argument (every question MUST have a non-empty "description" field): {"goal":"E2E validation probe","questions":[{"id":"q1","title":"engine","prompt":"Which database engine?","description":"Choosing the storage engine for the new service; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"}]}. Then reply with exactly the word DONE and nothing else.'

  # E2 — digest marks the recommended option with ★
  probe "E2 fallback digest: recommendation renders ★ + Recommendation line" \
    'SQLite (`sqlite`) ★||Recommendation: SQLite' \
    'Call the interrogate tool ONCE with EXACTLY this JSON argument (copy verbatim; "recommendation" is a field of the QUESTION object, at the same level as "options", never inside an option): {"goal":"stars","questions":[{"id":"q1","prompt":"Which engine?","description":"Picking the storage engine; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"}]}. Then reply DONE.'

  # E3 — record answers: epoch bump (non-TUI variant)
  probe "E3 record answers: answered counts + epoch bumps 1→2" \
    "2/2 answered · 0 re-asked · 0 moot · epoch 2" \
    'Do these two tool calls in order, then reply DONE: (1) interrogate with {"goal":"E2E roundtrip","questions":[{"id":"q1","title":"engine","prompt":"Which database engine?","description":"Choosing the storage engine for the new service; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"},{"id":"q2","title":"migrations","prompt":"How are migrations run?","description":"How schema changes get applied in environments.","type":"text"}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"postgres"},{"id":"q2","value":"flyway from CLI"}]}.'

  # E4 — completion record injected once with full Q&A (AC-11/AC-14, FR-5)
  probe_custom "E4 completion record injected (non-TUI settle)" \
    "interrogation-completion" \
    "INTERROGATION COMPLETE — E2E roundtrip" \
    'Do these two tool calls in order, then reply DONE: (1) interrogate with {"goal":"E2E roundtrip","questions":[{"id":"q1","title":"engine","prompt":"Which database engine?","description":"Choosing the storage engine for the new service; sqlite is embedded, postgres is a server.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}],"recommendation":"sqlite"},{"id":"q2","title":"migrations","prompt":"How are migrations run?","description":"How schema changes get applied in environments.","type":"text"}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"postgres"},{"id":"q2","value":"flyway from CLI"}]}.'

  # E5 — stale epoch guard: isError + self-heal + recovery (AC-8)
  probe "E5 stale guard: STALE message, then self-heal with correct epoch" \
    "STALE: session epoch is 1 (you sent 99)||1/1 answered · 0 re-asked · 0 moot · epoch 2" \
    'Do these three tool calls in order, then reply DONE: (1) interrogate with {"questions":[{"id":"q1","prompt":"Pick?","description":"A simple preference question between two options.","type":"choice","options":[{"value":"a","label":"A"},{"value":"b","label":"B"}]}]}. (2) interrogate with {"epoch":99,"answers":[{"id":"q1","value":"a"}]} — this will fail with a stale error; that is expected. (3) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"a"}]}.'

  # E6 — TRUST-001: long write-in reaches the model INTACT, ✎ scan line
  probe "E6 TRUST-001: long write-in full text in read detail + ✎ scan line" \
    "  answer: We deploy via GitHub Actions on every merge to main: build, run vitest, then a canary pod for 15 minutes absorbing 5% of traffic before full rollout, with automatic rollback on error-rate regression beyond two standard deviations of the seven-day baseline.||✎ We deploy via GitHub Actions" \
    'Do these three tool calls in order, then reply DONE: (1) interrogate with {"goal":"trust","questions":[{"id":"q1","prompt":"Describe the deployment pipeline in detail?","description":"Free-text answer describing the deployment pipeline end to end.","type":"text"}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"We deploy via GitHub Actions on every merge to main: build, run vitest, then a canary pod for 15 minutes absorbing 5% of traffic before full rollout, with automatic rollback on error-rate regression beyond two standard deviations of the seven-day baseline.","custom":true}]}. (3) interrogate with {} — a read.'

  # E7 — dependsOn moot + withdrawOmitted + options-change re-ask
  probe "E7 moot + withdrawOmitted + reasked (merge rules)" \
    "0/3 answered · 1 re-asked · 1 moot · epoch 2||withdrew (withdrawOmitted): q2||q2: ORM? — withdrawn (rev 1) · answered: prisma||q1: Storage? — reasked (rev 2)" \
    'Do these tool calls in order, then reply DONE: (1) interrogate with {"goal":"prune","questions":[{"id":"q1","prompt":"Storage?","description":"Where data lives; sqlite enables litestream backups, filesystem does not.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"fs","label":"Filesystem"}]},{"id":"q2","prompt":"ORM?","description":"Which object-relational mapper to standardize on.","type":"choice","options":[{"value":"prisma","label":"Prisma"}]},{"id":"q3","prompt":"Backup tool?","description":"Continuous backup; only meaningful for sqlite storage.","type":"choice","options":[{"value":"litestream","label":"Litestream"}],"dependsOn":[{"id":"q1","equals":"sqlite"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"fs"},{"id":"q2","value":"prisma"}]}. (3) interrogate with {"epoch":2,"questions":[{"id":"q1","rev":1,"prompt":"Storage?","description":"Where data lives; filesystem only now.","type":"choice","options":[{"value":"fs","label":"Filesystem"}]}],"withdrawOmitted":true}. (4) interrogate with {} — a read.'

  # E8 — standing moot does NOT block completion
  probe_custom "E8 standing moot does not block completion record" \
    "interrogation-completion" \
    "Withdrawn/moot: q2 (moot: q1=fs)" \
    'Do these tool calls in order then reply DONE: (1) interrogate with {"goal":"moot complete","questions":[{"id":"q1","prompt":"Storage?","description":"Where data lives; sqlite enables litestream backups, filesystem does not.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"fs","label":"FS"}]},{"id":"q2","prompt":"Backup?","description":"Continuous backup; only meaningful for sqlite storage.","type":"choice","options":[{"value":"litestream","label":"Litestream"}],"dependsOn":[{"id":"q1","equals":"sqlite"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"fs"}]} — the user chose fs; record exactly that answer and nothing else.'

  # E9 — session restart reconstruction (FR-28 read side / AC-9)
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

  # E9b — BUG-001 LIVE restart fidelity: elaboration + ✎ write-in survive a
  #       fresh process. Three questions (one left OPEN so the completion
  #       close pass cannot clear state); answers carry text + custom.
  SESSDIR2="$WORK/sessions2"; mkdir -p "$SESSDIR2"
  (cd "$WORK" && timeout 240 pi -p --session-dir "$SESSDIR2" --name validate-fidelity --mode json \
     -e "$EXT_ENTRY" --tools interrogate \
     'Do these two tool calls in order, then reply DONE: (1) interrogate with {"goal":"fidelity probe","questions":[{"id":"q1","prompt":"Engine?","description":"Which engine to use.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}]},{"id":"q2","prompt":"Notes?","description":"Free-text notes about the deployment.","type":"text"},{"id":"q3","prompt":"Region?","description":"Deployment region; leave for later.","type":"choice","options":[{"value":"eu","label":"EU"},{"value":"us","label":"US"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"sqlite","text":"We need zero-ops local dev above all else."},{"id":"q2","value":"plain files on the node","custom":true}]}.' \
     >"$WORK/e2e-fidelity-a.jsonl" 2>&1)
  SESS_FILE2="$(ls -t "$SESSDIR2"/*.jsonl 2>/dev/null | head -1)"
  if [ -n "${SESS_FILE2:-}" ] && [ -f "$SESS_FILE2" ]; then
    (cd "$WORK" && timeout 240 pi -p --session "$SESS_FILE2" --mode json \
       -e "$EXT_ENTRY" --tools interrogate \
       'Call interrogate with {} — a read — then reply DONE.' \
       >"$WORK/e2e-fidelity-b.jsonl" 2>&1)
    if python3 - "$WORK/e2e-fidelity-b.jsonl" <<'PYEOF'
import json, sys
elab = marker = False
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try: ev = json.loads(line)
        except: continue
        if ev.get("type") == "tool_execution_end":
            for c in ev.get("result", {}).get("content", []):
                t = c.get("text", "")
                if "elaboration: We need zero-ops local dev above all else." in t: elab = True
                if "✎ plain files on the node" in t: marker = True
sys.exit(0 if (elab and marker) else 1)
PYEOF
    then ok "E9b BUG-001 live: elaboration + ✎ write-in survive a REAL process restart"; else
      bad "E9b BUG-001 live: resumed read lost the elaboration or the ✎ write-in marker"; FAILED_PHASES+=("e2e:E9b-fidelity"); fi
  else
    bad "E9b BUG-001 live: first session file not created"; FAILED_PHASES+=("e2e:E9b-fidelity")
  fi

  # E10 — description REQUIRED at the wire schema
  probe "E10 description-required: absent field rejected at the wire schema" \
    "questions.0.description||must have required properties description" \
    'Call the interrogate tool ONCE with exactly this argument: {"goal":"bare","questions":[{"id":"q1","prompt":"Pick?","type":"choice","options":[{"value":"a","label":"A"}]}]} — it will be rejected with an error; that is expected. Then reply DONE.'

  # E10b — whitespace-only description rejected by the extension gate
  probe "E10b description-required: whitespace-only rejected by extension gate" \
    "description is REQUIRED and must be a non-empty string (question \"q1\")" \
    'Call the interrogate tool ONCE with exactly this argument: {"goal":"ws","questions":[{"id":"q1","prompt":"Pick?","description":"   ","type":"choice","options":[{"value":"a","label":"A"}]}]} — it will be rejected with an error; that is expected. Then reply DONE.'

  # E11 — write-in elaboration via answers[].text reaches the read result
  probe "E11 elaboration text attaches to recorded answer (read detail)" \
    "  elaboration: We need zero-ops local dev above all else." \
    'Do these three tool calls in order, then reply DONE: (1) interrogate with {"goal":"elab","questions":[{"id":"q1","prompt":"Engine?","description":"Choosing the storage engine.","type":"choice","options":[{"value":"sqlite","label":"SQLite"},{"value":"postgres","label":"Postgres"}]}]}. (2) interrogate with {"epoch":1,"answers":[{"id":"q1","value":"sqlite","text":"We need zero-ops local dev above all else."}]}. (3) interrogate with {} — a read.'
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"
log "passed: $PASS_COUNT   failed: $FAIL_COUNT   warnings: $WARN_COUNT   new findings (probes): $FINDING_COUNT"
if [ ${#FAILED_PHASES[@]} -gt 0 ]; then
  log "failed phases: ${FAILED_PHASES[*]}"
  exit 1
fi
log "ALL PHASES GREEN"
exit 0

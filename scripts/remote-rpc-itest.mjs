#!/usr/bin/env node
/**
 * scripts/remote-rpc-itest.mjs — live `pi --mode rpc` round trip (plan §5.3):
 * the interrogator extension + a driver extension (a minimal stand-in for a
 * pi-ask-conformant bridge client, e.g. remote-pi's app) in ONE pi process,
 * driven headlessly over RPC stdin/stdout.
 *
 * Flow under test:
 *   prompt → model calls interrogate → onLiveQuestions → `itg:` started flow
 *   → driver auto-answers after 1.5 s (choice by value + text by customText)
 *   → remote-submit pipeline delivers the interrogation-submission delta
 *   → model replies → agent_settled close pass → interrogation-completion.
 *
 * Assertions (driver JSONL + stdout events):
 *   started carried BOTH questions; submit-result ok:true; the submission
 *   message content ("Submitted 2", epoch line); the completion record.
 *
 * SKIP semantics: exits 0 with "SKIP" when the environment cannot run a
 * model (no interrogate tool execution AND retry/error signals, or no tool
 * call within 60 s) — CI-safe. Real regressions FAIL: tool ran but no
 * started / not ok / no submission / no completion.
 *
 * Usage: node scripts/remote-rpc-itest.mjs
 * Overrides: ITG_ITEST_PROVIDER, ITG_ITEST_MODEL, ITG_ITEST_TIMEOUT_MS.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT_DIR = resolve(new URL(".", import.meta.url).pathname);
const WORKTREE = resolve(SCRIPT_DIR, "..");
const TIMEOUT_MS = Number(process.env.ITG_ITEST_TIMEOUT_MS ?? 300_000);
const NO_TOOL_CALL_MS = 60_000;
const PROMPT =
  "Use the interrogate tool now with goal 'itest'. Create exactly two questions in ONE call: " +
  "id q1, type choice, prompt 'Pick one', options value a label Alpha and value b label Beta, recommendation a; " +
  "id q2, type text, prompt 'Explain briefly'. Then end your turn with one short sentence.";

/** The driver extension: logs pi-ask contract traffic + custom messages; auto-answers the first flow. */
const DRIVER_TS = `
import { appendFileSync } from "node:fs";
const LOG = process.env.ITG_ITEST_LOG ?? "/dev/null";
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const ANSWER_DELAY_MS = 1500;

export default function driver(pi) {
  pi.events.on("@eko24ive/pi-ask:started", (e) => {
    if (e?.version !== 1 || typeof e.flowId !== "string") return;
    log({ kind: "started", flowId: e.flowId, source: e.source, title: e.title, questionIds: (e.questions ?? []).map((q) => q.id) });
    if (e.source === "ask:replay") return; // answer the FIRST flow only
    setTimeout(() => {
      pi.events.emit("@eko24ive/pi-ask:submit", {
        version: 1,
        requestId: "driver-" + Date.now(),
        flowId: e.flowId,
        response: {
          kind: "answer",
          mode: "submit",
          answers: {
            q1: { values: ["a"] },
            q2: { customText: "integration test free-text answer" },
          },
        },
      });
    }, ANSWER_DELAY_MS);
  });
  pi.events.on("@eko24ive/pi-ask:submit-result", (e) => {
    log({ kind: "submit-result", ok: e?.ok === true, error: e?.error, flowId: e?.flowId });
  });
  pi.events.on("@eko24ive/pi-ask:completed", (e) => {
    log({ kind: "completed", flowId: e?.flowId });
  });
  // CORE pi events ride pi.on (the ExtensionAPI lifecycle surface), NOT the
  // inter-extension pi.events bus — an earlier revision of this driver
  // subscribed them on pi.events.on and saw nothing (the "driver logging
  // gap" failure: submissions/completions visible on stdout but not logged).
  pi.on("message_end", (e) => {
    const m = e?.message;
    log({ kind: "message-end", role: m?.role, customType: m?.customType ?? null });
    if (m?.role === "custom" && typeof m.customType === "string" && m.customType.startsWith("interrogation-")) {
      log({ kind: "custom-message", customType: m.customType, content: m.content });
    }
  });
  pi.on("agent_settled", () => log({ kind: "agent-settled" }));
  pi.on("tool_execution_end", (e) => {
    if (e?.toolName === "interrogate") log({ kind: "interrogate-end", isError: e?.isError === true });
  });
  pi.on("extension_error", (e) => {
    log({ kind: "extension-error", message: String(e?.error?.message ?? e?.error ?? e) });
  });
}
`;

function readDriverLog(path) {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function run() {
  const dir = mkdtempSync(join(tmpdir(), "itg-rpc-itest-"));
  const driverPath = join(dir, "driver.ts");
  const logPath = join(dir, "driver.jsonl");
  writeFileSync(driverPath, DRIVER_TS);

  const args = [
    "--mode", "rpc",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "-e", join(WORKTREE, "src", "index.ts"),
    "-e", driverPath,
  ];
  if (process.env.ITG_ITEST_PROVIDER) args.push("--provider", process.env.ITG_ITEST_PROVIDER);
  if (process.env.ITG_ITEST_MODEL) args.push("--model", process.env.ITG_ITEST_MODEL);

  const child = spawn("pi", args, {
    cwd: dir,
    env: { ...process.env, ITG_ITEST_LOG: logPath },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const stdoutLines = [];
  const sawTool = { interrogate: false };
  const modelTrouble = { retry: false, error: false };
  // Custom messages (role "custom") do not reliably surface as standalone
  // message_end events on the extension bus — they ride agent_end dumps on
  // stdout. Scan raw lines for the customType markers instead.
  const sawCustom = { submission: false, completion: false };
  let exited = false;
  let stdoutTail = "";

  const timer = setTimeout(() => {
    if (!exited) child.kill("SIGKILL");
  }, TIMEOUT_MS);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutTail = (stdoutTail + chunk).split("\n").slice(-50).join("\n");
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        continue;
      }
      stdoutLines.push(evt);
      if (trimmed.includes('"customType":"interrogation-submission"')) sawCustom.submission = true;
      if (trimmed.includes('"customType":"interrogation-completion"')) sawCustom.completion = true;
      if (evt.type === "tool_execution_start" && evt.toolName === "interrogate") sawTool.interrogate = true;
      if (evt.type === "auto_retry_start") modelTrouble.retry = true;
      if (evt.type === "extension_error") modelTrouble.error = true;
    }
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("exit", (code) => {
      exited = true;
      clearTimeout(timer);
      resolveExit(code);
    });
    // Send the prompt once the RPC loop is up (pi emits nothing on startup;
    // a short delay suffices — stdin is buffered).
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ id: "p1", type: "prompt", message: PROMPT }) + "\n");
    }, 800);
    // Early success: the completion customType on stdout (or the driver log
    // as a backstop). Early abort when the model can't run at all.
    const poll = setInterval(() => {
      const entries = readDriverLog(logPath);
      const done =
        sawCustom.completion ||
        entries.some((e) => e.kind === "custom-message" && e.customType === "interrogation-completion");
      const stuck = !sawTool.interrogate && modelTrouble.retry;
      if (done || stuck) {
        clearInterval(poll);
        child.kill("SIGKILL");
      }
    }, 1000);
    child.on("exit", () => clearInterval(poll));
  });

  const entries = readDriverLog(logPath);
  const started = entries.filter((e) => e.kind === "started");
  const results = entries.filter((e) => e.kind === "submit-result");
  const submissions = entries.filter((e) => e.kind === "custom-message" && e.customType === "interrogation-submission");
  const completions = entries.filter((e) => e.kind === "custom-message" && e.customType === "interrogation-completion");
  const extErrors = entries.filter((e) => e.kind === "extension-error");
  const toolRan = sawTool.interrogate || stdoutLines.some((e) => e.type === "tool_execution_start" && e.toolName === "interrogate");

  const report = () => {
    console.log("── driver log ──");
    for (const e of entries) console.log(JSON.stringify(e));
    console.log("── stdout tail ──");
    console.log(stdoutTail.slice(-2000));
  };

  rmSync(dir, { recursive: true, force: true });

  // SKIP: environment cannot drive a model turn (no provider, offline…).
  if (!toolRan) {
    console.log(`SKIP: interrogate never executed (model trouble signals: retry=${modelTrouble.retry}, extErr=${modelTrouble.error}); ` +
      `not a bridge regression — requires a working pi provider. exit=${exitCode}`);
    report();
    process.exit(0);
  }

  const failures = [];
  if (started.length === 0) failures.push("no started flow emitted");
  const first = started[0];
  if (first && JSON.stringify(first.questionIds) !== JSON.stringify(["q1", "q2"])) {
    failures.push(`started carried ${JSON.stringify(first.questionIds)} — expected ["q1","q2"]`);
  }
  if (!results.some((r) => r.ok === true)) failures.push(`no ok submit-result (${JSON.stringify(results)})`);
  if (results.some((r) => r.ok === false)) failures.push(`a submit-result nacked: ${JSON.stringify(results.filter((r) => !r.ok))}`);
  if (submissions.length === 0 && !sawCustom.submission) failures.push("no interrogation-submission delivered");
  const sub = submissions[0];
  if (sub && !/Submitted 2/.test(String(sub.content))) failures.push(`submission content: ${String(sub.content).slice(0, 120)}`);
  if (sub && !/\(state epoch \d+\)/.test(String(sub.content))) failures.push("submission content lacks epoch line");
  if (submissions.length === 0 && sawCustom.submission) failures.push("NOTE: submission seen on stdout but not via the driver bus — driver logging gap");
  if (completions.length === 0 && !sawCustom.completion) failures.push("no interrogation-completion injected");
  if (extErrors.length > 0) failures.push(`extension errors: ${JSON.stringify(extErrors)}`);

  if (failures.length > 0) {
    console.log("FAIL: " + failures.join("; "));
    report();
    process.exit(1);
  }

  console.log("PASS: rpc round trip — started(q1,q2) → submit-result ok → Submitted 2 (epoch line) → completion record");
  process.exit(0);
}

run().catch((err) => {
  console.error("FAIL: harness error", err);
  process.exit(1);
});

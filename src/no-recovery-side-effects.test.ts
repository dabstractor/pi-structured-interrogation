/**
 * src/no-recovery-side-effects.test.ts — the no-side-effects static guard
 * for local input recovery (P3.M2.T1.S3; architecture note
 * input-recovery.md §No-side-effects audit — S3 owns shipping it).
 *
 * Binding contract (spec state-and-persistence.md :139 "Drafts are not
 * answers or messages"; :138 "never claim the edit was saved"): SAVING and
 * RETIRING are INERT — the recovery modules must not advance, commit,
 * queue, submit, send, resend, call a model, write a session file, mutate
 * the memory DraftStore, or touch any lifecycle/completion trigger. The
 * recovery modules' only outbound surfaces are the injected text getter,
 * the sink seam (S2's durable writer), the injected retirement forwarder,
 * timers, and `fs` under the recovery storagePath.
 *
 * Anatomy cloned from src/panel/sidechat-cache-isolation.test.ts
 * (deliberately COPIED, not imported — each guard owns its scanner so the
 * guards evolve independently; see that file's docblock for the scanner
 * contract): stripComments blanks `//` and `/* … *\/` spans with newlines
 * PRESERVED while tracking a frame stack over `" ' ` ${"` so strings,
 * template literals, interpolations, URLs, and escapes never desync the
 * scan. STRING CONTENTS ARE PRESERVED — a banned name inside a live string
 * is still a violation surface to review.
 *
 * File set is TARGETED — the recovery modules only, never repo-wide: every
 * other module (panel/actions.ts, delivery.ts, …) legitimately references
 * the banned names; their retire call sites ARE the handoff seams the
 * architecture note sanctions.
 *
 * The composed behavioral half of this audit (capture flush + retire on a
 * live panel mutates no state, sends nothing) lives in
 * src/panel/retirement-sidechat.test.ts — the panel harness can't exist in
 * a static scan.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The recovery modules (P3.M2.T1.S1/S2) — the store layer whose saving,
 * restoring, and retiring must stay inert. Retire hooks live in the PANEL
 * layer (panel.ts/actions.ts) at the handoff seams themselves — those
 * files legitimately contain handoff-seam identifiers and are NOT scanned.
 */
const RECOVERY_FILES = ["input-capture.ts", "input-durability.ts"] as const;

/**
 * The architecture note §No-side-effects audit banned list, verbatim in
 * intent: no answer application (applyAnswer / writeInEnter /
 * acceptOptionIndex), no submission (submit — matched as the bare call/
 * reference form; longer identifiers like markSubmitted/maybeAutoSubmit do
 * NOT word-boundary-match, and the self-test below proves it), no state
 * commits/queueing (setStatus / upsertQuestion / InterrogationState), no
 * message/submission transport (sendMessage / sendUserMessage /
 * SubmitDeps), no model calls (streamSimple), no session-file writes
 * (appendEntry), no memory-DraftStore mutation (shipDrafts / clearDraft /
 * clearAll — the durable retire never touches the memory store), no
 * lifecycle side effects (noteSubmissionDelivered), no panel
 * navigation/advance (openPanel / nextUnanswered).
 */
const BANNED_API = [
  "applyAnswer",
  "writeInEnter",
  "acceptOptionIndex",
  "submit",
  "setStatus",
  "upsertQuestion",
  "InterrogationState",
  "sendMessage",
  "sendUserMessage",
  "SubmitDeps",
  "streamSimple",
  "appendEntry",
  "shipDrafts",
  "clearDraft",
  "clearAll",
  "noteSubmissionDelivered",
  "openPanel",
  "nextUnanswered",
] as const;

/**
 * Additional inertness surfaces beyond the note's identifier list: no
 * EventEmitter event bus, no "saved" claim (spec :138 — the payload
 * field `savedAt` does NOT word-boundary-match, self-tested), no
 * auto-advance helper. `.emit(` is banned for any NON-`this` receiver —
 * a bus/emitter surface (bus.emit / emitter.emit) — while S1's private
 * `this.emit(...)` sink-delivery helper stays legal: it IS the sanctioned
 * outbound seam (records into the injected CaptureSink), not an event
 * surface. The carve-out is receiver-exact and self-tested below.
 */
const BANNED_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "EventEmitter", re: /\bEventEmitter\b/g },
  { name: ".emit(", re: /(?<!this)\.emit\(/g },
  { name: "saved", re: /\bsaved\b/g },
  { name: "maybeAutoSubmit", re: /\bmaybeAutoSubmit\b/g },
] as const;

type Frame = '"' | "'" | "`" | "${";

/**
 * Blank out comment spans (// and /* … *\/) while PRESERVING string and
 * template literals — a `//` inside "https://…" must not corrupt the scan.
 * Tracks a stack so template interpolations stay inside string context
 * until their own delimiter closes. Newlines preserved so violation line
 * numbers stay accurate. (Cloned verbatim from
 * src/panel/sidechat-cache-isolation.test.ts — see module docblock.)
 */
function stripComments(src: string): string {
  const out: string[] = [];
  const stack: Frame[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") {
          out.push(" ");
          i += 1;
        }
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        out.push("  ");
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          out.push(src[i] === "\n" ? "\n" : " ");
          i += 1;
        }
        if (i < src.length) {
          out.push("  ");
          i += 2;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        stack.push(c);
        out.push(c);
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }
    if (c === "\\") {
      out.push(src.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (top === "${") {
      if (c === "}") {
        stack.pop();
        out.push(c);
        i += 1;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        stack.push(c);
        out.push(c);
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }
    if (c === top) {
      stack.pop();
      out.push(c);
      i += 1;
      continue;
    }
    if (top === "`" && c === "$" && src[i + 1] === "{") {
      stack.push("${");
      out.push("${");
      i += 2;
      continue;
    }
    out.push(c === "\n" ? "\n" : c);
    i += 1;
  }
  return out.join("");
}

/** Word-boundary banned-identifier scan with line numbers. */
function violationsIn(stripped: string): string[] {
  const problems: string[] = [];
  for (const name of BANNED_API) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split("\n").length;
      problems.push(
        `line ${line}: banned identifier '${name}' (§No-side-effects audit: recovery modules are inert)`,
      );
    }
  }
  for (const { name, re } of BANNED_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split("\n").length;
      problems.push(`line ${line}: banned surface '${name}' (spec :138/:139 inertness)`);
    }
  }
  return problems;
}

describe("no-side-effects guard — recovery modules (P3.M2.T1.S3, §No-side-effects audit)", () => {
  test("test_recovery_modules_reference_no_answer_submit_send_model_state_surface", async () => {
    const files = RECOVERY_FILES.map((f) => path.join(SRC_ROOT, f));
    // Sanity: every enumerated recovery module actually exists (a rename
    // must update this list, not silently shrink the scan).
    for (const file of files) {
      await expect(fs.access(file)).resolves.toBeUndefined();
    }
    expect(files.length).toBeGreaterThan(1); // the scan actually sees the modules

    const problems: string[] = [];
    for (const file of files) {
      const stripped = stripComments(await fs.readFile(file, "utf8"));
      for (const v of violationsIn(stripped)) {
        problems.push(`${path.relative(SRC_ROOT, file)}: ${v}`);
      }
    }
    expect(
      problems,
      "saving/retiring must be inert (spec :139; architecture note §No-side-effects audit)",
    ).toEqual([]);
  });

  test("test_capture_module_imports_no_fs_and_no_panel_state_delivery_persistence", async () => {
    // input-capture.ts must carry NO node:fs import — retirement reaches
    // the durable layer ONLY through the injected onRetire callback wired
    // in index.ts (the sink-seam posture; the static audit's core point).
    const capture = await fs.readFile(path.join(SRC_ROOT, "input-capture.ts"), "utf8");
    const captureImports = capture
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /from\s+["']/.test(l));
    expect(
      captureImports.filter((l) => l.includes("node:fs")),
      "input-capture.ts must not import node:fs",
    ).toEqual([]);
    expect(
      stripComments(capture).match(/import\s*\{[^}]*\}\s*from\s*["']node:fs["']/),
      "input-capture.ts must not import fs",
    ).toBeNull();

    // NEITHER recovery module may import the panel layer, state, delivery,
    // or persistence — the isolation that makes the inertness above
    // structural, not aspirational (§No-side-effects audit "Allowed
    // surface"). input-durability legitimately imports node:fs/crypto/path
    // and the capture TYPES — nothing else.
    for (const name of RECOVERY_FILES) {
      const src = await fs.readFile(path.join(SRC_ROOT, name), "utf8");
      const importSources = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      const forbidden = importSources.filter((s) =>
        /panel|(^|[/.])state(\.|["']|$)|delivery|persistence/.test(s),
      );
      expect(forbidden, `${name} must not import panel/state/delivery/persistence`).toEqual([]);
    }
  });

  test("test_guard_flags_banned_identifiers_in_all_access_shapes", () => {
    // pi.*-style, destructured, and property call — identifier matching
    // covers every access shape, for EACH banned name.
    for (const name of BANNED_API) {
      expect(violationsIn(stripComments(`await pi.${name}(m);`))).not.toEqual([]);
      expect(violationsIn(stripComments(`const { ${name} } = ctx;`))).not.toEqual([]);
      expect(violationsIn(stripComments(`runtime.${name}(id);`))).not.toEqual([]);
    }
    // Word boundaries: longer identifiers sharing a prefix are NOT hits —
    // markSubmitted / setStatusText-style names stay legal (the PRP gotcha
    // about bare "submit" false hits), and the payload field `savedAt` is
    // not a "saved" claim. maybeAutoSubmit IS banned as a whole word (the
    // auto-advance helper) — covered by the flags test below.
    expect(
      violationsIn(stripComments(`markSubmitted(state, ids); const savedAt = now();`)),
    ).toEqual([]);
  });

  test("test_emit_carveout_is_receiver_exact", () => {
    // S1's private sink-delivery helper (`this.emit(` — records into the
    // injected CaptureSink) is the sanctioned outbound seam and stays legal…
    expect(violationsIn(stripComments(`this.emit(k, key, text, session);`))).toEqual([]);
    // …while ANY other receiver — a bus/emitter surface — trips.
    expect(violationsIn(stripComments(`bus.emit("change", x);`))).not.toEqual([]);
    expect(violationsIn(stripComments(`emitter.emit(evt);`))).not.toEqual([]);
  });

  test("test_guard_ignores_comment_only_mentions", () => {
    // Comment mentions never trip the guard (stripped before matching)…
    expect(violationsIn(stripComments(`// applyAnswer would be wrong here\nconst x = 1;`))).toEqual(
      [],
    );
    expect(violationsIn(stripComments(`/* shipDrafts note */ const y = 2;`))).toEqual([]);
    // …but a planted use under a comment still trips.
    expect(
      violationsIn(stripComments(`// never do this\nawait pi.sendMessage(m);`)),
    ).not.toEqual([]);
  });

  test("test_scanner_stays_string_and_template_aware", () => {
    // URLs with // inside strings must not open a phantom comment…
    expect(violationsIn(stripComments(`const url = "https://x//path";`))).toEqual([]);
    // …nested templates must not desync the scanner…
    expect(
      violationsIn(stripComments('const t = `a ${ cond ? `${x} ("q")` : "y" } b`;')),
    ).toEqual([]);
    // …a banned name in a live string is still a review surface — it TRIPS.
    expect(
      violationsIn(stripComments('const hint = "use sendMessage to surface this";')),
    ).not.toEqual([]);
  });
});

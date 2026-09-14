/**
 * src/detect.test.ts — event-sequence unit tests for the plain-text round
 * detector (P1.M7.T4.S1; FR-26, h2.27). Extends lifecycle.test.ts's
 * bare-mock-pi convention: a mock `{ on }` stands in for pi and handlers are
 * driven via `emit(event, payload, ctx)` — handlers are ExtensionHandler<E>,
 * so the mock ctx ({ mode, ui.notify }) rides along as the second argument.
 * Detection is asserted to be a pure read: message fixtures are deep-frozen
 * and identity-compared.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi, type Mock } from "vitest";
import { createRoundDetector, ROUND_LINE_RE, ROUND_NOTIFY_MESSAGE } from "./detect.js";
import type { InterrogatorConfig } from "./config.js";
import type { Lifecycle } from "./lifecycle.js";

// ------------------------------------------------------------------ mock pi

type Handler = (event: unknown, ctx: unknown) => void;

interface MockPi {
  pi: Pick<ExtensionAPI, "on">;
  /** The vi.fn backing `pi.on` — assert registrations with it. */
  on: Mock<[event: string, handler: Handler], () => void>;
  /** Fire every handler registered for `event` with (event, ctx). */
  emit(event: string, payload?: Record<string, unknown>, ctx?: unknown): void;
  /** Unsubscribe functions the mock hands back from on() — dispose drains these. */
  unsubscribers: Array<() => void>;
  /** Live handler registry — dispose() must empty every list via the offs. */
  handlers: Map<string, Handler[]>;
}

/** Helper (not inline generic) so vitest 1.x infers the precise Mock type. */
function makeOnMock(
  handlers: Map<string, Handler[]>,
  unsubscribers: Array<() => void>,
): Mock<[event: string, handler: Handler], () => void> {
  return vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    const off = () => {
      const current = handlers.get(event);
      if (current === undefined) return;
      const i = current.indexOf(handler);
      if (i !== -1) current.splice(i, 1);
    };
    unsubscribers.push(off);
    return off;
  });
}

function makeMockPi(): MockPi {
  const handlers = new Map<string, Handler[]>();
  const unsubscribers: Array<() => void> = [];
  const on = makeOnMock(handlers, unsubscribers);
  // ExtensionHandler receives (event, ctx) — the mock ctx is threaded here.
  const emit = (event: string, payload: Record<string, unknown> = {}, ctx?: unknown): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload }, ctx);
  };
  // Cast mirrors lifecycle.test.ts's mock convention; the mock's call
  // signature is a widened superset of the "turn_end" overload.
  return { pi: { on } as unknown as Pick<ExtensionAPI, "on">, on, emit, unsubscribers, handlers };
}

// ------------------------------------------------------------------ fixtures

/** Mock TUI context — the only mode that may notify. */
function tuiCtx(): { mode: "tui"; ui: { notify: Mock } } {
  return { mode: "tui", ui: { notify: vi.fn() } };
}

type DetectorOpts = {
  config: Pick<InterrogatorConfig, "roundDetection">;
  lifecycle: Pick<Lifecycle, "upsertedThisRun">;
};

function detectorOpts(overrides: Partial<DetectorOpts> = {}): DetectorOpts {
  return {
    config: { roundDetection: true },
    lifecycle: { upsertedThisRun: vi.fn(() => false) },
    ...overrides,
  };
}

function textBlock(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

/** Numbered + Q-prefixed round — the canonical h2.27 fixture (3 lines). */
const NUMBERED_ROUND =
  "Before we start:\n1) What scope?\n2) Who owns it?\nQ3. What is the deadline?";

/** Bullet variants — `-`, `*`, and the ❓ emoji alternatives. */
const BULLET_ROUND = "- Where does it live?\n* Why now?\n❓ When does it ship?";

/** Emit one completed assistant turn (turn_end with a text-block message). */
function emitTurn(mock: MockPi, message: unknown, turnIndex: number, ctx: unknown = tuiCtx()): void {
  mock.emit("turn_end", { turnIndex, message, toolResults: [] }, ctx);
}

/** Deep-freeze a fixture so any mutation attempt surfaces loudly. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// ------------------------------------------------------------ subscriptions

test("test_registration_subscribes_only_turn_end", () => {
  const mock = makeMockPi();
  const detector = createRoundDetector(mock.pi, detectorOpts());
  expect(mock.on).toHaveBeenCalledTimes(1);
  expect(mock.on.mock.calls[0]?.[0]).toBe("turn_end");
  expect(mock.unsubscribers).toHaveLength(1);
  detector.dispose();
});

test("test_dispose_unsubscribes_and_mutes_later_turns", () => {
  const mock = makeMockPi();
  const ctx = tuiCtx();
  const detector = createRoundDetector(mock.pi, detectorOpts());
  detector.dispose();

  expect([...mock.handlers.values()].every((list) => list.length === 0)).toBe(true);
  emitTurn(mock, { content: [textBlock(NUMBERED_ROUND)] }, 0, ctx);
  expect(ctx.ui.notify).not.toHaveBeenCalled(); // no handler remains
});

// ------------------------------------------------------------------ fires

describe("test_notifies_happy_paths", () => {
  test("test_notifies_once_numbered_round_first_turn_tui", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());

    emitTurn(mock, { content: [textBlock(NUMBERED_ROUND)] }, 0, ctx); // bootstrap -3 → 0-(-3)=3 fires

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(ROUND_NOTIFY_MESSAGE, "info");
    detector.dispose();
  });

  test("test_notifies_once_bullet_variant_round", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());

    emitTurn(mock, { content: [textBlock(BULLET_ROUND)] }, 7, ctx); // 7-(-3)=10 ≥ 3

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(ROUND_NOTIFY_MESSAGE, "info");
    detector.dispose();
  });

  test("test_notifies_with_mixed_blocks_and_bare_string_content", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());

    // Mixed blocks: reasoning-adjacent non-text blocks are ignored, text
    // blocks contribute (exactly 3 matching lines across two blocks).
    emitTurn(
      mock,
      {
        content: [
          { type: "thinking", thinking: "1) fake? 2) fake?" },
          textBlock("1) What scope?\n"),
          textBlock("2) Who owns it?\nQ3. Deadline?"),
        ],
      },
      0,
      ctx,
    );
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

    // Bare-string content is tolerated too.
    emitTurn(mock, { content: NUMBERED_ROUND }, 10, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(2);
    detector.dispose();
  });

  test("test_notifies_again_after_throttle_window_three_turns", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());
    const message = { content: [textBlock(NUMBERED_ROUND)] };

    emitTurn(mock, message, 0, ctx); // fires (bootstrap)
    emitTurn(mock, message, 1, ctx); // 1-0=1 < 3 suppressed
    emitTurn(mock, message, 2, ctx); // 2-0=2 < 3 suppressed
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

    emitTurn(mock, message, 3, ctx); // 3-0=3 ≥ 3 fires again
    expect(ctx.ui.notify).toHaveBeenCalledTimes(2);

    emitTurn(mock, message, 5, ctx); // 5-3=2 < 3 suppressed
    emitTurn(mock, message, 6, ctx); // 6-3=3 ≥ 3 fires
    expect(ctx.ui.notify).toHaveBeenCalledTimes(3);
    detector.dispose();
  });
});

// ------------------------------------------------------------------ silent

describe("test_stays_silent_on_guard_paths", () => {
  test("test_silent_when_roundDetection_toggle_off", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts({ config: { roundDetection: false } }));

    emitTurn(mock, { content: [textBlock(NUMBERED_ROUND)] }, 0, ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    detector.dispose();
  });

  test("test_silent_when_ctx_mode_is_not_tui", () => {
    const mock = makeMockPi();
    const detector = createRoundDetector(mock.pi, detectorOpts());
    const ctxs = ["rpc", "json", "print"].map((mode) => ({
      mode,
      ui: { notify: vi.fn() },
    }));

    ctxs.forEach((ctx, i) => emitTurn(mock, { content: [textBlock(NUMBERED_ROUND)] }, i, ctx));

    for (const ctx of ctxs) expect(ctx.ui.notify).not.toHaveBeenCalled();
    detector.dispose();
  });

  test("test_silent_when_ctx_is_missing", () => {
    const mock = makeMockPi();
    const detector = createRoundDetector(mock.pi, detectorOpts());

    // No ctx → no notify surface AND no crash (tolerant guard order).
    expect(() => emitTurn(mock, { content: [textBlock(NUMBERED_ROUND)] }, 0, undefined)).not.toThrow();

    detector.dispose();
  });

  test("test_silent_when_upsert_happened_this_run", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const upsertedThisRun = vi.fn(() => true);
    const detector = createRoundDetector(mock.pi, detectorOpts({ lifecycle: { upsertedThisRun } }));

    emitTurn(mock, { content: [textBlock(NUMBERED_ROUND)] }, 0, ctx);

    expect(upsertedThisRun).toHaveBeenCalledTimes(1); // guard actually consulted
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    detector.dispose();
  });

  test("test_silent_with_only_two_matching_lines", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());

    emitTurn(mock, { content: [textBlock("1) What scope?\n2) Who owns it?\nNo marker line.")] }, 0, ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    detector.dispose();
  });

  test("test_silent_with_zero_matching_lines_or_non_string_content", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());

    emitTurn(mock, { content: [textBlock("Plain prose with one stray 1) question?")] }, 0, ctx);
    emitTurn(mock, { content: [{ type: "image", mimeType: "image/png", data: "x" }] }, 1, ctx);
    emitTurn(mock, {}, 2, ctx); // no content at all

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    detector.dispose();
  });
});

// ------------------------------------------------------------- purity

describe("test_content_purity", () => {
  test("test_message_content_never_mutated_deep_frozen_fixture", () => {
    const mock = makeMockPi();
    const ctx = tuiCtx();
    const detector = createRoundDetector(mock.pi, detectorOpts());
    const message = deepFreeze({
      content: [textBlock(NUMBERED_ROUND)],
      toolResults: [],
    });
    const snapshot = structuredClone(message);

    expect(() => emitTurn(mock, message, 0, ctx)).not.toThrow();

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1); // fired on a frozen message
    expect(message).toStrictEqual(snapshot); // byte-identical afterwards
    detector.dispose();
  });
});

// -------------------------------------------------- regex contract (h2.27)

describe("test_round_line_regex_contract", () => {
  test("test_regex_matches_prd_line_shapes", () => {
    for (const line of [
      "1) What scope?",
      "2. Who owns it?",
      "Q3: Deadline?",
      "Q12) Really?",
      "- Where from?",
      "* Why now?",
      "• How much?",
      "❓ When?",
      "  3) indented too?",
    ]) {
      expect(ROUND_LINE_RE.test(line), line).toBe(true);
    }
  });

  test("test_regex_rejects_non_question_or_markerless_lines", () => {
    for (const line of [
      "1) A statement without a question mark",
      "plain text 1) trailing marker?",
      "10)x no space", // marker must be followed by whitespace
      "? just a question mark",
      "Q) digit required after Q",
    ]) {
      expect(ROUND_LINE_RE.test(line), line).toBe(false);
    }
  });

  test("test_notify_string_matches_h227_verbatim", () => {
    expect(ROUND_NOTIFY_MESSAGE).toBe(
      "Question round detected in chat — /interrogate to move it into the panel",
    );
  });
});

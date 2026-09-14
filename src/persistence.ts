/**
 * src/persistence.ts — debounced state mirror (P1.M7.T1.S1; FR-27, h2.40
 * storage layer 3 of 3).
 *
 * h2.40 — the THREE storage layers (spec/state-and-persistence.md), verbatim:
 *
 *   1. In-memory authoritative — {@link InterrogationState} (state.ts) is the
 *      live source of truth for the session lifetime.
 *   2. Tool-result `details.state` canonical — every interrogate tool result
 *      carries the full serialized state (tool.ts); this is what the model
 *      and post-hoc diffing read from, and it lives in session history.
 *   3. Custom entries mirror-fallback — THIS module. Every in-memory state
 *      mutation is mirrored into `interrogation-state` custom entries via
 *      `pi.appendEntry`, debounced 2s per mutation window (trailing-edge,
 *      latest-wins), and flushed synchronously on `session_shutdown` (any
 *      reason) by the index.ts wiring.
 *
 * Why the mirror exists (Q37 residue): context compaction can drop the
 * tool-result entry that carried canonical `details.state` (layer 2). The
 * mirror entries are NOT in model context (pi custom entries never are) and
 * are never compacted away, so reconstruction (P1.M7.T1.S2) replays the
 * newest `interrogation-state` entry on the branch and answers are never
 * lost. P1.M7.T3.S2 renders the same entries in the transcript.
 *
 * Contract:
 * - Append-only audit trail: entries accumulate per debounce window; NOTHING
 *   in this module edits, dedupes, limits, or removes them.
 * - Payload shape (S2 contract, do not drift): `{ state, epoch, at }` where
 *   `state` is the verbatim `changed` snapshot, `epoch` is a cheap copy for
 *   S2 sanity checks, and `at` is the ISO 8601 FLUSH moment (not mutation).
 * - Failure isolation: `appendEntry` is wrapped in try/catch — a missing
 *   mirror entry is a degraded fallback, never an error state. The mirror
 *   never throws into the `changed` emitter or the shutdown handler, and
 *   never writes back to state or UI (layer 3 is write-only w.r.t. state).
 * - NOT persisted here: drafts (Q6=B — restart loses drafts BY DESIGN), the
 *   snapshot ring, or anything beyond `serialize()` output.
 *
 * Late-attach note: the state singleton is created lazily inside interrogate
 * tool execution (tool.ts `setState`) — it does not exist at factory
 * activation, and no creation event is emitted. The mirror therefore
 * resolves the singleton lazily (the lifecycle.ts pattern) and re-checks on
 * every `tool_execution_end`. Because `changed` payloads are FULL
 * snapshots, a late attach is lossless: the attach seeds the debounce with
 * the current snapshot, so the first upsert's pre-subscription mutation
 * still lands in the next window (or the shutdown flush).
 *
 * Singleton lifetime (h2.43): the pending-snapshot slot is cleared after
 * every flush and the subscription follows the CURRENT singleton — nothing
 * is cached across `session_shutdown`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getState, type InterrogationState, type SerializedState } from "./state.js";

/**
 * The custom entry type for mirrored state snapshots (h2.40 layer 3). Single
 * source of truth — P1.M7.T1.S2 (reconstruction) and P1.M7.T3.S2 (entry
 * renderer) MUST import this constant, never hardcode the string.
 */
export const INTERROGATION_STATE_ENTRY_TYPE = "interrogation-state";

/** Trailing-edge debounce window (h2.40: "debounced (2s) appendEntry"). */
export const STATE_MIRROR_DEBOUNCE_MS = 2000;

/**
 * Payload of one `interrogation-state` custom entry (S2 read contract).
 * `state` is the verbatim serialized snapshot (already structuredClone'd by
 * state.ts — safe to hold across the debounce window).
 */
export interface InterrogationStateEntryData {
  /** state.serialize() output, verbatim. */
  state: SerializedState;
  /** Copy of state.epoch at flush time (redundant sanity check for S2). */
  epoch: number;
  /** ISO 8601 timestamp of the FLUSH moment (not the mutation). */
  at: string;
}

/** Controller returned by {@link createStateMirror}. */
export interface StateMirror {
  /**
   * Flush a pending debounce window immediately (synchronously, no awaits —
   * the shutdown handler and the process may not survive past this call).
   * No-op when nothing is pending.
   */
  flush(): void;
  /**
   * Teardown seam: cancel a pending timer and unsubscribe from state events.
   * Does NOT flush (call {@link StateMirror.flush} first if needed). Safe to
   * call more than once.
   */
  dispose(): void;
}

export interface StateMirrorOptions {
  /**
   * State source override (tests / reconstruction); defaults to the module
   * singleton getter from state.ts — resolved lazily, never cached.
   */
  getState?: () => InterrogationState | undefined;
  /** Debounce window in ms; defaults to {@link STATE_MIRROR_DEBOUNCE_MS}. */
  debounceMs?: number;
}

/**
 * Build the state mirror (h2.40 layer 3). ONE instance per extension
 * activation, created in the index.ts factory — never per panel open.
 *
 * @param pi   narrow event surface — `Pick<ExtensionAPI, "appendEntry" | "on">` —
 *             so tests pass a bare mock without constructing a full ExtensionAPI
 * @param opts optional state-source override + debounce window
 */
export function createStateMirror(
  pi: Pick<ExtensionAPI, "appendEntry" | "on">,
  opts: StateMirrorOptions = {},
): StateMirror {
  const resolveState = opts.getState ?? getState;
  const debounceMs = opts.debounceMs ?? STATE_MIRROR_DEBOUNCE_MS;

  let attached: InterrogationState | undefined;
  let pending: SerializedState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Cheap path: store the snapshot (it IS the payload — never re-serialize
  // here) and (re)start the window. Runs synchronously inside every state
  // mutation, so it must stay allocation-light.
  const onChanged = (snapshot: SerializedState): void => {
    pending = snapshot;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, debounceMs);
  };

  /** Stop listening to the currently attached instance (if any). */
  function detach(): void {
    if (attached === undefined) return;
    attached.off("changed", onChanged);
    attached = undefined;
  }

  /**
   * Subscribe to the current singleton when it exists and is not already the
   * attached instance. `seed=true` (discovery attach, right after a tool
   * execution that may have created/mutated state) starts a debounce window
   * with the current snapshot so mutations that fired before this
   * subscription are not lost; `seed=false` (factory-time attach — no
   * mutation just happened) must not fabricate a window.
   */
  function attachIfPresent(seed: boolean): void {
    const state = resolveState();
    if (state === undefined || state === attached) return;
    detach();
    attached = state;
    state.on("changed", onChanged);
    if (seed) onChanged(state.serialize());
  }

  /** Synchronous flush: cancel the timer, append the pending snapshot, clear it. */
  function flush(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const snapshot = pending;
    if (snapshot === undefined) return;
    pending = undefined; // one append attempt per window — never retried/rewritten
    const data: InterrogationStateEntryData = {
      state: snapshot,
      epoch: snapshot.epoch,
      at: new Date().toISOString(),
    };
    try {
      pi.appendEntry(INTERROGATION_STATE_ENTRY_TYPE, data);
    } catch (err) {
      // Degraded fallback only — never fatal, never user-visible noise.
      console.error("interrogator: state mirror appendEntry failed", err);
    }
  }

  // pi.on returns void in the installed pi runtime, but some hosts/mocks hand
  // back an unsubscribe function — capture tolerantly for dispose() (same
  // pattern as lifecycle.ts).
  const unsubscribers: Array<() => void> = [];
  const track = (registered: unknown): void => {
    if (typeof registered === "function") unsubscribers.push(registered as () => void);
  };

  // Discovery hook: the singleton comes into existence inside interrogate
  // tool execution (tool.ts setState) with no creation event, so the mirror
  // re-checks after every tool execution completes. Identity-checked — a
  // tool run that did not create/replace state is a no-op here.
  track(pi.on("tool_execution_end", () => attachIfPresent(true)));

  // Factory-time attach (tests / post-reconstruction future): subscribe if a
  // singleton already exists, WITHOUT seeding — no mutation just happened.
  attachIfPresent(false);

  return {
    flush,
    dispose(): void {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
      detach();
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = undefined;
    },
  };
}

/**
 * src/input-capture.ts — local input recovery capture coordinator
 * (P3.M2.T1.S1; spec/state-and-persistence.md §Local input recovery
 * :133-149; mechanism design: plan/006_45773b259b06/architecture/
 * input-recovery.md §captureSeams/§pacing/§ordering — the note is the
 * mechanism authority where wording differs).
 *
 * [Mode A] — what this module is:
 *
 * Every editor mutation (keystroke OR paste — a paste is a plain buffer
 * mutation) in any of the panel's editor duties is captured as its FULL
 * EXPANDED string (getExpandedText — never the display preview or a paste
 * placeholder), keyed to {branchId, questionId | "-", field}, and handed to
 * a pluggable sink after BOUNDED pacing. Before Enter, before blur, before
 * suspend, before shutdown: "Capture on edit, before Enter" (spec :137).
 *
 * The five editor duties map to four capture fields through the panel's
 * live key providers: writein (✎ Other AND type:"text" answers —
 * desiredTextDuty), elaboration, note (question-agnostic batch note),
 * sidechat-composer.
 *
 * Pacing (spec :137 "Saving must progress during continuous typing; do not
 * wait indefinitely for idle, send, blur, suspend or shutdown"): ONE
 * trailing-debounce timer (250 ms) plus ONE max-dirty-age deadline timer
 * (1000 ms) per store instance — the note's §pacing resolution. The debounce
 * alone would defer forever under continuous typing; the deadline
 * guarantees a flush within 1000 ms of the first unsaved edit no matter how
 * long typing never pauses. Idle/blur/suspend/shutdown are NEVER triggers
 * here — accelerators (suspend, navigation write-through, send cleanup) MAY
 * force an early flush via forceFlush but are never relied upon.
 *
 * Ordering (note §ordering): per-key monotonic `seq`, minted at capture
 * time, ONLY when the capture represents real user edit work — an
 * onChange-driven capture whose text differs from the last captured value
 * for that key. Incidental empty buffers (initialization seeding, view
 * change, send cleanup, navigation buffer swaps) never reach this store at
 * all: TextField suppresses capture around its own programmatic setText —
 * so they mint nothing and write nothing. A DELIBERATE deletion-to-empty IS
 * an edit: it mints a seq and captures "" (spec :140).
 *
 * NO SIDE EFFECTS (spec :139 "Drafts are not answers or messages"): the
 * capture path calls NOTHING but the injected text getter and the sink. No
 * answer application, no submission pipeline, no message transport, no
 * model calls, no session-file writes, no fs in THIS item — the sink seam
 * receives records in memory; P3.M2.T1.S2 attaches the atomic file writer
 * to it. Retirement (P3.M2.T1.S3) is the ONE deliberate exit seam: an
 * EXPLICIT-only store method ({@link InputCaptureStore.retire}) that drops
 * pending dirty state for the key — never flushing it — and forwards the
 * retirement through an injected {@link InputCaptureStore-onRetire}
 * callback (index.ts wires it to the durable store's retire). It reaches
 * the durable layer ONLY through that callback: still zero fs imports
 * here (the static scanner enforces it).
 *
 * Deliberately inert (mirroring draft-store.ts's posture): NO EventEmitter,
 * NO state-event subscriptions, NO panel/state imports, NO filesystem. The
 * sink is try/catch-isolated — a sink failure degrades to memory-only
 * behavior, never breaks typing, focus, or rendering (note
 * §failureSemantics: fail silent-and-honest).
 */

/** Which editor duty produced a capture (panel textDuty × note × composer). */
export type CaptureField = "writein" | "elaboration" | "note" | "sidechat-composer";

/**
 * Capture key — WHERE the text lives. `branchId` is the raw session-branch
 * tip entry id at capture time (entry ids are unique across sessions, so
 * keying is session-safe by construction — note §keying); `questionId` is
 * the panel question id, or "-" when the field has none (note duty).
 */
export interface CaptureKey {
  branchId: string;
  questionId: string | "-";
  field: CaptureField;
}

/**
 * One captured write: the FULL expanded string plus its provenance. `seq`
 * is per-key monotonic (note §ordering); `session` is the live session id
 * from the same sessionManager surface the branchId came from.
 */
export interface CaptureRecord extends CaptureKey {
  session: string;
  text: string;
  seq: number;
}

/**
 * Pluggable consumer of flushed records — P3.M2.T1.S2's atomic file writer
 * attaches here. Synchronous, void-returning, and MUST NOT throw upward:
 * the store isolates sink failures (note §failureSemantics — keep the last
 * durable value and the live edit, never propagate into the editor path).
 */
export type CaptureSink = (record: CaptureRecord) => void;

/** Pacing constants (note §pacing — store constants, not config keys). */
const DEBOUNCE_MS = 250;
const MAX_DIRTY_AGE_MS = 1000;

/**
 * Destruction-guard options (P3.M2.T1.S3) — mirrors DraftStore's
 * `{explicit: true}` precedent (draft-store.ts:111 clearDraft): destructive
 * retirement is a NO-OP without the explicit flag. Nothing implicit retires
 * — navigation, view toggles, programmatic setText, suspend. The flag is
 * the single decision point separating "the user's hand moved" from
 * "incidental buffer churn" (architecture note §retirement #1).
 */
export interface RetireOptions {
  explicit?: boolean;
}

/** Internal map key: canonical, collision-safe join of the CaptureKey. */
function canonicalKey(key: CaptureKey): string {
  return `${key.branchId}\u0000${key.questionId}\u0000${key.field}`;
}

/**
 * Extension-lifetime capture coordinator (ONE instance per activation,
 * constructed next to the DraftStore in index.ts and handed to every panel
 * open — panel components are disposable, the store is not).
 *
 * The store owns ONLY: per-key seq counters, per-key last-captured values,
 * pending dirty entries, the two pacing timers, and the sink seam. It knows
 * nothing about panels, editors, state, or answers.
 */
export class InputCaptureStore {
  private readonly sink: CaptureSink;
  private readonly seedSeq: ((key: CaptureKey) => number) | undefined;
  private readonly onRetire: ((key: CaptureKey) => void) | undefined;
  private sessionResolver: (() => string) | undefined;
  /** Per-key last minted seq (note §ordering: never timestamps, never global). */
  private readonly seq = new Map<string, number>();
  /** Per-key last captured text — the mint gate (differs ⇒ real edit work). */
  private readonly lastValue = new Map<string, string>();
  /** Per-key newest emitted record (latest() test/P3.M3 surface). */
  private readonly latestRecords = new Map<string, CaptureRecord>();
  /** Dirty entries awaiting a flush: newest edit per key, captured EAGERLY. */
  private readonly pending = new Map<string, { key: CaptureKey; text: string }>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    options: {
      sink?: CaptureSink;
      session?: () => string;
      /**
       * Pluggable seed for the FIRST seq mint per canonical key
       * (P3.M2.T1.S2). S1's counters are per-process; after a restart a
       * naive counter restarts at 1, and the durable layer's monotonic
       * guard would then REJECT every post-restart edit against a higher
       * seq already on disk (the restart-clobber hole). The seed closes
       * it: consulted LAZILY and EXACTLY ONCE per key, at the first mint
       * (no eager work, no fs in this module — index.ts injects the
       * durable store and answers from its load-time index). Absent
       * option — or a non-positive/throwing seed — yields S1's original
       * behavior (first mint 1). Requirement: a key's first minted seq is
       * > the durable lastSeq for that key when a positive seed is given.
       */
      seedSeq?: (key: CaptureKey) => number;
      /**
       * Retirement forwarder (P3.M2.T1.S3) — invoked by {@link
       * InputCaptureStore.retire} AFTER the pending-dirty drop, carrying
       * the SAME CaptureKey the retirement targeted. index.ts wires it to
       * `durableInputs.retire(key, { explicit: true })` so panel-side
       * retire hooks stay terse (one explicit decision point, at the
       * wiring). Isolated like the sink: a throwing forwarder must never
       * break the retire path (never-throw contract).
       */
      onRetire?: (key: CaptureKey) => void;
    } = {},
  ) {
    // Default sink: in-memory capture only (latest()) — S1's "capture +
    // emit" contract; S2 attaches the atomic file writer here.
    this.sink = options.sink ?? (() => {});
    this.sessionResolver = options.session;
    this.seedSeq = options.seedSeq;
    this.onRetire = options.onRetire;
  }

  /**
   * Refresh the session-id resolver — called per panel open (the panel
   * reads the OPEN SURFACE's sessionManager; the ExtensionAPI root has
   * none). The same manager object serves every open, so per-flush reads
   * track /new's live session id automatically.
   */
  setSessionResolver(resolver: (() => string) | undefined): void {
    this.sessionResolver = resolver;
  }

  /**
   * The onChange-driven capture entry — the TextField calls this on EVERY
   * buffer mutation with the key CURRENT at edit time and a text getter
   * reading the FULL expanded string. The text is read EAGERLY (synchronously,
   * here) so a later buffer ownership switch can never bleed newer text into
   * an older key's pending record; the getter shape keeps the call site
   * lazy-looking and lets a hostile editor throw safely (a read failure
   * captures nothing — never mints, never throws into the editor path).
   *
   * Mint gate (note §ordering): text identical to the key's last captured
   * value is not edit work — no dirty mark, no timer arm, no seq.
   */
  setKeyDirty(key: CaptureKey, getText: () => string): void {
    if (this.disposed) return;
    let text: string;
    try {
      text = getText();
    } catch {
      return; // hostile/closed editor — capture nothing, never throw upward
    }
    if (typeof text !== "string") return;
    const k = canonicalKey(key);
    if (this.lastValue.get(k) === text) return;
    this.pending.set(k, { key, text });
    // One debounce + one deadline per STORE (note §pacing), armed only when
    // clean→dirty: the deadline is thus always 1000 ms from the first
    // unsaved edit of this dirty period.
    if (this.debounceTimer === undefined) {
      this.debounceTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
    }
    if (this.deadlineTimer === undefined) {
      this.deadlineTimer = setTimeout(() => this.flush(), MAX_DIRTY_AGE_MS);
    }
  }

  /**
   * Accelerator flush (suspend, navigation write-through, send cleanup) —
   * flushes ALL dirty keys, or just `key` when given. Early flushing MAY
   * happen here; it is never the sole trigger (the timers guarantee
   * progress without any accelerator ever firing).
   */
  forceFlush(key?: CaptureKey): void {
    if (key !== undefined) {
      const k = canonicalKey(key);
      const entry = this.pending.get(k);
      if (entry === undefined) return;
      this.pending.delete(k);
      this.emit(k, entry.key, entry.text, this.resolveSession());
      return;
    }
    this.flush();
  }

  /** The newest emitted record for `key`, or undefined (test/P3.M3 surface). */
  latest(key: CaptureKey): CaptureRecord | undefined {
    return this.latestRecords.get(canonicalKey(key));
  }

  /**
   * Retirement at a successful handoff (P3.M2.T1.S3; spec :139 — retire
   * only the matching recovery value on deliberate discard, replacement,
   * or successful handoff of that text; architecture note §retirement:
   * "handoff durably recorded, THEN the file is unlinked" — callers MUST
   * have completed the handoff BEFORE calling this).
   *
   * NO-OP unless `{explicit: true}` (draft-store.ts:111 guard precedent).
   * With the flag it:
   *
   * 1. DROPS the key's pending-dirty entry — NEVER flush-then-retire: a
   *    pre-handoff flush landing after the durable unlink would resurrect
   *    retired text (the store-level timers are store-scoped and simply
   *    no-op when their next flush finds nothing pending).
   * 2. Clears the key's last-captured-text gate, so re-typing the SAME
   *    text after retirement still mints a fresh seq (capturable again).
   * 3. KEEPS the per-key seq counter — a genuine post-handoff re-edit
   *    mints ABOVE the durable tombstone and captures normally.
   * 4. Forwards to the injected onRetire (the durable retire), isolated:
   *    a throwing forwarder never breaks the caller (commit/settle paths).
   *
   * `latestRecords` is left untouched: it is process-memory only (dies
   * with the activation, never persisted) and P3.M3 reads the DURABLE
   * layer for seeding — an in-memory record cannot resurrect anything.
   */
  retire(key: CaptureKey, opts?: RetireOptions): void {
    if (!opts?.explicit || this.disposed) return;
    const k = canonicalKey(key);
    this.pending.delete(k); // drop — never flush pre-handoff text
    this.lastValue.delete(k); // same-text re-typed re-mints
    try {
      this.onRetire?.(key);
    } catch {
      // sink isolation (note §failureSemantics): retirement is best-effort;
      // a failed durable retire degrades to a leftover file — a harmless
      // double-record after the handoff (text identical) — never a throw.
    }
  }

  /**
   * Cancel pending timers idempotently (persistence.ts hygiene). NEVER
   * flushes: shutdown flushing is S2's accelerator wiring, and dispose must
   * stay side-effect-free. Post-dispose edits are ignored (their timers
   * could never fire).
   */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.pending.clear();
  }

  /** Flush every dirty key: newest eager-read text per key, seq-minted. */
  private flush(): void {
    this.clearTimers();
    if (this.pending.size === 0) return;
    const entries = [...this.pending];
    this.pending.clear();
    const session = this.resolveSession();
    for (const [k, entry] of entries) {
      this.emit(k, entry.key, entry.text, session);
    }
  }

  /** Mint, record, and deliver ONE capture (seq minted HERE — capture time). */
  private emit(k: string, key: CaptureKey, text: string, session: string): void {
    const seqNum = this.mintSeq(k, key);
    this.lastValue.set(k, text);
    const record: CaptureRecord = { ...key, session, text, seq: seqNum };
    this.latestRecords.set(k, record);
    try {
      this.sink(record);
    } catch {
      // fail silent-and-honest (note §failureSemantics): the in-memory
      // record stands; the next flush retries naturally; never surface.
    }
  }

  /**
   * Per-key monotonic mint (note §ordering: never timestamps, never
   * global). The FIRST mint for a key consults the seedSeq hook exactly
   * once (durable lastSeq baseline → mint seed+1); every later mint is a
   * plain increment. The consult is guarded — a hostile/failed seed
   * degrades to the unseeded counter, never breaks the editor path.
   */
  private mintSeq(k: string, key: CaptureKey): number {
    const prior = this.seq.get(k);
    if (prior !== undefined) {
      // P3.M2.T1.S3 correction: the note's minting rule is seq =
      // ++counter[key] — pre-increment AND PERSIST. The increment path
      // previously returned prior+1 WITHOUT storing it, so every mint after
      // the second returned the same seq (1,2,2,2…) — invisible to S1's
      // two-mint tests, but it broke the per-key monotonic advance the
      // tombstone guard compares against (a post-retire re-edit must mint
      // strictly above the retirement seq, and every later edit must
      // out-seq the one before it).
      const next = prior + 1;
      this.seq.set(k, next);
      return next;
    }
    let base = 0;
    if (this.seedSeq !== undefined) {
      try {
        const seeded = this.seedSeq(key);
        if (typeof seeded === "number" && Number.isFinite(seeded) && seeded > 0) {
          base = Math.floor(seeded);
        }
      } catch {
        base = 0; // failed seed ⇒ unseeded behavior, never a throw upward
      }
    }
    const seqNum = base + 1;
    this.seq.set(k, seqNum);
    return seqNum;
  }

  private resolveSession(): string {
    try {
      return this.sessionResolver?.() ?? "";
    } catch {
      return ""; // a hostile session read degrades the record, never the editor
    }
  }

  /** Idempotent timer cancel (StateMirror seam precedent, persistence.ts). */
  private clearTimers(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.deadlineTimer !== undefined) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
  }
}

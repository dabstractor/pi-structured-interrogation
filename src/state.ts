/**
 * src/state.ts — InterrogationState: the single in-memory source of truth for
 * the pi-interrogator extension (PRD h2.13; storage layer 1 of 3 per
 * spec/state-and-persistence.md).
 *
 * h2.13 is contractual: this module NEVER touches UI. The only import is
 * `node:events` — renderers/panel subscribe to the change events emitted here;
 * this file never references panels, widgets, extension contexts, or pi
 * packages.
 *
 * Everything downstream builds on these types and primitives: merge rules
 * (P1.M1.T2.S2) wrap the raw upsert entry points, the dependsOn evaluator is
 * P1.M1.T2.S3 (this file defines the TYPE only), the snapshot ring is
 * P1.M1.T2.S4 (this file owns the `Snapshot` type + `snapshots` field), the
 * `interrogate` tool consumes `serialize()` for `details.state`
 * (P1.M1.T3.S4), and persistence/reconstruction round-trips through
 * `deserialize()` (P1.M7.T1).
 */
import { EventEmitter } from "node:events";

/** Lifecycle status of a question (h2.17). */
export type QuestionStatus =
  | "open"
  | "answered"
  | "submitted"
  | "reasked"
  | "moot"
  | "withdrawn"
  | "closed";

/** One selectable option of a `type: "choice"` question (h2.17). */
export interface QuestionOption {
  /** Value echoed back in the answer. */
  value: string;
  /** Human-facing label rendered in the panel. */
  label: string;
  /** Consequence note shown under the option. */
  ramification?: string;
}

/** A recorded answer (h2.17). */
export interface QuestionAnswer {
  /** Chosen option value (choice questions) or raw text (text questions). */
  value: string;
  /** Free-text elaboration the user attached. */
  text?: string;
  /** WRITEIN-001: value holds free text, not an option value; renders as ✎ {text}. Not checked against option lists anywhere downstream. */
  custom?: boolean;
  // WRITEIN-002: draft slots are role-less {value, text} — a slot's ROLE is
  // never stored; it is derived at commit/submit time from the CURRENT
  // selection in reconcileDraftsForSubmit (option → elaboration text; Other /
  // type:"text" → the answer value itself, custom: true).
  /** ISO 8601 timestamp of when the answer was recorded. */
  at: string;
}

/** Conditional-visibility dependency between questions (h2.17). */
export interface DependsOn {
  /** Id of the question this one depends on. */
  id: string;
  /** Askable only while the dependency's answer value equals this. */
  equals?: string;
  /** Askable only while the dependency's answer value differs from this. */
  notEquals?: string;
}

/** A single question in the interrogation (h2.17 — field names verbatim). */
export interface Question {
  id: string;
  title?: string;
  prompt: string;
  description?: string;
  type: "choice" | "text";
  options?: QuestionOption[];
  recommendation?: string;
  group?: string;
  gate?: boolean;
  dependsOn?: DependsOn[];
  /**
   * Per-question content revision; starts at 1. Bumps on content mutations
   * only (agent upserts of text/options/dependsOn, withdrawal re-adds).
   * Answers NEVER bump rev — answers are epoch territory (h2.39). The model
   * must echo the current rev when upserting an existing question.
   */
  rev: number;
  status: QuestionStatus;
  answer?: QuestionAnswer;
}

/**
 * Plain-JSON projection of the full state. This is the shape carried in
 * tool-result `details.state`, in `Snapshot.state`, and persisted to the
 * `interrogation-state` entry mirror — details-compatible by construction.
 */
export interface SerializedState {
  goal: string;
  epoch: number;
  /** Question ids in display order. */
  order: string[];
  /** Questions keyed by id (the runtime Map is converted; never store the Map). */
  questions: Record<string, Question>;
  /**
   * One-time completion guard (P1.M2.T2.S2): true once the completion flow
   * cleared this state. serialize() ALWAYS populates it; the field is typed
   * optional so hand-built fixtures (results/snapshots tests) stay valid and
   * legacy payloads remain deserialize-tolerant (missing → false). M7.T1
   * reconstruction restores it to keep exactly-once across restart.
   */
  completed?: boolean;
}

/**
 * A full-state copy taken on every submission (powers diff cards and
 * post-hoc recovery). The ring-of-10 push/trim logic lands in P1.M1.T2.S4;
 * S1 owns the type and the `snapshots` array.
 */
export interface Snapshot {
  epoch: number;
  /** ISO 8601 timestamp of the submission. */
  at: string;
  state: SerializedState;
}

/** Per-group aggregate returned by `groupSummaries()`. */
export interface GroupSummary {
  group: string;
  total: number;
  answered: number;
  submitted: number;
  open: number;
  moot: number;
  withdrawn: number;
  closed: number;
  reasked: number;
}

/** Bucket label for questions that carry no `group`. */
export const UNGROUPED_LABEL = "(none)";

/**
 * Typed event map for {@link InterrogationState}. Payloads are positional
 * tuple types so declaration merging gives consumers fully typed
 * `on`/`once`/`off`/`emit` signatures.
 */
export interface StateEvents {
  /** Any mutation — carries the full serialized post-mutation state. */
  changed: [state: SerializedState];
  /** Agent upserts (merge-rule transitions land in P1.M1.T2.S2) — upserted ids. */
  "questions-upserted": [ids: string[]];
  /** Submission epoch bump — carries the new epoch value. */
  "epoch-bumped": [epoch: number];
  /** Completion flow cleared in-memory questions (epoch/goal/snapshots retained). */
  "completed-cleared": [];
}

/**
 * Typed event surface merged onto {@link InterrogationState}. The generic
 * overloads are resolved first, so consumers get autocomplete and payload
 * types for the four domain events while the raw `EventEmitter` surface
 * remains available underneath.
 */
export interface InterrogationState {
  on<K extends keyof StateEvents>(event: K, listener: (...args: StateEvents[K]) => void): this;
  once<K extends keyof StateEvents>(event: K, listener: (...args: StateEvents[K]) => void): this;
  off<K extends keyof StateEvents>(event: K, listener: (...args: StateEvents[K]) => void): this;
  emit<K extends keyof StateEvents>(event: K, ...args: StateEvents[K]): boolean;
}

/**
 * Authoritative in-memory interrogation state (h2.13).
 *
 * Question state machine (h2.38 — verbatim from spec/state-and-persistence.md §Question state machine):
 *
 *                  upsert(new id)                    user answers/edits
 *    ┌──────────┐ ───────────────► ┌───────────┐ ────────────────────► ┌──────────────────┐
 *    │ (absent) │                  │   open    │                      │ answered(pending) │
 *    └──────────┘                  └─────┬─────┘ ◄──────────────────── └────────┬─────────┘
 *                                        │ upsert changed options              │ ctrl+s
 *         dependsOn unmet (local)        │ (answer reset + marker)             ▼
 *    ┌──────────┐ ◄──────────────────────┤                          ┌──────────────────┐
 *    │   moot   │        ┌───────────┐   │                          │    submitted     │
 *    └────┬─────┘        │  reasked  │ ◄─┘                          └────────┬─────────┘
 *         │ re-met       └─────┬─────┘                                       │ agent_settled
 *         ▼                    │ user answers                                │ (no re-ask)
 *       open ◄─────────────────┘                                             ▼
 *                                                                         ┌──────────────────┐
 *    ┌───────────┐  upsert omission                                        │ closed (archived) │
 *    │ withdrawn │ ◄──────────────────── any status                        └────────┬─────────┘
 *    └───────────┘                                                                  │ user edits
 *         closed+reopen via re-upsert with same id (rev+1) ─────────────────────────┘
 *
 * Terminal and transition notes (h2.38):
 * - `moot`/`withdrawn` are terminal-until-re-upsert; both stay visible
 *   (dimmed, with reason) — the audit trail (Q34=A).
 * - Editing a `closed` answer re-marks it `answered(pending)`; the next
 *   submission diff marks it `(changed)` (Q24=B).
 * - Answer edits apply through the ripple confirm (ui-spec.md) before
 *   entering `answered(pending)`.
 * - `closed` reopens via re-upsert with the same id (rev+1).
 *
 * rev/epoch semantics (h2.39):
 * - `rev` is per question, starts at 1, and bumps on content mutations only.
 *   `bumpRev()` is the raw primitive; merge rules (P1.M1.T2.S2) decide when
 *   it is legal. `applyAnswer()` never touches rev.
 * - `epoch` is session-wide, starts at 1, and bumps on every submission via
 *   `bumpEpoch()`. Guards compare caller epochs against `state.epoch`.
 *
 * Singleton lifecycle (h2.43):
 * - The module-level singleton (`getState()`/`setState()`/`resetState()`) is
 *   NEVER cached across `session_shutdown`. `resetState()` is the only
 *   teardown; lifecycle/persistence code (P1.M7.T1) owns when it is called.
 *   Never hold a reference to the singleton across shutdown/reconstruction.
 *
 * Mutation discipline:
 * - `getQuestion()` and `orderedQuestions()` return the stored objects for
 *   cheap reads — callers must not mutate them. `setGoal`, `upsertQuestion`,
 *   `applyAnswer`, `setStatus`, `bumpRev`, `bumpEpoch`, `removeQuestion`, and
 *   `clearForCompletion` are the only mutation paths, and every one of them
 *   emits `changed` (full serialized snapshot) so renderers stay dumb.
 * - `serialize()` deep-copies (structuredClone), so its output is safe to
 *   hand to tool results, snapshots, and persistence.
 */
export class InterrogationState extends EventEmitter {
  private _goal: string;

  /** Interrogation goal — agent-supplied, updatable via setGoal (FR-30). */
  get goal(): string {
    return this._goal;
  }

  /** Session epoch; starts at 1, bumps on every submission (h2.39). */
  epoch = 1;

  /**
   * One-time completion guard (P1.M2.T2.S2). Default false; set true inside
   * {@link clearForCompletion} — the ONLY live-session assignment site, so
   * the invariant "cleared ⇒ completed" can never diverge. Deserialization
   * restores it from persisted state at construction time (M7.T1) — that is
   * reconstruction, not a live mutation. A NEW interrogation (fresh state)
   * starts false and may complete again.
   */
  completed = false;

  /** Full-state snapshots taken on submissions (ring trimming is P1.M1.T2.S4). */
  readonly snapshots: Snapshot[] = [];

  private readonly questions = new Map<string, Question>();
  private order: string[] = [];

  constructor(goal: string) {
    super();
    this._goal = goal;
  }

  // ------------------------------------------------------------------ reads

  /**
   * The stored question for `id`, or undefined. Do not mutate the returned
   * object — use the mutation methods so `changed` fires.
   */
  getQuestion(id: string): Question | undefined {
    return this.questions.get(id);
  }

  /**
   * Questions in `order[]` sequence. Ids present in `order` but missing from
   * the map (orphans — only possible via tolerant reconstruction) are skipped
   * defensively. Do not mutate the returned objects.
   */
  orderedQuestions(): Question[] {
    const out: Question[] = [];
    for (const id of this.order) {
      const q = this.questions.get(id);
      if (q !== undefined) out.push(q);
    }
    return out;
  }

  /**
   * Per-group aggregates in first-appearance order. Questions without a
   * `group` are counted under {@link UNGROUPED_LABEL}.
   */
  groupSummaries(): GroupSummary[] {
    const byGroup = new Map<string, GroupSummary>();
    for (const q of this.orderedQuestions()) {
      const key = q.group ?? UNGROUPED_LABEL;
      let summary = byGroup.get(key);
      if (summary === undefined) {
        summary = {
          group: key,
          total: 0,
          answered: 0,
          submitted: 0,
          open: 0,
          moot: 0,
          withdrawn: 0,
          closed: 0,
          reasked: 0,
        };
        byGroup.set(key, summary);
      }
      summary.total++;
      summary[q.status]++;
    }
    return [...byGroup.values()];
  }

  // -------------------------------------------------------------- mutations

  /**
   * Updates the interrogation goal (agent re-upserts with a changed goal —
   * FR-30). Not a rev/epoch transition. Emits `changed`. No caps/validation
   * here — the 400-char cap (BUG-009) is enforced at the tool call-site
   * (P1.M1.T1.S2).
   */
  setGoal(goal: string): void {
    this._goal = goal;
    this.emitChanged();
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2).
   *
   * Insert or replace by id. NEW id: forced to status "open" at rev 1
   * (state machine: upsert(new id) → open) and appended to `order[]`.
   * EXISTING id: wholesale replace, position in `order[]` preserved,
   * caller-supplied rev/status kept as-is (S2 owns legality + rev bumps).
   * Emits `questions-upserted` ([id]) then `changed`.
   */
  upsertQuestion(q: Question): void {
    if (this.questions.has(q.id)) {
      this.questions.set(q.id, { ...q });
    } else {
      this.questions.set(q.id, { ...q, rev: 1, status: "open" });
      this.order.push(q.id);
    }
    this.emit("questions-upserted", [q.id]);
    this.emitChanged();
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2). Deletes the question from the map and `order[]`
   * (used by S2 for withdrawn/archival variants). Emits `changed`.
   */
  removeQuestion(id: string): void {
    this.questions.delete(id);
    const i = this.order.indexOf(id);
    if (i !== -1) this.order.splice(i, 1);
    this.emitChanged();
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2). Records the answer and moves status to
   * `answered` (pending state per h2.38). MUST NOT touch rev — answers are
   * epoch territory (h2.39). Emits `changed`.
   */
  applyAnswer(id: string, answer: QuestionAnswer): void {
    const q = this.questions.get(id);
    if (q === undefined) throw new Error(`unknown question id: ${id}`);
    q.answer = { ...answer };
    q.status = "answered";
    this.emitChanged();
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2). Applies an arbitrary status transition without
   * touching rev. Emits `changed`.
   */
  setStatus(id: string, status: QuestionStatus): void {
    const q = this.questions.get(id);
    if (q === undefined) throw new Error(`unknown question id: ${id}`);
    q.status = status;
    this.emitChanged();
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2). Increments the question's content revision and
   * emits `changed`. Throws on unknown ids.
   */
  bumpRev(id: string): void {
    const q = this.questions.get(id);
    if (q === undefined) throw new Error(`unknown question id: ${id}`);
    q.rev++;
    this.emitChanged();
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2). Bumps the session epoch (one bump per submission),
   * emits `epoch-bumped` (new value) then `changed`, and returns the new
   * epoch. The snapshot ring pushes into `snapshots` here in P1.M1.T2.S4.
   */
  bumpEpoch(): number {
    this.epoch++;
    this.emit("epoch-bumped", this.epoch);
    this.emitChanged();
    return this.epoch;
  }

  /**
   * Raw primitive. Merge rules / transition legality enforced in merge-rules
   * module (P1.M1.T2.S2). Completion flow: clears questions and order but
   * retains `goal`, `epoch`, and `snapshots` (audit trail). Emits
   * `completed-cleared` then `changed`.
   */
  clearForCompletion(): void {
    this.questions.clear();
    this.order = [];
    // One-time guard (P1.M2.T2.S2): cleared ⇒ completed, atomically — this
    // is the ONLY live-session assignment site for the flag.
    this.completed = true;
    this.emit("completed-cleared");
    this.emitChanged();
  }

  // ------------------------------------------------- serialize / round-trip

  /**
   * Plain-JSON projection of the full state. The runtime Map is converted to
   * a `Record` keyed by id (never JSON.stringify a Map — it yields `{}`) and
   * everything is deep-copied via structuredClone so callers cannot mutate
   * internals. Shape is tool-`details`-compatible (P1.M1.T3.S4).
   */
  serialize(): SerializedState {
    const questions: Record<string, Question> = {};
    for (const [id, q] of this.questions) questions[id] = structuredClone(q);
    return structuredClone({
      goal: this.goal,
      epoch: this.epoch,
      order: [...this.order],
      questions,
      completed: this.completed,
    });
  }

  /**
   * Tolerant inverse of {@link serialize}. Input is untrusted (persisted
   * custom entries / tool-result details — P1.M7.T1): object guards before
   * narrowing; missing/invalid fields fall back to defaults (status "open",
   * rev 1, epoch 1, type "choice", goal ""); malformed question entries are
   * skipped, never thrown. `order[]` is normalized: duplicates dropped,
   * ids missing from the questions map dropped, and map ids absent from
   * `order[]` appended at the end. Emits NO events.
   */
  static deserialize(data: unknown): InterrogationState {
    const raw = isObj(data) ? data : {};
    const state = new InterrogationState(String(raw.goal ?? ""));
    state.epoch =
      typeof raw.epoch === "number" && Number.isFinite(raw.epoch) ? raw.epoch : 1;
    // Tolerant restore of the one-time guard (M7.T1 reconstruction seam);
    // anything but literal true falls back to the fresh-state default.
    state.completed = raw.completed === true;

    const seen = new Set<string>();
    if (isObj(raw.questions)) {
      for (const [id, value] of Object.entries(raw.questions)) {
        const q = reviveQuestion(id, value);
        if (q === undefined) continue; // skip malformed entries
        state.questions.set(id, q);
        seen.add(id);
      }
    }

    const orderRaw = Array.isArray(raw.order)
      ? raw.order.filter((entry): entry is string => typeof entry === "string")
      : [];
    const order: string[] = [];
    for (const id of orderRaw) {
      if (!seen.has(id) || order.includes(id)) continue;
      order.push(id);
    }
    for (const id of state.questions.keys()) {
      if (!order.includes(id)) order.push(id); // append map ids missing from order[]
    }
    state.order = order;
    return state;
  }

  // --------------------------------------------------------------- internal

  /** Every mutation funnels through here: `changed` carries the full snapshot. */
  private emitChanged(): void {
    this.emit("changed", this.serialize());
  }
}

// -------------------------------------------------------------------- guards

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const STATUSES: readonly QuestionStatus[] = [
  "open",
  "answered",
  "submitted",
  "reasked",
  "moot",
  "withdrawn",
  "closed",
];

const isStatus = (v: unknown): v is QuestionStatus =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/** Rebuild one question tolerantly; returns undefined for malformed entries. */
function reviveQuestion(id: string, value: unknown): Question | undefined {
  if (!isObj(value)) return undefined;
  const q: Question = {
    id,
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    type: value.type === "text" ? "text" : "choice",
    rev: typeof value.rev === "number" && Number.isFinite(value.rev) ? value.rev : 1,
    status: isStatus(value.status) ? value.status : "open",
  };
  if (typeof value.title === "string") q.title = value.title;
  if (typeof value.description === "string") q.description = value.description;
  if (typeof value.recommendation === "string") q.recommendation = value.recommendation;
  if (typeof value.group === "string") q.group = value.group;
  if (typeof value.gate === "boolean") q.gate = value.gate;
  if (Array.isArray(value.options)) {
    const options: QuestionOption[] = [];
    for (const item of value.options) {
      if (!isObj(item) || typeof item.value !== "string" || typeof item.label !== "string") {
        continue;
      }
      const option: QuestionOption = { value: item.value, label: item.label };
      if (typeof item.ramification === "string") option.ramification = item.ramification;
      options.push(option);
    }
    q.options = options;
  }
  if (Array.isArray(value.dependsOn)) {
    const dependsOn: DependsOn[] = [];
    for (const item of value.dependsOn) {
      if (!isObj(item) || typeof item.id !== "string") continue;
      const dep: DependsOn = { id: item.id };
      if (typeof item.equals === "string") dep.equals = item.equals;
      if (typeof item.notEquals === "string") dep.notEquals = item.notEquals;
      dependsOn.push(dep);
    }
    q.dependsOn = dependsOn;
  }
  if (
    isObj(value.answer) &&
    typeof value.answer.value === "string" &&
    typeof value.answer.at === "string"
  ) {
    const answer: QuestionAnswer = { value: value.answer.value, at: value.answer.at };
    if (typeof value.answer.text === "string") answer.text = value.answer.text;
    if (value.answer.custom === true) answer.custom = true; // strict true — corrupt truthy values must not leak into state
    q.answer = answer;
  }
  return q;
}

// ------------------------------------------------------ factory + singleton

/** Thin constructor wrapper (test/extension seam). */
export function createInterrogationState(goal: string): InterrogationState {
  return new InterrogationState(goal);
}

let current: InterrogationState | undefined;

/** The session singleton, or undefined before creation / after reset. */
export function getState(): InterrogationState | undefined {
  return current;
}

/**
 * Internal seam for reconstruction (P1.M7.T1.S2): install a deserialized
 * state as the session singleton. Lifecycle/persistence code owns the timing
 * (h2.43 — never cached across session_shutdown).
 */
export function setState(state: InterrogationState): void {
  current = state;
}

/**
 * Only teardown for the singleton (h2.43). Called by lifecycle/persistence
 * on session_shutdown and before reconstruction.
 */
export function resetState(): void {
  current = undefined;
}

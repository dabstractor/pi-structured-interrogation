/**
 * src/draft-store.ts — the R4 draft store (P1.M4.T2.S1).
 *
 * [Mode A] DraftStore — R4 "drafts are sacred" (h2.45; h2.0 commitment 6).
 * Holds per-question `{questionId → {value, text}}` slots plus the batch
 * note (R3) in EXTENSION memory: the single instance is constructed once per
 * extension activation (index.ts closure) and handed to every openPanel —
 * panel components are disposable, the store is not.
 *
 * Survival matrix (authoritative — h2.45):
 * | Event                                  | Drafts                                   |
 * |----------------------------------------|------------------------------------------|
 * | question navigation                    | preserved                                |
 * | short/deep/overview view toggles       | preserved                                |
 * | upserts (merge rule 1/2 answer reset + | preserved — this store subscribes to     |
 * | rev bump, rule 4 withdraw)             | NOTHING; merge.ts:17-19 never touches    |
 * |                                        | drafts and neither do we (h2.21 rule 2)  |
 * | suspend/resume (panel re-created)      | preserved — store lives in extension     |
 * |                                        | memory, outside every panel component    |
 * | submit (text answers ship)             | DESTROYED — shipped ids only, via        |
 * |                                        | shipDrafts(diff.changed) in actions.ts   |
 * | explicit user clear                    | DESTROYED — that id, via clearDraft      |
 * |                                        | with {explicit: true}                    |
 * | process restart                        | LOST — by design (Q6=B): nothing in this |
 * |                                        | module touches disk or persistence.ts    |
 *
 * Destruction safety: clearDraft/clearAll are NO-OPS unless called with
 * `{explicit: true}` — accidental draft destruction is THE disqualifying
 * failure mode (commitment 6). Only submit (shipDrafts) and explicit user
 * action may remove slots.
 *
 * Restart loss is a documented limitation (Q6=B): h2.45 excludes drafts
 * from every persistent layer; persistence.ts (P1.M7.T1) MUST NOT
 * serialize this store.
 */

/** The {value, text} shape per the h2.45 drafts lifecycle item contract. */
export interface DraftEntry {
  /** The chosen option value; for free-text drafts this is the question id. */
  value: string;
  /** The typed-but-unsubmitted text. */
  text: string;
}

/** Guard options for destructive operations (R4 explicit-only rule). */
export interface ClearOptions {
  /**
   * R4: drafts are destroyed ONLY by explicit user action (or submit).
   * Without `true`, destructive calls are no-ops.
   */
  explicit?: boolean;
}

/**
 * Extension-memory draft store implementing panel.ts's `DraftStore` seam
 * (getDraft/setDraft/getNote/setNote) plus the extended lifecycle API
 * (setDraftEntry/hasDraft/clearDraft/clearAll/shipDrafts).
 *
 * Deliberately inert: NO EventEmitter, NO state-event subscriptions, NO
 * filesystem. Survival is achieved by WHERE the instance lives, not by any
 * preservation code.
 */
export class DraftStore {
  private readonly slots = new Map<string, DraftEntry>();
  private noteText = "";

  // ------------------------------------------------------------- seam (panel.ts DraftStore)

  /** The draft text for `questionId`, or undefined when no slot exists. */
  getDraft(questionId: string): string | undefined {
    return this.slots.get(questionId)?.text;
  }

  /** Seam upsert — stores `{value: questionId, text}` (the item contract shape). */
  setDraft(questionId: string, text: string): void {
    this.setDraftEntry(questionId, { value: questionId, text });
  }

  /** Batch note (R3) — "" when unset. */
  getNote(): string {
    return this.noteText;
  }

  /** Batch note (R3) — storage only; NOTE-mode UI + delivery is P1.M4.T2.S2. */
  setNote(text: string): void {
    this.noteText = text;
  }

  // ------------------------------------------------------------- extended API

  /** Full-shape upsert — the complete `{value, text}` entry. */
  setDraftEntry(questionId: string, entry: DraftEntry): void {
    this.slots.set(questionId, { value: entry.value, text: entry.text });
  }

  /**
   * ✎-marker data for the short view (layout.ts): true only when a slot
   * exists AND its text is non-empty — an empty-text slot is an absent
   * draft (the user cleared the field); the marker must not light for it.
   */
  hasDraft(questionId: string): boolean {
    const entry = this.slots.get(questionId);
    return entry !== undefined && entry.text !== "";
  }

  /**
   * Remove one slot — NO-OP unless `opts.explicit === true` (R4: drafts are
   * never destroyed except by explicit user action). Returns whether the
   * slot was removed; an explicit clear may remove an empty-text slot too.
   */
  clearDraft(questionId: string, opts?: ClearOptions): boolean {
    if (opts?.explicit !== true) return false;
    return this.slots.delete(questionId);
  }

  /**
   * Remove ALL slots — same explicit gate as clearDraft. The batch note is
   * KEPT: it has its own lifecycle (R3, P1.M4.T2.S2); an explicit
   * clearNote() for future callers can pair with this.
   */
  clearAll(opts?: ClearOptions): void {
    if (opts?.explicit !== true) return;
    this.slots.clear();
  }

  /**
   * Submit flush: remove and return the entries for `ids` (all slots when
   * omitted). Called by the panel submit path AFTER buildSubmission — the
   * submission message is built from state (the diff), not drafts, so
   * post-build deletion is failure-safe. The returned entries are the
   * shipped text answers' provenance record.
   */
  shipDrafts(ids?: string[]): Map<string, DraftEntry> {
    const shipped = new Map<string, DraftEntry>();
    const targets = ids ?? [...this.slots.keys()];
    for (const id of targets) {
      const entry = this.slots.get(id);
      if (entry) {
        shipped.set(id, entry);
        this.slots.delete(id);
      }
    }
    return shipped;
  }
}

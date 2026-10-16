/**
 * src/panel/branch-snapshot.ts — the SIDECHAT-003 context half
 * (P1.M1.T4.S1): a pure, ONE-SHOT branch-snapshot pipeline that turns the
 * main session's current branch into the frozen `Message[]` replay stored
 * on the side-chat record at creation (sidechat.ts's `branchSnapshot`).
 *
 * Read-only by construction: the only session-manager method ever called
 * is `getBranch()` — no session writes of any kind (SIDECHAT-005/M3.T1
 * banned-API clean). Pi knowledge lives HERE, never in sidechat.ts (its
 * zero-pi-imports purity gate is load-bearing).
 */
import { convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

/** The read-only session surface this pipeline needs. `Pick<Pick<SessionManager,
 * ...>, "getBranch">` collapses to exactly this — the dist's internal
 * `ReadonlySessionManager` alias is not re-exported from the package root,
 * so the Pick is spelled against the exported class (structurally identical). */
type BranchReader = Pick<SessionManager, "getBranch">;

/** The frozen branch replay: pi-ai Messages, captured once at chat creation (SIDECHAT-003). */
export type BranchSnapshotMessages = readonly Message[];

/** [Mode A] ONE-SHOT branch snapshot (SIDECHAT-003): getBranch() (ALL entry types,
 * root→leaf path order, NOT compaction-aware — full replay by design) →
 * sessionEntryToContextMessages (pi's own context projection: message/custom_message/
 * branch_summary/compaction contribute; model_change/custom/label/session_info/
 * thinking_level_change contribute nothing) → convertToLlm (AgentMessage[] → Message[],
 * custom messages become user messages — compaction.ts:91 precedent) → Object.freeze.
 * READ-ONLY: only getBranch() is called; never writes the session (SIDECHAT-005).
 * Stored on the SidechatRecord ONCE at creation by openOrReplace's deps bag; NEVER
 * re-read mid-chat — mid-chat submissions leave it stale (accepted v1, SIDECHAT-003). */
export function takeBranchSnapshot(
  sessionManager: BranchReader,
): BranchSnapshotMessages {
  const agentMessages = sessionManager.getBranch().flatMap(sessionEntryToContextMessages);
  return Object.freeze(convertToLlm(agentMessages));
}

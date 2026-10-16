/**
 * src/panel/sidechat-prompt.ts — the SIDECHAT-003 system-prompt half
 * (P1.M1.T4.S2): a pure, deterministic builder that assembles the side
 * chat's OWN system prompt (deliberately NO prefix share with the main
 * conversation's cache) from plain data, in five fixed sections: role
 * framing; the question VERBATIM (full prompt, full description, EVERY
 * option's full ramification — the deep-view quality contract, no
 * truncation anywhere, CAPS-OUT-001 spirit); the session goal; a
 * one-line-per-question answers digest; and the SIDECHAT-004 answer
 * protocol (fenced ```answer block, strict JSON).
 *
 * Purity is load-bearing: the only import is a type-only Question from
 * ../state.js — no runtime imports, no pi-package knowledge (the
 * SIDECHAT-005/M3.T1 banned-API guard surface), arguments only (it must
 * NOT read live state: the store invokes it ONCE per record creation,
 * sidechat.ts buildFresh, and never mid-chat — staleness accepted v1).
 * Consumers (no wiring in this task): M2.T4.S1 injects
 * `buildSystemPrompt: () => buildSideChatSystemPrompt(...)` into the
 * SidechatRebindDeps bag; T5.S1 reads `record.systemPrompt` into pi-ai
 * `Context.systemPrompt`; T6.S1's parser relies on the protocol section
 * to make the ```answer block reachable.
 */
import type { Question } from "../state.js";

/**
 * [Mode A] SIDECHAT-003 side-chat system prompt (P1.M1.T4.S2): assemble the
 * five fixed sections from the target question, the session goal, and the
 * ordered question list. VERBATIM + FULL everywhere — the one sanctioned
 * transformation is whitespace-run collapsing in the digest's prompt (keeps
 * each digest entry on one line; never elides or caps characters). Custom
 * write-in answers ship their `value` text verbatim (it IS the user's
 * words); unanswered questions render their plain status word. Deterministic:
 * identical inputs → identical (===) output.
 */
export function buildSideChatSystemPrompt(
  question: Question,
  goal: string,
  questionsWithAnswers: readonly Question[],
): string {
  const sections: string[] = [];

  // 1. Role framing — ONE question is the subject; the rest is digest context.
  sections.push(
    "You are the user's private advisor for exactly ONE question — the one in the next section. " +
      "Help the user think it through. Other questions appear ONLY in the answers digest; they are " +
      "context, never your subject.",
  );

  // 2. The question verbatim — no truncation, no elision, no reflow.
  const options = question.options ?? [];
  const qLines: string[] = [
    `## The question (${question.id} · type: ${question.type})`,
    "",
    question.prompt,
  ];
  if (question.description !== undefined && question.description !== "") {
    qLines.push("", question.description);
  }
  if (options.length > 0) {
    qLines.push("", "Options:");
    for (const option of options) {
      qLines.push(`- ${option.label} (value: ${option.value})`);
      if (option.ramification !== undefined && option.ramification !== "") {
        qLines.push(`    ${option.ramification}`);
      }
    }
  } else {
    qLines.push(
      "",
      "This is a free-text question: there are no options to pick from — the answer is the user's own words.",
    );
  }
  sections.push(qLines.join("\n"));

  // 3. The goal, verbatim on its own line.
  sections.push(`## The goal\n\n${goal}`);

  // 4. Answers digest — EXACTLY one line per question. Whitespace runs in the
  // prompt collapse to single spaces so the line stays one line; write-in
  // values (custom answers) ARE user text and ship verbatim; unanswered
  // questions render the plain status word.
  sections.push(
    `## Answers so far\n\n${questionsWithAnswers
      .map((q) => {
        const oneLinePrompt = q.prompt.replace(/\s+/g, " ").trim();
        return `- ${q.id} · ${oneLinePrompt} → ${q.answer ? `answered: ${q.answer.value}` : q.status}`;
      })
      .join("\n")}`,
  );

  // 5. Answer protocol (SIDECHAT-004) — the instruction differs by question
  // type: a choice question accepts BOTH forms (option byte-match value form,
  // or the write-in text form — apply routes write-ins through the write-in
  // commit path); a text question takes ONLY the text form.
  const choiceWithOptions = question.type === "choice" && options.length > 0;
  const pLines: string[] = [
    "## Answer protocol",
    "",
    "Once you and the user have converged on an answer, your reply MUST END with a fenced code " +
      "block tagged `answer` — it opens with ```answer, closes with ```, contains strict JSON, and " +
      "NOTHING may follow it:",
    "",
    "```answer",
    choiceWithOptions ? '{"value": "<exact option value>"}' : '{"text": "..."}',
    "```",
    "",
  ];
  if (choiceWithOptions) {
    pLines.push(
      "This is a choice question, so the block is one of:",
      `- {"value": "<exact option value>"} — the value must byte-match one of the options above EXACTLY (for example: {"value": ${JSON.stringify(options[0]?.value)}} selects that option)`,
      `- {"text": "..."} — when the converged answer is the user's own words (a write-in), the text IS the answer`,
    );
  } else {
    pLines.push(
      "This is a free-text question, so the block is always:",
      `- {"text": "..."} — the user's own words verbatim; there is no option value to pick`,
    );
  }
  pLines.push("", "Until you have converged, keep discussing without emitting the block.");
  sections.push(pLines.join("\n"));

  return sections.join("\n\n");
}

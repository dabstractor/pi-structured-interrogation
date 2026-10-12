# Tool Protocol — `interrogate`

One tool, four action shapes. The goal is fewest context tokens without losing performance: the description is resident (~110 words, always active per Q26=A); everything else is pay-per-use.

## Schema (typebox)

```ts
const OptionSchema = Type.Object({
  value: Type.String({ description: "Option value returned when selected" }),
  label: Type.String({ description: "One-line short-view label; the detail belongs in ramification" }),
  ramification: Type.Optional(Type.String({ description: "Deep-view prose: standalone consequences of picking this option — what changes, effort, risk, trade-offs. Assume the reader sees ONLY this text: expand your reasoning, define terms, no shorthand/codewords, no 'as discussed'" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable identity you choose; never reuse for a different question" }),
  title: Type.Optional(Type.String({ description: "Short label used in digests and overview" })),
  prompt: Type.String({ description: "Short-form question text shown by default" }),
  description: Type.Optional(Type.String({ description: "Deep-view context, fully standalone: assume the reader has NOT seen the conversation. Take the explanation you would normally give and EXPAND it — define terms/acronyms, state concrete facts, lay out the decision space — never compress to shorthand. First sentence doubles as the short-view hint" })),
  type: StringEnum(["choice", "text"]),
  options: Type.Optional(Type.Array(OptionSchema, { description: "Required for type=choice" })),
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor" })),
  group: Type.Optional(Type.String({ description: "Grouping label; groups render as sections" })),
  gate: Type.Optional(Type.Boolean({ description: "Mark this question's group as the foundational gate group" })),
  dependsOn: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ description: "Question this one depends on" }),
    equals: Type.Optional(Type.String()),
    notEquals: Type.Optional(Type.String()),
  }), { description: "Moot conditions evaluated locally as the user answers" })),
  rev: Type.Optional(Type.Integer({ description: "REQUIRED when updating an existing question: the rev you last saw" })),
});

const InterrogateParams = Type.Object({
  goal: Type.Optional(Type.String({ description: "What these questions drive toward; shown in the panel header" })),
  epoch: Type.Optional(Type.Integer({ description: "REQUIRED with questions/answers: the session epoch you last saw (guards stale updates)" })),
  questions: Type.Optional(Type.Array(QuestionSchema, { description: "Upsert (surgical): only the ids sent are created or updated — omitted live questions are untouched. To prune by omission, resend the full live set with withdrawOmitted: true" })),
  withdrawOmitted: Type.Optional(Type.Boolean({ description: "Set-replace mode: live ids omitted from this batch withdraw (answers kept). Only meaningful alongside questions[]; omission alone NEVER withdraws" })),
  reopen: Type.Optional(Type.Boolean({ description: "Resurface the panel with existing state" })),
  answers: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), value: Type.String(), text: Type.Optional(Type.String()),
  }), { description: "Non-TUI fallback only: record the user's chat answers" })),
});
```

## Actions

| Call | Action | Returns |
|---|---|---|
| `{questions:[...], goal?}` | Upsert (merge rules below) | Status line + "end your turn" instruction + withdrawal notices if any |
| `{}` | Read | goal, epoch, group summary, per-question FULL content blocks (one-liner + prompt/description/options/meta — 2026-09-15 pin). NEVER surfaces the panel (SURFACE-001) |
| `{reopen:true}` | Resurface panel | Confirmation |
| `{answers:[...]}` | Record user answers (non-TUI only; ignored in TUI) | Status line |

Answer values in results and deltas may be WRITE-INS (WRITEIN-001): the user's own text, committed via the Other row, shown as `✎ {text}` and flagged `custom`. Submissions may arrive without any user submit keypress — the panel auto-submits the moment every question is answered, and again on every subsequent answer commit while the set stays complete (AUTOSUBMIT-001): expect several small deltas during an edit pass instead of one batch; the read `{}` is the pull-refresh between them.

## Merge rules on upsert (by id)

1. Existing id, same option values → text/description/ramification updates apply silently; existing answer and rev-bump; drafts untouched.
2. Existing id, changed options → answer reset, status `reasked` (⟳ marker), rev-bump; panel draft *preserved* (surfaces when the user revisits).
3. New id → appended, status `open`, rev 1.
4. FLAG-GATED (2026-09-15 pin): omitted live ids withdraw (⊗ marker, kept in map with reason "withdrawn") ONLY when `withdrawOmitted: true` is sent. Default is patch semantics — omitted live ids are UNTOUCHED, so a surgical 1–2 question edit can never withdraw the plan.

## Guards (Q38=A)

- **rev**: every mutation of an existing question requires its current `rev`; mismatch → `isError` result: `STALE: {id} is at rev {n} (you sent {m}). Current: {text}. Re-apply.`
- **epoch**: any `questions`/`answers` call must carry the session `epoch` it was based on (top-level optional `epoch` param; read/submission results always include it); mismatch → `isError` with the delta digest since the model's epoch and current epoch.
- Read (`{}`) is always allowed — pull refresh is never guarded.

## No caps (CAPS-OUT-001, 2026-10-08 owner ruling)

- NOTHING is limited: any number of questions, any number of options, any
  length of description/ramification/goal text. No truncation, no drops,
  no warnings about text size — the tool passes everything through
  verbatim. (The former caps engine — description/ramification/options/
  questions/goal limits and minimum-floor lints — is deleted.)

## Agent-facing text (resident; ≤120 words)

**Tool description:**

> Structured interrogation: plan by asking the user questions they answer in a persistent panel. Upsert `questions[]` surgically — only sent ids are created or updated (stable ids; existing questions require their current `rev`); omitted questions are untouched. To prune, resend the full live set with `withdrawOmitted: true` so omitted ids withdraw. Call with `{}` to read full current state, goal, and epoch. Answers arrive as submission messages — re-ask only those materially affected. First round: few broad foundational questions with key ramifications; send the full set up front. The question set is the plan: when it completes, the full record is injected — derive the spec from it, don't re-plan. If unsure your view is current, read before upserting.

**promptGuidelines (4 bullets — third added by the 2026-09-15 deep-view quality pin, fourth by the 2026-09-15 patch-semantics pin):**

- Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.
- After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.
- The user decides from description/ramification alone — they must not need the conversation or external docs. Write them as fully expanded, self-contained prose (define terms, concrete facts, no shorthand or codewords). If the tool result warns a deep-view field is thin, re-upsert it expanded with the current rev.
- Omission never withdraws: edit surgically by resending only the questions you are changing (with their current revs). Prune deliberately by resending the kept set with withdrawOmitted: true.

## Result rendering (TUI)

`renderCall`: one-line row `interrogate {n} questions {+m new ~k updated}`. `renderResult`: status line + epoch; `expanded` shows full state summary. Renderers stay compact — the panel is the display, not the tool row.

## Non-TUI fallback (FR-25)

`ctx.mode !== "tui" || !ctx.hasUI` → no panel. The upsert result contains a numbered markdown digest (id, title, prompt, options with ★ marks, recommendation); the description instructs the model to relay it verbatim in chat. The user answers in their next prompt; the model records via `{answers:[...]}` (epoch-guarded). Read/completion work identically. Completion record is still injected once at close. The digest is the no-panel surface.

**Emission hooks:** A non-TUI record that records ≥1 answer invokes `onAnswersRecorded` (wired to `lifecycle.noteSubmissionDelivered`) so re-asked-then-re-answered ids close at that run's settle (AC-11). The executor stays UI-free and event-free — hooks only.

## Plain-text round detection (FR-26, TUI only)

After `agent_settled`, if the final assistant message contains ≥3 lines matching `/^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/` and no interrogate upsert occurred this run → `ctx.ui.notify("Question round detected in chat — /interrogate to move it into the panel")`. Throttled to once per 3 turns; config toggle `roundDetection` (default on); never transforms content.

## Status line format (shared by results and panel footer)

`{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}`

`answered` counts questions with a decision on record: `answer` present and
status one of `answered`/`submitted`/`closed`. `withdrawn`/`moot` never count
as answered (their own segments report them). The same record-derived rule
governs the panel header, group summary lines, and the suspend widget line
(2026-10-02: single source of truth — the counter can no longer read `0/6`
above six questions that all display recorded answers).

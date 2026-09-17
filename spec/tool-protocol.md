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
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" })),
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
  questions: Type.Optional(Type.Array(QuestionSchema, { description: "Upsert. Omitting an existing id withdraws it" })),
  reopen: Type.Optional(Type.Boolean({ description: "Resurface the panel with existing state" })),
  answers: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), value: Type.String(), text: Type.Optional(Type.String()),
  }), { description: "Non-TUI fallback only: record the user's chat answers" })),
});
```

## Actions

| Call | Action | Returns |
|---|---|---|
| `{questions:[...], goal?}` | Upsert (merge rules below) | Status line + "end your turn" instruction + caps warnings if any |
| `{}` | Read | goal, epoch, group summary, per-question one-liners `{id, title, status, rev, answer?}` |
| `{reopen:true}` | Resurface panel | Confirmation |
| `{answers:[...]}` | Record user answers (non-TUI only; ignored in TUI) | Status line |

## Merge rules on upsert (by id)

1. Existing id, same option values → text/description/ramification updates apply silently; existing answer and rev-bump; drafts untouched.
2. Existing id, changed options → answer reset, status `reasked` (⟳ marker), rev-bump; panel draft *preserved* (surfaces when the user revisits).
3. New id → appended, status `open`, rev 1.
4. Existing id omitted → withdrawn (⊗ marker, kept in map with reason "withdrawn").

## Guards (Q38=A)

- **rev**: every mutation of an existing question requires its current `rev`; mismatch → `isError` result: `STALE: {id} is at rev {n} (you sent {m}). Current: {text}. Re-apply.`
- **epoch**: any `questions`/`answers` call must carry the session `epoch` it was based on (top-level optional `epoch` param; read/submission results always include it); mismatch → `isError` with the delta digest since the model's epoch and current epoch.
- Read (`{}`) is always allowed — pull refresh is never guarded.

## Caps (Q27=A, configurable + scaled)

- Defaults: `description ≤ max(1200, budget/questionCount)` chars; `ramification ≤ 600`; `options ≤ 7`; `questions ≤ 40`; `goal ≤ 400`.
- Minimums (2026-09-15 deep-view quality pin, warn-only): a provided `description` under `minDescription` (200), an option `ramification` under `minRamification` (120), or an option with NO ramification at all — each produces a warning in the upsert result naming the field and instructing an expanded re-upsert. Never mutates, never rejects; `0` disables each floor.
- Budget scaling: `totalDescriptionBudget = min(0.04 × ctx.model.contextWindow, 60000)` tokens-equivalent (chars ≈ 4×tokens), divided across the batch.
- Over-budget content is **truncated with an explicit warning in the tool result** ("q7 description truncated at 2100 chars — restructure if essential"). Never a hard reject; all numbers overridable via config.

## Agent-facing text (resident; ≤120 words)

**Tool description:**

> Structured interrogation: plan by asking the user questions they answer in a persistent panel. Upsert `questions[]` (stable ids; existing questions require their current `rev`; omitting an id withdraws it). Call with `{}` to read current state, goal, and epoch. Answers arrive as submission messages — consider how they affect your other questions and re-ask only those materially affected (upsert with new rev). First round: few broad foundational questions with key ramifications; refine in later rounds; send the full set up front. The question set is the plan: when it completes, the full record is injected — derive the spec from it, don't re-plan. If unsure your view is current, read before upserting.

**promptGuidelines (3 bullets — third added by the 2026-09-15 deep-view quality pin):**

- Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.
- After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.
- The user decides from description/ramification alone — they must not need the conversation or external docs. Write them as fully expanded, self-contained prose (define terms, concrete facts, no shorthand or codewords). If the tool result warns a deep-view field is thin, re-upsert it expanded with the current rev.

## Result rendering (TUI)

`renderCall`: one-line row `interrogate {n} questions {+m new ~k updated}`. `renderResult`: status line + epoch; `expanded` shows full state summary. Renderers stay compact — the panel is the display, not the tool row.

## Non-TUI fallback (FR-25)

`ctx.mode !== "tui" || !ctx.hasUI` → no panel. The upsert result contains a numbered markdown digest (id, title, prompt, options with ★ marks, recommendation); the description instructs the model to relay it verbatim in chat. The user answers in their next prompt; the model records via `{answers:[...]}` (epoch-guarded). Read/completion work identically. Completion record is still injected once at close.

## Plain-text round detection (FR-26, TUI only)

After `agent_settled`, if the final assistant message contains ≥3 lines matching `/^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/` and no interrogate upsert occurred this run → `ctx.ui.notify("Question round detected in chat — /interrogate to move it into the panel")`. Throttled to once per 3 turns; config toggle `roundDetection` (default on); never transforms content.

## Status line format (shared by results and panel footer)

`{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}`

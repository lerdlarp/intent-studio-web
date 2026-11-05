# AI

The AI is advisory. It proposes; the deterministic solver and estimator decide and compute. Every task has a rules
fallback in core, so the app is fully usable offline.

## Tasks

| Task (`POST /api/ai/:task`) | Input | Output | Rules fallback |
|---|---|---|---|
| `advise` | room + intents (first 10 are sent) | per intent: label, target range and reason, plane height, CCT | core `advise` defaults (space class tables) |
| `interpret` | room + a sentence | intents | core interpreter |
| `classify` | objects of a room being imported | object kind per object | keyword classifier |
| `propose` | room + current intents | suggested intents with CCT and a rationale | core `seed` |

Responses carry `source: "ai" | "rules"` and, when the rules were used, `lastIssue`: "The agent is offline - using
rules", "The agent took too long - using rules", "The agent is busy (request limit) - using rules" or "The agent reply
could not be read - using rules".

## Prompts

System prompts are built in core (`adviseSystemPrompt`, `interpretSystemPrompt`) and
`apps/server/src/ai/prompts/{classify,propose}.ts`. Host data is wrapped as `<host-guidance kind="...">` compact JSON;
designer text as `<designer-text>`, which the prompts tell the model to treat as data only. The system prompt and
target tables are identical between calls and are marked for prompt caching.

## Validation

1. A lenient JSON reader extracts objects from the reply (keeps the first duplicate key).
2. zod schemas validate; unknown fields are dropped.
3. Numbers are clamped to sane ranges; CCT must be in the allowed set.
4. Merge is per field over the fallback: a bad field costs only that field.
5. Never overwritten: designer-edited label, target/reason (`targetEdited`), designer-chosen CCT, hand-tuned/pinned fixtures.

The runner (`apps/server/src/ai/run.ts`) adds a per-call timeout (`AI_TIMEOUT_MS`), one retry for transient errors, a
sliding-window budget (`AI_BUDGET_PER_MIN`) and logging to the `ai_log` table.

## Evals

`pnpm eval` runs advise, interpret (5 phrases), classify and propose over 4 demo rooms and 3 imported-style rooms
through the real runner. It asserts invariants (valid schema, targets within the target table's range +/-25 %, no forbidden words, label and
reason length limits, designer-edited fields untouched after applying advice) rather than exact wording. Results go to `scripts/eval/results/<timestamp>/` (`advise.json`, ...,
`summary.json`); the exit code is non-zero on any failure. In CI the eval runs in rules mode (no key).

### Live evals

```sh
ANTHROPIC_API_KEY=sk-ant-... AI_MODEL=claude-sonnet-5-5 pnpm eval
```

This makes real, billed API calls (roughly a few hundred small requests). Compare `summary.json` between models or
prompt changes; any `failures` entry names the room, task and assertion. The live path is also covered offline in
`apps/server/test/eval.test.ts` with a fake client.

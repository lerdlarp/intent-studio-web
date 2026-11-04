# Clean-room protocol

This is a clean-room reimplementation. The original C# source is **not** in this repository and implementers must
never read it.

- **Spec team** (separate agents, outside this repo) read the original source and wrote `handoff/spec/*.md`:
  behaviour, algorithms in prose/math, constants, thresholds, ordering, tie-breaks, user-visible strings, and test
  cases as input → expected tables. Specs contain no source code.
- **Implementation team** works only from `handoff/PLAN.md`, `handoff/spec/*.md` and `handoff/golden/*.json`
  (recorded outputs). Where PLAN.md says "port `X.cs`" or "port its tests", read it as "implement `spec/x.md`" and
  "turn the spec's test tables into Vitest cases".
- If a spec is ambiguous or contradicts golden data, the implementer records the question in
  `handoff/spec/QUESTIONS.md`; the spec team answers by updating the spec. Implementers do not go look.

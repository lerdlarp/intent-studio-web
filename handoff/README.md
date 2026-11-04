# Intent Studio Web — handoff bundle

Give this whole folder to a Claude cloud session (upload it, or commit it as `handoff/` in a new empty repo) with:

> Read handoff/PLAN.md and handoff/PROGRESS.md, then execute the plan phase by phase, keeping PROGRESS.md current.

- `PLAN.md` — the agentic plan (mission, exclusions, architecture, AI endpoint, phases with gates)
- `PROGRESS.md` — checklist the cloud session updates
- `CLAUDE.template.md` — becomes the new repo's CLAUDE.md
- `golden/` — C# outputs on the four demo rooms (seeds, advice, solved fixtures, estimates, interpreter); the port must match them
- `reference/ContractTypes.cs` — the few Designer link contract types the model references (shapes only)
- `reference/` — C# source of the Intent Studio domain model and its tests, from WarpDesigner
  `feature/VisualAiAssistant` @ a2029574. Behavioural spec only; Acuity / Designer-link parts are to be ignored.

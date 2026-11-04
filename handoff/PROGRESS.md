# Progress

Update after every task: tick it, add one line of evidence (tests, counts, screenshot path), note open questions.

## Phase 0 — Bootstrap
- [ ] Workspace, tooling, CI
- [ ] handoff/ copied, CLAUDE.md installed
- [ ] Forbidden-string CI check
- [ ] core/model.ts types + zod schemas
- [ ] Demo rooms ported

## Phase 1 — Core domain port
- [ ] geometry, units
- [ ] defaults
- [ ] workplane
- [ ] products, ranker (no catalog)
- [ ] suggestions
- [ ] estimate, zones
- [ ] solver
- [ ] interpreter, fallback AI
- [ ] heatscale, heatmap
- [ ] Golden parity (handoff/golden) green: Office, Cafeteria, Lobby, DataHall, misc
- Skipped reference tests (with reason):

## Phase 2 — Server ‖ Scene import ‖ Web shell
- [ ] Server routes, storage, AI fallbacks
- [ ] Scene loaders + room extraction + classification
- [ ] Web shell, store, import + room confirmation

## Phase 3 — Plan, inspector, 3D
- [ ] Plan canvas + paint tools
- [ ] Inspector
- [ ] 3D view
- [ ] Describe box

## Phase 4 — AI integration
- [ ] advise / propose / classify / CCT
- [ ] Eval script + results

## Phase 5 — Calculation, IES, preview, export
- [ ] Calc worker + heatmaps + ledger
- [ ] IES upload + IES-based estimate
- [ ] Lit preview
- [ ] Exports

## Phase 6 — Hardening
- [ ] Performance, a11y, errors, large scenes, docs, Docker

## Decisions / open questions

### Clean-room decisions (lead, 2026-11-04)
- Spec team (separate agents) read the original C# outside the repo and wrote handoff/spec/*.md; implementers read only PLAN, spec, golden. See handoff/CLEANROOM.md.
- Prompt wrapper: `<host-guidance kind="…">…</host-guidance>` for host JSON (compact), `<designer-text>…</designer-text>` for untrusted text.
- lastIssue offline wording: "The agent is offline — using rules".
- advise sends the first 10 intents; the rest keep fallback advice.
- New model flag `targetEdited` (designer-typed target/reason) — advice never overwrites it.
- Lenient JSON reader keeps the FIRST duplicate key (reference behaviour) — needs a custom reader, not JSON.parse alone.
- Interpreter keeps the reference "." sentence split ("40.5 fc" is lost) for parity; candidate fix after Phase 1.
- Inspector status rule (✓/↓/↑): proposal in products.md, adopted pending confirmation.
- Demo project + stableId (pure-TS MD5, .NET GUID byte order) ship in core.
- Plane kind: string enum in TS; golden loader maps 0/1/2.
- Regex `\b`: use Unicode lookaround boundaries (`u` flag) per defaults.md.
- Number formatting (`0.#`, `#,0`): spec is from .NET knowledge, unverified — golden traces are the arbiter.

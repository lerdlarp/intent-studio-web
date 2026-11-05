# Progress

Update after every task: tick it, add one line of evidence (tests, counts, screenshot path), note open questions.

## Phase 0 — Bootstrap
- [x] Workspace, tooling, CI — 1432c7b; gate green
- [x] handoff/ copied (minus C# reference — clean room), CLAUDE.md installed
- [x] Forbidden-string CI check — scripts/check-forbidden.mjs, verified failing on a planted hit
- [x] core/model.ts types + zod schemas — c369bf8
- [x] Demo rooms ported — bit-identical with golden room (toStrictEqual)

## Phase 1 — Core domain port
- [x] geometry, units, format (C# number formats, roundHalfEven), hash (stableId) — c369bf8, 270 tests
- [x] defaults — f447704; golden spaceClass/wallNames/clusters/labels/targets/reasons exact
- [x] workplane — f447704; golden planes exact
- [x] products, ranker (no catalog) — f447704; 41 packages field-for-field
- [x] suggestions — 0e7e778; golden seeds exact, all rooms
- [x] estimate, zones — 4cfa05b; golden estimates/probes/power max rel err 2.2e-16; estimateAll ≈2 ms
- [x] solver — golden solved exact all rooms (counts, coords 1e-6, traces verbatim, estimates, power); deterministic; Office solveAll 82–100 ms (<150)
- [x] interpreter, fallback AI, AI codecs — 257e120; 20 interpret phrases + all fallbackAdvice exact
- [x] heatscale, heatmap — bc6d563; 35 tests (no golden; spec-derived)
- [x] Golden parity (handoff/golden) green: Office, Cafeteria, Lobby, DataHall, misc — 830 core tests
- Skipped reference tests (with reason): external-catalog ranker cases (adapted to uploaded products, see ranker.md); designer-link solver/zone request tests (excluded feature).

## Phase 2 — Server ‖ Scene import ‖ Web shell
- [x] Server routes, storage, AI fallbacks — apps/server: 37 tests (14 CRUD/upload/design, 23 AI incl. fake-model paths), no network; core draft-store.ts +7 tests. SQLite via better-sqlite3 (raw SQL, no drizzle yet)
- [ ] Scene loaders + room extraction + classification
- [x] Web shell, store, import + room confirmation — apps/web: zustand store (undo coalescing, solve → estimate → autosave/409 reload, seed suggestions, advise with designer-edits-win), shell + minimal inspector, import flow wired to packages/scene (classify, manual fallback); 14 web tests; e2e smoke green (e2e/tests/smoke.spec.ts); docs/screenshots/phase2-shell.png. Phase 2 gate item "upload a GLB → confirm → reload persists" not yet automated in e2e.

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
- Solver timing test has ~50% headroom; may flake on slow CI — revisit in Phase 6 (worker) if so.
- Open Q7: should inspector show Over for average-only targets > 1.3× average? (currently test-helper only)
- Follow-up: zones.ts keeps private copies of wallFor/wallName (written before workplane/defaults landed) — replace with imports in Phase 6 cleanup.
- estimate.ts takes a ProductResolver; callers pass products.productOf for reference behaviour.

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

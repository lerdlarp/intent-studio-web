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
- [x] Web shell, store, import + room confirmation — apps/web: zustand store (undo coalescing, solve → estimate → autosave/409 reload, seed suggestions, advise with designer-edits-win), shell + minimal inspector, import flow wired to packages/scene (classify, manual fallback); 14 web tests; e2e smoke green (e2e/tests/smoke.spec.ts); docs/screenshots/phase2-shell.png. Phase 2 gate GLB import → confirm → reload now automated in e2e/tests/plan.spec.ts.

## Phase 3 — Plan, inspector, 3D
- [x] Plan canvas + paint tools — features/plan (canvas, DPR, pan/zoom/fit, tools V/1–8, wash/area/point painting, fixture drag → pin, ✓/↓/↑ glyphs, heatmap overlay via zoneShape+samples+rasterize); store actions paintIntent/moveFixture/releaseHandTuned/setBehavior/setTarget/resetTarget/setPlane/setLabel/setProduct/describe/select/setTool/setOverlay; web 57 tests; e2e/tests/plan.spec.ts 4 green (incl. Phase 2 GLB import gate); docs/screenshots/phase3-plan.png
- [x] Inspector — features/inspector (selected intent expands: label, target min/avg/max in display units + reset to suggested, plane kind/height + desk/counter/bar/floor presets, product switcher from core rank grouped Project products / Generic with reasons, density "Fewer, brighter ↔ More, softer", pattern, fixed quantity (+ shortfall hint for keep-dim zones), CCT, mounting height, keep-dim margin, wall offset/aim, release hand-tuned, trace); plan polish (see-through fixtures over heat, label collision pass, heat α 0.75); 3D Focus follows the store selection; web 71 tests; e2e/tests/inspector.spec.ts 3 green (8 total); docs/screenshots/phase3-inspector.png, phase3-plan.png re-taken
- [ ] 3D view
- [x] Describe box — /api/ai/interpret, offline interpreter fallback, untrusted rows re-checked (indices, fixtures, ids, duplicates by intentKey)

## Phase 4 — AI integration
- [x] advise / propose / CCT — core cct.ts (defaultCct table per space class × kind, defaultBeam, applyAdviceWithCct, withDefaultCct; 36 tests); server AI tasks split into apps/server/src/ai/tasks.ts (route + eval share them), propose carries per-intent CCT (agent value in the set, else default) + "Agent: …" rationale; store: default CCT on accept/paint/describe (cctSuggested), suggestDesign (replaces only open suggestions, source Agent/Rules, rationale view state, offline → core seed), advise audit (one test per field: label/target/plane/cct), lastIssue banner wording per AI_ISSUES kind; inspector "Suggest a design", source tag, rationale, CCT "suggested"/"set by you"; web 92 tests, server 50; e2e/tests/suggest.spec.ts green (9 total). classify during room confirmation was already wired in Phase 2.
- [x] Gate (rules mode) — with no API key every flow works (e2e suggest/inspector/plan/phase5); `pnpm eval` 1286 checks, 0 failures in rules mode. Live-key eval not run yet (open).
- [x] Suggestion source + agent rationale persist with the saved design: optional draft field `suggestions: { source, rationale }` (core `toDraftDocument(intents, suggestions)` / `fitDraftSuggestions`; rationale kept only for open suggestion ids, ≤ 400 chars); `fitDraft` untouched, old documents load unchanged (core +3 tests, server +1, web +1 reload test).
- [x] Eval script + results — `pnpm eval` (scripts/eval/run.ts + lib.ts): 4 demo + 3 imported-style rooms (classroom, corridor, retail via scene assembleRoom) × advise / interpret (5 phrases) / classify / propose through the AI runner directly; 1286 checks, 0 failures in fallback mode; live path tested with the fake client (apps/server/test/eval.test.ts). Results in scripts/eval/results/<timestamp>/ (gitignored).

## Phase 5 — Calculation, IES, preview, export
- [x] Calc worker + heatmaps + ledger — core calc.ts (10 tests) in apps/web/src/workers (cancellable by terminate, ≤ ~100 progress events; inline fallback without Worker); store `calculate` / `cancelCalculation`, `calcResult` / `calcRunning` / `calcProgress` / `calcError` / `calcMs`, `calcStale` = design revision > calc revision, `design.calculation = toSnapshot(…)` (carried across edits with its own revision), `freshCalc(state)`; <Ledger> mounted under the plan (collapsible "Results (full calculation)"); plan heatmap (`planHeatFromCalc`) and 3D heat (`calcDesignHeat`) paint the full-calc intent-zone grids while the calc is fresh, quick estimate otherwise; legend/3D note say "Estimate (point-by-point, simplified inter-reflection)". Timings: node calculate Office 2 ms / Cafeteria 3 ms / Lobby 2 ms / Data hall 3 ms; browser worker (Cafeteria = largest: 1,536 ft², 1,812 points, 51 fixtures) 133–172 ms store wall-clock incl. worker start, 253–283 ms click → rows (gate < 2 s). e2e/tests/phase5.spec.ts "Calculate → ledger rows…" (rows with avg/min/max/U/target/status, stale after a density edit, Recalculate clears it). docs/screenshots/phase5-calc.png
- [x] IES upload + IES-based estimate — core ies.ts (19 tests) + estimate IES path (6) + server IES parsing (5); fixture coverage: all 8 files in packages/core/test/fixtures/ies parsed in core tests (downlight, lambert, washer, uplight also through estimate/calc; typeb refused), downlight-1995 through the browser. Product library: <Library> on the project screen and as a dialog from the inspector ("Manage project products…"); store `projectProducts` loaded per project (`StudioApi.listProducts`); the inspector ranks against `productCatalog(state)`; every uploaded (non-packaged) product is always listed under Project products. e2e: upload downlight-1995.ies → choose it for "Desk cluster A task" → 1 → 2 fixtures, estimate 35.5 → 55.9 fc avg (typeb-2002.ies refused with the parser reason).
- [x] Lit preview — room3d lit preview (litPreview.ts, scene.ts); e2e toggles on/off/on + exposure with no console or page errors.
- [x] Exports — core export/* (lights, kelvin, schedule; 13 tests), web JSON / CSV / PNG / PDF / GLB; `peakCandela` now uses core `iesPeakCandela` (table peak × fixture lumens / table lumens; IES product test with downlight-1995). e2e downloads JSON (schemaVersion, intents, calculation null), CSV (header + rows) and GLB via Playwright download events; the GLB re-loads with three.js GLTFLoader in Node: 20 KHR_lights_punctual lights declared = 20 three.js lights (Office, 150 kB).
- Gate: `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm check:forbidden && pnpm --filter web build && pnpm e2e && pnpm eval` green — core 929, scene 117, server 51, web 110, e2e 13, eval 1286 checks / 0 failures (rules mode).

## Phase 6 — Hardening
- [x] Performance — browser main-thread solveAll (median/max of 7, Chromium, e2e/tests/perf.spec.ts): Office 48–53 / 53–59 ms, Cafeteria 39–44 / 43–46, Lobby 23–26 / 26–29, Data hall 25–41 / 29–51 ms (> 50 ms gate hit) → solve + quick estimate moved to workers/solve.worker.ts via pipeline.ts `solveRequest` / `runSolveRequest` / `adoptSolved` (settled packages cross the boundary explicitly: `carried` in, `packages` out); provisional design + `solving` state (header "Solving…", aria-live), client coalesces (1 running + latest waiting), store applies only the latest revision; saves / flush / calculate / advice wait for the pending solve; inline (synchronous) path unchanged without Worker (all store tests). Density drag (10 edits, Cafeteria): before 4 long tasks (longest 59 ms, 227 ms total), settled 556 ms; after 0 long tasks, settled 188–216 ms. Worker crash → notice + inline fallback (solver and calc).
- [x] Large scenes — scene `buildDisplayMesh` (drop meshes < 0.3 % of scene diagonal, water-filled triangle cap 500k with even striding, merge per material, position-only) for the 3D imported-mesh context only; extraction always on the full mesh. Import shows "Step k of 4" progress and a > 50 MB warning. Fixture `addClutter` (≈297k sculpture triangles + 1,500 tiny parts, 8.6 MB GLB): Node load 80–90 ms, extract ≈1.4 s, display mesh ≈70 ms; same room as without clutter (outline, walls, ceiling, objects + 2 sculptures); browser import (file pick → confirm form) ≈2.5 s, mesh context ≈0.8–1 s. Extraction still runs on the main thread (open).
- [x] Errors — readable request errors (network / 5xx / 401) in a banner with Retry (`retryLast`); autosave failure keeps the design, "Not saved" + "Retry now", backoff 2/5/15/30 s; unreadable scene → clear message + Try again + manual outline; per-panel error boundaries (plan / 3D / results / inspector) with "Reload panel"; bearer token: `api/auth.ts` authFetch (header when stored, 401 → "Access token" dialog, refused token re-prompts, localStorage with memory fallback), e2e project `auth` with its own API_TOKEN server.
- [x] Accessibility — shared focus-trapping `<Dialog>` (library, access token; Esc closes, focus returns), keyboard painting for every tool (`KeyboardPaint`), plan text alternative (`PlanSummary`, canvas aria-describedby), aria-live solving / save / status, visible focus rings, glyph / accent colours ≥ 4.5:1 on every background in both themes (styles/contrast.test.ts). axe (@axe-core/playwright 4.14.0) on home, project, room (suggestions, accepted, library dialog, 3D): 0 violations.
- [x] Layout — room screen columns start at the top and scroll independently (page does not scroll ≥ 900 px); docs/screenshots/phase6-room.png.
- Gate: typecheck, test (core 929, scene 123, server 63, web 131), lint, check:forbidden, web build, e2e 22 (20 chromium + 2 auth) green.
- [x] Deployment + docs (2026-11-05): server `STATIC_DIR` (static + SPA fallback, apps/server/src/static.ts), `API_TOKEN` bearer auth (auth.ts, constant-time, /api/health open), request log lines without bodies, graceful SIGTERM/SIGINT; tsx moved to server dependencies (runtime uses it); Dockerfile / .dockerignore / docker-compose.yml; CI jobs check (+web build), eval (rules mode), e2e (playwright install in CI only), docker (build + smoke, no push); README, docs/{user-guide,architecture,ai}.md; core zones.ts now imports wallFor/wallName (behaviour identical, core 929 + golden green). Docker daemon unavailable in the dev sandbox: image not built here; build steps reproduced locally (prod-only install with native better-sqlite3 build, web build, server with STATIC_DIR + API_TOKEN). Web client bearer token: done (see Errors above).

## Decisions / open questions
- Solver timing test has ~50% headroom; may flake on slow CI — revisit in Phase 6 (worker) if so.
- Open Q7: should inspector show Over for average-only targets > 1.3× average? (currently test-helper only)
- estimate.ts takes a ProductResolver; callers pass products.productOf for reference behaviour.

- Plan decisions (Phase 3): moveFixture pins the fixture and sets handTuned (solveAll then keeps the intent as is); releaseHandTuned clears handTuned AND unpins all its fixtures; resetTarget = core defaultTarget then re-advise; a painted wall wash uses seed's washRun (so the east wall in Office is labelled "Screen wash"); painted/described intents are advised like accepted suggestions; after a successful paint the tool returns to Select.
- Hand-tuned intents keep their settled lumen package across reloads: when an intent becomes hand-tuned with no product choice, moveFixture stores the settled package as its product choice (agentPicked true, reason "Kept from the layout you hand-tuned"); releaseHandTuned clears that choice. Core unchanged.
- Office ambient sits at its fewest fixtures with every volumetric package (10 fixtures, 1500–5000 lm), so a package switch there does not change the count; the accent (450 lm → 2 fixtures) does.

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

### Phase 4 decisions
- New optional model flag `cctSuggested` on LightingIntent (true = the cct came from the rules or the agent; absent/false with a cct = the designer chose it). Advice may replace only a suggested cct (`applyAdviceWithCct`); core `applyAdvice` is unchanged. Choosing "Automatic" in the inspector restores the suggested default.
- Agent rationale for proposals is view state (`rationale` in the store): the solver rewrites suggestion traces and traces are not saved.
- The rules fallback for "Suggest a design" is rebuilt locally from core `seed` (identical to the server fallback) so its own trace is kept.
- Forbidden terms moved to scripts/forbidden-terms.mjs (shared by check-forbidden.mjs and the eval).
- Beam preference (`defaultBeam`) is still not consumed: the core ranker already scores beam (accent ≤ 40°, downlight beam vs mount height), so a second preference in the web's product options would either duplicate or contradict it and change which option is "best fit" against core rank. Left for a spec decision (QUESTIONS.md candidate) rather than a web-side override.

### Phase 5 decisions (integration, 2026-11-05)
- Demo catalogue: core `asProject()` (41 demo packages) is offered only in the "Demo rooms" project (after its uploaded products); every other project ranks against its uploaded products only (empty library → generic stand-ins). The inspector e2e for a non-demo project now expects no "Project products" group.
- `calcStale` is false until a calculation exists; a cancelled run keeps the previous result; leaving the room cancels and clears it. The calc snapshot is not saved (drafts never persist it) and the design JSON export writes `calculation: null`.
- Full-calc heat covers intent zones only in plan and 3D (surfaces are in the ledger).
- vite `optimizeDeps.include` lists the lazily imported three.js addons and jspdf: the dev server otherwise discovered GLTFExporter on first export, re-optimized and reloaded the page (the open room was lost).
- apps/server/test/eval.test.ts flake: not reproduced (20× file runs, 300 in-process live+fallback eval runs, 6–8 full server suites at 4×–24× CPU oversubscription, all green). Ruled out: vitest's 5 s timeout (runEval never yields to the macrotask queue, so the timer cannot fire — an 8.9 s run under load passed), budget clock (limit 1e6), shared temp dirs (mkdtemp per test, in-memory DB). The only nondeterminism is random 32-bit intent ids (collision ≈ 1e-7 per run; forcing a 256-id space reproduces "cct changed"/"reuses a designer intent id" failures, so that is the failure signature to look for). Most likely cause of the single failure: the file imports the whole core barrel + scene from source while two other engineers were writing core/src/{ies,calc,export} in the same tree. No code change; revisit if it recurs with a message.

### Open issues (Phase 5)
- No live-key eval run yet (only the fake model and rules mode).
- IES orientation: the 0° horizontal plane is assumed to lie along the fixture's orientation axis (no per-file rotation UI).
- Linear fixtures are a single light in the lit preview and the glTF (no array along the length).
- PDF export is a single page (plan + schedule).
- Existing (pre-design) fixtures get no lights in the preview / glTF.
- The inspector reason for a designer-chosen uploaded product that is also the ranker's best reads as the ranker's reason, not "Your choice".


## Design UX cleanup (2026-11-05)
- Reviewed the live app with a GPT-6.1 Terra computer-use agent and the existing phase screenshots. Selection details were below suggestions; products required opening a deeply nested editor; the canvas repeated instructions, labels and status information.
- Moved Undo/Redo beside document navigation, introduced a compact vertical tool rail with accessible names and shortcut tooltips, and placed selection and view commands above the canvas. Labels show the selected zone by default; an explicit Labels toggle restores all zone labels. Controls, Describe lighting, Workplane, room facts and Results expand on demand. Calculate stays in the workspace header when Results is collapsed, including when a notice is visible.
- The inspector prioritizes the selected zone ahead of suggestions and puts the product preview/choice before other fields. Uploaded IES products and built-in options retain the existing product-ranking and selection rules. The project library is reachable without selecting a zone. Product provenance and lumen/watt/beam values are visible.
- Fixture deletion uses the existing undo/save/solve lifecycle and persists even for an empty hand-tuned zone. Zone merge uses a true polygon union (polygon-clipping), requires matching intent settings, previews the resulting outline, preserves fixtures and deduplicates overlapping positions. Grid snapping follows the solver's grid convention, shares one helper between drag preview and drop, and supports free placement when disabled.
- Added browser regressions for product visibility, last-fixture deletion + undo/redo/reload, merge preview/cancel/apply/undo, snap/free placement and canvas Delete. Windows test file-URL conversion and E2E data reset were made portable to run the gates on this machine. Existing ledger refactor was preserved.
- Validation: production web build, workspace typechecks/lint, forbidden-term check and diff check passed. Browser E2E: 26/26, including accessibility (zero violations), IES, exports, 3D, import, autosave/recovery and the new UX actions. Unit suites: web 134/134, server 63/63, scene 123/123, core 930/931; only the existing golden solver timing assertion failed (292.6 ms versus 150 ms). Functional golden parity passed; timing threshold was not changed. Final UI captures: docs/screenshots/ux-room.png and ux-selected.png. The running dev web/API endpoints both returned HTTP 200.


## Right-panel UX refinement (2026-11-05)
- Independent GPT-6.1 Terra agents reviewed the prior captures and live app using browser computer use. Final live checks passed in Chrome dark theme at 1280x800 and 1440x900: navigation, disclosures, product/library access, legible controls and no horizontal clipping. The native popup itself was outside browser screenshot capture, so browser tests verified real ArrowDown/Enter product selection and ArrowUp/Enter restoration instead.
- Replaced nested expanding zone cards with a compact overview and a focused editor; the sticky zone selector and Back to Zones action make other zones reachable without scrolling through the current editor. Removed the competing library/room header in editing mode.
- The product card itself is the native product selector, with one name/source/output summary and Change cue. Color temperature is adjacent; the average target, quantity, pattern and density remain primary; limits, placement and calculation-plane settings use disclosures. Manual layout regeneration now sits beside the layout controls.
- Replaced cryptic estimate strings with labelled Average/Minimum/Maximum. Inspector feedback uses existing targetMeets semantics (point minimum, average floor and average ceiling); absent criteria give neutral No target set. Core solver/target policies were not changed. Added focused regression cases for minimum failure, neutral empty targets and inclusive tolerances.
- Validation: web unit tests 138/138; browser tests 28/28, including new overview/detail navigation, product-card keyboard operation, validation/persistence and accessibility (zero violations). Screenshot artifacts: panel-overview.png, panel-selected.png, panel-office.png. Source/CSS and test changes are limited to the panel and its affected browser checks; prior work is preserved.

## Plan panel cleanup (2026-11-06)
- Removed the "Design" panel title (section keeps an accessible name) and the plan's "Selected intent" dropdown, which duplicated the inspector's zone list/"Zone to edit". The selection summary (zone name, fixture count, fixture picker, hand-tuned/pinned tags, remove/merge actions) now sits in the toolbar row beside Controls, fixed at one line so selecting mid-drag never shifts the canvas.
- Room dimensions and cursor readout moved into the canvas's bottom-right corner; "Plan as text" and "Describe lighting" share one footer row.
- E2E selection steps now use the inspector (zone row / Zone to edit / Back to zones). Validation: web 139/139, server 63/63, lint, typecheck, browser E2E 28/28 (axe 0 violations). Core golden solver timing assertion failed once under load (220.9 ms vs 150 ms) and passed on rerun; no core changes.

## Room screen redesign, direction B (2026-11-06)
- Four critique agents (lighting designer, interaction designer, first-time user, product workflow) → handoff/UI-REDESIGN.md. Designer decisions: CCT belongs to the luminaire type (zone only suggests); LLF per type agreed (spec question 10, read-only 0.85 until amended).
- Floating zone card on the plan (features/zone/ZoneCard.tsx) beside the selected zone: plain-language status + avg/min vs target (estimate), luminaire with type tag and CCT-suggestion actions ("Use on B" / "New type"), light-level presets per kind + average field, fixture count Auto / − n +. Everything else (rename, limits, plane, pattern, density, placement, why, delete) under "More settings", which stays open for the session and shows a dot when hidden settings differ from automatic.
- Right panel is now always the zone list (estimate / target + visible status text, selected row highlighted) + suggestions; suggestions also get accept/dismiss pins on their outlines (pointer shortcut; the list is the accessible path).
- Luminaire schedule dock under the plan (features/schedule): types derived by `fixtureTypes()` (product key + CCT, tags A, B, C in design order; Vitest), beam glyph, luminaire select and CCT select that apply to every zone of the type, lumens, watts, LLF, qty, zone chips, room W and W/ft² (estimate). "Add IES file" replaced the Products button and per-zone Import IES; Results toggle lives in the dock.
- Header now holds Calculate (opens Results under the plan when a run starts; Cancel while running) and a 2D | Split | 3D view switch (store `viewMode`; 3D alone hides the plan and its zone card). Browser check added in design-ux.spec.
- Not done yet: type swaps are one undo step per zone (no batched undo); on-canvas level chips; persisted/editable type tags; per-type LLF.
- Validation: typecheck, lint, web 151/151, server 63/63, E2E 28/28 (axe 0 violations). Two E2E runs under parallel load each showed one different timing failure (smoke, drag) that passed on rerun and standalone ×3.

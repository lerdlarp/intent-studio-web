# Intent Studio Web

A browser lighting-intent designer. Import a 3D room, confirm what the app found, paint *intents* ("task light on this
desk", "wash this wall", "keep the aisle dim"), and a deterministic solver lays out fixtures. An advisory AI proposes
labels, targets, planes, intents and colour temperature; it never places a fixture and never computes an illuminance.

**Every illuminance number in the app is an estimate. Nothing here is a code-compliance check.**

## Clean-room note

This is a clean-room reimplementation. The original C# source is not part of this repository and implementers never
read it. Behaviour comes from `handoff/spec/*.md` (written by a separate spec team) and recorded outputs in
`handoff/golden/`. See `handoff/CLEANROOM.md`, `handoff/PLAN.md` and `handoff/PROGRESS.md`.

## Architecture

```
 Browser (apps/web: React, three.js, Zustand store, calc Web Worker)
   |  scene import (packages/scene: GLB/glTF/OBJ/FBX -> StudioRoom)
   |  design state, solver, estimate, calculation  <-- packages/core (pure TS, deterministic)
   |
   |  HTTP /api/*  (JSON; multipart for scenes and .ies)
   v
 Server (apps/server: Fastify)
   |-- projects, rooms, designs, products, assets  -->  SQLite + blob files in DATA_DIR
   |-- /api/ai/{advise,interpret,classify,propose}  -->  AI runner
   |        |-- Anthropic API (only when ANTHROPIC_API_KEY is set)
   |        '-- core rules fallback (always available; used on any failure)
   '-- STATIC_DIR: serves the built web app with SPA fallback
```

More in [docs/architecture.md](docs/architecture.md).

## Quick start

Requirements: Node 22, pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm --filter server dev     # API on http://localhost:3001  (data in ./data)
pnpm --filter web dev        # web app on http://localhost:5173 (proxies /api)
```

With no `ANTHROPIC_API_KEY` everything works in rules mode.

### Docker

```sh
docker compose up --build            # http://localhost:3001, data in the "studio-data" volume
ANTHROPIC_API_KEY=sk-ant-... API_TOKEN=change-me docker compose up --build
```

Or without compose:

```sh
docker build -t intent-studio-web .
docker run -p 3001:3001 -v studio-data:/data intent-studio-web
```

The image is multi-stage (`node:22-bookworm-slim`), runs as the non-root `node` user, keeps SQLite and uploaded blobs
under `/data`, and has a healthcheck on `/api/health`.

## Environment variables (server)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` (`/data` in Docker) | Root for the database and blobs |
| `DB_PATH` | `$DATA_DIR/studio.db` | SQLite file |
| `BLOB_DIR` | `$DATA_DIR/blobs` | Uploaded scenes / IES files |
| `STATIC_DIR` | unset (`/app/web` in Docker) | Directory of the built web app (`apps/web/dist`); enables static serving with SPA fallback |
| `API_TOKEN` | unset | When set, every `/api/*` route except `/api/health` needs `Authorization: Bearer <token>` |
| `ANTHROPIC_API_KEY` | unset | Enables live AI; unset = rules fallback only |
| `AI_MODEL` | `claude-sonnet-5-5` | `claude-sonnet-5-5` or `claude-opus-5-5`; anything else falls back to the default |
| `AI_TIMEOUT_MS` | `20000` | Per-call model timeout |
| `AI_BUDGET_PER_MIN` | `30` | AI calls per minute before falling back to rules |
| `AI_RETRY_DELAY_MS` | `400` | Delay before the single retry |
| `SCENE_MAX_BYTES` | `209715200` | Max scene upload |
| `IES_MAX_BYTES` | `1048576` | Max IES upload |

The server logs one line per request (`METHOD /path status ms`, no query string, headers or bodies) and shuts down
gracefully on SIGTERM/SIGINT.

## Scripts

| Command | What it does |
|---|---|
| `pnpm -r typecheck` / `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` | Vitest in every package |
| `pnpm lint` | ESLint |
| `pnpm check:forbidden` | Fails if a forbidden term appears outside `handoff/` |
| `pnpm --filter web build` | Production web bundle in `apps/web/dist` |
| `pnpm e2e` | Playwright end-to-end (needs browsers: `npx playwright install chromium` once) |
| `pnpm eval` | AI eval; live if `ANTHROPIC_API_KEY` is set, rules mode otherwise |

Phase gate: `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm check:forbidden`.

## Testing and golden parity

`packages/core` is pure (no DOM, no Node APIs) and deterministic: the same design in gives the same layout out.
Each spec in `handoff/spec/` has input to expected-output tables; those became Vitest cases first. On top,
`handoff/golden/*.json` holds recorded outputs of the reference model on four demo rooms (Office, Cafeteria, Lobby,
Data hall): seeds, fallback advice, solved layouts, estimates and probe points. Space classes, labels, targets,
product families, lumen packages and fixture counts match exactly; coordinates match to 1e-6 ft and estimates to 1e-6
relative. Deliberate web-only changes (for example CCT) regenerate their expectations and are recorded in
`handoff/PROGRESS.md`; tolerances are never loosened silently.

## AI behaviour and offline fallback

The AI is advisory and untrusted. Four tasks (advise, interpret, classify, propose) each have a deterministic rules
fallback in core. Model output is parsed defensively, validated with zod and clamped, and the fallback is kept per
field. With no key, on timeout, over budget, on a network error or on an unreadable reply, the app uses the rules and
shows a short notice ("The agent is offline - using rules"). Designer-edited fields are never overwritten; hand-moved
fixtures are pinned. Details: [docs/ai.md](docs/ai.md).

## Limitations

- Every illuminance value is an estimate (simplified inter-reflection, point-by-point), not a measurement or a
  certified calculation. The app makes no code-compliance claims.
- Not in scope: emergency lighting, glare/UGR, daylighting, multi-user editing, mobile layout.
- Authentication is a single optional bearer token; the web client does not yet send one (see docs/architecture.md).
- IES orientation assumes 0 degrees horizontal lies along the fixture's orientation axis; linear fixtures export as a
  single light; the PDF export is one page.

## Docs

- [User guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [AI](docs/ai.md)

# Architecture

## Packages

| Path | Role |
|---|---|
| `packages/core` | The domain: model, geometry, space classification, seeds/suggestions, interpreter, solver, ranker, quick estimate, point-by-point calculation, IES parser, exports, rules fallbacks, AI codecs (prompts and parsers). Pure TypeScript: no DOM, no Node APIs. Feet and footcandles. |
| `packages/scene` | Scene loaders (GLB/glTF/OBJ/FBX) and room extraction: mesh to `StudioRoom`. |
| `apps/web` | React UI, Zustand store, plan canvas, three.js 3D view, calc Web Worker, export (JSON/CSV/PNG/PDF/GLB). |
| `apps/server` | Fastify API, SQLite (better-sqlite3), blob store, AI runner, optional static hosting and bearer auth. |
| `e2e` | Playwright tests against a real server (no API key) and the Vite dev server. |
| `scripts` | `check-forbidden`, `eval` (AI eval harness). |
| `handoff` | Plan, progress log, specs, golden data. |

## Data flow

1. **Import** (browser): a scene file is parsed by `packages/scene`; rooms are extracted and confirmed by the designer.
   Rooms and their source blob are saved through `/api/projects/:id/rooms` and `/api/assets`.
2. **Edit**: the store holds a `RoomDesign` (room + intents + fixtures). Painting, typing a description, accepting a
   suggestion or editing the inspector produce intents. After each edit core's `solveAll` lays out fixtures for every
   intent that is not hand-tuned; pinned fixtures are kept.
3. **Estimate**: core's quick estimate drives the inspector status, plan heat and 3D heat.
4. **Calculate**: the calc worker runs core's point-by-point calculation and returns a snapshot for the ledger.
5. **Save**: designs autosave to `PUT /api/rooms/:id/design` (suggestion source and rationale persist; the calculation snapshot does not).
6. **AI**: the browser posts room + intents to `/api/ai/:task`; the server builds the prompt from core, calls the model, validates the reply and returns either AI-derived or rules-derived data with a `source` and an optional `lastIssue`.

## Determinism

Core has no clocks, randomness (ids are assigned by callers), DOM or filesystem. Orderings and tie-breaks follow the
specs, so the same design in gives the same layout out; golden tests pin it to the reference outputs. Rounding uses
half-even where the spec says so. The worker and the inline fallback run the same code.

## AI trust boundary

The model is outside the trust boundary. It receives host-built JSON in `<host-guidance>` blocks and designer text in
`<designer-text>` blocks (treated as data). Its reply is parsed by a lenient JSON reader, validated with zod, clamped,
and merged per field over the rules result. It never places fixtures or computes illuminance; the solver and
estimator are the only sources of those. Failures (offline, timeout, budget, unreadable) yield the rules result
with a visible notice. Calls are logged (`ai_log` table) with designer text truncated and key-shaped strings masked.
See [ai.md](ai.md).

## Server deployment

`STATIC_DIR` makes the server serve `apps/web/dist` (hashed `/assets/*` are immutable-cached, everything else
revalidates; unknown extension-less GET paths fall back to `index.html`; unknown `/api/*` stays a JSON 404).
`API_TOKEN` adds a single bearer token on `/api/*` (not `/api/health`), compared in constant time. Static files are not
gated. The shipped web client does not send a token yet, so for a token-protected deployment put the app behind a
proxy that injects the `Authorization` header, or leave `API_TOKEN` unset behind your own access control.

The Docker image runs the server with `tsx` (the workspace packages are TypeScript sources), as the non-root `node`
user, with `/data` as a volume. Use one replica: SQLite is a single-writer file.

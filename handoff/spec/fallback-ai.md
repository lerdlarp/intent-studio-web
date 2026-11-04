# Spec: deterministic (fallback) AI

Module: the server's fallback for every AI task, built on `packages/core` (reference name: `FallbackStudioAi`). It is the
agent with no model: labels, targets and planes from the defaults and workplane specs, products from the ranker, and
sentences from the interpreter. It is deterministic, so the app works with no API key. It is also the per-field fallback
the advice codec keeps (see `ai-codecs.md`).

Dependencies: `Target(room, kind, obj, ambientAvg)`, `Label(room, kind, region, wall, obj)` (defaults spec);
`Infer(room, kind, region, wall, obj)` (workplane spec); `Rank`, `Family`, `FamilyFit` (ranker spec);
`GenericProducts.All` (products spec); `interpret` (interpreter spec).

## 1. Interface

| Member | Behaviour |
|---|---|
| `isOnline` | always **false** |
| `advise(room, intents)` | §2, returned synchronously (async wrapper allowed) |
| `pickProduct(room, intent, projectProducts)` | `Rank(room, intent, projectProducts, [])` — the ranker with **no external candidates** (empty list) |
| `searchProducts(query, kind, targetLumens?)` | §3 (reference name `SearchCatalogAsync`; offline only — generic stand-ins, never an external catalog) |
| `interpret(room, text)` | `interpret(room, text)` from the interpreter spec, unchanged |

## 2. `advise(room, intents)` → one advice per intent, same order

Advice record: `{intentId, label, target {min, avg, max}, plane, reason}`.

1. **Ambient average** used for accents (an accent is aimed at three times what surrounds it, so it follows the ambient
   intent's target when one exists). Take the first that exists:
   1. the target average of the first intent of kind Ambient that is **not** a suggestion and whose average is > 0;
   2. else the target average of the first Ambient intent (suggestion or not) whose average is > 0;
   3. else `Target(room, Ambient, none, none).range.avg` (may be absent).
   "First … whose average is > 0" means: scan Ambient intents in order and take the first average that is present and > 0.
2. For each intent, in order:
   - `(range, reason) = Target(room, intent.kind, intent.objectIndex, ambientAverage)`
   - `label = Label(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex)`
   - `plane = Infer(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex)`
   - advice = `{intentId: intent.id, label, target: range, plane, reason}`.

The intent's own current label/target/plane are **not** read (except Ambient averages in step 1); advice is recomputed
from room + kind + region + wall + object. Calling `advise(room, [intent])` on a single intent therefore uses only that
intent (or the room default) for the ambient average.

Plain-language contract: the fallback never fails and always returns exactly `intents.length` items.

## 3. `searchProducts(query, kind, targetLumens?)` — generic stand-ins

1. Words = the query split on space, comma and semicolon, each trimmed, empties removed (null query → no words).
2. Use a blank probe room (no floor, empty label) for family fit.
3. Candidates = every product in `GenericProducts.All` (in its order) such that **every** word is a case-insensitive
   substring of `"{label} {description} {family}"`, **and** `FamilyFit(probe, kind, Family(p)) ≥ 0.25`.
4. Sort (stable) by FamilyFit descending, then — only when targetLumens is given — by
   |ln(max(lumens, 1) / max(targetLumens, 1))| ascending.
5. Take the first **8**.

In the web version the project's uploaded IES products may be added to this list by the product switcher; that is new
behaviour, not part of this function.

## 4. Golden data (`golden/<Room>.json` → `fallbackAdvice`)

`fallbackAdvice` is `advise(room, seeds)` for the room's seeds (`seeds` in the same file). Entries carry `index`
(= seed order; ids are random so there is no `intentId`), `label`, `target {minimum, average, maximum}`, `plane`
(numeric `kind`: 0 horizontal, 1 vertical, 2 ceiling; `height, bottom, top, inferred, reason`), `reason`. For every
seed in all four rooms the advice equals the seed's own label, target, targetReason and plane exactly.

| Room | # | Kind | Label | Target min/avg/max | Reason | Plane |
|---|---|---|---|---|---|---|
| Office | 0 | Ambient | Open office ambient | 10/20/35 | Office ambient, IES 10–35 fc at the work plane | H 2.5 "Work plane, 2′-6″ · open office" |
| Office | 1 | Task | Desk cluster A task | 20/30/50 | Office desk task, IES 20–50 fc | H 2.5 "Desk top, 2′-6″, from Desk cluster A" |
| Office | 2 | Task | Desk cluster B task | 20/30/50 | Office desk task, IES 20–50 fc | H 2.5 "Desk top, 2′-6″, from Desk cluster B" |
| Office | 3 | Task | Meeting table task | 20/30/50 | Office task, IES 20–50 fc | H 2.5 "Table top, 2′-6″, from Meeting table" |
| Office | 4 | Task | Desk cluster C task | 20/30/50 | Office desk task, IES 20–50 fc | H 2.5 "Desk top, 2′-6″, from Desk cluster C" |
| Office | 5 | WallWash | Brand wall wash | 15/25/45 | Wall wash, 15–45 fc vertical | V 2–8 "North wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)" |
| Office | 6 | Accent | Brand wall accent | –/60/– | 3× the surrounding ambient (20 fc) | V 3–7 "Brand wall face, 3′-0″ to 7′-0″" |
| Office | 7 | KeepDim | Screen — keep dim | –/–/5 | Keep dim: nothing brighter than 5 fc | H 2.5 "Work plane, 2′-6″ · open office" |
| Cafeteria | 0 | Ambient | Cafeteria ambient | 10/15/25 | Cafeteria dining ambient, IES 10–25 fc at table height | H 2.5 "Table height, 2′-6″ · cafeteria dining" |
| Cafeteria | 1 | Task | Servery counter task | 25/40/60 | Servery counter, 25–60 fc | H 3 "Counter top, 3′-0″, from Servery counter" |
| Cafeteria | 2 | WallWash | Menu boards wash | 15/25/45 | Wall wash, 15–45 fc vertical | V 2–9 "North wall, 2′-0″ to 9′-0″ (clear of the base and the ceiling edge)" |
| Cafeteria | 3 | CeilingGlow | Cove glow | 5/10/20 | Ceiling glow, 5–20 fc on the ceiling | C 12 "Raised ceiling at 12′-0″, facing down" |
| Cafeteria | 4 | Accent | Menu boards accent | –/45/– | 3× the surrounding ambient (15 fc) | V 5.5–8 "Menu boards face, 5′-6″ to 8′-0″" |
| Cafeteria | 5 | FeaturePendant | Table pendants | 15/25/40 | Feature pendants over a table, 15–40 fc | H 2.5 "Table top, 2′-6″, under Table 1" |
| Lobby | 0 | Ambient | Lobby ambient | 5/10/20 | Lobby and circulation ambient, 5–20 fc on the floor | H 0 "Floor level · lobby circulation" |
| Lobby | 1 | Task | Reception desk task | 20/30/50 | Reception desk task, 20–50 fc | H 3 "Reception top, 3′-0″, from Reception desk" |
| Lobby | 2 | WallWash | Feature wall wash | 15/25/45 | Wall wash, 15–45 fc vertical | V 2–9 "North wall, 2′-0″ to 9′-0″ (clear of the base and the ceiling edge)" |
| Lobby | 3 | Accent | Feature wall accent | –/30/– | 3× the surrounding ambient (10 fc) | V 3–8 "Feature wall face, 3′-0″ to 8′-0″" |
| Lobby | 4 | FeaturePendant | Reception desk pendants | 15/25/40 | Feature pendants over a table, 15–40 fc | H 3 "Reception top, 3′-0″, under Reception desk" |
| Lobby | 5 | Path | Entry path | 1/3/10 | Path of travel, 1–10 fc | H 0 "Floor level · path of travel" |
| DataHall | 0 | Ambient | Data hall ambient | 20/30/50 | Data hall aisle, 20–50 fc on the floor | H 0 "Floor level · data hall circulation" |
| DataHall | 1 | Task | Aisle 1 task | 20/30/50 | Data hall cold aisle, 20–50 fc on the floor | H 0 "Floor level · aisle" |
| DataHall | 2 | Task | Aisle 2 task | 20/30/50 | Data hall cold aisle, 20–50 fc on the floor | H 0 "Floor level · aisle" |
| DataHall | 3 | Task | Aisle 3 task | 20/30/50 | Data hall cold aisle, 20–50 fc on the floor | H 0 "Floor level · aisle" |

("–" = null. Vertical planes have `height` = bottom in the golden file; all `inferred` = true.)

---

## Test cases

| Name | Input | Expected |
|---|---|---|
| fallback is offline | `isOnline` | false |
| advice for demo rooms is sensible (each of the 4 rooms) | `advise(room, Seed(room))` | count = seed count; for each i: `intentId` = seed id; label length 1..40; reason non-empty; KeepDim → target min null, avg null, max > 0; other kinds → 0 < avg ≤ 200 and (when min and max both present) min ≤ max; plane kind: WallWash → vertical, CeilingGlow → ceiling, Accent → any, everything else → horizontal |
| office desk task | Office, advice for the first Task seed | plane height 2.5 (±1e-9); target exactly (20, 30, 50); label contains "Desk cluster" |
| office ambient | Office, first Ambient seed | target avg 20 |
| office accent is 3× ambient | Office, first Accent seed | target avg 60 |
| office keep dim | Office, first KeepDim seed | target max 5 |
| lobby ambient on the floor | Lobby, the Ambient seed | plane height 0 (±1e-9); target exactly (5, 10, 20) |
| pick product uses ranker with project | Office, first WallWash seed, project = `GenericProducts.AsProject()` | chosen product is in the project (has a project product id); `Family(product)` = "wallwash" |
| search stand-ins for the kind | `searchProducts("", WallWash, 1500)` | non-empty; first result family "wallwash"; every result is generic |
| search narrowed by word | `searchProducts("pendant", FeaturePendant, none)` | every result's family starts with "pendant" |
| search with no match | `searchProducts("zzzz", Task, none)` | 0 results |
| interpret delegates | `interpret(room, text)` | identical to the interpreter spec (all its test cases apply) |
| golden fallbackAdvice | each row of §4 | exact match |
| ambient source order (derived) | intents [Ambient suggestion avg 10, Ambient non-suggestion avg 25, Accent] | accent advice target (null, 75, null), reason "3× the surrounding ambient (25 fc)" |

Dropped: none. (The product search test uses only generic stand-ins; no external catalog is involved.)

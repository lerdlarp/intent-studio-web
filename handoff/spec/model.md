# Model — types, fields, defaults, invariants

Scope: the Intent Studio domain model (room, intents, fixtures, products, planes, targets), the small contract types it
borrows (mount strings, ceiling grid, wall openings, 3-D points), and the view-level enums/colours shared by the plan,
3-D view and inspector. Geometry functions are in `geometry.md`; label/target rules in `defaults.md`; plane rules in
`workplane.md`.

## 0. Global conventions

- **Units.** Every length is **feet**, every illuminance **footcandles (fc)**, inside the model. Convert only at display
  and import/export (1 m = 3.28084 ft; lux = fc × 10.7639).
- **Axes.** Plan X/Y with **+Y = north** (Y up on screen in plan terms); Z is height above the room's floor (floor = 0).
- **Angles.** Orientation and headings are **degrees counter-clockwise from +X**.
- **Polygons.** Counter-clockwise is the canonical winding (positive signed area), but every geometric function accepts
  either winding (see `geometry.md`).
- **Ids.** Intent ids are 8 lowercase hex characters (the first 8 characters of a random 128-bit id written as 32 hex
  digits without dashes). Fixture ids, room ids, existing-fixture ids and product ids are 128-bit GUID/UUIDs written in
  the standard lowercase 8-4-4-4-12 form. Ids are random except where `demo-rooms.md` gives fixed ones; golden data
  therefore identifies intents by `index` and fixtures by list position.
- **Wire format (golden JSON).** camelCase property names. `P2` points are `{x, y}`. Most enums are strings with the
  **PascalCase** member name (`"Task"`, `"WallWash"`, `"OpenOffice"` …) — **except `plane.kind`, which the golden dump
  writes as an integer** (0 = Horizontal, 1 = Vertical, 2 = Ceiling). See §11.

## 1. P2 (plan point / 2-D vector)

| Field | Type | Notes |
|---|---|---|
| `x` | number | feet |
| `y` | number | feet |

Value semantics (two points are equal when both coordinates are exactly equal).

Operations: `a + b`, `a − b` (component-wise), `a × k` (scalar multiply).

Derived: **`length`** = √(x² + y²). The golden JSON includes a `length` property on every serialized P2 (e.g. the point
`{x: 36, y: 24}` is written with `"length": 43.266615305567875`). It is derived output only: readers must ignore it,
writers may emit it. (Points that come from the contract type `LayoutPoint` — the ceiling grid's `origin`, `u`, `v` —
are written without `length`.)

## 2. Enumerations

### IntentKind (order matters: it is the numeric order 0..7)

| # | Name (wire) | Display name (`IntentInk.Name`) | Ink colour |
|---|---|---|---|
| 0 | `Task` | `Task` | `#E08A1E` |
| 1 | `Ambient` | `Ambient` | `#3B82C4` |
| 2 | `WallWash` | `Wall wash` | `#8B5CD6` |
| 3 | `Accent` | `Accent` | `#D94C7A` |
| 4 | `FeaturePendant` | `Feature pendants` | `#1F9E8F` |
| 5 | `CeilingGlow` | `Ceiling glow` | `#C9A227` |
| 6 | `Path` | `Path` | `#5E9E3A` |
| 7 | `KeepDim` | `Keep dim` | `#6B7280` |

The default value of an IntentKind field (when nothing is set) is `Task`.

### PlaneKind — where an intent's light is measured

| # | Name | Meaning |
|---|---|---|
| 0 | `Horizontal` | A horizontal plane at `height` above the floor (0 floor, 2.5 desk, 3 counter, 3.5 bar). |
| 1 | `Vertical` | A wall/face strip between `bottom` and `top`. |
| 2 | `Ceiling` | The ceiling surface over the region, facing down, at `height`. |

### SpaceClass (order as declared)

`Other`, `Office`, `OpenOffice`, `Conference`, `Classroom`, `Cafeteria`, `Lobby`, `Corridor`, `DataHall`, `Retail`,
`Restroom`, `Storage`, `BreakRoom`. Wire form is the PascalCase name (golden `room.spaceClass`, e.g. `"OpenOffice"`,
`"DataHall"`). Display names are in `defaults.md`.

### StudioTool (canvas tool)

`Select`, `Task`, `Ambient`, `WallWash`, `Accent`, `FeaturePendant`, `CeilingGlow`, `Path`, `KeepDim` (numeric 0..8).
Mapping: tool → kind is "none" for `Select`, otherwise the IntentKind whose number is tool number − 1; kind → tool is
the tool whose number is kind number + 1.

### OverlayMode: `Design`, `Heatmap`. ViewMode: `Plan`, `Room3D`.

### Mount strings (`LayoutMount`, lowercase literal strings)

`"ceiling"`, `"pendant"`, `"wall"`, `"cove"`, `"feature"`. The default fixture mount is `"ceiling"`.

## 3. TargetRange — footcandle range

| Field | Type | Notes |
|---|---|---|
| `minimum` | number \| null | fc |
| `average` | number \| null | fc |
| `maximum` | number \| null | fc; a keep-dim intent sets only this |

Value semantics: two ranges are equal when all three fields are equal (null equals null). The "empty" range is
(null, null, null).

**`meets(average, minimum)`** — true when **all** of the following hold (a null bound imposes nothing):

1. if `minimum` bound is set: the measured `minimum ≥ minimumBound × 0.98`;
2. if `average` bound is set: the measured `average ≥ averageBound × 0.9`;
3. if `maximum` bound is set: the measured **average** (not the measured maximum) `≤ maximumBound × 1.02`.

There is no upper tolerance on the average bound other than via `maximum`. Comparisons are inclusive.

## 4. Workplane — the measuring plane

| Field | Type | Default | Notes |
|---|---|---|---|
| `kind` | PlaneKind | — (required) | |
| `height` | number | — (required) | Horizontal: height above floor. Vertical: by convention equals `bottom`. Ceiling: ceiling height. |
| `bottom` | number | 0 | Vertical only (0 otherwise) |
| `top` | number | 0 | Vertical only (0 otherwise) |
| `inferred` | boolean | true | true until the designer edits the plane |
| `reason` | string | `""` | what it was inferred from |

Value semantics (record equality on all six fields). The default plane of a new intent is
`{Horizontal, 2.5, 0, 0, true, ""}`.

## 5. IntentBehavior — per-intent designer knobs ("null = agent decides")

| Field | Type | Default | Meaning |
|---|---|---|---|
| `density` | number | 1 | Spacing multiplier on the agent's spacing. Documented range **0.6** (tighter, more fixtures) .. **1.6** (looser). The model does not clamp; consumers do (see solver spec). |
| `pattern` | string \| null | null | one of `"grid"`, `"staggered"`, `"rows"`, `"perimeter"`, or null |
| `alignToCeilingGrid` | boolean | true | |
| `avoidCeilingDevices` | boolean | true | |
| `wallOffset` | number \| null | null | Wall wash and accent: distance from the wall in ft; null = agent (≈ one third of ceiling height) |
| `aimAngle` | number \| null | null | Accent aim from nadir, degrees; null means 30 |
| `mountingHeight` | number \| null | null | Pendant/feature: fixture height above floor; null = agent (≈ 30 in above the surface) |
| `quantity` | integer \| null | null | Fixed count; overrides the solver's count |
| `keepDimMargin` | number \| null | null | Keep dim: how far beyond its edge other intents keep fixtures away, ft |

Value semantics (equality on all fields) — the draft-store test compares behaviours by value.

## 6. StudioProduct

| Field | Type | Default | Notes |
|---|---|---|---|
| `productId` | uuid \| null | null | Schedule/project product id when the product is "in the project" |
| *(excluded catalog id field)* | — | — | **Excluded.** Do not model. |
| `label` | string | `""` | |
| `catalog` | string | `""` | |
| `brand` | string | `""` | |
| `description` | string | `""` | |
| `family` | string | `""` | generic family: `troffer`, `volumetric`, `downlight`, `wallwash`, `accent`, `pendant-linear`, `pendant-can`, `cove`, `strip` (generic product spec adds e.g. `downlight-ho`) |
| `lumens` | number | 0 | |
| `watts` | number | 0 | |
| `length` | number | 1 | ft |
| `width` | number | 1 | ft |
| `isRound` | boolean | false | |
| `beamAngle` | number | 90 | degrees |
| `uplightShare` | number | 0 | 0..1 |
| `asymmetric` | boolean | false | |
| `isGeneric` | boolean | false | true for a generic stand-in with no real photometry |

Derived:

- **`inProject`** = `productId` is not null.
- **`key`** = if `productId` is set: the id in lowercase 8-4-4-4-12 form; otherwise `generic:{family}:{lumens}` where
  lumens is formatted with the `"0"` format (integer, rounded half away from zero, no grouping; see `geometry.md` §
  Number formatting), e.g. `generic:volumetric:3000`. (The original had a third branch for the excluded catalog id;
  drop it.)

## 7. ProductChoice

| Field | Type | Notes |
|---|---|---|
| `product` | StudioProduct | |
| `agentPicked` | boolean | cleared when the designer chooses a product |
| `reason` | string | |
| `alternatives` | StudioProduct[] | rebuilt on demand; never persisted (see `draft-store.md`) |

## 8. StudioFixture

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | new random | |
| `intentId` | string | `""` | owning intent id |
| `center` | P2 | (0,0) | |
| `orientation` | number | 0 | degrees CCW from +X |
| `mount` | string | `"ceiling"` | a mount string |
| `height` | number | 0 | ft above floor |
| `tilt` | number | 0 | degrees |
| `output` | number | 1 | share of product lumens. **Invariant: always 1** — fixtures are never dimmed; targets are met by count and lumen package. |
| `pinned` | boolean | false | moved by the designer; the solver keeps it where it is |

Value semantics with copy-on-write ("with" copies), e.g. pinning produces a new fixture equal except `pinned`.

## 9. ExistingFixture (a luminaire already in the room; shown and counted, owned by the source model)

`id` (uuid), `productId` (uuid), `label` (string), `center` (P2), `orientation` (number), `length`, `width` (numbers),
`isRound` (boolean), `mount` (string), `height` (number), `calculable` (boolean). All required.

## 10. LightingIntent — a painted goal (mutable)

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | 8 random lowercase hex chars | |
| `kind` | IntentKind | `Task` | fixed at creation |
| `label` | string | `""` | |
| `labelSuggested` | boolean | **true** | true while the label came from the agent/defaults; editing it makes it the designer's (false) |
| `region` | P2[] | `[]` | closed polygon for area intents; the **wash run** (2 points, along the wall) for WallWash; a **single point** for Accent |
| `wallIndex` | integer \| null | null | WallWash: the wall the run sits on |
| `objectIndex` | integer \| null | null | index into `room.objects` the intent was painted over / seeded from |
| `target` | TargetRange | (null,null,null) | |
| `targetReason` | string | `""` | |
| `plane` | Workplane | `{Horizontal, 2.5, 0, 0, true, ""}` | |
| `behavior` | IntentBehavior | all defaults | |
| `product` | ProductChoice \| null | null | |
| `fixtures` | StudioFixture[] | `[]` | |
| `isSuggestion` | boolean | false | a seeded suggestion places nothing until accepted |
| `handTuned` | boolean | false | designer moved fixtures; re-solving keeps them |
| `trace` | string[] | `[]` | human-readable solver decisions |

Invariants: `wallIndex`/`objectIndex`, when set, should be valid indices into the room (the draft loader enforces this,
see `draft-store.md`; the geometry/default functions treat out-of-range indices as "not given").

## 11. Room geometry records

### RoomObjectInfo

`name` (string), `kind` (string, free text; compared after trim + lowercase — see `workplane.md` KindOf), `center`
(P2), `length` (number, along `orientation`), `width` (number, across), `orientation` (degrees), `top`
(number | null, height of top above floor), `bottom` (number | null). Value semantics.

Known kind words used by the rules: surface kinds `desk`, `table`, `counter`, `reception`, `island`, `bar`; face kinds
`artwork`, `display`, `signage`, `mirror`, `screen`; plus `cabinet`, `seating`, `door`, `appliance`, `other`.

### CeilingZoneInfo

`height` (number), `isMain` (boolean), `loops` (P2[][]: first loop is the outer boundary, the rest are holes).

### CeilingStepInfo

`start` (P2), `end` (P2), `lowerHeight` (number), `upperHeight` (number) — a vertical ceiling step edge.

### WallOpening (contract type)

`kind` (string, e.g. `"window"`, `"door"`), `from`, `to` (distances along the wall from its start, from ≤ to),
`bottom`, `top` (heights above floor).

### LayoutCeilingGrid (contract type)

`origin` (point: a world-space grid intersection), `u`, `v` (perpendicular tile-step vectors, feet). Points here are
plain `{x, y}` (no `length` in golden).

### WallInfo

| Field | Type | Notes |
|---|---|---|
| `index` | integer | position in `room.walls` |
| `start`, `end` | P2 | |
| `inward` | P2 | unit normal pointing **into** the room |
| `top` | number | wall top height; 0 or less means "unknown → use the room ceiling height" (see workplane rules) |
| `openings` | WallOpening[] | |

Derived (both emitted in golden JSON):

- **`length`** = |end − start|.
- **`direction`** = (end − start) × (1 / max(length, 1e-9)). Note: a zero-length wall gives direction (0, 0) — this is
  *not* the same as `Geometry.unit`, which returns (1, 0) for a zero vector.

### StudioRoom

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | (empty uuid) | |
| `label` | string | `""` | e.g. `"204 Open office"` |
| `spaceType` | string | `""` | space type words such as `"open office"` (mutable) |
| `floor` | P2[][] | `[]` | loop 0 = outer boundary, others = holes (columns, voids) |
| `walls` | WallInfo[] | `[]` | |
| `ceilingHeight` | number | **9** | main ceiling height |
| `ceilingZones` | CeilingZoneInfo[] | `[]` | raised/lowered pockets; may include the main zone (`isMain`) |
| `ceilingSteps` | CeilingStepInfo[] | `[]` | |
| `ceilingGrid` | LayoutCeilingGrid \| null | null | |
| `objects` | RoomObjectInfo[] | `[]` | |
| `existing` | ExistingFixture[] | `[]` | |

Derived **`bounds`** (min, max): over every point of every floor loop, component-wise min and max. **If there are no
floor points at all, bounds are ((0,0), (1,1))** — different from `Geometry.bounds` of an empty set, which is
((0,0), (0,0)).

Golden JSON also carries derived room fields: `spaceClass` (ClassOf), `spaceTypeWords` (SpaceType), `wallNames`
(WallName for each index), `clusters` (see `defaults.md`).

## 12. RoomDesign — a room's design state

| Field | Type | Notes |
|---|---|---|
| `room` | StudioRoom | required |
| `intents` | LightingIntent[] | ordered |
| `removedExisting` | set of uuid | existing luminaires the designer removed |
| `calculation` | snapshot \| null | latest full calculation (see below); **never persisted in drafts** |
| `revision` | integer | bumped on every design change; a calculation older than this is stale |

Calculation snapshot shape (originally filled by the excluded external calculation; the web version may reuse the
shape for its own worker calculation): `revision` (int), `at` (timestamp), `zones` (map zone id → zone result). Zone
result: `zoneId`, `state` (string), `outline` (3-D points), `normal` (3-D point), `columnSpacing`, `rowSpacing`,
`points` (list of `{x, y, z, value}`), `average`, `minimum`, `maximum` (number | null). 3-D point = `{x, y, z}`.

## 13. IntentEstimate (live point-source estimate of one intent)

`average`, `minimum`, `maximum` (fc), `fixtures` (integer count), `watts` (number). Golden `solved[i].estimate` has
exactly these five keys.

## 14. IntentAdvice and the AI interface

`IntentAdvice`: `intentId`, `label`, `target` (TargetRange), `plane` (Workplane), `reason` (string — the target
reason shown under it). Golden `fallbackAdvice[i]` = `{index, label, target, plane, reason}`.

The studio AI has: an online flag; **advise** (labels, target ranges, planes for intents of a room); **pick product**
(for an intent, given project products); **interpret** (sentence → intents). Every method has a deterministic offline
fallback. (The original's catalog-search method is **excluded**.)

## 15. Excluded

The excluded catalog id on products and its key prefix; the external room/design link interface (room loading,
product scheduling, design planning/confirmation, calculation state/cancel, zone values); everything about the
external designer calculation. Do not model, call or stub these.

## 16. Golden serialization notes (for the golden test harness)

- Intent objects in golden (`seeds`, `interpret[].intents`, `solved[].intent`): `index`, `kind` (string),
  `label`, `region`, `wallIndex`, `objectIndex`, `target{minimum,average,maximum}`, `targetReason`,
  `plane{kind (INTEGER), height, bottom, top, inferred, reason}`, `behavior{density, pattern, alignToCeilingGrid,
  avoidCeilingDevices, wallOffset, aimAngle, mountingHeight, quantity, keepDimMargin}`, `isSuggestion`, `product`,
  `fixtures`, `trace`. `labelSuggested`, `handTuned` and `id` are not dumped. In `seeds`, `fixtures` and `trace` are
  `null` and `product` is `null`.
- `solved[].intent.product` is a projection `{family, label, lumens, watts, beamAngle, isGeneric}`.
- Fixture projection: `{center, orientation, mount, height, tilt, output, pinned}` (no id/intentId).
- Room objects: `{name, kind, center, length, width, orientation, top, bottom}`; walls add derived `length` and
  `direction`; existing fixtures `{id, productId, label, center, orientation, length, width, isRound, mount, height,
  calculable}`.

Recommendation: the TS model uses string plane kinds (`"Horizontal" | "Vertical" | "Ceiling"`); the golden harness
maps golden integers 0/1/2 to them.

## Test cases

| Test | Input | Expected |
|---|---|---|
| TargetRange equality | (10,20,35) vs (10,20,35) | equal |
| TargetRange equality with nulls | (null,null,5) vs (null,null,5) | equal |
| meets — all bounds, passes at tolerances | range (10,20,35); average 18, minimum 9.8 | true (18 ≥ 18; 9.8 ≥ 9.8; 18 ≤ 35.7) |
| meets — minimum too low | range (10,20,35); average 20, minimum 9.79 | false |
| meets — average too low | range (10,20,35); average 17.99, minimum 10 | false |
| meets — average above max tolerance | range (10,20,35); average 35.71, minimum 10 | false |
| meets — maximum uses average | range (null,null,5); average 5.1, minimum 0 | true (5.1 ≤ 5.1) |
| meets — keep dim fails | range (null,null,5); average 5.2, minimum 0 | false |
| meets — empty range | (null,null,null); any | true |
| Default intent | new LightingIntent | kind Task, label "", labelSuggested true, region [], target (null,null,null), plane {Horizontal,2.5,0,0,true,""}, behavior density 1 / pattern null / alignToCeilingGrid true / avoidCeilingDevices true / others null, fixtures [], trace [], isSuggestion false, handTuned false, id matches `^[0-9a-f]{8}$` |
| Default fixture | new StudioFixture | mount "ceiling", output 1, pinned false, orientation 0, height 0, tilt 0 |
| Default product | new StudioProduct | length 1, width 1, beamAngle 90, uplightShare 0, isGeneric false, inProject false |
| Product key, generic | productId null, family "volumetric", lumens 3000 | `generic:volumetric:3000` |
| Product key, generic rounding | family "x", lumens 1500.5 | `generic:x:1501` (half away from zero) |
| Product key, in project | productId 8713baa4-22dc-51c2-6e01-fb595b1d00b5 | `8713baa4-22dc-51c2-6e01-fb595b1d00b5`, inProject true |
| Wall derived | start (36,24), end (0,24) | length 36, direction (−1, 0) |
| Wall zero length | start = end = (1,1) | length 0, direction (0, 0) |
| Room bounds, empty floor | floor [] | ((0,0),(1,1)) |
| Room bounds | floor [[(0,0),(36,0),(36,24),(0,24)]] | ((0,0),(36,24)) |
| Room default ceiling | new StudioRoom | ceilingHeight 9 |
| Tool/kind mapping | Select / Task tool / KeepDim kind | none / Task / KeepDim tool |
| Ink names | each kind | as table §2 |
| P2 length (golden) | (36,24) | 43.266615305567875 |

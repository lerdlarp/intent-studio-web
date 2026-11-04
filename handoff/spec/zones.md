# Spec: zone planner (`packages/core/src/zones.ts`)

Builds the measuring zones of a design: one per (non-suggestion) intent on its plane, plus floor, ceiling and wall
surfaces. The same per-intent **shape** feeds the quick estimate (estimate.md §6) and the full calculation worker
(which samples a zone at its `spacing`). The original wrapped these in link request types for an external calculation;
those wrappers, the design request, the "skipped fixtures" list and the units fields are **not** ported.

Helpers from other specs: `wallFor(room, kind, region, wallIndex, objectIndex)` (workplane spec), `wallName(room, i)`
(defaults spec, e.g. `North wall`), `area`, `centroid`, `lerp`, `distance`, `dot`, `rect(a, b)` (axis-aligned rectangle
with corners (x0,y0),(x1,y0),(x1,y1),(x0,y1), x0/y0 the minima). Walls have start, end, length, unit direction
(end−start)/max(length, 1e-9), inward unit normal, and top (0 = unknown).

## Constants

| Name | Value |
|---|---|
| MAX_ZONES_PER_ROOM | 64 |
| PATCH_WIDTH (point / accent patch) | 3 ft |
| MAX_GRID_POINTS | 100 000 (declared in the original, never enforced; the calc worker may use it as a guard) |

## 1. Shape of an intent — `shape(design, intent)`

Depends on the intent's **plane kind** (and, for vertical planes, whether the kind is Accent). Returns null when there
is nothing to measure.

### Vertical plane

1. w = wallFor(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex); null → shape is null.
2. wall = room.walls[w]; len = wall length; dir = wall direction. Positions along the wall are t = dot(p − wall.start, dir).
3. Range [t0, t1]:
   - region empty → [0, len] (the whole wall);
   - region has exactly 1 point, **or** the kind is Accent (any count) → c = mean of t over the region points;
     [c − 1.5, c + 1.5];
   - otherwise (≥2 points, not Accent) → [min t, max t] over all region points.
4. Clamp t0 and t1 each to [0, len].
5. If t1 − t0 < 3: mid = (t0+t1)/2; t0 = max(0, mid − 1.5); t1 = min(len, t0 + 3); t0 = max(0, t1 − 3). (A patch of
   3 ft, slid to stay on the wall; on a wall shorter than 3 ft it is the whole wall.)
6. top = plane.top if plane.top > plane.bottom; else wall.top if > 0; else room.ceilingHeight.
7. Shape = Vertical, from = wall.start + dir·t0, to = wall.start + dir·t1, bottom = plane.bottom, top, inward =
   wall.inward, height = plane.bottom, polygon empty.

### Horizontal or ceiling plane

1. Footprint polygon:
   - region ≥ 3 points → the region as is;
   - region empty → room.floor[0] (or empty if the room has no floor);
   - 1 point → square of half-size 1.5 around it: rect(c − (1.5,1.5), c + (1.5,1.5));
   - 2 points → c = midpoint; half = max(1.5, distance/2); rect(c − (half,half), c + (half,half)).
2. Fewer than 3 polygon points → null.
3. Shape = plane kind (Horizontal or Ceiling), polygon, height = plane.height (the ceiling plane's height is also
   `plane.height`, e.g. 12 for a raised cloud).

### By intent kind (what this means in practice)

| Kind | Typical plane (workplane spec) | Zone |
|---|---|---|
| Ambient, Task, Path, FeaturePendant, KeepDim | Horizontal at work/floor height | the painted polygon (or floor) at that height |
| WallWash | Vertical | the wash run along its wall, ≥ 3 ft, between plane bottom and top |
| Accent | Vertical (object face) or Horizontal | a 3 ft patch centred on the mean of its points along the wall; on a horizontal plane a 3×3 ft square |
| CeilingGlow | Ceiling | the region polygon at the ceiling plane height, facing down |

## 2. Zone list — `zones(design, surfaces = true)`

A zone record (web version): `{ id, label, kind: "horizontal" | "ceiling" | "vertical", polygon?, height?, from?, to?,
bottom?, top?, spacing, target? }`.

1. For each intent in design order, skip suggestions; build its shape; skip if null. Zone:
   - id = intent id; label = `Intent · ` + intent label (U+00B7 middle dot, single spaces).
   - target = {min, avg, max} copied from the intent's target, or absent when all three are absent (a keep-dim
     intent carries only its maximum).
   - Vertical: from, to, bottom, top, **spacing 1**.
   - Horizontal/Ceiling: kind `ceiling` for a Ceiling plane else `horizontal`; polygon; height; spacing =
     intentSpacing(area(polygon)).
2. If `surfaces`, append surfaces (§3).
3. If more than 64 zones, keep the first 64.

**intentSpacing(area)** = 1 if area < 100; 2 if area ≤ 1500; else 3 (ft).

## 3. Surfaces

Skipped entirely if the room has no floor or floor[0] has < 3 points. `surfaceSpacing` = 3 if area(floor[0]) > 2000,
else 2. `budget` = 64 − (number of intent zones). In order, each added only while budget > 0 (decrement per zone):

1. `surface:floor`, label `Surface · Floor`, horizontal, polygon floor[0], height 0, surfaceSpacing, no target.
2. `surface:ceiling`, label `Surface · Ceiling`, ceiling, polygon floor[0], height room.ceilingHeight,
   surfaceSpacing.
3. For each wall i in order: `surface:wall:{i}`, label `Surface · {wallName(room, i)}`, vertical, from wall.start, to
   wall.end, bottom 0, top = wall.top if > 0 else room.ceilingHeight, surfaceSpacing.

(Holes in the floor and ceiling zones/steps are not separate surfaces.)

---

## Test cases

`AcceptedDesign(room)` = all seeds with `isSuggestion = false`, not solved. `Accepted(room, kind, region, wall?, obj?)` =
a non-suggestion intent with label/target/plane from the defaults and workplane specs.

| Name | Input | Expected |
|---|---|---|
| one zone per intent plus surfaces | Office AcceptedDesign + a suggestion Task over square (0,0)–(10,10) with id `sugg` | ids distinct; every non-suggestion intent id present; `sugg` absent; contains `surface:floor`, `surface:ceiling`, `surface:wall:0`…`3`; count = non-suggestion intents + 6; with surfaces=false count = non-suggestion intents; every surface label starts `Surface · ` and has no target; every intent zone label starts `Intent · `; `surface:wall:2` label is `Surface · North wall` |
| surfaces | Cafeteria, empty design | floor: horizontal, height 0, spacing 2; ceiling: ceiling kind, height 10; `surface:wall:2`: vertical, bottom 0, top 10 |
| big room spacing | room `Hangar`, floor rect (0,0)–(60,40), ceiling 20 | floor surface spacing 3 (area 2400 > 2000) |
| intent spacing | intentSpacing(99 / 100 / 1500 / 1501) | 1 / 2 / 2 / 3 |
| wash run | Office; wall = walls[2] (36,24)→(0,24); WallWash with region [start + dir·4, start + dir·20], wallIndex 2 | single zone with id = intent id; vertical; spacing 1; bottom 2; top 8; from.y = 24 (±1e-9); min(from.x, to.x) = 16, max = 32 (±1e-9) |
| accent patch on a face | same design + Accent on the Office artwork object (first object of kind `artwork`), region [face midpoint of that object], objectIndex = it | vertical; \|to.x − from.x\| = 3 (±1e-9); target.min equals the intent's target min; target.avg present |
| accent on a horizontal plane | that accent with plane Horizontal 2.5 and region [(10,10)] | horizontal; polygon of 4 points (the square (8.5,8.5)–(11.5,11.5), derived); height 2.5 |
| ceiling glow | Cafeteria AcceptedDesign, CeilingGlow zone | kind ceiling, height 12 |
| keep-dim target | Office AcceptedDesign, KeepDim zone | target min absent, avg absent, max 5 |
| zone cap | Office, 80 Ambient intents over floor[0] | zones(design).length = 64 |
| short run slides (derived) | wall length 36, region t values 35.5 and 36 | [33, 36] |
| short wall (derived) | wall length 2, any region | [0, 2] |
| no wall (derived) | room with no walls, vertical plane | shape null, no zone |
| golden shapes | every solved intent in the 4 golden rooms | sample counts from estimate.md match (shapes are exercised by the estimate parity) |

### Dropped

`ZonePlanner_RequestSkipsGenericProductsAndKeepsScheduledOnes`, `ZonePlanner_RequestCarriesRemovedExistingFixtures`,
`ZonePlanner_RequestPassesFixtureGeometryThrough` — they test the external design request, which is removed. (If the
export wants a "skipped" note, the original format was `{count} × {product label} ({intent label})`.)

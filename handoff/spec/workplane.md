# Workplane inference

Infers where an intent's light is measured, following common practice: desk 2′-6″, counter 3′, bar 3′-6″,
circulation at the floor, wash and accent on the vertical face they light. Output is a `Workplane`
(`model.md` §4) with `inferred = true`. Depends on `geometry.md` and `defaults.md` (classOf, className, wallName,
feetInches).

Reason strings are verbatim; `·` is U+00B7 MIDDLE DOT, `′`/`″` are U+2032/U+2033 (via feetInches).

## 1. Constants and kind sets

| Name | Value |
|---|---|
| DeskHeight | 2.5 |
| CounterHeight | 3 |
| BarHeight | 3.5 |
| SurfaceKinds (furniture a task or pendant sits over) | `desk`, `table`, `counter`, `reception`, `island`, `bar` |
| FaceKinds (wall-hung things a wash or accent lights) | `artwork`, `display`, `signage`, `mirror`, `screen` |

**KindOf(object)** = the object's `kind` (null → ""), trimmed, lower-cased (locale-independent).

## 2. Helper rules

### surfaceHeight(object) — height of a work surface
If `top` is not null and 1 ≤ top ≤ 4.5 (inclusive) → roundHalfEven(top × 12) / 12 (snapped to the nearest inch).
Otherwise by KindOf: `counter`, `reception`, `island` → 3; `bar` → 3.5; anything else → 2.5.

### surfaceWord (plane-reason variant)
desk → `Desk`, table → `Table`, counter → `Counter`, reception → `Reception`, island → `Island`, bar → `Bar`, anything
else → **`Surface`**.

### accepts(kind) — which objects an intent kind can be "painted over"
| Kind | Accepted objects |
|---|---|
| Task, FeaturePendant, CeilingGlow | KindOf ∈ SurfaceKinds |
| WallWash | KindOf ∈ FaceKinds |
| KeepDim | KindOf is `screen` or `display` |
| Accent | KindOf ∈ FaceKinds, or KindOf ∈ SurfaceKinds, or `top` is not null |
| Ambient, Path | none (no acceptor) |

### resolve(room, kind, region, objectIndex) → (index, object) or none
1. If objectIndex is given and 0 ≤ objectIndex < object count → that object (for **any** kind, regardless of accepts).
2. Else if kind has no acceptor, or region is empty → none.
3. Else objectUnder(room, region, acceptor).

### objectUnder(room, region, accept) — the accepted object with the most overlap
best = none, bestScore = 0. For each object i in order, skipping objects the acceptor rejects:
- fp = footprint(object).
- If region has ≥ 3 points: score = overlapArea(region, fp) (12 samples).
- Else (a point or a run):
  - reach = 1.0 for a 1-point region, 1.5 for a 2-point region (the run).
  - 1 point p: d = 0 if contains(fp, p), else polygonDistance(fp, [p]).
  - 2 points a, b: d = 0 if contains(fp, a) or contains(fp, b), else polygonDistance(fp, [a, b]).
  - If d > reach → skip the object.
  - score = (reach + 0.01 − d) × (2 if KindOf ∈ FaceKinds else 1). (Nearer is better; wall-hung things win over
    furniture when both are in reach.)
- If score > bestScore + 1e-9 → best = i, bestScore = score.

Consequences: ties keep the earlier object; an object with zero overlap is never chosen; a region with more than 2
but fewer than 3 points cannot happen. (A region with ≥ 3 points is always scored by overlap.)

### wallFor(room, kind, region, wallIndex, objectIndex) → wall index or none
1. No walls → none.
2. wallIndex given and in range → wallIndex.
3. Reference point `at` and optional direction `dir`:
   - objectIndex given and in range → at = object center, dir = heading(object.orientation);
   - else region has ≥ 2 points → at = midpoint of region[0] and region[1], dir = unit(region[1] − region[0]);
   - else region has 1 point → at = region[0], no dir;
   - else → none.
4. For each wall i in order: d = distanceToSegment(at, start, end). If dir exists **and kind is WallWash** and
   |dot(dir, wall.direction)| < 0.5 → d += 5 (a run parallel to a wall belongs to it; a wall the run crosses at a
   right angle does not). Keep the wall with the smallest d; **strictly smaller replaces**, so ties keep the earlier
   wall.

### nearestWall(room, p, reach = +∞) → wall index or none
bestD = reach. For each wall i in order: d = distanceToSegment(p, start, end); if d ≤ bestD (inclusive) → best = i,
bestD = d. Note: because of `≤`, **ties go to the later wall** (e.g. a point exactly at a room corner picks the
higher-index wall). None when no wall is within reach.

### faceMidpoint(room, object) — the midpoint of the face of a wall-hung object that looks into the room
c = centroid(floor[0]) (the object's center if the room has no floor). u = heading(object.orientation),
n = perp(u). If dot(n, c − object.center) < 0 → n = −n. Result = object.center + n × (object.width / 2).
Example: Office `Brand wall` (center (10, 23.85), width 0.2, orientation 0) → (10, 23.75).

### ambientPlane(cls)
| Class | Plane | Reason |
|---|---|---|
| Lobby, Corridor, DataHall | Horizontal, height 0 | `Floor level · {className(cls)} circulation` (e.g. `Floor level · lobby circulation`, `Floor level · data hall circulation`) |
| Cafeteria | Horizontal, 2.5 | `Table height, 2′-6″ · cafeteria dining` |
| others | Horizontal, 2.5 | `Work plane, 2′-6″ · {className(cls)}` (e.g. `Work plane, 2′-6″ · open office`; class Other gives `· room`) |

A "floor plane" is Horizontal, height 0, bottom 0, top 0, inferred true, with the given reason. All horizontal and
ceiling planes have bottom = 0 and top = 0.

## 3. infer(room, kind, region, wallIndex, objectIndex)

cls = classOf(room); found = resolve(room, kind, region, objectIndex).

| Kind | Rule (first that applies) |
|---|---|
| Ambient, KeepDim | ambientPlane(cls) |
| Task | (a) cls = DataHall → floor plane, reason `Floor level · aisle` (even if an object is found). (b) found → Horizontal at h = surfaceHeight(obj), reason `{surfaceWord(obj)} top, {feetInches(h)}, from {obj.name}`. (c) else Horizontal 2.5, reason `Task height, 2′-6″ (no furniture under it)` |
| FeaturePendant | found → Horizontal at h = surfaceHeight(obj), reason `{surfaceWord(obj)} top, {feetInches(h)}, under {obj.name}`; else ambientPlane(cls) |
| Path | floor plane, reason `Floor level · path of travel` |
| CeilingGlow | see §3.1 |
| WallWash | see §3.2 |
| Accent | see §3.3 |

Note: plane reasons use the object's **raw `name`** (not the cleaned label name) after `from`/`under` and before
`face`/`top` in accent reasons.

### 3.1 CeilingGlow
1. c = centroid(region) if region has ≥ 3 points; otherwise centroid(floor[0]) (or centroid(region) if the room has no
   floor).
2. zone = zoneAt(room, c); h = ceilingAt(room, c).
3. what = `Main ceiling` if no zone; `Raised ceiling` if zone.height > room.ceilingHeight; otherwise `Soffit`.
4. Plane: kind **Ceiling**, height h, bottom 0, top 0; reason `{what} at {feetInches(h)}, facing down`
   (e.g. `Raised ceiling at 12′-0″, facing down`).

### 3.2 WallWash
1. w = wallFor(room, WallWash, region, wallIndex, objectIndex). None → ambientPlane(cls).
2. name = wallName(room, w); top = wall.top if wall.top > 0, else room.ceilingHeight.
3. If top − 1 > 4 → Vertical, height 2, bottom 2, top = top − 1; reason
   `{name}, 2′-0″ to {feetInches(top − 1)} (clear of the base and the ceiling edge)`.
4. Else → Vertical, height 0, bottom 0, top = top; reason `{name}, 0 to {feetInches(top)}` (a literal `0`, not
   `0′-0″`).

### 3.3 Accent
If found (object o, k = KindOf(o)):
- k ∈ FaceKinds:
  1. bottom = o.bottom if not null else 3; top = o.top if not null else 7; known = both were non-null.
  2. If top − bottom < 0.5 → bottom = 3, top = 7, known = false.
  3. Vertical, height = bottom, bottom, top. Reason: known → `{o.name} face, {feetInches(bottom)} to {feetInches(top)}`;
     not known → `{o.name} face, 3′-0″ to 7′-0″ (its height is not known)`.
- otherwise → Horizontal at h = surfaceHeight(o); reason `{o.name} top, {feetInches(h)}`.

If not found:
1. p = region[0] if the region is non-empty, else (0, 0).
2. wi = wallIndex if given (even if out of range), else nearestWall(room, p, reach 1.5).
3. If wi is a valid wall index → Vertical, height 3, bottom 3, top 7; reason `{wallName(room, wi)} face, 3′-0″ to 7′-0″`.
4. Else ambientPlane(cls).

## 4. Ordering, determinism

Pure function of its inputs. Iteration over objects and walls is always in index order with the tie-breaks stated
above. Golden verification: every `plane` in all golden `seeds` and `interpret[].intents` (four rooms) is reproduced
exactly by these rules (kind, height, bottom, top, inferred, reason).

## Test cases

`Square` = [(0,0),(10,0),(10,10),(0,10)]. Rooms written "Room(label, …)" have empty spaceType. Plane written as
(kind, height, bottom, top, reason).

| Test | Input | Expected |
|---|---|---|
| desk task at desk height | Office; Task; region = inflate(footprint(`Desk cluster A`), 1.5); no wall/object | (Horizontal, 2.5, 0, 0, `Desk top, 2′-6″, from Desk cluster A`); inferred true; reason contains `Desk cluster A` and `2′-6″` |
| counter task at counter height | Cafeteria; Task; region = inflate(footprint(counter), 1.5) | height 3; reason `Counter top, 3′-0″, from Servery counter` (contains `Counter`) |
| bar is three and a half | Room `Lounge`, floor [Square], object `Bar` kind `bar` center (5,5), 8×2, orientation 0, top null, bottom 0; Task; region = inflate(footprint(bar), 1) | height 3.5; reason `Bar top, 3′-6″, from Bar` |
| lobby ambient on the floor | Lobby; Ambient; region floor[0] | height 0; reason `Floor level · lobby circulation` |
| data hall ambient on the floor | DataHall; Ambient; floor[0] | height 0; reason `Floor level · data hall circulation` |
| office ambient at desk height | Office; Ambient; floor[0] | height 2.5; reason `Work plane, 2′-6″ · open office` |
| cafeteria ambient at table height | Cafeteria; Ambient; floor[0] | height 2.5; reason `Table height, 2′-6″ · cafeteria dining` (contains `cafeteria`) |
| wall wash vertical with rule in reason | Office; WallWash; region [walls[2].start, walls[2].end]; wallIndex 2 | (Vertical, 2, 2, 8, `North wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)`) |
| wash on a short wall uses full height | Room `Closet`, floor [Square], ceilingHeight 4.5, one wall index 0 (0,0)→(10,0), inward (0,1), top 4.5; WallWash; region [(0,0),(10,0)]; wallIndex 0 | (Vertical, 0, 0, 4.5, `South wall, 0 to 4′-6″`) — reason contains `0 to` |
| wash, wall top unknown | as above but wall top 0, ceilingHeight 9 | (Vertical, 2, 2, 8, `South wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)`) |
| accent vertical on artwork face | Office; Accent; region [faceMidpoint(Brand wall)] = [(10, 23.75)]; objectIndex 6 | (Vertical, 3, 3, 7, `Brand wall face, 3′-0″ to 7′-0″`) |
| accent without known heights | Room `Gallery`, floor [Square], object `Mural` kind artwork center (5,9.9), 6×0.2, orientation 0, top null, bottom null; Accent; region [(5,9.8)]; objectIndex 0 | (Vertical, 3, 3, 7, `Mural face, 3′-0″ to 7′-0″ (its height is not known)`) |
| accent face too short | artwork with bottom 5, top 5.2 | (Vertical, 3, 3, 7, …`(its height is not known)`) |
| accent on a display table is horizontal | Room `Showroom`, floor [Square], object `Display table` kind table (5,5), 4×3, top 2.5, bottom 0; Accent; region [(5,5)]; no index | (Horizontal, 2.5, 0, 0, `Display table top, 2′-6″`) |
| accent near a wall, no object | Office; Accent; region [(18, 23)]; no index | (Vertical, 3, 3, 7, `North wall face, 3′-0″ to 7′-0″`) |
| accent far from walls | Office; Accent; region [(18, 12)] | ambient plane (Horizontal, 2.5, `Work plane, 2′-6″ · open office`) |
| glow is a ceiling plane at zone height | Cafeteria; CeilingGlow; region = the non-main zone's loop | (Ceiling, 12, 0, 0, `Raised ceiling at 12′-0″, facing down`) |
| glow under main ceiling | Office; CeilingGlow; region floor[0] | (Ceiling, 9, 0, 0, `Main ceiling at 9′-0″, facing down`) |
| glow under a soffit | Lobby; CeilingGlow; region rect((6,21),(34,28)) | (Ceiling, 10, 0, 0, `Soffit at 10′-0″, facing down`) |
| path is on the floor | Lobby; Path; region [(0,0),(5,0),(5,4)] | height 0; reason `Floor level · path of travel` |
| keep dim follows the room (circulation) | Lobby; KeepDim; floor[0] | height 0 (`Floor level · lobby circulation`) |
| keep dim follows the room (office) | Office; KeepDim; floor[0] | height 2.5 |
| feature pendant at the object top | Lobby; FeaturePendant; region footprint(Reception desk); no index | height 3; reason `Reception top, 3′-0″, under Reception desk` |
| feature pendant without object | Office; FeaturePendant; region rect((0,0),(1,1)) | ambient plane, 2.5 |
| task without furniture | Office; Task; region rect((0,20),(2,22)) | (Horizontal, 2.5, `Task height, 2′-6″ (no furniture under it)`) |
| data hall task | DataHall; Task; any region | (Horizontal, 0, `Floor level · aisle`) |
| object with most overlap wins | Room `Mixed`, floor [Square]; objects `Small desk` desk (3,3) 2×2 top 2.5, `Big counter` counter (6,3) 4×3 top 3; resolve(Task, rect((0,0),(8,5)), no index) | index 1 (overlaps 4 vs 12) |
| explicit index wins | same; resolve(Task, same region, objectIndex 0) | index 0 |
| explicit index any kind | resolve(Office, Ambient, [], 3) | index 3 (Meeting table) |
| no acceptor | resolve(Office, Path, floor[0], none) | none |
| surface height snaps to inch | object top 2.54 | 2.5 (30.48 in → 30) |
| surface height out of range | desk top 5 / counter top null / bar top 0.5 | 2.5 / 3 / 3.5 |
| nearestWall tie goes to later wall | Office; nearestWall((0,0)) | 3 (west wall; distance 0 to walls 0 and 3) |
| nearestWall reach | Office; nearestWall((18,12), 1.5) | none |
| wallFor run penalty | Office; WallWash; region [(1,2),(1,22)] (vertical run near the west wall); no index | 3 |
| wallFor explicit index | Office; wallFor(WallWash, [], 1, none) | 1 |
| wallFor no anchor | Office; wallFor(WallWash, [], none, none) | none |
| golden planes | every intent of every golden `seeds` and `interpret[].intents` | its `plane` (golden `kind` integer 0/1/2) |

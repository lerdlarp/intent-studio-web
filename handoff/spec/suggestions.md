# Suggestions (seeding) — `suggestions.ts`

What the agent proposes the first time it reads a room: up to **8** ranked `LightingIntent`s, each with a label, target
and plane, all marked as suggestions. Suggestions place nothing until the designer accepts them (see solver.md).

Depends on: geometry.md (Footprint, Inflate, Rect, Bounds, Area, Centroid, Contains, InRoom, PolygonDistance,
DistanceToSegment, OverlapArea, Heading, Perp, Unit, Dot, Distance), defaults.md (ClassOf, Target, Label, the space
classes), workplane.md (KindOf, SurfaceKinds, Infer, WallFor, FaceMidpoint).

Conventions used below:

- "Object kind" always means workplane.md `KindOf(object)`: the object's `kind` string trimmed and lower-cased.
- **SurfaceKinds** = { desk, table, counter, reception, island, bar }.
- "Stable sort" means ties keep their incoming order (JS `Array.prototype.sort` is stable; keep it).
- "Round" written **round½even** is banker's rounding (C# `Math.Round(x)`): halves go to the even integer.
- All lengths in feet.

---

## 1. Constants

| Name | Value | Meaning |
|---|---|---|
| `MergeDistance` | 3 | Two surface objects of the same kind whose footprints are ≤ 3 ft apart are one cluster |
| `MaxSuggestions` | 8 | Seed returns at most 8 intents |
| Cluster region inflate | 1.5 | Cluster region = footprint (or bounding rectangle) grown by 1.5 ft |
| Cluster row band | 3 | Clusters are ordered by `round½even(centerY / 3)` descending, then X |
| Task cluster cap | 4 | At most 4 task suggestions from clusters |
| Aisle cap | 3 | At most 3 data-hall aisle tasks |
| Pendant cluster cap | 2 | At most 2 feature-pendant suggestions over reception/island/bar clusters |
| Cafeteria table minimum | 4 | Table pendants need ≥ 4 tables |
| Glow raise | 0.5 | A ceiling zone must be more than 0.5 ft above the main ceiling |
| Accent face cap | 2 | At most 2 accents |
| Screen cap | 2 | At most 2 keep-dim zones |
| Keep-dim depth | 5 | Keep-dim region reaches 5 ft into the room |
| Keep-dim end allowance | 0.5 | Keep-dim region extends 0.5 ft past each end of the screen |
| Wash wall minimum length | 6 | Walls shorter than 6 ft are never washed |
| Path band half width | 2 | Path is a 4 ft band, inset 2 ft from the room bounds at each end |

### Scores (higher ranks first)

| Suggestion | Score |
|---|---|
| Ambient over the floor | 100 |
| Task over cluster *i* (i = 0..3, by area) | 90 − 3·i (90, 87, 84, 81) |
| Data-hall aisle *i* (i = 0..2) | 88 − 3·i (88, 85, 82) |
| Wall wash | 80 |
| Ceiling glow (each qualifying zone) | 75 |
| Accent *k* (k = 0, 1) | 70 − 2·k (70, 68) |
| Keep-dim in front of a screen (each) | 65 |
| Cafeteria table pendants | 62 |
| Feature pendant over reception/island/bar cluster (each) | 60 |
| Path | 50 |

---

## 2. Clusters

`Clusters(room)` → ordered list of `ObjectCluster { group, ordinal, objects, region }`:

- `group` — the object kind (one of SurfaceKinds),
- `ordinal` — 0-based position within its group after ordering (gives the "cluster A, B, C" letter),
- `objects` — indices into `room.objects`, ascending,
- `region` — polygon.

Algorithm:

1. Take every room object whose kind is in SurfaceKinds, remembering its room index. Group them by kind. **Group order
   is the order in which each kind first appears** in `room.objects` (not alphabetical). Within a group, items keep
   room order.
2. For each group (items numbered 0..n−1 in group order), compute each item's footprint (geometry.md `Footprint`).
3. Union-find with path compression. For `a` from 0 to n−1, for `b` from a+1 to n−1: if `find(a) ≠ find(b)` and
   `PolygonDistance(foot[a], foot[b]) ≤ 3` (≤, inclusive), set `parent[find(a)] = find(b)`.
   - The distance metric is geometry.md `PolygonDistance` between the two footprint polygons: 0 when one contains the
     other's first vertex or any edges properly cross, otherwise the minimum of the four vertex-to-segment distances over
     every edge pair. It is **not** a centre distance and not a bounding-box gap.
   - Only connectivity matters for the output: which root ends up representing a set does not affect anything below.
4. Form clusters: walk items k = 0..n−1; group by root; **cluster order = order of the first (lowest-k) member**;
   members within a cluster ascending by k.
5. For each cluster:
   - `pts` = all footprint corners of its members, member order, each footprint's 4 corners in footprint order.
   - `center` = (mean of pts X, mean of pts Y) — sum sequentially then divide by the count.
   - `region` = if one member: `Inflate(footprint, 1.5)`; else `Inflate(Rect(Bounds(pts).min, Bounds(pts).max), 1.5)`.
   - `objects` = the members' room indices.
6. Stable-sort the group's clusters by key1 = `−round½even(center.Y / 3)` ascending (i.e. higher bands first), then
   key2 = `center.X` ascending.
7. Assign `ordinal` = position 0, 1, 2… in that order. Append to the result (groups one after another in group order).

`ClusterOf(room, objectIndex)` = the first cluster in `Clusters(room)` whose `objects` contains the index, else none
(used by defaults.md labels: "Desk cluster A task").

`RectOf(pts)` below always means `Rect(Bounds(pts).min, Bounds(pts).max)` (geometry.md; Rect returns the 4 corners
(x0,y0),(x1,y0),(x1,y1),(x0,y1)).

---

## 3. Seed

`Seed(room)` → list of `LightingIntent`.

0. If the room has no floor loop, or `floor[0]` has fewer than 3 points → return an empty list.
1. `cls = ClassOf(room)` (defaults.md).
2. Keep a list `scored` of (score, intent) pairs in insertion order.

**Making an intent** — `Make(kind, region, wall, obj, ambient = none)`:

| Field | Value |
|---|---|
| id | a fresh unique id (the original uses 8 random hex chars; golden data matches by index) |
| kind | kind |
| label | defaults.md `Label(room, kind, region, wall, obj)` |
| labelSuggested | true |
| region | a copy of region |
| wallIndex / objectIndex | wall / obj (may be none) |
| target, targetReason | defaults.md `Target(room, kind, obj, ambient)` |
| plane | workplane.md `Infer(room, kind, region, wall, obj)` |
| isSuggestion | true |
| behavior | defaults (density 1, pattern none, alignToCeilingGrid true, avoidCeilingDevices true, every other knob none) |
| product | none; fixtures empty; trace empty; handTuned false |

Steps (each adds to `scored` in this order):

3. **Ambient** — `Make(Ambient, floor[0], none, none)`, score 100. Remember `ambientAverage` = its target average.
4. **Task over clusters** — `clusters = Clusters(room)`. Keep clusters with `TaskWanted(cls, group)` (table below).
   Stable-sort those by `Area(region)` **descending**. For i = 0 .. min(count, 4) − 1: score `90 − 3i`,
   `Make(Task, cluster.region, none, obj)` where obj = the single member when the cluster has one object, else
   `ClosestTo(room, cluster)`.
5. **Data-hall aisles** — only when `cls = DataHall`: `aisles = Aisles(room)` (§5). For i = 0 .. min(count, 3) − 1:
   score `88 − 3i`, `Make(Task, aisles[i], none, none)`.
6. **Feature pendants over reception/island/bar** — the first 2 clusters (in `Clusters` order) whose group is
   `reception`, `island` or `bar`. For each: obj = the single member, or `ClosestTo(room, cluster)` when it has several;
   region = the object's `Footprint` when single, else `Inflate(cluster.region, −1.5)` (back to the bounding rectangle).
   Score 60, `Make(FeaturePendant, region, none, obj)`.
7. **Cafeteria table pendants** — only when `cls = Cafeteria`: collect the object indices of every cluster whose group is
   `table` (cluster order, then member order). If there are ≥ 4: `pts` = all their footprint corners;
   region = `Inflate(RectOf(pts), 0.5)`; score 62, `Make(FeaturePendant, region, none, none)`.
8. **Wall wash** — when `WashWanted(cls)` and `PickWashWall(room)` returns a wall index w: score 80,
   `Make(WallWash, WashRun(room, w), w, none)`.
9. **Ceiling glow** — for each ceiling zone in room order: skip it when it is the main zone, or
   `zone.height ≤ ceilingHeight + 0.5`, or it has no loops. Otherwise score 75, `Make(CeilingGlow, zone.loops[0], none, none)`.
10. **Accents** — objects whose kind is `artwork`, `display` or `signage`, stable-sorted by `length` **descending**,
    first 2. For k = 0, 1: score `70 − 2k`, `Make(Accent, [FaceMidpoint(room, object)], none, objectIndex, ambientAverage)`
    (region is the single face-midpoint point; the target is 3× the ambient average via defaults.md).
11. **Keep-dim** — the first 2 objects (room order) whose kind is `screen`: score 65,
    `Make(KeepDim, KeepDimRegion(room, object), none, objectIndex)`.
12. **Path** — when `cls` is Lobby or Corridor and `PathRegion(room)` is not none: score 50, `Make(Path, path, none, none)`.
13. Stable-sort `scored` by score **descending**, take the first 8, return their intents in that order.

Because the sort is stable, equal scores keep insertion order (e.g. two keep-dims at 65 keep room order; two
reception pendants at 60 keep cluster order).

### TaskWanted(cls, group)

| group | wanted when |
|---|---|
| desk | cls ≠ DataHall |
| table | cls ∈ { Office, OpenOffice, Conference, Classroom, Other, BreakRoom, Retail } (so **not** Cafeteria, Lobby, Corridor, DataHall, Restroom, Storage) |
| counter | cls ≠ DataHall |
| reception | cls ≠ DataHall |
| island | cls ≠ DataHall |
| bar | cls ≠ DataHall |
| anything else | never |

### WashWanted(cls)

True unless cls is DataHall, Storage or Restroom.

### ClosestTo(room, cluster)

`c = Centroid(cluster.region)`; among the cluster's object indices (ascending), the one whose object centre has the
smallest `Distance` to c; ties keep the first (lowest index).

---

## 4. Wall wash

### Opening classification

- **Door**: opening kind contains `door`, case-insensitive.
- **Window**: opening kind contains `window` or `glaz`, case-insensitive.

### FeatureObjects(room, wall)

Objects (room order) whose kind is `artwork`, `signage`, `display` or `mirror` and whose centre is **< 1.5 ft** from the
wall segment (`DistanceToSegment(center, wall.start, wall.end) < 1.5`). Screens are not features.

### PickWashWall(room)

1. No walls → none.
2. `entry` = the inward normals of every wall that has at least one door opening (wall order).
3. `all` = indices of walls with `length ≥ 6`. Empty → none.
4. `windowless` = walls in `all` with no window opening. `pool` = windowless if non-empty, else all.
5. Score of wall i:
   - `usable = length − Σ |opening.to − opening.from|` over **all** its openings (doors and windows), summed in order;
   - `+100` when FeatureObjects(room, wall) is non-empty;
   - `+15` when any entry normal e has `Dot(e, wall.inward) < −0.8` (the wall faces a door wall);
6. Return the pool member with the highest score; ties go to the earliest in wall order.

### WashRun(room, wallIndex)

Returns a 2-point run `[start + d·t0, start + d·t1]` along the wall (d = wall unit direction, start = wall start,
len = wall length):

1. t0 = 0, t1 = len.
2. If the wall has feature objects: project every corner of every feature footprint onto the wall:
   `t = Dot(corner − start, d)`. t0 = max(0, min t − 1); t1 = min(len, max t + 1).
   If `t1 − t0 < 3` or `t1 − t0 > 0.9 · len`, fall back to t0 = 0, t1 = len.
3. Compute the points as `start + d·t0` and `start + d·t1` (even for the full wall — do not substitute `wall.end`).

---

## 5. Data-hall aisles

`Aisles(room)` → list of rectangles.

1. `cabs` = objects (room order) whose kind is `cabinet` and `max(length, width) ≥ 6`.
2. `boxes` = `Bounds(Footprint(cab))` for each — axis-aligned (min, max).
3. For every **ordered** pair (a, b), a outer loop 0..n−1, b inner loop 0..n−1, a ≠ b, check two cases in this order:
   - **b above a**: `gapY = b.min.Y − a.max.Y`, `overlapX = min(a.max.X, b.max.X) − max(a.min.X, b.min.X)`.
     If `3 ≤ gapY ≤ 12` and `overlapX ≥ 4` and not *BlockedY*, add
     `Rect((max(a.min.X, b.min.X), a.max.Y), (min(a.max.X, b.max.X), b.min.Y))`.
     *BlockedY*: some other box c (c ≠ a, c ≠ b) has `c.min.Y < b.min.Y` and `c.max.Y > a.max.Y` and
     `c.min.X < a.max.X` and `c.max.X > a.min.X` (all strict; the X test uses **a's full X extent**, not the overlap).
   - **b right of a**: `gapX = b.min.X − a.max.X`, `overlapY = min(a.max.Y, b.max.Y) − max(a.min.Y, b.min.Y)`.
     If `3 ≤ gapX ≤ 12` and `overlapY ≥ 4` and not *BlockedX*, add
     `Rect((a.max.X, max(a.min.Y, b.min.Y)), (b.min.X, min(a.max.Y, b.max.Y)))`.
     *BlockedX*: some other box c has `c.min.X < b.min.X` and `c.max.X > a.max.X` and `c.min.Y < a.max.Y` and
     `c.max.Y > a.min.Y`.
4. Stable-sort the rectangles by `−Centroid(r).Y` ascending (top of the plan first), then `Centroid(r).X` ascending.

### AisleNumber(room, region)

Used by defaults.md labels ("Aisle 2 task"). Returns 0 when `region` has fewer than 3 points or `ClassOf(room) ≠ DataHall`.
Otherwise, with `at = Centroid(region)`, returns i + 1 for the first aisle i (in `Aisles` order) with
`Distance(Centroid(aisle), at) < 1`; 0 when none.

---

## 6. Keep-dim region in front of a screen

`KeepDimRegion(room, screen)`:

1. Find the screen's index as **the first object in room order equal to it in every field** (value equality — two
   identical objects resolve to the first one). `wi = WallFor(room, KeepDim, [], none, thatIndex)` (workplane.md:
   with an object index it measures from the object centre; for KeepDim there is no "parallel run" penalty; nearest wall
   by `DistanceToSegment`, strict <, first wins).
2. `inward` = that wall's inward normal; when there is no wall, `Unit(Centroid(floor[0]) − screen.center)` (or the
   screen centre itself in place of the floor centroid when there is no floor, giving the fallback unit (1, 0)).
3. `u = Heading(screen.orientation)`; when `screen.length < screen.width`, `u = Perp(u)` (run along the long side).
4. `half = max(length, width) / 2 + 0.5`.
5. `a = center − u·half`, `b = center + u·half`. Region = `[a, b, b + inward·5, a + inward·5]` (exactly this vertex order).

---

## 7. Path region (lobbies and corridors)

`PathRegion(room)` → a 4 ft wide rectangle along the room's long axis, or none.

1. `(lo, hi)` = room bounds (min/max over **all** floor loop points; (0,0)–(1,1) when there are none).
   `w = hi.X − lo.X`, `h = hi.Y − lo.Y`. If `w < 6` or `h < 6` → none.
2. `alongX = (w ≥ h)`; `span = h` when alongX else `w`; `base = lo.Y` when alongX else `lo.X`;
   `centre = base + span / 2`.
3. best cost = +∞, best rect = none. For k = 0..8 (9 candidates):
   - `c = base + 2 + (span − 4)·k / 8` (multiply by k first, then divide by 8).
   - rect = alongX ? `Rect((lo.X + 2, c − 2), (hi.X − 2, c + 2))` : `Rect((c − 2, lo.Y + 2), (c + 2, hi.Y − 2))`.
   - Skip the candidate when `InRoom(room, Centroid(rect))` is false.
   - `overlap` = Σ over objects (room order) whose `top` is none **or** > 1 of `OverlapArea(rect, Footprint(object), 6)`
     (geometry.md; 6×6 samples over the object's footprint bounds).
   - `cost = overlap + |c − centre| · 0.01`.
   - Take it when `cost < best − 1e-9`.
4. Return the best rect (none if every candidate was skipped).

---

## 8. Ids, labels and output order

- Output order is exactly the stable score order of §3 step 13, truncated to 8.
- Labels come from defaults.md `Label`; they are deterministic and are what golden data compares (ids are not).
- Every seed has `isSuggestion = true` and `labelSuggested = true`.

---

## 9. Worked example — Office (golden `Office.json`, "seeds")

Room: floor 36×24, ceiling 9, grid 2 ft, class OpenOffice. Walls: 0 south (window 3–33), 1 east, 2 north, 3 west (door 2–5).
Objects: 0 Desk A desk (9,12.75) 11×3; 1 Desk B desk (9,5.75) 11×3; 2 Desk C desk (22,5.75) 7×3; 3 Meeting table (28,17)
8×4; 4/5 sofas (seating); 6 Brand wall artwork (10,23.85) 14×0.2; 7 Screen (35.85,17) 5×0.2 orientation 90.

Clusters: group order desk, table. Desk A y 11.25–14.25 vs desk B y 4.25–7.25: gap 4 > 3, separate; B x 3.5–14.5 vs C
x 18.5–25.5: gap 4, separate. Keys: A −round½even(4.25) = −4; B −round½even(1.9167) = −2; C −2 → order A, B (x 9), C (x 22),
ordinals 0, 1, 2. Regions: A (2,9.75)–(16,15.75), B (2,2.75)–(16,8.75), C (17,2.75)–(27,8.75); table (22.5,13.5)–(33.5,20.5).

Tasks by area desc (stable): A 84, B 84, table 77, C 60 → scores 90, 87, 84, 81.
Wash: pool = walls 1, 2, 3 (wall 0 has a window). Scores: wall 1 = 24 + 15 (faces the west door wall) = 39; wall 2 = 36 +
100 (Brand wall 0.15 ft away) = 136; wall 3 = 24 − 3 = 21 → wall 2. Run: start (36,24), d (−1,0); artwork corners
t = 19..33 → t0 18, t1 34 (16 ≥ 3 and ≤ 32.4) → `[(18,24), (2,24)]`.
Accent: face midpoint: floor centroid (18,12), n = (0,1) flipped to (0,−1) → (10, 23.75); target 3×20 = 60.
Keep-dim: nearest wall to (35.85,17) is wall 1 (inward (−1,0)); u = Heading(90) ≈ (6e−17, 1); half 3 →
`[(35.85,14), (35.85,20), (30.85,20), (30.85,14)]` (within 1e−15).
No glow (only the main zone), no path (not a lobby).

Result (score): Open office ambient (100), Desk cluster A task (90), Desk cluster B task (87), Meeting table task (84),
Desk cluster C task (81), Brand wall wash (80), Brand wall accent (70), Screen — keep dim (65). This matches golden.

Other rooms, checked against golden:
- **Cafeteria**: counter task only (tables are not wanted in a cafeteria); 24 tables merge into one cluster (gaps 2.0 and
  1.4 ft); wash on wall 2 (45 + 100), run `[(31,32),(3,32)]`; glow on the 12 ft cloud; menu-board accent; table pendants
  region (8.7,3.2)–(41.3,22.8) at 62. Order: ambient, counter task, wash, glow, accent, table pendants.
- **Lobby**: reception task (90), wash on wall 2 (40 + 100 + 15 = 155), accent (70), reception pendants over the desk
  footprint (60), path at k = 7 (c = 23, the only candidate with zero overlap) → `(2,21)–(38,25)` (50). Zones at 10 and 9 ft
  are below the 14 ft main ceiling, so no glow.
- **Data hall**: 4 rack rows at y 25/19/13/7 give aisles y 20–24, 14–18, 8–12 (x 6–34); non-adjacent pairs are blocked;
  no wash, accents or keep-dim.

---

## Test cases

### Seed_OfficeSuggestsSensibleKinds (room: demo Office)

| Assertion | Expected |
|---|---|
| seed count | between 4 and 8 inclusive |
| every seed | isSuggestion, labelSuggested, non-empty label |
| ambient seeds | exactly 1 |
| task seeds | ≥ 2 |
| an accent labelled | `Brand wall accent` exists |
| a keep-dim labelled | `Screen — keep dim` exists (em dash U+2014) |
| the single wall-wash seed | wallIndex = 2; plane kind Vertical |
| ceiling-glow seeds | none |

### Seed_DesksMergeWithinThreeFeet

| Setup | Expected |
|---|---|
| demo Office, `Clusters` filtered to group `desk` | 3 clusters, ordinals [0, 1, 2] in list order |
| room "Open office", floor 30×20; desks (5,5), (5,8), (20,5), each 4×2, orientation 0, top 2.5, bottom 0 | 2 clusters in total; the largest has 2 objects (desks 1 and 2: gap 1 ft ≤ 3) |

### Seed_CafeteriaCoversCounterTablesCloudAndMenuBoards (demo Cafeteria)

| Assertion | Expected |
|---|---|
| seed count | ≤ 8 |
| ambient | present |
| the single task whose label contains `Servery` (case-insensitive) | plane height 3 (±1e-9); target (25, 40, 60) |
| the single ceiling glow | plane kind Ceiling, height 12 (±1e-9) |
| an accent whose label contains `Menu` (case-insensitive) | present |

### Seed_LobbyHasAFloorAmbientReceptionPendantsAccentAndPath (demo Lobby)

| Assertion | Expected |
|---|---|
| ambient plane height | 0 |
| feature pendant | present |
| accent whose label contains `Feature wall` | present |
| path | present |
| task whose label contains `Reception` | present |
| ceiling glow | none (no zone higher than the main ceiling) |

### Seed_DataHallHasAisleTasksOnTheFloorAndNoWash (demo Data hall)

| Assertion | Expected |
|---|---|
| wall wash / accent seeds | none / none |
| task seeds | ≥ 2; all plane height 0; all target minimum 20 and maximum 50 |
| task labels | all distinct; exactly `Aisle 1 task`, `Aisle 2 task`, … in seed order; none is `Task zone` |
| `Label(room, Task, aisle.region, none, none)` | equals each aisle's label |
| every rack footprint vs every aisle | `OverlapArea(aisle.region, rack, 8) < 1` |

### Seed_IsRankedAmbientFirstAndDeterministic (each demo room)

| Assertion | Expected |
|---|---|
| first seed kind | Ambient |
| two Seed calls | identical label sequences |
| every region point | non-empty region; every point within floor[0] bounds expanded by 3 ft on each side |

### Seed_EmptyRoomGivesNothing

| Setup | Expected |
|---|---|
| room with label "Nothing" and no floor | 0 seeds |

### Golden parity (golden/*.json "seeds" and room.clusters)

| Room | Expected |
|---|---|
| Office | 8 seeds in the order of §9; regions exactly as listed (±1e-6) |
| Cafeteria | 6 seeds: ambient, `Servery counter task`, `Menu boards wash` (wall 2, run (31,32)→(3,32)), `Cove glow`, `Menu boards accent` (point (17,31.75)), `Table pendants` |
| Lobby | 6 seeds: ambient, `Reception desk task`, `Feature wall wash` (wall 2, run (31,28)→(9,28)), `Feature wall accent` (point (20,27.75)), `Reception desk pendants` (14,15.5)–(26,19), `Entry path` (2,21)–(38,25) |
| Data hall | 4 seeds: ambient, `Aisle 1 task` (6,20)–(34,24), `Aisle 2 task` (6,14)–(34,18), `Aisle 3 task` (6,8)–(34,12) |
| clusters | each room's `room.clusters` equals `Clusters(room)` (group, ordinal, objects, region) |

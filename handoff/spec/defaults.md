# Defaults — space classes, targets, labels, wall names

Deterministic rules the app falls back on when the agent is offline (and that seed every suggestion). Depends on
`geometry.md`, `workplane.md` (KindOf, Resolve, WallFor, surface/face kind sets) and the cluster/aisle helpers in §7
(shared with `suggestions.md`).

All strings below are verbatim. Watch the special characters: `–` EN DASH U+2013 in ranges, `—` EM DASH U+2014 in
the keep-dim label, `×` U+00D7, `·` U+00B7 MIDDLE DOT, `′` U+2032, `″` U+2033.

## 1. Classifying words: `classFromWords(text)`

1. If text is null, empty, or only whitespace → null.
2. Test the patterns below **in this order**; the first that matches anywhere in the text wins (so "data hall" is
   not mistaken for a hall, "elevator lobby" is a Lobby because Lobby comes before Corridor, "open office" before
   "office").
3. No match → null.

All patterns are **case-insensitive**. Regex text (reproduce exactly):

| # | Class | Pattern |
|---|---|---|
| 1 | `DataHall` | `\b(data\s*(hall\|center\|centre\|room)\|server\|computer\s+room\|mdf\|idf\|telecom)\b` |
| 2 | `Cafeteria` | `\b(cafeteria\|dining\|canteen\|restaurant\|servery\|cafe\|caf[eé]\|food\s+court)\b` |
| 3 | `Lobby` | `\b(lobby\|entry\|entrance\|vestibule\|foyer\|atrium\|reception\s+area\|reception)\b` |
| 4 | `Corridor` | `\b(corridor\|hallway\|hall\|passage\|circulation\|stair(s\|well)?\|elevator\s+lobby)\b` |
| 5 | `Conference` | `\b(conference\|meeting\|boardroom\|board\s+room\|huddle)\b` |
| 6 | `Classroom` | `\b(classroom\|lecture\|training\|seminar\|school)\b` |
| 7 | `OpenOffice` | `\b(open[\s-]+(plan\s+)?office\|bullpen\|open\s+workspace)\b` |
| 8 | `Office` | `\b(office\|workroom\|workspace\|studio)\b` |
| 9 | `Retail` | `\b(retail\|store\|showroom\|shop\|sales\s+floor)\b` |
| 10 | `Restroom` | `\b(restroom\|toilet\|lavatory\|wc\|bathroom)\b` |
| 11 | `Storage` | `\b(storage\|closet\|janitor\|mechanical\|electrical\|utility\|supply)\b` |
| 12 | `BreakRoom` | `\b(break\s*room\|lounge\|kitchenette\|pantry\|breakout)\b` |

(The `\|` above is only Markdown table escaping: the pattern contains a plain `|`.)

Plain-text copies (one per line, same order):

```
\b(data\s*(hall|center|centre|room)|server|computer\s+room|mdf|idf|telecom)\b
\b(cafeteria|dining|canteen|restaurant|servery|cafe|caf[eé]|food\s+court)\b
\b(lobby|entry|entrance|vestibule|foyer|atrium|reception\s+area|reception)\b
\b(corridor|hallway|hall|passage|circulation|stair(s|well)?|elevator\s+lobby)\b
\b(conference|meeting|boardroom|board\s+room|huddle)\b
\b(classroom|lecture|training|seminar|school)\b
\b(open[\s-]+(plan\s+)?office|bullpen|open\s+workspace)\b
\b(office|workroom|workspace|studio)\b
\b(retail|store|showroom|shop|sales\s+floor)\b
\b(restroom|toilet|lavatory|wc|bathroom)\b
\b(storage|closet|janitor|mechanical|electrical|utility|supply)\b
\b(break\s*room|lounge|kitchenette|pantry|breakout)\b
```

Regex dialect note: in the reference engine `\b` and `\w` are **Unicode-aware** (letters such as `é` are word
characters). JavaScript's `\b` is ASCII-only even with the `u` flag, so `\bcafé\b` would never match "café " in JS.
Implement each `\b` as a Unicode word boundary, e.g. with the `iu` flags and replacing the leading `\b` with
`(?<![\p{L}\p{N}_\p{M}])` and the trailing `\b` with `(?![\p{L}\p{N}_\p{M}])` (both groups in the patterns start and end
with a word character, so this is equivalent). `\s` is Unicode whitespace in both engines.

## 2. Space class of a room: `classOf(room)`

1. `classFromWords(room.spaceType)` if not null.
2. else `classFromWords(room.label)` if not null.
3. else count objects by KindOf (trim + lowercase of `kind`), call the count N(k), and take the first rule that holds:
   1. N(desk) ≥ 3 → `OpenOffice`
   2. N(desk) ≥ 1 → `Office`
   3. N(reception) ≥ 1 → `Lobby`
   4. N(cabinet) ≥ 4 and N(desk) = 0 → `DataHall`
   5. N(table) ≥ 6 → `Cafeteria`
   6. N(table) ≥ 1 → `Conference`
   7. N(seating) ≥ 2 → `BreakRoom`
   8. otherwise `Other`.

### Class display names: `className(cls)`

| Class | Name |
|---|---|
| OpenOffice | `open office` |
| Office | `office` |
| Conference | `conference room` |
| Classroom | `classroom` |
| Cafeteria | `cafeteria` |
| Lobby | `lobby` |
| Corridor | `corridor` |
| DataHall | `data hall` |
| Retail | `retail` |
| Restroom | `restroom` |
| Storage | `storage room` |
| BreakRoom | `break room` |
| Other | `room` |

### Space type words: `spaceType(room)`

If `room.spaceType` is not null/whitespace → `room.spaceType` trimmed (as typed, not normalised). Otherwise
`className(classOf(room))`. Golden `room.spaceTypeWords` is this value.

## 3. Default targets: `target(room, kind, objectIndex, ambientAverage)` → (range, reason)

cls = classOf(room). obj = room.objects[objectIndex] **only if objectIndex is given and in range** (the target does
NOT resolve objects from the region; only the explicit index counts). Ranges are (min, avg, max) in fc; `–` is
U+2013.

### Ambient (by class)

| Class | Range | Reason |
|---|---|---|
| Cafeteria | (10, 15, 25) | `Cafeteria dining ambient, IES 10–25 fc at table height` |
| Lobby, Corridor | (5, 10, 20) | `Lobby and circulation ambient, 5–20 fc on the floor` |
| DataHall | (20, 30, 50) | `Data hall aisle, 20–50 fc on the floor` |
| Classroom | (20, 30, 50) | `Classroom ambient, IES 20–50 fc` |
| Retail | (15, 25, 40) | `Retail ambient, 15–40 fc` |
| Restroom, BreakRoom | (10, 15, 30) | `Support space ambient, 10–30 fc` |
| Storage | (5, 10, 20) | `Storage ambient, 5–20 fc` |
| any other (Office, OpenOffice, Conference, Other) | (10, 20, 35) | `Office ambient, IES 10–35 fc at the work plane` |

### Task (first rule that applies; k = KindOf(obj), or "" when no obj)

| # | Condition | Range | Reason |
|---|---|---|---|
| 1 | cls = DataHall | (20, 30, 50) | `Data hall cold aisle, 20–50 fc on the floor` |
| 2 | k = desk and cls = Classroom | (30, 50, 75) | `Classroom desk, IES 30–75 fc` |
| 3 | k = counter or island | (25, 40, 60) | cls = Cafeteria: `Servery counter, 25–60 fc`; else `Counter task, 25–60 fc` |
| 4 | k = reception | (20, 30, 50) | `Reception desk task, 20–50 fc` |
| 5 | k = bar | (15, 25, 40) | `Bar counter, 15–40 fc` |
| 6 | k = table and cls = Cafeteria | (10, 20, 35) | `Dining table, 10–35 fc` |
| 7 | k = table and cls = Conference | (20, 30, 50) | `Conference table, IES 20–50 fc` |
| 8 | otherwise | (20, 30, 50) | k = desk: `Office desk task, IES 20–50 fc`; else `Office task, IES 20–50 fc` |

### Other kinds

| Kind | Range | Reason |
|---|---|---|
| WallWash | (15, 25, 45) | `Wall wash, 15–45 fc vertical` |
| Accent, ambientAverage given and > 0 | (null, roundHalfEven(amb × 3, 1), null) | `3× the surrounding ambient ({amb} fc)` with amb formatted `"0.#"` (e.g. 20 → `(20 fc)`, 12.25 → `(12.3 fc)`) |
| Accent otherwise | (30, 50, 80) | `Accent, 30–80 fc (no surrounding ambient yet)` |
| FeaturePendant | (15, 25, 40) | `Feature pendants over a table, 15–40 fc` |
| CeilingGlow | (5, 10, 20) | `Ceiling glow, 5–20 fc on the ceiling` |
| Path | (1, 3, 10) | `Path of travel, 1–10 fc` |
| KeepDim | (null, null, 5) | `Keep dim: nothing brighter than 5 fc` |

When seeding, the accent's `ambientAverage` is the seeded ambient intent's target average (Office 20 → avg 60;
Cafeteria 15 → 45; Lobby 10 → 30).

## 4. Name helpers

- **surfaceWord(kind)** (labels): desk → `Desk`, table → `Table`, counter → `Counter`, reception → `Reception`,
  island → `Island`, bar → `Bar`, anything else → `Object`. (The plane-reason variant in `workplane.md` falls back to
  `Surface` instead — two different functions.)
- **letter(ordinal)**: the capital letter `A` + clamp(ordinal, 0, 25) (0 → `A`, 2 → `C`, 30 → `Z`, −1 → `A`).
- **capitalize(s)**: upper-case the first character (invariant), rest unchanged; empty stays empty.
- **cleanName(object)**: take `name` (null → ""), keep only the part **before the first `:`**, replace every `_` and
  every `-` with a space, collapse each run of whitespace to one space, trim. If the result is empty use
  surfaceWord(KindOf(object)). Return capitalize(result). Examples: `Desk_Type-A : 1200` → `Desk Type A`;
  `menu boards` → `Menu boards`; `""` with kind `table` → `Table`; `""` with kind `sofa` → `Object`.

## 5. Wall names: `wallName(room, wallIndex)`

Compass list, index 0..7: `East`, `Northeast`, `North`, `Northwest`, `West`, `Southwest`, `South`, `Southeast`.
(+X is east, +Y is north.)

1. If wallIndex < 0 or ≥ wall count → `Wall {wallIndex + 1}` (e.g. index 7 of 4 walls → `Wall 8`; −1 → `Wall 0`).
2. Base name of wall i: outward = −inward; deg = angleDeg(outward); normalise a = ((deg mod 360) + 360) mod 360 where
   `mod` keeps the dividend's sign (JS `%`); sector = roundHalfEven(a / 45) mod 8; name = compass[sector] + ` wall`.
   Ties at exact half-sectors go to the even sector (22.5° → East, 67.5° → North, 112.5° → North, 157.5° → West,
   202.5° → West, 247.5° → South, 292.5° → South, 337.5° → sector 8 → East).
3. If only one wall in the room has that base name → the base name (e.g. `North wall`). Otherwise append a space and
   the 1-based position of this wall among the walls with the same base name, in wall-index order
   (`North wall 1`, `North wall 2`).

So a wall whose inward normal is (0, −1) (outside faces +Y) is the `North wall`.

## 6. Labels: `label(room, kind, region, wallIndex, objectIndex)`

cls = classOf(room); found = Resolve(room, kind, region, objectIndex) (see `workplane.md`: an explicit in-range index
wins for any kind; otherwise the accepted object under the region, if any).

### Ambient
floor = area(floor[0]) (0 when no floor). share = area(region)/floor when floor > 0 and region has ≥ 3 points,
otherwise 1. share ≥ 0.6 → capitalize(spaceType(room)) + ` ambient` (e.g. `Open office ambient`,
`Data hall ambient`, `Room ambient`); else `Zone ambient`.

### Task
- No found object: if aisleNumber(room, region) > 0 → `Aisle {n} task`; else `Task zone`.
- Found object at index t, k = KindOf(object), cluster = the cluster (§7) whose object list contains t (none when the
  object is not a surface kind):
  1. k = desk and a cluster exists → `Desk cluster {letter(cluster.ordinal)} task`
  2. a cluster with more than one object → `{surfaceWord(k)} cluster {letter(ordinal)} task` (e.g. `Table cluster A task`)
  3. otherwise → `{cleanName(object)} task` (e.g. `Meeting table task`, `Servery counter task`).

### WallWash
1. found and found object's name is not null/whitespace → `{cleanName(object)} wash` (e.g. `Brand wall wash`).
2. else wall = WallFor(room, WallWash, region, wallIndex, objectIndex); a wall → `{wallName(room, wall)} wash`
   (e.g. `North wall wash`); none → `Wall wash`.

### Accent
found → `{cleanName(object)} accent`; else `Accent`.

### FeaturePendant
under = indices of objects whose KindOf is a surface kind and whose **center** is contained in the region (empty when
the region has < 3 points), in object order.
1. found and under has ≤ 1 entry → `{cleanName(found)} pendants` (e.g. `Reception desk pendants`).
2. under has > 1 entries → `{surfaceWord(KindOf(objects[under[0]]))} pendants` (e.g. `Table pendants`).
3. else `Feature pendants`.

### CeilingGlow
c = centroid(region) if region has ≥ 3 points, else (0, 0). zone = zoneAt(room, c).
wholeZone = zone exists, has ≥ 1 loop, and area(region) ≥ 0.6 × area(zone.loops[0]).
1. found and not wholeZone → `{surfaceWord(KindOf(found))} glow` (e.g. `Table glow`).
2. else no zone → `Ceiling glow`; zone.height > room.ceilingHeight → `Cove glow`; otherwise (lower or equal) →
   `Soffit glow`.

### Path
cls Lobby → `Entry path`; Corridor → `Corridor path`; otherwise `Path`.

### KeepDim
found → `{cleanName(object)} — keep dim` (space, U+2014, space; e.g. `Screen — keep dim`); else `Keep-dim zone`
(ASCII hyphen).

## 7. Shared helpers used by labels (also specified in `suggestions.md`; must be identical)

### Clusters `clusters(room)` — work-surface clusters, merge distance 3 ft

1. Take objects whose KindOf is a surface kind (`desk`, `table`, `counter`, `reception`, `island`, `bar`). Group by
   KindOf; groups are processed in the order each kind first appears in `room.objects`. Within a group, items keep
   object order.
2. footprint each item. Two items are connected when polygonDistance(footprint_a, footprint_b) ≤ **3** (inclusive).
   Clusters are the connected components (transitively, union-find).
3. Order the components by their first item (item order); each component lists its items in item order.
4. For each component: pts = all footprint vertices of its items (4 per item, item order); center = arithmetic mean
   of pts (not the polygon centroid). region = inflate(footprint, 1.5) for a single item, otherwise
   inflate(rect(bounds(pts)), 1.5) — i.e. the bounding rectangle grown by 1.5 ft.
5. Stable-sort the components by key1 = −roundHalfEven(center.y / 3) ascending (top of plan first, in 3 ft bands),
   then by center.x ascending.
6. ordinal = position in that sorted list (0-based, per kind group). The cluster's `objects` are the original object
   indices. Result = all groups' clusters concatenated in group order. Golden: `room.clusters` =
   `{group, ordinal, objects, region}`.

clusterOf(room, objectIndex) = the first cluster whose `objects` contains the index, or none.

### Aisles and `aisleNumber(room, region)` (data halls)

Aisles: take objects with KindOf `cabinet` and max(length, width) ≥ 6; boxes = bounds(footprint) each (min, max).
For every ordered pair (a, b), a ≠ b, in index order (a outer, b inner):
- Vertical stacking: gapY = b.min.y − a.max.y; overlapX = min(a.max.x, b.max.x) − max(a.min.x, b.min.x). If
  3 ≤ gapY ≤ 12 and overlapX ≥ 4 and no third box c (≠ a, b) satisfies c.min.y < b.min.y and c.max.y > a.max.y and
  c.min.x < a.max.x and c.max.x > a.min.x → add rect((max(a.min.x, b.min.x), a.max.y), (min(a.max.x, b.max.x), b.min.y)).
- Side by side: gapX = b.min.x − a.max.x; overlapY = min(a.max.y, b.max.y) − max(a.min.y, b.min.y). If 3 ≤ gapX ≤ 12
  and overlapY ≥ 4 and no third box c satisfies c.min.x < b.min.x and c.max.x > a.max.x and c.min.y < a.max.y and
  c.max.y > a.min.y → add rect((a.max.x, max(a.min.y, b.min.y)), (b.min.x, min(a.max.y, b.max.y))).

Stable-sort aisles by −centroid.y ascending, then centroid.x ascending.

aisleNumber: 0 if region has < 3 points or classOf(room) ≠ DataHall. Otherwise at = centroid(region); return i + 1 for
the first aisle i with distance(centroid(aisle_i), at) < 1; else 0.

## 8. Golden verification

An independent implementation of exactly the rules in this file, `workplane.md` and `geometry.md` was run against all
four golden rooms and reproduced, with zero mismatches: `room.spaceClass`, `room.spaceTypeWords`, `room.wallNames`,
`room.clusters` (group, ordinal, object indices and region coordinates within 1e-6), and for every intent in `seeds`
and in `interpret[].intents`: `label`, `target`, `targetReason` and `plane`. The only differences were the three
interpreter intents with an explicitly requested level (`ambient 30 fc`, `general light 15 fc`), whose target and
`Requested … fc` reason come from the interpreter spec, not from this file. `misc.json` `classFromWords` (9 cases) and
`feetInches` (8 cases) also match.

## Test cases

Demo rooms are as in `demo-rooms.md`. `Square` = [(0,0),(10,0),(10,10),(0,10)]. "Room(label, …)" means a room with
that label, empty spaceType, and only the listed fields set.

### Space class and space type

| Test | Input | Expected |
|---|---|---|
| space type of the Office demo | spaceType(Office) | `open office` |
| data hall from label | classOf(Room label `3B Data hall`) | DataHall |
| dining from label | classOf(Room label `Staff dining`) | Cafeteria |
| boardroom from label | classOf(Room label `Boardroom 4`) | Conference |
| from the objects when the label says nothing | Room label `Room 12`, 4 objects `Desk 0..3` kind `desk` at (i·4, 0), 3×2, top 2.5, bottom 0 → spaceType | `open office` |
| nothing known | spaceType(Room label `Room 12`) | `room` |
| golden classFromWords | `204 Open office` / `Data hall 3B` / `Main lobby` / `Hallway` / `Board room` / `Servery` / `Storage` / `Break room` / `Unknown space` | OpenOffice / DataHall / Lobby / Corridor / Conference / Cafeteria / Storage / BreakRoom / null |
| whitespace | classFromWords(`   `) and null | null |
| order: data hall beats hall | classFromWords(`Data hall`) | DataHall |
| order: elevator lobby | classFromWords(`Elevator lobby`) | Lobby |
| Unicode café | classFromWords(`Café 2`) | Cafeteria |
| word boundary | classFromWords(`Hallmark`) | null |
| spaceType trimmed | Room spaceType `  open office  ` | `open office` |
| class from objects: one desk | Room label `X`, 1 desk | Office |
| class from objects: reception | 1 reception | Lobby |
| class from objects: cabinets | 4 cabinets | DataHall |
| class from objects: tables | 6 tables → Cafeteria; 1 table → Conference | |
| class from objects: seating | 2 seating | BreakRoom |
| golden spaceClass | Office / Cafeteria / Lobby / DataHall | `OpenOffice` / `Cafeteria` / `Lobby` / `DataHall` |
| golden spaceTypeWords | same rooms | `open office` / `cafeteria` / `lobby` / `data hall` |

### Targets

| Test | Input | Expected range | Expected reason |
|---|---|---|---|
| office ambient | Office, Ambient | (10,20,35) | `Office ambient, IES 10–35 fc at the work plane` |
| office desk task | Office, Task, objectIndex 0 | (20,30,50) | `Office desk task, IES 20–50 fc` |
| cafeteria ambient | Cafeteria, Ambient | (10,15,25) | `Cafeteria dining ambient, IES 10–25 fc at table height` |
| servery counter | Cafeteria, Task, objectIndex of the `counter` (0) | (25,40,60) | `Servery counter, 25–60 fc` |
| lobby ambient | Lobby, Ambient | (5,10,20) | `Lobby and circulation ambient, 5–20 fc on the floor` |
| wall wash | Office, WallWash | (15,25,45) | `Wall wash, 15–45 fc vertical` |
| feature pendant | Office, FeaturePendant | (15,25,40) | `Feature pendants over a table, 15–40 fc` |
| ceiling glow | Office, CeilingGlow | (5,10,20) | `Ceiling glow, 5–20 fc on the ceiling` |
| path | Office, Path | (1,3,10) | `Path of travel, 1–10 fc` |
| keep dim | Office, KeepDim | (null,null,5) | `Keep dim: nothing brighter than 5 fc` |
| data hall ambient | DataHall, Ambient | (20,30,50) | `Data hall aisle, 20–50 fc on the floor` |
| data hall task | DataHall, Task, no object | (20,30,50) | `Data hall cold aisle, 20–50 fc on the floor` |
| accent = 3 × ambient | Office, Accent, ambient 20 | (null, 60, null) | starts with `3×`; exactly `3× the surrounding ambient (20 fc)` |
| accent fallback | Office, Accent, ambient null | (30,50,80) | `Accent, 30–80 fc (no surrounding ambient yet)` |
| accent ambient 0 | Office, Accent, ambient 0 | (30,50,80) | fallback reason |
| accent formatting | Office, Accent, ambient 12.25 | (null, 36.8, null) | `3× the surrounding ambient (12.3 fc)` |
| lobby reception task | Lobby, Task, objectIndex 0 | (20,30,50) | `Reception desk task, 20–50 fc` |
| office meeting table task | Office, Task, objectIndex 3 | (20,30,50) | `Office task, IES 20–50 fc` |
| task without index ignores region | Cafeteria, Task, no index | (20,30,50) | `Office task, IES 20–50 fc` |

### Labels

| Test | Input | Expected |
|---|---|---|
| desk task label | Office, Task, region = inflate(footprint(`Desk cluster A`), 1.5), no index | `Desk cluster A task` (starts with `Desk cluster`, ends with `task`) |
| brand wall accent | Office, Accent, region [(10, 23.5)], objectIndex of the artwork (6) | `Brand wall accent` |
| screen keep dim | Office, KeepDim, region [], objectIndex of the screen (7) | `Screen — keep dim` |
| ambient from space type | Office, Ambient, region = Office floor[0] | `Open office ambient` |
| entry path | Lobby, Path, region [] | `Entry path` |
| cove glow | Cafeteria, CeilingGlow, region = ceilingZones[1].loops[0] | `Cove glow` |
| north wall wash | Room label `Hall` (→ Corridor), floor [Square], one wall index 0 from (0,10) to (10,10), inward (0,−1), top 9; WallWash, region [(0,10),(10,10)], wallIndex 0 | `North wall wash` |
| zone ambient | Office, Ambient, region rect((0,0),(10,10)) (100/864 < 0.6) | `Zone ambient` |
| bar task (single object) | Room `Lounge`, object `Bar` kind bar at (5,5) 8×2; Task over inflate(footprint, 1) | `Bar task` |
| display table accent | Room `Showroom`, `Display table` (table, (5,5), 4×3, top 2.5); Accent region [(5,5)] | `Display table accent` |
| reception pendants | Lobby, FeaturePendant, region footprint(Reception desk) | `Reception desk pendants` |
| aisle label from region | DataHall, Task, region rect((6,20),(34,24)) / rect((6,14),(34,18)) / rect((6,8),(34,12)), no index | `Aisle 1 task` / `Aisle 2 task` / `Aisle 3 task` |
| not an aisle | DataHall, Task, region rect((0,0),(4,4)) | `Task zone` |
| keep dim without object | Office, KeepDim, region [] no index | `Keep-dim zone` |
| accent without object | Office, Accent, region [(18,12)], no index | `Accent` |
| path in office | Office, Path | `Path` |
| wash label without wall or object | Room with no walls, WallWash, region [] | `Wall wash` |
| golden seeds | every intent in each golden `seeds` array | its `label` |
| golden interpret intents | every intent in each golden `interpret[].intents` | its `label` |

Golden seed labels (for reference): Office — `Open office ambient`, `Desk cluster A task`, `Desk cluster B task`,
`Meeting table task`, `Desk cluster C task`, `Brand wall wash`, `Brand wall accent`, `Screen — keep dim`.
Cafeteria — `Cafeteria ambient`, `Servery counter task`, `Menu boards wash`, `Cove glow`, `Menu boards accent`,
`Table pendants`. Lobby — `Lobby ambient`, `Reception desk task`, `Feature wall wash`, `Feature wall accent`,
`Reception desk pendants`, `Entry path`. DataHall — `Data hall ambient`, `Aisle 1 task`, `Aisle 2 task`,
`Aisle 3 task`.

### Wall names, letters, clean names

| Test | Input | Expected |
|---|---|---|
| compass with +Y north | Office walls 0,1,2,3 | `South wall`, `East wall`, `North wall`, `West wall` |
| all demo rooms (golden wallNames) | Office, Cafeteria, Lobby, DataHall | `["South wall","East wall","North wall","West wall"]` each |
| out of range | wallName(Office, 7) / wallName(Office, −1) | `Wall 8` / `Wall 0` |
| duplicate names numbered | two walls both with inward (0,−1) | `North wall 1`, `North wall 2` |
| diagonal | wall inward (−√½, −√½) (outward 45°) | `Northeast wall` |
| half-sector tie | outward at 22.5° | `East wall` |
| letter | 0 / 2 / 30 / −1 | `A` / `C` / `Z` / `A` |
| cleanName | name `Desk_Type-A : 1200` | `Desk Type A` |
| cleanName empty | name `` kind `table` / kind `sofa` | `Table` / `Object` |

### Clusters

| Test | Input | Expected |
|---|---|---|
| office desks: three clusters | clusters(Office) filtered to group desk | 3 clusters, ordinals [0,1,2] (objects [0], [1], [2]) |
| office clusters (golden) | clusters(Office) | desk 0 → [0] region (2,9.75)…(16,15.75); desk 1 → [1] (2,2.75)…(16,8.75); desk 2 → [2] (17,2.75)…(27,8.75); table 0 → [3] (22.5,13.5)…(33.5,20.5) |
| desks within 3 ft merge | Room `Open office`, floor rect((0,0),(30,20)); desks 4×2 at (5,5), (5,8), (20,5) | 2 clusters; largest has 2 objects. Cluster 0 = objects [0,1], region [(1.5,2.5),(8.5,2.5),(8.5,10.5),(1.5,10.5)]; cluster 1 = [2], region [(16.5,2.5),(23.5,2.5),(23.5,7.5),(16.5,7.5)] |
| cafeteria (golden) | clusters(Cafeteria) | counter 0 → [0]; table 0 → objects 2..25 (all 24 tables), region (7.7,2.2)…(42.3,23.8) |
| lobby (golden) | clusters(Lobby) | reception 0 → [0], region (12.5,14)…(27.5,20.5) |
| data hall | clusters(DataHall) | [] (cabinets are not surfaces) |

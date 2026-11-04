# Demo rooms

Four built-in rooms used by the demo mode, the tests and the golden data: **Office**, **Cafeteria**, **Lobby**,
**DataHall**, in that order (`all = [Office, Cafeteria, Lobby, DataHall]`). `byId(id)` returns the room with that id
or none. Units feet. Every value below has been cross-checked against `golden/*.json` → `room`.

## 1. Y-up conversion note

The rooms reproduce a design concept that was drawn with **x right, y down, origin at the top-left**. The model is
**Y up** (+Y = north). Conversion, with `d` = room depth (Y extent) and `w` = width:

- A concept rectangle (x, y, width cw, height ch) becomes an object with center **(x + cw/2, d − (y + ch/2))**,
  orientation 0, length = cw and width = ch unless overridden.
- A concept round object (cx, cy, radius r) becomes center **(cx, d − cy)**, length = width = 2r, orientation 0,
  bottom 0.
- A concept loop (x, y, cw, ch) becomes the world box x0 = x, y0 = d − (y + ch), x1 = x + cw, y1 = d − y, vertices
  (x0,y0), (x1,y0), (x1,y1), (x0,y1).
- A point at distance `a` along a concept wall: N → (a, d); S → (a, 0); W → (0, d − a); E → (w, d − a).
  The concept's north wall (concept y = 0) is therefore the wall at Y = d.

To be bit-identical with golden (e.g. `8.399999999999999`, `27.799999999999997`), compute the world values with those
exact floating-point formulas from the concept numbers given in §4 rather than typing rounded results.

## 2. Construction rules shared by all four rooms

Inputs per room: id, label, spaceType, w, d, ceiling height, grid flag, extra ceiling zones (name, height, loop),
openings (concept wall letter, kind, a0, a1, bottom, top), objects, existing fixtures.

1. **Floor**: one loop [(0,0), (w,0), (w,d), (0,d)] (CCW).
2. **Ceiling zones**: first the main zone {height = ceiling, isMain = true, loops = [floor loop]}, then each extra
   zone in the order given {height, isMain = false, loops = [its loop]}. The zone name is not stored.
3. **Walls** (always 4, CCW):

   | index | start | end | inward | compass name |
   |---|---|---|---|---|
   | 0 | (0,0) | (w,0) | (0,1) | South wall |
   | 1 | (w,0) | (w,d) | (−1,0) | East wall |
   | 2 | (w,d) | (0,d) | (0,−1) | North wall |
   | 3 | (0,d) | (0,0) | (1,0) | West wall |

   Concept wall letter → index: S → 0, E → 1, N → 2, W → 3.
4. **Wall top**: probe point = wall midpoint + inward × 0.5. Scan the zones from the last to the second (skip the
   main zone); the first whose zoneContains(probe) gives the top; otherwise the main ceiling height.
5. **Openings**: for each opening of a wall, in the order listed for the room (filtered to that wall): convert a0 and a1
   to world points with the wall-point rule, t = dot(point − wall.start, unit(wall.end − wall.start)) for each;
   from = min(t0, t1), to = max(t0, t1); bottom and top as given; kind as given.
6. **Ceiling steps**: for each non-main zone in order, for each edge of its loop (vertex i → i+1, wrapping), a step
   {start, end, lowerHeight = min(zone height, ceiling), upperHeight = max(zone height, ceiling)}.
7. **Ceiling grid** (grid flag true): origin (0,0), u (2,0), v (0,2). Otherwise null.
8. `existing` defaults to [].

Stable ids (`stableId(text)`): MD5 of the UTF-8 bytes of `"studio-demo:" + text`, the 16 bytes interpreted as a GUID
in .NET byte order (first three groups little-endian; i.e. Python `uuid.UUID(bytes_le=digest)`). Values are listed
verbatim below so implementers can simply hard-code them.

## 3. Room summary

| Room | id | label | spaceType | w × d | ceiling | grid | spaceClass | floor area |
|---|---|---|---|---|---|---|---|---|
| Office | `a0000204-0000-4000-8000-000000000204` | `204 Open office` | `open office` | 36 × 24 | 9 | yes | OpenOffice | 864 |
| Cafeteria | `a0000110-0000-4000-8000-000000000110` | `110 Cafeteria` | `cafeteria` | 48 × 32 | 10 | yes | Cafeteria | 1536 |
| Lobby | `a0000101-0000-4000-8000-000000000101` | `101 Entry lobby` | `lobby` | 40 × 28 | 14 | no | Lobby | 1120 |
| DataHall | `a000003b-0000-4000-8000-00000000003b` | `3B Data hall` | `data hall` | 40 × 30 | 14 | no | DataHall | 1200 |

## 4. The rooms

Object columns: name, kind, center (x, y), length, width, orientation, top, bottom. "Concept" shows the source
numbers and formula.

### 4.1 Office (w 36, d 24, ceiling 9, grid)

Extra ceiling zones: none. Ceiling steps: none.

Openings (concept): S window a 3–33, bottom 3, top 7.5; W door a 2–5, bottom 0, top 7.

| Wall | top | openings (kind, from, to, bottom, top) |
|---|---|---|
| 0 South | 9 | window 3, 33, 3, 7.5 |
| 1 East | 9 | — |
| 2 North | 9 | — |
| 3 West | 9 | door 2, 5, 0, 7 |

Objects (index order):

| # | name | kind | center | length | width | orient | top | bottom | concept |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Desk cluster A | desk | (9, 12.75) | 11 | 3 | 0 | 2.5 | 0 | desk rect x 3, y 9, 12 × 4.5; length = 12 − 1, width 3 |
| 1 | Desk cluster B | desk | (9, 5.75) | 11 | 3 | 0 | 2.5 | 0 | x 3, y 16, 12 × 4.5 |
| 2 | Desk cluster C | desk | (22, 5.75) | 7 | 3 | 0 | 2.5 | 0 | x 18, y 16, 8 × 4.5; length 8 − 1 |
| 3 | Meeting table | table | (28, 17) | 8 | 4 | 0 | 2.5 | 0 | rect x 24, y 5, 8 × 4 |
| 4 | Lounge sofa A | seating | (31.5, 8.399999999999999) | 6 | 1.6 | 0 | 1.5 | 0 | rect x 28.5, y 14.8, 6 × 1.6 |
| 5 | Lounge sofa B | seating | (31.5, 4.099999999999998) | 6 | 1.6 | 0 | 1.5 | 0 | rect x 28.5, y 19.1, 6 × 1.6 |
| 6 | Brand wall | artwork | (10, 23.85) | 14 | 0.2 | 0 | 7 | 3 | N wall point a 10 → (10, 24), plus (0, −0.15) |
| 7 | Screen | screen | (35.85, 17) | 5 | 0.2 | 90 | 6 | 3 | E wall point a 7 → (36, 17), plus (−0.15, 0) |

Desk surfaces sit inside the concept's desk rectangles (which include seats): length = concept width − 1, width 3, the
center is the concept rectangle's center. Existing fixtures: none.

### 4.2 Cafeteria (w 48, d 32, ceiling 10, grid)

Extra ceiling zone: "Raised GWB cloud", height 12, concept loop x 12, y 10, 24 × 16 → world
[(12,6), (36,6), (36,22), (12,22)] (area 384).

Ceiling steps (4, lower 10, upper 12): (12,6)→(36,6); (36,6)→(36,22); (36,22)→(12,22); (12,22)→(12,6).

Openings (concept): E window a 4–28, bottom 3, top 8; W door a 14–18, 0, 7; N door a 40–43, 0, 7.

| Wall | top | openings |
|---|---|---|
| 0 South | 10 | — |
| 1 East | 10 | window 4, 28, 3, 8 |
| 2 North | 10 | door 5, 8, 0, 7 (a 40 → t 8, a 43 → t 5) |
| 3 West | 10 | door 14, 18, 0, 7 |

Objects:

| # | name | kind | center | length | width | orient | top | bottom | concept |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Servery counter | counter | (17, 28.5) | 26 | 3 | 0 | 3 | 0 | rect x 4, y 2, 26 × 3 |
| 1 | Menu boards | signage | (17, 31.85) | 26 | 0.2 | 0 | 8 | 5.5 | N wall point a 17 → (17, 32), plus (0, −0.15) |
| 2..25 | Table 1 .. Table 24 | table | see below | 3.6 | 3.6 | 0 | 2.5 | 0 | round, radius 1.8 |

Tables: for i = 0..5 (outer) and j = 0..3 (inner), object `Table {i·4 + j + 1}` at concept center
(11 + i·5.6, 11.5 + j·5) → world center (11 + i·5.6, 32 − (11.5 + j·5)). World x by i: 11, 16.6, 22.2,
27.799999999999997, 33.4, 39. World y by j: 20.5, 15.5, 10.5, 5.5. So Table 1 (11, 20.5), Table 2 (11, 15.5),
Table 3 (11, 10.5), Table 4 (11, 5.5), Table 5 (16.6, 20.5), …, Table 24 (39, 5.5). Object index = table number + 1.

Existing fixtures: none.

### 4.3 Lobby (w 40, d 28, ceiling 14, no grid)

Extra ceiling zones, in order:
1. "Soffit over reception", height 10, concept loop x 6, y 0, 28 × 7 → [(6,21), (34,21), (34,28), (6,28)].
2. "Vestibule", height 9, concept loop x 15, y 23, 10 × 5 → [(15,0), (25,0), (25,5), (15,5)].

Ceiling steps (8): soffit edges (6,21)→(34,21), (34,21)→(34,28), (34,28)→(6,28), (6,28)→(6,21) with lower 10 / upper
14; then vestibule edges (15,0)→(25,0), (25,0)→(25,5), (25,5)→(15,5), (15,5)→(15,0) with lower 9 / upper 14.

Openings (concept, in this order): S window a 2–15, 0, 12; S window a 25–38, 0, 12; S door a 17–23, 0, 7; W door
a 4–7, 0, 7; E door a 9–13, 0, 7; E door a 15–19, 0, 7.

| Wall | top | openings (in order) |
|---|---|---|
| 0 South | **9** (probe (20, 0.5) is in the vestibule) | window 2, 15, 0, 12; window 25, 38, 0, 12; door 17, 23, 0, 7 |
| 1 East | 14 | door 15, 19, 0, 7 (a 9–13); door 9, 13, 0, 7 (a 15–19) |
| 2 North | **10** (probe (20, 27.5) is under the soffit) | — |
| 3 West | 14 | door 4, 7, 0, 7 |

Objects:

| # | name | kind | center | length | width | orient | top | bottom | concept |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Reception desk | reception | (20, 17.25) | 12 | 3.5 | 0 | 3 | 0 | rect x 14, y 9, 12 × 3.5 |
| 1 | Lounge sofa A | seating | (7.5, 12.6) | 9 | 1.8 | 0 | 1.5 | 0 | rect x 3, y 14.5, 9 × 1.8 |
| 2 | Lounge sofa B | seating | (7.5, 7.900000000000002) | 9 | 1.8 | 0 | 1.5 | 0 | rect x 3, y 19.2, 9 × 1.8 |
| 3 | Planter 1 | other | (29, 11) | 2.8 | 2.8 | 0 | 3 | 0 | round (29, 17), r 1.4 |
| 4 | Planter 2 | other | (8, 3) | 2.4 | 2.4 | 0 | 2.5 | 0 | round (8, 25), r 1.2 |
| 5 | Feature wall | artwork | (20, 27.85) | 20 | 0.2 | 0 | 8 | 3 | N wall point a 20 → (20, 28), plus (0, −0.15) |
| 6 | Elevator 1 | door | (39.85, 17) | 4 | 0.3 | 90 | 7 | 0 | E wall point a 11 → (40, 17), plus (−0.15, 0) |
| 7 | Elevator 2 | door | (39.85, 11) | 4 | 0.3 | 90 | 7 | 0 | E wall point a 17 → (40, 11), plus (−0.15, 0) |

The elevators are room **objects** of kind `door`, not wall openings.

Existing fixtures (four downlights from the old lobby, so removing existing fixtures can be tried). All have productId
`8713baa4-22dc-51c2-6e01-fb595b1d00b5` (= stableId(`downlight`)), label `E1`, orientation 0, length 0.65, width 0.65,
isRound true, mount `ceiling`, height 14, calculable true:

| # | id (= stableId(`existing-lobby-{#}`)) | center |
|---|---|---|
| 0 | `8a105443-3344-103a-4577-087e27d5e99c` | (10, 9) |
| 1 | `cd34b9de-0661-2373-d73e-0f7eaca8e50d` | (30, 9) |
| 2 | `d025ec56-85bc-17ec-6a58-d15cd8fb0cfd` | (10, 19) |
| 3 | `3237f734-b815-4e91-82c4-bdc50f7207b1` | (30, 19) |

### 4.4 DataHall (w 40, d 30, ceiling 14, no grid)

Extra ceiling zones: none. Ceiling steps: none.

Openings (concept): W door a 13–16.5, 0, 7; E door a 13–16.5, 0, 7.

| Wall | top | openings |
|---|---|---|
| 0 South | 14 | — |
| 1 East | 14 | door 13.5, 17, 0, 7 |
| 2 North | 14 | — |
| 3 West | 14 | door 13, 16.5, 0, 7 |

Objects:

| # | name | kind | center | length | width | orient | top | bottom | concept |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Rack row 1 | cabinet | (20, 25) | 28 | 2 | 0 | 7 | 0 | rect x 6, y 4, 28 × 2 |
| 1 | Rack row 2 | cabinet | (20, 19) | 28 | 2 | 0 | 7 | 0 | rect x 6, y 10 |
| 2 | Rack row 3 | cabinet | (20, 13) | 28 | 2 | 0 | 7 | 0 | rect x 6, y 16 |
| 3 | Rack row 4 | cabinet | (20, 7) | 28 | 2 | 0 | 7 | 0 | rect x 6, y 22 |
| 4 | CRAH-1 | appliance | (2.3, 22.5) | 5 | 3 | 90 | 7 | 0 | world (2.3, d − 7.5) |
| 5 | CRAH-2 | appliance | (2.3, 7.5) | 5 | 3 | 90 | 7 | 0 | world (2.3, d − 22.5) |

Rack rows: for i = 0..3, `Rack row {i+1}` = concept rect x 6, y 4 + 6i, 28 × 2, top 7. Existing fixtures: none.

## 5. Derived values (golden `room`)

| Room | wallNames | clusters (group ordinal → object indices) |
|---|---|---|
| Office | South, East, North, West wall | desk 0 → [0]; desk 1 → [1]; desk 2 → [2]; table 0 → [3] |
| Cafeteria | same | counter 0 → [0]; table 0 → [2..25] |
| Lobby | same | reception 0 → [0] |
| DataHall | same | (none) |

## Test cases

| Test | Input | Expected |
|---|---|---|
| office floor area | area(Office.floor[0]) | 864 (±1e-9) |
| office ceiling | Office.ceilingHeight | 9 |
| office grid | Office.ceilingGrid | not null; u.x = 2 (origin (0,0), u (2,0), v (0,2)) |
| office walls | Office.walls count | 4 |
| south glazing | Office.walls[0].openings | contains a `window` |
| cafeteria floor area | area(Cafeteria.floor[0]) | 1536 (48 × 32) |
| cafeteria tables | objects whose name starts with `Table` | 24 |
| cafeteria cloud | the single non-main zone | height 12; area(loops[0]) = 384 (24 × 16) |
| cafeteria steps | Cafeteria.ceilingSteps count | ≥ 4 (exactly 4) |
| lobby ceiling | Lobby.ceilingHeight | 14 |
| lobby zones | non-main zones | 2 |
| lobby elevators | objects of kind `door` | 2 |
| lobby grid | Lobby.ceilingGrid | null |
| lobby existing | Lobby.existing count | 4 (ids as §4.3) |
| data hall racks | objects with kind `cabinet` and top 7 | 4 |
| data hall grid | DataHall.ceilingGrid | null |
| data hall ceiling | DataHall.ceilingHeight | 14 |
| walls face inward | every room, every wall: mid = lerp(start, end, 0.5) | inRoom(mid + inward × 0.5) true; inRoom(mid − inward × 0.5) false |
| lobby north wall under soffit | Lobby.walls[2].top | 10 |
| lobby south wall under vestibule | Lobby.walls[0].top | 9 |
| lobby east wall | Lobby.walls[1].top | 14 |
| objects stay inside their room | every object of every room | contains(inflate(floor[0], 0.5), center) true |
| room order | all | [Office, Cafeteria, Lobby, DataHall] |
| byId | byId(`a0000101-0000-4000-8000-000000000101`) / unknown id | Lobby / none |
| stable id | stableId(`existing-lobby-0`) / stableId(`downlight`) | `8a105443-3344-103a-4577-087e27d5e99c` / `8713baa4-22dc-51c2-6e01-fb595b1d00b5` |
| golden equality | each demo room vs golden `room` (ignoring derived `length`/`direction` and the derived fields) | equal within 1e-6 (exact if built with §1 formulas) |
| opening order on east wall | Lobby.walls[1].openings | [(door 15–19), (door 9–13)] |
| north door projection | Cafeteria.walls[2].openings[0] | from 5, to 8 |

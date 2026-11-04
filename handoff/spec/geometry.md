# Geometry, rounding and formatting

Plan geometry in feet. All functions are pure. `Eps = 1e-9` unless stated. P2 operations are in `model.md` §1.
Polygons are lists of P2, implicitly closed (last vertex connects to the first). Counter-clockwise (CCW) polygons
have positive signed area; every function below accepts either winding unless stated.

## 1. Vector helpers

| Function | Result |
|---|---|
| `dot(a, b)` | a.x·b.x + a.y·b.y |
| `cross(a, b)` | a.x·b.y − a.y·b.x (positive when b is counter-clockwise of a) |
| `distance(a, b)` | |a − b| |
| `unit(v)` | v / |v|; **if |v| < 1e-9 returns (1, 0)** |
| `perp(v)` | (−v.y, v.x) — v rotated +90° (to the left) |
| `lerp(a, b, t)` | a + (b − a)·t |
| `heading(deg)` | (cos r, sin r) with r = deg·π/180 — unit vector `deg` degrees CCW from +X. Use the plain floating-point cos/sin, so heading(90) = (6.1e-17, 1), not exactly (0, 1). |
| `angleDeg(v)` | atan2(v.y, v.x)·180/π, range (−180, 180] |

## 2. Polygon measures

### signedArea(poly)
Shoelace: iterate i = 0..n−1 with j = the previous index (j starts at n−1, then j = i after each step);
sum += x_j·y_i − x_i·y_j; result = sum / 2. Positive for CCW. Empty or 1–2-point lists give 0.

### area(poly) = |signedArea(poly)|.

### centroid(poly)
1. Empty list → (0, 0).
2. A = signedArea. If |A| < 1e-9 (degenerate: 1–2 points, collinear) → the arithmetic mean of the vertices.
3. Otherwise, with the same i/j iteration, f = x_j·y_i − x_i·y_j; cx += (x_j + x_i)·f; cy += (y_j + y_i)·f;
   centroid = (cx / (6A), cy / (6A)).

### contains(poly, p) — point in polygon; boundary counts as inside
1. Fewer than 3 vertices → false.
2. Iterate edges with i = 0..n−1 and j = previous index (j = n−1 first). Let a = poly[i], b = poly[j].
3. If distanceToSegment(p, a, b) < **1e-7** → return true immediately (on boundary).
4. Crossing test: if (a.y > p.y) ≠ (b.y > p.y) **and** p.x < (b.x − a.x)·(p.y − a.y)/(b.y − a.y) + a.x, toggle
   `inside`.
5. Return `inside` after all edges.

Works for concave polygons and either winding.

### onBoundary(poly, p) (internal)
True when p is within 1e-7 of any edge (same edge iteration). For an empty list → false.

## 3. Rectangles

### rect(a, b) — axis-aligned rectangle from two corners
x0 = min x, x1 = max x, y0 = min y, y1 = max y. Vertices in this order (CCW from lower-left):
(x0,y0), (x1,y0), (x1,y1), (x0,y1).

### orientedRect(center, length, width, orientationDeg)
u = heading(orientationDeg), v = perp(u), hl = length/2, hw = width/2. Vertices, in order:
1. center − u·hl − v·hw
2. center + u·hl − v·hw
3. center + u·hl + v·hw
4. center − u·hl + v·hw

(Compute exactly as `center + u·(±hl) + v·(±hw)`: add the u term to the center first, then the v term, to reproduce the
floating-point results.) The result is CCW for positive length and width.

### footprint(object) = orientedRect(object.center, object.length, object.width, object.orientation).

## 4. inflate(poly, d) — miter offset

Positive d grows the polygon, negative shrinks it. Intended for convex / mostly rectilinear shapes. Output has the same
vertex count and order as the input (except the collapse case).

1. If n < 3 or |d| < 1e-9 → return a copy of the input.
2. sign = +1 if signedArea(poly) ≥ 0, else −1.
3. For each edge i (from vertex i to vertex (i+1) mod n): e = poly[i+1] − poly[i], len = |e|.
   normal_i = (0,0) if len < 1e-9, else (e.y, −e.x)·(sign/len). (This is the outward unit normal: right-hand normal for
   a CCW polygon, flipped by `sign` for CW.)
4. For each vertex i: prev = normal of edge (i−1) mod n, next = normal_i; bis = prev + next;
   denom = 1 + dot(prev, next).
   - If denom < 1e-6 (the two edges fold back on each other): new vertex = poly[i] + next·d.
   - Else: move = bis·(d/denom). Cap: if |move| > 3·|d|, scale move to length 3·|d|. New vertex = poly[i] + move.
     (For a right-angle corner, move = (prev+next)·d, i.e. both adjacent edges shift by exactly d.)
5. Collapse rule, **only when d < 0**: if area(result) < 1e-6, or signedArea(result)·sign < 0, or any edge flipped —
   return a **single-point list [centroid(poly)]**. An edge i (i → i+1, wrapping) is flipped when
   dot(before[i+1] − before[i], after[i+1] − after[i]) < −1e-9.
6. Otherwise return the new vertices.

## 5. Segments

### closestOnSegment(p, a, b) → (point q, parameter t)
ab = b − a, len2 = dot(ab, ab). If len2 < 1e-9 → (a, t = 0). Else t = clamp(dot(p − a, ab)/len2, 0, 1), q = a + ab·t.

### distanceToSegment(p, a, b) = |p − closestOnSegment(p, a, b).q|.

### segmentsCross(a, b, c, d) (internal) — proper crossing only
d1 = cross(b−a, c−a), d2 = cross(b−a, d−a), d3 = cross(d−c, a−c), d4 = cross(d−c, b−c).
True iff d1·d2 < 0 **and** d3·d4 < 0 (strict: touching, shared endpoints and collinear overlap are not crossings).

### projectOn(origin, direction, p) → (along, across)
d = p − origin; along = dot(d, direction); across = cross(direction, d) (positive when p is to the left of the
direction).

## 6. bounds(points) → (min, max)
Component-wise min and max over the points. **Empty input → ((0,0), (0,0))**. (Room bounds differ: see `model.md`.)

## 7. polygonDistance(a, b) — smallest distance between boundaries, 0 when they overlap
1. If either list is empty → the maximum double (treat as +∞; any finite comparison "≤ 3" is false).
2. If both have ≥ 3 vertices and (contains(a, b[0]) or contains(b, a[0])) → 0.
3. Otherwise best = +∞. For each edge (a_i, a_{i+1 mod |a|}) and each edge (b_j, b_{j+1 mod |b|}) — both lists are
   treated as closed loops, even with 1 or 2 points (a 1-point list has a single zero-length edge):
   - if segmentsCross(a_i, a_i+1, b_j, b_j+1) → return 0 immediately;
   - best = min(best, distanceToSegment(a_i, b-edge), distanceToSegment(a_i+1, b-edge),
     distanceToSegment(b_j, a-edge), distanceToSegment(b_j+1, a-edge)).
4. Return best.

## 8. overlapArea(region, shape, samples = 12) — approximate area of `shape` inside `region`
1. If region or shape has < 3 vertices → 0.
2. (lo, hi) = bounds(shape). For i = 0..samples−1 and j = 0..samples−1: sample
   p = (lo.x + (i + 0.5)/samples·(hi.x − lo.x), lo.y + (j + 0.5)/samples·(hi.y − lo.y)).
   Skip p if not contains(shape, p); otherwise total += 1 and, if contains(region, p), hits += 1.
3. Result = 0 if total = 0, else area(shape)·hits/total.

Callers that pass a different sample count: the suggestions path search uses 6, a data-hall test uses 8.

## 9. Room / ceiling queries

### inRoom(room, p)
False if the room has no floor loops or p is not contained in floor[0]. Then for every hole loop k ≥ 1: if
contains(hole, p) **and not** onBoundary(hole, p) → false. Otherwise true. (A point on a hole's edge is in the room.)

### zoneContains(zone, p)
Same rule as inRoom on the zone's loops: false if no loops or not in loops[0]; false if strictly inside any later loop
(inside and not on its boundary); else true.

### zoneAt(room, p)
Scan `room.ceilingZones` from the **last to the first**; return the first zone that is **not main** and
zoneContains(zone, p). None found → null (p is under the main ceiling).

### ceilingAt(room, p)
height of zoneAt(room, p) if any, else `room.ceilingHeight`.

## 10. Feet-and-inches formatting (`feetInches(feet)`)

Designer notation, e.g. `2′-6″`.
1. totalInches = feet × 12 rounded to the nearest integer with **round-half-to-even** (banker's rounding).
2. sign = `"-"` if totalInches < 0, else `""` (decided after rounding, so −0.02 ft → `0′-0″`).
3. n = |totalInches|. Output = sign + (n integer-divided by 12) + `′` + `-` + (n mod 12) + `″`.

Characters: `′` is U+2032 PRIME, `″` is U+2033 DOUBLE PRIME, the separator is an ASCII hyphen-minus `-`. No padding,
inches never shown as fractions. Invariant culture (plain ASCII digits).

## 11. Rounding and number-formatting rules (shared by all specs)

The reference runtime's rules differ from JavaScript defaults. Implement these helpers once (e.g. `units.ts`) and use
them wherever a spec names them.

- **`roundHalfEven(x)`** (the reference's default integer rounding): nearest integer, ties to even (0.5 → 0, 1.5 → 2,
  2.5 → 2, −0.5 → −0, −1.5 → −2). JavaScript `Math.round` is NOT this (it rounds ties toward +∞).
- **`roundHalfEven(x, digits)`**: compute x·10^digits in floating point, apply roundHalfEven, divide by 10^digits.
  (E.g. `roundHalfEven(60.05·…)` follows whatever the binary product is; do not use decimal string tricks.)
- **Format strings** (custom numeric formats, invariant culture: `.` decimal point, `,` group separator). For all of
  them the number is first reduced to its **15-significant-digit** decimal representation (correctly rounded), then
  rounded to the format's number of decimals with **round-half-away-from-zero on those decimal digits**, then written:
  - `"0"` — integer, no decimals, no grouping (2.5 → `3`, 1500 → `1500`, −2.5 → `-3`).
  - `"0.#"` — at most 1 decimal; a trailing zero and the decimal point are dropped (20 → `20`, 12.25 → `12.3`,
    12.04 → `12`, 0.35 → `0.4` because 15-digit form is 0.350000000000000).
  - `"0.##"` — at most 2 decimals, trailing zeros dropped (1.005 → `1.01` via 15 digits `1.00500000000000`; 2.5 → `2.5`).
  - `"0.0"` / `"0.00"` — exactly 1 / 2 decimals (3 → `3.0`, 0.125 → `0.13`).
  - `"#,0"` — integer with `,` every three digits (12500 → `12,500`, 999.5 → `1,000`).
  - A negative value whose rounded result is zero prints as `-0` (e.g. −0.04 with `"0.#"` → `-0`). This edge does
    not arise in the specs owned here; noted for completeness.
- Plain interpolation of integers prints the integer; plain interpolation of a double (no format) uses the shortest
  round-trip representation (same as JS `String(x)` for finite values, except JS writes exponents for very large/small
  values — not encountered).

Where these are used in the files specified here:

| Where | Rule |
|---|---|
| feetInches | roundHalfEven(feet·12) |
| Surface height of an object (`workplane.md`) | roundHalfEven(top·12)/12 |
| Wall compass sector (`defaults.md`) | roundHalfEven(angle/45) |
| Cluster ordering key (`defaults.md`) | roundHalfEven(center.y/3) |
| Accent target average (`defaults.md`) | roundHalfEven(ambient·3, 1) |
| Accent reason `({amb} fc)` | format `"0.#"` |
| Product key lumens (`model.md`) | format `"0"` |
| Draft point coordinates (`draft-store.md`) | roundHalfEven(v, 4) |

## Test cases

`Square` = [(0,0), (10,0), (10,10), (0,10)] (CCW). `CW` = Square reversed = [(0,10), (10,10), (10,0), (0,0)].

| Test | Input | Expected |
|---|---|---|
| area of square | area(Square) | 100 (±1e-9) |
| centroid of square | centroid(Square) | (5, 5) (±1e-9) |
| contains interior | contains(Square, (5,5)) | true |
| boundary point is inside | contains(Square, (10,5)) | true |
| outside right | contains(Square, (10.5,5)) | false |
| outside left | contains(Square, (−1,5)) | false |
| clockwise area | area(CW) | 100 |
| clockwise contains | contains(CW, (2,2)) | true |
| signed area sign | signedArea(Square) / signedArea(CW) | 100 / −100 |
| concave L area | L = [(0,0),(10,0),(10,4),(4,4),(4,10),(0,10)]; area(L) | 64 |
| concave contains (arm) | contains(L, (2,8)) | true |
| concave contains (arm) | contains(L, (8,2)) | true |
| concave notch outside | contains(L, (8,8)) | false |
| L centroid | centroid(L) | (3.875, 3.875) |
| contains with < 3 points | contains([(0,0),(1,1)], (0,0)) | false |
| rect normalises corners | rect((5,4), (1,1)) | [(1,1),(5,1),(5,4),(1,4)]; area 12; r[0] = (1,1); r[2] = (5,4) |
| oriented rect at 90° | o = orientedRect((10,10), 6, 2, 90) | bounds width (hi.x−lo.x) = 2, height = 6 (±1e-9); area 12; centroid.x = 10 (±1e-9). Vertices ≈ (11,7), (11,13), (9,13), (9,7) |
| inflate grows | inflate(Square, 1.5) | [(−1.5,−1.5),(11.5,−1.5),(11.5,11.5),(−1.5,11.5)]; area 169 (±1e-6); bounds lo.x = −1.5, hi.y = 11.5 (±1e-9) |
| inflate shrinks | inflate(Square, −2) | [(2,2),(8,2),(8,8),(2,8)]; area 36 (±1e-6) |
| inflate ignores winding | area(inflate(CW, 1.5)) | 169 (±1e-6) |
| inflate collapses, not inverts | inflate(Square, −20) | 1 point: [(5,5)] |
| inflate collapse at exact width | inflate(Square, −5) | [(5,5)] (area < 1e-6) |
| inflate tiny d | inflate(Square, 1e-10) | copy of Square |
| inflate < 3 points | inflate([(0,0),(1,0)], 1) | copy of input |
| distance to segment, perpendicular | distanceToSegment((5,3), (0,0), (10,0)) | 3 |
| distance to segment, beyond end | distanceToSegment((13,4), (0,0), (10,0)) | 5 |
| closest on segment | closestOnSegment((4,7), (0,0), (10,0)) | q = (4, 0); t = 0.4 |
| closest clamps before start | closestOnSegment((−5,1), (0,0), (10,0)) | t = 0, q = (0,0) |
| zero-length segment | closestOnSegment((1,1), (0,0), (0,0)) | t = 0 exactly, q = (0,0) (no division by zero) |
| bounds of nothing | bounds([]) | ((0,0),(0,0)) (lo equals hi) |
| bounds of two points | bounds([(3,−2), (−1,8)]) | ((−1,−2), (3,8)) |
| in room, excludes holes | room floor [Square, [(4,4),(6,4),(6,6),(4,6)]]; inRoom (2,2) | true |
| inside the column | same room; inRoom (5,5) | false |
| outside room | same room; inRoom (20,5) | false |
| on the hole edge counts as room | same room; inRoom (4,5) | true |
| room without floor | inRoom(room with floor [], (0,0)) | false |
| ceiling under raised cloud | Cafeteria demo room; ceilingAt (24,16) | 12 |
| main ceiling | Cafeteria; ceilingAt (3,3) | 10 |
| lobby soffit (concept x 6–34, y 0–7, flipped) | Lobby; ceilingAt (20,24) | 10 |
| lobby main | Lobby; ceilingAt (20,14) | 14 |
| lobby vestibule | Lobby; ceilingAt (20,2) | 9 |
| zoneAt under main | Cafeteria; zoneAt (3,3) | null |
| polygon distance overlap | polygonDistance(Square, rect((5,5),(15,15))) | 0 |
| polygon distance apart | polygonDistance(Square, rect((13,0),(15,10))) | 3 |
| polygon distance empty | polygonDistance([], Square) | +∞ / max double |
| overlap area full | overlapArea(Square, rect((2,2),(4,4))) | 4 |
| overlap area half | overlapArea(Square, rect((8,0),(12,10))) | 20 (6 of 12 sample columns inside × 40) |
| overlap with < 3 points | overlapArea(Square, [(1,1)]) | 0 |
| overlap: test fixture | region rect((0,0),(8,5)); shapes footprint of (center (3,3), 2×2) and (center (6,3), 4×3) | 4 and 12 |
| projectOn | origin (0,0), direction (1,0), p (3,2) | along 3, across 2 |
| unit of zero | unit((0,0)) | (1,0) |
| perp | perp((1,0)) | (0,1) |
| angleDeg | angleDeg((0,−1)) | −90 |
| feet-inches 2.5 | feetInches(2.5) | `2′-6″` |
| feet-inches 0 | feetInches(0) | `0′-0″` |
| feet-inches 14 | feetInches(14) | `14′-0″` |
| feet-inches 3.5 | feetInches(3.5) | `3′-6″` |
| feet-inches 3 (golden) | 3 | `3′-0″` |
| feet-inches 9 (golden) | 9 | `9′-0″` |
| feet-inches 10.5 (golden) | 10.5 | `10′-6″` |
| feet-inches negative (golden) | −1.25 | `-1′-3″` |
| feet-inches rounds (golden) | 12.04 | `12′-0″` (144.48 in → 144) |
| feet-inches half to even, down | 0.375 (4.5 in) | `0′-4″` |
| feet-inches half to even, up | 0.625 (7.5 in) | `0′-8″` |
| feet-inches tiny negative | −0.02 | `0′-0″` (no sign) |
| feet-inches small negative | −0.0625 (−0.75 in) | `-0′-1″` |
| format "0.#" | 20 / 12.25 / 0.35 | `20` / `12.3` / `0.4` |
| format "0" | 1500 / 2.5 | `1500` / `3` |
| roundHalfEven | 0.5, 1.5, 2.5, −1.5 | 0, 2, 2, −2 |

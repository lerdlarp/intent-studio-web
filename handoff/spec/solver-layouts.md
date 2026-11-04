# Solver — part 2: layouts, mounting, settling, grid snapping, keep-dim helpers

Continues **solver.md** (read it first for notation, number formats F1/F2/D0/D1/D2, Want, the context `ctx`, and Search).
Every generator below takes the spacing **factor** chosen by Search and returns `(raw fixtures, how)`; Search then
filters them through Settle (§7).

A new fixture always has: a fresh unique id, `intentId` = intent id, `output` = 1, `pinned` = false, `tilt` = 0 unless
stated, and `center`, `orientation` (degrees CCW from +X), `mount` (string `ceiling`, `pendant` or `cove`) and `height`
(ft above the floor) as given.

`AngleDeg(v)` = atan2(v.y, v.x)·180/π (so it can return −0, −90 or −180; see the note in §3).

---

## 1. Layout dispatch

| Intent kind | Generator |
|---|---|
| Ambient, Task, Path | AreaLayout (§2) with the number of pinned fixtures |
| WallWash | WashLayout (§3) |
| Accent | AccentLayout (§4) |
| FeaturePendant | PendantLayout (§5) |
| CeilingGlow | GlowLayout (§6) |
| KeepDim / other | no fixtures, how "" |

---

## 2. Area intents (ambient, task, path)

### 2.1 AreaLayout(ctx, factor, pinnedCount)

1. `region` = intent.region if it has ≥ 3 points, else floor[0] if the room has a floor, else intent.region.
   Fewer than 3 points → `([], "no region to light")`.
2. `area = max(Area(region), 1)`; `centroid = Centroid(region)`.
3. `plane` = plane.height when the plane is Horizontal, else 0.
   `mountH = Mounting(ctx, centroid, none).height − plane` (§10).
4. `want = Want(intent)`.
5. **Lumen method (first count).** Room bounds (lo, hi) over all floor loops. `rl = max(hi.x − lo.x, 1)`, `rw = max(hi.y − lo.y, 1)`.
   - Room cavity ratio `rcr = (5 × max(mountH, 1) × (rl + rw)) / (rl × rw)` (evaluate left to right: 5·m, ·(rl+rw), then ÷ (rl·rw)).
   - Coefficient of utilisation `cu = clamp(0.72 − 0.035 × rcr, 0.45, 0.7)`.
   - `lumen = ceil( (want × area) / ((max(product.lumens, 1) × cu) × 0.85) )`.
6. `density = ctx.Density`.
7. `n` = behavior.quantity if set, else `ceil(lumen × factor / (density × density))` (multiply lumen by factor, then divide).
   `n = clamp(n − pinnedCount, 1, 300)`.
8. `maxSpacing = 1.3 × max(mountH, 2)`.
9. `how`:
   - default: `lumen method for {F1(want)} fc over {D0(area)} ft² (CU {D2(cu)}, LLF 0.85) gives {lumen}`
   - quantity set: replaced by `quantity fixed at {quantity}`
   - else if `density ≠ 1` (exact comparison): append `, density {D1(density)}` (never during a fit, where the override is 1.0).
10. `pattern` = behavior.pattern lower-cased (invariant) if set; else `rows` for Path, else `rows` if IsLinear, else `grid`.
11. Points (each a centre + orientation):
    - Path → PathPoints(region, n, maxSpacing, ctx) (§2.6)
    - pattern `perimeter` → PerimeterPoints(region, n) (§2.5)
    - pattern `rows` → RowPoints(region, n, maxSpacing, product.length) (§2.4)
    - anything else → GridPoints(region, n, maxSpacing, staggered = (pattern = `staggered`)) (§2.2)
12. Quantity set and more points than n: keep only points that are InRoom and not inside any keep zone, then
    `Thin(points, max(n, 1))` (§2.7).
13. For each point: `(mount, height) = Mounting(ctx, point, none)`; fixture with that orientation.
14. `fixtures = AlignToGrid(ctx, fixtures)` (§11).
15. If pattern ≠ `grid` and the kind is not Path: append `, {pattern} pattern` to how.

Golden examples: `lumen method for 20 fc over 864 ft² (CU 0.64, LLF 0.85) gives 22`;
`lumen method for 30 fc over 84 ft² (CU 0.66, LLF 0.85) gives 3, rows pattern`.

### 2.2 GridPoints(region, n, maxSpacing, staggered)

1. Bounds (lo, hi); `w = max(hi.x − lo.x, 0.5)`, `h = max(hi.y − lo.y, 0.5)`.
2. `fill = clamp(Area(region) / (w × h), 0.15, 1)`; `orientation` = 0 when w ≥ h else 90.
3. `best` = []. For attempt = 0..7:
   - `nbox = ceil(n / fill)`; `nbox = max(nbox, ceil(w / maxSpacing) × ceil(h / maxSpacing))`; `nbox = min(nbox, 600)`.
   - `(cols, rows) = Factor(nbox, w, h, maxSpacing)` (§2.3); `sx = w / cols`, `sy = h / rows`.
   - For j = 0..rows−1 (outer), i = 0..cols−1 (inner):
     `fx = i + (0.25 if j even else 0.75)` when staggered and cols > 1, else `i + 0.5`;
     `p = (lo.x + fx × sx, lo.y + (j + 0.5) × sy)`; keep when `Contains(region, p)` (boundary counts as inside).
   - If best is empty or `|count − n| < |best.count − n|` → best = these points.
   - Stop if `count ≥ n`, or `fill ≥ 0.999` and count > 0.
   - `fill = max(0.15, fill × 0.85)`.
4. If best is empty → [(Centroid(region), orientation)].

### 2.3 Factor(count, w, h, maxSpacing) → (cols, rows)

Start with (1, max(1, count)), cost +∞. For cols = 1..max(1, count): `rows = ceil(count / cols)`; `sx = w/cols`, `sy = h/rows`;
`cost = (cols × rows − count) + 4 × |ln(sx / sy)|`; if `max(sx, sy) > maxSpacing` add `50 × (max(sx, sy)/maxSpacing − 1)`.
Take it only when cost is strictly lower (first minimum wins).

### 2.4 RowPoints(region, n, maxSpacing, length) — linear fixtures end to end along the long axis

1. Bounds; `w`, `h` as in §2.2; `alongX = w ≥ h`; `lng` = w or h (the long side), `sht` = the other.
2. `s0 = sqrt(w × h / max(n, 1))`.
3. `rows = clamp(round½even(sht / max(s0, 0.5)), 1, max(1, n))`; `rows = max(rows, ceil(sht / maxSpacing))`.
4. `perRow = ceil(n / rows)`. While `perRow × length > lng × 0.98` and perRow > 1: rows += 1, perRow = ceil(n / rows).
5. orientation = 0 if alongX else 90. For j = 0..rows−1 (outer), i = 0..perRow−1 (inner):
   `u = lng × (i + 0.5) / perRow`, `v = sht × (j + 0.5) / rows` (multiply then divide);
   point = (lo.x + u, lo.y + v) if alongX else (lo.x + v, lo.y + u); keep when Contains(region, point).
6. None kept → [(Centroid(region), orientation)].

### 2.5 PerimeterPoints(region, n)

1. `loop = Inflate(region, −1.5)`; if it has fewer than 3 points (a collapsed shrink returns a single centroid) use region.
2. Edge lengths `L[i] = Distance(loop[i], loop[(i+1) mod m])`; `total` = their sum in order.
3. For k = 0..max(n,1)−1: `s = total × (k + 0.5) / max(n, 1)`. Walk edges i = 0..m−1: if `s ≤ L[i]` or i is the last edge:
   `t = 0` if `L[i] < 1e-9` else `s / L[i]`; point = Lerp(a, b, clamp(t, 0, 1)) with a = loop[i], b = loop[(i+1) mod m];
   orientation = AngleDeg(b − a); done. Otherwise `s −= L[i]`.

### 2.6 PathPoints(region, n, maxSpacing, ctx) — one row along the long axis

1. Bounds, w, h, alongX, lng, sht as in §2.4.
2. `rows = max(1, ceil(sht / maxSpacing))`; `perRow = max(ceil(n / rows), ceil(lng / maxSpacing))`.
   If behavior.quantity q is set: `perRow = max(1, ceil(q / rows))`.
3. Same point loop and fallback as RowPoints §2.4 step 5–6.

Golden (Lobby entry path): region (2,21)–(38,25), ceiling over it 10 → mountH 10, maxSpacing 13; rows 1, perRow ≥ ceil(36/13) = 3
→ (8,23), (20,23), (32,23).

### 2.7 Thin(points, n)

While more than n points remain: for each i compute its nearest-neighbour distance; choose the i with the smallest one,
comparing with `nearest ≤ worst + 1e-9` so that on (near-)ties the **later** index wins; remove it.

---

## 3. Wall wash — WashLayout(ctx, factor)

1. If the room has no walls, or zones.md `Shape` of the intent viewed as vertical is none → `([], "no wall to wash")`.
   "Viewed as vertical": the intent itself when its plane is Vertical; otherwise a copy with the same id, kind, region,
   wallIndex and objectIndex and plane Vertical(height 2, bottom 2, top 8).
2. `wi = WallFor(room, kind, region, wallIndex, objectIndex)` (workplane.md); wall, `dir` = wall direction, `start`.
3. `t0 = Dot(shape.from − start, dir)`, `t1 = Dot(shape.to − start, dir)`, `len = max(t1 − t0, 1)`.
4. `top` = wall.top if > 0 else room ceiling height. `offset` = behavior.wallOffset if set, else `clamp(top / 3, 2, 4)`.
5. `spacing = offset × ctx.Density`. `fewest = max(1, ceil(len / (1.5 × spacing)))`.
6. `n` = quantity if set, else `max(fewest, round½even(len × factor / spacing))`; `n = clamp(n, 1, 300)`.
7. `faceMid` = (plane.bottom + plane.top) / 2 when the plane is Vertical, else top / 2.
8. `toWall = AngleDeg(wall.inward × −1)` — multiply each component by −1 so zero components become −0
   (inward (0,−1) → (−0, 1) → 90; inward (0,1) → −90; inward (−1,0) → (1, −0) → −0; inward (1,0) → (−1, −0) → **−180**).
9. For k = 0..n−1: `t = t0 + len × (k + 0.5) / n`; `at = start + dir × t + inward × offset` (add left to right);
   `(mount, height) = Mounting(ctx, at, none)`; tilt = 0 when the product is asymmetric, else
   `clamp(atan2(offset, max(height − faceMid, 1)) × 180/π, 5, 60)`. Orientation = toWall.
10. how: `{n} along {WallName(room, wi)}, {F1(offset)} ft off the wall at {D1(len / n)} ft on centre (first {D1(len / n / 2)} ft in from each end)`
    (the second number is (len ÷ n) ÷ 2).

Golden: `4 along North wall, 3 ft off the wall at 4.0 ft on centre (first 2.0 ft in from each end)`;
`6 along North wall, 3.3 ft off the wall at 4.7 ft on centre (first 2.3 ft in from each end)`.

---

## 4. Accent — AccentLayout(ctx, factor)

1. `aim = clamp(behavior.aimAngle or 30, 5, 70)` degrees from nadir.
2. `target` = region[0] if the region has a point, else Centroid(floor[0]) (or (0,0) with no floor).
3. **Wall branch** — when the plane is Vertical and `WallFor(room, kind, region, wallIndex, objectIndex)` gives wall wi:
   - `dir`, `start`; `t = clamp(Dot(target − start, dir), 0, wall.length)`.
   - `mid = (plane.bottom + (plane.top if plane.top > plane.bottom else plane.bottom + 4)) / 2`.
   - `ceiling = CeilingAt(room, start + dir × t + inward × 2)`; `drop = max(ceiling − mid, 1.5)`.
   - `offset` = wallOffset if set, else `clamp(drop × tan(aim·π/180), 1, 6)`.
   - `count = clamp(quantity if set else clamp(round½even(ExtentCount × factor), 1, 4), 1, 6)`.
     ExtentCount = 1 when the object index is missing/invalid, else 2 when max(length, width) > 8, else 1.
   - `extent` = ObjectExtent: 0 with no valid object, else (max − min) of `Dot(corner − start, dir)` over its footprint corners.
     `spread = clamp(extent / (count + 1), 1.5, 3)`.
   - `aimPoint = start + dir × t`.
   - For k = 0..count−1: `tk = t` when count = 1, else `clamp(t + (k − (count − 1)/2) × spread, 0, wall.length)`;
     `at = start + dir × tk + inward × offset`; `(mount, height) = Mounting(ctx, at, none)`;
     `toTarget = aimPoint − at`; tilt = `atan2(|toTarget|, max(height − mid, 1)) × 180/π` (not clamped);
     orientation = AngleDeg(toTarget).
   - how: `{count} aimed {D0(aim)}° at the face, {F1(offset)} ft out from the wall`.
4. **Free branch** (otherwise; always one fixture, factor ignored):
   - `floorC` = Centroid(floor[0]) or target; `away = Unit(floorC − target)`; `ceiling = CeilingAt(room, target)`;
     `h` = plane.height when Horizontal else 0; `drop = max(ceiling − h, 1.5)`; offset as above.
   - `at = target + away × offset`; if not InRoom(at) → at = target.
   - Mounting at `at`; tilt = `atan2(Distance(at, target), max(height − h, 1)) × 180/π`; orientation = AngleDeg(target − at).
   - how: `one aimed {D0(aim)}° at the target from {F1(offset)} ft away`.

Golden: `1 aimed 30° at the face, 2.3 ft out from the wall` — Office accent at (10, 21.690598923241495), tilt 30.000000000000014.

---

## 5. Feature pendants — PendantLayout(ctx, factor)

1. `objs`: the object at objectIndex when valid; else, when the region has ≥ 3 points, every object (room order) whose kind is a
   surface kind (desk, table, counter, reception, island, bar) and whose centre is Contained in the region.
2. `planeH` = plane.height when Horizontal, else 2.5.
3. **Over objects** (objs non-empty): for each object o (in order):
   - `top` = planeH when o.top is none, else workplane.md `SurfaceHeight(o)`.
   - `u = Heading(o.orientation)`, `len = o.length`, `wid = o.width`; if wid > len swap them and `u = Perp(u)`.
   - `longRun = len ≥ 5 and (kind ∈ {counter, bar, island, reception} or len / max(wid, 0.1) ≥ 2)`.
   - `count = max(2, round½even(len × factor / 3.2))` when longRun, else `max(1, round½even(factor))`.
     Quantity q set → `count = max(1, ceil(q / |objs|))`.
   - For k = 0..count−1: `off = 0` when count = 1 else `−len/2 + len × (k + 0.5) / count`; point `o.center + u × off`,
     orientation AngleDeg(u), surface top `top`.
   - how: `{points} over {o.name}` (the raw object name) when there is one object, else `{points} over {|objs|} tables`
     (the word "tables" whatever the kind).
4. **Over a region** (no objs, region ≥ 3 points): `n = quantity or max(1, round½even(Area(region) × factor / 22))`;
   `spacing = 1.3 × max(CeilingAt(room, Centroid(region)) − planeH, 2)`; points = GridPoints(region, n, spacing, false)
   each with top planeH; how `{points} spread evenly over {D0(Area(region))} ft²`.
5. Otherwise `([], "no region to hang pendants over")`.
6. Each point: `(mount, height) = Mounting(ctx, point, top)`. (No grid snapping for pendants.)

Golden: Lobby reception (12 × 3.5, top 3): count 2 → (17, 17.25), (23, 17.25), pendant 5.5; Cafeteria: 24 tables (3.6 ft, not
long runs) → one each at table centres, height max(min(10−1, 2.5+2.5), min(3.5, 10)) = 5, how `24 over 24 tables`.

---

## 6. Ceiling glow (cove) — GlowLayout(ctx, factor)

1. Region < 3 points → `([], "no ceiling zone to glow")`.
2. `sign` = +1 when SignedArea(region) ≥ 0 else −1. `loop = Inflate(region, −0.5)`; fewer than 3 points →
   `([], "the ceiling zone is too small for cove")`.
3. `zoneHeight` = plane.height when the plane is Ceiling and its height > 0, else CeilingAt(room, Centroid(region)).
4. Module = 4 ft. For each loop edge i (a = loop[i], b = loop[(i+1) mod m]):
   - `len = Distance(a, b)`; skip if len < 2.
   - `dir = Unit(b − a)`; `inward = Perp(dir) × sign`.
   - `full = max(1, floor(len / 4))`; `m = full` when factor ≥ 0.999, else `max(1, round½even(full × factor))`.
   - `start = (len − m × 4) / 2`; `pitch = len / m`.
   - `outside = Lerp(a, b, 0.5) − inward × 1.0`; `lower = min(CeilingAt(room, outside), zoneHeight − 0.5)`;
     if `lower ≥ zoneHeight − 0.4` then `lower = min(room ceiling height, zoneHeight − 0.5)` (this branch can never fire, keep it
     harmless); `height = lower + 0.3`.
   - For k = 0..m−1: centre = `a + dir × (start + 4 × (k + 0.5))` when m = full, else `a + dir × (pitch × (k + 0.5))`;
     mount `cove`, orientation AngleDeg(dir), that height.
5. how: `cove loop 0.5 ft inside the {FeetInches(zoneHeight)} ceiling edge, {count} modules of 4 ft ({D0(count × 4)} ft)`.

Golden (Cafeteria cloud (12,6)–(36,22) at 12 ft over a 10 ft ceiling): loop (12.5,6.5)–(35.5,21.5); one module per edge
at the edge midpoints (24,6.5) 0°, (35.5,14) 90°, (24,21.5) 180°, (12.5,14) −90°; height 10.3;
how `cove loop 0.5 ft inside the 12′-0″ ceiling edge, 4 modules of 4 ft (16 ft)`. With factor ≥ 0.999: 5 + 3 + 5 + 3 = 16 modules.

---

## 7. Settle(ctx, raw, pinned) → (kept, notes)

1. `clear = max(0.3, max(product.length, product.width) × 0.4)`.
2. `devices` = when behavior.avoidCeilingDevices: centres of the room's existing fixtures not in the design's removed set; else none.
3. For each raw fixture in order, first matching rule:
   - not InRoom(centre) → `outside += 1`;
   - inside any keep zone (Contains, boundary counts) → `dim += 1`;
   - within < 1.5 ft of a pinned fixture, or < clear of an already kept fixture, or < clear of a device → `near += 1`;
   - else keep it.
4. notes = join with ", " of, in this order and only when non-zero: `left {outside} outside the room`,
   `kept {dim} out of keep-dim zones`, `dropped {near} that collided with other fixtures`.

---

## 8. KeepDimMargin(ctx, keep)

- keep.behavior.keepDimMargin set → max(it, 0).
- Else `ceiling = CeilingAt(room, Centroid(keep.region))` (or at (0,0) for an empty region);
  `beam = clamp(ctx.product.beamAngle, 10, 150)`; margin = `min(4, ceiling × tan((beam / 2) × π / 180))`.

---

## 9. Keep-dim helpers

### 9.1 Anchor(ctx, raw, pinned, notes) — every position fell inside a keep-dim margin

1. Settle again with the keep zones temporarily removed → `open` (its notes are discarded). Empty → [].
2. Among the first 12 of open (in order): `spot = NearestAllowed(ctx, f.centre)`; keep the fixture with the smallest
   `Distance(spot, f.centre)` (strictly smaller replaces) as `Relocated(ctx, f, spot)`.
3. Found → notes = `every position was inside a keep-dim margin, so one fixture moved {F1(distance)} ft to the nearest spot outside it`
   + (`, ` + original notes when non-empty); return [that fixture].
4. Else: the first fixture of open with the **largest** `min over keeps of PolygonDistance(keep.region, [centre])`
   (1-point form, see solver.md §8.1); notes = `the keep-dim margin covers everywhere this intent can be lit, so one fixture stays at the spot farthest from it and the keep-dim zone is over its maximum`
   + (`, ` + original notes when non-empty); return [it].

### 9.2 NearestAllowed(ctx, from)

1. Intent region < 3 points → none.
2. Region bounds (lo, hi); `step = max(0.5, sqrt(max((hi.x − lo.x) × (hi.y − lo.y), 1) / 2500))`.
3. `x = lo.x + step/2`; while x ≤ hi.x: `y = lo.y + step/2`; while y ≤ hi.y: consider p = (x, y); `y += step`; then `x += step`
   (accumulate by repeated addition). Accept p when `Distance(p, from) < best` (strict, so the first found wins ties),
   Contains(region, p), InRoom(p) and p is in no keep zone.
4. Return the best point or none.

### 9.3 Relocated(ctx, f, to)

Copy of f with centre = to. If `|CeilingAt(f.centre) − CeilingAt(to)| ≥ 0.01`, also take mount and height from
`Mounting(ctx, to, none)`. Orientation, tilt, output, id, pinned unchanged.

---

## 10. Mounting(ctx, p, objectTop) → (mount, height)

`ceiling = CeilingAt(room, p)`.
1. Kind CeilingGlow, or (IsCove and kind ≠ FeaturePendant) → (`cove`, max(ceiling − 0.5, 1)).
2. Kind FeaturePendant, or IsPendant:
   - mountingHeight set → (`pendant`, clamp(mountingHeight, 1, ceiling));
   - kind FeaturePendant and objectTop given → (`pendant`, `max(min(ceiling − 1, top + 2.5), min(top + 1, ceiling))`);
   - else → (`pendant`, `min(ceiling − 1.5, max(7.5, ceiling − 4))`).
3. Else (`ceiling`, ceiling).

Examples: 9 ft ceiling linear pendant task → 7.5; 14 ft strip → 10; reception top 3 under 14 ft → 5.5; bar top 3.5 under a
6.5 ft ceiling → max(min(5.5, 6), min(4.5, 6.5)) = 5.5.

---

## 11. AlignToGrid(ctx, fixtures) — ceiling grid snapping (area intents only)

1. Return unchanged when the room has no ceiling grid or behavior.alignToCeilingGrid is false.
2. `u`, `v` = grid step vectors, `origin`; `det = Cross(u, v)`; return unchanged when |det| < 1e-6 or |u| < 0.2 or |v| < 0.2.
   `uh = Unit(u)`, `vh = Unit(v)`.
3. For each fixture, in order:
   - mount ≠ `ceiling`, or the centre is under a non-main ceiling zone (`ZoneAt` not none) → keep unchanged.
   - `dir = Heading(orientation)`, `perp = Perp(dir)`; L = product.length, W = product.width; if round, L = W = max(L, W).
   - `extU = |Dot(uh, dir)| × L + |Dot(uh, perp)| × W`; `extV` likewise with vh.
   - `kU = max(1, round½even(extU / |u|))`, `kV = max(1, round½even(extV / |v|))`.
   - `d = centre − origin`; `a = Cross(d, v) / det`; `b = Cross(u, d) / det`.
   - `a = round½even(a − kU/2) + kU/2`; `b = round½even(b − kV/2) + kV/2` (**banker's rounding is essential**).
   - `snapped = (origin + u × a) + v × b`.
   - snapped not InRoom or inside a keep zone → keep the fixture unchanged.
   - else centre = snapped, orientation = AngleDeg(u) + (0 when |Dot(uh, dir)| ≥ 0.5 else 90).
4. DistinctByPosition: keep a fixture unless an already kept one is < 0.3 ft away **and** within < 0.5 ft in height.

Golden: Office 2 ft grid, 2×2 troffer: kU = kV = 1, so tile centres sit on odd feet. Pre-snap x = 18 → a = 9 →
round½even(8.5) = 8 → 8.5 → x = 17 (round-half-up would wrongly give 19). y = 4 → round½even(1.5) = 2 → y = 5.
Cafeteria fixtures under the 12 ft cloud keep their raw positions (18,16), (30,16).

---

## Test cases

| Test | Setup | Expected |
|---|---|---|
| Solve_AmbientFixturesSitOnTheCeilingGridTileCentres | Solved(Office) | ambient ≥ 6 fixtures; each ((x − origin.x)/u.x) mod 1 = 0.5 and same for y (±1e-6); height 9 (±1e-9); mount `ceiling`. With the ambient's behavior alignToCeilingGrid = false (set before SolveAll): some fixture has x/2 or y/2 with fractional part ≠ 0.5 (by > 1e-6) |
| Solve_FixturesMountAtTheirCeilingZoneHeight | Solved(Cafeteria) | every ambient fixture height = CeilingAt(centre) (±1e-9); some at exactly 12 (cloud), some at exactly 10 |
| Solve_WashRunsParallelToTheWallAtAThirdOfTheHeight | Solved(Office) | wash ≥ 3 fixtures; each |Dot(centre − start, inward)| = 3 (±0.01); tilt 0; orientation = AngleDeg(inward × −1) (±1e-6); sorted along-wall positions: spacing in [2, 4]; first position − projection of region[0] = spacing/2 (±0.05) |
| Solve_WashOffsetBehaviourWins | Office, wash Make over wall 2 [start, end], wall 2, wallOffset 2; Solve | every fixture Dot(centre − start, inward) = 2 (±0.01) |
| Solve_AccentIsAimedAtTheFaceCentre | Solved(Office) | 1 or 2 accent fixtures; each Dot(centre − wall2.start, wall2.inward) = 2.31 (±0.15); tilt in (20, 50); target average > 0; reason starts `3×`; target ≈ 3 × ambient estimate (±30 % of the ambient estimate) |
| Solve_FeaturePendantHangsThirtyInchesAboveTheSurfaceCappedBelowTheCeiling | Solved(Lobby) | pendants ≥ 2; each mount `pendant`, height 5.5 (±1e-9), height ≤ CeilingAt − 1; all inside Inflate(Footprint(reception), 0.5) |
| Solve_FeaturePendantHeightCapsAtTheCeilingMinusOneFoot | Room "Low" 12×12, ceiling 6.5, object "High bar" bar at (6,6) 6×2, orientation 0, top 3.5, bottom 0; FeaturePendant Make over its footprint, object 0; Solve | ≥ 1 fixture; all height 5.5 (±1e-9) |
| Solve_CeilingGlowFollowsTheCloudLoop | Solved(Cafeteria) with glow target (80, 100, 140) and product = designer choice of the 1600 lm cove (agentPicked false) | ≥ 16 modules; each mount `cove`, height 10.3 (±1e-6), within 0.05 ft of the 0.5 ft inset loop, InRoom; exactly 16 = 2 × (5 + 3) |
| Solve_CeilingGlowThinsItsModulesToTheTargetAndNeverBelowOnePerEdge | Solved(Cafeteria) | 4 ≤ modules < 16; outputs 1.0 |
| Solve_PathRunsAlongTheLongAxis | Solved(Lobby) | path ≥ 2 fixtures; X extent > Y extent; plane height 0 |
| Solve_PatternsAreHonoured (layout part) | see solver.md | staggered spreads X; perimeter within 2.1 ft of the walls |
| Golden: Office solved | Solved(Office) | ambient 10 at (3,5),(11,5),(17,5),(25,5),(3,13),(11,13),(17,13),(3,21),(11,21),(17,21) h 9; desk A (9,12.75), desk B (9,5.75), desk C (22,5.75) pendant 7.5; meeting table (25.25,15.25),(25.25,18.75) pendant 7.5; wash (16,21),(12,21),(8,21),(4,21) orientation 90; accent (10, 21.690598923241495) orientation 90 tilt 30 |
| Golden: Data hall ambient | Solved(DataHall) | 9 strips at x 6.667/20/33.333 × y 5/15/25, `pendant`, height 10, rows pattern |
| Golden: Cafeteria glow | Solved(Cafeteria) | 4 modules as in §6 |

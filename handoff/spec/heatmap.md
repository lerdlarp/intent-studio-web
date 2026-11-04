# Spec: heat scale and heatmap rasterizer (`packages/core/src/heatscale.ts`, `heatmap.ts`)

Maps footcandles to colour and paints a calculated zone into a bitmap plus the world corners it covers, so the plan can
draw it with an affine transform and 3D can texture a quad. No tests existed in the reference; the test table below is
derived by the spec team from these rules (computed with an independent implementation).

Rounding: "round" = round half to even (.NET default) everywhere in this file.

## 1. Heat scale

A scale is `{min, max, label}`.

- **fraction(fc)**: span = max − min; if span is not > 1e-9, or fc is NaN → 0; else clamp((fc − min)/span, 0, 1).
- **colorAt(fc)** = fromHue(240 · (1 − fraction(fc))): blue (240°) at min, red (0°) at max, full saturation, half
  lightness; values outside the range clamp.
- **fromHue(hue)** → 8-bit RGB: h = clamp(hue, 0, 360) / 60; x = 1 − |(h mod 2) − 1| (floating `mod` with the sign of
  the dividend, i.e. JS `%`); by floor(h): 0 → (1, x, 0); 1 → (x, 1, 0); 2 → (0, 1, x); 3 → (0, x, 1); 4 → (x, 0, 1);
  anything else (5, 6) → (1, 0, x). Each channel = round(channel · 255) (half-even).
- **auto(zones)**: min/max over every **finite** point value of every zone; if none → `{0, 100, "Auto range"}`; if
  max − min < 1e-6 → max = min + 1; label `Auto range`.
- **forTarget(target)**: min = (target.min ?? 0)·0.5; max = target.max ?? (target.avg ?? 0)·2; if max ≤ min → max =
  min + 10; label `Target range`. ("Blue at half the minimum, red at the maximum, so a layout inside its range reads
  green to yellow.")
- **ramp** (legend): 13 stops at positions i/12 (i = 0…12), colour fromHue(240·(1 − i/12)), left to right. Exact stops:
  (0,0,255) (0,85,255) (0,170,255) (0,255,255) (0,255,170) (0,255,85) (0,255,0) (85,255,0) (170,255,0) (255,255,0)
  (255,170,0) (255,85,0) (255,0,0).

## 2. Rasterizer — `rasterize(zone, scale, pixelsPerFoot = 6)`

Input zone result: `outline` (3D points, may be empty), `normal` (3D), `columnSpacing`, `rowSpacing`, `points`
(x, y, z, value). Output: `{width, height, pixels: Uint8ClampedArray (RGBA), origin, uEnd, vEnd, outline}` where origin
is the world position of the top-left pixel corner, uEnd the top-right, vEnd the bottom-left.

Constants: MAX_SIDE = 1024 px; MAX_LATTICE_CELLS = 4 000 000; LUT size 512; minimum pixels per foot 0.25.

**Pixel format change:** the original wrote BGRA (B, G, R, 255). The web version writes **RGBA = (R, G, B, 255)** for
`ImageData`/`DataTexture`. Unpainted pixels stay (0,0,0,0) (transparent). Row 0 is the top row (v = v0).

Steps:

1. **Outline**: zone.outline if it has ≥ 3 points; else, if the zone has points, a bounds rectangle: halfX =
   max(columnSpacing, 0.5)/2, halfY = max(rowSpacing, 0.5)/2, z = mean of point z, corners (x0,y0,z), (x1,y0,z),
   (x1,y1,z), (x0,y1,z) with x0 = min x − halfX, x1 = max x + halfX, y likewise. If still < 3 points → **empty raster**:
   1×1 transparent pixel, origin = uEnd = vEnd = (0,0,0), outline = zone.outline.
2. origin = outline[0].
3. **Normal** n = normalize(zone.normal); if that fails, the Newell normal of the outline (sum over edges j→i, j the
   previous vertex: x += (a.y−b.y)(a.z+b.z), y += (a.z−b.z)(a.x+b.x), z += (a.x−b.x)(a.y+b.y), then normalize); if that
   fails, (0,0,1). `normalize` fails when the length is ≤ 1e-9 or not finite.
4. **First edge** e = outline[i] − outline[0] for the first i ≥ 1 with |e|² > 1e-12, else (1,0,0).
5. u = normalize(e − n·(e·n)) (projected into the plane); if that fails normalize(e); if that fails (1,0,0).
   v = n × u.
6. Project the outline: (U, V) = ((p − origin)·u, (p − origin)·v). If the mean V of the outline is < 0, negate v and
   re-project (so the outline lies at positive V).
7. u0/u1 = min/max U, v0/v1 = min/max V of the outline; spanU = max(u1 − u0, 1e-6), spanV likewise.
8. ppf = max(pixelsPerFoot, 0.25); ppf = min(ppf, 1024/spanU, 1024/spanV). width = clamp(ceil(spanU·ppf), 1, 1024),
   height = clamp(ceil(spanV·ppf), 1, 1024). du = spanU/width, dv = spanV/height.
9. **Points**: zone points with finite value, projected to (U, V) with the same origin/u/v, in zone order.
10. **Sampler**: if there are ≥ 4 points, try the lattice (§3); if it is built, use it; otherwise use nearest (§4).
11. **LUT**: 512 colours, entry i = colorAt(min + (max − min)·i/511).
12. **Scan rows**: for row = 0…height−1, pv = v0 + (row + 0.5)·dv. Crossings: for each outline edge from the previous
    vertex a to vertex b (wrapping: the first edge is last→first), if (a.V ≤ pv) ≠ (b.V ≤ pv), add
    a.U + (pv − a.V)/(b.V − a.V)·(b.U − a.U). Sort ascending. For each pair (c[k], c[k+1]), k = 0, 2, 4, …:
    from = max(0, ceil((c[k] − u0)/du − 0.5)), to = min(width − 1, floor((c[k+1] − u0)/du − 0.5)) — the pixels whose
    centres lie in [c[k], c[k+1]] (even-odd fill, boundaries inclusive). For each col in [from, to]: pu = u0 + (col +
    0.5)·du; value = sampler(pu, pv); if none, leave the pixel transparent; else colour = LUT[clamp(round(fraction(value)
    ·511), 0, 511)] and write (R, G, B, 255) at offset (row·width + col)·4.
13. Corners: At(a, b) = origin + u·a + v·b; origin = At(u0, v0), uEnd = At(u1, v0), vEnd = At(u0, v1). Return the
    outline actually used.

`colorOf(scale, value)` = scale.colorAt(value) (direct, not via the LUT — the LUT quantises, e.g. 10 on a 0–30 scale is
(0,255,170) directly but (0,255,171) in a raster).

## 3. Lattice sampler (bilinear)

Build from the projected points:
1. du_l = columnSpacing if > 1e-6 else infer(U values); dv_l = rowSpacing if > 1e-6 else infer(V values). If either is
   not > 1e-6 → no lattice.
   infer(values): round each to 4 decimals (half-even), distinct, sort ascending, smallest consecutive gap; 0 if fewer
   than 2 distinct values.
2. lu0 = min U of points, lv0 = min V; columns = round((max U − lu0)/du_l) + 1; rows = round((max V − lv0)/dv_l) + 1. If
   columns ≤ 0, rows ≤ 0 or columns·rows > 4 000 000 → no lattice.
3. cells (columns·rows, all NaN); for each point in order: i = clamp(round((U − lu0)/du_l), 0, columns−1), j likewise
   with rows; cells[j·columns + i] = value (later points overwrite).

Sample(pu, pv):
1. fu = clamp((pu − lu0)/du_l, 0, columns − 1), fv likewise; i = floor(fu), j = floor(fv); tu = fu − i, tv = fv − j;
   i1 = min(i+1, columns−1), j1 = min(j+1, rows−1).
2. Accumulate, in this order, (i,j) weight (1−tu)(1−tv); (i1,j) tu(1−tv); (i,j1) (1−tu)tv; (i1,j1) tu·tv — skipping a
   term whose weight is ≤ 0 or whose cell is NaN: sum += value·w, weight += w.
3. If weight > 1e-9 → sum/weight (missing corners are renormalised away).
4. Hole: for r = 1 then 2: over dj = −r…r (outer), di = −r…r (inner), only cells with max(|di|,|dj|) = r (the ring),
   inside the lattice and not NaN, accumulate value·w and w with w = 1/√(di² + dj²); if the ring weight > 0 return
   ringSum/ringWeight.
5. Otherwise none (pixel left transparent).

## 4. Nearest sampler (few or irregular points)

reachU = max(columnSpacing, 0.5)/2, reachV = max(rowSpacing, 0.5)/2. Over points in order, skip any with |ΔU| > reachU
or |ΔV| > reachV; keep the smallest ΔU² + ΔV² (strictly smaller replaces, so the first point wins ties). None if no
point is within reach.

---

## Test cases (derived)

### Scale

| Name | Input | Expected RGB |
|---|---|---|
| min is blue | scale (0,1), colorAt(0) | (0,0,255) |
| 1/8 | colorAt(0.125) | (0,128,255) (127.5 rounds to even 128) |
| quarter | colorAt(0.25) | (0,255,255) |
| third | colorAt(1/3) | (0,255,170) |
| half | colorAt(0.5) | (0,255,0) |
| three quarters | colorAt(0.75) | (255,255,0) |
| max is red | colorAt(1) | (255,0,0) |
| clamps | colorAt(−1), colorAt(2) | (0,0,255), (255,0,0) |
| NaN | colorAt(NaN) | (0,0,255) (fraction 0) |
| zero span | scale (5,5): fraction(7) | 0 |
| ramp | 13 stops | list in §1 |
| auto | zones with values {3, NaN, 9, ∞} | {3, 9, `Auto range`} |
| auto flat | all values 4 | {4, 5} |
| auto empty | no finite values | {0, 100} |
| forTarget full | {10, 20, 35} | {5, 35, `Target range`} |
| forTarget avg only | {–, 30, –} | {0, 60} |
| forTarget max only | {–, –, 5} | {0, 5} |
| forTarget degenerate | {–, –, –} | {0, 10} |

### Rasterizer

Square S: outline (0,0,0),(2,0,0),(2,2,0),(0,2,0), normal (0,0,1), spacings 1/1, points (0.5,0.5)=0, (1.5,0.5)=10,
(0.5,1.5)=20, (1.5,1.5)=30; scale (0,30).

| Name | Input | Expected |
|---|---|---|
| S at 1 px/ft | rasterize(S, ppf 1) | 2×2; origin (0,0,0), uEnd (2,0,0), vEnd (0,2,0); row 0: (0,0,255), (0,255,171); row 1: (171,255,0), (255,0,0); all alpha 255 |
| S at 2 px/ft (bilinear) | ppf 2 | 4×4; sampled values row by row: [0, 2.5, 7.5, 10], [5, 7.5, 12.5, 15], [15, 17.5, 22.5, 25], [20, 22.5, 27.5, 30]; colours row 0: (0,0,255) (0,86,255) (0,255,255) (0,255,171); row 1: (0,170,255) (0,255,255) (0,255,85) (1,255,0); row 2: (1,255,0) (85,255,0) (255,255,0) (255,170,0); row 3: (171,255,0) (255,255,0) (255,86,0) (255,0,0) |
| triangle mask | outline (0,0,0),(4,0,0),(0,4,0); points at (x+0.5, y+0.5) for integer x,y ≥ 0 with x+y ≤ 3, value 10(x+y); scale (0,30); ppf 1 | 4×4; painted iff col+row ≤ 3 (boundary-inclusive: pixel (col 3,row 0) centre lies on the hypotenuse and is painted); value = 10·(col+row); others transparent (0,0,0,0) |
| wall, nearest, tie | outline (0,24,0),(36,24,0),(36,24,9),(0,24,9); normal (0,−1,0); spacings 3/3; points (1.5,24,1.5)=5, (4.5,24,1.5)=15; scale (0,20); ppf 0.5 | u = +x, v = +z; 18×5; origin (0,24,0), uEnd (36,24,0), vEnd (0,24,9); rows 0 and 1: cols 0,1 → (0,255,255) (value 5; col 1 is equidistant, first point wins), col 2 → (255,255,0) (15), the rest transparent; rows 2–4 transparent |
| bounds outline | outline empty, normal (0,0,1), spacings 2/2, points (1,1,2.5)=10, (3,1,2.5)=20; scale (0,20); ppf 1 | outline (0,0,2.5),(4,0,2.5),(4,2,2.5),(0,2,2.5); 4×2; origin (0,0,2.5); both rows: (1,255,0), (1,255,0), (255,0,0), (255,0,0) |
| empty | no outline, no points | 1×1 transparent, corners (0,0,0) |
| size caps | outline 2000×10 ft, ppf 6 | ppf reduced to 1024/2000 → width 1024, height ceil(10·0.512) = 6 |
| min ppf | ppf 0.1 on S | treated as 0.25 → 1×1 |

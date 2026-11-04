# Spec: quick estimate (`packages/core/src/estimate.ts`)

The app's own live illuminance estimate: point sources with I(θ) = I0·cosⁿθ, a distance-weighted indirect term and a
light loss factor. Every number it produces is labelled an estimate.

**Verification.** A from-spec reimplementation (by the spec team) of everything below reproduced, from the golden
`solved` fixtures and products, **every** `solved[].estimate` (average, minimum, maximum) and every `probes[].fc` in
all four golden rooms to ≤ 4.5e-16 relative, plus `power` exactly, and all `misc.json` exponents (beam 110 differs in
the last bit only, 5e-16 relative, from a different `cos` implementation). Sample counts per zone are listed in the
tests.

Units: feet, lumens, footcandles (lm/ft²). Angles in degrees unless noted. Helpers from the geometry spec: `area`
(absolute shoelace), `centroid`, `contains` (point-in-polygon, boundary counts as inside), `bounds` (min/max x and y),
`heading(deg)` = (cos(deg·π/180), sin(deg·π/180)).

## Constants

| Name | Value |
|---|---|
| LIGHT_LOSS_FACTOR | 0.85 |
| MAX_SAMPLES (per zone) | 400 |
| Beam clamp for the exponent | [8°, 170°] |
| Cut-off intensity fraction | 0.002 |
| Cut-off cosine cap | 0.95 |
| Minimum squared distance | 0.01 ft² |
| Asymmetric extra tilt | 35° |
| Tilt threshold | 0.01° |
| Linear test | length ≥ 3 and length ≥ 3·width |
| Linear pieces | clamp(roundHalfEven(length/2), 2, 4) |
| Uplight source threshold | uplight share ≥ 0.04 |
| Indirect flux share | up·0.6 + (1−up)·0.25 |
| Indirect nearness | 2 − 2·dist/reach, floored at 0.1 |
| Integer-power snap | \|n − round(n)\| < 0.02 and 0.98 ≤ n ≤ 6.02 |

## 1. Exponent from beam angle

`exponent(beam)` = ln 0.5 / ln cos(h), with h = clamp(beam, 8, 170) / 2 · π / 180 (compute `clamp/2`, then `·π`, then
`/180`). This is the n for which cosⁿ falls to half at half the beam angle.

Golden (`misc.json exponents`): 10→181.80621198630902, 25→28.893830678812083, 40→11.143405279234123,
60→4.81884167930642, 90→2.0000000000000004, 100→1.5684159304466327, 110→1.2469724469437233, 120→1.0000000000000002,
150→0.5128246381721744, 180→0.2840698893561952 (clamped to 170).

## 2. Which fixtures emit

Light comes only from the design's intents: for each intent **in design order**, skip it if it is a suggestion or has
no fixtures; its product is `productOf(room, intent)` (products.md §7); then each of its fixtures **in order**.
Existing room fixtures (`room.existing`) are **not** part of the estimate.

Per fixture `f` with product `p`:

1. Skip if `f.output ≤ 0` or `p.lumens ≤ 0`.
2. `total` = p.lumens · f.output; `up` = clamp(p.uplightShare, 0, 1).
3. Append an **indirect entry** (f.center.x, f.center.y, flux = total · (up·0.6 + (1−up)·0.25)).
4. **Aim axis** (unit vector the intensity is measured from):
   - `tilt` = f.tilt + (35 if p.asymmetric else 0) (degrees); `dir` = heading(f.orientation); t = tilt·π/180.
   - If `f.mount` is `wall`: axis = (dir.x, dir.y, 0) (tilt ignored).
   - else if tilt > 0.01: axis = (dir.x·sin t, dir.y·sin t, −cos t).
   - else axis = (0, 0, −1) (straight down).
5. **Pieces**: linear if p.length ≥ 3 and p.length ≥ 3·p.width; pieces = clamp(roundHalfEven(p.length/2), 2, 4) when
   linear, else 1. (All 4 ft generics → 2 pieces; a 5 ft → 2 (2.5 rounds to even); a 7 ft → 4; a 6 ft → 3.)
6. `down` = total · (1 − up); `n` = exponent(p.beamAngle).
7. For k = 0 … pieces−1: offset = −L/2 + L·(k+0.5)/pieces if linear else 0 (L = p.length); position =
   (f.center.x + dir.x·offset, f.center.y + dir.y·offset, f.height) (pieces lie along the orientation heading).
   - If down > 0: add a **source** with flux down/pieces, exponent n, the aim axis.
   - Then, if up ≥ 0.04: add a source with flux total·up/pieces, exponent **1**, axis (0, 0, +1) (upward).
   Order matters for summation: per piece, the down source then the up source.

A **source** with flux Φ and exponent n stores:
- I0 = Φ·(n+1)/(2π) (candela-equivalent so that the cosⁿ lobe integrates to Φ);
- cosCut = min(exp(ln 0.002 / max(n, 0.1)), 0.95) — directions with cos(angle to axis) ≤ cosCut get nothing;
- power = round(n) when |n − round(n)| < 0.02 and 0.98 ≤ n ≤ 6.02, else 0 (power is a fast path, see §3).

Derived values: beam 25 → cosCut 0.8064734864179842; 40 → 0.5725279031120898; 60 → 0.2753677774975419; 90 →
power 2, cosCut 0.04472135954999584; 120 → power 1, cosCut 0.0020000000000000044; 170/180 → cosCut ≈ 3.154e-10;
100 and 110 → power 0 (use the general power).

## 3. Illuminance at a point — `at(design, point, normal)`

`point` = (x, y, z) in room coordinates (z above floor); `normal` = unit surface normal pointing toward the side
being lit (e.g. (0,0,1) for a horizontal work plane facing up).

1. **Direct**: e = 0; for each source in build order add `direct(s)`:
   - v = point − source position; d2 = |v|²; if d2 < 0.01 then d2 = 0.01; inv = 1/√d2 (v itself is **not** rescaled).
   - cosA = (v·axis)·inv; if cosA ≤ cosCut → 0.
   - cosInc = −(v·normal)·inv; if cosInc ≤ 0 → 0.
   - c = cosA^n, computed for power 1: cosA; 2: cosA·cosA; 3: cosA·cosA·cosA; 4: (cosA·cosA)²; 5: (cosA·cosA)²·cosA
     (i.e. c2·c2 then ·cosA); 6: (cosA·cosA·cosA)²; otherwise `pow(cosA, n)`.
   - contribution = I0 · c · cosInc / d2.
2. **Indirect** (§4) at (x, y).
3. Result = (e + indirect) · 0.85.

`at` with no source and no indirect entry is 0.

## 4. Indirect term

`floorArea` (§7) = A; `reach` = √max(A, 1). For each indirect entry in build order:
near = 2 − dist((x,y), entry)·(2/reach) (compute `inv = 2/reach` once, then `2 − dist·inv`); weight = near if
near ≥ 0.1 else 0.1; sum += flux · weight. Indirect = sum / A.

So a fixture adds flux/A weighted 2 directly under it, falling linearly to 0.1 at half a "room width" (√A) and beyond.
The indirect term ignores the surface normal (a downward-facing ceiling gets it too).

## 5. Group scaling (internal, currently unused)

The original source set can tag each fixture with an integer group and evaluate with a per-group scale array (weight =
scale[g] if g < scale length else 1; entries with weight ≤ 0 are skipped; the weight multiplies both direct and
indirect contributions). No caller in the reference uses it (all groups 0, no scale). Implement optionally; results
with no scale must equal the above.

## 6. Sample points of a zone shape

Zone shapes come from zones.md (`shape(design, intent)`). `samples(shape, maxSamples = 400)` returns points and one
normal:

**Vertical** (wall strip from `from` to `to`, between `bottom` and `top`, with `inward` normal):
1. run = to − from; len = |run|; height = max(top − bottom, 0.1).
2. step = max(1, √(len·height / maxSamples)).
3. nu = max(1, floor(len/step + 1e-9)); nv = max(1, floor(height/step + 1e-9)).
4. For a = 0…nu−1 (outer), b = 0…nv−1 (inner): point = from + run·((a+0.5)/nu), z = bottom + height·(b+0.5)/nv.
5. Normal = (inward.x, inward.y, 0).

**Horizontal or ceiling** (polygon at `height`):
1. (lo, hi) = bounds(polygon); W = hi.x − lo.x; H = hi.y − lo.y.
2. sp = max(1, √(max(W·H, 1) / maxSamples)).
3. nx = max(1, floor(W/sp + 1e-9)); ny = max(1, floor(H/sp + 1e-9)); dx = W/nx; dy = H/ny.
4. For a = 0…nx−1 (outer), b = 0…ny−1 (inner): p = (lo.x + (a+0.5)·dx, lo.y + (b+0.5)·dy); keep it (z = height) if
   `contains(polygon, p)`.
5. If none was kept, use the polygon centroid (z = height) as the only point.
6. Normal = (0, 0, −1) for a ceiling plane, (0, 0, +1) for horizontal.

So samples are about 1 ft apart, widened so that there are never more than 400 (nx·ny ≤ W·H/sp² ≤ 400).

## 7. Floor area and power

- `floorArea(room)`: 0 if the room has no floor loops; else area(floor[0]) − Σ area(floor[i]) for i ≥ 1 (holes),
  then max(result, 1).
- `power(design)` → (watts, lpd): watts = Σ over intents (design order) that are not suggestions and have fixtures,
  Σ over their fixtures of productOf(room, intent).watts · f.output. lpd = watts / floorArea if floorArea > 0 else 0
  (W/ft²).

Golden: Office 249 W / 864 ft² = 0.2881944444444444; Cafeteria 451 / 1536 = 0.2936197916666667; Lobby 171 / 1120 =
0.15267857142857144; DataHall 330 / 1200 = 0.275.

## 8. Estimate of an intent

`estimate(design, intent)` → {average, minimum, maximum, fixtures, watts}:
- product = productOf(room, intent); watts = Σ over the intent's own fixtures of product.watts · f.output; fixtures =
  the intent's fixture count. (Its own fixtures only, even though illuminance counts every intent's light.)
- shape = zone shape of the intent; if none → average = minimum = maximum = 0.
- Otherwise samples(shape); for each sample in order e = at(design, sample, normal); sum += e (running sum in sample
  order); min starts at +∞, max **starts at 0**; average = sum / count; minimum = min (0 if still +∞).

Uniformity shown in the inspector ("avg · min · max fc · U") is minimum / average (UI-side; the reference model has no
U field — guard average = 0).

`estimateAll(design)`: one shared source set; a map from intent id to estimate for every intent that is **not** a
suggestion (including keep-dim intents and intents with zero fixtures). Results must equal `estimate` per intent.

Keep-dim intents and other unlit intents still get an estimate of the light others put on their plane (golden Office
keep-dim: average 8.529608628712793, fixtures 0, watts 0).

## 9. Probes

Golden `probes`: `at(design, point, (0,0,1))` on the solved design at four points on a 2.5 ft plane; they match to
≤ 4.5e-16 relative with this spec.

---

## Test cases

### Exponent

| Name | Input | Expected |
|---|---|---|
| cos¹ at 120° | exponent(120) | 1 (±1e-9) |
| cos² at 90° | exponent(90) | 2 (±1e-9) |
| narrower is higher | exponent(25) vs exponent(60) | 25° larger |
| golden table | the 10 `misc.json exponents` | each within 1e-12 relative |
| clamps | exponent(0), exponent(8) | both 284.2023339496307 (derived); exponent(200) = exponent(170) = 0.2840698893561952 |

### Single downlight point-source formula (SolverTests)

Room: floor = rectangle (0,0)–(20,20), ceiling 10. One Ambient intent: region = the floor, target {avg 10}, plane
horizontal at 0, product choice = downlight nominal (1500 lm, 60°, no uplight), one fixture at (10,10), height 10,
output 1, mount ceiling, orientation 0, tilt 0. n = exponent(60); I0 = 1500·(n+1)/(2π).

| Name | Point, normal | Expected |
|---|---|---|
| under the fixture | (10,10,0), (0,0,1) | ((I0/100) + 1500·0.25/400·2)·0.85 within 1 %; exact derived 13.401492058217213 |
| off to the side | (15,10,0), (0,0,1) | < 0.6 × the value under it (derived 6.1305133602106325) |
| facing away | (10,10,0), (0,0,−1) | indirect only: 1500·0.25/400·2·0.85 = 1.59375 (within 1 % of indirect) |
| corner (derived) | (0,0,0), (0,0,1) | 0.6278257080819616 |

### Output, counts, watts, power (Office, solved generic flow)

| Name | Input | Expected |
|---|---|---|
| output scales | Ambient average, then every Ambient fixture's output halved | half < 0.8·full and half > 0.3·full |
| fixtures and watts | estimate(Ambient) | fixtures = Ambient fixture count (golden 10); watts = Σ product.watts·output (golden 130, ±1e-6); min ≤ avg ≤ max |
| power | power(design) | watts > Ambient watts; lpd = watts/864 (±1e-9); 0.05 < lpd < 2.5. Golden 249 W, 0.2881944444444444 |

### Planes

| Name | Input | Expected |
|---|---|---|
| wall normal | Office solved; wall = room.walls[wash.wallIndex]; mid = wall midpoint | at(mid, z 5, inward normal) > 2 × at(same point, −inward) |
| cove lights the ceiling | Cafeteria solved; CeilingGlow intent | estimate average > 1 fc, and on target within 15 % or above target with a trace containing `already light this plane` or `pick a lower-output product` (golden 13.119212290786182) |

### Sampling

| Name | Input | Expected |
|---|---|---|
| ≤ 400 samples | Cafeteria solved, Ambient shape | sample count ≤ 400 (golden-derived 384) |
| speed | Cafeteria; new Ambient over floor[0] with 200 fixtures at (2 + (i mod 20)·2.2, 2 + floor(i/20)·3), height 10, output 1, generic product | one estimate after warm-up averages < 25 ms (target 5 ms) |
| counts (derived from golden rooms) | sample counts per solved intent | Office: 384, 84, 84, 77, 60, 96 (wash), 12 (accent), 30 (keep-dim); Cafeteria: 384, 174, 196, 384 (glow), 6, 375; Lobby: 368, 90, 154, 15, 36, 144; DataHall: 391, 112, 112, 112 |
| centroid fallback (derived) | horizontal shape whose cell centres all fall outside (e.g. a thin sliver triangle) | exactly one sample, at the centroid |
| vertical layout (derived) | from (0,0) to (10,0), bottom 2, top 8, inward (0,1) | step 1, 10×6 = 60 samples; first (0.5, 0, 2.5), second (0.5, 0, 3.5); normal (0,1,0) |

### Golden parity

| Name | Input | Expected |
|---|---|---|
| estimates | each room's `solved[i].intent` fixtures + `product` (look up full product data by family+lumens) | `solved[i].estimate` average/min/max within 1e-6 relative; fixtures, watts exact |
| probes | each room's `probes` | fc within 1e-6 relative |
| power | each room | `power.watts` exact, `lpdWPerFt2` within 1e-9, `floorAreaFt2` exact |

### Dropped

`DemoLink_PlansConfirmsAndCalculatesWithEstimates`, `DemoLink_CancelFails…`, `DemoLink_RoomsProductsAndSearch`
(Designer link and catalog search removed).

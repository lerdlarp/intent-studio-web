# Spec: product ranker (`packages/core/src/ranker.ts`)

Ranks products for one intent without a model: how well the product's family suits the intent kind, how close its
lumen package is to what one fixture of the layout needs, its beam against the mounting height, its efficacy, and
whether the designer's project already has it.

**Change from the original:** the original took a second candidate list from the removed external catalog. That
argument, its preference bonus (0.08), its reason prefix and every test that asserts on it are removed. The new
signature is `rank(room, intent, project)`. Candidate sources are, in order: **project products**, then **the generic
stand-in** for the kind.

"Project products" in the web version = the project's own product library (uploaded IES products and, in tests/demo,
`asProject()` from products.md). A project product is one with a `productId` (`inProject`) and `isGeneric == false`.

Helpers from other specs: `genericFor`, `packagesOf`, `isPackaged`, `byFamily` (products.md); `classOf(room)`,
`feetInches` (defaults spec); `centroid`, `area`, `ceilingAt` (geometry spec: `ceilingAt` = height of the last
non-main ceiling zone containing the point, searching zones from last to first, else the main ceiling height).

Rounding: wherever this spec says "round", it means .NET default rounding = **round half to even** (`roundHalfEven`).

---

## 1. `family(p)` — the generic family a product behaves as

Returns one of the 11 family ids. Evaluate in this order, first hit wins:

1. If `p.family` is non-empty and `byFamily(p.family)` exists (case-insensitive) → `p.family` lower-cased.
2. Let `text` = `p.label`, `p.catalog`, `p.description` joined with single spaces. All patterns below are
   case-insensitive regular expressions searched anywhere in `text` (`\b` = word boundary, `\s` = whitespace).
3. **wallwash** if WASH matches or `p.asymmetric`.
4. **cove** if `p.uplightShare ≥ 0.85` or COVE matches.
5. Let `small` = `p.isRound` or (`p.length ≤ 1.5` and `p.width ≤ 1.5`).
6. If PENDANT matches or `p.uplightShare ≥ 0.2` → **pendant-can** if small, else **pendant-linear**.
7. **step** if STEP matches.
8. **accent** if ACCENT matches or (small and `p.beamAngle ≤ 30`).
9. **strip** if STRIP matches.
10. If not small: let `long` = max(length, width), `short` = min(length, width).
    a. **strip** if `short > 0` and `long/short ≥ 4` and `long ≥ 3`;
    b. **volumetric** if VOLUMETRIC matches or (`long ≤ 2.3` and `short ≥ 1.5`);
    c. **troffer** if TROFFER matches or (`long ≥ 3` and `short ≥ 1.3`).
11. If DOWNLIGHT matches or small → **downlight-ho** if `beamAngle ≤ 45` or `lumens ≥ 2300`, else **downlight**.
12. Otherwise **downlight**.

Patterns (exact; `×` is U+00D7):

| Name | Pattern |
|---|---|
| WASH | `wall\s*-?\s*wash\|washer\|\bwashing\b` |
| COVE | `\bcove\b\|\btape\b\|\bribbon\b\|flexible\|\bindirect\s+only\b\|uplight\s+only` |
| PENDANT | `\bpendant\b\|\bsuspended\b\|\bcylinder\b\|\bdrum\b\|\bhung\b` |
| ACCENT | `\baccent\b\|\badjustable\b\|\bgimbal\b\|\bspot(light)?\b\|\btrack\b\|\bmr16\b\|\bpicture\b` |
| STRIP | `high\s*-?\s*bay\|low\s*-?\s*bay\|\bstrip\b\|\bindustrial\b\|\bwrap\b\|\bvapou?r\b` |
| STEP | `\bstep\s*light\|\bpath\s*light\|\bbollard\b\|\bwayfinding\b\|\btoe\s*kick\b` |
| TROFFER | `troffer\|flat\s*panel\|\bpanel\b\|lay[\s-]*in\|\b2\s*[x×']\s*[24]\b\|\b[24]\s*'?\s*[x×]\s*[24]\b\|volumetric` |
| DOWNLIGHT | `downlight\|down\s*light\|recessed\s+(can\|downlight)\|\bwafer\b\|\bdownlighting\b` |
| VOLUMETRIC | `volumetric\|\b2\s*[x×']\s*2\b\|2\s*'?\s*[x×]\s*2\s*'?` |

(In the table `\|` is the alternation bar escaped for Markdown; the pattern contains a plain `|`.) JS `\b` is
ASCII-only while .NET's is Unicode-aware; all patterns here only put `\b` next to ASCII letters/digits, so results agree.

## 2. `familyWord(family)` — words used in reasons

troffer → `troffer`; volumetric → `volumetric troffer`; downlight and downlight-ho → `downlight`; wallwash →
`wall washer`; accent → `accent`; pendant-linear → `linear pendant`; pendant-can → `pendant`; cove → `cove linear`;
strip → `linear strip`; step → `step light`; anything else → `luminaire`.

## 3. `familyFit(room, kind, family)` — 0..1

Flags: `grid` = room has a ceiling grid; `high` = `room.ceilingHeight > 12`; `office` = classOf is Office or
OpenOffice; `dataHall` = classOf is DataHall. "else" is any family not listed.

| Kind | Fits |
|---|---|
| Ambient | volumetric: grid?1.0:0.7 · troffer: grid?0.92:0.6 · downlight: high?0.55:(grid?0.8:0.95) · downlight-ho: high?0.95:0.7 · strip: dataHall?1.0:(high?0.6:0.5) · pendant-linear 0.65 · pendant-can 0.3 · cove 0.2 · step 0.15 · wallwash 0.2 · accent 0.2 · else 0.3 |
| Task | pendant-linear: office?1.0:0.65 · downlight: dataHall?0.4:0.85 · downlight-ho: high?0.8:0.7 · volumetric: grid?0.8:0.5 · troffer: grid?0.75:0.5 · strip: dataHall?1.0:0.5 · pendant-can 0.6 · accent 0.3 · wallwash 0.15 · cove 0.1 · step 0.1 · else 0.3 |
| WallWash | wallwash 1.0 · downlight 0.3 · downlight-ho 0.3 · accent 0.3 · else 0.08 |
| Accent | accent 1.0 · downlight-ho 0.6 · downlight 0.4 · wallwash 0.25 · else 0.08 |
| FeaturePendant | pendant-can 1.0 · pendant-linear 0.8 · downlight 0.2 · downlight-ho 0.2 · else 0.08 |
| CeilingGlow | cove 1.0 · pendant-linear 0.25 · strip 0.2 · else 0.05 |
| Path | downlight-ho 0.9 · step 0.9 · downlight 0.8 · strip: dataHall?0.85:0.4 · accent 0.4 · else 0.15 |
| KeepDim (other) | 0.5 for every family |

## 4. `needLumens(room, intent)` — lumens one fixture should deliver

1. `avg` = target average if set; else if min and max set → (min+max)/2; else if only min → min·1.5; else if only
   max → max·0.6; else 20.
2. `center` = centroid(region) if region has ≥3 points, else region[0] if it has 1–2 points, else (0,0).
   `ceiling` = ceilingAt(room, center).
3. By kind (evaluate the arithmetic left to right exactly as written):
   - **Ambient, Task, Path**: `area` = area(region) if ≥3 points else 100. `mount` = max(3, ceiling − h) where h =
     plane height if the plane is Horizontal, else 0. `spacing` = 1.2·mount. `n` = max(1, ceil(area / (spacing·spacing))).
     Result = `avg · area / 0.4675 / n` (0.4675 = 0.55·0.85, exactly representable as written).
   - **WallWash**: `run` = |region[1] − region[0]| if ≥2 points else 10. `top` = plane.top − plane.bottom if plane.top >
     plane.bottom, else max(3, ceiling − 1). `offset` = clamp(ceiling/3, 2, 4). `n` = max(1, ceil(run/offset)).
     Result = `avg · run · top / 0.425 / n` (0.425 = 0.5·0.85).
   - **Accent**: clamp(`avg · 6 / 0.5`, 300, 1500).
   - **FeaturePendant**: `area` = area(region) if ≥3 points else 16; `n` = max(1, round(area/16)) (half-even);
     result = clamp(`avg · max(area,16) / 0.45 / n`, 600, 3500).
   - **CeilingGlow**: 1400.
   - otherwise (KeepDim): 1500.

## 5. Score

For candidate `p` with `fam = family(p)`, `need = needLumens`, `mount` = ceilingAt(room, center) (center as in §4
step 2; note: the raw ceiling height, not minus the plane):

- `fit` = familyFit(room, intent.kind, fam).
- `lumenFit` = 0.3 if `p.lumens ≤ 0` or `need ≤ 0`; else with r = ln(lumens/need): exp(−r² / (2·0.6·0.6)).
- `beamFit`:
  - Accent: 1 if beam ≤ 40, else clamp(40/beam, 0.3, 1).
  - Ambient/Task/Path **and** fam is downlight or downlight-ho: `ideal` = 90 if mount ≤ 10, 60 if mount ≤ 14, else 40;
    r = ln(max(beam,10)/ideal); exp(−r² / (2·0.5·0.5)).
  - otherwise 1.
- `efficacy` = min(1, lumens/watts/130) if watts > 0 and lumens > 0, else 0.5.
- `preference` = 0.17 if `p.inProject`, else 0 (the generic).
- **score** = 0.45·fit + 0.2·lumenFit + 0.1·beamFit + 0.08·efficacy + preference (summed in that order).

Each scored candidate keeps (product, score, fit).

## 6. `rank(room, intent, project)` → product choice `{product, agentPicked, reason, alternatives}`

`MAX_ALTERNATIVES` = 8.

1. `generic` = genericFor(intent.kind, room).
2. **KeepDim**: return `{generic, agentPicked: false, reason: "Keep dim places no fixtures", alternatives: []}`.
3. Compute `need` and `mount` (§4, §5).
4. **Project candidates**: from `project`, keep products with `inProject` and not `isGeneric`; drop later duplicates
   by `key` (keep first occurrence); score each; sort **descending by score, stable** (ties keep input order).
5. Score `generic`.
6. **Pool** = project candidates followed by the generic, sorted descending by score, stable (so on an exact tie a
   project product beats the generic, and earlier project products beat later ones). `best` = pool[0].
   (A project product that does not suit the kind, e.g. a cove for a task, scores low on `fit` and loses to the
   generic that does.)
7. **Siblings** = `packagesOf(best.product)` without the item whose key equals best's key, in ascending-lumen order.
8. **Alternatives**, built in this order:
   a. all siblings;
   b. project candidates (in their sorted order) that are "other": product key ≠ best's key, key not among sibling
      keys, and `fit ≥ 0.3`; further de-duplicated by *slot*, keeping the first (best-scoring) per slot, where slot =
      `family:{family(p)}` if `isPackaged(p)` else `p.key` — so a packaged family elsewhere in the project competes
      with its best-fitting package only;
   c. the generic, if best is not the generic (compare by key) and the generic's key is not among sibling keys;
   d. truncate to the first 8.
9. Return `{best.product, agentPicked: true, reason(best.product), alternatives}`.

Implicit groups in the alternatives list, in order: **other packages of the chosen family**, **project products**,
**the generic stand-in** (always last when present). The original's third group, the removed external catalog, sat
between project products and the generic; it is gone. The reference contains no other group labels; the switcher UI
names in PLAN.md §3 are "Project products" and "Generic".

## 7. Reason text

`{source} · {lm}{familyWord}{beam} suits {context}` then, if the product is generic, append
`; pick a product to place it`.

- `source`: `In your project` if `inProject`, else `Generic stand-in`.
- `lm`: if lumens > 0, lumens with thousands separators (`,`) and no decimals followed by ` lm ` (trailing space),
  e.g. `3,000 lm `; else empty.
- `familyWord` of family(p).
- `beam`: if 0 < beamAngle < 170: `, {beam}° beam` (no decimals); else empty (cove at 180 gets none).
- `context` by kind: WallWash `an even wash on a wall`; Accent `an aimed accent`; FeaturePendant
  `a feature over a surface`; CeilingGlow `a glow on the ceiling`; Task `task light under a {F} ceiling`; Path
  `a path under a {F} ceiling`; otherwise (Ambient) `a {F} ceiling`.
- `{F}` = feet text of `mount`: inches = round(mount·12) (half-even); if inches is a multiple of 12 → `{inches/12}′`
  (U+2032, e.g. `9′`, `14′`), else `feetInches(mount)` (e.g. `10′-6″`).

Numbers use invariant culture. Formatting of non-integer lumens/beam with no decimals: round half away from zero.

Example: `Generic stand-in · 3,000 lm volumetric troffer, 120° beam suits a 9′ ceiling; pick a product to place it`.

---

## Test cases

`Seeded(room, kind)` = first seed of that kind from `Seed(room)` (golden `seeds` gives the same intents).
`P(family)` = first `asProject()` product of the family (its nominal).

### family()

Inputs are products with no `family`, not generic, no productId (in the original these were catalog entries; the
classifier does not care where they came from). label = catalog = the first string.

| Name | label/catalog, description, lumens, watts, L, W, round, beam, uplight, asym | Expected |
|---|---|---|
| wash words | `EVO6 WW`, `6 in recessed wall washer`, 1500, 14, 0.65, 0.65, yes, 90, 0, no | `wallwash` |
| asymmetric | `X`, `recessed`, 1500, 14, 0.65, 0.65, yes, 90, 0, **yes** | `wallwash` |
| 2x2 | `2BLT2`, `2x2 LED troffer`, 3200, 26, 2, 2, no | `volumetric` |
| 2x4 | `2BLT4`, `2x4 LED troffer`, 4800, 38, 4, 2, no | `troffer` |
| 6 in downlight | `LBR6`, `6 in LED downlight`, 1800, 16, 0.65, 0.65, yes, 80 | `downlight` |
| 4 in narrow | `LBR4`, `4 in LED downlight`, 2800, 22, 0.45, 0.45, yes, 40 | `downlight-ho` |
| suspended linear | `S4PID`, `4 ft suspended direct/indirect`, 4000, 32, 4, 0.35, no, 110, 0.4 | `pendant-linear` |
| cylinder | `CYL`, `Cylinder pendant`, 1800, 18, 0.8, 0.8, yes, 60 | `pendant-can` |
| cove beats strip | `CVX`, `Cove strip`, 1600, 14, 4, 0.3, no, 180, 1 | `cove` |
| gimbal | `ACC`, `Adjustable gimbal`, 900, 9, 0.4, 0.4, yes, 25 | `accent` |
| strip | `STR`, `LED strip`, 4000, 30, 4, 0.4, no | `strip` |
| bright small (derived) | `HB`, `2500 lm downlight`, 2500, 20, 0.45, 0.45, yes, 40 | `downlight-ho` |
| trusts own family | every item of `all` and of `asProject()` | `family(p) == p.family` |

### familyWord / familyFit spot checks (derived)

| Input | Expected |
|---|---|
| familyWord(`downlight-ho`) / (`x`) | `downlight` / `luminaire` |
| familyFit(Office, Ambient, volumetric) | 1.0 (grid) |
| familyFit(Lobby, Ambient, downlight) | 0.55 (14 ft) |
| familyFit(DataHall, Task, strip) | 1.0 |
| familyFit(any, KeepDim, any) | 0.5 |

### rank()

| Name | Input | Expected |
|---|---|---|
| project downlight for office task | Office, Seeded Task; project = [demo downlight 2500 lm, P(cove), P(wallwash)] | product is the demo downlight 2500 (same productId); agentPicked; reason starts `In your project` and contains `downlight`; ≤8 alternatives; product not in alternatives. Derived exact: reason `In your project · 2,500 lm downlight, 60° beam suits task light under a 9′ ceiling`; alternatives = [demo downlight 800, demo downlight 1500, generic `4 ft pendant linear, direct/indirect · 4000 lm`]. (Original also passed a catalog pendant; dropped.) |
| wall washer for a wash | Office, Seeded WallWash; project = [P(downlight), P(troffer), P(wallwash), P(accent)] | family(product) = `wallwash`; product inProject |
| whole project, Cafeteria | Cafeteria; project = asProject(); for WallWash, Accent, FeaturePendant, CeilingGlow (skip a kind with no seed) | family of product: wallwash / accent / pendant-can / cove respectively. Derived: lumens 1500 / 450 / 1000 / 1600 |
| project then generic | Office, Seeded Ambient; project = [P(volumetric), P(troffer), P(downlight)] | in alternatives every project product precedes any generic; if a generic is present it is the last item; ≤8. Derived exact: product demo volumetric 3000; alternatives = demo volumetric 1500, 2000, 4000, 5000, demo troffer 4000, demo downlight 1500, generic `2×2 volumetric troffer · 3000 lm` |
| nothing → stand-in | every room, every seed, project = [] | KeepDim: agentPicked false, 0 alternatives, product = genericFor, reason `Keep dim places no fixtures`; all others: product isGeneric and reason starts `Generic stand-in` |
| never a cove for a task | Office, Seeded Task; project = [P(cove)] | product isGeneric (derived: pendant-linear 4000); no alternative is inProject with family cove (derived alternatives: generic pendant-linear 2000, 3000) |
| other packages first | Office, Seeded Ambient, project = asProject() | see products.md "ranked: other packages first". Derived exact: product demo volumetric 3000, reason `In your project · 3,000 lm volumetric troffer, 120° beam suits a 9′ ceiling`; alternatives: demo volumetric 1500, 2000, 4000, 5000, demo `2×4 troffer · 3000 lm`, demo `6″ downlight · 2500 lm`, demo `4 ft pendant linear, direct/indirect · 3000 lm`, demo `4″ high-output downlight · 2500 lm` (8, so the generic is cut) |
| reason names lumens and ceiling (adapted) | DataHall, Seeded Task, project = [] | reason contains `lm` and `14′`. Derived exact: `Generic stand-in · 4,000 lm linear strip, 110° beam suits task light under a 14′ ceiling; pick a product to place it` |
| reason with a project product (adapted replacement) | DataHall, Seeded Task, project = [{productId set, label/catalog `HB`, description `2500 lm downlight`, 2500 lm, 20 W, 0.45×0.45, round, beam 40}] | derived: generic strip wins (0.754 vs lower); reason as above. Assert only that reason contains `lm` and `14′` |

Derived reasons for every seed with project = [] (spec-team computation from these rules; use as regression data):

| Room / seed | Product | Reason |
|---|---|---|
| Office Ambient | `2×2 volumetric troffer · 3000 lm` | `Generic stand-in · 3,000 lm volumetric troffer, 120° beam suits a 9′ ceiling; pick a product to place it` |
| Office Task (all) | `4 ft pendant linear, direct/indirect · 4000 lm` | `Generic stand-in · 4,000 lm linear pendant, 110° beam suits task light under a 9′ ceiling; pick a product to place it` |
| Office WallWash | `6″ wall washer · 1000 lm` | `Generic stand-in · 1,000 lm wall washer, 100° beam suits an even wash on a wall; pick a product to place it` |
| Cafeteria Ambient | `2×2 volumetric troffer · 3000 lm` | `Generic stand-in · 3,000 lm volumetric troffer, 120° beam suits a 12′ ceiling; pick a product to place it` (floor centroid lies under the 12 ft cloud) |
| Cafeteria CeilingGlow | `Cove linear, per 4 ft · 1600 lm` | `Generic stand-in · 1,600 lm cove linear suits a glow on the ceiling; pick a product to place it` |
| Lobby Ambient | `4″ high-output downlight · 2500 lm` | `Generic stand-in · 2,500 lm downlight, 40° beam suits a 14′ ceiling; pick a product to place it` |
| Lobby Path | downlight-ho 2500 | `Generic stand-in · 2,500 lm downlight, 40° beam suits a path under a 10′ ceiling; pick a product to place it` |

### needLumens()

| Name | Input | Expected |
|---|---|---|
| accent range | Office, Seeded Accent | 300 ≤ need ≤ 1500 (derived 720) |
| wash > 300 | Office, Seeded WallWash | > 300 (derived 941.1764705882352) |
| scales with target | Office Seeded Ambient vs a new Ambient intent with same region and plane and target {avg = 2 × ambient avg} | brighter need > 1.9 × ambient need (derived ambient 2464.1711229946523) |
| derived values | Office Task seeds 1–4 | 2695.187165775401, 2695.187165775401, 2470.5882352941176, 3850.267379679144 |
| derived values | Cafeteria FeaturePendant / CeilingGlow / Accent | 887.4444444444443 / 1400 / 540 |
| derived values | DataHall Ambient / Task | 15401.069518716578 / 7187.165775401069 |

### Dropped tests (assert on removed catalog behaviour)

| Original test | Why / replacement |
|---|---|
| `Rank_ReasonNamesLumensBeamAndTheCeiling` | Only candidate was a catalog product; replaced by the adapted rows above |
| `Rank_ListsProjectThenCatalogThenGenericAlternatives` | Catalog ordering; replaced by "project then generic" |
| The catalog argument in `Rank_PrefersAProjectDownlightForAnOfficeTask` | Argument removed; test kept without it |
| `Family_ClassifiesFromPhotometryAndWords` construction via catalog ids | Kept with plain products (no id) |
| `LumenPackageTests` `Solve_ARealCatalogProductIsKeptAndGetsTheGenericHint` | Kept with an uploaded (non-demo) product instead of a catalog one |
| `PickProductAsync` external-catalog suggestions group in the product switcher, add-to-schedule flow | Removed entirely |

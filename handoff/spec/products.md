# Spec: generic products (`packages/core/src/products.ts`)

Source of truth for the built-in generic luminaire families, their lumen packages, the per-kind default family, the
"demo project" copies of those packages, and the solver's "settled package" cache. Every value below is exact and was
checked against `handoff/golden/misc.json` → `genericPackages` (41 entries, all fields identical).

Units: lengths in feet, lumens, watts, beam angle in degrees (full angle at half peak). All lumen and watt values are
integers.

---

## 1. Product record (fields used here)

A product has these fields (defaults in brackets, they matter for uploaded/hand-built products):

| Field | Meaning | Default |
|---|---|---|
| `productId` | id of a product that is *in the project* (schedule type). Optional. | none |
| `label`, `catalog`, `brand`, `description` | display strings | `""` |
| `family` | generic family id (see §2), or `""` | `""` |
| `lumens`, `watts` | | 0 |
| `length`, `width` | luminous size, feet | 1, 1 |
| `isRound` | | false |
| `beamAngle` | degrees | 90 |
| `uplightShare` | 0..1 share of flux emitted upward | 0 |
| `asymmetric` | wall-washer style asymmetric distribution | false |
| `isGeneric` | true for a generic stand-in with no real photometry | false |

Derived:

- **`key`**: the `productId` as a string when it is set (for the demo project: lowercase hyphenated GUID text, see §6);
  otherwise `generic:{family}:{lumens}` where lumens is formatted with no decimals (round half away from zero; all
  generic lumens are integers so e.g. `generic:volumetric:3000`). (The original also had a third form for the removed
  external catalog; it is gone.)
- **`inProject`**: true exactly when `productId` is set.

The removed external catalog's id field does not exist in the new model. Where the original tested "no catalog id",
the condition simply disappears.

## 2. The eleven families (table order is significant)

Columns: id · family label · noun (used in descriptions) · length · width · round · beam · uplight share · asymmetric ·
nominal index · packages as (lumens, watts), already ascending by lumens.

| # | id | label | noun | L | W | round | beam | up | asym | nominal idx | packages (lm, W) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `volumetric` | `2×2 volumetric troffer` | `2×2 recessed volumetric troffer` | 2 | 2 | no | 120 | 0.02 | no | 2 | (1500,13) (2000,17) (3000,25) (4000,33) (5000,42) |
| 2 | `troffer` | `2×4 troffer` | `2×4 recessed troffer` | 4 | 2 | no | 120 | 0.02 | no | 1 | (3000,25) (4000,33) (5000,42) (6000,50) |
| 3 | `downlight` | `6″ downlight` | `6 inch recessed downlight` | 0.65 | 0.65 | yes | 60 | 0 | no | 1 | (800,8) (1500,14) (2500,23) |
| 4 | `downlight-ho` | `4″ high-output downlight` | `4 inch high-output recessed downlight` | 0.45 | 0.45 | yes | 40 | 0 | no | 3 | (650,6) (1000,9) (1800,15) (2500,20) (3500,28) |
| 5 | `wallwash` | `6″ wall washer` | `6 inch recessed asymmetric wall washer` | 0.65 | 0.65 | yes | 100 | 0 | **yes** | 1 | (600,6) (1000,10) (1500,14) (2200,21) |
| 6 | `accent` | `4″ adjustable accent` | `4 inch adjustable accent` | 0.4 | 0.4 | yes | 25 | 0 | no | 2 | (450,5) (700,7) (1000,10) (1500,15) |
| 7 | `pendant-linear` | `4 ft pendant linear, direct/indirect` | `4 ft suspended linear, 40% uplight` | 4 | 0.35 | no | 110 | 0.4 | no | 2 | (2000,17) (3000,25) (4000,32) |
| 8 | `pendant-can` | `Pendant can` | `Cylinder pendant` | 0.8 | 0.8 | yes | 60 | 0 | no | 2 | (600,7) (1000,11) (1800,18) (2800,28) |
| 9 | `cove` | `Cove linear, per 4 ft` | `Cove linear per 4 ft, all light up` | 4 | 0.3 | no | 180 | 1 | no | 1 | (800,7) (1600,14) (2400,21) |
| 10 | `strip` | `4 ft strip / linear high bay` | `4 ft linear strip, chain hung` | 4 | 0.4 | no | 110 | 0.05 | no | 1 | (2500,20) (4000,30) (5500,42) |
| 11 | `step` | `Step / path light` | `Low-level step or path light` | 0.45 | 0.3 | no | 90 | 0 | no | 1 | (150,2) (300,4) (500,6) |

Unicode: `×` is U+00D7, `″` is U+2033 (double prime), `·` is U+00B7, `°` is U+00B0. Spaces are ordinary U+0020.

"Nominal index" is a 0-based index into the family's packages sorted ascending by lumens. So the nominal packages are:
volumetric 3000, troffer 4000, downlight 1500, downlight-ho 2500, wallwash 1000, accent 1000, pendant-linear **4000**,
pendant-can 1800, cove 1600, strip 4000, step 300.

## 3. Building one package product

For family `f` and package `(lumens, watts)`:

- `label` = `{f.label} · {lumens} lm` (lumens with no decimals), e.g. `2×2 volumetric troffer · 3000 lm`.
- `description` = `{f.noun}, {lumens} lm, {watts} W{beamSuffix}`, where `beamSuffix` = `, {beam}° beam` (beam with no
  decimals) **only when the family is round and 0 < beam < 170**, else empty. So round families (downlight,
  downlight-ho, wallwash, accent, pendant-can) carry the suffix; the others do not.
  Examples: `6 inch recessed downlight, 800 lm, 8 W, 60° beam`; `Cove linear per 4 ft, all light up, 800 lm, 7 W`;
  `4 ft suspended linear, 40% uplight, 2000 lm, 17 W`.
- `catalog` = `Generic`, `brand` = `Generic`, `family` = f.id, `lumens`, `watts`, `length`, `width`, `isRound`,
  `beamAngle` = f.beam, `uplightShare` = f.up, `asymmetric`, `isGeneric` = true, no `productId`.

All 41 labels and descriptions are listed verbatim in `golden/misc.json` → `genericPackages`, in exactly the order of
`allPackages` (§4); a golden test should compare them field by field.

## 4. Lists and lookups

- **`packages(family)`**: the family's package products ascending by lumens. Family lookup is **case-insensitive**
  (ordinal ignore-case). Unknown/empty/missing family → empty list.
- **`all`** (the nominal of each family, "what a designer reaches for first"): 11 products in table order:
  volumetric, troffer, downlight, downlight-ho, wallwash, accent, pendant-linear, pendant-can, cove, strip, step.
  Named accessors in the original: Volumetric2x2, Troffer2x4, Downlight6, DownlightHighOutput4, WallWasher6, Accent4,
  PendantLinear4, PendantCan, CoveLinear4, StripHighBay4, StepLight (each = the nominal package of its family).
- **`allPackages`**: every package of every family, families in table order, ascending lumens within a family
  (41 items).
- **`byFamily(family)`**: the first product in `all` whose family equals the argument case-insensitively, else none.
- **`packagesOf(p)`** — the lumen packages that stand beside a product (product included), ascending by lumens:
  1. If `p.family` is empty or is not one of the 11 ids (case-insensitive) → empty.
  2. If `p.isGeneric` and `p.productId` is not set → `packages(p.family)`.
  3. Else if `p` is a demo-project product (§6: `productId` set, not generic, `brand` is exactly `Demo`, `catalog`
     starts with `DEMO-` (case-sensitive)) → the demo project's products of that family, ascending by lumens.
  4. Otherwise (a real/uploaded product) → empty: the app knows no packages of a real product.
- **`isPackaged(p)`** = `packagesOf(p).length > 1`.
- **`asProjectProduct(p)`**: if the demo project has the family of `p` (case-insensitive; missing family treated as
  `""`), return the first demo product of that family (ascending lumens) with `|lumens − p.lumens| < 0.5`, else `p`;
  if the family is not in the demo project, return `p`.

## 5. Default family per intent kind — `genericFor(kind, room)`

`classOf(room)` is the space class from the defaults spec (`IntentDefaults.ClassOf`). "Open ceiling" means
`classOf(room) == DataHall`.

| Kind | Result (nominal package of) |
|---|---|
| Ambient | `strip` if class is DataHall (open ceiling); else `volumetric` if the room has a ceiling grid; else `downlight-ho` if `room.ceilingHeight > 12`; else `downlight` |
| Task | `strip` if open ceiling; else `pendant-linear` if class is Office or OpenOffice; else `downlight` |
| WallWash | `wallwash` |
| Accent | `accent` |
| FeaturePendant | `pendant-can` |
| CeilingGlow | `cove` |
| Path | `strip` if open ceiling, else `downlight-ho` |
| KeepDim (any other) | `downlight` |

Note the 12 ft test uses the room's main `ceilingHeight` (strictly greater than 12), not ceiling zones.

Golden check (all four rooms' `solved[].intent.product.family` agree with this table for unpackaged starting points;
e.g. Office keep-dim shows `6″ downlight · 1500 lm`, the default for KeepDim).

## 6. The demo project (`asProject()`) and `stableId`

The generic packages presented as if they were schedule types already in a project, so the "pick from project" flow
works with no external system. The PLAN keeps it as the demo project and the tests depend on it.

`asProject()` returns 41 products: for each family in table order, its packages ordered **nominal first, then the
rest ascending by lumens**; each is a copy of the generic package with:

- `productId` = `stableId(family)` for the nominal package, else `stableId("{family}:{lumens}")` (lumens no decimals),
  e.g. `stableId("volumetric:1500")`.
- `isGeneric` = false; `catalog` = `DEMO-` + family id upper-cased (invariant), e.g. `DEMO-VOLUMETRIC`,
  `DEMO-DOWNLIGHT-HO`, `DEMO-PENDANT-LINEAR`; `brand` = `Demo`. Label, description and photometry unchanged.

It is computed once (lazily) and the same list (same order, same ids) is returned every time.

The demo project's per-family lists used by `packagesOf` / `asProjectProduct` are its products grouped by family
(case-insensitive) and sorted ascending by lumens.

**`stableId(text)`**: MD5 of the UTF-8 bytes of `studio-demo:` + text (16 bytes `b0..b15`), turned into a GUID the way
.NET's byte-array GUID constructor does, and printed lowercase as `8-4-4-4-12` hex:
first group = bytes b3 b2 b1 b0, second = b5 b4, third = b7 b6, then b8 b9, then b10..b15 (i.e. the first three groups
are little-endian). Equivalent to a UUID built from "bytes_le". `packages/core` must not use Node APIs, so ship a small
pure-TS MD5.

Test vectors (verified; the first also appears in `golden/Lobby.json` as the existing fixtures' `productId`, and
`existing-lobby-0` as the first existing fixture's `id`):

| text | stableId |
|---|---|
| `downlight` | `8713baa4-22dc-51c2-6e01-fb595b1d00b5` |
| `existing-lobby-0` | `8a105443-3344-103a-4577-087e27d5e99c` |
| `volumetric` | `4d8c8455-d245-9b55-2540-05adbe812031` |
| `troffer` | `0ad75c6a-2bcc-d685-0f64-43a11538fc65` |
| `downlight-ho` | `c1d547cc-c447-318e-5009-d4ea1ff9529f` |
| `wallwash` | `4259a34b-56c2-8dda-5677-3b98c452fff4` |
| `accent` | `77e4a964-9948-6848-2d81-6576f8121617` |
| `pendant-linear` | `c72e82af-e699-c62e-07d5-1997453b42f7` |
| `pendant-can` | `6f202738-d59d-7cf4-1820-3dc9c8515a5b` |
| `cove` | `11e94b02-bda1-3c05-2e63-158248bb3ca8` |
| `strip` | `1d32d533-2612-b703-c987-85b950d558e3` |
| `step` | `d254d04c-300e-62e2-3a0f-4dcb0fba3b5a` |
| `volumetric:1500` | `cea7810f-fe18-3df7-716c-2fedfe4c6154` |
| `downlight:2500` | `bda914ed-d90a-07fa-6fa5-2da69b018baa` |

## 7. The settled-package cache and `productOf`

The solver may step an intent between lumen packages of its family. When the intent has **no product choice yet**
(`intent.product` is absent), the chosen package is *not* written into the intent (so the agent/designer can still
pick a real product); it is remembered in a side table keyed by the intent **object identity**. In TS use a
`WeakMap<LightingIntent, Product>`.

- `rememberPackage(intent, pkg)`: store/replace; when `pkg` is absent, delete the entry.
- **`productOf(room, intent)`** = `intent.product.product` if the intent has a product choice; else the remembered
  package if any; else `genericFor(intent.kind, room)`.

Every consumer (estimate, power, solver, exports) gets an intent's product through `productOf`. The cache is not
serialised: a reloaded design falls back to `genericFor` until it is solved again (which re-settles the same package,
since the solver is deterministic). The golden `solved[].intent.product` is the `productOf` result after solving
(e.g. Office ambient `2×2 volumetric troffer · 1500 lm` while `intent.product` itself stays null).

---

## Test cases

Rooms are the four demo rooms (Office `204 Open office`, Cafeteria `110 Cafeteria`, Lobby `101 Entry lobby`, DataHall
`3B Data hall`). "Seed(room)" = `IntentSuggestions.Seed`. "Accept all" = set `isSuggestion=false` on every seed.
"ranked flow" = after accepting, set every intent's product to `rank(room, intent, asProject())` (see ranker.md),
then `solveAll`. "generic flow" = accept and `solveAll` with no products.

### Packages and families (pure, from LumenPackageTests / ModelTests)

| Name | Input | Expected |
|---|---|---|
| all has 11 nominals | `all` | length 11; every item `isGeneric`, `lumens>0`, `watts>0` |
| volumetric nominal | `all[0]` | lumens 3000, watts 25, label `2×2 volumetric troffer · 3000 lm` |
| troffer nominal | troffer nominal | lumens 4000 |
| accent beam | accent nominal | beamAngle 25 |
| wall washer asymmetric | wallwash nominal | asymmetric true |
| pendant uplight | pendant-linear nominal | uplightShare 0.4 (±1e-9) |
| cove uplight | cove nominal | uplightShare 1 (±1e-9) |
| step nominal | step nominal | lumens 300 |
| every family packaged | for each nominal n: `packages(n.family)` | ≥3 items; already ascending by lumens; keys distinct; labels distinct; every item `isGeneric`, family == n.family, label ends with ` · {lumens} lm`; n.key is among the keys; every `lumens/watts` strictly between 60 and 150 |
| pendant-linear lumens | `packages("pendant-linear")` lumens | exactly [2000, 3000, 4000] |
| volumetric subset | `packages("volumetric")` lumens | contains 2000, 3000, 4000, 5000 (full list 1500,2000,3000,4000,5000) |
| downlight subset | `packages("downlight")` lumens | contains 800, 1500, 2500 |
| case-insensitive | `packages("VOLUMETRIC")` | same 5 products |
| unknown family | `packages("nope")`, `packages("")` | empty |
| allPackages vs golden | `allPackages` | 41 items equal (family, label, description, lumens, watts, length, width, isRound, beamAngle, uplightShare, asymmetric) to `misc.json genericPackages` in order; `nominal` flag true exactly for the nominal of each family |
| keys | `all[0].key` | `generic:volumetric:3000` |

### Default per kind (ModelTests `GenericProducts_ForPicksTheRightDefaultPerKind`)

| Kind | Room | Expected family |
|---|---|---|
| Ambient | Office (ceiling grid) | `volumetric` |
| Ambient | Lobby (no grid, 14 ft) | `downlight-ho` |
| Ambient | DataHall | `strip` |
| Task | Office | `pendant-linear` |
| Task | Cafeteria | `downlight` |
| WallWash | Office | `wallwash` |
| Accent | Lobby | `accent` |
| FeaturePendant | Lobby | `pendant-can` |
| CeilingGlow | Cafeteria | `cove` |
| Path | Lobby | `downlight-ho` |
| Path / Task | DataHall | `strip` (derived) |
| KeepDim | any | `downlight` (derived; golden Office keep-dim product is `6″ downlight · 1500 lm`) |

### Demo project

| Name | Input | Expected |
|---|---|---|
| stable ids | `asProject()` twice | same length; every item has `productId`, `!isGeneric`, `inProject`; productId sequences identical; all productIds distinct |
| size | `asProject().length` | equals `allPackages.length` (41) |
| nominal first, keeps family id | for each family: first demo product of that family | `productId == stableId(family)`; lumens == `byFamily(family).lumens` |
| packagesOf demo | first demo product of each family | `packagesOf(it).length == packages(family).length` |
| asProjectProduct | `asProjectProduct(packages("downlight")[0])` | lumens 800 and `inProject` true |
| real product has no packages | downlight 800 package copied with a fresh `productId`, `isGeneric=false`, `catalog="Uploaded"` (original used the removed catalog's name; any non-`DEMO-` catalog) | `packagesOf(...)` empty |
| stableId vectors | table in §6 | exact strings |
| catalog naming | demo copy of downlight-ho | catalog `DEMO-DOWNLIGHT-HO`, brand `Demo` |

### productOf / settled package

| Name | Input | Expected |
|---|---|---|
| choice wins | intent with a product choice P | `productOf` = P |
| settled next | intent without choice, `rememberPackage(i, X)` | X |
| removal | then `rememberPackage(i, none)` | `genericFor(kind, room)` |
| default | fresh intent | `genericFor(kind, room)` |
| identity keyed | two distinct intent objects with equal fields, remember on one | the other still gets the default |

### Solver-level package behaviour (port with the solver, wave 4; listed here because they live in LumenPackageTests)

| Name | Input | Expected |
|---|---|---|
| most intents meet target (×8) | each demo room × {generic, ranked}; for intents with any target bound | ≥1 targeted intent; ≥75 % of targeted intents have status "Meets". Status = the inspector rule (see ambiguity note), plus: if it would be Meets but the target has no maximum, has an average `a`, and estimate average > 1.3·a → "Over" |
| no needless overshoot (×8) | each room × flow; intents with fixtures and a maximum | ≥1 such intent; whenever estimate average > max·1.02, the intent's product has no package with lumens < its lumens − 0.5 in `packagesOf(productOf)` |
| ranked: other packages first | Office, first Ambient seed, `rank(room, it, asProject())` | `packagesOf(choice.product)` minus the product has >1 items and equals the first items of `alternatives` (same order); product not in alternatives; ≤8 alternatives. With empty project: product is generic and the other generic packages lead the alternatives |
| ranked: steps down and says why | Office ranked flow, the Ambient intent | `product.agentPicked` true; `productOf` lumens < 3000; some trace line contains `Stepped down to` and `overshoots 35 fc at the fewest fixtures`; alternatives' lumens include 3000; first 4 alternatives all have the picked family |
| generic: package kept out of the intent | Office generic flow | every intent's `product` stays absent; Ambient `productOf` lumens < 3000 (golden: 1500 lm, 10 fixtures); a trace line starts with `{ambient label}: no product chosen yet` |
| designer choice never changed | Office generic flow, Ambient pre-set to choice (volumetric nominal, agentPicked false, reason `Chosen by you`) | product unchanged, agentPicked false, reason `Chosen by you`; no trace contains `Stepped`; some trace contains `package of this family would land closer` |
| real product kept | Office generic flow, Ambient pre-set to volumetric nominal copied with a new productId, isGeneric false, catalog/brand `Uploaded`, label `Uploaded 2x2 3000`, family `volumetric`, agentPicked true, reason `Agent pick` | product unchanged; no `Stepped` trace; some trace contains `pick a lower-output product` (original test used the removed catalog's name as catalog/brand; behaviour is identical for any non-`DEMO-` catalog) |
| ambient counts others' light | Office generic flow vs Office with only the Ambient intent kept | ambient fixtures×lumens strictly smaller with the other intents present |
| deterministic & stable | each room, ranked flow solved twice | per intent identical `productOf(...).key` and fixture count; solving `a` again changes no (key, count) pair |
| **dropped** | `DemoLink_TheCalculationAgreesWithTheEstimateForThePickedPackages` | Designer link removed; not ported |

### Ambiguities / notes

- The inspector status function (`IntentViewModel.StatusOf(target, average)`) is not in the reference. PLAN §3 says
  status glyphs use `TargetRange.Meets`; the "most intents meet" test needs Meets/Over/Under from the average alone.
  Suggested: Under if `min` set and avg < min·0.98 (or only avg set and avg < avg·0.9), Over if `max` set and avg >
  max·1.02, else Meets — confirm with whoever specs the inspector.
- Whether the demo project ships in the app (vs. tests only) is a product decision; the core must provide
  `asProject()` and `stableId` regardless (demo rooms need `stableId`).

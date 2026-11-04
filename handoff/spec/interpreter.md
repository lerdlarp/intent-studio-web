# Spec: offline interpreter (free text → intents)

Module: `packages/core/src/interpreter.ts`. Reference name: `StudioInterpreter`. Pure, deterministic, no network.

It turns a designer's sentence such as "wash the brand wall, keep the screen dim" into `LightingIntent`s for one room.
Keywords give the intent **kind**; compass words, wall phrases and object names give the **target**; a number with a
unit gives a **level**. Everything funnels into one function, **`forTarget(room, kind, walls, objects, level?)`**, which
the AI interpret codec (see `ai-codecs.md`) also calls.

Units: feet and footcandles. +Y is north. Angles are degrees counter-clockwise from +X.

Dependencies (specified elsewhere, referenced by name):

| Name used here | Meaning | Spec |
|---|---|---|
| `KindOf(object)` | object's `kind` string, trimmed and lower-cased ("" when missing) | workplane |
| `SurfaceKinds` | `desk, table, counter, reception, island, bar` | workplane |
| `FaceKinds` | `artwork, display, signage, mirror, screen` | workplane |
| `Infer(room, kind, region, wall, obj)` | measuring plane | workplane |
| `WallFor(room, kind, region, wall, obj)` | wall an object/run sits on (nearest wall; wash runs crossing a wall at a right angle get +5 ft penalty) | workplane |
| `FaceMidpoint(room, object)` | midpoint of the object's face that looks into the room | workplane |
| `Target(room, kind, obj, ambientAvg)` | default `(range, reason)` | defaults |
| `Label(room, kind, region, wall, obj)` | default label | defaults |
| `WallName(room, i)` | compass wall name, e.g. "North wall", "North wall 2" | defaults |
| `Seed(room)` | ranked suggestions (≤ 8) | suggestions |
| `Clusters(room)` | work-surface clusters (objects, region), in their fixed order | suggestions |
| `Footprint`, `Inflate`, `Bounds`, `Rect`, `Centroid`, `Heading`, `Perp`, `Unit`, `Dot` | geometry helpers | geometry |

`Rect(a, b)` always yields the 4 corners in the order (minX,minY), (maxX,minY), (maxX,maxY), (minX,maxY).
`Heading(deg)` = (cos, sin). `Perp(v)` = (−v.y, v.x).

Constant: **MaxPerClause = 6** (at most 6 intents of one kind from one call of `forTarget`).

All regexes below are **case-insensitive**. They are written for ASCII input; `\b` is a word boundary, `\s` whitespace,
`\w` a word character. In .NET `.` matches anything but `\n`.

---

## 1. Kind keywords

Each kind has one pattern. The list order matters for ties (see §1.1).

| # | Kind | Pattern (exact) |
|---|---|---|
| 1 | KeepDim | `\bkeep\b.{0,30}\bdim\b\|\bdim(med\|mer\|ly\|ming)?\b\|\bglare\b\|\bno\s+light\b\|\bdon'?t\s+(over)?light\b\|\bnot\s+too\s+bright\b\|\bdarker\b` |
| 2 | WallWash | `\bwash(es\|ed\|ing)?\b\|\bgraz(e\|es\|ed\|ing)\b` |
| 3 | Accent | `\baccent(s\|ed\|ing)?\b\|\bhighlight(s\|ed\|ing)?\b\|\bspot(light\|lit\|lights)?\b\|\bpicture\s+light` |
| 4 | FeaturePendant | `\bpendants?\b\|\bchandeliers?\b\|\bhanging\b` |
| 5 | CeilingGlow | `\bcove(s)?\b\|\bglow(s\|ing)?\b\|\bindirect\b\|\buplight\w*\b\|\bhalo\b\|\bsoffit\s+light` |
| 6 | Path | `\bpath(way\|ways\|s)?\b\|\bwalkways?\b\|\bcirculation\b\|\bwayfinding\b\|\broute\b` |
| 7 | Task | `\btask(s)?\b\|\bwork\s*light\w*\|\bdesk\s+light\w*\|\blight\s+the\s+desks?\b\|\bread(ing)?\b` |
| 8 | Ambient | `\bambient\b\|\bgeneral\b\|\boverall\b\|\bwhole\s+room\b\|\bentire\s+room\b\|\bfill\s+light\w*\|\bbase\s+light\w*` |

(In the table `\|` is a literal regex alternation `|`, escaped only for Markdown.)

### 1.1 `kindsIn(text)`

For each of the 8 patterns, find its **first** match in the text. Collect (match position, kind) for the patterns that
match, sort by position ascending with a **stable** sort (ties keep the table order above), and return the kinds. Each
kind appears at most once. Result: the kinds in the order the phrase names them. Example: "wash and accent the brand
wall" → [WallWash, Accent].

---

## 2. Other phrase patterns (exact)

| Name | Pattern |
|---|---|
| Clause split | `[,;.\n]+\|\s+(?:and\|then\|plus\|also\|but)\s+\|\s*&\s*\|\s*\+\s*` |
| Level | `(\d+(?:\.\d+)?)\s*(fc\|foot[\s-]*candles?\|lux\|lx)\b` |
| Compass | `\b(north[\s-]?east\|north[\s-]?west\|south[\s-]?east\|south[\s-]?west\|north\|south\|east\|west)(?:ern)?\b` |
| Window wall | `\bwindow(s\|ed)?\s+wall\|\bglaz\w*\|\bglass\s+wall\|\bstorefront` |
| Door wall | `\b(entry\|entrance\|door)\s+wall` |
| Long wall | `\blong(est)?\s+wall` |
| All walls | `\bwalls\b\|\ball\s+wall\|\bevery\s+wall` |
| Word | `[a-z]+\|\d+` |

Opening classification (on a wall opening's `kind` string, case-insensitive substring):
- **window opening**: contains `window`, `glaz` or `storefront`.
- **door opening**: contains `door`.

Note: because "." splits clauses, a decimal such as "40.5 fc" in free text is split into "…40" and "5 fc"; the level
pattern's decimal part is therefore only reachable when the interpreter's clause text contains a dot, which it never
does. Keep this behaviour (it is what the reference does).

---

## 3. Tokens, stop words, synonyms

### 3.1 `tokens(text)`
Take every match of the Word pattern (runs of ASCII letters, or runs of digits — separately, so "b2" → "b", "2"), lower-case
it, and **singularise**: if the token is longer than 3 characters, ends in `s`, and does not end in `ss`, drop the final
`s` ("desks" → "desk", "boards" → "board", "glass" stays, "its" stays, "bus" stays). Order is preserved; duplicates kept.

### 3.2 Stop words (exact, compared after singularisation, case-insensitive)

```
the a an of to on in at for with and it its is are be my our this that these those wall light lighting lit room area
zone keep make put add give wash accent highlight task dim dimmed ambient cove glow path pathway pendant general overall
bright brighter more less some all every each entire whole please over above under near by from up down side left right
back front floor ceiling new illuminate spot spotlight feature so too not no dont need want like use set around north
south east west northern southern eastern western northeast northwest southeast southwest window door entry entrance
longest long glare work reading read
```

(The reference list contains "that" and "up" twice; it is a set.)

### 3.3 Synonyms by object kind (exact; keys are `KindOf` values)

| Kind | Words added to the object's token set |
|---|---|
| desk | workstation, desk |
| table | table |
| counter | counter, servery, serving, buffet |
| reception | reception |
| island | island |
| bar | bar |
| artwork | art, artwork, painting, picture, mural, logo, brand |
| display | display, case, showcase |
| signage | sign, signage, menu, board |
| screen | screen, tv, monitor, projector, display |
| mirror | mirror |
| cabinet | rack, cabinet, server |
| seating | sofa, couch, lounge, chair, seating |

### 3.4 Object token set
For room object *o*: `tokens(o.name)` minus stop words, plus `KindOf(o)` itself when non-empty, plus the synonyms for that
kind (if the kind has a row above). Synonyms and the kind are added as-is (not singularised). It is a set.

### 3.5 Name words of a clause
1. Replace every Level-pattern match in the clause with a single space (so "40 fc", "500 lux" vanish).
2. `tokens(...)` of the result.
3. Walk the tokens in order; skip a token that is a stop word; skip a **one-character** token (letter or digit) when it is
   the first token or the token immediately before it (raw, stop word or not) is a stop word. Keep the rest.
4. Result is a set.

Examples: "desk cluster B task" → {desk, cluster, b}. "the a" → {}. "table 1" → {table, 1}. "a b" → {} ("b" follows
the stop word "a"). "don't" → tokens "don", "t" → {don, t} ("t" follows "don", which is not a stop word).

---

## 4. Level

`levelIn(clause)`: take the **first** Level-pattern match. Value = the number. If the unit (group 2) starts with `l` or
`L` (lux, lx), fc = value ÷ **10.7639**; otherwise fc = value. If 0 < fc ≤ 200, return fc rounded to 1 decimal
(round half to even on the binary value; e.g. 500 lux → 46.4517… → **46.5**); otherwise no level.

When a level is present, the intent's target and reason are replaced (both in `forTarget` and in the seed path):
- KeepDim: range = (min null, avg null, max = fc).
- Every other kind: range = (round(fc × 0.7, 1), fc, round(fc × 1.5, 1)). Rounding half-to-even, 1 decimal.
- Reason: `Requested {fc} fc`, where fc is formatted with at most one decimal and no trailing ".0", invariant culture
  (40 → "Requested 40 fc", 46.5 → "Requested 46.5 fc", 15 → "Requested 15 fc").

Examples: 30 → (21, 30, 45); 15 → (10.5, 15, 22.5); 40 → (28, 40, 60).

---

## 5. Wall matching

### 5.1 `wallsNamed(room, text)`
For every Compass-pattern match, in text order:
1. Take group 1 (the compass word without a trailing "ern"). Build the name: first character upper-cased, then the rest
   with all whitespace and hyphens removed, lower-cased. "north" → "North"; "north-east" / "north east" / "northeast" →
   "Northeast"; "Western" → "West".
2. For each wall index *i* ascending: if `WallName(room, i)` starts with `name + " wall"` (case-insensitive), add *i* if
   not already present.

So "north" matches "North wall" and "North wall 2" but not "Northeast wall". "north east" is one compass word
(Northeast), not two.

### 5.2 Walls of a clause (part of `findTargets`)
Build the list in this order, then remove duplicates keeping the first occurrence:
1. `wallsNamed(room, clause)`.
2. If the Window-wall pattern matches: every wall (index order) having at least one window opening.
3. If the Door-wall pattern matches: every wall (index order) having at least one door opening.
4. If the Long-wall pattern matches and the room has walls: the single longest wall (on a tie, the lowest index).
5. Only if the list is still empty and the All-walls pattern matches: let *open* = walls with length ≥ 6 ft (index
   order), *plain* = those of *open* with no window opening; add the first 4 of *plain*, or the first 4 of *open* if
   *plain* is empty.

---

## 6. Object matching and scoring (part of `findTargets`)

Inputs: room, clause, a kind list (may be empty).

**Acceptance filter** for an object *o* with `k = KindOf(o)`: with an empty kind list every object is accepted.
Otherwise *o* is accepted if **any** kind in the list accepts it:

| Kind in list | Accepts *o* when |
|---|---|
| Task, FeaturePendant | k ∈ SurfaceKinds |
| WallWash | k ∈ FaceKinds |
| Accent | k ∈ FaceKinds, or k ∈ SurfaceKinds, or *o* has a top height |
| Ambient, CeilingGlow, Path, KeepDim | always |

**Scoring**: if the clause's name-word set is empty, no objects. Otherwise, for each object in index order that passes
the filter, score = number of name words contained in the object's token set. Keep objects with score > 0. The result
is **all** objects whose score equals the maximum score, in index order (no count limit here).

### 6.1 `findTargets(room, clause, kinds)` → { walls, objects, level }
walls per §5.2, objects per §6, level per §4. The targets are **"any"** when walls or objects is non-empty (a level alone
is not a target).

---

## 7. `interpret(room, text)`

Returns an ordered list of intents. Returns `[]` when the text is empty/whitespace or the room has no floor loop.

1. **Split.** Walk the Clause-split matches left to right. Each piece is the text between the previous match end and the
   current match start, **trimmed**, paired with the matched separator text; the final piece (after the last match)
   has an empty separator. Drop pieces whose trimmed text is empty (their separators are dropped with them).
2. **Merge.** "wash and accent the brand wall" splits at "and"; a clause that only names kinds joins the clause that
   names the target. For piece *i*, start `clause = piece[i].text`; then **repeat while all hold**:
   - there is a next piece;
   - `kindsIn(clause)` is non-empty and every kind in it is one of WallWash, Accent, KeepDim, Task, FeaturePendant
     ("needs a target");
   - `findTargets(room, clause, [])` is not "any";
   - the separator of the current piece (the last one absorbed) contains none of `,` `;` `.` newline;
   - `findTargets(room, nextPiece.text, [])` is "any";
   then `clause = clause + " " + nextPiece.text` and advance to that piece. Emit `clause` and continue after the last
   absorbed piece.
3. **Read each merged clause** in order, with `last` = the kind list of the previous **used** clause (initially empty)
   and a set of seen keys:
   1. `kinds = kindsIn(clause)`.
   2. If empty: `probe = findTargets(room, clause, last)`. If probe is not "any", skip the clause (and `last` is unchanged).
      Otherwise `kinds = last` if `last` is non-empty, else `defaultKinds(room, probe)`. If still empty, skip.
   3. `targets = findTargets(room, clause, kinds)`.
   4. For each kind in `kinds` (in order), for each intent from `forTarget(room, kind, targets.walls, targets.objects,
      targets.level)` (in order): compute its key; if unseen, append it.
   5. `last = kinds`.

**Key** (duplicate suppression): `kind | wallIndex | objectIndex | round(cx) | round(cy)` where (cx, cy) is the plain
mean of the region's vertices ((0,0) for an empty region), rounding half-to-even to an integer, and a missing index is
an empty field. Two intents with equal keys are the same; only the first is kept. ("wash the north wall, wash the north
wall" gives one intent.)

**`defaultKinds(room, targets)`** (a clause naming a target but no kind, with no previous kind):
- If there are objects, look only at the **first** object's kind *k*: k ∈ FaceKinds and k ≠ "screen" → [Accent];
  k = "screen" → [KeepDim]; k ∈ SurfaceKinds → [Task]; otherwise [] (clause skipped).
- Else if there are walls → [WallWash].
- Else [].

There is no overall limit on the number of intents `interpret` returns (each `forTarget` call is limited to 6).

---

## 8. `forTarget(room, kind, walls, objects, level?)` — the funnel

Returns `[]` when the room has no floor loop or its first loop has fewer than 3 points.

Let `ambientAvg = Target(room, Ambient, none, none).range.avg` (the room's default ambient average).

**Make(region, wall, obj)** builds one new intent:
- `id`: fresh random id (8 hex characters in the reference).
- `kind`: the kind.
- `target, targetReason`: `Target(room, kind, obj, ambientAvg)`; then the level override of §4 if a level was given.
- `label`: `Label(room, kind, region, wall, obj)`; `labelSuggested = true`.
- `region`: a copy of the given points; `wallIndex = wall`; `objectIndex = obj`.
- `plane`: `Infer(room, kind, region, wall, obj)`.
- `isSuggestion = false`, `handTuned = false`, default behaviour, no product, no fixtures, empty trace.

**FromSeeds(kind, level)** ("task" or "keep dim" with nothing named): take `Seed(room)`, keep those of this kind, first 6;
for each make a **new** intent (fresh id, `isSuggestion = false`, `labelSuggested = true`) copying the seed's kind,
label, region, wallIndex, objectIndex, plane, target and targetReason — with the §4 level override applied to
target/reason when a level was given.

`hasTarget` = walls or objects non-empty.

| Kind | Behaviour |
|---|---|
| **Ambient** | One intent. Region = the first floor loop when no objects; otherwise the bounding rectangle of all named objects' footprints padded by **4 ft** on every side and clipped to the room bounds (`Rect`). wall = none, obj = none. Walls are ignored. |
| **Task**, **FeaturePendant** | If no objects → FromSeeds (walls alone do not count). Otherwise take the clusters from `Clusters(room)` (their own order) that contain at least one named object, first 6. Per cluster: obj = its only object if it has one; otherwise the first object of the *named-objects list* (in that list's order) that the cluster contains. Region: Task → the cluster's region; FeaturePendant → the object's footprint when the cluster has one object, else the cluster region inflated by **−1.5 ft** (i.e. shrunk back to the objects' bounding rectangle). wall = none. Objects that belong to no surface cluster yield nothing (if none qualifies the result is empty, not seeds). |
| **WallWash** | Build *picked* runs: first, for each named object (in order) whose kind ∈ FaceKinds, `w = WallFor(room, WallWash, [], none, o)`; if a wall is found add (w, o, RunBehind(w, o)). Then for each named wall not already used by a picked run, add (w, none, [wall.start, wall.end]). If nothing was picked: when `hasTarget` return `[]`; else FromSeeds, and if that is empty, DefaultWash. Otherwise Make(run, w, o) for the first 6 picked. |
| **Accent** | First 6 named objects; none → FromSeeds. Each → Make([FaceMidpoint(o)], none, o). Walls ignored. |
| **KeepDim** | Each of the first 6 named objects → Make(KeepDimRegion(o), none, o). If there are no objects: each of the first 6 named walls → Make([start, end, end + inward·3, start + inward·3], **none**, none) (a 3 ft band along the wall; wall index is *not* set); if there are no walls either → FromSeeds. |
| **CeilingGlow** | zones = non-main ceiling zones with at least one loop; raised = those with height > room ceiling height + 0.5. Use raised if any, else all zones; first 6; each → Make(zone's first loop, none, none). No zones → `[]` (no seeds fallback). Walls/objects ignored. |
| **Path** | If PathBand exists → one Make(band, none, none); else `[]`. Walls/objects ignored. |

**RunBehind(w, o)** — the stretch of wall a hung object covers, a foot either side: d = wall direction (unit
start→end), L = wall length. Project each footprint corner onto d from wall start → t values. t0 = max(0, min t − 1),
t1 = min(L, max t + 1). If t1 − t0 < 3 or t1 − t0 > 0.9·L, use t0 = 0, t1 = L. Run = [start + d·t0, start + d·t1].

**DefaultWash**: no walls → `[]`. Pool = walls with no window opening, or all walls if none. Pick the longest (lowest
index on a tie). One Make([start, end], w, none).

**KeepDimRegion(o)** — a zone in front of a screen, along its long side, 5 ft deep: if `WallFor(room, KeepDim, [], none,
o)` gives a wall, inward = that wall's inward normal; else inward = unit(floor-loop centroid − o.center) (o.center when
there is no floor). u = Heading(o.orientation); if o.length < o.width, u = Perp(u). half = max(length, width)/2 + 0.5.
a = center − u·half, b = center + u·half. Region = [a, b, b + inward·5, a + inward·5].

**PathBand** — a 4 ft band along the room's longer axis, centred across it: bounds (lo, hi) of the floor; w = hi.x − lo.x,
h = hi.y − lo.y. If w < 6 or h < 6 → none. mid = bounds centre. If w ≥ h: Rect((lo.x+2, mid.y−2), (hi.x−2, mid.y+2));
else Rect((mid.x−2, lo.y+2), (mid.x+2, hi.y−2)).

---

## 9. User-visible strings produced here

Only `Requested {fc} fc` (§4). All labels, default reasons and plane reasons come from the defaults/workplane specs
(e.g. "Brand wall wash", "Screen — keep dim", "Keep-dim zone", "Wall wash, 15–45 fc vertical").

---

## 10. Golden data (`golden/<Room>.json` → `interpret`)

Each entry is `{text, intents[]}`; intents carry `index` (order), kind, label, region, wallIndex, objectIndex, target,
targetReason, plane, behavior, isSuggestion false. In this section region points carry an extra `length` field (the
point's distance from origin — a serialisation artefact; ignore it) and `plane.kind` is numeric: **0 = horizontal,
1 = vertical, 2 = ceiling**. Compare kind, label, wall/object index, target, reason, plane exactly; coordinates to 1e-6.

| Room | Text | Expected (in order) |
|---|---|---|
| Office | wash the north wall | WallWash "Brand wall wash", wall 2, obj none, region [(36,24),(0,24)], 15/25/45 "Wall wash, 15–45 fc vertical", vertical 2–8 "North wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)" |
| Office | keep the screen dim | KeepDim "Screen — keep dim", obj 7, region [(35.85,14),(35.85,20),(30.85,20),(30.85,14)], max 5 "Keep dim: nothing brighter than 5 fc", horizontal 2.5 "Work plane, 2′-6″ · open office" |
| Office | task light on the desks | 3 × Task: "Desk cluster A task" obj 0 region (2,9.75)–(16,15.75); "Desk cluster B task" obj 1 (2,2.75)–(16,8.75); "Desk cluster C task" obj 2 (17,2.75)–(27,8.75); each 20/30/50 "Office desk task, IES 20–50 fc", horizontal 2.5 "Desk top, 2′-6″, from Desk cluster X" |
| Office | accent the artwork at 40 fc | Accent "Brand wall accent" obj 6, region [(10,23.75)], 28/40/60 "Requested 40 fc", vertical 3–7 "Brand wall face, 3′-0″ to 7′-0″" |
| Office | ambient 30 fc | Ambient "Open office ambient", region = floor [(0,0),(36,0),(36,24),(0,24)], 21/30/45 "Requested 30 fc", horizontal 2.5 "Work plane, 2′-6″ · open office" |
| Office | glow in the ceiling | (none — the office has no non-main ceiling zone) |
| Office | pendants over the table | FeaturePendant "Meeting table pendants" obj 3, region (24,15)–(32,19), 15/25/40 "Feature pendants over a table, 15–40 fc", horizontal 2.5 "Table top, 2′-6″, under Meeting table" |
| Cafeteria | pendants over the tables | FeaturePendant "Table pendants" obj 2 (Table 1), region (9.2,3.7)–(40.8,22.3), 15/25/40, horizontal 2.5 "Table top, 2′-6″, under Table 1" |
| Cafeteria | wash the east wall | WallWash "East wall wash" wall 1, region [(48,0),(48,32)], 15/25/45, vertical 2–9 "East wall, 2′-0″ to 9′-0″ (clear of the base and the ceiling edge)" |
| Cafeteria | task light on the counter | Task "Servery counter task" obj 0, region (2.5,25.5)–(31.5,31.5), 25/40/60 "Servery counter, 25–60 fc", horizontal 3 "Counter top, 3′-0″, from Servery counter" |
| Cafeteria | keep it dim near the screen | (none — no screen object, no wall named, no keep-dim seed) |
| Cafeteria | general light 15 fc | Ambient "Cafeteria ambient", floor region (0,0)–(48,32), 10.5/15/22.5 "Requested 15 fc", horizontal 2.5 "Table height, 2′-6″ · cafeteria dining" |
| Lobby | accent the signage | Accent "Feature wall accent" obj 5, region [(20,27.75)], avg 30 only, "3× the surrounding ambient (10 fc)", vertical 3–8 "Feature wall face, 3′-0″ to 8′-0″" (no object matches "signage" → from the accent seed) |
| Lobby | path to the entry | Path "Entry path", region (2,12)–(38,16), 1/3/10 "Path of travel, 1–10 fc", horizontal 0 "Floor level · path of travel" |
| Lobby | wash the south wall | WallWash "South wall wash" wall 0, region [(0,0),(40,0)], 15/25/45, vertical 2–8 "South wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)" |
| Lobby | pendants over the reception desk | FeaturePendant "Reception desk pendants" obj 0, region (14,15.5)–(26,19), 15/25/40, horizontal 3 "Reception top, 3′-0″, under Reception desk" |
| Lobby | cove glow | 2 × CeilingGlow "Soffit glow", 5/10/20 "Ceiling glow, 5–20 fc on the ceiling": region (6,21)–(34,28) ceiling 10 "Soffit at 10′-0″, facing down"; region (15,0)–(25,5) ceiling 9 "Soffit at 9′-0″, facing down" (both zones are lower than the 14 ft main ceiling, so all zones are used) |
| DataHall | task lighting in the aisles | 3 × Task from seeds: "Aisle 1 task" (6,20)–(34,24), "Aisle 2 task" (6,14)–(34,18), "Aisle 3 task" (6,8)–(34,12); obj none; 20/30/50 "Data hall cold aisle, 20–50 fc on the floor"; horizontal 0 "Floor level · aisle" |
| DataHall | ambient 30 fc | Ambient "Data hall ambient", floor (0,0)–(40,30), 21/30/45 "Requested 30 fc", horizontal 0 "Floor level · data hall circulation" |
| DataHall | keep the north wall dim | KeepDim "Keep-dim zone", wall none, obj none, region [(40,30),(0,30),(0,27),(40,27)], max 5 "Keep dim: nothing brighter than 5 fc", horizontal 0 "Floor level · data hall circulation" |

Rectangles written "(x0,y0)–(x1,y1)" are the 4 points (x0,y0),(x1,y0),(x1,y1),(x0,y1) in that order.

---

## Test cases

Rooms are the four demo rooms (demo-rooms spec). "index of X" means the index of the object named X. Office walls:
0 South (window), 1 East, 2 North, 3 West (door); north wall at y = 24.

### Interpreter (from the reference AI tests)

| Name | Room | Input | Expected |
|---|---|---|---|
| wash brand wall + keep screen dim | Office | "wash the brand wall, keep the screen dim" | exactly 2 intents; the WallWash has objectIndex = index of "Brand wall", wallIndex = 2, plane vertical, region has 2 points; the KeepDim has objectIndex = index of "Screen", target.avg null, target.max 5; all have isSuggestion false and a non-empty label |
| compass: north | Office | "wash the north wall" | exactly 1 intent, wallIndex 2, every region point has y = 24 (±1e-9) |
| compass: south | Office | "wash the south wall" | exactly 1 intent, wallIndex 0 |
| compass: east and west | Office | "wash the east and west walls" | wall indexes, as a multiset, = {1, 3} |
| footcandle request | Office | "wash the north wall to 40 fc" | exactly 1 intent; target.avg 40; targetReason contains "40" |
| lux request | Office | "wash the north wall at 500 lux" | exactly 1 intent; target.avg 46.5 |
| desks by kind | Office | "task light on the desks" | ≥ 2 intents; all Task with plane height exactly 2.5 |
| desk by letter | Office | "desk cluster B task" | exactly 1 intent; objectIndex = index of "Desk cluster B" |
| pendants by name | Office | "meeting table pendants" | exactly 1; kind FeaturePendant; objectIndex = index of "Meeting table" |
| accent by synonym | Office | "accent the artwork" | exactly 1; kind Accent; objectIndex = index of "Brand wall"; plane vertical |
| counter synonym | Cafeteria | "servery task" | exactly 1; kind Task; objectIndex = index of "Servery counter"; plane height 3 (±1e-9) |
| plural name tokens | Cafeteria | "accent the menu boards" | exactly 1; objectIndex = index of "Menu boards" |
| cove follows the cloud | Cafeteria | "add a cove glow" | exactly 1; kind CeilingGlow; plane ceiling; plane height 12 (±1e-9); region equals (point for point) the first loop of the single non-main ceiling zone |
| room-wide ambient | Office | "general ambient light" | exactly 1; kind Ambient; region area = floor[0] area (±1e-6) |
| path band | Lobby | "light the path" | exactly 1; kind Path; plane height 0 (±1e-9); min(bounds width, bounds height) of region = 4 (±1e-9) |
| kind joins following target | Office | "wash and accent the brand wall" | kinds as a multiset = {WallWash, Accent}; every intent's objectIndex = index of "Brand wall" |
| empty text | Office | "" | 0 intents |
| unreadable text | Office | "hello there, how are you?" | 0 intents |
| no duplicates | Office | "wash the north wall, wash the north wall" | exactly 1 intent |

### Golden phrases
Every row of the §10 table is a test case (exact match against `golden/<Room>.json` → `interpret`).

### Additional derived cases (consequences of the rules above; recommended)

| Name | Input | Expected |
|---|---|---|
| kindsIn order | "accent and wash" | [Accent, WallWash] |
| kindsIn tie order | text where two patterns first match at the same position | table order (KeepDim before WallWash before … Ambient) |
| singularise | tokens("desks glass its tables") | desk, glass, its, table |
| lone letter after stop word | name words of "a b" | {} |
| lone letter after word | name words of "cluster b" | {cluster, b} |
| level stripped from names | name words of "ambient 30 fc" | {} |
| level out of range | "ambient 0 fc", "ambient 250 fc" | no level (default target) |
| compound compass | wallsNamed(Office, "north east") | [] (looks for "Northeast wall") |
| "-ern" suffix | wallsNamed(Office, "the western wall") | [3] |
| codec-only level path | forTarget(Office, KeepDim, [], [Screen], 4) | one intent, target (null, null, 4), reason "Requested 4 fc" |

No interpreter test depends on excluded behaviour; none are dropped.

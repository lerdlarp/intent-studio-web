# Solver — `solver.ts` (part 1: orchestration, count search, lumen packages, balancing, keep-dim, trace)

Part 2, **solver-layouts.md**, holds the per-kind layout generators (area grid/staggered/rows/perimeter/path, wash,
accent, pendant, cove glow), mounting, settling (collision/keep-dim filtering), ceiling-grid snapping and the keep-dim
relocation helpers. Read both.

The solver places fixtures for accepted intents. Fixtures are never dimmed: every placed fixture has `output = 1`. A
target is met by a discrete choice: the number of fixtures, and (for agent-picked or unchosen products) the lumen
package of the product family. The solver is deterministic: the same design gives the same layout.

Depends on: estimate.md (`Estimate(design, intent)` — the per-intent estimate computed from **every** fixture of every
non-suggestion intent currently in the design; `EstimateAll`; `LightLossFactor = 0.85`), products.md (`ProductOf`,
`For`, `PackagesOf`, `ByFamily`, the per-intent *settled package* memory `RememberPackage`, product `key`, `isGeneric`),
zones.md (`Shape` of a vertical plane), geometry.md, workplane.md, defaults.md (`WallName`, `FeetInches`).

Notation: `Avg(i)` = `Estimate(design, i).average` with the design's fixtures as they are at that moment.
"round½even" = banker's rounding (C# `Math.Round`). `clamp(x, lo, hi)` = min(max(x, lo), hi).
`ceil`/`floor` produce integers. Stable sorts keep ties in incoming order.

---

## 1. Constants

| Name | Value | Use |
|---|---|---|
| `MaxFixtures` | 300 | upper bound on any layout count; trace "300 fixtures limits the count" |
| `MaxKeepDimMoves` | 3 | removals + moves per keep-dim zone, accumulated over a whole SolveAll |
| `FloorFactor` | 0.02 | lowest spacing factor |
| `CeilingFactor` | 20 | highest spacing factor |
| `MaxAlternatives` | 8 | product alternatives kept after package stepping |
| Solve order | KeepDim, Task, Path, WallWash, FeaturePendant, CeilingGlow, Ambient, Accent | |
| Search iterations | 6 | multiplicative factor iterations |
| Search ratio clamp | [0.2, 5] | per-iteration factor multiplier |
| Search convergence | `|next/f − 1| < 0.015` | stop |
| Over-lit test | best avg > want × 1.1 | evaluate the floor factor |
| Neighbour skip | `|best avg − want| < 0.04 × want` | skip neighbour probing |
| Neighbour step | ×1.05 / ÷1.05 (`1.05^±1`) | 2 fresh candidates each way, ≤ 24 steps each way |
| Package "good" | penalty = 0 and close ≤ 0.2 | stop stepping |
| Excess allowance | 1.02 × max | |
| Shortfall allowance | 0.98 × min (min defaults to 0.9 × average) | |
| Lean want | floor × 1.06 (floor = min, else 0.9 × average) | |
| Relieve over test | avg > max × 1.03 | |
| Relieve contributor test | contributor avg > leanWant × 1.08 | |
| Relieve accept | after ≤ max × 1.02, or reduction ≥ 25 % of (baseline − max) | |
| Relieve passes | 12 | |
| Rebalance rounds | 3 | |
| Keep-dim passes | 3 (+1 final) | |
| Keep-dim reach | 30 ft | victims must be ≤ 30 ft from the zone |
| Keep-dim default max | 5 fc | when the keep-dim has no maximum |
| Pinned clearance | 1.5 ft | new fixtures stay ≥ 1.5 ft from pinned ones |
| LLF | 0.85 | lumen method and trace text |

---

## 2. Number formatting (exact rules for every trace string)

The original formats doubles with .NET custom numeric formats. Reproduce them with a helper, not with `toFixed`:

**Step A (all formats on doubles):** take the value's decimal digits rounded **correctly to 15 significant digits**
(the digits of JS `x.toPrecision(15)`). **Step B:** round that decimal digit string to the format's number of
decimals, **half away from zero** on the digit string (a 5 or more in the first dropped digit rounds the magnitude up).
So 0.15 (binary 0.14999…) prints as "0.2" under `0.#` (JS `toFixed(1)` would give "0.1"), and 2.675 prints "2.68" under `0.##`.
A negative value that rounds to zero keeps its sign ("-0"); this does not arise for the values below in practice.
No thousands separator unless stated. Decimal point is ".".

| Code used below | .NET format | Rule after A+B |
|---|---|---|
| **F1** | `0.#` | at most 1 decimal; drop a trailing zero decimal and the point ("24.7", "11", "0.5") |
| **F2** | `0.##` | at most 2 decimals; drop trailing zeros ("25.25", "3", "2.5") |
| **D0** | `0` | integer ("74" for 74.1, "864" for 864) |
| **D1** | `0.0` | exactly 1 decimal ("4.0", "2.3") |
| **D2** | `0.00` | exactly 2 decimals ("0.64", "0.60") |
| **G0** | `#,0` | integer with "," every 3 digits ("1,500", "600", "10,000") |
| **I** | plain integer | ints (counts) print as-is |

`Lm(p)` = `G0(p.lumens) + " lm"` (e.g. "1,500 lm").

Plural helper: `s(n)` = "" when n = 1, else "s".

---

## 3. Shared definitions

- **HasTarget(i)** = `target.average` present, or both `target.minimum` and `target.maximum` present.
- **Want(i)** (the average a fit aims at):
  1. if the current SolveAll session has a *lean* value for i → that value;
  2. else `average` if present;
  3. else if min and max present → (min + max) / 2;
  4. else min, else max, else 20.
- **LeanWant(i)**: floor = `minimum` if present, else `0.9 × average` if average present, else none. Returns `floor × 1.06` or none.
- **Excess(t, avg)** = `(avg − max)/max` when max present and `avg > max × 1.02`, else 0.
- **Shortfall(t, avg)**: floor = min, else 0.9 × average, else none. `(floor − avg)/floor` when `avg < floor × 0.98`, else 0.
- **IsHandTuned(i)** = `i.handTuned` and `i.fixtures` non-empty.
- **Signature(list)** = `count + ":" + join(";", F2(x) + "," + F2(y) for each fixture centre, in list order)`.
  Example: `2:25.25,15.25;25.25,18.75`. Used to detect "same layout" — equality of these strings is what counts.
- **Product of the intent**: products.md `ProductOf(room, intent)` = the intent's chosen product, else its settled
  package (remembered per intent object, persists across solves), else `For(kind, room)`.
- **Product flags** (of the current product p):
  - `IsPendant` = regex `pendant|suspend|chain|stem` (case-insensitive, unanchored) matches `p.family + " " + p.label`, or `p.family = "strip"`.
  - `IsCove` = `p.family = "cove"` or regex `\bcove\b` (case-insensitive) matches `p.label`.
  - `IsLinear` = `p.length ≥ 3` and `p.length ≥ 3 × p.width`.
- **Context** for one intent (`MakeCtx`): product = ProductOf; **keeps** = every *other* intent in the design that is
  KeepDim, not a suggestion and has a region of ≥ 3 points, each with its margin `KeepDimMargin(ctx, keep)`
  (solver-layouts.md §8, computed with **this** intent's product beam); **keep zones** = `Inflate(keep.region, margin)` for each.
  `Density` = the fit density override when set, else `clamp(behavior.density, 0.6, 1.6)`.

---

## 4. Entry points

### 4.1 Solve(design, intent) — one intent

1. `fit = Place(design, intent, startFactor 1, previous none, fresh false)`.
2. `WriteTrace(design, intent, fit)` (§9).
3. If the intent is not a suggestion: `EnforceKeepDim(design)` with its own log, which is flushed at the end (§8).
4. Return `{ estimate: Estimate(design, intent), trace: intent.trace }`.

There is no SolveAll session here (no leans, no notes) unless Solve is called inside one. Solve does **not** skip a
hand-tuned intent: it re-lays it around its pinned fixtures.

### 4.2 SolveAll(design)

Runs inside a fresh **session** holding `lean: Map<intent, number>` and `notes: Map<intent, string[]>`; restore any outer
session afterwards (nesting-safe).

1. `active` = non-suggestion intents in design order.
2. Every suggestion: fixtures = [], trace = [`{label}: a suggestion; it places nothing until you accept it.`].
3. `fits` = map intent → Fit or none.
4. **First pass**: for each kind in the solve order, for each active intent of that kind (design order):
   skip hand-tuned intents; for an Accent call `FollowAmbient(design, accent)` first (§7.3);
   `fits[intent] = Place(design, intent, 1, none, fresh true)`.
5. `Rebalance(design, active, fits, frozen = ∅)` (§7.1).
6. `Relieve(design, active, fits)` (§7.2).
7. Keep-dim loop with one shared log and `frozen = ∅`: repeat up to 3 times: `touched = EnforceKeepDim(design, log)`;
   if touched is empty stop; `frozen ∪= touched`; `Rebalance(design, active, fits, frozen)`.
8. `EnforceKeepDim(design, log)` once more (result ignored).
9. For each active intent (design order): hand-tuned → trace = [`{label}: hand-tuned by you, kept as is.`];
   else `WriteTrace(design, intent, fits[intent] or none)`.
10. `log.Flush(design)` (§8.2).

### 4.3 Place(design, intent, startFactor, previous, fresh) → Fit or none

1. Suggestion or KeepDim: fixtures = [], return none.
2. `pinned` = the intent's current fixtures with `pinned = true` (order kept).
3. If `Packages(design, intent)` is a list and HasTarget(intent): return `PlacePackaged(...)` (§6).
4. Else return `Search(MakeCtx(design, intent), pinned, startFactor)` (§5).

**Fit** record: `{ how: string, notes: string, minCount: int, factor: number, package: string|none, packageKey: string|none }`.

---

## 5. Count search — Search(ctx, pinned, startFactor)

The spacing **factor** scales the lumen-method count (area intents), the run density (wash), the accent count, the
pendant count, and the cove module share. Larger factor → more fixtures.

1. `customDensity` = `|clamp(behavior.density, 0.6, 1.6) − 1| > 1e-9`.
   `fitted` = HasTarget(intent) and `behavior.quantity` is none.
   Fit-density override = 1.0 when customDensity and fitted, else none.
2. **Build(factor)**:
   a. `(raw, how) = Layout(ctx, factor, pinned)` (solver-layouts.md §1).
   b. `placed, notes = Settle(ctx, raw, pinned)` (solver-layouts.md §7).
   c. If `placed` is empty and `pinned` is empty and `raw` is non-empty: `placed = Anchor(ctx, raw, pinned, notes)`
      (solver-layouts.md §9, which may rewrite notes).
   d. Candidate `{ placed, how, notes, factor, total = |pinned| + |placed|, avg }`.
3. **Not fitted** (no target, or a fixed quantity): `only = Build(1)`; intent.fixtures = pinned ++ only.placed;
   return Fit(only.how, only.notes, minCount 0, factor 1). (Density applies through ctx.Density since the override is none.)
4. `want = Want(intent)`. Set intent.fixtures = pinned; `rest = Avg(intent)` (light from pinned fixtures and all other intents).
5. `seen` = insertion-ordered map Signature(placed) → candidate.
   **Eval(factor)** → (cand, fresh): build; if its signature is already in `seen` return (that earlier candidate, false)
   (fixtures are **not** changed); else set intent.fixtures = pinned ++ placed, `cand.avg = Avg(intent)`, store, return (cand, true).
6. **Multiplicative iteration**: `f = clamp(startFactor, 0.02, 20)`. For it = 0..5:
   - `(cand, fresh) = Eval(f)`; if not fresh and it > 0 → stop.
   - `mine = cand.avg − rest`.
   - next = 0.02 if `want ≤ rest + 1e-6`; else `f × 2` if `mine < 1e-6`; else `f × clamp((want − rest) / mine, 0.2, 5)`.
   - next = clamp(next, 0.02, 20). If `|next / f − 1| < 0.015` → stop. Else f = next.
7. `Score(c) = |c.avg − want| / max(want, 1e-6) + 1e-4 × c.total`.
   `Best()` = the candidate in `seen` with the lowest Score, ties → lower total, remaining ties → earliest inserted.
8. **Over-lit**: minCount = 0. If `Best().avg > want × 1.1`: `(floorCand, _) = Eval(0.02)`; minCount = floorCand.total
   (an already-seen candidate's total counts too).
9. **Neighbours**: `atFewest` = minCount > 0 and Best().total ≤ minCount. `center = Best().factor`.
   Unless `atFewest` or `|Best().avg − want| < 0.04 × want`, for direction +1 then −1:
   g = center; tried = 0; step = 0; while tried < 2 and step < 24: `g = clamp(g × 1.05^direction, 0.02, 20)` (repeated
   multiplication of the running g, i.e. ×1.05 or ×(1/1.05)); if Eval(g) is fresh, tried += 1; step += 1.
10. `best = Best()`. If customDensity: clear the fit-density override and `best = Build(best.factor)` (re-laid with the
    designer's density; not estimated).
11. intent.fixtures = pinned ++ best.placed. Return Fit(best.how, best.notes, minCount, best.factor).

Floating-point note: `g` must be the running product (g×1.05×1.05…), not center×1.05^k; `1.05^-1` is the correctly
rounded value of 1/1.05.

---

## 6. Lumen packages

### 6.1 Packages(design, intent)

- If the intent has a product choice that is **not** agent-picked (`agentPicked = false`, designer chose it) → none.
- Else `pk = PackagesOf(ProductOf(room, intent))` (products.md: the generic family's packages ascending by lumens, or the
  demo-project family; empty for a real catalog product). Return pk when it has more than 1 entry, else none.

### 6.2 Use(intent, package, reason = "", alternatives = none)

- Intent has no product choice → `RememberPackage(intent, package)` (settled package; the intent's product stays none, so
  the agent may still pick a real product later). The reason is discarded.
- Else replace the choice with `{ product: package, agentPicked: true, reason: reason if non-empty else the old reason,
  alternatives: alternatives if given else the old alternatives }`.

### 6.3 PlacePackaged(design, intent, pinned, startFactor, packages, previous, fresh)

1. `current = ProductOf(room, intent)`; `nominal = ByFamily(current.family)` (the family's nominal generic).
2. startIndex: if fresh and nominal exists → index of the first package with `|lumens − nominal.lumens| < 0.5`; else
   index of the first package whose key equals `current.key`; −1 (not found) becomes 0.
3. `want = Want(intent)`. `tried` = map index → Tried.
4. **Eval(index)** (memoised by index):
   - `Use(intent, packages[index])`.
   - `fit = Search(MakeCtx(design, intent), pinned, startFactor if index = startIndex else 1)`.
   - `avg = Avg(intent)`; fixtures = copy of intent.fixtures; count = their number.
   - `penalty = 10 × min(Excess(target, avg), 1) + Shortfall(target, avg)`;
     `close = |avg − want| / max(want, 1e-6)`; `good = (penalty = 0 and close ≤ 0.2)`;
     `score = penalty + close + 1e-4 × count`.
5. `first = Eval(startIndex)`; `best = first`.
6. If not first.good: `step = −1` when `first.avg > want` else `+1`. For i = startIndex + step, while 0 ≤ i < count, i += step:
   `t = Eval(i)`; if `t.score ≥ best.score − 1e-9` and not t.good → stop; if `t.score < best.score` → best = t; if t.good → stop.
7. Alternatives = packages whose key ≠ best key (ascending), then the intent's current choice's alternatives (if it has a
   choice) whose key ≠ best key and not among the packages; take the first 8.
8. `source` = "Generic stand-in" when best package isGeneric else "In your project".
   `Use(intent, best.package, "{source} · the {Lm(best)} package: the one whose fixture count lands closest to the target", alternatives)`.
   intent.fixtures = best.fixtures.
9. Package note: if best is not first → `StepNote(intent, first, best, want)`; else if `previous.packageKey = best key` →
   `previous.package` (carry the earlier note, possibly none); else none.
10. Return best.fit with package = note, packageKey = best key.

### 6.4 StepNote(intent, from = first, to = best, want)

`down` = to.lumens < from.lumens. `why`:
- not down: `{Lm(from)} falls short at {F1(from.avg)} fc against {F1(want)} fc`
- down and max present and `from.avg > max × 1.02`:
  - when `from.fit.minCount > 0` and `from.count ≤ from.fit.minCount`: `{Lm(from)} overshoots {F1(max)} fc at the fewest fixtures`
  - else: `{Lm(from)} overshoots {F1(max)} fc`
- otherwise: `{Lm(from)} gives {F1(from.avg)} fc against {F1(want)} fc`

Note line: `{label}: Stepped {down|up} to {Lm(to)}: {why}.` — `from` is always the **starting** package, not the
previously tried one (golden: "Stepped down to 1,500 lm: 3,000 lm overshoots 35 fc at the fewest fixtures." after 2,000 was tried in between).

---

## 7. Balancing

### 7.1 Rebalance(design, active, fits, frozen)

Up to 3 rounds; each round:
1. `FollowAmbient` for every active Accent (design order; includes hand-tuned accents — it only changes targets).
2. changed = false. For each kind in solve order, each active intent of that kind (design order): skip KeepDim, hand-tuned,
   frozen, intents with no Fit (missing or none), and intents whose fixtures are non-empty and all pinned.
   `before = Signature(fixtures)`; `fits[i] = Place(design, i, fits[i].factor, fits[i], fresh false)`; changed if the
   signature differs.
3. Stop when nothing changed.

### 7.2 Relieve(design, active, fits) — lean contributors when an intent is over its maximum

Only inside a SolveAll session. `refused` = set of (over, contributor) pairs. Up to 12 passes:
1. `est = EstimateAll(design)` (one estimate per non-suggestion intent).
2. `over` = active intents with a maximum and `est.avg > max × 1.03`, stable-sorted by `avg / max` descending.
3. moved = false. For each x in over:
   - `baseline = est[x].avg`, `max = x.max`. best = none, bestDelta = 0.
   - For each y in active (design order): skip if y = x, (x, y) refused, y already leans, or not CanLean(y);
     skip if LeanWant(y) is none, or y has no estimate, or `est[y].avg ≤ LeanWant(y) × 1.08`.
     Temporarily set y.fixtures = its pinned fixtures only; `without = Avg(x)`; restore. If `baseline − without > bestDelta`
     → best = y, bestDelta = that.
   - No best → next x.
   - Save best's fixtures, its product choice (may be none), `ProductOf(best)`, and its Fit.
     Set `lean[best] = LeanWant(best)`; `fits[best] = Place(design, best, savedFit.factor, savedFit, fresh false)`; `after = Avg(x)`.
   - If `after ≤ max × 1.02` or `baseline − after ≥ 0.25 × (baseline − max)`: add notes
     - to best: `{best.label}: leans to the bottom of its range ({F1(lean)} fc) because its light puts {x.label} over its {F1(max)} fc maximum, and fixtures cannot be dimmed.`
     - to x: `{x.label}: {best.label} gives up light here ({F1(baseline)} fc → {F1(after)} fc) to keep it under {F1(max)} fc.`
     moved = true; break out of the x loop.
   - Else undo: remove the lean, restore fixtures, restore the product (no saved choice → `RememberPackage(best, saved ProductOf)`;
     else restore the choice), restore the Fit, add (x, best) to refused; moved = true; break.
4. Stop when nothing moved.

A lean lasts for the rest of the SolveAll: every later Place of that intent (Rebalance, trace) uses the lean as its Want.

**CanLean(y)**: kind not KeepDim and not Accent; not a suggestion; not hand-tuned; has fixtures; not all of them pinned;
HasTarget; has a non-none Fit.

### 7.3 FollowAmbient(design, accent) — accents follow 3× ambient

1. Only when the accent's target reason starts with `3×` or contains `no surrounding ambient` (ordinal, case-sensitive;
   `×` is U+00D7). Otherwise do nothing (a designer-typed target is kept).
2. `at` = accent.region[0] or (0,0).
3. `ambients` = design intents (design order) of kind Ambient, not suggestions, with fixtures.
   `around` = the first whose region has ≥ 3 points and contains `at`; else the first ambient; none → return.
4. `avg = Avg(around)`; if `avg ≤ 0.5` return.
5. target = (min none, average = round½even(avg × 3 × 10) / 10 — i.e. multiply by 3, then by 10, round half-to-even, divide
   by 10 — max none); reason = `3× the surrounding ambient ({F1(avg)} fc)`.

---

## 8. Keep-dim enforcement

### 8.1 EnforceKeepDim(design, log = none) → set of touched intents

If no log is passed, create one and flush it at the end. For each keep-dim intent that is not a suggestion (design order):
1. Append it to `log.keeps`. Skip if its region has < 3 points.
2. `max` = keep.max or 5. `avg = Avg(keep)`. `skipped` = ∅ (fixture ids).
   `moves` = Σ (removed + moved) over log entries for this keep (from earlier passes too).
3. While moves < 3 and avg > max:
   - Candidates: intents ≠ keep, not suggestions, not KeepDim, not hand-tuned, with no fixed quantity; their fixtures in design
     order then fixture order; not pinned; not skipped. Distance = `PolygonDistance(keep.region, [fixture centre])`
     (geometry.md with a 1-point polygon: no containment shortcut, so a point **inside** the zone gets its distance to the
     zone boundary, not 0). Keep those with distance ≤ 30. Victim = smallest distance (ties → first in order). None → stop.
   - If the victim's intent has more than 1 fixture: remove that fixture (by id); log.removed[(keep, intent)] += 1.
   - Else (its last fixture): ctx = MakeCtx(design, intent). If the fixture centre is inside one of ctx's keep zones and
     `NearestAllowed(ctx, centre)` (solver-layouts.md §9) finds a spot: replace the fixture with `Relocated(ctx, fixture, spot)`;
     log.moved[(keep, intent)] += 1. Otherwise: add the fixture id to skipped, add (keep, intent) to `log.lastKept`, and
     continue the loop **without** counting a move or re-estimating.
   - moves += 1; touched ∪= {intent}; avg = Avg(keep).

The log's `moves` map is insertion-ordered by first (keep, intent) key; `lastKept` is an insertion-ordered set.

### 8.2 Flush(design)

1. From every intent's trace remove lines that start with `Removed `, `Moved ` or `Keep-dim: `.
2. For each distinct keep in `log.keeps` (first-occurrence order), skipping regions with < 3 points; `max` = keep.max or 5:
   - For each log entry (keep, intent) for this keep (insertion order):
     - removed > 0: `Removed {removed} fixture{s(removed)} of {intent.label} near {keep.label}: it was over {F1(max)} fc and fixtures cannot be dimmed.`
     - moved > 0: `Moved the last fixture of {intent.label} away from {keep.label}: it was over {F1(max)} fc and fixtures cannot be dimmed.`
     Each line is appended to **both** the keep's and the intent's trace (keep first).
   - `avg = Avg(keep)`; if avg ≤ max → next keep.
   - `stayed` = distinct intents of lastKept entries for this keep (insertion order).
     `why` = `The last fixture of {labels joined with " and "} stays, and fixtures cannot be dimmed.` when stayed is non-empty,
     else `Fixtures cannot be dimmed, and no further unpinned fixture can move without emptying an intent.`
   - Line `Keep-dim: {keep.label} still reads {F1(avg)} fc against its {F1(max)} fc maximum, so the keep-dim zone is over its maximum. {why}`
     appended to the keep's trace and to each stayed intent's trace.

---

## 9. Trace — WriteTrace(design, intent, fit)

The trace is rebuilt from the final layout; then the session's notes for the intent (§7.2) are appended in insertion order.
Lines, in order (label = intent.label; count = number of fixtures now, pinned included; product name `P` = current
product label, or `fixture` when the label is empty):

1. Suggestion → only `{label}: a suggestion; it places nothing until you accept it.`
2. KeepDim, or fit none → only `{label}: keeps other fixtures out of its margin and holds its plane under its maximum; it places none of its own.`
3. Accent whose target reason starts with `3×`: `{label}: target set to {targetReason}: {D0(target.average)} fc.`
4. `{label}: {fit.how} → {count} × {P}.`
5. If fit.notes non-empty: `{label}: {fit.notes}.`
6. If fit.package non-empty: that line as is (it carries its own label).
7. If HasTarget and count > 0: `want = Want(intent)`, `avg = Avg(intent)`, `density = clamp(behavior.density, 0.6, 1.6)`:
   - quantity set: `{label}: {count} fixture{s} at full output, a count you set, estimate {F1(avg)} fc against {F1(want)} fc.`
   - else `|density − 1| > 1e-9`: `{label}: density {D1(density)} sets the spacing, so {count} fixture{s} at full output give {F1(avg)} fc against {F1(want)} fc.`
   - else: `{label}: {count} fixture{s} at full output (Designer cannot dim fixtures), chosen so the estimate lands on {F1(want)} fc: {F1(avg)} fc.`
   Then the first that applies:
   - `avg > want × 1.15` and fit.minCount > 0 and count ≤ fit.minCount: `rest` = Avg(intent) with only its pinned fixtures (then restore).
     - rest ≥ want × 0.95: `{label}: the other intents already light this plane to {F1(rest)} fc, so it keeps just {count} fixture{s}, the fewest that still cover it evenly.`
     - else: `{label}: even {count} fixture{s} give{"s" if count = 1 else ""} {F1(avg)} fc against {F1(want)} fc` +
       (` ({F1(rest)} fc of it from the other intents)` when rest > want × 0.3) + LowerHint + `.`
   - `avg < want × 0.85` and count ≥ 300: `{label}: 300 fixtures limits the count, so the estimate falls short of {F1(want)} fc at {F1(avg)} fc.`
   - `avg < want × 0.85` and no quantity and `|density − 1| < 1e-9`: `{label}: the estimate falls short of {F1(want)} fc at {F1(avg)} fc.`
8. pinned count p > 0: `{label}: kept {p} fixture{s(p)} you placed by hand.`
9. No product choice, or the chosen product isGeneric: `{label}: no product chosen yet, so this uses a generic {lowercase(P)}.`
   (lower-case the whole product label, invariant culture: "Cove linear, per 4 ft · 800 lm" → "cove linear, per 4 ft · 800 lm").

**LowerHint(product)**: `lower` = the last package in PackagesOf(product) with `lumens < product.lumens − 0.5`.
None → `; pick a lower-output product`; else `; the {Lm(lower)} package of this family would land closer`.

Literal characters: `→` U+2192, `×` U+00D7, `²` U+00B2, `°` U+00B0, `—` U+2014, `·` U+00B7, `′` U+2032, `″` U+2033.
The string "(Designer cannot dim fixtures)" is reference text and must be kept verbatim for golden parity.

---

## 10. Worked example — Office, all seeds accepted (golden `Office.json`, "solved")

- **Desk cluster C task** (pendant-linear, final 2,000 lm): region (17,2.75)–(27,8.75), area 60, centroid (22,5.75).
  IsPendant → mounting min(9 − 1.5, max(7.5, 9 − 4)) = 7.5; mountH = 7.5 − 2.5 = 5; rcr = 5·5·60/864 = 1.7361;
  CU = 0.72 − 0.035·1.7361 = 0.6592 → "CU 0.66"; lumen = ceil(30·60 / (2000·0.6592·0.85)) = ceil(1.606) = 2.
  Pattern rows (linear). RowPoints n = 1: rows = 1, perRow = 1 → (22, 5.75), orientation 0, pendant 7.5. ✓
  Trace line 1: `Desk cluster C task: lumen method for 30 fc over 60 ft² (CU 0.66, LLF 0.85) gives 2, rows pattern → 1 × 4 ft pendant linear, direct/indirect · 2000 lm.` ✓
- **Brand wall wash** (wallwash 600 lm): run t 18..34 on wall 2, len 16, offset clamp(9/3, 2, 4) = 3, fewest = ceil(16/4.5) = 4,
  n = 4 → t = 20, 24, 28, 32 → x = 16, 12, 8, 4 at y = 21; orientation AngleDeg((−0, 1)) = 90; tilt 0 (asymmetric). ✓
- **Brand wall accent**: wall 2, t = 26, mid 5, drop 4, offset 4·tan 30° = 2.3094 → (10, 21.6906), tilt atan2(2.3094, 4) = 30°. ✓
- **Open office ambient**: final package 1,500 lm; snapped 5 × 3 grid (pre-snap x 3.6, 10.8, 18, 25.2, 32.4; y 4, 12, 20 →
  banker's snapping gives x 3, 11, 17, 25, 33 and y 5, 13, 21 — 18/2 − 0.5 = 8.5 rounds to **8**, giving 17 not 19);
  2 positions dropped inside the keep zone (x ≥ 26.85, y 10–24): (33,13), (33,21); then keep-dim enforcement removed the
  3 nearest: (25,13), (25,21), (33,5) → 10 fixtures. ✓
  CU: mountH 6.5, rcr = 5·6.5·60/864 = 2.257 → CU 0.641 → "0.64"; lumen = ceil(20·864/(1500·0.641·0.85)) = 22. ✓
- **Meeting table task** leans to 20 × 1.06 = 21.2 (Relieve: keep-dim 14.4 → 11.4 fc, and 3.0 ≥ 0.25·(14.4 − 5)). ✓

---

## Test cases

Helper "Solved(room, tweak)" = seed the room, mark every seed accepted (isSuggestion = false), apply the tweak, SolveAll.
"Make(room, kind, region, wall, obj)" = an accepted intent with defaults.md label/target and workplane.md plane.
"Landed(i, e)" = `|e.avg − target.avg| / target.avg ≤ 0.15`, or e.avg > target.avg and some trace line contains
`already light this plane` or `pick a lower-output product`.

| Test | Setup | Expected |
|---|---|---|
| Solve_OfficeIntentsLandOnTheirTargets | Solved(Office) | For the ambient, and every Task or WallWash whose `PolygonDistance(keep.region, region) > 8`: fixtures > 0 and Landed |
| Solve_CafeteriaIntentsLandOnTheirTargets | Solved(Cafeteria) | Every Ambient, Task, WallWash: fixtures > 0 and Landed |
| Solve_EveryRoomSolvesWithSaneFixturesAndOutputs | Solved(each demo room) | KeepDim: 0 fixtures. Every other intent: 1..300 fixtures; trace non-empty; every fixture InRoom, output = 1.0, 0 < height ≤ CeilingAt(centre) + 0.01, intentId = intent id |
| Solve_EveryIntentInARoomHasItsOwnLabel | Solved(each demo room) | labels distinct; Data hall task labels exactly [`Aisle 1 task`, `Aisle 2 task`, `Aisle 3 task`] |
| Solve_IsDeterministic | Solved(Office) twice | same fixture counts per intent; same centres and outputs in order |
| SolveAll_LeavesHandTunedIntentsAlone | Solved(Office); first Task's fixture 0 moved to (10.1, 12.2) and pinned; handTuned = true; SolveAll again | that task's (id, centre) list unchanged; a trace line contains `hand-tuned` |
| SolveAll_SuggestionsPlaceNothing | Office seeds added as suggestions; only intents[0] accepted; SolveAll | intents[0] has fixtures; all others 0; total fixtures = intents[0]'s count |
| Solve_HitsTheTargetWithCountNotOutput | Office, single ambient over floor, target (none, fc, none), product = designer choice (agentPicked false) of the 3,000 lm volumetric with lumens overridden to 1000; Solve | for fc 20, 40, 60: all outputs 1.0; relative error < 0.2; count(20) < count(40) < count(60) |
| Solve_SaysSoWhenEvenTheFewestFixturesOverLightThePlane | Office, single ambient, target (none, 2, none), no product; Solve | estimate > 2.3; exactly one trace line contains `pick a lower-output product`, and it contains `even {count} fixtures give`; outputs all 1.0 |
| Solve_QuantityOverrideIsExact | Office ambient over floor, quantity 12; Solve | exactly 12 fixtures |
| Solve_DensityMovesTheFixtureCount | Office ambient, alignToCeilingGrid false, density d; Solve | count(0.6) > count(1); count(1) ≥ count(1.6) |
| Solve_PatternsAreHonoured | Office ambient, pattern `staggered`, no grid snap; Solve; then pattern `perimeter`; Solve | staggered: distinct X (rounded 2 dp) count > distinct Y count; a trace line contains `staggered`. Perimeter: every fixture within 2.1 ft of the 36×24 room edge (min of x, 36−x, y, 24−y < 2.1) |
| Solve_PinnedFixturesStayWhereTheyAre | Office ambient solved; fixture[3] replaced by a copy at (17.33, 11.77) pinned, output 0.8; handTuned = true; Solve | that fixture (same id) keeps its centre and output 0.8; > 5 fixtures; a trace line contains `by hand`; every other fixture ≥ 1.5 ft from it |
| KeepDim_RemovesNearbyFixturesInsteadOfDimmingAndSaysWhereItFallsShort | Office. A: Solved without the keep-dim; probe = keep-dim region/plane with target max 5 → `before`. B: Solved(Office) → `after` = estimate of the keep-dim | before > 5; after < before; some intent has a trace line starting `Removed `; the keep-dim has a line starting `Removed ` containing `Screen — keep dim`; no line starts with `Dimmed `; after ≤ 5.25 or a keep trace line contains `keep-dim zone is over its maximum` |
| KeepDim_NeverDimsAndNeverEmptiesAnIntent | Solved(Office) | every non-keep-dim fixture output 1.0; every non-keep-dim intent ≥ 1 fixture |
| KeepDim_NoFixturesLandInsideItsMargin | Solved(Office) | for the ambient: margin = min(4, 9·tan(beam/2)); no ambient fixture inside Inflate(keep.region, margin) |
| KeepDim_MarginBehaviourWidensTheExclusion | Office; keep-dim Rect((16,10),(20,14)) with keepDimMargin 5; ambient over floor, no grid snap; Solve(ambient) | > 3 fixtures; none inside Inflate(keep, 5); a trace line contains `keep-dim` |
| KeepDim_RemovesTheNearestFixtureWhenItIsOverTheMaximum | Room "Open office" 20×20, ceiling 9, no walls; keep-dim `Screen — keep dim` Rect((9,9),(11,11)), max 0.5, plane H 2.5; ambient (10,20,35) over the floor with fixtures (10,13), (10,7), (4,4), (16,16) at height 9; EnforceKeepDim | count < 4 and ≥ 1; keep trace has a line starting `Removed `; at most 3 removed; outputs 1.0; not both (10,13) and (10,7) remain |
| KeepDim_MovesAnIntentsLastFixtureOutOfTheMarginInsteadOfRemovingIt | same room, one fixture at (10,10); EnforceKeepDim | 1 fixture; outside Inflate(keep, min(4, 9·tan(beam/2))) (downlight 60° → 4); inside the ambient region and the room; ambient trace has a line starting `Moved the last fixture` |
| KeepDim_KeepsTheLastFixtureAndReportsTheZoneIsOverItsMaximum | same room, one fixture at (16,10); keep max 0.01; EnforceKeepDim | 1 fixture still at (16,10); touched empty; keep trace and ambient trace each contain `keep-dim zone is over its maximum` |
| Solve_AnIntentWhoseWholeAreaIsInsideTheMarginStillGetsOneFixture | Office; keep-dim Rect((10,8),(20,16)) margin 4; task Rect((13,10),(17,14)); SolveAll | task ≥ 1 fixture; a task trace line contains `keep-dim` |

QuickEstimate tests in SolverTests.cs (owned by **estimate.md**; listed so nothing is lost): Exponent(120) = 1, Exponent(90) = 2,
Exponent(25) > Exponent(60); single 6″ downlight at (10,10,10) in a 20×20 room matches (I0/100 + lumens·0.25/400·2)·0.85 within 1 %,
5 ft aside < 0.6× that, facing away = indirect only; halving outputs scales the Office ambient average into (0.3, 0.8)×;
estimate fixture count and watts (Σ watts × output); power W > ambient W and LPD = W/864 in (0.05, 2.5);
vertical wash plane facing > 2× turned; cafeteria cove estimate > 1 and Landed; ≤ 400 samples and < 25 ms per estimate with 200 fixtures.
Designer-link tests (DemoLink_*) are excluded from the port.

Solver tests in LumenPackageTests.cs (also referenced by products.md):

| Test | Setup | Expected |
|---|---|---|
| Solve_AnAgentPickedPackageStepsDownAndSaysWhy | Office, each seed's product = ranker pick from the demo project (ranker.md); SolveAll | ambient product agent-picked; its lumens < 3000; a trace line contains `Stepped down to` and `overshoots 35 fc at the fewest fixtures`; alternatives include a 3000 lm package; first 4 alternatives are the same family |
| Solve_WithNoProductYetThePackageIsKeptOutOfTheIntentSoTheAgentCanStillPick | Solved(Office) with no products | every intent product none; ambient ProductOf lumens < 3000; ambient trace has a line starting `{label}: no product chosen yet` |
| Solve_AUserChosenProductIsNeverChangedAndOnlyTheTraceSuggestsALowerPackage | Office, ambient product = designer choice of the 3000 lm volumetric, reason "Chosen by you" | product unchanged, agentPicked false, reason kept; no line contains `Stepped`; a line contains `package of this family would land closer` |
| Solve_ARealCatalogProductIsKeptAndGetsTheGenericHint | Office, ambient product = agent-picked non-generic copy of the volumetric with its own product id and a non-demo catalog | product unchanged; no `Stepped`; a line contains `pick a lower-output product` |
| Solve_AmbientCountsTheLightTheOtherIntentsPutOnItsPlane | Solved(Office) vs Solved(Office) with only the ambient | ambient count × lumens is smaller with the other intents |
| Solve_IsDeterministicAndStableWhenSolvedAgain | each room, ranked products, SolveAll twice on separate designs, then again on the first | same product keys and counts; re-solving the same design changes nothing |
| DemoRooms_MostIntentsMeetTheirTargetRange / NoAgentPickedIntentIsOverItsMaximumWhenALowerPackageExists | each room × {generic, ranked} | ≥ 75 % of targeted intents meet (status rule in ranker/estimate specs); an intent over max × 1.02 has no lower package |

Golden parity: for each room, every solved intent's product family and lumens, fixture count, mounts, centres/heights
(1e-6) and trace lines must equal `golden/<Room>.json` "solved".

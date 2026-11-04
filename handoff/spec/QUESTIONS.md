# Spec questions (implementation team → spec team)

Format: date · spec § · question · option picked (matches golden where golden speaks) · status.

## 2026-11-04 — foundation (model, format, units, geometry, demo rooms)

1. **geometry.md §11, negative zero input.** The spec says a negative value whose rounded result is zero prints as
   `-0` (e.g. −0.04 with `"0.#"`). What does an input of exactly `-0.0` print? *Picked:* `0` (only strictly negative
   inputs get the sign). Golden does not exercise it. Open.
2. **model.md §12, `removedExisting` "set of uuid".** No wire shape given. *Picked:* an array of uuids on the wire
   (`RoomDesignSchema.removedExisting: string[]`); the store may hold a `Set`. Open.
3. **model.md §5 + PLAN §3, `cct` / `beamAngle` on IntentBehavior.** Not in the reference model, so no wire rule.
   *Picked:* optional properties; a `null` on the wire reads as absent (drafts that write nulls still parse);
   `cct` ∈ {2700, 3000, 3500, 4000, 5000}, `beamAngle` > 0. Open (FYI).

No golden mismatches: all four demo rooms built from demo-rooms.md §4 formulas are bit-identical with golden `room`;
misc.json `feetInches` all match.

## 2026-11-04 — estimate, zones

4. **estimate.md §4, indirect term in a floorless room.** `floorArea` is 0 when the room has no floor loops, so
   "Indirect = sum / A" divides by zero (reach already uses max(A, 1)). *Picked:* divide by 1 when A = 0 (any room
   with a floor has A ≥ 1, so golden is unaffected). Open.
5. **estimate.md §5, group scaling.** Marked optional and unused by every reference caller. *Picked:* not
   implemented. Open (FYI).
6. **estimate.md §6 test "centroid fallback", example input.** "A thin sliver triangle" is not enough on its own: an
   axis-aligned sliver or a right triangle always has some cell centre on its boundary, and boundary counts as inside.
   *Picked:* test uses the diagonal sliver (0,0),(10,7),(10,6.95), which no cell centre touches. FYI, no behaviour
   question.

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

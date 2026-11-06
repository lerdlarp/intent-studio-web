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

## 2026-11-04 — interpreter, fallback AI, AI codecs

4. **interpreter.md §1/§2, `\b` / `\w` on non-ASCII.** Spec says patterns are written for ASCII. *Picked:* the same
   Unicode lookaround boundary as defaults.md (`[\p{L}\p{N}_\p{M}]`), `iu` flags; `\w`, `\d` and the Word pattern
   stay ASCII. Golden does not exercise non-ASCII. Open (FYI).
5. **interpreter.md §1.1, kindsIn tie order.** No two kind patterns can start at the same character with real text
   (their first words differ), so the "tie → table order" case is untestable; implemented with a stable sort. FYI.
6. **interpreter.md §8 Ambient, "clipped to the room bounds".** *Picked:* `roomBounds` (all floor points). Same as
   loop-0 bounds for every demo room. Open.
7. **ai-codecs.md §2 / Ambiguity 1, untrusted block tag.** Spec suggests `<untrusted-text kind="designer-request">`;
   PROGRESS decision says `<designer-text>…</designer-text>`. *Picked:* the PROGRESS decision. Host JSON is compact
   `JSON.stringify` (nulls emitted). The interpret user message also ends with "Reply with the JSON array only."
   (not stated for interpret in the spec). Open.
8. **ai-codecs.md §3.2 `widthFt`/`depthFt`, "floor bounds".** *Picked:* bounds of every floor point (0 for no floor,
   not `roomBounds`' (0,0)–(1,1) default). Open.
9. **ai-codecs.md §3.3 with the 10-intent cap.** *Picked:* `parseAdvice` receives all intents, matches items only
   against the first 10 (positional match only when the item count equals the number sent, i.e. min(10, n)), and
   returns advice for every intent (fallback for the rest). Open (FYI).
10. **ai-codecs.md §3.4 cct.** No designer-edit flag for cct. *Picked:* `applyAdvice` sets `behavior.cct` only while it
    is absent; a reply `cct` is kept only when it is one of 2700/3000/3500/4000/5000. Open.
11. **ai-codecs.md §5, other `lastIssue` wordings (implementer's choice).** *Picked:* timeout "The agent took too long
    — using rules"; budget "The agent is busy (request limit) — using rules"; unreadable "The agent reply could not be
    read — using rules" (em dashes). Only "The agent is offline — using rules" is reference wording. Open.
12. **ai-codecs.md §1.3, string numbers like "Infinity"/"NaN".** *Picked:* rejected (absent) — consistent with the
    non-finite rule. `[,]` (comma with no value) is a parse failure; `[1,]` is accepted. Open (FYI).

No golden mismatches: every golden `interpret` phrase (20, all four rooms) and every `fallbackAdvice` row match
exactly (regions within 1e-6; strings, targets, planes exact).

## 2026-11-04 — solver (solver.md, solver-layouts.md)

7. **products.md "most intents meet target", the 1.3× Over rule.** The spec defines it as part of the *test's* status
   ("Status = the inspector rule, plus: … > 1.3·a → Over"), not as the inspector rule itself. *Picked:* kept in the test
   helper only; `products.ts targetStatus` is unchanged. Should the inspector glyph also show ↑ for an average-only
   target above 1.3× its average? Open.
8. **solver.md §4.2 step 9, hand-tuned trace.** "trace = [`{label}: hand-tuned by you, kept as is.`]" — are session notes
   (§7.2) appended after it? *Picked:* no (a hand-tuned intent cannot lean, so it only matters for a keep-dim/over
   intent being relieved by others, which golden does not exercise); keep-dim Flush lines are still appended. Open.
9. **solver-layouts.md, fixture ids.** New fixtures get random uuids (`newUuid`), so "deterministic" means same
   centres/heights/orientations/outputs in order, not same ids. FYI.

Golden: all four rooms match `solved` exactly (products, counts, mounts, coordinates/heights/orientation/tilt,
every trace line, estimates, power) with format.ts unchanged — the .NET `0.#` / `#,0` description matched golden.

10. **Light loss factor per luminaire type (2026-11-06, open).** The designer wants LLF editable per fixture type in
    the new luminaire schedule. Today `LLF = 0.85` is a spec constant (solver/context.ts, lumen-method trace text,
    estimate). Needs a spec amendment before core changes: where LLF lives (product / type), default 0.85, range,
    whether the trace line and golden outputs keep 0.85 when unset. The schedule shows LLF read-only until then.

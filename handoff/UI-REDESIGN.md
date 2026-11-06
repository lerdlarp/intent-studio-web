# Room screen redesign — proposal (2026-11-06)

Four independent reviews (lighting designer, interaction designer, first-time user, product workflow) of the
zone panel, zone list and plan chrome. This is the synthesis. Nothing here changes core policies; anything that
would (LLF, room-level CCT) is flagged for QUESTIONS.md.

## What all four agreed on

1. **The zone panel is a form for the solver, not for the designer.** ~16 controls per zone. Quantity, Pattern and
   Fixture density all answer "how many / where"; the density multiplier means nothing physical.
2. **Status contradicts itself.** "Open office ambient" shows Avg 20.2 vs target 20 and says "↓ Below minimum"
   because the hidden minimum (8.7 < 10) failed. The list shows a bare ↓ with no target and no reason.
   Three different "maximums" (max average, average ceiling, estimated max) are indistinguishable.
3. **Products are buried and per-zone.** Product card + "Change ⌄" overlay on a native select + full-width
   Import IES inside one zone + a separate "Products" library dialog. Nothing shows what the room uses, counts,
   watts, or lets you swap a type everywhere.
4. **Most remaining fields should be derived from the zone kind**, not asked.

## Decisions a designer actually makes per zone (ranked)

1. Fixture type (the look) 2. Light level 3. How many (Auto, or "make it 3") 4. Mount height — pendants only
5. Aim/offset — wash/accent only. Everything else is derived or advanced.

## Field disposition

| Field | Now | Proposed |
|---|---|---|
| Zone name | separate field + title | inline-editable title |
| Product card, Product details, Import IES | top of zone panel | → **luminaire schedule dock**; zone shows one row `Type B ▾ 2×2 troffer · 1,500 lm` |
| Color temperature | per zone, Kelvin select | Warm / Neutral / Cool chip (K as caption); edited per *type* in the dock |
| Average target | number | presets per kind (e.g. Ambient Soft 10 · Comfortable 20 · Bright 30 fc) + custom number |
| Limits (min, max avg) | disclosure | derived defaults per kind; editable under **More** |
| Estimate block | 3 big numbers | one status line naming the failing metric (below) |
| Quantity + Pattern + Density | 3 controls | one **Fixtures** control: `Auto (10)` or `− 8 +`, with spacing readout `7'-6" × 6'-0"`; Pattern & density under More (density hidden when quantity is set) |
| Mounting height | placement | visible for Pendants only; else More |
| Wall offset / aim | placement | derived; More (shown for Wall wash / Accent) |
| Calculation plane | disclosure | derived per kind; More, labelled "Measured at: Desk / Floor / Wall" |
| Why this target / layout | 2 disclosures | one "Why" disclosure under More |
| Keep-dim margin | field | More |
| Delete zone | bottom | More, with Undo announcement |

**More** shows a dot when any hidden field is not automatic, so experts don't miss overrides.

## Status line (list rows, zone card, canvas chip — same grammar everywhere)

`Avg 20.2 / 20 fc ✓ · Min 8.7 < 10 ▼ · estimate` → plain sentence "Some spots too dark" + one fix action
("Add fixtures" / "Brighter type"). Text always accompanies colour/glyph; announced to screen readers
(today the row's aria-label hides it). Uniformity (avg:min) beats max for designers; max only shown when it fails.

## Layout

```
┌ Intent Studio / Demo rooms / 204 ─ ↶↷ ────── [Calculate] [2D|Split|3D]  Export  ft·fc ┐
├──┬─────────────────────────────────────────────────────┬──────────────────────────────┤
│T │ Heatmap Labels Snap Fit ?        (floating pill)    │ ZONES 3 · 16 fx  [✦ Suggest] │
│o │   ┌──────[Desk A · 26/30 ▼]──┐   ┌┄┄ Desk B ┄┄┐     │ ▌Open office  20/20 ✓        │
│o │   │  ○   ○   ○                │   ┊  [✓] [✕]  ┊     │ ▌Desk A task  26/30 ▼ min    │
│l │   └───────────────────────────┘   └┄┄┄┄┄┄┄┄┄┄┄┘     │ ── Suggested 5 [Accept all]  │
│s │                                                     │ ── selected: ZONE CARD ───── │
│  │                                   Room 36'×24' ·2ft │  title · status line         │
│  │                                                     │  Level  [Soft|Comf|Bright|_] │
│  │                                                     │  Type   [B ▾] 2×2 troffer    │
│  │                                                     │  Fixtures [Auto 10] 7'6"×6'  │
│  │                                                     │  ▸ More •                    │
├──┴─────────────────────────────────────────────────────┴──────────────────────────────┤
│ LUMINAIRES  [A ▭ Troffer ×10 3500K] [B ◯ Downlight ×1] [C ▬ Wash ×5] [+ IES]          │
│             16 fixtures · 214 W · 0.25 W/ft² (estimate)                 Results ▸     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## Luminaire schedule dock ("better than the competitor's strip")

- One tab/card per **type** (tag A, B, C… as on a drawing schedule): generic symbol, name, source
  (Built-in / Uploaded IES), lm, W, lm/W, beam, CCT, mini polar curve (from IES candela; cosⁿ for generic,
  labelled generic), count, total W, "Used in" zone chips.
- Collapsed: one 32px bar with chips + totals + W/ft² (estimate, no compliance claim). Wide screens: table view —
  this *is* the fixture schedule, and the tags flow into CSV/PDF export.
- Assign: select zone → click type; type picker in zone card; drag type onto zone (non-drag path always exists).
- **Swap type everywhere** in one undo step. Hover a type → highlight its fixtures. Unused library products shown
  greyed, absorbing the Products dialog. Incompatible types dimmed with a reason (symmetric downlight on a wash).
- Later: pin 2–3 candidates and compare Δcount / ΔW / Δavg / Δuniformity via deterministic dry-run solve.
- No manufacturer data, photos or endpoints.

## Phases (direction B chosen 2026-11-06; phase 1–2 core built, see PROGRESS.md)

1. **Zone card** (web only, no core change): new header/status line, level presets, fixture-type row, combined
   Fixtures control, More disclosure with dot, fix status wording + screen-reader text, list rows show
   `estimate/target` with reason. Product card + Import IES temporarily become the type row + a link to the library.
2. **Luminaire dock**: pure `fixtureTypes(design)` in core (group accepted zones by productKey + CCT, tags A, B, C
   in zone order, deterministic tie-break; Vitest first), dock UI, assign, swap-everywhere, W/ft², absorb
   Products dialog and Import IES, tags into export. Optional persisted `fixtureTypes` for stable/editable tags.
3. **Canvas-first**: target chips on zones (compact `26/30`, full on hover/select, mirrored as DOM buttons),
   accept/dismiss on suggestion outlines, Calculate in top bar, Results drawer from the dock, 2D|Split|3D toggle.

## Decided (2026-11-06)

- **LLF per luminaire type: yes.** Spec change needed (LLF is the constant 0.85 today) → log in QUESTIONS.md and
  amend the spec before core work.
- **CCT belongs to the luminaire type.** The zone only *suggests* a CCT (kind/AI); the zone card shows
  "Zone suggests 3000K · B is 3500K" with "Make B 3000K" or "New type". A type is never changed silently.

## Open questions (→ QUESTIONS.md before building)

- "Automatic" zones can change lumen package between solves → their type tag would move. Show as "A (auto)"
  grouped by family, with "Lock as type"?
- Level presets per kind: confirm fc values (proposal: Task 20/30/50, Ambient 10/20/30, Wall wash 10/20/30
  vertical, Path 1/2/5, Accent as 3:1 / 5:1 / 10:1 over ambient).

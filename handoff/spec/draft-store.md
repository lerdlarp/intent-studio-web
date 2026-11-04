# Draft store — autosaved designs per room

Saves a room's **intents, not its results**, so closing and reopening the app picks the design up again. The original
wrote files; the web version may store the same document in IndexedDB or on the server, but must keep the key
derivation, document shape, slimming and sanitising rules below.

## 1. Location / key

Logical path: `<root>/<sanitise(project)>/<roomId>.json`, where roomId is the room's uuid written as **32 lowercase hex
digits without dashes** (e.g. `a0000204000040008000000000000204.json`). `root` defaults to the app's data folder +
`studio`; callers (tests) may pass another root.

Writes are atomic: write the whole document to `<path>.tmp`, then move it over `<path>` (replacing). Create parent
folders as needed.

## 2. sanitise(project) — project identity → safe folder name

1. text = project (null → ""), trimmed of leading/trailing whitespace.
2. text empty → `default`.
3. Build `clean`: for each character (UTF-16 code unit) of text — keep it if it is a Unicode letter or decimal digit
   (categories L* or Nd) or one of `-`, `_`, `.`; otherwise write `_`.
4. Trim every leading and trailing `.` and `_` from clean.
5. clean empty → `project`.
6. If clean has length ≤ 48 **and** clean equals text (nothing was replaced or trimmed) → return clean.
7. Otherwise hash = the first 8 characters of the lowercase hex SHA-256 of the UTF-8 bytes of text (the trimmed
   text, not clean). Return (clean truncated to its first 40 characters if it is longer than 40) + `-` + hash.

So different raw names that sanitise alike stay different, and the result is at most 49 characters.

## 3. Document shape (version 1)

| Property | Type | Notes |
|---|---|---|
| `Version` | integer | always 1 |
| `Room` | string | the room's label (informational) |
| `Saved` | timestamp | UTC time of saving, ISO-8601 with offset |
| `Intents` | intent[] | slimmed intents (§4) |

Original encoding (keep it for compatibility; the web version may choose camelCase internally but must then read
both): property names are the PascalCase model names (`Id`, `Kind`, `Label`, `LabelSuggested`, `Region`, `WallIndex`,
`ObjectIndex`, `Target{Minimum,Average,Maximum}`, `TargetReason`, `Plane{Kind,Height,Bottom,Top,Inferred,Reason}`,
`Behavior{Density,Pattern,AlignToCeilingGrid,AvoidCeilingDevices,WallOffset,AimAngle,MountingHeight,Quantity,
KeepDimMargin}`, `Product`, `Fixtures`, `IsSuggestion`, `HandTuned`, `Trace`); nulls are written (never omitted);
enums as their PascalCase names (`"Task"`, `"Horizontal"`); indented. **Points are written as two-element arrays
`[x, y]`**, each coordinate rounded with roundHalfEven(v, 4) (4 decimals). Reading a point requires exactly a
2-element numeric array; anything else is a parse error.

The calculation snapshot is never part of the document (the saved text does not contain `Zones`).

## 4. Save: slimming

For each intent of the design, in order, store a copy with:
- `id`, `kind`, `label`, `labelSuggested`, `region` (copied), `wallIndex`, `objectIndex`, `target`, `targetReason`,
  `plane`, `behavior`, `isSuggestion`, `handTuned` — unchanged;
- `product`: null stays null; otherwise the same choice (product, agentPicked, reason) **with `alternatives` = []**
  (alternatives are rebuilt when a product is picked again);
- `fixtures`: copied (ids, centers, pinned, … all kept);
- `trace`: **[]** (not stored).

The product is stored with its fields (`productId`, label, family, lumens, …); the excluded catalog id field is not
part of the web model.

## 5. Load: `tryLoad(project, room)` → (ok, intents)

1. If no document exists at the key → (false, []).
2. Parse. If parsing fails for any reason (malformed JSON, bad point, wrong types, I/O or permission errors) →
   (false, []). Never throw.
3. If the document is null, `Version` ≠ 1, or `Intents` is null → (false, []).
4. Drop intents that are null or whose `region` is null.
5. **Fit** each remaining intent to the room:
   - `wallIndex` set but < 0 or ≥ room.walls.length → null;
   - `objectIndex` set but < 0 or ≥ room.objects.length → null;
   - missing/null `target` → (null, null, null); missing `plane` → {Horizontal, 2.5, 0, 0, true, ""}; missing
     `behavior` → defaults; missing `fixtures` → []; missing `trace` → []; null `label` → ""; null `targetReason` → "".
   - Missing scalar properties take the model defaults (`model.md`; e.g. `labelSuggested` true, behaviour defaults).
6. Return (true, intents) — true even when the list ends up empty.

## 6. Delete(project, roomId)

Removes the document if it exists; I/O and permission errors are swallowed.

## Test cases

| Test | Input | Expected |
|---|---|---|
| round trip keeps intents, not results | Office demo; all seeds accepted (isSuggestion false) and solved; first Task intent edited: behavior {density 1.2, pattern `rows`, quantity 4, wallOffset 2.5}, product = project `downlight` product, agentPicked true, reason `In your project`, alternatives [generic 6″ downlight]; handTuned true; label `My desks`; labelSuggested false; fixtures[0] pinned. A calculation snapshot is attached. Save to project `Project A` under a temp root | document exists at pathFor(`Project A`, room.id, root); its text does not contain `Zones` |
| … loads | tryLoad(`Project A`, Office) | ok true; same intent count |
| … edited task | the loaded intent with the same id | label `My desks`; labelSuggested false; handTuned true; same kind; target equal; plane equal; behavior equal (by value); region x coordinates equal after rounding to 3 decimals; same fixture count; fixtures[0].pinned true and same fixture id; product.productId equal; product.reason `In your project`; product.alternatives empty; trace empty |
| … wash wall index | the loaded WallWash intent | wallIndex 2 |
| missing file is not an error | tryLoad(`none`, Lobby) with empty root | ok false; intents [] |
| corrupt file is not an error | document text `{ not json` at pathFor(`none`, Lobby.id) | ok false; intents [] |
| wrong version | valid document with Version 2 | ok false; [] |
| drops references the room no longer has | Office; one Accent intent region [(1,1)], objectIndex 99, wallIndex 40; save to `p`, load | ok true; loaded[0].objectIndex null; loaded[0].wallIndex null |
| keeps valid references | wallIndex 3, objectIndex 7 on Office | unchanged |
| point rounding | region point (1.234567, 2.5) saved | stored as [1.2346, 2.5]; loads back within 1e-4 |
| sanitise: invalid characters | `C:\Projects\Tower: Phase 2?.dsn` | contains no `\ / : * ? " < > |`; equals `C__Projects_Tower__Phase_2_.dsn-3b8408d2` |
| sanitise: different projects stay different | `C:\Projects\Tower: Phase 2!.dsn` | `C__Projects_Tower__Phase_2_.dsn-f6e4bea5` (≠ previous) |
| sanitise: null | null | `default` |
| sanitise: whitespace only | `   ` | `default` |
| sanitise: already clean | `Tower-Phase_2` | `Tower-Phase_2` |
| sanitise: long names are capped | 300 × `x` | 40 × `x` + `-0d4e2ca9` (length 49, < 60) |
| sanitise: 48 chars kept | 48 × `x` | unchanged |
| sanitise: 49 chars hashed | 49 × `x` | 40 × `x` + `-55bb9823` |
| sanitise: space replaced | `Project A` | `Project_A-621dd7c8` |
| sanitise: only dots | `...` | `project-ab5df625` |
| sanitise: trimmed separators | `_x_` | `x-f1f6bd62` |
| sanitise: short clean | `p` / `none` | `p` / `none` |
| sanitise: unicode letters kept | `Café` | `Café` |
| path | pathFor(`Project A`, Office.id, `/r`) | `/r/Project_A-621dd7c8/a0000204000040008000000000000204.json` |

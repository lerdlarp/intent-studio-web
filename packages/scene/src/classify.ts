// Object classification (PLAN §3 "Object classification"): name regexes → the object kinds the core understands.
// Unresolved objects keep kind "other" and are listed for a later AI `classify` batch (name, dims, top height).
import { OBJECT_KINDS } from '@intent-studio/core';
import type { StudioRoom } from '@intent-studio/core';

export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * Ordered rules; the first match wins, so specific phrases come before the generic words they contain
 * (lamps first so `desk lamp` is not a desk; `reception desk` before `desk`, `desk chair` before `desk`, `bar stool` before `bar`, `tv stand` before `tv`, `display cabinet` before
 * `cabinet`). Patterns run on the normalised name (see `normaliseName`).
 */
export const OBJECT_KIND_RULES: ReadonlyArray<{ readonly kind: ObjectKind; readonly pattern: RegExp }> = [
  { kind: 'other', pattern: /\b(lamps?|lights?|luminaires?|pendants?|sconces?|plants?|planters?|rugs?|carpets?)\b/ },
  {
    kind: 'reception',
    pattern: /\b(reception|front desk|info(rmation)? desk|concierge|welcome desk|check ?in desk)\b/,
  },
  { kind: 'seating', pattern: /\b(bar ?stools?|counter ?stools?|stools?)\b/ },
  { kind: 'island', pattern: /\b(kitchen )?islands?\b/ },
  { kind: 'counter', pattern: /\b(counter ?tops?|counters?|work ?tops?|service counter|kitchenette|vanity)\b/ },
  { kind: 'bar', pattern: /\b(bar|bar ?tops?|bar counter)\b/ },
  { kind: 'mirror', pattern: /\bmirrors?\b/ },
  { kind: 'cabinet', pattern: /\b(tv ?stand|media (console|unit)|display cabinet|vitrine cabinet)\b/ },
  {
    kind: 'display',
    pattern:
      /\b(display( case| table| stand| shelf| wall)?s?|showcases?|vitrines?|gondolas?|merchandis\w*|mannequins?|plinths?)\b/,
  },
  {
    kind: 'screen',
    pattern: /\b(screens?|tv|television|monitors?|projector screen|video ?wall|led wall|displayboard)\b/,
  },
  { kind: 'signage', pattern: /\b(sign(age|s)?|logos?|wayfinding|lettering|exit sign)\b/ },
  {
    kind: 'artwork',
    pattern:
      /\b(art ?work|art|paintings?|pictures?|picture frame|posters?|prints?|canvas|murals?|photos?|sculptures?|tapestry)\b/,
  },
  { kind: 'desk', pattern: /\b(bench desks?|desk bench(es)?|benching)\b/ },
  {
    kind: 'seating',
    pattern:
      /\b(chairs?|arm ?chairs?|seats?|seating|sofas?|couch(es)?|benches|bench|lounge|ottomans?|banquettes?|pouf(fe)?s?|loveseats?)\b/,
  },
  { kind: 'desk', pattern: /\b(desks?|work ?stations?|writing table)\b/ },
  { kind: 'table', pattern: /\btables?\b/ },
  {
    kind: 'cabinet',
    pattern:
      /\b(cabinets?|cupboards?|credenzas?|sideboards?|storage|lockers?|filing|file|drawers?|pedestals?|wardrobes?|book ?cases?|book ?shel(f|ves)|shel(f|ves|ving)|racks?|consoles?|dressers?)\b/,
  },
  {
    kind: 'appliance',
    pattern:
      /\b(fridge|refrigerator|freezer|oven|microwave|dish ?washer|washer|dryer|coffee machine|vending|printer|copier)\b/,
  },
  { kind: 'door', pattern: /\bdoors?\b/ },
];

/** Lowercase, split camelCase / digits / `_.-:#` into words, collapse spaces: `OfficeDesk_01` → `office desk 01`. */
export function normaliseName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_.\-:#/\\()[\]{},]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kind for a name, or null when no rule matches. */
export function classifyName(name: string): ObjectKind | null {
  const n = normaliseName(name);
  if (!n) return null;
  for (const r of OBJECT_KIND_RULES) if (r.pattern.test(n)) return r.kind;
  return null;
}

/** First kind any of the names resolves to (node name first, then descendant mesh names…). */
export function classifyNames(names: readonly string[]): { kind: ObjectKind; matched: string } | null {
  for (const name of names) {
    const kind = classifyName(name);
    if (kind) return { kind, matched: name };
  }
  return null;
}

/** One object the regexes could not classify — the input row of the AI `classify` batch (feet). */
export interface UnresolvedObject {
  roomIndex: number;
  objectIndex: number;
  name: string;
  length: number;
  width: number;
  /** Height above the floor of the object's top, ft (null when unknown). */
  top: number | null;
  bottom: number | null;
}

/**
 * Objects whose kind is "other" (or empty) across rooms, in room/object order. `isResolved(roomIndex, objectIndex)`
 * can exclude objects already confirmed by the designer.
 */
export function unresolvedObjects(
  rooms: readonly StudioRoom[],
  isResolved: (roomIndex: number, objectIndex: number) => boolean = () => false,
): UnresolvedObject[] {
  const out: UnresolvedObject[] = [];
  rooms.forEach((room, roomIndex) =>
    room.objects.forEach((o, objectIndex) => {
      const k = o.kind.trim().toLowerCase();
      if ((k === '' || k === 'other') && !isResolved(roomIndex, objectIndex))
        out.push({
          roomIndex,
          objectIndex,
          name: o.name,
          length: o.length,
          width: o.width,
          top: o.top,
          bottom: o.bottom,
        });
    }),
  );
  return out;
}

/** Max objects per `POST /api/ai/classify` call (the server truncates beyond this). */
export const CLASSIFY_BATCH_SIZE = 100;
/** Server limit on an object name. */
const CLASSIFY_NAME_MAX = 400;

/** One row of the `POST /api/ai/classify` body (feet; `index` refers back into the batch's `refs`). */
export interface ClassifyRequestObject {
  index: number;
  name: string;
  length?: number;
  width?: number;
  top?: number | null;
  bottom?: number | null;
  fallbackKind?: ObjectKind;
}

export interface ClassifyBatch {
  /** The request body: `{ objects: [...] }`. */
  body: { objects: ClassifyRequestObject[] };
  /** `refs[index]` is the object a reply row with that `index` is about. */
  refs: UnresolvedObject[];
}

const KIND_SET = new Set<string>(OBJECT_KINDS);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const finiteOr = (v: number | null): number | undefined => (v !== null && Number.isFinite(v) ? round2(v) : undefined);

/**
 * Build the AI classify request(s) for unresolved objects: batches of `CLASSIFY_BATCH_SIZE`, indices 0..n−1 within
 * each batch, dimensions rounded to 0.01 ft, non-finite values dropped, names truncated to the server limit.
 * `fallbackKind(o)` may supply the client's own guess (omitted by default, so the server's name rules apply).
 */
export function classifyBatches(
  objects: readonly UnresolvedObject[],
  fallbackKind?: (o: UnresolvedObject) => ObjectKind | undefined,
): ClassifyBatch[] {
  const out: ClassifyBatch[] = [];
  for (let s = 0; s < objects.length; s += CLASSIFY_BATCH_SIZE) {
    const refs = objects.slice(s, s + CLASSIFY_BATCH_SIZE);
    const rows = refs.map((o, index): ClassifyRequestObject => {
      const row: ClassifyRequestObject = { index, name: o.name.slice(0, CLASSIFY_NAME_MAX) };
      const length = finiteOr(o.length);
      const width = finiteOr(o.width);
      if (length !== undefined) row.length = length;
      if (width !== undefined) row.width = width;
      row.top = finiteOr(o.top) ?? null;
      row.bottom = finiteOr(o.bottom) ?? null;
      const fb = fallbackKind?.(o);
      if (fb !== undefined && KIND_SET.has(fb)) row.fallbackKind = fb;
      return row;
    });
    out.push({ body: { objects: rows }, refs });
  }
  return out;
}

/** Convenience: the first (usually only) classify request body for `objects`. */
export const classifyRequest = (objects: readonly UnresolvedObject[]): { objects: ClassifyRequestObject[] } =>
  classifyBatches(objects)[0]?.body ?? { objects: [] };

/**
 * Apply an AI classify reply (untrusted; the `{ result: [{index, kind}] }` envelope or the bare array) to one batch: rows with an unknown index or a kind outside `OBJECT_KINDS`
 * are ignored (the object keeps its current kind), as are objects whose kind is no longer "other"/empty (the
 * designer set it meanwhile). Returns new room objects; the input rooms are not mutated.
 */
export function applyClassification(rooms: readonly StudioRoom[], batch: ClassifyBatch, reply: unknown): StudioRoom[] {
  const rows: unknown[] = Array.isArray(reply)
    ? reply
    : Array.isArray((reply as { result?: unknown })?.result)
      ? (reply as { result: unknown[] }).result
      : [];
  const next = rooms.map((r) => ({ ...r, objects: r.objects.map((o) => ({ ...o })) }));
  const seen = new Set<number>();
  for (const row of rows) {
    const index = (row as { index?: unknown })?.index;
    const kind = (row as { kind?: unknown })?.kind;
    if (typeof index !== 'number' || !Number.isInteger(index) || seen.has(index)) continue;
    if (typeof kind !== 'string') continue;
    const k = kind.trim().toLowerCase();
    const ref = batch.refs[index];
    if (!ref || !KIND_SET.has(k)) continue;
    seen.add(index);
    const obj = next[ref.roomIndex]?.objects[ref.objectIndex];
    if (!obj || obj.name !== ref.name) continue;
    const cur = obj.kind.trim().toLowerCase();
    if (cur === '' || cur === 'other') obj.kind = k;
  }
  return next;
}

// Draft store document handling (spec/draft-store.md §3–§5): slimming on save, defensive fit-to-room on load.
// Pure: the persistence itself (file, IndexedDB, SQLite row) lives with the caller.
import { LightingIntentSchema, type LightingIntent, type StudioRoom } from './model';
import { roundHalfEven } from './format';

export const DRAFT_VERSION = 1 as const;

export interface DraftDocument {
  version: typeof DRAFT_VERSION;
  intents: LightingIntent[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const lowerFirst = (k: string): string => (k.length > 0 ? k.charAt(0).toLowerCase() + k.slice(1) : k);

const isPointArray = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** PascalCase (original encoding) → camelCase keys, `[x, y]` points → `{x, y}`; camelCase input passes through. */
function normalise(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    if ((key === 'center' || key === 'origin') && isPointArray(value)) return { x: value[0], y: value[1] };
    return value.map((v) => normalise(v, key === 'region' && isPointArray(v) ? 'center' : key));
  }
  if (!isRecord(value)) {
    return key === 'pattern' && typeof value === 'string' ? value.toLowerCase() : value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const nk = lowerFirst(k);
    if (nk in out) continue;
    out[nk] = normalise(v, nk);
  }
  return out;
}

const r4 = (n: number): number => roundHalfEven(n, 4);

/** Slim an intent for storage: product alternatives dropped, trace dropped, region points rounded to 4 decimals. */
export function slimIntent(intent: LightingIntent): LightingIntent {
  return {
    ...intent,
    region: intent.region.map((p) => ({ x: r4(p.x), y: r4(p.y) })),
    product: intent.product ? { ...intent.product, alternatives: [] } : null,
    trace: [],
  };
}

export const slimIntents = (intents: readonly LightingIntent[]): LightingIntent[] => intents.map(slimIntent);

/** Build the stored document for a list of intents. */
export const toDraftDocument = (intents: readonly LightingIntent[]): DraftDocument => ({
  version: DRAFT_VERSION,
  intents: slimIntents(intents),
});

const fitIndex = (v: unknown, count: number): unknown =>
  typeof v === 'number' && (v < 0 || v >= count) ? null : v;

/**
 * Load: parse `doc` (anything) against `room`. Never throws. `ok` is false for a non-object, a version other than 1 or
 * a missing intents list. Intents that are null, lack a region or fail the model schema are dropped; wall/object
 * indices the room no longer has become null; missing fields take the model defaults. `ok` stays true when the list
 * ends up empty.
 */
export function fitDraft(doc: unknown, room: StudioRoom): { ok: boolean; intents: LightingIntent[] } {
  try {
    const d = normalise(doc);
    if (!isRecord(d) || d.version !== DRAFT_VERSION || !Array.isArray(d.intents)) return { ok: false, intents: [] };
    const intents: LightingIntent[] = [];
    for (const raw of d.intents) {
      if (!isRecord(raw) || raw.region === null || raw.region === undefined) continue;
      const fitted: Record<string, unknown> = { ...raw };
      fitted.wallIndex = fitIndex(raw.wallIndex ?? null, room.walls.length);
      fitted.objectIndex = fitIndex(raw.objectIndex ?? null, room.objects.length);
      for (const k of ['label', 'targetReason'] as const) if (fitted[k] === null) fitted[k] = '';
      for (const k of ['target', 'plane', 'behavior', 'fixtures', 'trace'] as const) if (fitted[k] === null) delete fitted[k];
      const parsed = LightingIntentSchema.safeParse(fitted);
      if (parsed.success) intents.push(parsed.data);
    }
    return { ok: true, intents };
  } catch {
    return { ok: false, intents: [] };
  }
}

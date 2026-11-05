// Product ranker (spec/ranker.md): scores project products and the generic stand-in for one intent. No external
// catalog. Pure; no Node/DOM APIs.
import { classOf } from './defaults';
import { format0, formatGrouped, roundHalfEven } from './format';
import { area, centroid, ceilingAt, distance } from './geometry';
import type { IntentKind, LightingIntent, P2, ProductChoice, StudioProduct, StudioRoom } from './model';
import { productInProject, productKey } from './model';
import { asProject, byFamily, genericFor, isPackaged, packagesOf, type FamilyId } from './products';
import { feetInches, PRIME } from './units';

export const MAX_ALTERNATIVES = 8;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------------------------------------------------------
// §1 family(p)

const WASH = /wall\s*-?\s*wash|washer|\bwashing\b/i;
const COVE = /\bcove\b|\btape\b|\bribbon\b|flexible|\bindirect\s+only\b|uplight\s+only/i;
const PENDANT = /\bpendant\b|\bsuspended\b|\bcylinder\b|\bdrum\b|\bhung\b/i;
const ACCENT = /\baccent\b|\badjustable\b|\bgimbal\b|\bspot(light)?\b|\btrack\b|\bmr16\b|\bpicture\b/i;
const STRIP = /high\s*-?\s*bay|low\s*-?\s*bay|\bstrip\b|\bindustrial\b|\bwrap\b|\bvapou?r\b/i;
const STEP = /\bstep\s*light|\bpath\s*light|\bbollard\b|\bwayfinding\b|\btoe\s*kick\b/i;
const TROFFER = /troffer|flat\s*panel|\bpanel\b|lay[\s-]*in|\b2\s*[x×']\s*[24]\b|\b[24]\s*'?\s*[x×]\s*[24]\b|volumetric/i;
const DOWNLIGHT = /downlight|down\s*light|recessed\s+(can|downlight)|\bwafer\b|\bdownlighting\b/i;
const VOLUMETRIC = /volumetric|\b2\s*[x×']\s*2\b|2\s*'?\s*[x×]\s*2\s*'?/i;

/** The generic family id a product behaves as. */
export function family(p: StudioProduct): FamilyId {
  if (p.family !== '' && byFamily(p.family) !== null) return p.family.toLowerCase() as FamilyId;
  const text = `${p.label} ${p.catalog} ${p.description}`;
  if (WASH.test(text) || p.asymmetric) return 'wallwash';
  if (p.uplightShare >= 0.85 || COVE.test(text)) return 'cove';
  const small = p.isRound || (p.length <= 1.5 && p.width <= 1.5);
  if (PENDANT.test(text) || p.uplightShare >= 0.2) return small ? 'pendant-can' : 'pendant-linear';
  if (STEP.test(text)) return 'step';
  if (ACCENT.test(text) || (small && p.beamAngle <= 30)) return 'accent';
  if (STRIP.test(text)) return 'strip';
  if (!small) {
    const long = Math.max(p.length, p.width);
    const short = Math.min(p.length, p.width);
    if (short > 0 && long / short >= 4 && long >= 3) return 'strip';
    if (VOLUMETRIC.test(text) || (long <= 2.3 && short >= 1.5)) return 'volumetric';
    if (TROFFER.test(text) || (long >= 3 && short >= 1.3)) return 'troffer';
  }
  if (DOWNLIGHT.test(text) || small) return p.beamAngle <= 45 || p.lumens >= 2300 ? 'downlight-ho' : 'downlight';
  return 'downlight';
}

// ---------------------------------------------------------------------------------------------------------------
// §2 familyWord

const FAMILY_WORDS: Readonly<Record<string, string>> = {
  troffer: 'troffer',
  volumetric: 'volumetric troffer',
  downlight: 'downlight',
  'downlight-ho': 'downlight',
  wallwash: 'wall washer',
  accent: 'accent',
  'pendant-linear': 'linear pendant',
  'pendant-can': 'pendant',
  cove: 'cove linear',
  strip: 'linear strip',
  step: 'step light',
};
export const familyWord = (fam: string): string => FAMILY_WORDS[fam] ?? 'luminaire';

// ---------------------------------------------------------------------------------------------------------------
// §3 familyFit

/** How well a family suits an intent kind in a room, 0..1. */
export function familyFit(room: StudioRoom, kind: IntentKind, fam: string): number {
  const grid = room.ceilingGrid !== null;
  const high = room.ceilingHeight > 12;
  const cls = classOf(room);
  const office = cls === 'Office' || cls === 'OpenOffice';
  const dataHall = cls === 'DataHall';
  switch (kind) {
    case 'Ambient':
      switch (fam) {
        case 'volumetric': return grid ? 1.0 : 0.7;
        case 'troffer': return grid ? 0.92 : 0.6;
        case 'downlight': return high ? 0.55 : grid ? 0.8 : 0.95;
        case 'downlight-ho': return high ? 0.95 : 0.7;
        case 'strip': return dataHall ? 1.0 : high ? 0.6 : 0.5;
        case 'pendant-linear': return 0.65;
        case 'pendant-can': return 0.3;
        case 'cove': return 0.2;
        case 'step': return 0.15;
        case 'wallwash': return 0.2;
        case 'accent': return 0.2;
        default: return 0.3;
      }
    case 'Task':
      switch (fam) {
        case 'pendant-linear': return office ? 1.0 : 0.65;
        case 'downlight': return dataHall ? 0.4 : 0.85;
        case 'downlight-ho': return high ? 0.8 : 0.7;
        case 'volumetric': return grid ? 0.8 : 0.5;
        case 'troffer': return grid ? 0.75 : 0.5;
        case 'strip': return dataHall ? 1.0 : 0.5;
        case 'pendant-can': return 0.6;
        case 'accent': return 0.3;
        case 'wallwash': return 0.15;
        case 'cove': return 0.1;
        case 'step': return 0.1;
        default: return 0.3;
      }
    case 'WallWash':
      return fam === 'wallwash' ? 1.0 : fam === 'downlight' || fam === 'downlight-ho' || fam === 'accent' ? 0.3 : 0.08;
    case 'Accent':
      return fam === 'accent' ? 1.0 : fam === 'downlight-ho' ? 0.6 : fam === 'downlight' ? 0.4 : fam === 'wallwash' ? 0.25 : 0.08;
    case 'FeaturePendant':
      return fam === 'pendant-can' ? 1.0 : fam === 'pendant-linear' ? 0.8 : fam === 'downlight' || fam === 'downlight-ho' ? 0.2 : 0.08;
    case 'CeilingGlow':
      return fam === 'cove' ? 1.0 : fam === 'pendant-linear' ? 0.25 : fam === 'strip' ? 0.2 : 0.05;
    case 'Path':
      switch (fam) {
        case 'downlight-ho': return 0.9;
        case 'step': return 0.9;
        case 'downlight': return 0.8;
        case 'strip': return dataHall ? 0.85 : 0.4;
        case 'accent': return 0.4;
        default: return 0.15;
      }
    default:
      return 0.5;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// §4 needLumens

function centerOf(intent: LightingIntent): P2 {
  const r = intent.region;
  if (r.length >= 3) return centroid(r);
  if (r.length >= 1) return r[0]!;
  return { x: 0, y: 0 };
}

/** Lumens one fixture should deliver for the intent. */
export function needLumens(room: StudioRoom, intent: LightingIntent): number {
  const t = intent.target;
  let avg: number;
  if (t.average !== null) avg = t.average;
  else if (t.minimum !== null && t.maximum !== null) avg = (t.minimum + t.maximum) / 2;
  else if (t.minimum !== null) avg = t.minimum * 1.5;
  else if (t.maximum !== null) avg = t.maximum * 0.6;
  else avg = 20;
  const ceiling = ceilingAt(room, centerOf(intent));
  const region = intent.region;
  switch (intent.kind) {
    case 'Ambient':
    case 'Task':
    case 'Path': {
      const a = region.length >= 3 ? area(region) : 100;
      const h = intent.plane.kind === 'Horizontal' ? intent.plane.height : 0;
      const mount = Math.max(3, ceiling - h);
      const spacing = 1.2 * mount;
      const n = Math.max(1, Math.ceil(a / (spacing * spacing)));
      return (avg * a) / 0.4675 / n;
    }
    case 'WallWash': {
      const run = region.length >= 2 ? distance(region[1]!, region[0]!) : 10;
      const pl = intent.plane;
      const top = pl.top > pl.bottom ? pl.top - pl.bottom : Math.max(3, ceiling - 1);
      const offset = clamp(ceiling / 3, 2, 4);
      const n = Math.max(1, Math.ceil(run / offset));
      return (avg * run * top) / 0.425 / n;
    }
    case 'Accent':
      return clamp((avg * 6) / 0.5, 300, 1500);
    case 'FeaturePendant': {
      const a = region.length >= 3 ? area(region) : 16;
      const n = Math.max(1, roundHalfEven(a / 16));
      return clamp((avg * Math.max(a, 16)) / 0.45 / n, 600, 3500);
    }
    case 'CeilingGlow':
      return 1400;
    default:
      return 1500;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// §5 score

interface Scored {
  product: StudioProduct;
  score: number;
  fit: number;
}

function score(room: StudioRoom, intent: LightingIntent, p: StudioProduct, need: number, mount: number): Scored {
  const fam = family(p);
  const fit = familyFit(room, intent.kind, fam);
  let lumenFit: number;
  if (p.lumens <= 0 || need <= 0) lumenFit = 0.3;
  else {
    const r = Math.log(p.lumens / need);
    lumenFit = Math.exp(-(r * r) / (2 * 0.6 * 0.6));
  }
  let beamFit = 1;
  if (intent.kind === 'Accent') beamFit = p.beamAngle <= 40 ? 1 : clamp(40 / p.beamAngle, 0.3, 1);
  else if (
    (intent.kind === 'Ambient' || intent.kind === 'Task' || intent.kind === 'Path') &&
    (fam === 'downlight' || fam === 'downlight-ho')
  ) {
    const ideal = mount <= 10 ? 90 : mount <= 14 ? 60 : 40;
    const r = Math.log(Math.max(p.beamAngle, 10) / ideal);
    beamFit = Math.exp(-(r * r) / (2 * 0.5 * 0.5));
  }
  const efficacy = p.watts > 0 && p.lumens > 0 ? Math.min(1, p.lumens / p.watts / 130) : 0.5;
  const preference = productInProject(p) ? 0.17 : 0;
  return { product: p, score: 0.45 * fit + 0.2 * lumenFit + 0.1 * beamFit + 0.08 * efficacy + preference, fit };
}

// ---------------------------------------------------------------------------------------------------------------
// §7 reason

function ceilingText(mount: number): string {
  const inches = roundHalfEven(mount * 12);
  return inches % 12 === 0 ? `${inches / 12}${PRIME}` : feetInches(mount);
}

function reason(p: StudioProduct, kind: IntentKind, mount: number): string {
  const source = productInProject(p) ? 'In your project' : 'Generic stand-in';
  const lm = p.lumens > 0 ? `${formatGrouped(p.lumens)} lm ` : '';
  const beam = p.beamAngle > 0 && p.beamAngle < 170 ? `, ${format0(p.beamAngle)}° beam` : '';
  const F = ceilingText(mount);
  let context: string;
  switch (kind) {
    case 'WallWash': context = 'an even wash on a wall'; break;
    case 'Accent': context = 'an aimed accent'; break;
    case 'FeaturePendant': context = 'a feature over a surface'; break;
    case 'CeilingGlow': context = 'a glow on the ceiling'; break;
    case 'Task': context = `task light under a ${F} ceiling`; break;
    case 'Path': context = `a path under a ${F} ceiling`; break;
    default: context = `a ${F} ceiling`;
  }
  let text = `${source} · ${lm}${familyWord(family(p))}${beam} suits ${context}`;
  if (p.isGeneric) text += '; pick a product to place it';
  return text;
}

// ---------------------------------------------------------------------------------------------------------------
// §6 rank

/** Rank project products against the generic stand-in for an intent; returns the pick and its alternatives. */
export function rank(
  room: StudioRoom,
  intent: LightingIntent,
  project: readonly StudioProduct[] = asProject(),
): ProductChoice {
  const generic = genericFor(intent.kind, room);
  if (intent.kind === 'KeepDim') {
    return { product: generic, agentPicked: false, reason: 'Keep dim places no fixtures', alternatives: [] };
  }
  const need = needLumens(room, intent);
  const mount = ceilingAt(room, centerOf(intent));

  const seen = new Set<string>();
  const candidates: Scored[] = [];
  for (const p of project) {
    if (!productInProject(p) || p.isGeneric) continue;
    const k = productKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    candidates.push(score(room, intent, p, need, mount));
  }
  candidates.sort((a, b) => b.score - a.score);
  const genericScored = score(room, intent, generic, need, mount);
  const pool = [...candidates, genericScored].sort((a, b) => b.score - a.score);
  const best = pool[0]!;
  const bestKey = productKey(best.product);

  const siblings = packagesOf(best.product).filter((p) => productKey(p) !== bestKey);
  const siblingKeys = new Set(siblings.map(productKey));
  const alternatives: StudioProduct[] = [...siblings];

  const slots = new Set<string>();
  for (const c of candidates) {
    const k = productKey(c.product);
    if (k === bestKey || siblingKeys.has(k) || c.fit < 0.3) continue;
    const slot = isPackaged(c.product) ? `family:${family(c.product)}` : k;
    if (slots.has(slot)) continue;
    slots.add(slot);
    alternatives.push(c.product);
  }
  const genericKey = productKey(generic);
  if (bestKey !== genericKey && !siblingKeys.has(genericKey)) alternatives.push(generic);

  return {
    product: best.product,
    agentPicked: true,
    reason: reason(best.product, intent.kind, mount),
    alternatives: alternatives.slice(0, MAX_ALTERNATIVES),
  };
}

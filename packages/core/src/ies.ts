// IES LM-63 photometric files (PLAN.md §3 "Product library without a catalog"): parser, derived photometry and the
// bilinear candela lookup the estimate uses for products that carry a real distribution. Pure; never throws on input.
//
// Supported: LM-63-1986 (no header line), 1991 (`IESNA91`), 1995, 2002 (`IESNA:LM-63-…`), 2019 (`IES:LM-63-2019`);
// keywords with `[MORE]` continuation; TILT=NONE, TILT=INCLUDE (tilt table parsed and ignored) and TILT=<file>
// (ignored, warned); photometric type C only — types A and B (floodlight / automotive goniometry, vertical angles
// measured from the horizontal) are rejected with a clear error rather than approximated, because mapping them onto
// a type C frame silently would misplace the beam. Units feet or metres (converted to feet). Lumens −1 (absolute
// photometry) → flux from integrating the table.
//
// Angles: vertical 0° = nadir … 180° = zenith; horizontal counter-clockwise viewed from above, 0° = the luminaire's
// 0° plane (which the estimate aligns with the fixture's orientation heading). Horizontal symmetry shortcuts:
// a single angle (rotational), 0–90 (quadrant), 0–180 (bilateral about the 0–180 plane), 90–270 (bilateral about the
// 90–270 plane), 0–>180…360 (full; wraps to 360 when the file stops short).
import { format0 } from './format';
import { createProduct, type IesData, type StudioProduct } from './model';
import { family } from './ranker';

export type IesSymmetry = IesData['derived']['symmetry'];

export type IesParseResult = { ok: true; data: IesData; warnings: string[] } | { ok: false; error: string };

export const FEET_PER_METRE = 3.280839895013123;
/** Guard against hostile files: at most this many candela values. */
export const MAX_CANDELA_VALUES = 200_000;
/** Share of flux-weighted horizontal throw (|first moment| / flux) above which a distribution counts as asymmetric. */
export const ASYMMETRY_THRESHOLD = 0.1;
const DEG = Math.PI / 180;

const fail = (error: string): IesParseResult => ({ ok: false, error });

function headerFormat(first: string): string | null {
  const t = first.trim();
  let m = /^IES(?:NA)?\s*:?\s*LM-63-(\d{4})/i.exec(t);
  if (m) return `LM-63-${m[1]}`;
  m = /^IESNA\s*:?\s*(\d{2,4})\b/i.exec(t);
  if (m) {
    const y = m[1]!.length === 2 ? `19${m[1]}` : m[1]!;
    return `LM-63-${y}`;
  }
  return null;
}

/** Parse IES LM-63 text. Never throws: unreadable input gives `{ ok: false, error }`. */
export function parseIes(text: unknown): IesParseResult {
  try {
    return parseUnsafe(text);
  } catch (e) {
    return fail(`could not read the IES file (${e instanceof Error ? e.message : String(e)})`);
  }
}

function parseUnsafe(text: unknown): IesParseResult {
  if (typeof text !== 'string') return fail('IES input must be text');
  const src = text.replace(/^\uFEFF/, '');
  if (src.trim() === '') return fail('the IES file is empty');
  const lines = src.split(/\r\n|\r|\n/);
  const warnings: string[] = [];
  let format = headerFormat(lines[0] ?? '');
  let i = 0;
  if (format) i = 1;
  else format = 'LM-63-1986';

  const keywords: Record<string, string> = {};
  let last: string | null = null;
  let tilt: string | null = null;
  const freeText: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const t = /^\s*TILT\s*=\s*(.*?)\s*$/i.exec(line);
    if (t) {
      tilt = t[1]!;
      i++;
      break;
    }
    const k = /^\s*\[([^\]]{1,40})\]\s*(.*?)\s*$/.exec(line);
    if (k) {
      const key = k[1]!.trim().toUpperCase();
      const value = k[2]!;
      if (key === 'MORE' && last !== null) keywords[last] = `${keywords[last]}\n${value}`;
      else if (key in keywords && key !== 'MORE') keywords[key] = `${keywords[key]}\n${value}`;
      else {
        keywords[key] = value;
        last = key;
      }
    } else if (line.trim() !== '') freeText.push(line.trim());
  }
  if (tilt === null) return fail('missing TILT= line (not an IES LM-63 file)');
  // 1986 files (and sloppy later ones) carry free text instead of keywords.
  if (freeText.length > 0) keywords['TEXT'] = freeText.join('\n').slice(0, 4000);

  const rest = lines.slice(i).join(' ');
  const tokens = rest.split(/[\s,]+/).filter((s) => s !== '');
  let pos = 0;
  const num = (what: string): number => {
    const tok = tokens[pos];
    if (tok === undefined) throw new ParseError(`the file ends early: expected ${what}`);
    const v = Number(tok);
    if (!Number.isFinite(v)) throw new ParseError(`expected a number for ${what}, found "${tok.slice(0, 20)}"`);
    pos++;
    return v;
  };
  const count = (what: string, max: number): number => {
    const v = num(what);
    if (!Number.isInteger(v) || v < 1 || v > max) throw new ParseError(`${what} must be a whole number 1…${max}, found ${v}`);
    return v;
  };

  try {
    const tiltKind = tilt.toUpperCase();
    if (tiltKind === 'INCLUDE') {
      num('lamp-to-luminaire geometry');
      const n = num('number of tilt angles');
      if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new ParseError(`bad number of tilt angles ${n}`);
      for (let k = 0; k < 2 * n; k++) num('tilt table value');
      warnings.push('TILT=INCLUDE: the tilt table was read and ignored');
    } else if (tiltKind !== 'NONE') {
      warnings.push(`TILT=${tilt.slice(0, 60)}: external tilt file ignored`);
    }

    const lampCount = num('number of lamps');
    const lumensPerLamp = num('lumens per lamp');
    const multiplier = num('candela multiplier');
    const nV = count('number of vertical angles', 2000);
    const nH = count('number of horizontal angles', 2000);
    const type = num('photometric type');
    const units = num('units type');
    const width = num('luminous width');
    const length = num('luminous length');
    const height = num('luminous height');
    const ballast = num('ballast factor');
    const slot = num('ballast-lamp factor / future use');
    const watts = num('input watts');

    if (type === 2) return fail('type B photometry (floodlight goniometry) is not supported; export the file as type C');
    if (type === 3) return fail('type A photometry is not supported; export the file as type C');
    if (type !== 1) return fail(`unknown photometric type ${type} (expected 1 = type C)`);
    if (nV * nH > MAX_CANDELA_VALUES) return fail(`the candela table is too large (${nV} × ${nH})`);

    let scale = 1;
    if (units === 2) scale = FEET_PER_METRE;
    else if (units !== 1) warnings.push(`unknown units type ${units}; assuming feet`);

    if (!(ballast > 0)) warnings.push(`ballast factor ${ballast} is not positive; using 1`);
    let factor = multiplier * (ballast > 0 ? ballast : 1);
    // LM-63-1986/1991 carry a ballast-lamp photometric factor in this slot; 1995+ reserve it (2019: file type).
    if ((format === 'LM-63-1986' || format === 'LM-63-1991') && slot > 0) factor *= slot;
    if (!(multiplier > 0)) return fail(`candela multiplier must be positive, found ${multiplier}`);

    const vAngles: number[] = [];
    for (let k = 0; k < nV; k++) vAngles.push(num('vertical angle'));
    const hAngles: number[] = [];
    for (let k = 0; k < nH; k++) hAngles.push(num('horizontal angle'));
    const candela: number[][] = [];
    let negative = false;
    for (let h = 0; h < nH; h++) {
      const row: number[] = [];
      for (let v = 0; v < nV; v++) {
        let c = num(`candela value (${h + 1}, ${v + 1})`) * factor;
        if (c < 0) {
          negative = true;
          c = 0;
        }
        row.push(c);
      }
      candela.push(row);
    }
    if (negative) warnings.push('negative candela values were set to 0');
    if (pos < tokens.length) warnings.push(`${tokens.length - pos} trailing value(s) after the candela table ignored`);

    for (let k = 1; k < nV; k++)
      if (!(vAngles[k]! > vAngles[k - 1]!)) return fail('vertical angles must increase');
    for (let k = 1; k < nH; k++)
      if (!(hAngles[k]! > hAngles[k - 1]!)) return fail('horizontal angles must increase');
    if (vAngles[0]! < 0 || vAngles[nV - 1]! > 180) return fail('type C vertical angles must lie within 0…180°');
    if (nV < 2) return fail('at least two vertical angles are needed');
    const symmetry = symmetryOf(hAngles);
    if (symmetry === null)
      return fail(`unsupported horizontal angle range ${hAngles[0]}…${hAngles[nH - 1]}° for type C photometry`);

    const round = width < 0 || length < 0;
    const opening = {
      width: Math.abs(width) * scale,
      length: Math.abs(length) * scale,
      height: Math.abs(height) * scale,
      round,
    };
    if (watts <= 0) warnings.push('input watts missing or not positive');

    const table: IesTable = { verticalAngles: vAngles, horizontalAngles: hAngles, candela, symmetry };
    const derived = analyze(table);
    if (!(derived.lumens > 0)) return fail('the candela table carries no light');
    const data: IesData = {
      format,
      keywords,
      photometricType: 'C',
      lampCount,
      lampLumens: lumensPerLamp < 0 ? null : lumensPerLamp,
      inputWatts: Math.max(watts, 0),
      opening,
      verticalAngles: vAngles,
      horizontalAngles: hAngles,
      candela,
      derived: {
        lumens: derived.lumens,
        peakCandela: derived.peakCandela,
        beamAngle: derived.beamAngle,
        fieldAngle: derived.fieldAngle,
        uplightShare: derived.uplightShare,
        asymmetric: derived.asymmetric,
        symmetry,
      },
    };
    return { ok: true, data, warnings };
  } catch (e) {
    if (e instanceof ParseError) return fail(e.message);
    throw e;
  }
}

class ParseError extends Error {}

function symmetryOf(h: readonly number[]): IesSymmetry | null {
  const first = h[0]!;
  const last = h[h.length - 1]!;
  if (h.length === 1) return 'rotational';
  if (first === 0 && last === 90) return 'quadrant';
  if (first === 0 && last === 180) return 'bilateral';
  if (first === 90 && last === 270) return 'bilateral90';
  if (first === 0 && last > 180 && last <= 360) return 'full';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Full-circle table and lookup

export interface IesTable {
  verticalAngles: readonly number[];
  horizontalAngles: readonly number[];
  candela: readonly (readonly number[])[];
  symmetry: IesSymmetry;
}

/** The table expanded to horizontal angles covering [0, 360] (first row 0°, last 360°), ready for lookup. */
export interface ExpandedIes {
  v: Float64Array;
  h: Float64Array;
  /** rows[hIndex * nV + vIndex] */
  rows: Float64Array;
  nV: number;
  nH: number;
  /** True when every horizontal row is identical (rotational) — lookups skip the horizontal step. */
  rotational: boolean;
}

export function expandTable(t: IesTable): ExpandedIes {
  const hs = t.horizontalAngles;
  const pairs: { h: number; row: readonly number[] }[] = [];
  const add = (h: number, row: readonly number[]): void => {
    const prev = pairs[pairs.length - 1];
    if (prev && Math.abs(prev.h - h) < 1e-9) return;
    pairs.push({ h, row });
  };
  const rowAt = (k: number): readonly number[] => t.candela[k]!;
  const n = hs.length;
  switch (t.symmetry) {
    case 'rotational':
      add(0, rowAt(0));
      add(360, rowAt(0));
      break;
    case 'quadrant':
      for (let k = 0; k < n; k++) add(hs[k]!, rowAt(k));
      for (let k = n - 1; k >= 0; k--) add(180 - hs[k]!, rowAt(k));
      for (let k = 0; k < n; k++) add(180 + hs[k]!, rowAt(k));
      for (let k = n - 1; k >= 0; k--) add(360 - hs[k]!, rowAt(k));
      break;
    case 'bilateral':
      for (let k = 0; k < n; k++) add(hs[k]!, rowAt(k));
      for (let k = n - 1; k >= 0; k--) add(360 - hs[k]!, rowAt(k));
      break;
    case 'bilateral90': {
      // given 90…270; mirror about the 90–270 plane: I(h) = I(180 − h) for h in [0, 90) and (270, 360].
      const mirror = (h: number): number => {
        const m = 180 - h;
        return m < 0 ? m + 360 : m;
      };
      const out: { h: number; row: readonly number[] }[] = [];
      for (let k = 0; k < n; k++) out.push({ h: hs[k]!, row: rowAt(k) });
      for (let k = 0; k < n; k++) {
        const m = mirror(hs[k]!);
        if (m < 90 || m > 270) out.push({ h: m, row: rowAt(k) });
      }
      out.sort((a, b) => a.h - b.h);
      if (out[0]!.h > 0) out.unshift({ h: 0, row: out.find((o) => o.h === 180)?.row ?? rowAt(n >> 1) });
      for (const o of out) add(o.h, o.row);
      if (pairs[pairs.length - 1]!.h < 360) add(360, pairs[0]!.row);
      break;
    }
    case 'full':
      for (let k = 0; k < n; k++) add(hs[k]!, rowAt(k));
      if (pairs[pairs.length - 1]!.h < 360) add(360, rowAt(0));
      break;
  }
  const nV = t.verticalAngles.length;
  const rows = new Float64Array(pairs.length * nV);
  pairs.forEach((p, k) => rows.set(p.row, k * nV));
  return {
    v: Float64Array.from(t.verticalAngles),
    h: Float64Array.from(pairs.map((p) => p.h)),
    rows,
    nV,
    nH: pairs.length,
    rotational: t.symmetry === 'rotational',
  };
}

const expandedCache = new WeakMap<object, ExpandedIes>();
/** Cached full-circle table of parsed IES data (keyed by object identity). */
export function expandedOf(d: IesData): ExpandedIes {
  let e = expandedCache.get(d);
  if (!e) {
    e = expandTable({ ...d, symmetry: d.derived.symmetry });
    expandedCache.set(d, e);
  }
  return e;
}

/** Index k with a[k] ≤ x < a[k+1] (clamped to [0, n−2]); a ascending, n ≥ 2. */
function bracket(a: Float64Array, x: number): number {
  let lo = 0;
  let hi = a.length - 1;
  if (x <= a[0]!) return 0;
  if (x >= a[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Bilinear candela at vertical angle `v` and horizontal angle `h` (degrees). 0 outside the vertical range. */
export function candelaAt(t: ExpandedIes, v: number, h: number): number {
  const { v: va, nV, rows } = t;
  if (v < va[0]! || v > va[nV - 1]!) return 0;
  const j = bracket(va, v);
  const v0 = va[j]!;
  const fv = (v - v0) / (va[j + 1]! - v0);
  if (t.rotational) return rows[j]! + (rows[j + 1]! - rows[j]!) * fv;
  let hh = h % 360;
  if (hh < 0) hh += 360;
  const k = bracket(t.h, hh);
  const h0 = t.h[k]!;
  const fh = (hh - h0) / (t.h[k + 1]! - h0);
  const a = k * nV + j;
  const b = a + nV;
  const lo = rows[a]! + (rows[a + 1]! - rows[a]!) * fv;
  const hi = rows[b]! + (rows[b + 1]! - rows[b]!) * fv;
  return lo + (hi - lo) * fh;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived photometry

/** ∫ I(v) sin v dv over [a, b] (radians) for I linear from ia to ib — exact. */
function bandFlux(a: number, b: number, ia: number, ib: number): number {
  const d = b - a;
  if (d <= 0) return 0;
  const ca = Math.cos(a);
  const cb = Math.cos(b);
  return ia * (ca - cb) + ((ib - ia) / d) * (-d * cb + Math.sin(b) - Math.sin(a));
}

/** ∫ I(v) sin²v dv over [a, b] for I linear — Simpson on 8 sub-steps (smooth integrand). */
function bandMoment(a: number, b: number, ia: number, ib: number): number {
  const n = 8;
  const d = (b - a) / n;
  if (d <= 0) return 0;
  let s = 0;
  for (let k = 0; k <= n; k++) {
    const x = a + k * d;
    const i = ia + ((ib - ia) * k) / n;
    const s1 = Math.sin(x);
    const w = k === 0 || k === n ? 1 : k % 2 === 1 ? 4 : 2;
    s += w * i * s1 * s1;
  }
  return (s * d) / 3;
}

/** Per expanded row: down flux, up flux (per radian of horizontal angle) and horizontal moment. */
function rowIntegrals(t: ExpandedIes, k: number): { down: number; up: number; moment: number } {
  let down = 0;
  let up = 0;
  let moment = 0;
  const { v, nV, rows } = t;
  for (let j = 0; j + 1 < nV; j++) {
    let a = v[j]!;
    const b = v[j + 1]!;
    let ia = rows[k * nV + j]!;
    const ib = rows[k * nV + j + 1]!;
    if (a < 90 && b > 90) {
      const i90 = ia + ((ib - ia) * (90 - a)) / (b - a);
      down += bandFlux(a * DEG, 90 * DEG, ia, i90);
      moment += bandMoment(a * DEG, 90 * DEG, ia, i90);
      a = 90;
      ia = i90;
    }
    const f = bandFlux(a * DEG, b * DEG, ia, ib);
    if (b <= 90) down += f;
    else up += f;
    moment += bandMoment(a * DEG, b * DEG, ia, ib);
  }
  return { down, up, moment };
}

export interface IesDerived {
  lumens: number;
  peakCandela: number;
  beamAngle: number;
  fieldAngle: number;
  uplightShare: number;
  asymmetric: boolean;
  /** |horizontal first moment| / flux (0 = symmetric throw). */
  asymmetry: number;
  /** Local horizontal angle (deg) the light is thrown toward (meaningful when asymmetric). */
  throwAngle: number;
}

/** Flux, peak, beam/field angles, uplight share and asymmetry of a type C table. */
export function analyze(table: IesTable): IesDerived {
  const t = expandTable(table);
  const ints = Array.from({ length: t.nH }, (_, k) => rowIntegrals(t, k));
  let down = 0;
  let up = 0;
  let mx = 0;
  let my = 0;
  for (let k = 0; k + 1 < t.nH; k++) {
    const h0 = t.h[k]! * DEG;
    const h1 = t.h[k + 1]! * DEG;
    const dh = h1 - h0;
    const a = ints[k]!;
    const b = ints[k + 1]!;
    down += ((a.down + b.down) / 2) * dh;
    up += ((a.up + b.up) / 2) * dh;
    // moment: ∫ M(h)(cos h, sin h) dh with M linear in h — sub-sampled.
    const n = 16;
    for (let s = 0; s < n; s++) {
      const f = (s + 0.5) / n;
      const m = a.moment + (b.moment - a.moment) * f;
      const hh = h0 + dh * f;
      mx += m * Math.cos(hh) * (dh / n);
      my += m * Math.sin(hh) * (dh / n);
    }
  }
  const lumens = down + up;
  const uplightShare = lumens > 0 ? up / lumens : 0;
  const asymmetry = lumens > 0 ? Math.sqrt(mx * mx + my * my) / lumens : 0;
  let throwAngle = (Math.atan2(my, mx) * 180) / Math.PI;
  if (throwAngle < 0) throwAngle += 360;
  if (asymmetry < 1e-9) throwAngle = 0;

  // Beam/field: in the primary hemisphere (down unless most flux goes up), angle from the axis in the 0/180 and
  // 90/270 planes where intensity first falls below the fraction of the hemisphere peak, beyond the plane's own peak.
  const upward = up > down;
  const toV = (u: number): number => (upward ? 180 - u : u);
  let peak = 0;
  for (let k = 0; k < t.nH; k++)
    for (let j = 0; j < t.nV; j++) {
      const vj = t.v[j]!;
      if (upward ? vj >= 90 : vj <= 90) peak = Math.max(peak, t.rows[k * t.nV + j]!);
    }
  let allPeak = 0;
  for (let q = 0; q < t.rows.length; q++) allPeak = Math.max(allPeak, t.rows[q]!);
  const STEP = 0.05;
  const half = (h: number, frac: number): number => {
    const lim = peak * frac;
    let uPeak = 0;
    let best = -1;
    for (let u = 0; u <= 90 + 1e-9; u += STEP) {
      const c = candelaAt(t, toV(u), h);
      if (c > best) {
        best = c;
        uPeak = u;
      }
    }
    if (best < lim || best <= 0) return 0;
    let prevU = uPeak;
    let prevC = best;
    for (let u = uPeak + STEP; u <= 90 + 1e-9; u += STEP) {
      const c = candelaAt(t, toV(u), h);
      if (c < lim) return prevU + ((prevC - lim) / (prevC - c)) * (u - prevU);
      prevU = u;
      prevC = c;
    }
    return 90;
  };
  const full = (frac: number): number => {
    const p0 = half(0, frac) + half(180, frac);
    const p90 = half(90, frac) + half(270, frac);
    return (p0 + p90) / 2;
  };
  const r = (x: number): number => Math.round(x * 10) / 10;
  return {
    lumens,
    peakCandela: allPeak,
    beamAngle: r(full(0.5)),
    fieldAngle: r(full(0.1)),
    uplightShare,
    asymmetric: asymmetry > ASYMMETRY_THRESHOLD,
    asymmetry,
    throwAngle,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Product from IES

const firstLine = (s: string | undefined): string => (s ?? '').split('\n')[0]!.trim();

/** A project product built from a parsed file; family from the ranker's family rules. Not in the project yet. */
export function productFromIes(parsed: IesData, fileName = ''): StudioProduct {
  const kw = parsed.keywords;
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.ies$/i, '').trim();
  const name = firstLine(kw['LUMINAIRE']) || firstLine(kw['LUMCAT']) || base || 'IES luminaire';
  const brand = firstLine(kw['MANUFAC']);
  const catalog = firstLine(kw['LUMCAT']) || base;
  const d = parsed.derived;
  const lumens = Math.round(d.lumens);
  const watts = Math.round(parsed.inputWatts * 10) / 10;
  const o = parsed.opening;
  const length = o.length > 0 ? o.length : o.width > 0 ? o.width : 1;
  const width = o.width > 0 ? o.width : length;
  const draft = createProduct({
    label: `${name} · ${format0(lumens)} lm`.slice(0, 200),
    catalog: catalog.slice(0, 200),
    brand: brand.slice(0, 200),
    description: `${[name, firstLine(kw['LAMP'])].filter(Boolean).join(', ')}, ${format0(lumens)} lm, ${format0(watts)} W, ${format0(d.beamAngle)}° beam (IES)`.slice(0, 400),
    family: '',
    lumens,
    watts,
    length: Math.max(Math.max(length, width), 0.1),
    width: Math.max(Math.min(length, width), 0.1),
    isRound: o.round,
    beamAngle: d.beamAngle > 0 ? d.beamAngle : 90,
    uplightShare: d.uplightShare,
    asymmetric: d.asymmetric,
    isGeneric: false,
    ies: parsed,
  });
  return { ...draft, family: family(draft) };
}

/** Peak candela of an IES product scaled to `flux` lumens (the table's peak × flux / table flux); null without IES. */
export function iesPeakCandela(p: StudioProduct, flux = p.lumens): number | null {
  const d = p.ies?.derived;
  if (!d || !(d.lumens > 0)) return null;
  return (d.peakCandela * Math.max(flux, 0)) / d.lumens;
}

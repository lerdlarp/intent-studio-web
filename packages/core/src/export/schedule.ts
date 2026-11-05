// Fixture schedule CSV (RFC 4180) and the versioned design JSON document.
import { feetToMeters } from '../units';
import { ceilingAt } from '../geometry';
import { DesignDocumentSchema, SCHEMA_VERSION, type DesignDocument, type RoomDesign } from '../model';
import { productOf } from '../products';
import { intentCct } from './lights';

export type ExportUnits = 'imperial' | 'metric';

/** RFC 4180 field quoting: quote when it holds a comma, quote, CR or LF; double embedded quotes. */
export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: readonly (string | number)[]): string => cells.map(csvField).join(',');

export interface ScheduleRow {
  type: string;
  lumens: number;
  watts: number;
  cct: number;
  mount: string;
  height: number;
  x: number;
  y: number;
  intent: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One row per placed (non-suggestion) fixture, design order. Lengths are converted from feet. */
export function scheduleRows(design: RoomDesign, units: ExportUnits = 'imperial'): ScheduleRow[] {
  const conv = (ft: number) => round2(units === 'metric' ? feetToMeters(ft) : ft);
  const rows: ScheduleRow[] = [];
  for (const intent of design.intents) {
    if (intent.isSuggestion) continue;
    const p = productOf(design.room, intent);
    for (const f of intent.fixtures) {
      const height = f.height > 0 ? f.height : ceilingAt(design.room, f.center);
      rows.push({
        type: p?.label ?? '',
        lumens: p?.lumens ?? 0,
        watts: p?.watts ?? 0,
        cct: intentCct(design, intent),
        mount: f.mount,
        height: conv(height),
        x: conv(f.center.x),
        y: conv(f.center.y),
        intent: intent.label,
      });
    }
  }
  return rows;
}

export function scheduleCsv(design: RoomDesign, units: ExportUnits = 'imperial'): string {
  const len = units === 'metric' ? 'm' : 'ft';
  const rows = scheduleRows(design, units);
  const lines = [
    csvRow(['Type', 'Lumens', 'Watts', 'CCT (K)', 'Mount', `Height (${len})`, `X (${len})`, `Y (${len})`, 'Intent']),
    ...rows.map((r) => csvRow([r.type, r.lumens, r.watts, r.cct, r.mount, r.height, r.x, r.y, r.intent])),
    csvRow([
      `Total (${rows.length} fixtures)`,
      round2(rows.reduce((a, r) => a + r.lumens, 0)),
      round2(rows.reduce((a, r) => a + r.watts, 0)),
      '',
      '',
      '',
      '',
      '',
      '',
    ]),
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Versioned design document; the calculation snapshot is not exported. */
export function designDocument(design: RoomDesign): DesignDocument {
  return { schemaVersion: SCHEMA_VERSION, design: { ...design, calculation: null } };
}

export function designJson(design: RoomDesign): string {
  return JSON.stringify(designDocument(design), null, 2) + '\n';
}

/** Parse + validate an exported document (throws a ZodError / SyntaxError on bad input). */
export function parseDesignJson(text: string): DesignDocument {
  return DesignDocumentSchema.parse(JSON.parse(text));
}

/** Filesystem-safe file stem from a room label. */
export function fileStem(label: string, fallback = 'room'): string {
  const s = label
    .normalize('NFKD')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return s.length > 0 ? s.slice(0, 60) : fallback;
}

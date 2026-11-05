// AI eval (PLAN Phase 4): runs the four demo rooms + three imported-style rooms through advise, interpret, classify
// and propose via the server's AI runner directly (not HTTP), then checks every output:
//   valid schema · targets inside the target table's range ±25 % · no forbidden words · labels ≤ 40 · reasons ≤ 90 ·
//   designer-edited fields (label, target, plane, cct) untouched after applying advice.
// The model client is injected: the real Claude client when ANTHROPIC_API_KEY is set (run.ts), a fake in tests, or
// none (rules fallback).
import {
  CCT_VALUES,
  IntentAdviceSchema,
  LightingIntentSchema,
  MAX_LABEL,
  MAX_REASON,
  OBJECT_KINDS,
  TARGET_TABLE,
  allDemoRooms,
  applyAdviceWithCct,
  defaultTarget,
  planeEquals,
  seed,
  targetEquals,
  withDefaultCct,
  type IntentKind,
  type LightingIntent,
  type RoomObjectInfo,
  type StudioRoom,
  type TargetRange,
} from '../../packages/core/src/index';
import { assembleRoom } from '../../packages/scene/src/room-build';
import { openDb } from '../../apps/server/src/db';
import { configFromEnv, type ServerConfig } from '../../apps/server/src/config';
import type { ClaudeClient } from '../../apps/server/src/ai/claude';
import { AiRunner, type AiResponse } from '../../apps/server/src/ai/run';
import { adviseTask, classifyTask, interpretTask, proposeTask } from '../../apps/server/src/ai/tasks';
import { fallbackKindOf } from '../../apps/server/src/ai/prompts/classify';
import { forbiddenPattern } from '../forbidden-terms.mjs';

export const TARGET_TOLERANCE = 0.25;
export const MAX_RATIONALE = 90;

// ---- rooms ----------------------------------------------------------------------------------------------------

export interface EvalRoom {
  name: string;
  room: StudioRoom;
  /** Five fixed designer phrases for `interpret`. */
  phrases: readonly string[];
  imported: boolean;
}

const obj = (name: string, x: number, y: number, length: number, width: number, top: number, bottom = 0): RoomObjectInfo => ({
  name,
  // as the import flow does before the agent sees them: kind from the name rules
  kind: fallbackKindOf({ name }),
  center: { x, y },
  length,
  width,
  orientation: 0,
  top,
  bottom,
});
const rectLoop = (w: number, d: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
];

/** Three small rooms built the way the import pipeline builds them (packages/scene assembleRoom). */
export function importedRooms(): StudioRoom[] {
  const desks: RoomObjectInfo[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) desks.push(obj(`Student desk ${r * 4 + c + 1}`, 6 + c * 6, 6 + r * 5, 4, 2, 2.5));
  const classroom = assembleRoom({
    label: '112 Classroom',
    spaceType: 'classroom',
    outline: rectLoop(30, 24),
    ceilingHeight: 9.5,
    openings: (i) => (i === 0 ? [{ kind: 'door', from: 2, to: 5, bottom: 0, top: 7 }] : i === 3 ? [{ kind: 'window', from: 4, to: 20, bottom: 3, top: 8 }] : []),
    objects: [...desks, obj('Teacher desk', 15, 20.5, 5, 2.5, 2.5), obj('Whiteboard', 15, 23.8, 12, 0.2, 7, 3), obj('Bookcase', 28.5, 12, 1.2, 6, 6)],
  });
  const corridor = assembleRoom({
    label: '1st floor corridor',
    spaceType: 'corridor',
    outline: rectLoop(60, 8),
    ceilingHeight: 9,
    openings: (i) => (i === 0 ? [10, 30, 50].map((a) => ({ kind: 'door', from: a, to: a + 3, bottom: 0, top: 7 })) : []),
    objects: [obj('Artwork 1', 20, 7.8, 4, 0.1, 6, 3), obj('Artwork 2', 40, 7.8, 4, 0.1, 6, 3), obj('Bench', 30, 7, 6, 1.5, 1.5), obj('Exit sign', 59.8, 4, 0.1, 1.2, 7.5, 7)],
  });
  const retail = assembleRoom({
    label: 'Retail shop',
    spaceType: 'retail',
    outline: rectLoop(36, 28),
    ceilingHeight: 12,
    openings: (i) => (i === 0 ? [{ kind: 'door', from: 15, to: 21, bottom: 0, top: 8 }, { kind: 'window', from: 2, to: 13, bottom: 1, top: 10 }] : []),
    objects: [
      obj('Display table A', 12, 10, 6, 3, 3),
      obj('Display table B', 24, 10, 6, 3, 3),
      obj('Wall shelving', 18, 27.3, 24, 1.2, 7),
      obj('Checkout counter', 30, 22, 8, 2.5, 3.5),
      obj('Mirror', 0.2, 18, 0.1, 3, 7, 1),
      obj('Mannequin', 6, 6, 2, 2, 6),
    ],
  });
  return [classroom, corridor, retail];
}

const PHRASES: Readonly<Record<string, readonly string[]>> = {
  default: ['brighter desks', 'wash the north wall', 'keep the screen dim', 'add a soft ceiling glow', 'accent the artwork'],
  '204 Open office': ['brighter desks', 'wash the east wall', 'keep the screen dim', 'add ambient light', 'about 30 fc on the desks'],
  Cafeteria: ['pendants over the tables', 'brighter servery counter', 'wash the north wall', 'softer ambient', 'accent the menu boards'],
  'Entry lobby': ['accent the feature wall', 'task light on the reception desk', 'a path to the elevators', 'wash the north wall', 'ceiling glow over the lounge'],
  'Data hall': ['light the rack rows', 'path along the aisles', 'brighter cold aisles', 'ambient light', 'wash the west wall'],
  '112 Classroom': ['brighter student desks', 'wash the whiteboard wall', 'ambient light', 'task light on the teacher desk', 'keep the window wall dim'],
  '1st floor corridor': ['a path down the corridor', 'accent the artwork', 'wash the north wall', 'soft ambient', 'ceiling glow'],
  'Retail shop': ['accent the display tables', 'wash the north wall', 'brighter checkout counter', 'ambient light', 'accent the mannequin'],
};
const phrasesFor = (room: StudioRoom): readonly string[] => {
  for (const [k, v] of Object.entries(PHRASES)) if (k !== 'default' && room.label.includes(k)) return v;
  return PHRASES.default!;
};

export function evalRooms(): EvalRoom[] {
  const demo = allDemoRooms().map((room) => ({ name: room.label, room, phrases: phrasesFor(room), imported: false }));
  const imp = importedRooms().map((room) => ({ name: room.label, room, phrases: phrasesFor(room), imported: true }));
  return [...demo, ...imp];
}

// ---- checks ---------------------------------------------------------------------------------------------------

export interface Failure {
  task: string;
  room: string;
  check: string;
  detail: string;
}

/** Allowed band for a target of `kind`: every table row of the kind plus the intent's own default, widened ±25 %. */
export function targetBand(room: StudioRoom, intent: Pick<LightingIntent, 'kind' | 'objectIndex'>): { lo: number; hi: number } {
  const ranges: TargetRange[] = TARGET_TABLE.filter((r) => r.kind === intent.kind).map((r) => ({ minimum: r.min, average: r.avg, maximum: r.max }));
  const ambient = intent.kind === 'Accent' ? defaultTarget(room, 'Ambient', null, null).target.average : null;
  ranges.push(defaultTarget(room, intent.kind, intent.objectIndex, ambient).target);
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of ranges) {
    const vals = [t.minimum, t.average, t.maximum].filter((v): v is number => v !== null);
    if (vals.length === 0) continue;
    lo = Math.min(lo, ...vals);
    hi = Math.max(hi, ...vals);
  }
  if (intent.kind === 'KeepDim') lo = 0;
  return { lo: lo * (1 - TARGET_TOLERANCE), hi: hi * (1 + TARGET_TOLERANCE) };
}

/** The part of a zod schema the checks use (zod is resolved through core, not imported here). */
interface SafeParser {
  safeParse(v: unknown): { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } };
}

class Checker {
  failures: Failure[] = [];
  checks = 0;
  private readonly forbidden = forbiddenPattern();
  constructor(
    private task: string,
    private room: string,
  ) {}
  fail(check: string, detail: string): void {
    this.failures.push({ task: this.task, room: this.room, check, detail });
  }
  ok(cond: boolean, check: string, detail: string): void {
    this.checks++;
    if (!cond) this.fail(check, detail);
  }
  schema(schema: SafeParser, value: unknown, what: string): void {
    const r = schema.safeParse(value);
    this.ok(r.success, 'schema', `${what}: ${r.success ? '' : (r.error?.issues ?? []).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  noForbidden(value: unknown): void {
    const text = JSON.stringify(value);
    this.ok(!this.forbidden.test(text), 'forbidden-words', `output contains an excluded term`);
  }
  label(label: string, what: string): void {
    this.ok(label.length <= MAX_LABEL, 'label-length', `${what}: "${label}" is ${label.length} chars`);
  }
  reason(reason: string, what: string): void {
    this.ok(reason.length <= MAX_REASON, 'reason-length', `${what}: reason is ${reason.length} chars`);
  }
  target(room: StudioRoom, intent: Pick<LightingIntent, 'kind' | 'objectIndex'>, t: TargetRange, what: string): void {
    const { lo, hi } = targetBand(room, intent);
    for (const v of [t.minimum, t.average, t.maximum]) {
      if (v === null) continue;
      this.ok(v >= lo - 1e-9 && v <= hi + 1e-9, 'target-range', `${what}: ${v} fc outside ${lo.toFixed(1)}–${hi.toFixed(1)} fc (${intent.kind})`);
    }
  }
  cct(cct: number | undefined, what: string): void {
    this.ok(cct === undefined || (CCT_VALUES as readonly number[]).includes(cct), 'cct', `${what}: ${cct} K not in the set`);
  }
  intent(room: StudioRoom, i: LightingIntent, what: string): void {
    this.schema(LightingIntentSchema, i, what);
    this.label(i.label, what);
    this.reason(i.targetReason, what);
    this.ok(i.wallIndex === null || (i.wallIndex >= 0 && i.wallIndex < room.walls.length), 'index', `${what}: wall ${i.wallIndex}`);
    this.ok(i.objectIndex === null || (i.objectIndex >= 0 && i.objectIndex < room.objects.length), 'index', `${what}: object ${i.objectIndex}`);
    this.ok(i.fixtures.length === 0, 'no-fixtures', `${what}: the AI path must not place fixtures`);
    this.target(room, i, i.target, what);
    this.cct(i.behavior.cct, what);
  }
}

// ---- designer-edited intents ------------------------------------------------------------------------------------

/** Accepted seed intents (with default CCTs); the first four carry a designer edit each: label, target, plane, cct. */
export function designerIntents(room: StudioRoom): { intents: LightingIntent[]; edited: Map<string, 'label' | 'target' | 'plane' | 'cct'> } {
  const intents = seed(room).map((i) => withDefaultCct(room, { ...i, isSuggestion: false }));
  const edited = new Map<string, 'label' | 'target' | 'plane' | 'cct'>();
  const fields = ['label', 'target', 'plane', 'cct'] as const;
  intents.slice(0, 4).forEach((i, k) => {
    const f = fields[k]!;
    edited.set(i.id, f);
    if (f === 'label') {
      i.label = 'Designer label';
      i.labelSuggested = false;
    } else if (f === 'target') {
      i.target = i.kind === 'KeepDim' ? { minimum: null, average: null, maximum: 3 } : { minimum: 12, average: 24, maximum: 40 };
      i.targetReason = 'Typed by the designer';
      i.targetEdited = true;
    } else if (f === 'plane') {
      i.plane = i.plane.kind === 'Vertical' ? { ...i.plane, bottom: 1, top: 7, inferred: false, reason: 'Set by the designer' } : { ...i.plane, height: 2.25, inferred: false, reason: 'Set by the designer' };
    } else {
      i.behavior = { ...i.behavior, cct: 2700 };
      i.cctSuggested = false;
    }
  });
  return { intents, edited };
}

// ---- run --------------------------------------------------------------------------------------------------------

export interface TaskRecord {
  task: 'advise' | 'interpret' | 'classify' | 'propose';
  room: string;
  input?: unknown;
  source: 'ai' | 'rules';
  lastIssue?: string;
  result: unknown;
}

export interface EvalReport {
  mode: 'live' | 'fallback';
  model: string | null;
  startedAt: string;
  records: TaskRecord[];
  failures: Failure[];
  checks: number;
  summary: Record<string, { calls: number; ai: number; rules: number; failures: number }>;
}

export interface EvalOptions {
  claude: ClaudeClient | null;
  config?: Partial<ServerConfig>;
  rooms?: EvalRoom[];
  now?: () => Date;
}

const rec = <T>(task: TaskRecord['task'], room: string, r: AiResponse<T>, input?: unknown): TaskRecord => ({
  task,
  room,
  ...(input !== undefined ? { input } : {}),
  source: r.source,
  ...(r.lastIssue ? { lastIssue: r.lastIssue } : {}),
  result: r.result,
});

export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const startedAt = (opts.now ?? (() => new Date()))().toISOString();
  const db = openDb(':memory:');
  const config: ServerConfig = { ...configFromEnv({}), aiBudgetPerMinute: 1_000_000, ...opts.config };
  const ai = new AiRunner(db, config, opts.claude);
  const records: TaskRecord[] = [];
  const checkers: Checker[] = [];
  try {
    for (const { name, room, phrases } of opts.rooms ?? evalRooms()) {
      // advise: accepted seed intents, four of them designer-edited
      {
        const c = new Checker('advise', name);
        checkers.push(c);
        const { intents, edited } = designerIntents(room);
        const r = await adviseTask(ai, { room, intents });
        records.push(rec('advise', name, r));
        c.schema(IntentAdviceSchema.array(), r.result, 'advice list');
        c.noForbidden(r.result);
        c.ok(r.result.length === intents.length, 'schema', `advice for ${r.result.length} of ${intents.length} intents`);
        for (const a of r.result) {
          const i = intents.find((x) => x.id === a.intentId);
          if (!i) {
            c.fail('schema', `advice for unknown intent ${a.intentId}`);
            continue;
          }
          const what = `${i.label} (${i.kind})`;
          c.label(a.label, what);
          c.reason(a.reason, what);
          c.target(room, i, a.target, what);
          c.cct(a.cct, what);
          const after = applyAdviceWithCct(i, a);
          const field = edited.get(i.id);
          if (field === 'label') c.ok(after.label === i.label && !after.labelSuggested, 'designer-edit', `${what}: label changed to "${after.label}"`);
          if (field === 'target')
            c.ok(targetEquals(after.target, i.target) && after.targetReason === i.targetReason, 'designer-edit', `${what}: target changed`);
          if (field === 'plane') c.ok(planeEquals(after.plane, i.plane) && !after.plane.inferred, 'designer-edit', `${what}: plane changed`);
          if (field === 'cct') c.ok(after.behavior.cct === 2700 && after.cctSuggested === false, 'designer-edit', `${what}: cct changed to ${after.behavior.cct}`);
          c.ok(after.fixtures === i.fixtures, 'no-fixtures', `${what}: advice touched fixtures`);
        }
      }
      // interpret: five fixed phrases
      for (const text of phrases) {
        const c = new Checker('interpret', name);
        checkers.push(c);
        const r = await interpretTask(ai, { room, text });
        records.push(rec('interpret', name, r, text));
        c.noForbidden(r.result);
        c.ok(r.result.length <= 12, 'schema', `${r.result.length} intents for "${text}"`);
        r.result.forEach((i, k) => c.intent(room, i, `"${text}" #${k}`));
      }
      // classify: the room's object names
      if (room.objects.length > 0) {
        const c = new Checker('classify', name);
        checkers.push(c);
        const objects = room.objects.slice(0, 100).map((o, index) => ({ index, name: o.name, length: o.length, width: o.width, top: o.top, bottom: o.bottom }));
        const r = await classifyTask(ai, { objects });
        records.push(rec('classify', name, r, objects.map((o) => o.name)));
        c.noForbidden(r.result);
        for (const x of r.result)
          c.ok(
            Object.keys(x).sort().join(',') === 'index,kind' && Number.isInteger(x.index) && (OBJECT_KINDS as readonly string[]).includes(x.kind),
            'schema',
            `classify row ${JSON.stringify(x)}`,
          );
        c.ok(
          r.result.length === objects.length && r.result.every((x, k) => x.index === objects[k]!.index),
          'schema',
          'one result per sent object, in order',
        );
      }
      // propose: the whole room + the designer's intents
      {
        const c = new Checker('propose', name);
        checkers.push(c);
        const { intents } = designerIntents(room);
        const current = intents.slice(0, 2).map((i) => ({ id: i.id, kind: i.kind, label: i.label, wallIndex: i.wallIndex, objectIndex: i.objectIndex }));
        const r = await proposeTask(ai, { room, intents: current });
        records.push(rec('propose', name, r));
        c.noForbidden(r.result);
        c.ok(r.result.length >= 1 && r.result.length <= 8, 'schema', `${r.result.length} proposals`);
        r.result.forEach((i, k) => {
          const what = `proposal #${k} ${i.label} (${i.kind as IntentKind})`;
          c.intent(room, i, what);
          c.ok(i.isSuggestion, 'schema', `${what}: not a suggestion`);
          c.ok(!current.some((x) => x.id === i.id), 'designer-edit', `${what}: reuses a designer intent id`);
          for (const t of i.trace.filter((x) => x.startsWith('Agent: ')))
            c.ok(t.length - 'Agent: '.length <= MAX_RATIONALE, 'reason-length', `${what}: rationale ${t.length} chars`);
        });
      }
    }
  } finally {
    db.close();
  }
  const failures = checkers.flatMap((c) => c.failures);
  const summary: EvalReport['summary'] = {};
  for (const r of records) {
    const s = (summary[r.task] ??= { calls: 0, ai: 0, rules: 0, failures: 0 });
    s.calls++;
    s[r.source]++;
  }
  for (const f of failures) (summary[f.task] ??= { calls: 0, ai: 0, rules: 0, failures: 0 }).failures++;
  return {
    mode: opts.claude ? 'live' : 'fallback',
    model: opts.claude?.model ?? null,
    startedAt,
    records,
    failures,
    checks: checkers.reduce((n, c) => n + c.checks, 0),
    summary,
  };
}

/** Human summary (one line per task, then failures). */
export function formatSummary(r: EvalReport): string {
  const lines = [`AI eval — ${r.mode}${r.model ? ` (${r.model})` : ''} — ${r.checks} checks, ${r.failures.length} failures`];
  for (const [task, s] of Object.entries(r.summary))
    lines.push(`  ${task.padEnd(10)} ${String(s.calls).padStart(3)} calls · ai ${s.ai} · rules ${s.rules} · failures ${s.failures}`);
  for (const f of r.failures.slice(0, 50)) lines.push(`  ✗ [${f.task}] ${f.room}: ${f.check} — ${f.detail}`);
  if (r.failures.length > 50) lines.push(`  … ${r.failures.length - 50} more`);
  return lines.join('\n');
}

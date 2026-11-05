// The AI eval script (scripts/eval) with the fake model: the live path end to end, without a key or network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalRooms, formatSummary, runEval, targetBand } from '../../../scripts/eval/lib';
import { writeReport } from '../../../scripts/eval/run';
import { office } from '@intent-studio/core';
import type { ClaudeRequest } from '../src/ai/claude';
import { FakeClaude } from './helpers';

const kindOf = (req: ClaudeRequest): string => /<host-guidance kind="([^"]+)">/.exec(req.user)?.[1] ?? '';
const ids = (req: ClaudeRequest): string[] => [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
interface AdviceHost {
  intents: { id: string; defaults: { target: unknown; plane: { kind: string } } | null }[];
}
const host = (req: ClaudeRequest): AdviceHost =>
  JSON.parse(/<host-guidance kind="studio-advice">([\s\S]*?)<\/host-guidance>/.exec(req.user)![1]!) as AdviceHost;
const indices = (req: ClaudeRequest): number[] => [...req.user.matchAll(/"index":(\d+)/g)].map((m) => Number(m[1]));

/** A well-behaved model that still tries to change every advised field (designer edits must survive it). */
const goodModel = () =>
  new FakeClaude((req) => {
    switch (kindOf(req)) {
      case 'studio-advice':
        return JSON.stringify(
          host(req).intents.map((i) => ({
            id: i.id,
            label: 'Agent label',
            target: i.defaults?.target ?? null, // keeps the table row it was given
            plane: i.defaults?.plane.kind === 'horizontal' ? { kind: 'horizontal', height: 3 } : i.defaults?.plane,
            reason: 'Typical range from the target table',
            cct: 3000,
          })),
        );
      case 'studio-interpret':
        return '[{"kind":"ambient","wall":null,"object":null,"level":null}]';
      case 'studio-classify':
        return JSON.stringify(indices(req).map((index) => ({ index, kind: 'other' })));
      case 'studio-propose':
        return JSON.stringify([
          { kind: 'ambient', reason: 'General light for the room', cct: 3500 },
          { kind: 'wash', wall: 0, cct: 3000, reason: 'Warm the first wall' },
        ]);
      default:
        return '';
    }
  });

describe('eval script (fake model)', () => {
  it('rooms: four demo rooms + three imported, five phrases each', () => {
    const rooms = evalRooms();
    expect(rooms).toHaveLength(7);
    expect(rooms.filter((r) => r.imported).map((r) => r.name)).toEqual(['112 Classroom', '1st floor corridor', 'Retail shop']);
    expect(rooms.every((r) => r.phrases.length === 5)).toBe(true);
  });

  it('live path: every task answered by the model, all assertions pass, designer edits untouched', async () => {
    const fake = goodModel();
    const report = await runEval({ claude: fake });
    expect(report.mode).toBe('live');
    expect(report.failures).toEqual([]);
    expect(report.records.every((r) => r.source === 'ai')).toBe(true);
    expect(report.summary).toMatchObject({ advise: { calls: 7 }, interpret: { calls: 35 }, classify: { calls: 7 }, propose: { calls: 7 } });
    expect(fake.calls).toHaveLength(56);
    expect(formatSummary(report)).toContain('0 failures');
  });

  it('fallback path (no model) passes', async () => {
    const report = await runEval({ claude: null });
    expect(report.mode).toBe('fallback');
    expect(report.failures).toEqual([]);
    expect(report.records.every((r) => r.source === 'rules')).toBe(true);
  });

  it('catches a bad model: excluded words and out-of-range targets', async () => {
    const term = ['Photometry', 'Id'].join('');
    const fake = new FakeClaude((req) =>
      kindOf(req) === 'studio-advice'
        ? JSON.stringify(ids(req).map((id) => ({ id, label: `${term} pick`, target: { min: 150, avg: 180, max: 200 } })))
        : 'nonsense',
    );
    const report = await runEval({ claude: fake, rooms: evalRooms().slice(0, 1) });
    const checks = new Set(report.failures.map((f) => f.check));
    expect(checks.has('forbidden-words')).toBe(true);
    expect(checks.has('target-range')).toBe(true);
    expect(report.failures.every((f) => f.task === 'advise')).toBe(true);
  });

  it('target band: table rows of the kind ±25 %', () => {
    expect(targetBand(office(), { kind: 'Path', objectIndex: null })).toEqual({ lo: 0.75, hi: 12.5 });
    expect(targetBand(office(), { kind: 'KeepDim', objectIndex: null })).toEqual({ lo: 0, hi: 6.25 });
  });

  it('writes one JSON file per task plus summary.json', async () => {
    const report = await runEval({ claude: null, rooms: evalRooms().slice(4, 5), now: () => new Date('2026-01-02T03:04:05.006Z') });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
    try {
      const dir = writeReport(report, root);
      expect(path.basename(dir)).toBe('2026-01-02T03-04-05-006Z');
      expect(fs.readdirSync(dir).sort()).toEqual(['advise.json', 'classify.json', 'interpret.json', 'propose.json', 'summary.json']);
      const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
      expect(summary).toMatchObject({ mode: 'fallback', failures: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

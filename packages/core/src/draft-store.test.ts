import { describe, expect, it } from 'vitest';
import { createIntent, createProduct } from './model';
import { office } from './fixtures/demo-rooms';
import { fitDraft, slimIntent, toDraftDocument } from './draft-store';

const room = office();

describe('draft store', () => {
  it('drops references the room no longer has', () => {
    const it1 = createIntent({ kind: 'Accent', region: [{ x: 1, y: 1 }], objectIndex: 99, wallIndex: 40 });
    const r = fitDraft(toDraftDocument([it1]), room);
    expect(r.ok).toBe(true);
    expect(r.intents[0]?.objectIndex).toBeNull();
    expect(r.intents[0]?.wallIndex).toBeNull();
  });
  it('keeps valid references', () => {
    const it1 = createIntent({ region: [{ x: 1, y: 1 }], objectIndex: 7, wallIndex: 3 });
    const r = fitDraft(toDraftDocument([it1]), room);
    expect(r.intents[0]).toMatchObject({ objectIndex: 7, wallIndex: 3 });
  });
  it('negative indices become null', () => {
    const it1 = createIntent({ region: [], objectIndex: -1, wallIndex: -2 });
    const r = fitDraft(toDraftDocument([it1]), room);
    expect(r.intents[0]).toMatchObject({ objectIndex: null, wallIndex: null });
  });
  it('wrong version, junk and missing intents are not ok', () => {
    expect(fitDraft({ version: 2, intents: [] }, room)).toEqual({ ok: false, intents: [] });
    expect(fitDraft(null, room)).toEqual({ ok: false, intents: [] });
    expect(fitDraft('x', room)).toEqual({ ok: false, intents: [] });
    expect(fitDraft({ version: 1 }, room)).toEqual({ ok: false, intents: [] });
  });
  it('drops null intents, null regions and schema failures; ok even when empty', () => {
    const r = fitDraft({ version: 1, intents: [null, { id: 'a', region: null }, { id: 'b', region: [{ x: 'no' }] }] }, room);
    expect(r).toEqual({ ok: true, intents: [] });
  });
  it('slims: alternatives and trace removed, points rounded to 4 decimals', () => {
    const p = createProduct({ label: 'x' });
    const it1 = createIntent({
      region: [{ x: 1.234567, y: 2.5 }],
      trace: ['t'],
      product: { product: p, agentPicked: true, reason: 'r', alternatives: [p] },
    });
    const s = slimIntent(it1);
    expect(s.trace).toEqual([]);
    expect(s.product?.alternatives).toEqual([]);
    expect(s.region[0]).toEqual({ x: 1.2346, y: 2.5 });
    expect(it1.trace).toEqual(['t']);
  });
  it('reads the original PascalCase encoding with [x, y] points', () => {
    const doc = {
      Version: 1,
      Intents: [
        {
          Id: 'abc',
          Kind: 'WallWash',
          Label: null,
          Region: [[1, 2], [3, 4]],
          WallIndex: 99,
          ObjectIndex: 1,
          Target: { Minimum: 1, Average: 2, Maximum: 3 },
          TargetReason: null,
          Plane: { Kind: 'Vertical', Height: 2.5, Bottom: 0, Top: 9, Inferred: true, Reason: '' },
          Behavior: { Pattern: 'Rows' },
          Fixtures: null,
        },
      ],
    };
    const r = fitDraft(doc, room);
    expect(r.ok).toBe(true);
    const i = r.intents[0];
    expect(i?.region).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(i?.wallIndex).toBeNull();
    expect(i?.objectIndex).toBe(1);
    expect(i?.label).toBe('');
    expect(i?.target.average).toBe(2);
    expect(i?.behavior.pattern).toBe('rows');
    expect(i?.labelSuggested).toBe(true);
  });
});

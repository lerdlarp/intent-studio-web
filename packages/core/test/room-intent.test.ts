// Room intent (core/room-intent.ts): hard-coded demo drafts, rules fallback, defensive parsing, applying a draft.
import { describe, expect, it } from 'vitest';
import { DEMO_ROOM_NAMES, demoRoom } from '../src/fixtures/demo-rooms';
import { createRoom } from '../src/model';
import {
  DEMO_INTENTS,
  applyRoomIntent,
  briefSentence,
  demoDraft,
  parseRoomIntentDraft,
  rulesDraft,
  targetForLevel,
} from '../src/room-intent';
import { seed } from '../src/suggestions';
import { contains } from '../src/geometry';
import { solveAll } from '../src/solver';
import type { RoomDesign } from '../src/model';

describe('demo drafts', () => {
  for (const name of DEMO_ROOM_NAMES)
    it(`${name}: hard-coded, matched by room id, every accepted pick finds a seeded suggestion`, () => {
      const room = demoRoom(name);
      const d = demoDraft(room);
      expect(d).toEqual(DEMO_INTENTS[name]);
      expect(d!.brief.source).toBe('demo');
      const intents = seed(room);
      const applied = applyRoomIntent(room, intents, d!);
      const accepted = d!.zones.filter((z) => z.accept).length;
      expect(applied.changed.length).toBe(1 + accepted); // base + each accepted pick
      // picks left unaccepted stay suggestions
      expect(applied.intents.filter((i) => i.isSuggestion).length).toBe(intents.length - 1 - accepted);
      // no fixtures placed: the solver does that
      expect(applied.intents.every((i) => i.fixtures.length === 0)).toBe(true);
    });

  it('the cafeteria reads as its brief', () => {
    expect(briefSentence(DEMO_INTENTS.Cafeteria.brief)).toBe(
      'This is a cafeteria for social dining. Keep it warm (3000 K) at about 15 fc measured at table height.',
    );
  });

  it('a room that is not a demo has no demo draft', () => {
    expect(demoDraft(createRoom({ spaceType: 'cafeteria' }))).toBeNull();
  });
});

describe('rules draft', () => {
  it('drafts from the room class and its base intent, and takes no zones', () => {
    const room = demoRoom('Cafeteria');
    const d = rulesDraft(room, seed(room));
    expect(d.brief).toMatchObject({ spaceType: 'cafeteria', purpose: 'social dining', level: 15, measuredAt: 2.5, source: 'rules' });
    expect(d.zones).toEqual([]);
  });
  it('works with no intents at all', () => {
    const d = rulesDraft(createRoom({ label: 'Lab' }), []);
    expect(d.brief.level).toBe(15);
    expect(d.brief.purpose).toBe('general use');
  });
});

describe('parseRoomIntentDraft (untrusted)', () => {
  const fb = DEMO_INTENTS.Lobby;
  it('keeps the fallback per field and clamps numbers', () => {
    const r = parseRoomIntentDraft(
      { brief: { purpose: 'events\nand\u0007 more', cct: 3100, level: 9999, measuredAt: -4, note: 42 }, zones: 'x' },
      fb,
      'ai',
    );
    expect(r.draft.brief.purpose).toBe('events and more');
    expect(r.draft.brief.cct).toBe(fb.brief.cct);
    expect(r.draft.brief.level).toBe(200);
    expect(r.draft.brief.measuredAt).toBe(0);
    expect(r.draft.brief.note).toBe(fb.brief.note);
    expect(r.draft.brief.source).toBe('ai');
    expect(r.draft.zones).toEqual(fb.zones);
    expect(r.fromFallback).toEqual(expect.arrayContaining(['cct', 'note', 'zones', 'spaceType']));
  });
  it('drops bad zone rows, keeps good ones', () => {
    const r = parseRoomIntentDraft(
      { brief: {}, zones: [{ kind: 'Task', match: 'Reception', level: 35 }, { kind: 'Laser' }, null, { kind: 'Path', level: -3 }] },
      fb,
      'ai',
    );
    expect(r.draft.zones).toEqual([
      { kind: 'Task', match: 'reception', label: '', level: 35, accept: true },
      { kind: 'Path', match: '', label: '', level: 0, accept: true },
    ]);
  });
  it('garbage → the whole fallback', () => {
    const r = parseRoomIntentDraft('nope', fb, 'ai');
    expect(r.draft.zones).toEqual(fb.zones);
    expect({ ...r.draft.brief, source: fb.brief.source }).toEqual(fb.brief);
  });
});

describe('applyRoomIntent', () => {
  const room = demoRoom('Cafeteria');
  it('sets the base level, height and colour, and the picks’ labels and levels', () => {
    const { intents } = applyRoomIntent(room, seed(room), DEMO_INTENTS.Cafeteria);
    const base = intents.find((i) => i.kind === 'Ambient')!;
    expect(base.isSuggestion).toBe(false);
    expect(base.target).toEqual({ minimum: 10, average: 15, maximum: 25 });
    expect(base.plane.height).toBe(2.5);
    expect(base.behavior.cct).toBe(3000);
    const counter = intents.find((i) => i.label === 'Servery counter')!;
    expect(counter.isSuggestion).toBe(false);
    expect(counter.target.average).toBe(40);
  });
  it('never overwrites what the designer edited', () => {
    const intents = seed(room).map((i) =>
      i.kind === 'Ambient'
        ? {
            ...i,
            isSuggestion: false,
            targetEdited: true,
            target: { minimum: 5, average: 8, maximum: 12 },
            plane: { ...i.plane, inferred: false, height: 2 },
            behavior: { ...i.behavior, cct: 4000 as const },
            cctSuggested: false,
          }
        : i,
    );
    const base = applyRoomIntent(room, intents, DEMO_INTENTS.Cafeteria).intents.find((i) => i.kind === 'Ambient')!;
    expect(base.target.average).toBe(8);
    expect(base.plane.height).toBe(2);
    expect(base.behavior.cct).toBe(4000);
  });
  it('cafeteria: the menu wash and its plan strip stay clear of the servery counter zone', () => {
    const { intents } = applyRoomIntent(room, seed(room), DEMO_INTENTS.Cafeteria);
    const d: RoomDesign = { room, intents: intents.filter((i) => !i.isSuggestion), removedExisting: [], calculation: null, revision: 0 };
    solveAll(d);
    const counter = d.intents.find((i) => i.label === 'Servery counter')!;
    const wash = d.intents.find((i) => i.label === 'Menu wall')!;
    expect(wash.behavior.wallOffset).toBe(1.5);
    // the zone ends at the counter's back edge (counter 27 to 30 ft, wall at 32), past the 1.5 ft plan strip
    expect(Math.max(...counter.region.map((p) => p.y))).toBe(30);
    expect(wash.fixtures.length).toBeGreaterThan(0);
    for (const f of wash.fixtures) expect(contains(counter.region, f.center)).toBe(false);
    for (const f of wash.fixtures) expect(f.center.y).toBeGreaterThan(30);
    for (const f of counter.fixtures) expect(f.center.y).toBeLessThan(30);
  });
  it('a hand-set wall offset survives the demo layout tweak', () => {
    const intents = seed(room).map((i) => (i.kind === 'WallWash' ? { ...i, behavior: { ...i.behavior, wallOffset: 3 } } : i));
    const wash = applyRoomIntent(room, intents, DEMO_INTENTS.Cafeteria).intents.find((i) => i.kind === 'WallWash')!;
    expect(wash.behavior.wallOffset).toBe(3);
  });
  it('keep-dim levels are caps', () => {
    expect(targetForLevel('KeepDim', 5, { minimum: null, average: null, maximum: 3 })).toEqual({
      minimum: null,
      average: null,
      maximum: 5,
    });
  });
  it('is pure', () => {
    const intents = seed(room);
    const before = JSON.stringify(intents);
    applyRoomIntent(room, intents, DEMO_INTENTS.Cafeteria);
    expect(JSON.stringify(intents)).toBe(before);
  });
});

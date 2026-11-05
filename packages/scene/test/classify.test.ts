import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { OBJECT_KINDS, createRoom, type RoomObjectInfo } from '@intent-studio/core';
import {
  CLASSIFY_BATCH_SIZE,
  applyClassification,
  classifyBatches,
  classifyName,
  classifyNames,
  classifyRequest,
  normaliseName,
  unresolvedObjects,
} from '../src/classify';
import { extractRooms } from '../src/extract-room';
import { box, officeRoom, roundTrip } from './helpers';

describe('normaliseName', () => {
  it.each([
    ['OfficeDesk_01', 'office desk 01'],
    ['Chair.003', 'chair 003'],
    ['  Wall--Art  (2) ', 'wall art 2'],
    ['TV3', 'tv 3'],
    ['obj:desk', 'obj desk'],
  ])('%s → %s', (a, b) => expect(normaliseName(a)).toBe(b));
});

describe('classifyName', () => {
  const cases: [string, string | null][] = [
    ['Desk 01', 'desk'],
    ['OfficeDesk01', 'desk'],
    ['Workstation_03', 'desk'],
    ['Bench Desk', 'desk'],
    ['Desk Lamp', 'other'],
    ['Floor lamp', 'other'],
    ['Pendant Light', 'other'],
    ['Potted Plant', 'other'],
    ['Reception Desk', 'reception'],
    ['Front desk', 'reception'],
    ['Info desk', 'reception'],
    ['Concierge', 'reception'],
    ['Conference Table', 'table'],
    ['Coffee table', 'table'],
    ['Countertop', 'counter'],
    ['Kitchen counter', 'counter'],
    ['Vanity', 'counter'],
    ['Kitchen Island', 'island'],
    ['Bar', 'bar'],
    ['Bar Top', 'bar'],
    ['Bar Stool', 'seating'],
    ['Desk Chair', 'seating'],
    ['Office Chair', 'seating'],
    ['Sofa', 'seating'],
    ['Bench', 'seating'],
    ['Lounge', 'seating'],
    ['Cabinet', 'cabinet'],
    ['Credenza', 'cabinet'],
    ['Bookshelf', 'cabinet'],
    ['Pedestal', 'cabinet'],
    ['TV Stand', 'cabinet'],
    ['Display cabinet', 'cabinet'],
    ['Painting', 'artwork'],
    ['Artwork - Sunset', 'artwork'],
    ['Picture Frame', 'artwork'],
    ['Sculpture', 'artwork'],
    ['Display Case', 'display'],
    ['Plinth', 'display'],
    ['Mannequin', 'display'],
    ['Exit Sign', 'signage'],
    ['Logo wall', 'signage'],
    ['Wall Mirror', 'mirror'],
    ['TV', 'screen'],
    ['Monitor', 'screen'],
    ['Video wall', 'screen'],
    ['Fridge', 'appliance'],
    ['Door', 'door'],
    ['Thing 7', null],
    ['Mesh', null],
    ['Signature', null],
    ['', null],
  ];
  it.each(cases)('%j → %j', (name, kind) => expect(classifyName(name)).toBe(kind));

  it('only ever returns kinds the core knows', () => {
    for (const [name] of cases) {
      const k = classifyName(name);
      if (k) expect(OBJECT_KINDS).toContain(k);
    }
  });

  it('classifyNames takes the first name that resolves', () => {
    expect(classifyNames(['Group 4', 'Desk top', 'Chair'])).toEqual({ kind: 'desk', matched: 'Desk top' });
    expect(classifyNames(['Group 4', 'Mesh'])).toBeNull();
  });
});

const obj = (name: string, kind: string, extra: Partial<RoomObjectInfo> = {}): RoomObjectInfo => ({
  name,
  kind,
  center: { x: 1, y: 1 },
  length: 2.123456,
  width: 1,
  orientation: 0,
  top: 2.5,
  bottom: 0,
  ...extra,
});

describe('unresolved objects and the AI classify payload', () => {
  const rooms = [
    createRoom({ objects: [obj('Desk 1', 'desk'), obj('Thing 7', 'other'), obj('Blob', ' ')] }),
    createRoom({ objects: [obj('Widget', 'Other', { top: null, bottom: null })] }),
  ];

  it('lists "other"/empty kinds in room/object order, minus resolved ones', () => {
    const u = unresolvedObjects(rooms);
    expect(u.map((o) => [o.roomIndex, o.objectIndex, o.name])).toEqual([
      [0, 1, 'Thing 7'],
      [0, 2, 'Blob'],
      [1, 0, 'Widget'],
    ]);
    expect(unresolvedObjects(rooms, (r, o) => r === 0 && o === 2).map((o) => o.name)).toEqual(['Thing 7', 'Widget']);
  });

  it('builds the POST /api/ai/classify body', () => {
    const body = classifyRequest(unresolvedObjects(rooms));
    expect(body).toEqual({
      objects: [
        { index: 0, name: 'Thing 7', length: 2.12, width: 1, top: 2.5, bottom: 0 },
        { index: 1, name: 'Blob', length: 2.12, width: 1, top: 2.5, bottom: 0 },
        { index: 2, name: 'Widget', length: 2.12, width: 1, top: null, bottom: null },
      ],
    });
    expect(classifyRequest([])).toEqual({ objects: [] });
  });

  it('batches by 100, truncates names, drops non-finite dims, passes valid fallback kinds', () => {
    const many = Array.from({ length: 205 }, (_, k) => ({
      roomIndex: 0,
      objectIndex: k,
      name: k === 0 ? 'x'.repeat(500) : `Item ${k}`,
      length: k === 1 ? NaN : 3,
      width: 2,
      top: 1,
      bottom: 0,
    }));
    const batches = classifyBatches(many, (o) => (o.objectIndex === 2 ? 'cabinet' : undefined));
    expect(batches.map((b) => b.body.objects.length)).toEqual([CLASSIFY_BATCH_SIZE, 100, 5]);
    expect(batches[2]?.body.objects.map((o) => o.index)).toEqual([0, 1, 2, 3, 4]);
    expect(batches[2]?.refs[0]?.objectIndex).toBe(200);
    const first = batches[0]?.body.objects ?? [];
    expect(first[0]?.name).toHaveLength(400);
    expect(first[1]).not.toHaveProperty('length');
    expect(first[2]?.fallbackKind).toBe('cabinet');
    expect(first[3]).not.toHaveProperty('fallbackKind');
  });

  it('applies an untrusted reply defensively', () => {
    const [batch] = classifyBatches(unresolvedObjects(rooms));
    if (!batch) throw new Error('no batch');
    const designerEdited = rooms.map((r) => ({ ...r, objects: r.objects.map((o) => ({ ...o })) }));
    const next = applyClassification(designerEdited, batch, {
      result: [
        { index: 0, kind: ' Cabinet ' },
        { index: 0, kind: 'desk' }, // duplicate index: first wins
        { index: 1, kind: 'spaceship' }, // not a kind
        { index: 2, kind: 'screen' },
        { index: 9, kind: 'desk' }, // not sent
        { index: '1', kind: 'desk' },
        null,
      ],
    });
    expect(next[0]?.objects.map((o) => o.kind)).toEqual(['desk', 'cabinet', ' ']);
    expect(next[1]?.objects.map((o) => o.kind)).toEqual(['screen']);
    expect(rooms[0]?.objects[1]?.kind).toBe('other'); // input untouched
    // The designer set a kind meanwhile: the reply does not overwrite it.
    designerEdited[1]!.objects[0]!.kind = 'artwork';
    const again = applyClassification(designerEdited, batch, [{ index: 2, kind: 'screen' }]);
    expect(again[1]?.objects[0]?.kind).toBe('artwork');
    expect(applyClassification(rooms, batch, 'garbage')).toEqual(rooms);
  });
});

describe('extraction feeds only rule-less objects to the AI batch', async () => {
  const s: Scene = officeRoom();
  s.add(box('Floor Lamp', 2, 3, 2, 3, 0, 5));
  s.add(box('Widget', 25, 26, 2, 3, 0, 1));
  const r = extractRooms(await roundTrip(s));
  it('lamps resolve to "other" by rule and are not queued', () => {
    const kinds = Object.fromEntries((r.rooms[0]?.room.objects ?? []).map((o) => [o.name, o.kind]));
    expect(kinds).toEqual({ 'Floor Lamp': 'other', Widget: 'other' });
    expect(r.unresolved.map((u) => u.name)).toEqual(['Widget']);
  });
});

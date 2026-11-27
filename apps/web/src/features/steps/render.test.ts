// Server-render smoke test of the step panel and the header for every step of a demo room (no DOM in unit tests;
// the e2e suite drives the real screen). Checks the words a designer relies on: estimate labels, the steps, the brief.
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  DEMO_INTENTS,
  applyRoomIntent,
  demoRoom,
  estimateAll,
  power,
  productOf,
  seed,
  solveAll,
  type RoomDesign,
} from '@intent-studio/core';
import { studio } from '../../state/instance';
import { ROOM_STEPS } from '../../state/store';
import { Header } from '../shell/Header';
import { StepPanel } from './StepPanel';

function cafeteria(): RoomDesign {
  const room = demoRoom('Cafeteria');
  const { intents } = applyRoomIntent(room, seed(room), DEMO_INTENTS.Cafeteria);
  const d: RoomDesign = { room, intents, removedExisting: [], calculation: null, revision: 3 };
  solveAll(d, { prioritizeTaskZones: true, avoidWallWashOverlap: true });
  return d;
}

// server rendering reads the store's initial state; render the live state instead
studio.getInitialState = studio.getState;

describe('room screen render', () => {
  const design = cafeteria();
  const estimates = Object.fromEntries(estimateAll(design, productOf));
  const counter = design.intents.find((i) => i.label === 'Servery counter')!;
  beforeEach(() =>
    studio.setState({
      screen: 'room',
      design,
      revision: 3,
      estimateRevision: 3,
      estimates,
      power: power(design, productOf),
      brief: DEMO_INTENTS.Cafeteria.brief,
      briefZones: DEMO_INTENTS.Cafeteria.zones,
      selectedIntentId: counter.id,
    }),
  );

  for (const step of ROOM_STEPS)
    it(`${step}: renders`, () => {
      studio.setState({ step });
      const html = renderToString(createElement(StepPanel, { onLibrary: () => {} }));
      expect(html).toContain('step-panel');
      if (step !== 'intent') expect(html).toMatch(/estimate/i);
    });

  it('intent is three labelled parts: room, base light, zones', () => {
    studio.setState({ step: 'intent' });
    const html = renderToString(createElement(StepPanel, { onLibrary: () => {} }));
    const at = (t: string) => html.indexOf(`>${t}</h4>`);
    expect(at('Room')).toBeGreaterThan(0);
    expect(at('Base light')).toBeGreaterThan(at('Room'));
    expect(at('Zones')).toBeGreaterThan(at('Base light'));
    expect(html).toContain('social dining');
    expect(html).toContain('table height');
    expect(html).toContain('data-testid="step-next"');
  });

  it('zones shows the selected zone in labelled parts: target, luminaire, count', () => {
    studio.setState({ step: 'zones' });
    const html = renderToString(createElement(StepPanel, { onLibrary: () => {} }));
    // the step title is the only "Zones" heading; the list shows its count instead
    expect(html.split('>Zones<').length - 1).toBe(1);
    expect(html).toContain('5 in this room');
    // the open zone's name shows once: in its row, with the kind and height under it, not again as a header
    expect(html.split('>Servery counter<').length - 1).toBe(1);
    expect(html).toMatch(/Task(<!-- -->)? · measured /);
    expect(html).toContain('data-testid="all-zones"');
    const at = (t: string) => html.indexOf(`>${t}</h4>`);
    expect(at('Target')).toBeGreaterThan(0);
    expect(at('Luminaire')).toBeGreaterThan(at('Target'));
    expect(at('Count')).toBeGreaterThan(at('Luminaire'));
    expect(html).toMatch(/\d[\d,]* lm · /);
    expect(html).toContain('aria-label="Fixture count"');
    expect(html).toContain('More settings');
    // automatic count needs no button; the open row carries no second meter
    expect(html).not.toContain('>Auto<');
    expect(html).toContain('>Automatic<');
    expect(html).not.toContain('room-line');
  });

  it('luminaires: types (with the product library link) and totals as labelled parts', () => {
    studio.setState({ step: 'luminaires' });
    const html = renderToString(createElement(StepPanel, { onLibrary: () => {} }));
    const at = (t: string) => html.indexOf(`>${t}</h4>`);
    expect(at('Types')).toBeGreaterThan(0);
    expect(at('Library')).toBe(-1);
    expect(html.indexOf('data-testid="manage-products"')).toBeGreaterThan(at('Types'));
    expect(at('Totals')).toBeGreaterThan(html.indexOf('data-testid="manage-products"'));
    expect(html).toContain('data-testid="schedule-totals"');
  });

  it('check gives one room result, labelled an estimate', () => {
    studio.setState({ step: 'check' });
    const html = renderToString(createElement(StepPanel, { onLibrary: () => {} }));
    expect(html).toMatch(/\d+ of \d+ zones? on target/);
    expect(html).toMatch(/Room lumen method(<!-- -->)? · estimate/);
    expect(html.indexOf('>Result</h4>')).toBeGreaterThan(0);
    expect(html.indexOf('>Zones</h4>')).toBeGreaterThan(html.indexOf('>Result</h4>'));
    expect(html).not.toContain('No target');
  });

  it('the header carries the five steps', () => {
    const html = renderToString(createElement(Header));
    for (const name of ['Room', 'Intent', 'Zones', 'Luminaires', 'Check']) expect(html).toContain(name);
    expect(html).not.toContain('data-testid="calculate"');
  });
});

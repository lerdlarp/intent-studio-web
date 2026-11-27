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
import { Settings } from '../zone/ZoneCard';

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

  it('zones shows the selected zone as a target slider and one luminaire and count line', () => {
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
    expect(at('Luminaires')).toBeGreaterThan(at('Target'));
    expect(at('Count')).toBe(-1);
    // the target is a slider captioned in words; the presets, the average field and the stepper wait in More settings
    expect(html).toContain('data-testid="target-slider"');
    expect(html).toContain('type="range"');
    expect(html).toMatch(/data-testid="target-word"[^>]*>(Soft|Comfortable|Bright)</);
    expect(html).not.toContain('data-testid="target-average"');
    expect(html).not.toContain('aria-label="Light level"');
    expect(html).not.toContain('aria-label="Fixture count"');
    expect(html).not.toContain('data-testid="product"');
    // luminaire and count on one line; the count follows the target
    expect(html).toMatch(/aria-label="Fixtures"[^>]*>\d+<\/output>/);
    expect(html).toContain('Count follows the target.');
    expect(html).toContain('More settings');
    expect(html).not.toContain('room-line');
    // the zone's estimate comes first, before the target; delete is its own last row
    expect(html.indexOf('data-testid="estimate" role="status"')).toBeGreaterThan(0);
    expect(html.indexOf('data-testid="estimate" role="status"')).toBeLessThan(at('Target'));
    expect(html.indexOf('data-testid="delete-zone"')).toBeGreaterThan(html.indexOf('More settings'));
    expect(html).toContain('aria-expanded="false"');
  });

  it('a selected suggestion opens to show what it adds and why, with Add zone and Dismiss', () => {
    const sug = design.intents.find((i) => i.isSuggestion);
    expect(sug).toBeDefined();
    studio.setState({ step: 'zones', selectedIntentId: sug!.id, rationale: { [sug!.id]: 'Lights the menu board.' } });
    const html = renderToString(createElement(StepPanel, { onLibrary: () => {} }));
    expect(html).toContain('data-testid="suggestion-detail"');
    expect(html).toContain('Lights the menu board.');
    expect(html).toMatch(/Target(<!-- -->)? /);
    expect(html).toMatch(/data-testid="suggestion-add"[^>]*>.*Add zone/);
    expect(html).toContain(`aria-label="Dismiss ${sug!.label}"`);
    // no zone opens for a suggestion
    expect(html).not.toContain('data-testid="intent"');
  });

  it('settings show the slider over three limits, and a keep-dim zone only its cap', () => {
    const html = renderToString(createElement(Settings, { intent: counter, room: design.room, units: 'imperial' }));
    expect(html).toContain('data-testid="target-slider"');
    for (const id of ['target-average', 'target-minimum', 'target-maximum']) expect(html).toContain(id);
    const dim = { ...counter, kind: 'KeepDim' as const, target: { minimum: null, average: null, maximum: 5 } };
    const kept = renderToString(createElement(Settings, { intent: dim, room: design.room, units: 'imperial' }));
    expect(kept).toContain('Keep below');
    expect(kept).toContain('Keep it below 5.0 fc.');
    expect(kept).toContain('target-maximum');
    expect(kept).not.toContain('target-average');
    expect(kept).not.toContain('target-minimum');
    expect(kept).not.toContain('target-slider');
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

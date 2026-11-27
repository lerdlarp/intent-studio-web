// `brief` task (room intent draft): demo rooms fall back to their hard-coded intent, other rooms to the rules draft;
// model replies are parsed field by field and never name fixtures.
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_INTENTS, OFFLINE_ISSUE, cafeteria, createRoom, rulesDraft, seed } from '@intent-studio/core';
import { parseBrief } from '../src/ai/prompts/brief';
import { FakeClaude, makeApp, type TestApp } from './helpers';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const post = (body: unknown) => t!.app.inject({ method: 'POST', url: '/api/ai/brief', payload: body as object });
const room = cafeteria();

describe('brief', () => {
  it('without a key: a demo room gets its hard-coded intent', async () => {
    t = makeApp();
    const body = (await post({ room })).json();
    expect(body.source).toBe('rules');
    expect(body.lastIssue).toBe(OFFLINE_ISSUE);
    expect(body.result).toEqual(DEMO_INTENTS.Cafeteria);
  });

  it('without a key: another room gets the rules draft', async () => {
    t = makeApp();
    const other = { ...room, id: '11111111-2222-4333-8444-555555555555' };
    const body = (await post({ room: other })).json();
    expect(body.result).toEqual(rulesDraft(other, seed(other)));
  });

  it('with a model: fields are validated and clamped, the fallback fills the rest', async () => {
    const fake = new FakeClaude(() =>
      JSON.stringify({ brief: { purpose: 'late events', cct: 2700, level: 999 }, zones: [{ kind: 'Task', match: 'servery', level: 45 }] }),
    );
    t = makeApp({ claude: fake });
    const body = (await post({ room, intents: [] })).json();
    expect(body.source).toBe('ai');
    expect(body.result.brief).toMatchObject({ purpose: 'late events', cct: 2700, level: 200, source: 'ai', measuredAt: 2.5 });
    expect(body.result.zones).toEqual([{ kind: 'Task', match: 'servery', label: '', level: 45, accept: true }]);
    expect(fake.calls[0]!.user).toContain('<host-guidance kind="studio-brief">');
    expect(fake.calls[0]!.system).toContain('Never invent fixtures');
  });

  it('an unusable reply is null (→ fallback)', () => {
    expect(parseBrief('no json here', room)).toBeNull();
    expect(parseBrief('{"brief": 3}', room)).toBeNull();
    expect(parseBrief('{"brief": {"purpose": "x"}}', createRoom())).not.toBeNull();
  });
});

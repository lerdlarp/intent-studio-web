// Step 2, Intent: what the room is for and its base light, as one sentence of tokens. The draft comes from the room
// intent providers (hard-coded for demo rooms, the agent or the rules otherwise); edits here are the designer's and
// are never overwritten. Continuing applies the intent: the base light and the zones it picks are accepted.
import {
  CCT_VALUES,
  CCT_WORDS,
  MEASURED_AT,
  ROOM_PURPOSES,
  classOf,
  measuredAtLabel,
  type Cct,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceInput, parseIlluminance } from '../../state/inputs';
import { illuminanceUnit, length } from '../../state/display';
import { ZoneMeter } from '../inspector/Inspector';
import { TokenInput, TokenSelect } from './Token';

const SOURCE_TEXT: Record<string, string> = {
  demo: 'Demo intent',
  ai: 'Agent draft',
  rules: 'From the room type',
  designer: 'Your intent',
};

const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? 'an' : 'a');

export function IntentStep() {
  const design = useStudio((s) => s.design);
  const brief = useStudio((s) => s.brief);
  const zones = useStudio((s) => s.briefZones);
  const drafting = useStudio((s) => s.drafting);
  const units = useStudio((s) => s.units);
  const estimates = useStudio((s) => s.estimates);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  if (!design) return null;
  const { setBrief, draftBrief } = studio.getState();
  if (!brief)
    return (
      <div className="step-body" data-testid="intent-step">
        <p className="muted">{drafting ? 'Drafting the room intent…' : 'No room intent yet.'}</p>
        {!drafting && (
          <button type="button" onClick={() => void draftBrief(true)}>
            Draft the room intent
          </button>
        )}
      </div>
    );
  const cls = classOf(design.room);
  const purposes = ROOM_PURPOSES[cls].map((p) => ({ value: p, text: p }));
  const unit = illuminanceUnit(units);
  const base = design.intents.find((i) => i.kind === 'Ambient' && !i.isSuggestion);
  const picks = zones.filter((z) => z.accept);
  const heights = MEASURED_AT.map((m) => ({ value: m.height, text: m.label }));
  return (
    <div className="step-body" data-testid="intent-step">
      <p className="brief-sentence" data-testid="brief">
        This is {article(brief.spaceType)}{' '}
        <TokenInput
          label="Room type"
          value={brief.spaceType}
          width={8}
          testId="brief-space"
          onCommit={(t) => (t.trim() ? (setBrief({ spaceType: t }), null) : 'Name the room type.')}
        />{' '}
        for{' '}
        <TokenSelect label="Purpose" value={brief.purpose} options={purposes} onChange={(v) => setBrief({ purpose: v })} />
        . Keep it{' '}
        <TokenSelect<Cct>
          label="Colour temperature"
          value={brief.cct}
          testId="brief-cct"
          options={CCT_VALUES.map((c) => ({ value: c, text: `${CCT_WORDS[c]} · ${c} K` }))}
          onChange={(v) => setBrief({ cct: v })}
        />{' '}
        at about{' '}
        <TokenInput
          key={units}
          label="Base light level"
          inputMode="decimal"
          value={illuminanceInput(brief.level, units)}
          suffix={unit}
          testId="brief-level"
          onCommit={(t) => {
            const v = parseIlluminance(t, units);
            if (v === undefined || v === null) return 'Type a light level.';
            setBrief({ level: v });
            return null;
          }}
        />{' '}
        measured at{' '}
        <TokenSelect<number>
          label="Measured at"
          value={brief.measuredAt}
          testId="brief-height"
          options={heights.some((h) => h.value === brief.measuredAt) ? heights : [{ value: brief.measuredAt, text: measuredAtLabel(brief.measuredAt) }, ...heights]}
          onChange={(v) => setBrief({ measuredAt: v })}
        />
        .
      </p>
      <p className="muted small">
        Measured {length(brief.measuredAt, units)} above the floor. Zones can each have their own height.
      </p>

      {brief.note && (
        <aside className="agent-note" data-testid="brief-note">
          <span className="tag">{SOURCE_TEXT[brief.source] ?? 'Draft'}</span>
          <p>{brief.note}</p>
          <button type="button" className="link" disabled={drafting} onClick={() => void draftBrief(true)}>
            {drafting ? 'Drafting…' : 'Draft again'}
          </button>
        </aside>
      )}

      <section className="base-status" aria-labelledby="base-h">
        <h3 id="base-h">Base light</h3>
        {base ? (
          <div className="row spread">
            <span>{base.label}</span>
            <ZoneMeter intent={base} estimate={estimates[base.id]} units={units} stale={stale} />
          </div>
        ) : (
          <p className="muted small">Laid out when you continue. Every level shown is an estimate.</p>
        )}
      </section>

      {picks.length > 0 && (
        <section aria-labelledby="picks-h">
          <h3 id="picks-h">Zones it starts with</h3>
          <ul className="pick-list small" data-testid="brief-zones">
            {picks.map((z, k) => (
              <li key={k}>
                {z.label || z.match}
                {z.level != null && (
                  <span className="muted">
                    {' '}
                    · {illuminanceInput(z.level, units)} {unit}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

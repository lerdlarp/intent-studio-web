// Step 1, Intent: the room (as imported) and what it is for, its base light and the zones it starts with, as three labelled parts. The draft comes from the room
// intent providers (hard-coded for demo rooms, the agent or the rules otherwise); edits here are the designer's and
// are never overwritten. Continuing applies the intent: the base light and the zones it picks are accepted.
import {
  CCT_VALUES,
  floorArea,
  roomBounds,
  CCT_WORDS,
  MEASURED_AT,
  ROOM_PURPOSES,
  classOf,
  measuredAtLabel,
  type Cct,
  type StudioRoom,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceInput, parseIlluminance } from '../../state/inputs';
import { area, illuminanceUnit, length } from '../../state/display';
import type { Units } from '../../state/store';
import { ZoneMeter } from '../inspector/Inspector';
import { SelectField, TextField } from '../inspector/fields';
import { StepSection } from './Section';

const SOURCE_TEXT: Record<string, string> = {
  demo: 'Demo intent',
  ai: 'Agent draft',
  rules: 'From the room type',
  designer: 'Your intent',
};

/** The imported room in one line: name, size, area, ceiling and objects. Geometry is edited on import, not here. */
function RoomFacts({ room, units }: { room: StudioRoom; units: Units }) {
  const b = roomBounds(room);
  const parts = [
    room.label || 'Untitled room',
    `${length(b.max.x - b.min.x, units)} × ${length(b.max.y - b.min.y, units)} · ${area(floorArea(room), units)}`,
    `ceiling ${length(room.ceilingHeight, units)}${room.ceilingGrid ? ', grid' : ''}`,
  ];
  if (room.objects.length) parts.push(`${room.objects.length} object${room.objects.length === 1 ? '' : 's'}`);
  return (
    <p className="room-facts muted small" data-testid="room-facts">
      {parts.join(' · ')}
    </p>
  );
}

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
        <RoomFacts room={design.room} units={units} />
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
  const heightOptions = heights.some((h) => h.value === brief.measuredAt)
    ? heights
    : [{ value: brief.measuredAt, text: measuredAtLabel(brief.measuredAt) }, ...heights];
  return (
    <div className="step-body" data-testid="intent-step">
      {brief.note && (
        <aside className="agent-note" data-testid="brief-note">
          <span className="tag">{SOURCE_TEXT[brief.source] ?? 'Draft'}</span>
          <p>{brief.note}</p>
          <button type="button" className="link" disabled={drafting} onClick={() => void draftBrief(true)}>
            {drafting ? 'Drafting…' : 'Draft again'}
          </button>
        </aside>
      )}

      <div className="step-secs" data-testid="brief">
        <StepSection id="brief-room" n={1} title="Room" hint="What it is and what it is for">
          <RoomFacts room={design.room} units={units} />
          <TextField
            label="Room type"
            testId="brief-space"
            inputMode="text"
            maxLength={40}
            value={brief.spaceType}
            onCommit={(t) => (t.trim() ? (setBrief({ spaceType: t.trim() }), null) : 'Name the room type.')}
          />
          <SelectField label="Purpose" value={brief.purpose} onChange={(v) => setBrief({ purpose: v })}>
            {(purposes.some((p) => p.value === brief.purpose)
              ? purposes
              : [{ value: brief.purpose, text: brief.purpose }, ...purposes]
            ).map((p) => (
              <option key={p.value} value={p.value}>
                {p.text}
              </option>
            ))}
          </SelectField>
        </StepSection>

        <StepSection id="brief-base" n={2} title="Base light" hint="Every zone starts from it">
          <TextField
            key={units}
            label="Light level"
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
          />
          <SelectField
            label="Colour"
            testId="brief-cct"
            value={String(brief.cct)}
            onChange={(v) => setBrief({ cct: Number(v) as Cct })}
          >
            {CCT_VALUES.map((c) => (
              <option key={c} value={c}>
                {CCT_WORDS[c]} · {c} K
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Measured at"
            testId="brief-height"
            value={String(brief.measuredAt)}
            hint={`${length(brief.measuredAt, units)} above the floor. Zones can each have their own height.`}
            onChange={(v) => setBrief({ measuredAt: Number(v) })}
          >
            {heightOptions.map((h) => (
              <option key={h.value} value={h.value}>
                {h.text}
              </option>
            ))}
          </SelectField>
          <div className="row spread base-status" data-testid="base-status">
            {base ? (
              <>
                <span className="small">{base.label}</span>
                <ZoneMeter intent={base} estimate={estimates[base.id]} units={units} stale={stale} />
              </>
            ) : (
              <span className="muted small">Laid out when you continue. Every level shown is an estimate.</span>
            )}
          </div>
        </StepSection>

        <StepSection
          id="brief-zones"
          n={3}
          title="Zones"
          hint={picks.length > 0 ? `${picks.length} to start with` : 'Add them next'}
        >
          {picks.length > 0 ? (
            <ul className="pick-list small" data-testid="brief-zones">
              {picks.map((z, k) => (
                <li key={k}>
                  <span>{z.label || z.match}</span>
                  {z.level != null && (
                    <span className="muted">
                      {illuminanceInput(z.level, units)} {unit}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="step-sec-text muted">None picked. You can add any number on the Zones step.</p>
          )}
        </StepSection>
      </div>
    </div>
  );
}

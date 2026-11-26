// The one floating panel of the room screen. Its content follows the active step; the sticky footer moves on. Leaving
// Intent applies the room intent (one undo step) so the base light and its zones are laid out.
import { isEmptyTarget } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { estimateStatus } from '../inspector/estimateStatus';
import type { RoomStep as Step } from '../../state/store';
import { PanelBoundary } from '../shell/PanelBoundary';
import { CheckStep } from './CheckStep';
import { IntentStep } from './IntentStep';
import { LuminairesStep } from './LuminairesStep';
import { NEXT_STEP, PREV_STEP, STEP_NAMES } from './progress';
import { RoomStep } from './RoomStep';
import { ZonesStep } from './ZonesStep';
import './steps.css';

const TITLES: Record<Step, string> = {
  room: 'The room',
  intent: 'What is this room for?',
  zones: 'Zones',
  luminaires: 'Luminaires',
  check: 'Check the room',
};

/**
 * Move to a step. Leaving Intent forward the first time applies the room intent (base light and its zones); after
 * that the base already follows brief edits, and the zones are the designer's.
 */
export function goTo(step: Step) {
  const s = studio.getState();
  const baseAccepted = s.design?.intents.some((i) => i.kind === 'Ambient' && !i.isSuggestion) ?? false;
  if (s.step === 'intent' && step !== 'intent' && step !== 'room' && !baseAccepted) s.applyBrief();
  s.setStep(step);
}

export function StepPanel({ onLibrary }: { onLibrary: () => void }) {
  const step = useStudio((s) => s.step);
  const next = NEXT_STEP[step];
  const prev = PREV_STEP[step];
  const verdict = useStudio((s) => {
    if (s.step !== 'zones' || !s.design) return null;
    let on = 0;
    let of = 0;
    for (const i of s.design.intents) {
      const e = s.estimates[i.id];
      if (i.isSuggestion || !e || isEmptyTarget(i.target)) continue;
      of++;
      if (estimateStatus(i.target, e).status === 'Meets') on++;
    }
    return of ? `${on}/${of}` : null;
  });
  const [on, of] = verdict ? verdict.split('/') : [];
  return (
    <section className="step-panel" aria-labelledby="step-title" data-step={step}>
      <h2 id="step-title">{TITLES[step]}</h2>
      <div className="step-scroll">
        <PanelBoundary name={STEP_NAMES[step]}>
          {step === 'room' && <RoomStep />}
          {step === 'intent' && <IntentStep />}
          {step === 'zones' && <ZonesStep />}
          {step === 'luminaires' && <LuminairesStep onLibrary={onLibrary} />}
          {step === 'check' && <CheckStep />}
        </PanelBoundary>
      </div>
      <footer className="step-footer">
        <div className="step-footer-start">
          {verdict && (
            <span className="footer-verdict" data-testid="footer-verdict">
              <strong>
                {on} of {of} on target
              </strong>
              <span className="muted small">estimates</span>
            </span>
          )}
          {prev && !verdict && (
            <button type="button" className="link" onClick={() => goTo(prev)}>
              ‹ {STEP_NAMES[prev]}
            </button>
          )}
        </div>
        {next && (
          <button type="button" className="primary" onClick={() => goTo(next)} data-testid="step-next">
            Next: {STEP_NAMES[next]}
          </button>
        )}
      </footer>
    </section>
  );
}

// The room's four steps as text tabs in the header: done steps carry a check, the active one is underlined.
import { ROOM_STEPS, freshCalc } from '../../state/store';
import { useStudio } from '../../state/instance';
import { Icon } from '../shell/Icon';
import { STEP_NAMES, stepsDone } from './progress';
import { goTo } from './StepPanel';

export function Stepper() {
  const step = useStudio((s) => s.step);
  const design = useStudio((s) => s.design);
  const fresh = useStudio((s) => freshCalc(s) !== null);
  const done = stepsDone(design, fresh);
  return (
    <nav className="stepper" aria-label="Room steps">
      <ol>
        {ROOM_STEPS.map((k, n) => (
          <li key={k}>
            <button
              type="button"
              className={`step-tab${step === k ? ' on' : ''}${done[k] ? ' done' : ''}`}
              aria-current={step === k ? 'step' : undefined}
              onClick={() => goTo(k)}
              data-testid={`step-${k}`}
            >
              <span className="step-mark" aria-hidden="true">
                {done[k] && step !== k ? <Icon name="check" /> : n + 1}
              </span>
              {STEP_NAMES[k]}
              {done[k] && <span className="sr-only"> (done)</span>}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

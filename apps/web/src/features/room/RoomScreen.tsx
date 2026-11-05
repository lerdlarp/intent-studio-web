import { useState } from 'react';
import { useStudio } from '../../state/instance';
import { PlanPreview } from '../plan/PlanPreview';
import { Inspector } from '../inspector/Inspector';
import { Room3D } from '../room3d/Room3D';

export function RoomScreen() {
  const design = useStudio((s) => s.design);
  const [show3d, setShow3d] = useState(false);
  if (!design) return null;

  return (
    <div className="room-layout">
      <section className="panel plan-panel" aria-labelledby="plan-h">
        <div className="panel-head">
          <h2 id="plan-h">Plan</h2>
          <button type="button" aria-pressed={show3d} onClick={() => setShow3d((v) => !v)}>
            {show3d ? 'Hide 3D' : 'Show 3D'}
          </button>
        </div>
        <div className={show3d ? 'views split' : 'views'}>
          <PlanPreview design={design} />
          {show3d && <Room3D />}
        </div>
      </section>
      <Inspector />
    </div>
  );
}

import { useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { PlanCanvas } from '../plan/PlanCanvas';
import { DescribeBox } from '../plan/DescribeBox';
import { Inspector } from '../inspector/Inspector';
import { Room3D } from '../room3d/Room3D';
import { Ledger } from '../ledger/Ledger';
import { Library } from '../library/Library';
import { Dialog } from '../shell/Dialog';
import { PanelBoundary } from '../shell/PanelBoundary';

/** Results ledger under the plan (collapsible); wired to the store's full calculation. */
function LedgerPanel() {
  const result = useStudio((s) => s.calcResult);
  const revision = useStudio((s) => s.revision);
  const units = useStudio((s) => s.units);
  const running = useStudio((s) => s.calcRunning);
  const progress = useStudio((s) => s.calcProgress);
  const error = useStudio((s) => s.calcError);
  const ms = useStudio((s) => s.calcMs);
  const [open, setOpen] = useState(true);
  const { calculate, cancelCalculation } = studio.getState();
  return (
    <div className="ledger-panel">
      <button type="button" className="link" aria-expanded={open} aria-controls="ledger-body" onClick={() => setOpen((v) => !v)} data-testid="ledger-toggle">
        {open ? '▾' : '▸'} Results (full calculation)
      </button>
      {open && (
        <div id="ledger-body">
          <Ledger
            result={result}
            designRevision={revision}
            units={units}
            running={running}
            progress={progress}
            error={error}
            ms={ms}
            onRun={() => void calculate()}
            onCancel={cancelCalculation}
          />
        </div>
      )}
    </div>
  );
}

/** The project's product library as a dialog over the room screen ("Manage project products" in the inspector). */
export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useStudio((s) => s.project);
  if (!project) return null;
  return (
    <Dialog title="Project products" onClose={onClose} wide hideTitle>
      <Library projectId={project.id} onProductsChange={(p) => studio.getState().setProjectProducts(p, project.id)} />
      <div className="row end">
        <button type="button" onClick={onClose} data-testid="library-close">
          Done
        </button>
      </div>
    </Dialog>
  );
}

export function RoomScreen() {
  const design = useStudio((s) => s.design);
  const [show3d, setShow3d] = useState(false);
  const [library, setLibrary] = useState(false);
  if (!design) return null;

  return (
    <div className="room-layout">
      <div className="room-main">
        <section className="panel plan-panel" aria-labelledby="plan-h">
          <div className="panel-head">
            <h2 id="plan-h">Plan</h2>
            <button type="button" aria-pressed={show3d} onClick={() => setShow3d((v) => !v)}>
              {show3d ? 'Hide 3D' : 'Show 3D'}
            </button>
          </div>
          <PanelBoundary name="plan">
            <DescribeBox />
          </PanelBoundary>
          <div className={show3d ? 'views split' : 'views'}>
            <PanelBoundary name="plan">
              <PlanCanvas />
            </PanelBoundary>
            {show3d && (
              <PanelBoundary name="3D">
                <Room3D />
              </PanelBoundary>
            )}
          </div>
          <PanelBoundary name="results">
            <LedgerPanel />
          </PanelBoundary>
        </section>
      </div>
      <PanelBoundary name="inspector">
        <Inspector onManageProducts={() => setLibrary(true)} />
      </PanelBoundary>
      {library && <LibraryDialog onClose={() => setLibrary(false)} />}
    </div>
  );
}

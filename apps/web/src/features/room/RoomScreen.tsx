import { useEffect, useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { PlanCanvas } from '../plan/PlanCanvas';
import { DescribeBox } from '../plan/DescribeBox';
import { PlanSummary } from '../plan/PlanText';
import { Inspector } from '../inspector/Inspector';
import { Room3D } from '../room3d/Room3D';
import { Ledger } from '../ledger/Ledger';
import { ScheduleDock } from '../schedule/ScheduleDock';
import { Library } from '../library/Library';
import { Dialog } from '../shell/Dialog';
import { PanelBoundary } from '../shell/PanelBoundary';
import { Icon } from '../shell/Icon';

/** Results ledger under the plan (collapsible); wired to the store's full calculation. */
function LedgerPanel({ open, onToggle, part }: { open: boolean; onToggle: () => void; part: 'toggle' | 'body' }) {
  const result = useStudio((s) => s.calcResult);
  const revision = useStudio((s) => s.revision);
  const units = useStudio((s) => s.units);
  const running = useStudio((s) => s.calcRunning);
  const progress = useStudio((s) => s.calcProgress);
  const error = useStudio((s) => s.calcError);
  const ms = useStudio((s) => s.calcMs);
  const { calculate, cancelCalculation } = studio.getState();
  return (
    <>
      {part === 'toggle' && (
        <div className="results-toolbar">
          <button
            type="button"
            className="link"
            aria-expanded={open}
            aria-controls="ledger-body"
            onClick={onToggle}
            data-testid="ledger-toggle"
          >
            {open ? '▾' : '▸'} Results{result ? ' · estimate' : ''}
          </button>
        </div>
      )}
      {part === 'body' && open && (
        <div id="ledger-body" className="ledger-body">
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
    </>
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
  const viewMode = useStudio((s) => s.viewMode);
  const [resultsOpen, setResultsOpen] = useState(false);
  const running = useStudio((s) => s.calcRunning);
  const [library, setLibrary] = useState(false);
  // Calculate lives in the header; show its results here as soon as a run starts
  useEffect(() => {
    if (running) setResultsOpen(true);
  }, [running]);
  if (!design) return null;

  return (
    <div className="room-layout">
      <div className="room-main">
        <section className="panel plan-panel" aria-label="Design">
          <div className={`views ${viewMode}`}>
            {viewMode !== '3d' && (
              <PanelBoundary name="plan">
                <PlanCanvas />
              </PanelBoundary>
            )}
            {viewMode !== '2d' && (
              <PanelBoundary name="3D">
                <Room3D />
              </PanelBoundary>
            )}
          </div>
          <div className="plan-footer">
            <PlanSummary />
            <details className="describe-disclosure">
              <summary>
                <Icon name="spark" /> Describe lighting
              </summary>
              <PanelBoundary name="plan">
                <DescribeBox />
              </PanelBoundary>
            </details>
          </div>
          <PanelBoundary name="schedule">
            <ScheduleDock
              onImport={() => setLibrary(true)}
              results={<LedgerPanel part="toggle" open={resultsOpen} onToggle={() => setResultsOpen((v) => !v)} />}
            />
            <LedgerPanel part="body" open={resultsOpen} onToggle={() => setResultsOpen((v) => !v)} />
          </PanelBoundary>
        </section>
      </div>
      <PanelBoundary name="inspector">
        <Inspector />
      </PanelBoundary>
      {library && <LibraryDialog onClose={() => setLibrary(false)} />}
    </div>
  );
}

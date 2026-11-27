import { useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { PlanCanvas } from '../plan/PlanCanvas';
import { PlanSummary } from '../plan/PlanText';
import { Room3D } from '../room3d/Room3D';
import { Library } from '../library/Library';
import { Dialog } from '../shell/Dialog';
import { PanelBoundary } from '../shell/PanelBoundary';
import { Toast } from '../shell/Toast';
import { StepPanel } from '../steps/StepPanel';
import { ViewPill } from '../steps/ViewPill';

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

/**
 * The room screen: the plan (or 3D) full-bleed, one floating panel for the active step, and a floating view pill.
 * The header carries the steps; there is no free-text box (the room intent is set with the Intent step's tokens).
 */
export function RoomScreen() {
  const design = useStudio((s) => s.design);
  const viewMode = useStudio((s) => s.viewMode);
  const [library, setLibrary] = useState(false);
  if (!design) return null;

  return (
    <div className="room-stage">
      <section className={`stage-views views ${viewMode}`} aria-label="Design">
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
      </section>
      <StepPanel onLibrary={() => setLibrary(true)} />
      <ViewPill />
      <div className="stage-summary">
        <PlanSummary />
      </div>
      <Toast />
      {library && <LibraryDialog onClose={() => setLibrary(false)} />}
    </div>
  );
}

import { studio, useStudio } from '../../state/instance';
import type { SaveStatus, Units, ViewMode } from '../../state/store';
import { ExportMenu } from '../export/ExportMenu';
import { Icon } from './Icon';

const VIEW_NAMES: Record<ViewMode, string> = { '2d': '2D', split: 'Split', '3d': '3D' };

const SAVE_TEXT: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
  conflict: 'Reloaded',
};

export function Header() {
  const screen = useStudio((s) => s.screen);
  const project = useStudio((s) => s.project);
  const roomLabel = useStudio((s) => s.design?.room.label ?? null);
  const units = useStudio((s) => s.units);
  const canUndo = useStudio((s) => s.canUndo);
  const canRedo = useStudio((s) => s.canRedo);
  const save = useStudio((s) => s.save);
  const busy = useStudio((s) => s.busy);
  const solving = useStudio((s) => s.solving);
  const viewMode = useStudio((s) => s.viewMode);
  const calcRunning = useStudio((s) => s.calcRunning);
  const calcResult = useStudio((s) => s.calcResult);
  const { goHome, backToProject, undo, redo, setUnits, retrySave, setViewMode, calculate, cancelCalculation } =
    studio.getState();

  return (
    <header className="app-header">
      <div className="header-start">
        <nav aria-label="Breadcrumb" className="crumbs">
          <button type="button" className="link brand" onClick={() => void goHome()}>
            Intent Studio
          </button>
          {project && screen !== 'home' && (
            <>
              <span aria-hidden="true">/</span>
              <button
                type="button"
                className="link"
                onClick={() => void backToProject()}
                aria-current={screen === 'project' ? 'page' : undefined}
              >
                {project.name}
              </button>
            </>
          )}
          {screen === 'room' && roomLabel !== null && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{roomLabel || 'Untitled room'}</span>
            </>
          )}
        </nav>
        {screen === 'room' && (
          <div className="history-tools" role="group" aria-label="History">
            <button
              type="button"
              className="icon-button"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              aria-keyshortcuts="Control+z Meta+z"
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+z Meta+Shift+z"
            >
              <Icon name="redo" />
            </button>
          </div>
        )}
      </div>
      <div className="header-tools">
        {busy && (
          <span className="muted" role="status">
            {busy}…
          </span>
        )}
        {screen === 'room' && (
          <>
            <span className="solving" role="status" aria-live="polite">
              {solving && (
                <span data-testid="solving">
                  <span className="spinner" aria-hidden="true" /> Solving…
                </span>
              )}
            </span>
            <span className={`save save-${save}`} role="status" aria-live="polite">
              {SAVE_TEXT[save]}
            </span>
            {save === 'error' && (
              <button type="button" className="link" onClick={() => void retrySave()} data-testid="save-retry">
                Retry now
              </button>
            )}
            <button
              type="button"
              className="primary"
              data-testid="calculate"
              onClick={() => (calcRunning ? cancelCalculation() : void calculate())}
            >
              {calcRunning ? 'Cancel calculation' : calcResult ? 'Recalculate' : 'Calculate'}
            </button>
            <div className="view-switch" role="group" aria-label="View">
              {(['2d', 'split', '3d'] as ViewMode[]).map((m) => (
                <button key={m} type="button" aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>
                  {VIEW_NAMES[m]}
                </button>
              ))}
            </div>
          </>
        )}
        <ExportMenu />
        <fieldset className="segmented">
          <legend className="sr-only">Units</legend>
          {(['imperial', 'metric'] as Units[]).map((u) => (
            <label key={u} className={units === u ? 'on' : ''}>
              <input type="radio" name="units" value={u} checked={units === u} onChange={() => setUnits(u)} />
              {u === 'imperial' ? 'ft · fc' : 'm · lx'}
            </label>
          ))}
        </fieldset>
      </div>
    </header>
  );
}

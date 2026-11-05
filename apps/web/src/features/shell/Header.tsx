import { studio, useStudio } from '../../state/instance';
import type { SaveStatus, Units } from '../../state/store';
import { ExportMenu } from '../export/ExportMenu';

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
  const { goHome, backToProject, undo, redo, setUnits } = studio.getState();

  return (
    <header className="app-header">
      <nav aria-label="Breadcrumb" className="crumbs">
        <button type="button" className="link brand" onClick={() => void goHome()}>
          Intent Studio
        </button>
        {project && screen !== 'home' && (
          <>
            <span aria-hidden="true">/</span>
            <button type="button" className="link" onClick={() => void backToProject()} aria-current={screen === 'project' ? 'page' : undefined}>
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
      <div className="header-tools">
        {busy && (
          <span className="muted" role="status">
            {busy}…
          </span>
        )}
        {screen === 'room' && (
          <>
            <span className={`save save-${save}`} role="status" aria-live="polite">
              {SAVE_TEXT[save]}
            </span>
            <div className="btn-group" role="group" aria-label="History">
              <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                Undo
              </button>
              <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
                Redo
              </button>
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

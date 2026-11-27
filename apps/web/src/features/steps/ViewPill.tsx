// Floating view switch over the canvas: Plan / Split / 3D, and the room heat overlay.
import { studio, useStudio } from '../../state/instance';
import type { ViewMode } from '../../state/store';
import { Icon } from '../shell/Icon';

const VIEW_NAMES: Record<ViewMode, string> = { '2d': 'Plan', split: 'Split', '3d': '3D' };

export function ViewPill() {
  const viewMode = useStudio((s) => s.viewMode);
  const overlay = useStudio((s) => s.overlay);
  const { setViewMode, setOverlay } = studio.getState();
  return (
    <div className="view-pill" role="group" aria-label="View">
      {(['2d', 'split', '3d'] as ViewMode[]).map((m) => (
        <button key={m} type="button" aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>
          {VIEW_NAMES[m]}
        </button>
      ))}
      <span className="pill-sep" aria-hidden="true" />
      <button
        type="button"
        aria-pressed={overlay === 'heatmap'}
        onClick={() => setOverlay(overlay === 'heatmap' ? 'none' : 'heatmap')}
        data-testid="heat-toggle"
      >
        <Icon name="heat" /> Heat
      </button>
    </div>
  );
}

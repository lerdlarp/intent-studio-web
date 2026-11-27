// Under the plan: what is selected (zone / fixture), the fixture's position and pinned tag, and the selection's
// actions (remove fixture, merge overlapping zones). Editing lives in the step panel.
import { useMemo, useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { mergeOverlappingPreview } from '../../state/store';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { length } from '../../state/display';

export function SelectionBar() {
  const design = useStudio((s) => s.design);
  const id = useStudio((s) => s.selectedIntentId);
  const fid = useStudio((s) => s.selectedFixtureId);
  const units = useStudio((s) => s.units);
  const [merging, setMerging] = useState(false);
  const preview = useMemo(() => (design && id ? mergeOverlappingPreview(design, id) : null), [design, id]);
  if (!design) return null;
  const { select } = studio.getState();
  const intent = id ? design.intents.find((i) => i.id === id) : undefined;
  const fixture = intent && fid ? intent.fixtures.find((f) => f.id === fid) : undefined;
  const bounds = preview
    ? {
        minX: Math.min(...preview.region.map((p) => p.x)),
        minY: Math.min(...preview.region.map((p) => p.y)),
        maxX: Math.max(...preview.region.map((p) => p.x)),
        maxY: Math.max(...preview.region.map((p) => p.y)),
      }
    : null;

  return (
    <div className="plan-selection" aria-label="Plan selection" role="group">
      {intent && !intent.isSuggestion && intent.fixtures.length > 0 && (
        <select
          aria-label="Selected fixture"
          value={fixture?.id ?? ''}
          onChange={(ev) => select(intent.id, ev.target.value || null)}
        >
          <option value="">Fixture: whole zone</option>
          {intent.fixtures.map((f, n) => (
            <option key={f.id} value={f.id}>
              Fixture {n + 1}
              {f.pinned ? ' · pinned' : ''}
            </option>
          ))}
        </select>
      )}
      {fixture && intent && (
        <button
          type="button"
          className="selection-action danger"
          onClick={() => studio.getState().removeFixture(intent.id, fixture.id)}
          title="Remove fixture (Delete)"
          data-testid="remove-fixture"
        >
          <Icon name="trash" /> Remove fixture
        </button>
      )}
      {preview && (
        <button type="button" className="selection-action" onClick={() => setMerging(true)} data-testid="merge-zones">
          <Icon name="merge" /> Merge overlapping zones
        </button>
      )}
      {fixture && (
        <span className="small" data-testid="fixture-info">
          Fixture at {length(fixture.center.x, units)}, {length(fixture.center.y, units)}
          {fixture.pinned && (
            <>
              {' '}
              <span className="tag">pinned</span>
            </>
          )}
        </span>
      )}
      {merging && preview && bounds && intent && (
        <Dialog title="Merge overlapping zones" onClose={() => setMerging(false)}>
          <p>
            Combine {preview.intentIds.length} zones into <strong>{intent.label}</strong>. Product, targets and layout
            settings match. Overlapping fixture positions become one fixture.
          </p>
          <svg
            className="merge-preview"
            role="img"
            aria-label="Merged zone outline"
            viewBox={`${bounds.minX - 1} ${bounds.minY - 1} ${bounds.maxX - bounds.minX + 2} ${bounds.maxY - bounds.minY + 2}`}
          >
            <polygon points={preview.region.map((p) => `${p.x},${p.y}`).join(' ')} />
          </svg>
          <ul>
            {preview.intentIds.map((zoneId) => (
              <li key={zoneId}>{design.intents.find((i) => i.id === zoneId)?.label}</li>
            ))}
          </ul>
          <p className="muted small">The layout stays hand-tuned. Undo restores the separate zones.</p>
          <div className="row end">
            <button type="button" onClick={() => setMerging(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                studio.getState().mergeOverlappingIntents(intent.id);
                setMerging(false);
              }}
              data-testid="confirm-merge"
            >
              Merge zones
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

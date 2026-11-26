// Step 1, Room: what was imported, read-only. Geometry edits happen on import; units only change the display.
import { floorArea, roomBounds } from '@intent-studio/core';
import { useStudio } from '../../state/instance';
import { area, length } from '../../state/display';

export function RoomStep() {
  const design = useStudio((s) => s.design);
  const units = useStudio((s) => s.units);
  if (!design) return null;
  const r = design.room;
  const b = roomBounds(r);
  return (
    <div className="step-body" data-testid="room-step">
      <dl className="facts">
        <dt>Room</dt>
        <dd>{r.label || 'Untitled room'}</dd>
        <dt>Type</dt>
        <dd>{r.spaceType || 'not set'}</dd>
        <dt>Size</dt>
        <dd>
          {length(b.max.x - b.min.x, units)} × {length(b.max.y - b.min.y, units)} · {area(floorArea(r), units)}
        </dd>
        <dt>Ceiling</dt>
        <dd>
          {length(r.ceilingHeight, units)}
          {r.ceilingGrid ? ' · grid ceiling' : ''}
        </dd>
        <dt>Walls</dt>
        <dd>{r.walls.length}</dd>
        <dt>Objects</dt>
        <dd>{r.objects.length ? r.objects.map((o) => o.name || o.kind).join(', ') : 'none'}</dd>
      </dl>
      <p className="muted small">Next, say what the room is for and how bright it should be.</p>
    </div>
  );
}

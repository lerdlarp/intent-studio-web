// Read-only plan preview (placeholder until the Phase 3 canvas): floor, objects, intent regions, fixtures. SVG in plan
// feet with +Y north (flipped for the screen).
import { footprint, intentInkColor, roomBounds, type P2, type RoomDesign } from '@intent-studio/core';

const pts = (poly: readonly P2[]) => poly.map((p) => `${p.x},${-p.y}`).join(' ');

export function PlanPreview({ design }: { design: RoomDesign }) {
  const { room } = design;
  const b = roomBounds(room);
  const pad = 2;
  const w = b.max.x - b.min.x + 2 * pad;
  const h = b.max.y - b.min.y + 2 * pad;
  const viewBox = `${b.min.x - pad} ${-b.max.y - pad} ${w} ${h}`;
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const fixtures = accepted.reduce((n, i) => n + i.fixtures.length, 0);

  return (
    <figure className="plan">
      <svg viewBox={viewBox} role="img" aria-label={`Plan of ${room.label || 'the room'}: ${accepted.length} intents, ${fixtures} fixtures`}>
        {room.floor.map((loop, k) => (
          <polygon key={`f${k}`} points={pts(loop)} className={k === 0 ? 'floor' : 'hole'} />
        ))}
        {room.ceilingZones
          .filter((z) => !z.isMain)
          .map((z, k) => (z.loops[0] ? <polygon key={`z${k}`} points={pts(z.loops[0])} className="pocket" /> : null))}
        {room.objects.map((o, k) => (
          <polygon key={`o${k}`} points={pts(footprint(o))} className="object">
            <title>{`${o.name} (${o.kind})`}</title>
          </polygon>
        ))}
        {design.intents.map((i) => {
          const color = intentInkColor(i.kind);
          const cls = i.isSuggestion ? 'intent suggestion' : 'intent';
          if (i.region.length >= 3) return <polygon key={i.id} points={pts(i.region)} className={cls} style={{ stroke: color, fill: color }} />;
          if (i.region.length === 2) return <polyline key={i.id} points={pts(i.region)} className={`${cls} run`} style={{ stroke: color }} />;
          const p = i.region[0];
          return p ? <circle key={i.id} cx={p.x} cy={-p.y} r={0.8} className={cls} style={{ stroke: color, fill: color }} /> : null;
        })}
        {accepted.flatMap((i) =>
          i.fixtures.map((f) => (
            <circle key={f.id} cx={f.center.x} cy={-f.center.y} r={0.45} className="fixture" style={{ stroke: intentInkColor(i.kind) }} />
          )),
        )}
      </svg>
      <figcaption className="muted small">
        Plan preview — {accepted.length} intent{accepted.length === 1 ? '' : 's'}, {fixtures} fixture{fixtures === 1 ? '' : 's'}. The
        editable plan canvas arrives in Phase 3.
      </figcaption>
    </figure>
  );
}

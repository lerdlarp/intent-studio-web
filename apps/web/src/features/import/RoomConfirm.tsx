// Room confirmation step: the designer checks each extracted room (outline, ceiling height, object kinds) before it
// is created. With nothing extracted (strategy 'none') it becomes the manual outline form.
import { useState } from 'react';
import { OBJECT_KINDS, feetToMeters, footprint, metersToFeet, type P2, type StudioRoom } from '@intent-studio/core';
import { useStudio } from '../../state/instance';
import type { Units } from '../../state/store';
import { applyRoomEdits, manualRoom, type ExtractedScene } from './extract';

interface Draft {
  include: boolean;
  label: string;
  ceiling: string;
  outline: { x: string; y: string }[];
  outlineEdited: boolean;
  kinds: string[];
  /** Extracted room; null for the manual outline. */
  room: StudioRoom | null;
}

const STRATEGY_TEXT = {
  tags: 'Rooms were found from tagged nodes (room:, floor, wall, ceiling, obj:).',
  geometry: 'Rooms were found from the geometry (floor, wall section at 1 m, ceiling).',
  none: 'No room could be found automatically. Draw the floor outline by hand.',
} as const;

const toDisplay = (ft: number, u: Units): string => {
  const v = u === 'imperial' ? ft : feetToMeters(ft);
  return String(Math.round(v * 1000) / 1000);
};
const fromDisplay = (text: string, u: Units): number => {
  const v = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(v)) return NaN;
  return u === 'imperial' ? v : metersToFeet(v);
};
const unitWord = (u: Units) => (u === 'imperial' ? 'ft' : 'm');

function draftOf(room: StudioRoom, u: Units): Draft {
  return {
    include: true,
    label: room.label,
    ceiling: toDisplay(room.ceilingHeight, u),
    outline: (room.floor[0] ?? []).map((p) => ({ x: toDisplay(p.x, u), y: toDisplay(p.y, u) })),
    outlineEdited: false,
    kinds: room.objects.map((o) => o.kind),
    room,
  };
}
function manualDraft(u: Units): Draft {
  const rect: P2[] = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 20 },
    { x: 0, y: 20 },
  ];
  return {
    include: true,
    label: 'New room',
    ceiling: toDisplay(9, u),
    outline: rect.map((p) => ({ x: toDisplay(p.x, u), y: toDisplay(p.y, u) })),
    outlineEdited: true,
    kinds: [],
    room: null,
  };
}

function OutlinePreview({ outline, room }: { outline: P2[]; room: StudioRoom | null }) {
  const valid = outline.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 3) return <div className="placeholder small">Outline needs 3+ points</div>;
  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1;
  const maxY = Math.max(...ys) + 1;
  const pts = (poly: P2[]) => poly.map((p) => `${p.x},${-p.y}`).join(' ');
  return (
    <svg
      className="outline-preview"
      viewBox={`${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`}
      role="img"
      aria-label="Outline preview"
    >
      <polygon points={pts(valid)} className="floor" />
      {room?.objects.map((o, k) => (
        <polygon key={k} points={pts(footprint(o))} className="object" />
      ))}
      {valid.map((p, k) => (
        <text key={k} x={p.x} y={-p.y} className="vertex-label">
          {k + 1}
        </text>
      ))}
    </svg>
  );
}

export function RoomConfirm({
  filename,
  scene,
  onCancel,
  onConfirm,
}: {
  filename: string;
  scene: ExtractedScene;
  onCancel: () => void;
  onConfirm: (rooms: StudioRoom[]) => void;
}) {
  const units = useStudio((s) => s.units);
  const manual = scene.rooms.length === 0;
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    manual ? [manualDraft(units)] : scene.rooms.map((r) => draftOf(r, units)),
  );
  const [error, setError] = useState<string | null>(null);
  const [draftUnits] = useState<Units>(units); // inputs keep the unit they were opened with
  const u = draftUnits;

  const patch = (k: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d, i) => (i === k ? { ...d, ...p } : d)));
  const outlineFt = (d: Draft): P2[] => d.outline.map((p) => ({ x: fromDisplay(p.x, u), y: fromDisplay(p.y, u) }));

  const confirm = async () => {
    setError(null);
    try {
      const out: StudioRoom[] = [];
      for (const d of drafts) {
        if (!d.include) continue;
        const ceiling = fromDisplay(d.ceiling, u);
        if (!(ceiling > 0)) throw new Error(`“${d.label || 'Room'}”: enter a positive ceiling height.`);
        const outline = outlineFt(d);
        if (outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
          throw new Error(`“${d.label || 'Room'}”: every outline point needs numbers.`);
        if (d.room === null) out.push(await manualRoom(outline, ceiling, d.label.trim()));
        else {
          const sameHeight = d.ceiling === toDisplay(d.room.ceilingHeight, u);
          out.push(
            await applyRoomEdits(d.room, {
              label: d.label.trim(),
              ceilingHeight: sameHeight ? d.room.ceilingHeight : ceiling,
              outline: d.outlineEdited ? outline : null,
              kinds: d.kinds,
            }),
          );
        }
      }
      if (out.length === 0) throw new Error('Pick at least one room.');
      onConfirm(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="confirm">
      <p>
        <strong>{filename}</strong> — {STRATEGY_TEXT[scene.strategy]}
        {!manual && ` ${scene.rooms.length} room${scene.rooms.length === 1 ? '' : 's'} found.`}
      </p>
      {(scene.warnings.length > 0 || scene.classifyIssue) && (
        <ul className="warnings" aria-label="Import warnings">
          {scene.warnings.map((w, k) => (
            <li key={k}>{w}</li>
          ))}
          {scene.classifyIssue && <li>Object kinds: {scene.classifyIssue}</li>}
        </ul>
      )}
      {drafts.map((d, k) => (
        <fieldset key={k} className="confirm-room">
          <legend>
            {d.room ? (
              <label>
                <input type="checkbox" checked={d.include} onChange={(e) => patch(k, { include: e.target.checked })} />{' '}
                Room {k + 1}
              </label>
            ) : (
              'Manual outline'
            )}
          </legend>
          <div className="confirm-grid">
            <div>
              <label className="field">
                <span>Label</span>
                <input value={d.label} maxLength={200} onChange={(e) => patch(k, { label: e.target.value })} />
              </label>
              <label className="field">
                <span>Ceiling height ({unitWord(u)})</span>
                <input inputMode="decimal" value={d.ceiling} onChange={(e) => patch(k, { ceiling: e.target.value })} />
              </label>
              <table className="vertices">
                <caption className="small muted">Outline points ({unitWord(u)}, +Y is north)</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">X</th>
                    <th scope="col">Y</th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.outline.map((p, j) => {
                    const set = (q: Partial<{ x: string; y: string }>) =>
                      patch(k, {
                        outline: d.outline.map((v, i) => (i === j ? { ...v, ...q } : v)),
                        outlineEdited: true,
                      });
                    return (
                      <tr key={j}>
                        <th scope="row">{j + 1}</th>
                        <td>
                          <input
                            aria-label={`Point ${j + 1} X`}
                            inputMode="decimal"
                            value={p.x}
                            onChange={(e) => set({ x: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Point ${j + 1} Y`}
                            inputMode="decimal"
                            value={p.y}
                            onChange={(e) => set({ y: e.target.value })}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="link"
                            disabled={d.outline.length <= 3}
                            aria-label={`Remove point ${j + 1}`}
                            onClick={() =>
                              patch(k, { outline: d.outline.filter((_, i) => i !== j), outlineEdited: true })
                            }
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() =>
                  patch(k, {
                    outline: [...d.outline, { ...(d.outline.at(-1) ?? { x: '0', y: '0' }) }],
                    outlineEdited: true,
                  })
                }
              >
                Add point
              </button>
            </div>
            <OutlinePreview outline={outlineFt(d)} room={d.room} />
          </div>
          {d.room && d.room.objects.length > 0 && (
            <table className="objects">
              <caption className="small muted">Objects — check the kinds; they drive the suggestions</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                </tr>
              </thead>
              <tbody>
                {d.room.objects.map((o, j) => (
                  <tr key={j}>
                    <td>{o.name}</td>
                    <td>
                      <select
                        aria-label={`Kind of ${o.name}`}
                        value={d.kinds[j] ?? 'other'}
                        onChange={(e) => patch(k, { kinds: d.kinds.map((v, i) => (i === j ? e.target.value : v)) })}
                      >
                        {[...new Set([...(OBJECT_KINDS as readonly string[]), d.kinds[j] ?? 'other'])].map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </fieldset>
      ))}
      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => void confirm()}>
          Create {drafts.filter((d) => d.include).length === 1 ? 'room' : 'rooms'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

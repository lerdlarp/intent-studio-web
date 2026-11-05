// The 3D dollhouse (PLAN §1 UI, Phase 3). React is only the wrapper: the three.js work lives in scene.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../../state/instance';
import { intentPose, presetPose, wallPose, type PresetName } from './camera';
import { designHeat } from './heat';
import { loadContextMesh } from './meshContext';
import { DollhouseView } from './scene';
import './room3d.css';

export function Room3D() {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const rooms = useStudio((s) => s.rooms);
  const roomId = useStudio((s) => s.roomId);
  const assetId = rooms.find((r) => r.id === roomId)?.sourceAssetId ?? null;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<DollhouseView | null>(null);
  const framedRoom = useRef<string | null>(null);
  const meshCache = useRef<{ id: string; root: Awaited<ReturnType<typeof loadContextMesh>> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [heatOn, setHeatOn] = useState(true);
  const [ceilingOn, setCeilingOn] = useState(false);
  const [meshOn, setMeshOn] = useState(false);
  const [meshNote, setMeshNote] = useState<string | null>(null);
  const [wallIdx, setWallIdx] = useState(0);
  const [focusId, setFocusId] = useState('');

  // renderer lifetime
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      viewRef.current = new DollhouseView(host);
    } catch {
      setFailed(true);
      return;
    }
    return () => {
      viewRef.current?.dispose();
      viewRef.current = null;
      framedRoom.current = null;
    };
  }, []);

  // geometry (rebuilt when the solved design changes)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !design) return;
    view.setDesign(design);
    if (framedRoom.current !== design.room.id) {
      framedRoom.current = design.room.id;
      view.setPose(presetPose(design, 'default'));
    }
    // keep the heat layer in step with the (freshly rebuilt) content
  }, [design, failed]);

  // heat textures: computed off the animation loop, memoized per design object
  const hasEstimates = Object.keys(estimates).length > 0;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !design) return;
    if (!hasEstimates) {
      view.setHeat(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      view.setHeat(designHeat(design));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [design, hasEstimates, estimates, failed]);

  useEffect(() => viewRef.current?.setHeatVisible(heatOn), [heatOn, design, failed]);
  useEffect(() => viewRef.current?.setCeilingVisible(ceilingOn), [ceilingOn, design, failed]);

  // imported mesh context
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!meshOn || !assetId) {
      view.setContext(null);
      setMeshNote(null);
      return;
    }
    const ctl = new AbortController();
    void (async () => {
      let entry = meshCache.current;
      if (!entry || entry.id !== assetId) {
        entry = { id: assetId, root: await loadContextMesh(assetId, ctl.signal) };
        meshCache.current = entry;
      }
      if (ctl.signal.aborted) return;
      if (entry.root) {
        view.setContext(entry.root);
        setMeshNote(null);
      } else setMeshNote('Imported mesh unavailable');
    })();
    return () => {
      ctl.abort();
      viewRef.current?.setContext(null); // detaches (and disposes) the shown copy; reloaded on next toggle
      meshCache.current = null;
    };
  }, [meshOn, assetId, failed]);

  const accepted = useMemo(() => (design ? design.intents.filter((i) => !i.isSuggestion) : []), [design]);

  if (!design) return null;
  const go = (name: PresetName) => viewRef.current?.setPose(presetPose(design, name));
  const faceWall = () => {
    const n = design.room.walls.length;
    if (n === 0) return;
    const next = wallIdx % n;
    const pose = wallPose(design, next);
    if (pose) viewRef.current?.setPose(pose);
    setWallIdx(next + 1);
  };
  const focus = () => {
    const intent = accepted.find((i) => i.id === focusId) ?? accepted[0];
    if (!intent) return;
    const pose = intentPose(design, intent);
    if (pose) viewRef.current?.setPose(pose);
  };

  return (
    <div className="room3d" role="region" aria-label="3D view">
      <div className="room3d-bar" role="toolbar" aria-label="3D view controls">
        <button type="button" aria-label="Default view, south-east 35 degrees" onClick={() => go('default')}>
          Default
        </button>
        <button type="button" aria-label="Top view" onClick={() => go('top')}>
          Top
        </button>
        <button type="button" aria-label="Eye level view, 5.5 feet" onClick={() => go('eye')}>
          Eye level
        </button>
        <button type="button" aria-label="Face next wall" onClick={faceWall} disabled={design.room.walls.length === 0}>
          Face wall
        </button>
        <span className="sep" aria-hidden="true" />
        <select aria-label="Intent to focus" value={focusId} onChange={(e) => setFocusId(e.target.value)} disabled={accepted.length === 0}>
          {accepted.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label || i.kind}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Focus on the chosen intent" onClick={focus} disabled={accepted.length === 0}>
          Focus
        </button>
        <span className="sep" aria-hidden="true" />
        <button type="button" aria-pressed={heatOn} aria-label="Toggle heat textures (estimates)" onClick={() => setHeatOn((v) => !v)} disabled={!hasEstimates}>
          Heat
        </button>
        <button type="button" aria-pressed={ceilingOn} aria-label="Toggle ceiling" onClick={() => setCeilingOn((v) => !v)}>
          Ceiling
        </button>
        {assetId && (
          <button type="button" aria-pressed={meshOn} aria-label="Toggle imported mesh context" onClick={() => setMeshOn((v) => !v)}>
            Imported mesh
          </button>
        )}
      </div>
      <div className="room3d-canvas" ref={hostRef}>
        {failed && <div className="room3d-msg">The 3D view needs WebGL, which is not available here.</div>}
        <span className="room3d-note">
          {hasEstimates && heatOn ? 'Heat colours are estimates. ' : ''}
          {meshNote ?? ''}
        </span>
      </div>
    </div>
  );
}

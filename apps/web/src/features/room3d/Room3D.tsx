// The 3D dollhouse (PLAN §1 UI, Phase 3). React is only the wrapper: the three.js work lives in scene.ts.
import { useEffect, useRef, useState } from 'react';
import { CALC_LABEL } from '@intent-studio/core';
import { useStudio } from '../../state/instance';
import { intentPose, presetPose, wallPose, type PresetName } from './camera';
import { calcDesignHeat, designHeat } from './heat';
import { freshCalc } from '../../state/store';
import { loadContextMesh } from './meshContext';
import { litPreview, EV_MAX, EV_MIN, type LitPreview } from './litPreview';
import { DollhouseView } from './scene';
import './room3d.css';

export function Room3D() {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const calc = useStudio((s) => freshCalc(s));
  const rooms = useStudio((s) => s.rooms);
  const roomId = useStudio((s) => s.roomId);
  const selectedId = useStudio((s) => s.selectedIntentId);
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
  const [litOn, setLitOn] = useState(false);
  const [ev, setEv] = useState(0);
  const [shadowsOn, setShadowsOn] = useState(false);
  const [lit, setLit] = useState<LitPreview | null>(null);

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
      // the full calculation's grids while it matches the design, else the quick estimate
      view.setHeat(calc ? calcDesignHeat(calc) : designHeat(design));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [design, hasEstimates, estimates, failed, calc]);

  useEffect(() => viewRef.current?.setHeatVisible(heatOn), [heatOn, design, failed]);
  useEffect(() => viewRef.current?.setCeilingVisible(ceilingOn), [ceilingOn, design, failed]);

  // lit preview: one spot per fixture (capped), rebuilt with the design
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !design) return;
    const next = litOn ? litPreview(design) : null;
    view.setLit(next);
    setLit(next);
  }, [design, litOn, failed]);
  useEffect(() => viewRef.current?.setExposureEv(ev), [ev, litOn, failed]);
  useEffect(() => viewRef.current?.setShadows(shadowsOn), [shadowsOn, litOn, failed]);

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

  if (!design) return null;
  const selected = design.intents.find((i) => i.id === selectedId);
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
    const intent = design.intents.find((i) => i.id === selectedId);
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
        <button
          type="button"
          aria-label={selected ? `Focus on ${selected.label}` : 'Focus on the selected intent (select one first)'}
          title={selected ? `Focus on ${selected.label}` : 'Select an intent in the plan or the inspector'}
          onClick={focus}
          disabled={!selected}
        >
          Focus
        </button>
        <span className="sep" aria-hidden="true" />
        <button type="button" aria-pressed={heatOn} aria-label="Toggle heat textures (estimates)" onClick={() => setHeatOn((v) => !v)} disabled={!hasEstimates}>
          Heat
        </button>
        <button type="button" aria-pressed={ceilingOn} aria-label="Toggle ceiling" onClick={() => setCeilingOn((v) => !v)}>
          Ceiling
        </button>
        <span className="sep" aria-hidden="true" />
        <button type="button" aria-pressed={litOn} aria-label="Toggle lit preview (preview, not a calculation)" onClick={() => setLitOn((v) => !v)}>
          Lit preview
        </button>
        {litOn && (
          <>
            <label className="room3d-ctl">
              Exposure
              <input type="range" min={EV_MIN} max={EV_MAX} step={0.25} value={ev} aria-label="Exposure (EV)" onChange={(e) => setEv(Number(e.target.value))} />
              <output>{ev > 0 ? `+${ev}` : ev} EV</output>
            </label>
            <label className="room3d-ctl">
              <input type="checkbox" checked={shadowsOn} onChange={(e) => setShadowsOn(e.target.checked)} />
              Shadows (slower)
            </label>
          </>
        )}
        {assetId && (
          <button type="button" aria-pressed={meshOn} aria-label="Toggle imported mesh context" onClick={() => setMeshOn((v) => !v)}>
            Imported mesh
          </button>
        )}
      </div>
      <div className="room3d-canvas" ref={hostRef}>
        {failed && <div className="room3d-msg">The 3D view needs WebGL, which is not available here.</div>}
        <span className="room3d-note">
          {litOn
            ? `Preview, not a calculation.${lit?.merged ? ` ${lit.total} lights merged into ${lit.spots.length} representative lights.` : ''} `
            : hasEstimates && heatOn
              ? calc
                ? `Heat: ${CALC_LABEL}. `
                : 'Heat colours are quick estimates. '
              : ''}
          {meshNote ?? ''}
        </span>
      </div>
    </div>
  );
}

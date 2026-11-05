// Import flow: pick a scene file → upload it (/api/assets?kind=scene) → extract rooms → confirm → create rooms.
import { useState, type ChangeEvent } from 'react';
import type { StudioRoom } from '@intent-studio/core';
import { createApi } from '../../api/client';
import { studio } from '../../state/instance';
import { SCENE_EXTENSIONS, extractRooms, type ExtractedScene } from './extract';
import { RoomConfirm } from './RoomConfirm';

const api = createApi();

type Step =
  | { kind: 'pick' }
  | { kind: 'working'; text: string }
  | { kind: 'confirm'; assetId: string | null; filename: string; scene: ExtractedScene }
  | { kind: 'failed'; text: string; assetId: string | null; filename: string };

export function ImportFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let assetId: string | null = null;
    try {
      setStep({ kind: 'working', text: `Uploading ${file.name}…` });
      const buffer = await file.arrayBuffer();
      const asset = await api.uploadAsset('scene', file, file.name);
      assetId = asset.id;
      setStep({ kind: 'working', text: 'Finding rooms in the scene…' });
      const projectId = studio.getState().project?.id;
      const scene = await extractRooms(buffer, file.name, (body) => api.classify({ ...body, ...(projectId ? { projectId } : {}) }));
      setStep({ kind: 'confirm', assetId: asset.id, filename: file.name, scene });
    } catch (err) {
      setStep({ kind: 'failed', text: err instanceof Error ? err.message : String(err), assetId, filename: file.name });
    }
  };

  const create = async (picked: StudioRoom[], assetId: string | null) => {
    try {
      setStep({ kind: 'working', text: 'Creating rooms…' });
      let last: string | null = null;
      for (const room of picked) {
        const r = await studio.getState().addRoom(room, assetId);
        if (r) last = r.id;
      }
      onClose();
      if (picked.length === 1 && last) await studio.getState().openRoom(last);
    } catch (err) {
      setStep({ kind: 'failed', text: err instanceof Error ? err.message : String(err), assetId, filename: '' });
    }
  };

  return (
    <section className="card" aria-labelledby="import-h">
      <div className="row spread">
        <h2 id="import-h">Import a 3D scene</h2>
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
      {(step.kind === 'pick' || step.kind === 'failed') && (
        <>
          {step.kind === 'failed' && (
            <div className="banner banner-error" role="alert">
              <span>{step.text}</span>
              <button
                type="button"
                className="link"
                onClick={() =>
                  setStep({
                    kind: 'confirm',
                    assetId: step.assetId,
                    filename: step.filename || 'Manual room',
                    scene: { rooms: [], strategy: 'none', warnings: [], unresolved: 0, classifyIssue: null },
                  })
                }
              >
                Enter the outline by hand
              </button>
            </div>
          )}
          <label className="file-pick">
            <span>Choose a GLB, glTF, OBJ or FBX file</span>
            <input type="file" accept={SCENE_EXTENSIONS.join(',')} onChange={(e) => void pick(e)} />
          </label>
          <p className="muted small">The original file is stored with the project. Rooms are found in your browser and you confirm each one.</p>
        </>
      )}
      {step.kind === 'working' && (
        <p role="status" aria-live="polite">
          {step.text}
        </p>
      )}
      {step.kind === 'confirm' && (
        <RoomConfirm
          filename={step.filename}
          scene={step.scene}
          onCancel={onClose}
          onConfirm={(picked) => void create(picked, step.assetId)}
        />
      )}
    </section>
  );
}

// Import flow: pick a scene file → upload it (/api/assets?kind=scene) → extract rooms → confirm → create rooms.
import { useState, type ChangeEvent } from 'react';
import type { StudioRoom } from '@intent-studio/core';
import { createApi } from '../../api/client';
import { studio } from '../../state/instance';
import { LARGE_SCENE_BYTES, SCENE_EXTENSIONS, extractRooms, type ExtractedScene } from './extract';
import { errorText } from '../../state/store';
import { RoomConfirm } from './RoomConfirm';

const api = createApi();

type Step =
  | { kind: 'pick' }
  | { kind: 'working'; text: string; step: number }
  | { kind: 'confirm'; assetId: string | null; filename: string; scene: ExtractedScene }
  | { kind: 'failed'; text: string; assetId: string | null; filename: string; file: File | null };

const STEPS = 4;
const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;

export function ImportFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  const run = async (file: File) => {
    let assetId: string | null = null;
    setSizeWarning(
      file.size > LARGE_SCENE_BYTES
        ? `${file.name} is ${mb(file.size)}. Large scenes take longer to upload and import, and the 3D view shows a simplified copy; rooms are still found from the full model.`
        : null,
    );
    try {
      setStep({ kind: 'working', text: `Reading ${file.name} (${mb(file.size)})…`, step: 1 });
      const buffer = await file.arrayBuffer();
      setStep({ kind: 'working', text: `Uploading ${file.name}…`, step: 1 });
      try {
        assetId = (await api.uploadAsset('scene', file, file.name)).id;
      } catch (err) {
        throw new Error(
          `The file could not be uploaded (${errorText('Upload', err).replace(/^Upload failed: /, '')}). Try again.`,
        );
      }
      const projectId = studio.getState().project?.id;
      const scene = await extractRooms(
        buffer,
        file.name,
        (body) => api.classify({ ...body, ...(projectId ? { projectId } : {}) }),
        (stage, detail) =>
          setStep(
            stage === 'parse'
              ? { kind: 'working', text: 'Reading the 3D scene…', step: 2 }
              : stage === 'extract'
                ? { kind: 'working', text: 'Finding rooms in the scene…', step: 3 }
                : {
                    kind: 'working',
                    text: `Suggesting object kinds (batch ${detail?.batch ?? 1} of ${detail?.batches ?? 1})…`,
                    step: 4,
                  },
          ),
      );
      setStep({ kind: 'confirm', assetId, filename: file.name, scene });
    } catch (err) {
      setStep({
        kind: 'failed',
        text: err instanceof Error ? err.message : String(err),
        assetId,
        filename: file.name,
        file,
      });
    }
  };

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void run(file);
  };

  const create = async (picked: StudioRoom[], assetId: string | null) => {
    try {
      setStep({ kind: 'working', text: 'Creating rooms…', step: STEPS });
      let last: string | null = null;
      for (const room of picked) {
        const r = await studio.getState().addRoom(room, assetId);
        if (r) last = r.id;
      }
      onClose();
      if (picked.length === 1 && last) await studio.getState().openRoom(last);
    } catch (err) {
      setStep({
        kind: 'failed',
        text: err instanceof Error ? err.message : String(err),
        assetId,
        filename: '',
        file: null,
      });
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
            <div className="banner banner-error" role="alert" data-testid="import-error">
              <span>{step.text}</span>
              <span className="row">
                {step.file && (
                  <button type="button" onClick={() => step.file && void run(step.file)}>
                    Try again
                  </button>
                )}
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
              </span>
            </div>
          )}
          <label className="file-pick">
            <span>Choose a GLB, glTF, OBJ or FBX file</span>
            <input type="file" accept={SCENE_EXTENSIONS.join(',')} onChange={pick} data-testid="scene-input" />
          </label>
          <p className="muted small">
            The original file is stored with the project. Rooms are found in your browser and you confirm each one.
          </p>
        </>
      )}
      {sizeWarning && step.kind !== 'pick' && (
        <p className="warnings" role="note" data-testid="import-size-warning">
          {sizeWarning}
        </p>
      )}
      {step.kind === 'working' && (
        <div className="import-progress" data-testid="import-progress">
          <progress max={STEPS} value={step.step} aria-label="Import progress" />
          <p role="status" aria-live="polite" className="small">
            Step {step.step} of {STEPS}: {step.text}
          </p>
        </div>
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

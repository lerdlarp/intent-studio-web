import { useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { ImportFlow } from '../import/ImportFlow';
import { Library } from '../library/Library';

export function ProjectScreen() {
  const project = useStudio((s) => s.project);
  const rooms = useStudio((s) => s.rooms);
  const [importing, setImporting] = useState(false);
  const { openRoom } = studio.getState();
  if (!project) return null;

  return (
    <div className="home">
      <section className="card" aria-labelledby="rooms-h">
        <div className="row spread">
          <h2 id="rooms-h">Rooms in {project.name}</h2>
          {!importing && (
            <button type="button" onClick={() => setImporting(true)}>
              Import a 3D scene…
            </button>
          )}
        </div>
        {rooms.length === 0 ? (
          <p className="muted">No rooms yet. Import a GLB, glTF, OBJ or FBX scene to add one.</p>
        ) : (
          <ul className="list">
            {rooms.map((r) => (
              <li key={r.id}>
                <button type="button" className="list-item" onClick={() => void openRoom(r.id)}>
                  <span>{r.label || 'Untitled room'}</span>
                  <span className="muted small">{r.sourceAssetId ? 'imported' : 'demo'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {importing && <ImportFlow onClose={() => setImporting(false)} />}
      <Library projectId={project.id} onProductsChange={(p) => studio.getState().setProjectProducts(p, project.id)} />
    </div>
  );
}

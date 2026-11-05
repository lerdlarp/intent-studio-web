import { useState, type FormEvent } from 'react';
import { DEMO_ROOM_NAMES, demoRoom } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';

const DEMO_LABELS = Object.fromEntries(DEMO_ROOM_NAMES.map((n) => [n, demoRoom(n).label]));

export function Home() {
  const projects = useStudio((s) => s.projects);
  const busy = useStudio((s) => s.busy);
  const [name, setName] = useState('');
  const { createProject, openProject, openDemo } = studio.getState();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const p = await createProject(n);
    if (p) {
      setName('');
      await openProject(p.id);
    }
  };

  return (
    <div className="home">
      <section className="card" aria-labelledby="demo-h">
        <h2 id="demo-h">Open a demo room</h2>
        <p className="muted">Creates a “Demo rooms” project with the four sample rooms and opens the one you pick.</p>
        <div className="demo-grid">
          {DEMO_ROOM_NAMES.map((n) => (
            <button key={n} type="button" className="tile" disabled={busy !== null} onClick={() => void openDemo(n)}>
              <strong>{DEMO_LABELS[n]}</strong>
              <span className="muted">{n === 'DataHall' ? 'Data hall' : n}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="projects-h">
        <h2 id="projects-h">Projects</h2>
        <form className="row" onSubmit={(e) => void submit(e)}>
          <label className="grow">
            <span className="sr-only">New project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" maxLength={200} />
          </label>
          <button type="submit" disabled={!name.trim() || busy !== null}>
            Create project
          </button>
        </form>
        {projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="list">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" className="list-item" onClick={() => void openProject(p.id)}>
                  <span>{p.name}</span>
                  <span className="muted small">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

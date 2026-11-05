// Project product library: upload IES LM-63 files (parsed on the server into products), list them with lumens,
// watts, beam and family, delete. Products live per project; there is no external catalog.
import { useCallback, useEffect, useRef, useState } from 'react';
import { familyWord, format0, formatGrouped } from '@intent-studio/core';
import { createLibraryApi, productsOf, type LibraryApi, type ProductView } from './api';
import './library.css';

export interface LibraryProps {
  projectId: string;
  api?: LibraryApi;
  /** Called with the project's products after every load/upload/delete (wire to the store's project products). */
  onProductsChange?: (products: ProductView['product'][]) => void;
}

const defaultApi = createLibraryApi();

export function Library({ projectId, api = defaultApi, onProductsChange }: LibraryProps) {
  const [items, setItems] = useState<ProductView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const changed = useRef(onProductsChange);
  changed.current = onProductsChange;

  const apply = useCallback((next: ProductView[]) => {
    setItems(next);
    changed.current?.(productsOf(next));
  }, []);

  useEffect(() => {
    let live = true;
    api
      .list(projectId)
      .then((l) => live && apply(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [api, projectId, apply]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    let next = items;
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      try {
        next = [...next, await api.uploadIes(projectId, f, f.name)];
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    apply(next);
    if (problems.length) setError(problems.join('\n'));
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.remove(projectId, id);
      apply(items.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel library" aria-label="Product library" data-testid="library">
      <div className="row spread">
        <h2 className="library-title">Project products</h2>
        <label className={`button primary${busy ? ' disabled' : ''}`}>
          {busy ? 'Reading…' : 'Upload IES'}
          <input
            ref={input}
            type="file"
            accept=".ies,.IES,text/plain"
            multiple
            disabled={busy}
            className="sr-only"
            data-testid="ies-input"
            onChange={(e) => void upload(e.currentTarget.files)}
          />
        </label>
      </div>
      {error && (
        <p className="library-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted small">No project products yet. Upload IES LM-63 files to add luminaires with real photometry.</p>
      ) : (
        <table className="library-table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Family</th>
              <th scope="col" className="num">Lumens</th>
              <th scope="col" className="num">W</th>
              <th scope="col" className="num">Beam</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ id, product: p }) => (
              <tr key={id} data-testid="library-row">
                <th scope="row" title={p.description}>
                  {p.label}
                  {p.ies && <span className="tag">IES</span>}
                  {p.asymmetric && <span className="tag">asymmetric</span>}
                </th>
                <td>{familyWord(p.family)}</td>
                <td className="num">{formatGrouped(p.lumens)}</td>
                <td className="num">{format0(p.watts)}</td>
                <td className="num">{format0(p.beamAngle)}°</td>
                <td>
                  <button type="button" onClick={() => void remove(id)} aria-label={`Delete ${p.label}`}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

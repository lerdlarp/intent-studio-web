// Export menu: design JSON, fixture schedule CSV, plan PNG, plan PDF, glTF. Reads the store only.
import { useEffect, useRef, useState } from 'react';
import { designJson, scheduleCsv } from '@intent-studio/core';
import { useStudio } from '../../state/instance';
import { downloadBlob, exportFilename } from './download';
import { findPlanCanvas, planPng } from './png';
import './export.css';

type Kind = 'json' | 'csv' | 'png' | 'pdf' | 'glb';

export function ExportMenu() {
  const design = useStudio((s) => s.design);
  const units = useStudio((s) => s.units);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!design) return null;
  const label = design.room.label;

  const run = async (kind: Kind) => {
    setBusy(kind);
    setNote(null);
    try {
      switch (kind) {
        case 'json':
          downloadBlob(new Blob([designJson(design)], { type: 'application/json' }), exportFilename(label, 'design.json'));
          break;
        case 'csv':
          downloadBlob(new Blob([scheduleCsv(design, units)], { type: 'text/csv;charset=utf-8' }), exportFilename(label, 'schedule.csv'));
          break;
        case 'png': {
          const canvas = findPlanCanvas();
          if (!canvas) throw new Error('Open the plan view to export a snapshot.');
          downloadBlob(await planPng(canvas), exportFilename(label, 'plan.png'));
          break;
        }
        case 'pdf': {
          const canvas = findPlanCanvas();
          const png = canvas ? await planPng(canvas) : null;
          const { planPdf } = await import('./pdf');
          const blob = await planPdf(design, png, canvas ? { w: canvas.width, h: canvas.height } : null, units);
          downloadBlob(blob, exportFilename(label, 'plan.pdf'));
          if (!canvas) setNote('PDF has no plan image (plan view was not open).');
          break;
        }
        case 'glb': {
          const { exportGlb } = await import('./gltf');
          downloadBlob(new Blob([await exportGlb(design)], { type: 'model/gltf-binary' }), exportFilename(label, 'glb'));
          break;
        }
      }
      if (kind !== 'pdf') setOpen(false);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  const items: { kind: Kind; text: string; hint: string }[] = [
    { kind: 'json', text: 'Design JSON', hint: 'Versioned design document' },
    { kind: 'csv', text: 'Fixture schedule CSV', hint: `Lengths in ${units === 'metric' ? 'metres' : 'feet'}` },
    { kind: 'png', text: 'Plan PNG', hint: 'Snapshot of the plan view' },
    { kind: 'pdf', text: 'Plan PDF', hint: 'Plan + schedule, one page' },
    { kind: 'glb', text: 'glTF (GLB) with lights', hint: 'Metres, Y-up, KHR_lights_punctual' },
  ];

  return (
    <div className="export-menu" ref={rootRef}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Export
      </button>
      {open && (
        <div className="export-pop" role="menu" aria-label="Export">
          {items.map((it) => (
            <button key={it.kind} type="button" role="menuitem" disabled={busy !== null} onClick={() => void run(it.kind)}>
              <span>{busy === it.kind ? `${it.text}…` : it.text}</span>
              <small>{it.hint}</small>
            </button>
          ))}
          {note && (
            <p className="export-note" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

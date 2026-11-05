// Single-page plan PDF: snapshot + room name + fixture schedule + estimates note. jspdf is lazy-loaded.
import { scheduleRows, type ExportUnits, type RoomDesign } from '@intent-studio/core';

export async function planPdf(design: RoomDesign, png: Blob | null, canvasSize: { w: number; h: number } | null, units: ExportUnits): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = M + 6;
  doc.setFont('helvetica', 'bold').setFontSize(16);
  doc.text(design.room.label || 'Room', M, y);
  y += 14;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90);
  doc.text('Lighting plan. All values are estimates.', M, y);
  doc.setTextColor(0);
  y += 10;

  if (png && canvasSize && canvasSize.w > 0 && canvasSize.h > 0) {
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the plan image.'));
      r.readAsDataURL(png);
    });
    const maxW = W - 2 * M;
    const maxH = H * 0.5;
    const s = Math.min(maxW / canvasSize.w, maxH / canvasSize.h);
    const w = canvasSize.w * s;
    const h = canvasSize.h * s;
    doc.addImage(data, 'PNG', M + (maxW - w) / 2, y, w, h);
    y += h + 14;
  }

  const len = units === 'metric' ? 'm' : 'ft';
  const rows = scheduleRows(design, units);
  const cols: { head: string; x: number; get: (r: (typeof rows)[number]) => string }[] = [
    { head: 'Type', x: M, get: (r) => r.type },
    { head: 'lm', x: M + 190, get: (r) => String(r.lumens) },
    { head: 'W', x: M + 225, get: (r) => String(r.watts) },
    { head: 'K', x: M + 255, get: (r) => String(r.cct) },
    { head: 'Mount', x: M + 290, get: (r) => r.mount },
    { head: `H ${len}`, x: M + 340, get: (r) => String(r.height) },
    { head: `X ${len}`, x: M + 375, get: (r) => String(r.x) },
    { head: `Y ${len}`, x: M + 410, get: (r) => String(r.y) },
    { head: 'Intent', x: M + 445, get: (r) => r.intent },
  ];
  const fit = (s: string, x: number, next: number): string => {
    let t = s;
    while (t.length > 1 && doc.getTextWidth(t) > next - x - 4) t = t.slice(0, -2) + '…';
    return t;
  };
  const line = 10.5;
  doc.setFontSize(8).setFont('helvetica', 'bold');
  cols.forEach((c) => doc.text(c.head, c.x, y));
  y += line;
  doc.setFont('helvetica', 'normal');
  const footerY = H - M;
  let shown = 0;
  for (const r of rows) {
    if (y > footerY - 40) break;
    cols.forEach((c, i) => {
      const next = cols[i + 1]?.x ?? W - M;
      doc.text(fit(c.get(r), c.x, next), c.x, y);
    });
    y += line;
    shown++;
  }
  doc.setFont('helvetica', 'bold');
  const lm = rows.reduce((a, r) => a + r.lumens, 0);
  const w = rows.reduce((a, r) => a + r.watts, 0);
  const more = shown < rows.length ? `  (${rows.length - shown} more rows in the CSV)` : '';
  doc.text(`Total: ${rows.length} fixtures, ${Math.round(lm)} lm, ${Math.round(w)} W${more}`, M, y + 4);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90);
  doc.text('All values are estimates. Not a code-compliance document.', M, footerY);
  return doc.output('blob');
}

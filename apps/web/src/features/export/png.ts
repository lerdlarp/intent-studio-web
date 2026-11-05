// Plan snapshot: the plan canvas is found by its aria-label ("Plan of …"); composited on white so it prints.
export const PLAN_CANVAS_SELECTOR = 'canvas[aria-label^="Plan of"]';

export function findPlanCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  return root.querySelector<HTMLCanvasElement>(PLAN_CANVAS_SELECTOR);
}

export async function planPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'));
}

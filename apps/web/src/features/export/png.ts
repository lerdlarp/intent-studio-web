// Plan snapshot: the plan canvas is found by its aria-label ("Plan of …"); redrawn on the light palette and
// composited on white so it prints.
export const PLAN_CANVAS_SELECTOR = 'canvas[aria-label^="Plan of"]';

export function findPlanCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  return root.querySelector<HTMLCanvasElement>(PLAN_CANVAS_SELECTOR);
}

// The plan registers a renderer that redraws its current frame on the light palette, so an export made in dark mode
// still prints dark ink on white. Without one (no plan on screen) the on-screen canvas is used as is.
type PrintRenderer = () => HTMLCanvasElement | null;
let printRenderer: PrintRenderer | null = null;

export function setPlanPrintRenderer(fn: PrintRenderer): () => void {
  printRenderer = fn;
  return () => {
    if (printRenderer === fn) printRenderer = null;
  };
}

/** The plan as it should print: the light redraw when the plan is mounted, else the on-screen canvas. */
export function printablePlanCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  const onScreen = findPlanCanvas(root);
  if (!onScreen) return null;
  return printRenderer?.() ?? onScreen;
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
  return new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
  );
}

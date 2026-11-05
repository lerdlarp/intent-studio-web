// Plan view transform: plan feet (+Y north) ↔ canvas CSS pixels (+Y down). Pure; the canvas multiplies by
// devicePixelRatio itself.
import type { P2 } from '@intent-studio/core';

export interface View {
  /** CSS pixels per foot. */
  scale: number;
  /** Screen position (CSS px) of plan (0, 0). */
  ox: number;
  oy: number;
}

export const MIN_SCALE = 2;
export const MAX_SCALE = 400;
export const FIT_PADDING = 24;

export const toScreen = (v: View, p: P2): P2 => ({ x: v.ox + p.x * v.scale, y: v.oy - p.y * v.scale });
export const toPlan = (v: View, s: P2): P2 => ({ x: (s.x - v.ox) / v.scale, y: (v.oy - s.y) / v.scale });

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** The view that shows `bounds` centred in a `width × height` canvas with `pad` px around it. */
export function fitView(bounds: { min: P2; max: P2 }, width: number, height: number, pad = FIT_PADDING): View {
  const w = Math.max(bounds.max.x - bounds.min.x, 1e-3);
  const h = Math.max(bounds.max.y - bounds.min.y, 1e-3);
  const scale = clampScale(Math.min((width - 2 * pad) / w, (height - 2 * pad) / h));
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  return { scale, ox: width / 2 - cx * scale, oy: height / 2 + cy * scale };
}

/** Zoom by `factor` keeping the plan point under screen point `at` fixed. */
export function zoomAt(v: View, factor: number, at: P2): View {
  const scale = clampScale(v.scale * factor);
  const p = toPlan(v, at);
  return { scale, ox: at.x - p.x * scale, oy: at.y + p.y * scale };
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, ox: v.ox + dx, oy: v.oy + dy });

/** Wheel delta → zoom factor (smooth for trackpads, ~10 % per mouse notch). */
export const wheelFactor = (deltaY: number, deltaMode = 0): number => {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-400, Math.min(400, px)) * 0.001);
};

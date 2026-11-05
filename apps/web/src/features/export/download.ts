// Browser download via a Blob URL.
import { fileStem } from '@intent-studio/core';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const exportFilename = (roomLabel: string, ext: string): string => `${fileStem(roomLabel)}.${ext}`;

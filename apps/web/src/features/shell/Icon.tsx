import type { CSSProperties } from 'react';

const paths = {
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
  select: 'm5 3 14 10-7 1-3 7Z',
  task: 'M4 15h16M7 15v6m10-6v6M12 3v5m-4 3 4-3 4 3',
  ambient:
    'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  wash: 'M5 3v18M8 5l12 5M8 12h12M8 19l12-5',
  accent: 'm6 3 9 4-4 7-8-5Zm8 9 5 5m-8-2 3 6m3-11 5 3',
  pendant: 'M12 3v7m-5 6 5-6 5 6Zm3 4h4',
  glow: 'M3 12V5h18v7M7 9v3m5-3v3m5-3v3M6 19l2-3m4 5v-5m6 3-2-3',
  path: 'M5 3v18m14-18v18M9 6h6m-6 6h6m-6 6h6',
  dim: 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z',
  grid: 'M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18M15 3v18',
  fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  heat: 'M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 3-6 0 4 2 5 2 5s3-4 2-11Z',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  product: 'M4 7h16v10H4Zm2 3h12M7 20h10M9 17v3m6-3v3',
  add: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  merge: 'M3 5h10v10H3Zm10 4h8v12H9v-6',
  cube: 'm12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v9',
  plan: 'M3 3h18v18H3Zm0 11h8V3m0 11v7m5-11h5',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  check: 'm5 12 4 4L19 6',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, style }: { name: IconName; style?: CSSProperties }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

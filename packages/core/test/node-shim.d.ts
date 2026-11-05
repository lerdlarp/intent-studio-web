// Minimal Node typings for the test harness only (core src never uses Node APIs; @types/node is not a core dep).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
}
interface ImportMeta {
  readonly url: string;
}

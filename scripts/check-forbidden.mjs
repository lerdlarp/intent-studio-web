#!/usr/bin/env node
// Fails (exit 1) if any non-ignored file outside handoff/ contains a forbidden term.
// Patterns are built from fragments so this file does not match itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const terms = [
  ['acu', 'ity'],
  ['recommend', '_illuminance'],
  ['Illuminance', 'Recommendation'],
  ['Photometry', 'Id'],
].map((p) => p.join(''));
const re = new RegExp(terms.join('|'), 'i');
const skip = (f) =>
  f.startsWith('handoff/') ||
  f === 'CLAUDE.md' ||
  f === 'scripts/check-forbidden.mjs' ||
  /(^|\/)(node_modules|dist|\.git)\//.test(f);

const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  maxBuffer: 1 << 28,
}).toString('utf8');
const files = [...new Set(out.split('\0').filter(Boolean))].filter((f) => !skip(f) && existsSync(resolve(root, f)));

const hits = [];
for (const f of files) {
  const buf = readFileSync(resolve(root, f));
  if (buf.includes(0)) continue; // binary
  buf
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}
if (hits.length) {
  console.error('Forbidden strings found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`check-forbidden: ok (${files.length} files scanned)`);

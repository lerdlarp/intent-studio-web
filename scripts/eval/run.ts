// `pnpm eval`: run the AI eval (scripts/eval/lib.ts) and store every output as JSON under
// scripts/eval/results/<timestamp>/. Live with the real Claude client when ANTHROPIC_API_KEY is set (model from
// AI_MODEL), otherwise the rules fallback. Exits non-zero when any assertion fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicClaude } from '../../apps/server/src/ai/claude';
import { configFromEnv } from '../../apps/server/src/config';
import { formatSummary, runEval, type EvalReport } from './lib';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Write the report: one JSON file per task, plus summary.json (failures included). Returns the directory. */
export function writeReport(report: EvalReport, root = path.join(here, 'results')): string {
  const dir = path.join(root, report.startedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  for (const task of ['advise', 'interpret', 'classify', 'propose'] as const)
    fs.writeFileSync(path.join(dir, `${task}.json`), JSON.stringify(report.records.filter((r) => r.task === task), null, 2));
  const { records: _r, ...rest } = report;
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(rest, null, 2));
  return dir;
}

async function main(): Promise<number> {
  const config = configFromEnv();
  const claude = config.apiKey ? new AnthropicClaude(config.apiKey, config.model) : null;
  const report = await runEval({ claude, config: { model: config.model, aiTimeoutMs: config.aiTimeoutMs } });
  const dir = writeReport(report);
  console.log(formatSummary(report));
  console.log(`Results: ${path.relative(process.cwd(), dir) || dir}`);
  return report.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(2);
    },
  );
}

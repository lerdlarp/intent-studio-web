import { expect, test, type APIRequestContext } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMPTY_UUID, demoRoom } from '../../packages/core/src/index';

// Phase 6 performance: (1) solveAll + quick estimate on the browser main thread for every demo room (the plan moves
// the solver to a worker when a solve takes > 50 ms); (2) a rapid density drag on the largest room: main-thread long
// tasks while the edits are solved, and the time until the last edit's estimate shows. Timings are written to
// e2e/test-results/perf/timings.json and printed.
const OUT = fileURLToPath(new URL('../test-results/perf/', import.meta.url));

interface SolveTiming {
  room: string;
  intents: number;
  fixtures: number;
  solveMedian: number;
  solveMax: number;
  estimateMedian: number;
}

async function project(request: APIRequestContext, name: string): Promise<void> {
  const p = await (await request.post('/api/projects', { data: { name } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, {
    data: { room: { ...demoRoom('Cafeteria'), id: EMPTY_UUID }, sourceAssetId: null },
  });
  expect(r.ok()).toBe(true);
}

test('solve timings per demo room; density drag stays responsive', async ({ page, request }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open a demo room' })).toBeVisible();
  const timings = await page.evaluate(async () => {
    const m = (await import(/* @vite-ignore */ '/src/state/perf.ts' as string)) as {
      timeSolves(reps?: number): SolveTiming[];
    };
    return m.timeSolves(7);
  });
  expect(timings).toHaveLength(4);
  for (const t of timings) expect(t.fixtures).toBeGreaterThan(0);

  await project(request, 'Perf drag');
  await page.goto('/');
  await page.getByRole('button', { name: /Perf drag/ }).click();
  await page.getByRole('button', { name: /110 Cafeteria/ }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await page.getByRole('button', { name: /^Cafeteria ambient/ }).click();
  const slider = page.getByLabel('Density');
  await expect(slider).toBeVisible();
  await expect(page.getByTestId('solving')).toHaveCount(0);

  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  await slider.focus();
  const t0 = Date.now();
  for (let k = 0; k < 10; k++) await page.keyboard.press('ArrowRight', { delay: 0 });
  await expect(slider).toHaveValue('1.6');
  const inputMs = Date.now() - t0;
  // settled: no solve pending and the estimate is current
  await expect(page.getByTestId('solving')).toHaveCount(0);
  await expect(page.locator('.estimate.stale')).toHaveCount(0);
  const settledMs = Date.now() - t0;
  const longTasks = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);

  const report = {
    timings,
    drag: {
      edits: 10,
      inputMs,
      settledMs,
      longTasks: longTasks.length,
      longestTaskMs: Math.max(0, ...longTasks),
      totalLongMs: longTasks.reduce((a, b) => a + b, 0),
    },
  };
  writeFileSync(OUT + 'timings.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

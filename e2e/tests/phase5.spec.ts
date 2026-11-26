import { goStep, openMore, openZone, toZones } from './zone';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EMPTY_UUID, demoRoom, type DemoRoomName } from '../../packages/core/src/index';

// Phase 5 gate (PLAN §5): IES upload → library product → chosen for an intent → the solver re-fits; full calculation
// in the worker → ledger rows (avg/min/max/target/status), stale after an edit, largest demo room < 2 s; JSON / CSV /
// glTF exports download and the GLB re-loads in three.js (Node) with KHR_lights_punctual lights; lit preview toggles
// without console errors. Each test works in its own project holding a copy of a demo room.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const IES_DIR = fileURLToPath(new URL('../../packages/core/test/fixtures/ies/', import.meta.url));
const OUT = fileURLToPath(new URL('../test-results/phase5/', import.meta.url));
const SCREENSHOT = fileURLToPath(new URL('../../docs/screenshots/phase5-calc.png', import.meta.url));
const GLTF_LOADER = pathToFileURL(fileURLToPath(new URL('../../apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js', import.meta.url))).href;

interface Intent {
  id: string;
  label: string;
  isSuggestion: boolean;
  product: { product: { label: string; lumens: number; ies?: unknown }; agentPicked: boolean } | null;
  fixtures: unknown[];
}
interface Design {
  revision: number;
  intents: Intent[];
}

async function project(request: APIRequestContext, name: string, room: DemoRoomName = 'Office'): Promise<string> {
  const p = await (await request.post('/api/projects', { data: { name } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, { data: { room: { ...demoRoom(room), id: EMPTY_UUID }, sourceAssetId: null } });
  expect(r.ok()).toBe(true);
  return (await r.json()).id;
}
const design = async (request: APIRequestContext, roomId: string): Promise<Design> => (await request.get(`/api/rooms/${roomId}/design`)).json();
const intentNamed = async (request: APIRequestContext, roomId: string, label: string) => (await design(request, roomId)).intents.find((i) => i.label === label);
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

async function openAccepted(page: Page, projectName: string, roomLabel: RegExp): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await page.getByRole('button', { name: roomLabel }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await toZones(page);
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByTestId('suggestion')).toHaveCount(0);
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await saved(page);
}

/** Console errors and uncaught page errors while the test runs. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('IES upload in the library → chosen for an intent in the inspector → the solver re-fits', async ({ page, request }) => {
  const roomId = await project(request, 'Phase5 IES');
  await page.goto('/');
  await page.getByRole('button', { name: /Phase5 IES/ }).click();

  // the project screen hosts the library; upload a real LM-63 file
  const library = page.getByTestId('library');
  await expect(library).toContainText('No project products yet');
  await library.getByTestId('ies-input').setInputFiles(IES_DIR + 'downlight-1995.ies');
  await expect(library.getByTestId('library-row')).toHaveCount(1);
  await expect(library.getByTestId('library-row')).toContainText('6 inch downlight');
  await expect(library.getByTestId('library-row')).toContainText('IES');
  // a file that is not LM-63 type C is refused with the parser's reason
  await library.getByTestId('ies-input').setInputFiles(IES_DIR + 'typeb-2002.ies');
  await expect(library.getByRole('alert')).toContainText('type B');
  await expect(library.getByTestId('library-row')).toHaveCount(1);

  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await toZones(page);
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await saved(page);

  // also reachable from the room: the Luminaires step opens the library
  await goStep(page, 'luminaires');
  await page.getByTestId('manage-products').click();
  const dialog = page.getByRole('dialog', { name: 'Project products' });
  await expect(dialog.getByTestId('library-row')).toHaveCount(1);
  await dialog.getByTestId('library-close').click();
  await expect(dialog).toHaveCount(0);

  await goStep(page, 'zones');
  const label = 'Desk cluster A task';
  await openZone(page, label);
  const product = page.getByTestId('product');
  // non-demo project: the project group holds exactly the uploaded product
  const projectOptions = product.locator('optgroup[label="Project products"] option');
  await expect(projectOptions).toHaveCount(1);
  await expect(projectOptions).toContainText('6 inch downlight');

  await expect.poll(async () => (await design(request, roomId)).intents.map((i) => i.label)).toContain(label);
  const before = (await intentNamed(request, roomId, label))!;
  const count0 = before.fixtures.length;
  const estimate = page.getByTestId('intent').getByTestId('estimate');
  await expect(estimate).toContainText('fc');
  const estimate0 = (await estimate.textContent())!;

  await product.selectOption(await projectOptions.getAttribute('value'));
  await expect(product.locator('option:checked')).toContainText('6 inch downlight');
  // the ranker scores the uploaded downlight best for this task, so its reason line is the ranker's
  await openMore(page, 'Details');
  await page.getByTestId('intent').locator('.product-reason summary').click();
  await expect(page.getByTestId('product-reason')).toContainText('In your project');
  await page.getByRole('button', { name: 'Back to zone' }).click();
  await saved(page);
  await expect.poll(async () => (await intentNamed(request, roomId, label))?.product?.agentPicked).toBe(false);
  const after = (await intentNamed(request, roomId, label))!;
  expect(after.product!.product.label).toContain('6 inch downlight');
  expect(after.product!.product.ies).toBeTruthy(); // the photometry travels with the choice (IES estimate path)
  await expect(estimate).not.toHaveText(estimate0);
  const estimate1 = (await estimate.textContent())!;
  console.log(`IES re-fit: ${label} ${count0} → ${after.fixtures.length} fixtures; estimate "${estimate0}" → "${estimate1}"`);
  expect(after.fixtures.length).not.toBe(count0);
  await expect(page.getByTestId('intent').getByLabel('Fixtures')).toHaveText(String(after.fixtures.length));
});

test('Calculate → ledger rows; an edit marks it stale; largest demo room under 2 s; screenshot', async ({ page, request }) => {
  // the largest demo room by area, points and fixtures (core calc: 1536 ft², 1812 points, 51 fixtures)
  await project(request, 'Phase5 calc', 'Cafeteria');
  const errors = watchErrors(page);
  await openAccepted(page, 'Phase5 calc', /110 Cafeteria/);

  await goStep(page, 'check');
  const ledger = page.getByTestId('ledger');
  // before a calculation: the room lumen method, every zone at its own height, labelled an estimate
  await expect(ledger.getByTestId('result-label')).toContainText('Room lumen method · estimate');
  await expect(ledger.getByTestId('verdict')).toContainText(/\d+ of \d+ zones on target|No zone has a target yet/);
  await expect(ledger.getByTestId('ledger-row').first()).toBeVisible();
  // the Check step shows the room's heat on the plan
  await expect(page.getByTestId('heat-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('heat-legend')).toHaveAttribute('data-source', 'quick');

  const t0 = Date.now();
  await ledger.getByTestId('calc-run').click();
  const rows = ledger.getByTestId('ledger-row');
  await expect(ledger.getByTestId('result-label')).toContainText('Full calculation · estimate', { timeout: 30_000 });
  const wall = Date.now() - t0;
  const ms = Number(await ledger.getByTestId('calc-ms').getAttribute('data-ms'));
  console.log(`Cafeteria full calculation in the worker: ${ms} ms (store), ${wall} ms click → rows (Playwright)`);
  expect(ms).toBeLessThan(2000);
  expect(await rows.count()).toBeGreaterThan(5);

  // zone rows: avg / min / target / status, one per accepted zone
  for (const row of await rows.all()) {
    const cells = await row.locator('td').allTextContents();
    expect(cells).toHaveLength(4); // avg, min, target, status
    expect(cells[0]).toMatch(/^\d[\d,.]*/);
    expect(cells[1]).toMatch(/^(\d[\d,.]*|—)$/);
    expect(cells[2]).not.toBe('');
  }
  await expect(ledger.locator('td.status').filter({ hasText: /On target|Too dark|Too bright/ }).first()).toBeVisible();
  await expect(ledger.getByTestId('calc-stale')).toHaveCount(0);
  // the plan heatmap now paints the full-calculation grids, one scale for the whole room
  await expect(page.getByTestId('heat-legend')).toHaveAttribute('data-source', 'calculation');
  await expect(page.getByTestId('heat-legend')).toContainText('Full calculation');
  await expect(page.getByTestId('heat-legend')).toContainText('estimate');

  mkdirSync(fileURLToPath(new URL('.', pathToFileURL(SCREENSHOT))), { recursive: true });
  await saved(page);
  await page.screenshot({ path: SCREENSHOT, fullPage: true });

  // an edit: the check is marked stale and the plan falls back to the quick estimate
  await goStep(page, 'zones');
  await page.getByTestId('zone-row').first().locator('button.zone-row').click();
  await openMore(page, 'Layout');
  await page.getByTestId('intent-editor').locator('input[type="range"]').fill('1.4');
  await goStep(page, 'check');
  await expect(ledger.getByTestId('calc-stale')).toBeVisible();
  await expect(ledger.locator('table.is-stale')).toHaveCount(1);
  await expect(page.getByTestId('heat-legend')).toHaveAttribute('data-source', 'quick');
  await expect(ledger.getByTestId('calc-run')).toHaveText('Recalculate');

  // recalculate clears it; cancel is offered while running
  await ledger.getByTestId('calc-run').click();
  await expect(ledger.getByTestId('calc-stale')).toHaveCount(0);
  await expect(page.getByTestId('heat-legend')).toHaveAttribute('data-source', 'calculation');
  expect(errors).toEqual([]);
});

/** The JSON chunk of a GLB. */
function glbJson(buf: Buffer): { extensionsUsed?: string[]; extensions?: { KHR_lights_punctual?: { lights: unknown[] } } } {
  expect(buf.subarray(0, 4).toString('latin1')).toBe('glTF');
  const len = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

interface LoadedObject {
  name: string;
  isLight?: boolean;
  type: string;
  traverse(cb: (o: LoadedObject) => void): void;
}
type Loader = { parse(data: ArrayBuffer, path: string, onLoad: (g: { scene: LoadedObject }) => void, onError: (e: unknown) => void): void };

test('exports: JSON, CSV and glTF download; the GLB re-loads with GLTFLoader and has KHR_lights_punctual lights', async ({ page, request }) => {
  await project(request, 'Phase5 export');
  await openAccepted(page, 'Phase5 export', /204 Open office/);
  mkdirSync(OUT, { recursive: true });

  const download = async (item: RegExp) => {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).click()]);
    const path = OUT + d.suggestedFilename();
    await d.saveAs(path);
    expect(await d.failure()).toBeNull();
    return { name: d.suggestedFilename(), bytes: readFileSync(path) };
  };

  const json = await download(/Design JSON/);
  expect(json.name).toMatch(/\.design\.json$/);
  const doc = JSON.parse(json.bytes.toString('utf8'));
  expect(doc.schemaVersion).toBeGreaterThan(0);
  expect(doc.design.intents.length).toBeGreaterThan(0);
  expect(doc.design.calculation).toBeNull();

  const csv = await download(/Fixture schedule CSV/);
  expect(csv.name).toMatch(/\.schedule\.csv$/);
  const lines = csv.bytes.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  expect(lines.length).toBeGreaterThan(1);

  const glb = await download(/glTF \(GLB\)/);
  expect(glb.name).toMatch(/\.glb$/);
  const gltf = glbJson(glb.bytes);
  expect(gltf.extensionsUsed).toContain('KHR_lights_punctual');
  const declared = gltf.extensions?.KHR_lights_punctual?.lights.length ?? 0;
  expect(declared).toBeGreaterThan(0);

  // three.js GLTFLoader in Node (what the three.js editor uses to open it)
  const { GLTFLoader } = (await import(GLTF_LOADER)) as { GLTFLoader: new () => Loader };
  const ab = glb.bytes.buffer.slice(glb.bytes.byteOffset, glb.bytes.byteOffset + glb.bytes.byteLength) as ArrayBuffer;
  const { scene } = await new Promise<{ scene: LoadedObject }>((resolve, reject) => new GLTFLoader().parse(ab, '', resolve, reject));
  const lights: LoadedObject[] = [];
  scene.traverse((o) => {
    if (o.isLight) lights.push(o);
  });
  console.log(`GLB ${glb.bytes.length} bytes: ${declared} KHR_lights_punctual lights, ${lights.length} three.js lights after reload`);
  expect(lights.length).toBe(declared);
  expect(lights.every((l) => l.type === 'SpotLight' || l.type === 'PointLight')).toBe(true);
});

test('lit preview toggles without console errors', async ({ page, request }) => {
  await project(request, 'Phase5 lit');
  const errors = watchErrors(page);
  await openAccepted(page, 'Phase5 lit', /204 Open office/);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Toggle lit preview (preview, not a calculation)' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.room3d-note')).toContainText('Preview, not a calculation.');
  await page.getByRole('slider', { name: 'Exposure (EV)' }).fill('1');
  await page.waitForTimeout(300); // a few frames
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  expect(errors).toEqual([]);
});

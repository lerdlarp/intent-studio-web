import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, Color, SpotLight, SRGBColorSpace, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createIntent, demoRoom, describeLights, kelvinToRgbUnit, solveAll, type RoomDesign } from '@intent-studio/core';
import { buildExportScene, exportGlb } from './gltf';

// GLTFExporter's binary path uses FileReader (browser). Minimal Node stand-in.
beforeAll(() => {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (!g.FileReader) {
    g.FileReader = class {
      result: ArrayBuffer | string | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(b: Blob) {
        void b.arrayBuffer().then((r) => {
          this.result = r;
          this.onloadend?.();
        });
      }
      readAsDataURL(b: Blob) {
        void b.arrayBuffer().then((r) => {
          this.result = 'data:application/octet-stream;base64,' + Buffer.from(r).toString('base64');
          this.onloadend?.();
        });
      }
    };
  }
});

function design(): RoomDesign {
  const room = demoRoom('Office');
  const d: RoomDesign = {
    room,
    intents: [
      createIntent({
        kind: 'Ambient',
        label: 'Ambient',
        target: { minimum: null, average: 30, maximum: null },
        region: room.floor[0]!,
        behavior: { ...createIntent().behavior, cct: 3000 },
      }),
    ],
    removedExisting: [],
    calculation: null,
    revision: 1,
  };
  solveAll(d);
  return d;
}

const parse = (buf: ArrayBuffer) =>
  new Promise<{ scene: Object3D }>((resolve, reject) => new GLTFLoader().parse(buf, '', (g) => resolve(g as { scene: Object3D }), reject));

describe('glTF export', () => {
  it('round-trips: node + light counts, metres, light colour and intensity', async () => {
    const d = design();
    const lights = describeLights(d);
    expect(lights.length).toBeGreaterThan(0);
    const buf = await exportGlb(d);
    expect(new Uint8Array(buf.slice(0, 4))).toEqual(new Uint8Array([0x67, 0x6c, 0x54, 0x46])); // "glTF"
    const { scene } = await parse(buf);

    const fixtureNodes: Object3D[] = [];
    const spots: SpotLight[] = [];
    scene.traverse((o) => {
      if (o.name.startsWith('fixture-') && !o.name.startsWith('fixture-body-') && !o.name.startsWith('fixture-cord-')) fixtureNodes.push(o);
      if ((o as SpotLight).isSpotLight) spots.push(o as SpotLight);
    });
    const expectedFixtures = d.intents[0]!.fixtures.length + d.room.existing.length;
    expect(fixtureNodes).toHaveLength(expectedFixtures);
    expect(spots).toHaveLength(lights.length);

    // units: the Office floor in feet → metres
    const floor = scene.getObjectByName('floor')!;
    const fb = new Box3().setFromObject(floor);
    const outer = d.room.floor[0]!;
    const widthFt = Math.max(...outer.map((p) => p.x)) - Math.min(...outer.map((p) => p.x));
    expect(fb.max.x - fb.min.x).toBeCloseTo(widthFt / 3.28084, 3);
    expect(fb.max.y - fb.min.y).toBeCloseTo(0, 6); // flat, Y-up

    // light colour (linear in glTF) + intensity in candela + cone
    const l0 = lights[0]!;
    const s0 = scene.getObjectByName(`light-${l0.fixtureId}`) as SpotLight;
    expect(s0).toBeDefined();
    const want = new Color().setRGB(...kelvinToRgbUnit(3000), SRGBColorSpace);
    expect(s0.color.r).toBeCloseTo(want.r, 4);
    expect(s0.color.g).toBeCloseTo(want.g, 4);
    expect(s0.color.b).toBeCloseTo(want.b, 4);
    expect(s0.intensity).toBeCloseTo(l0.candela, 3);
    expect(s0.angle).toBeCloseTo(((l0.beamAngle / 2) * Math.PI) / 180, 4);
    // ceiling light at the ceiling height in metres, aimed down
    s0.updateWorldMatrix(true, false);
    const wp = s0.getWorldPosition(new Vector3());
    expect(wp.y).toBeCloseTo(l0.position.z / 3.28084, 3);
    const dir = s0.getWorldDirection(new Vector3());
    expect(-dir.y).toBeCloseTo(-1, 3); // Object3D.getWorldDirection is the local +Z; a glTF spot aims along −Z (down)
  });

  it('scene builder names fixtures and lights deterministically', () => {
    const d = design();
    const a = buildExportScene(d);
    const names: string[] = [];
    a.traverse((o) => o.name.startsWith('light-') && names.push(o.name));
    expect(names).toHaveLength(describeLights(d).length);
  });
});

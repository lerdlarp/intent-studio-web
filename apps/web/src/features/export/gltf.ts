// glTF/GLB export: room meshes, fixtures as named nodes, KHR_lights_punctual spots (candela, colour from CCT).
// glTF is metres, Y-up: the model's feet are converted here at the export boundary. Node names avoid `:` and `.`
// (loaders strip them): `fixture-<id>`, `light-<id>`, `wall-<n>`, `object-<name>`.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeGeometry,
  SpotLight,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { describeLights, feetToMeters, type P2, type RoomDesign } from '@intent-studio/core';
import { describeDesign, planToThree, type FixtureDesc, type V3 } from '../room3d/describe';

const m = feetToMeters;
const mv = (v: V3): [number, number, number] => [m(v[0]), m(v[1]), m(v[2])];

function flat(outer: readonly P2[], holes: readonly (readonly P2[])[], yFeet: number, faceDown = false): BufferGeometry {
  const shape = new Shape(outer.map((p) => new Vector2(m(p.x), m(p.y))));
  for (const h of holes) shape.holes.push(new Shape(h.map((p) => new Vector2(m(p.x), m(p.y)))));
  const g = new ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, m(yFeet), 0);
  if (faceDown) {
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i + 2 < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, b);
      }
    }
    g.computeVertexNormals();
  }
  return g;
}

const mat = (hex: number, roughness = 0.9): MeshStandardMaterial => new MeshStandardMaterial({ color: hex, roughness, metalness: 0 });

function fixtureNode(f: FixtureDesc): Group {
  const g = new Group();
  g.name = `fixture-${f.id}`;
  const body =
    f.shape === 'round' || f.shape === 'pendant'
      ? new Mesh(new CylinderGeometry(m(f.size[0] / 2), m(f.size[0] / 2), m(f.size[1]), 24))
      : new Mesh(new BoxGeometry(m(f.size[0]), m(f.size[1]), m(f.size[2])));
  body.material = mat(Number.parseInt(f.color.slice(1), 16), 0.6);
  body.name = `fixture-body-${f.id}`;
  body.position.set(...mv(f.center));
  body.rotation.y = f.rotY;
  g.add(body);
  if (f.cord) {
    const len = Math.max(m(f.cord.top[1] - f.cord.bottom[1]), 0.003);
    const cord = new Mesh(new CylinderGeometry(0.005, 0.005, len, 6), mat(0x555a63));
    cord.name = `fixture-cord-${f.id}`;
    cord.position.set(m(f.cord.top[0]), m(f.cord.bottom[1]) + len / 2, m(f.cord.top[2]));
    g.add(cord);
  }
  return g;
}

/** Build the export scene in metres, Y-up. Pure three objects; no renderer needed. */
export function buildExportScene(design: RoomDesign): Scene {
  const d = describeDesign(design);
  const scene = new Scene();
  scene.name = design.room.label || 'room';
  scene.userData = { units: 'metres', source: 'Intent Studio', note: 'Preview geometry and lights; not a calculation.' };

  const room = new Group();
  room.name = 'room';
  scene.add(room);
  if (d.floor) {
    const floor = new Mesh(flat(d.floor.outer, d.floor.holes, 0), mat(0xdedbd4, 0.95));
    floor.name = 'floor';
    room.add(floor);
  }
  d.ceiling.forEach((c, i) => {
    const mesh = new Mesh(flat(c.outer, c.holes, c.y, true), mat(0xf4f3ef));
    mesh.name = i === 0 ? 'ceiling' : `ceiling-${i}`;
    room.add(mesh);
  });
  for (const w of d.walls) {
    const wall = new Group();
    wall.name = `wall-${w.index}`;
    const wm = mat(0xf1efe9);
    w.pieces.forEach((p, k) => {
      const mesh = new Mesh(new BoxGeometry(m(p.size[0]), m(p.size[1]), m(p.size[2])), wm);
      mesh.name = `wall-${w.index}-${k}`;
      mesh.position.set(...mv(p.center));
      mesh.rotation.y = p.rotY;
      wall.add(mesh);
    });
    room.add(wall);
  }
  for (const o of d.objects) {
    const mesh = new Mesh(new BoxGeometry(m(o.size[0]), m(o.size[1]), m(o.size[2])), mat(0xb8a58c, 0.85));
    mesh.name = `object-${o.name}`;
    mesh.position.set(...mv(o.center));
    mesh.rotation.y = o.rotY;
    room.add(mesh);
  }

  const fixtures = new Group();
  fixtures.name = 'fixtures';
  scene.add(fixtures);
  const nodes = new Map<string, Group>();
  for (const f of d.fixtures) {
    const node = fixtureNode(f);
    nodes.set(f.id, node);
    fixtures.add(node);
  }
  const up = new Vector3(0, 0, -1);
  for (const l of describeLights(design)) {
    const node = nodes.get(l.fixtureId);
    if (!node) continue;
    const light = new SpotLight(new Color().setRGB(l.rgb[0], l.rgb[1], l.rgb[2], SRGBColorSpace), l.candela, 0, Math.min(((l.beamAngle / 2) * Math.PI) / 180, Math.PI / 2), 0.2, 2);
    light.name = `light-${l.fixtureId}`;
    const pos = planToThree(l.position.x, l.position.y, l.position.z);
    light.position.set(...mv(pos));
    const dir = planToThree(l.direction.x, l.direction.y, l.direction.z);
    light.quaternion.copy(new Quaternion().setFromUnitVectors(up, new Vector3(...dir).normalize()));
    light.add(light.target);
    light.target.position.set(0, 0, -1); // KHR_lights_punctual spots aim along the node's −Z
    light.userData = { cct: l.cct, intent: l.intentLabel };
    node.add(light);
  }
  return scene;
}

/** Export the design as a binary glTF (GLB) with KHR_lights_punctual spot lights. */
export async function exportGlb(design: RoomDesign): Promise<ArrayBuffer> {
  const scene = buildExportScene(design);
  const result = await new GLTFExporter().parseAsync(scene as Object3D, { binary: true, onlyVisible: false });
  return result as ArrayBuffer;
}

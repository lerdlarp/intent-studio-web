// The three.js side of the dollhouse: builds meshes from the pure descriptors, owns the renderer/controls, renders on
// demand (no idle rAF loop) and disposes everything it creates.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeGeometry,
  SpotLight,
  PCFSoftShadowMap,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  Color,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { P2, RoomDesign } from '@intent-studio/core';
import {
  describeDesign,
  planToThree,
  type FlatDesc,
  type PatchDesc,
  type RoomDesc,
  type V3,
  type WallDesc,
} from './describe';
import type { CameraPose } from './camera';
import type { IntentHeat } from './heat';
import { exposureOfEv, FILL_INTENSITY, MAX_SHADOW_LIGHTS, type LitPreview } from './litPreview';

const FADED = 0.1;

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    const mat = m.material as Material | Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const map = (x as MeshBasicMaterial).map as Texture | null | undefined;
      map?.dispose();
      x.dispose();
    }
  });
}
function clearGroup(g: Group): void {
  for (const c of [...g.children]) {
    g.remove(c);
    disposeTree(c);
  }
}

/** Plan-space shape (x, y) → geometry lying flat in three space at height `y`. */
export function flatGeometry(
  f: { outer: readonly P2[]; holes: readonly (readonly P2[])[] },
  y: number,
): BufferGeometry {
  const shape = new Shape(f.outer.map((p) => new Vector2(p.x, p.y)));
  for (const h of f.holes) shape.holes.push(new Shape(h.map((p) => new Vector2(p.x, p.y))));
  const g = new ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); // (x, y, z) → (x, z, −y)
  g.translate(0, y, 0);
  return g;
}

interface WallEntry {
  desc: WallDesc;
  group: Group;
  materials: MeshStandardMaterial[];
  faded: boolean;
}

export class DollhouseView {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(45, 1, 0.2, 2000);
  private controls: OrbitControls;
  private content = new Group();
  private heat = new Group();
  private context = new Group();
  private lit = new Group();
  private stdLights: Object3D[] = [];
  private litOn = false;
  private litEv = 0;
  private shadowsOn = false;
  private walls: WallEntry[] = [];
  private raf = 0;
  private disposed = false;
  private observer: ResizeObserver | null = null;
  private tmp = new Vector3();
  showCeiling = true;
  showHeat = true;

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    host.appendChild(this.canvas);

    const ambient = new AmbientLight(0xffffff, 0.55);
    const hemi = new HemisphereLight(0xffffff, 0x8a8f98, 0.7);
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(30, 60, 40);
    this.stdLights = [ambient, hemi, sun];
    this.scene.add(ambient, hemi, sun, this.context, this.content, this.heat, this.lit);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI - 0.02;
    this.controls.addEventListener('change', () => {
      this.updateCutaway();
      this.invalidate();
    });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  // ---- render on demand ------------------------------------------------------------------------------------------

  invalidate(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const w = Math.max(this.host.clientWidth, 1);
    const h = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  // ---- content ---------------------------------------------------------------------------------------------------

  setDesign(design: RoomDesign): RoomDesc {
    clearGroup(this.content);
    this.walls = [];
    const d = describeDesign(design);

    if (d.floor) this.content.add(this.floorMesh(d.floor));
    for (const c of d.ceiling) {
      const mesh = new Mesh(
        flatGeometry(c, c.y),
        new MeshBasicMaterial({
          color: c.isMain ? 0xcfd8e3 : 0xb9c4d4,
          toneMapped: false,
          transparent: true,
          opacity: c.isMain ? 0.07 : 0.16,
          side: DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.name = 'ceiling';
      mesh.renderOrder = 2;
      mesh.visible = this.showCeiling;
      this.content.add(mesh);
    }
    for (const w of d.walls) this.content.add(this.wallGroup(w));
    for (const o of d.objects) {
      const geo = new BoxGeometry(o.size[0], o.size[1], o.size[2]);
      const mesh = new Mesh(geo, new MeshStandardMaterial({ color: 0xb8a58c, roughness: 0.85 }));
      mesh.position.set(...o.center);
      mesh.rotation.y = o.rotY;
      mesh.name = `object:${o.name}`;
      const edges = new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: 0x6b5d49 }));
      mesh.add(edges);
      this.content.add(mesh);
    }
    for (const f of d.fixtures) this.content.add(this.fixtureMesh(f));
    for (const p of d.patches) {
      const m = this.patchMesh(p);
      if (m) this.content.add(m);
    }
    this.applyLitState();
    this.updateCutaway(true);
    this.invalidate();
    return d;
  }

  private floorMesh(f: FlatDesc): Mesh {
    const mesh = new Mesh(
      flatGeometry(f, 0),
      new MeshStandardMaterial({ color: 0xdedbd4, roughness: 0.95, side: DoubleSide }),
    );
    mesh.name = 'floor';
    return mesh;
  }

  private wallGroup(w: WallDesc): Group {
    const group = new Group();
    group.name = `wall:${w.index}`;
    const materials: MeshStandardMaterial[] = [];
    const mat = new MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.9, transparent: true, opacity: 1 });
    materials.push(mat);
    for (const p of w.pieces) {
      const mesh = new Mesh(new BoxGeometry(p.size[0], p.size[1], p.size[2]), mat);
      mesh.position.set(...p.center);
      mesh.rotation.y = p.rotY;
      group.add(mesh);
    }
    this.walls.push({ desc: w, group, materials, faded: false });
    return group;
  }

  private fixtureMesh(f: RoomDesc['fixtures'][number]): Object3D {
    const g = new Group();
    g.name = `fixture:${f.id}`;
    const color = new Color(f.color);
    const mat = f.existing
      ? new MeshStandardMaterial({ color, roughness: 0.7, transparent: true, opacity: 0.7 })
      : new MeshBasicMaterial({ color, toneMapped: false });
    let body: Mesh;
    if (f.shape === 'round' || f.shape === 'pendant') {
      const r = f.size[0] / 2;
      body = new Mesh(new CylinderGeometry(r, r, f.size[1], 24), mat);
    } else {
      body = new Mesh(new BoxGeometry(f.size[0], f.size[1], f.size[2]), mat);
    }
    body.position.set(...f.center);
    body.rotation.y = f.rotY;
    g.add(body);
    if (f.cord) {
      const len = Math.max(f.cord.top[1] - f.cord.bottom[1], 0.01);
      const cord = new Mesh(
        new CylinderGeometry(0.03, 0.03, len, 6),
        new MeshBasicMaterial({ color: 0x555a63, toneMapped: false }),
      );
      cord.position.set(f.cord.top[0], f.cord.bottom[1] + len / 2, f.cord.top[2]);
      g.add(cord);
    }
    return g;
  }

  private patchMesh(p: PatchDesc): Mesh | null {
    const color = new Color(p.color);
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: p.suggestion ? 0.12 : 0.3,
      side: DoubleSide,
      depthWrite: false,
    });
    let geo: BufferGeometry;
    if (p.kind === 'vertical' && p.quad) {
      geo = new BufferGeometry();
      const q = p.quad;
      geo.setAttribute('position', new Float32BufferAttribute([...q[0]!, ...q[1]!, ...q[2]!, ...q[3]!], 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
    } else if (p.polygon.length >= 3) {
      geo = flatGeometry({ outer: p.polygon, holes: [] }, p.y);
    } else return null;
    const mesh = new Mesh(geo, mat);
    mesh.name = `patch:${p.intentId}`;
    mesh.renderOrder = 3;
    return mesh;
  }

  // ---- heat textures ---------------------------------------------------------------------------------------------

  setHeat(heat: ReadonlyMap<string, IntentHeat> | null): void {
    clearGroup(this.heat);
    if (heat) {
      let n = 0;
      for (const h of heat.values()) {
        const mesh = this.heatMesh(h, 0.05 + 0.025 * n++);
        if (mesh) this.heat.add(mesh);
      }
    }
    this.heat.visible = this.showHeat && !this.litOn;
    this.invalidate();
  }

  private heatMesh(h: IntentHeat, lift: number): Mesh | null {
    const r = h.raster;
    if (r.width < 1 || r.height < 1 || r.pixels.length < r.width * r.height * 4) return null;
    const tex = new DataTexture(
      new Uint8Array(r.pixels.buffer, r.pixels.byteOffset, r.pixels.byteLength),
      r.width,
      r.height,
      RGBAFormat,
    );
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const o = planToThree(r.origin.x, r.origin.y, r.origin.z);
    const u = planToThree(r.uEnd.x, r.uEnd.y, r.uEnd.z);
    const v = planToThree(r.vEnd.x, r.vEnd.y, r.vEnd.z);
    const far: V3 = [u[0] + v[0] - o[0], u[1] + v[1] - o[1], u[2] + v[2] - o[2]];
    // lift off the surface toward the room (up for floors, down for ceilings, along the wall normal for walls)
    const e = new Vector3(u[0] - o[0], u[1] - o[1], u[2] - o[2])
      .cross(new Vector3(v[0] - o[0], v[1] - o[1], v[2] - o[2]))
      .normalize();
    const pts = [o, u, v, far].map((p) => [p[0] + e.x * lift, p[1] + e.y * lift, p[2] + e.z * lift]);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3));
    geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    const mesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.6,
        side: DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = `heat:${h.intentId}`;
    mesh.renderOrder = 4;
    return mesh;
  }

  setHeatVisible(v: boolean): void {
    this.showHeat = v;
    this.heat.visible = v && !this.litOn;
    this.invalidate();
  }

  setCeilingVisible(v: boolean): void {
    this.showCeiling = v;
    this.content.traverse((o) => {
      if (o.name === 'ceiling') o.visible = v;
    });
    this.invalidate();
  }

  // ---- lit preview (purely visual; not a calculation) ------------------------------------------------------------

  /** Show one spot per descriptor (null = off), under ACES tone mapping and neutral standard materials. */
  setLit(preview: LitPreview | null): void {
    clearGroup(this.lit);
    this.litOn = preview !== null;
    if (preview) {
      preview.spots.forEach((d, k) => {
        const light = new SpotLight(
          new Color().setRGB(d.rgb[0], d.rgb[1], d.rgb[2], SRGBColorSpace),
          d.intensity,
          0,
          d.angle,
          d.penumbra,
          2,
        );
        light.position.set(...d.position);
        light.target.position.set(...d.target);
        light.name = `spot:${d.id}`;
        light.userData.shadowRank = k;
        this.lit.add(light, light.target);
      });
      this.lit.add(new AmbientLight(0xffffff, FILL_INTENSITY));
    }
    this.applyLitState();
    this.invalidate();
  }

  /** Exposure in EV around the base exposure (display control only). */
  setExposureEv(ev: number): void {
    this.litEv = ev;
    if (this.litOn) this.renderer.toneMappingExposure = exposureOfEv(ev);
    this.invalidate();
  }

  setShadows(on: boolean): void {
    this.shadowsOn = on;
    this.applyLitState();
    this.invalidate();
  }

  private applyLitState(): void {
    const lit = this.litOn;
    this.renderer.toneMapping = lit ? ACESFilmicToneMapping : NoToneMapping;
    this.renderer.toneMappingExposure = lit ? exposureOfEv(this.litEv) : 1;
    for (const l of this.stdLights) l.visible = !lit;
    this.heat.visible = this.showHeat && !lit;
    const shadows = lit && this.shadowsOn;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    let n = 0;
    this.lit.traverse((o) => {
      const s = o as SpotLight;
      if (!s.isSpotLight) return;
      const cast = shadows && n++ < MAX_SHADOW_LIGHTS;
      if (s.castShadow !== cast) {
        s.castShadow = cast;
        if (cast) {
          s.shadow.mapSize.set(512, 512);
          s.shadow.bias = -0.0005;
        } else s.shadow.map?.dispose();
      }
    });
    this.content.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (o.name.startsWith('patch:')) o.visible = !lit;
      const std = (m.material as Material | undefined) instanceof MeshStandardMaterial;
      if (std) {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
    });
    this.renderer.shadowMap.needsUpdate = true;
    this.content.traverse((o) => {
      const mats = (o as Mesh).material as Material | Material[] | undefined;
      for (const x of Array.isArray(mats) ? mats : mats ? [mats] : []) x.needsUpdate = true;
    });
  }

  // ---- imported mesh context -------------------------------------------------------------------------------------

  /** Show a loaded source scene (already scaled to feet and mapped to three space) semi-transparently. */
  setContext(root: Object3D | null): void {
    clearGroup(this.context);
    if (root) {
      root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.material = new MeshBasicMaterial({
          color: 0x7a8696,
          transparent: true,
          opacity: 0.22,
          side: DoubleSide,
          depthWrite: false,
        });
      });
      this.context.add(root);
    }
    this.invalidate();
  }

  // ---- camera ----------------------------------------------------------------------------------------------------

  setPose(pose: CameraPose): void {
    this.camera.position.set(...pose.position);
    this.controls.target.set(...pose.target);
    this.controls.update();
    this.updateCutaway();
    this.invalidate();
  }

  /** Fade walls the camera sees from outside (their inward normal points away from the camera). */
  updateCutaway(force = false): void {
    const cam = this.camera.position;
    let changed = false;
    for (const w of this.walls) {
      this.tmp.set(cam.x - w.desc.mid[0], 0, cam.z - w.desc.mid[2]);
      const away = this.tmp.x * w.desc.inward[0] + this.tmp.z * w.desc.inward[2] < -0.01;
      if (!force && away === w.faded) continue;
      w.faded = away;
      changed = true;
      for (const m of w.materials) {
        m.opacity = away ? FADED : 1;
        m.depthWrite = !away;
        m.needsUpdate = true;
      }
    }
    if (changed) this.invalidate();
  }

  /** Test/diagnostic: ids of currently faded walls. */
  fadedWalls(): number[] {
    return this.walls.filter((w) => w.faded).map((w) => w.desc.index);
  }

  boundsOfContext(): Box3 {
    return new Box3().setFromObject(this.context);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.controls.dispose();
    clearGroup(this.content);
    clearGroup(this.heat);
    clearGroup(this.context);
    clearGroup(this.lit);
    this.renderer.dispose();
    this.canvas.remove();
  }
}

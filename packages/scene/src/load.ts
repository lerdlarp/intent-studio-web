// Scene loaders (PLAN §3 "3D scene import"): GLB/glTF, OBJ, FBX from bytes → THREE.Object3D. Parsing only (no
// network, no rendering), so GLB/glTF/OBJ also run in Node. Decoders are injected so the app decides where the
// Draco / meshopt / KTX2 wasm lives.
import { LoadingManager, type Object3D, type AnimationClip } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { UpAxis } from './axes';

export type SceneFormat = 'glb' | 'gltf' | 'obj' | 'fbx';

/** The meshopt decoder object (`MeshoptDecoder` from meshoptimizer / three's libs). */
export type MeshoptDecoderLike = Parameters<GLTFLoader['setMeshoptDecoder']>[0];

export interface LoadOptions {
  /** Overrides detection from the filename / magic bytes. */
  format?: SceneFormat;
  /** Configured DRACOLoader (decoder path set) for KHR_draco_mesh_compression. */
  dracoLoader?: DRACOLoader;
  /** Meshopt decoder for EXT_meshopt_compression. */
  meshoptDecoder?: MeshoptDecoderLike;
  /** KTX2 loader (with `detectSupport(renderer)` called) for KHR_texture_basisu. */
  ktx2Loader?: KTX2Loader;
  /** Base path for external .gltf resources (buffers, images). */
  resourcePath?: string;
  manager?: LoadingManager;
  /** Source units → metres (defaults: glTF 1, OBJ 1, FBX from its UnitScaleFactor, else 0.01). */
  metresPerUnit?: number;
  /** Up axis of the source (default 'y' for every format). */
  upAxis?: UpAxis;
  /**
   * glTF textures: 'load' them, or 'skip' (strip images/textures before parsing; geometry, names and extras are
   * unaffected). Default: 'load' where a DOM or createImageBitmap exists, else 'skip' (Node).
   */
  textures?: 'load' | 'skip';
}

export interface LoadedScene {
  root: Object3D;
  format: SceneFormat;
  /** Multiply source units by this to get metres. */
  metresPerUnit: number;
  upAxis: UpAxis;
  animations: AnimationClip[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'

/** Format from the filename extension, falling back to magic bytes / content sniffing. */
export function detectFormat(filename: string, data?: ArrayBuffer): SceneFormat {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'fbx') return ext;
  if (data && data.byteLength >= 4) {
    const view = new DataView(data);
    if (view.getUint32(0, true) === GLB_MAGIC) return 'glb';
    const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(64, data.byteLength)));
    if (head.startsWith('Kaydara FBX Binary') || head.includes('FBXHeaderExtension')) return 'fbx';
    if (/^\s*\{/.test(head)) return 'gltf';
    if (/^\s*(#|v |o |g |mtllib)/m.test(head)) return 'obj';
  }
  throw new Error(`Unsupported scene file "${filename}" (expected .glb, .gltf, .obj or .fbx)`);
}

const DATA_URI = /^data:[^,]*?(;base64)?,(.*)$/s;

function decodeDataUri(uri: string): Uint8Array | null {
  const m = DATA_URI.exec(uri);
  if (!m) return null;
  const body = m[2] ?? '';
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(body));
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

const pad4 = (n: number): number => (n + 3) & ~3;
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'

interface GltfJson {
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number }[];
  images?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
  materials?: Record<string, unknown>[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

/** Split a GLB into its JSON and BIN chunks (null when not a valid GLB 2.0 container). */
function readGlb(data: ArrayBuffer): { json: GltfJson; bin: Uint8Array | null } | null {
  if (data.byteLength < 20) return null;
  const view = new DataView(data);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) return null;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= data.byteLength;) {
    const len = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    if (at + 8 + len > data.byteLength) return null;
    const body = new Uint8Array(data, at + 8, len);
    if (type === JSON_CHUNK && !json) {
      try {
        json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
      } catch {
        return null;
      }
    } else if (type === BIN_CHUNK && !bin) bin = body;
    at += 8 + pad4(len);
  }
  return json ? { json, bin } : null;
}

function writeGlb(json: GltfJson, bin: Uint8Array | null): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = bin ? pad4(bin.length) : 0;
  const out = new ArrayBuffer(12 + 8 + jsonLen + (bin ? 8 + binLen : 0));
  const view = new DataView(out);
  const u8 = new Uint8Array(out);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, JSON_CHUNK, true);
  u8.set(jsonBytes, 20);
  u8.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  if (bin) {
    view.setUint32(20 + jsonLen, binLen, true);
    view.setUint32(24 + jsonLen, BIN_CHUNK, true);
    u8.set(bin, 28 + jsonLen);
  }
  return out;
}

/** Embedded `data:` buffers → one BIN chunk (buffer views re-based). False when a buffer is external. */
function embedBuffers(json: GltfJson): Uint8Array | false {
  const buffers = json.buffers ?? [];
  const parts: Uint8Array[] = [];
  for (const b of buffers) {
    const bytes = typeof b.uri === 'string' ? decodeDataUri(b.uri) : null;
    if (!bytes) return false;
    parts.push(bytes);
  }
  const base: number[] = [];
  let total = 0;
  for (const p of parts) {
    base.push(total);
    total = pad4(total + p.length);
  }
  const bin = new Uint8Array(total);
  parts.forEach((p, k) => bin.set(p, base[k] as number));
  if (buffers.length) json.buffers = [{ byteLength: total }];
  for (const v of json.bufferViews ?? []) {
    v.byteOffset = (v.byteOffset ?? 0) + (base[v.buffer] ?? 0);
    v.buffer = 0;
  }
  return bin;
}

const TEXTURE_EXTENSIONS = new Set([
  'KHR_texture_basisu',
  'EXT_texture_webp',
  'EXT_texture_avif',
  'KHR_texture_transform',
]);

/** Remove images, textures, samplers and every material texture reference (`*Texture: { index }`). */
function stripTextures(json: GltfJson): void {
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const scrub = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const v = rec[key];
      if (/Texture$/.test(key) && v && typeof v === 'object' && typeof (v as { index?: unknown }).index === 'number')
        delete rec[key];
      else scrub(v);
    }
  };
  for (const m of json.materials ?? []) scrub(m);
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((e) => !TEXTURE_EXTENSIONS.has(e));
  if (json.extensionsRequired)
    json.extensionsRequired = json.extensionsRequired.filter((e) => !TEXTURE_EXTENSIONS.has(e));
}

/**
 * Prepare glTF bytes for GLTFLoader so they parse without browser globals: a JSON .gltf whose buffers are all
 * embedded `data:` URIs becomes an equivalent GLB (GLTFLoader would fetch the data URIs through FileLoader), and
 * with `skipTextures` every image/texture is removed (GLTFLoader decodes images with DOM/ImageBitmap APIs).
 * Files with external buffers stay JSON (the loader resolves them against `resourcePath`). Unparseable input is
 * returned unchanged for the loader to reject.
 */
export function prepareGltf(data: ArrayBuffer, skipTextures: boolean): ArrayBuffer {
  const glb = readGlb(data);
  if (glb) {
    if (!skipTextures) return data;
    stripTextures(glb.json);
    return writeGlb(glb.json, glb.bin);
  }
  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
  } catch {
    return data;
  }
  if (skipTextures) stripTextures(json);
  const bin = embedBuffers(json);
  if (bin !== false) return writeGlb(json, bin.length ? bin : null);
  const text = new TextEncoder().encode(JSON.stringify(json));
  return text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength) as ArrayBuffer;
}

/** True where three's image loaders can run (browser / worker). */
const canDecodeImages = (): boolean =>
  typeof (globalThis as { document?: unknown }).document !== 'undefined' ||
  typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap !== 'undefined';

function parseGltf(data: ArrayBuffer, options: LoadOptions): Promise<GLTF> {
  const loader = new GLTFLoader(options.manager);
  if (options.dracoLoader) loader.setDRACOLoader(options.dracoLoader);
  if (options.meshoptDecoder) loader.setMeshoptDecoder(options.meshoptDecoder);
  if (options.ktx2Loader) loader.setKTX2Loader(options.ktx2Loader);
  return new Promise((resolve, reject) =>
    loader.parse(data, options.resourcePath ?? '', resolve, (e: unknown) =>
      reject(e instanceof Error ? e : new Error(String((e as { message?: unknown })?.message ?? e))),
    ),
  );
}

/** Parse a scene file. Throws on unsupported or malformed input. */
export async function loadScene(data: ArrayBuffer, filename: string, options: LoadOptions = {}): Promise<LoadedScene> {
  const format = options.format ?? detectFormat(filename, data);
  const upAxis = options.upAxis ?? 'y';
  switch (format) {
    case 'glb':
    case 'gltf': {
      const skip = (options.textures ?? (canDecodeImages() ? 'load' : 'skip')) === 'skip';
      const gltf = await parseGltf(prepareGltf(data, skip), options);
      return {
        root: gltf.scene,
        format,
        metresPerUnit: options.metresPerUnit ?? 1,
        upAxis,
        animations: gltf.animations,
      };
    }
    case 'obj': {
      const root = new OBJLoader(options.manager).parse(new TextDecoder().decode(data));
      return { root, format, metresPerUnit: options.metresPerUnit ?? 1, upAxis, animations: [] };
    }
    case 'fbx': {
      const root = new FBXLoader(options.manager).parse(data, options.resourcePath ?? '');
      // FBX UnitScaleFactor is centimetres per unit (1 = cm, 100 = m).
      const usf = (root.userData as { unitScaleFactor?: unknown }).unitScaleFactor;
      const fromFile = typeof usf === 'number' && usf > 0 ? usf / 100 : 0.01;
      return { root, format, metresPerUnit: options.metresPerUnit ?? fromFile, upAxis, animations: root.animations };
    }
  }
}

// Optional "imported mesh" context: fetch the room's source asset and load it with @intent-studio/scene, scaled to
// feet and mapped into the same three space as the dollhouse (plan x, z, −y). Returns null when unavailable.
import { Box3, Group, type Object3D } from 'three';
import { FEET_PER_METER } from '@intent-studio/core';

export async function loadContextMesh(assetId: string, signal?: AbortSignal): Promise<Object3D | null> {
  try {
    const meta = await fetch(`/api/assets/${encodeURIComponent(assetId)}/meta`, { signal });
    if (!meta.ok) return null;
    const name = ((await meta.json()) as { name?: string }).name ?? 'scene.glb';
    const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { signal });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const { loadScene } = await import('@intent-studio/scene');
    const loaded = await loadScene(data, name);
    const wrapper = new Group();
    if (loaded.upAxis === 'z') loaded.root.rotation.x = -Math.PI / 2; // z-up source → Y-up three
    wrapper.add(loaded.root);
    wrapper.scale.setScalar(loaded.metresPerUnit * FEET_PER_METER);
    wrapper.updateMatrixWorld(true);
    const box = new Box3().setFromObject(wrapper);
    if (Number.isFinite(box.min.y)) wrapper.position.y -= box.min.y; // sit the model on the floor plane
    return wrapper;
  } catch {
    return null;
  }
}

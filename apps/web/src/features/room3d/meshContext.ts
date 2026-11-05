// Optional "imported mesh" context: fetch the room's source asset and load it with @intent-studio/scene, scaled to
// feet and mapped into the same three space as the dollhouse (plan x, z, −y). Returns null when unavailable.
// Large scenes: only a display copy is shown (scene `buildDisplayMesh`: tiny meshes dropped, merged per material,
// ≤ 500k triangles); its stats are in `userData.display`. Room extraction never uses this copy.
import { Box3, Group, type Object3D } from 'three';
import { FEET_PER_METER } from '@intent-studio/core';
import { authFetch } from '../../api/auth';

export async function loadContextMesh(assetId: string, signal?: AbortSignal): Promise<Object3D | null> {
  try {
    const meta = await authFetch(`/api/assets/${encodeURIComponent(assetId)}/meta`, { signal });
    if (!meta.ok) return null;
    const name = ((await meta.json()) as { name?: string }).name ?? 'scene.glb';
    const res = await authFetch(`/api/assets/${encodeURIComponent(assetId)}`, { signal });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const { loadScene, buildDisplayMesh, disposeGeometries } = await import('@intent-studio/scene');
    const loaded = await loadScene(data, name, { textures: 'skip' });
    const display = buildDisplayMesh(loaded.root);
    disposeGeometries(loaded.root);
    const wrapper = new Group();
    if (loaded.upAxis === 'z') display.root.rotation.x = -Math.PI / 2; // z-up source → Y-up three
    wrapper.add(display.root);
    wrapper.userData.display = {
      sourceTriangles: display.sourceTriangles,
      triangles: display.triangles,
      droppedMeshes: display.droppedMeshes,
      decimated: display.decimated,
    };
    wrapper.scale.setScalar(loaded.metresPerUnit * FEET_PER_METER);
    wrapper.updateMatrixWorld(true);
    const box = new Box3().setFromObject(wrapper);
    if (Number.isFinite(box.min.y)) wrapper.position.y -= box.min.y; // sit the model on the floor plane
    return wrapper;
  } catch {
    return null;
  }
}

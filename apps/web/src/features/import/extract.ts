// Adapter between the import UI and packages/scene. The scene package (loaders + room extraction) is loaded lazily
// so three's loaders stay out of the initial bundle. Everything here returns plain StudioRoom data in feet.
//
// Pipeline: loadScene → extractRooms (tags, then geometry) → classify unresolved objects through /api/ai/classify
// (the server falls back to name rules offline; replies are applied by the scene package, which only fills kinds
// still "other") → designer confirms. When extraction finds nothing (strategy 'none') the UI offers the manual
// outline (`manualRoom`). Draco / meshopt / KTX2 decoders are not configured yet: files using those extensions fail
// with the loader's message.
import type { P2, StudioRoom } from '@intent-studio/core';

export const SCENE_EXTENSIONS = ['.glb', '.gltf', '.obj', '.fbx'] as const;

export type ExtractStrategy = 'tags' | 'geometry' | 'none';

export interface ExtractedScene {
  rooms: StudioRoom[];
  strategy: ExtractStrategy;
  warnings: string[];
  /** Objects the name rules could not classify. */
  unresolved: number;
  /** lastIssue from the classify call ("The agent is offline — using rules"), if any. */
  classifyIssue: string | null;
}

/** Classify transport: POST /api/ai/classify with the batch body; resolves to the raw `{result, …}` reply. */
export type Classifier = (body: { objects: unknown[] }) => Promise<{ result: unknown; lastIssue?: string }>;

type SceneModule = typeof import('@intent-studio/scene');

async function scene(): Promise<SceneModule> {
  try {
    return await import('@intent-studio/scene');
  } catch (e) {
    throw new Error(`The scene importer failed to load (${e instanceof Error ? e.message : String(e)}).`);
  }
}

/** Parse a scene file and extract its rooms for the designer to confirm. Throws with a readable message. */
export async function extractRooms(buffer: ArrayBuffer, filename: string, classify?: Classifier): Promise<ExtractedScene> {
  const s = await scene();
  const loaded = await s.loadScene(buffer, filename);
  const result = s.extractRooms(loaded, { sourceName: filename });
  let rooms = result.rooms.map((r) => r.room);
  let classifyIssue: string | null = null;
  if (classify && result.unresolved.length > 0) {
    for (const batch of s.classifyBatches(result.unresolved)) {
      try {
        const reply = await classify(batch.body);
        rooms = s.applyClassification(rooms, batch, reply);
        if (reply.lastIssue) classifyIssue = reply.lastIssue;
      } catch (e) {
        // classification is advisory: keep "other" and let the designer pick kinds
        classifyIssue = `Object kinds could not be suggested (${e instanceof Error ? e.message : String(e)}).`;
      }
    }
  }
  return { rooms, strategy: result.strategy, warnings: result.warnings, unresolved: result.unresolved.length, classifyIssue };
}

/** Manual strategy (c): the designer's floor polygon (feet) and ceiling height (feet). Throws when invalid. */
export async function manualRoom(polygon: P2[], ceilingHeight: number, label: string): Promise<StudioRoom> {
  const s = await scene();
  return { ...s.buildManualRoom(polygon, ceilingHeight), label };
}

export interface RoomEdits {
  label: string;
  /** Feet above the floor. */
  ceilingHeight: number;
  /** Replacement outer outline in feet (null = unchanged). */
  outline: P2[] | null;
  /** Object kinds parallel to room.objects. */
  kinds: string[];
}

/**
 * Apply the confirmation step's edits. Kinds and label are set directly; an outline or ceiling-height change rebuilds
 * walls and zones through the scene package (openings are kept by wall index when the outline keeps its vertex
 * count, otherwise dropped).
 */
export async function applyRoomEdits(room: StudioRoom, edits: RoomEdits): Promise<StudioRoom> {
  const objects = room.objects.map((o, k) => ({ ...o, kind: edits.kinds[k] ?? o.kind }));
  const outer = room.floor[0] ?? [];
  if (edits.outline === null && edits.ceilingHeight === room.ceilingHeight) return { ...room, label: edits.label, objects };
  const s = await scene();
  const outline = edits.outline ?? outer;
  const keepOpenings = outline.length === outer.length;
  return s.assembleRoom({
    id: room.id,
    label: edits.label,
    spaceType: room.spaceType,
    outline,
    holes: room.floor.slice(1),
    ceilingHeight: edits.ceilingHeight,
    pockets: room.ceilingZones.filter((z) => !z.isMain).map((z) => ({ height: z.height, loops: z.loops })),
    openings: (i) => (keepOpenings ? (room.walls[i]?.openings ?? []) : []),
    objects,
  });
}

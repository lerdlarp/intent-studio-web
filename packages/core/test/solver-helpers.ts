// Shared helpers for the solver tests: "Solved(room, tweak)" and "Make(room, kind, region, wall, obj)" from
// spec/solver.md "Test cases". Seeds come from golden (the reference IntentSuggestions.Seed output), accepted.
import { defaultLabel, defaultTarget } from '../src/defaults';
import { inferPlane } from '../src/workplane';
import {
  createIntent,
  type IntentKind,
  type LightingIntent,
  type P2,
  type RoomDesign,
  type StudioRoom,
} from '../src/model';
import { solveAll } from '../src/solver';
import { goldenIntent, goldenRoom, loadGolden, type GoldenRoomName } from './golden/load';

export const designOf = (room: StudioRoom, intents: LightingIntent[] = []): RoomDesign => ({
  room,
  intents,
  removedExisting: [],
  calculation: null,
  revision: 0,
});

/** Golden seeds of a room, all accepted (isSuggestion = false). */
export function seeded(name: GoldenRoomName, accepted = true): RoomDesign {
  return designOf(
    goldenRoom(name),
    loadGolden(name).seeds.map((s) => ({ ...goldenIntent(s), isSuggestion: !accepted })),
  );
}

/** Seed, accept, tweak, SolveAll. */
export function solved(name: GoldenRoomName, tweak?: (d: RoomDesign) => void): RoomDesign {
  const d = seeded(name);
  tweak?.(d);
  solveAll(d);
  return d;
}

/** An accepted intent with defaults.md label/target and workplane.md plane. */
export function make(
  room: StudioRoom,
  kind: IntentKind,
  region: P2[],
  wallIndex: number | null = null,
  objectIndex: number | null = null,
): LightingIntent {
  const t = defaultTarget(room, kind, objectIndex);
  return createIntent({
    kind,
    label: defaultLabel(room, kind, region, wallIndex, objectIndex),
    region,
    wallIndex,
    objectIndex,
    target: { ...t.target },
    targetReason: t.reason,
    plane: inferPlane(room, kind, region, wallIndex, objectIndex),
    isSuggestion: false,
  });
}

export const byKind = (d: RoomDesign, kind: IntentKind): LightingIntent[] => d.intents.filter((i) => i.kind === kind);
export const first = (d: RoomDesign, kind: IntentKind): LightingIntent => byKind(d, kind)[0]!;

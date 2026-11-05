// Tag strategy (PLAN §3 "Room extraction" (a)): designers or exporters mark nodes by name or glTF `extras`.
//
// Name / tag-string grammar (case-insensitive, tokens separated by `|` or `;`):
//   room:<label>         the node (usually a group) is a room; descendants inherit it. `room:204 Open office`
//   floor | ceiling | wall | window | door | ignore
//                        role word, alone or with numbering / side qualifiers: `Floor`, `wall_north`, `Ceiling.002`,
//                        `walls` (plural), `wall: anything` — but not `Wallpaper`, `Wall art` or `Floor lamp`.
//   obj[:<kind>] / object[:<kind>]
//                        a furniture/object unit; the first word after the colon is its kind: `obj:desk Desk 1`.
// `extras` (three's userData) may carry the same as fields: `{ room, role | type | tag, kind, tags }`, where `tags`
// is a tag string or an array of them. Explicit fields beat words parsed from the name. glTF loaders sanitise node
// names (`room:204 Open office` → `room204_Open_office`), so the original `userData.name` is read first.
import type { Object3D } from 'three';
import { OBJECT_KINDS } from '@intent-studio/core';
import { classifyName } from './classify';

export const NODE_ROLES = ['floor', 'ceiling', 'wall', 'object', 'window', 'door', 'ignore'] as const;
export type NodeRole = (typeof NODE_ROLES)[number];

export interface NodeTags {
  role?: NodeRole;
  /** Room label (from `room:<label>`). */
  room?: string;
  /** Object kind word (from `obj:<kind>` or `extras.kind`). */
  kind?: string;
}

/** Tags resolved with inheritance: each field comes from the nearest tagged ancestor-or-self. */
export interface ResolvedTags extends NodeTags {
  roleNode?: Object3D;
  roomNode?: Object3D;
}

// A role word followed only by numbering / side qualifiers (`Wall_North_02`, `Floor.001`, `ceiling (2)`), or by a
// colon and free text (`wall: north side`). `Wall art`, `Floor lamp`, `Door handle` are *not* role tags.
const QUALIFIER = String.raw`(?:\d+|\(\d+\)|north|south|east|west|[nsew]|left|right|front|back|main|inner|outer|int|ext|interior|exterior|slab|mesh|geo|geom|surface|plane|panel|part)`;
const ROLE_WORD = new RegExp(
  String.raw`^(floor|ceiling|wall|window|door|ignore)s?(?::.*|(?:[\s_.\-#]*${QUALIFIER})*[\s_.\-#]*)$`,
  'i',
);
const ROOM_TOKEN = /^room\s*[:=]\s*(.+)$/i;
const OBJECT_TOKEN = /^(?:obj|object)(?:\s*[:=]\s*(.*))?$/i;
const KNOWN_KINDS = new Set<string>(OBJECT_KINDS);

function normaliseKind(word: string): string | undefined {
  const w = word.trim().toLowerCase();
  if (!w) return undefined;
  if (KNOWN_KINDS.has(w)) return w;
  return classifyName(w) ?? w;
}

/** Parse one tag string (a node name or an extras tag). Unrecognised text yields `{}`. */
export function parseTagString(text: string): NodeTags {
  const out: NodeTags = {};
  for (const raw of text.split(/[|;]/)) {
    const token = raw.trim();
    if (!token) continue;
    const room = ROOM_TOKEN.exec(token);
    if (room) {
      const label = (room[1] ?? '').trim();
      if (label) out.room = label;
      continue;
    }
    const obj = OBJECT_TOKEN.exec(token);
    if (obj) {
      out.role = 'object';
      const kind = normaliseKind((obj[1] ?? '').split(/\s+/)[0] ?? '');
      if (kind) out.kind = kind;
      continue;
    }
    const role = ROLE_WORD.exec(token);
    if (role) out.role = (role[1] ?? '').toLowerCase() as NodeRole;
  }
  return out;
}

const isRole = (v: unknown): v is NodeRole => typeof v === 'string' && (NODE_ROLES as readonly string[]).includes(v);

/** Tags of one node from its name and userData (glTF extras). */
export function readNodeTags(name: string, userData: Record<string, unknown> = {}): NodeTags {
  const out: NodeTags = { ...parseTagString(name) };
  const tags = userData.tags;
  const list = typeof tags === 'string' ? [tags] : Array.isArray(tags) ? tags : [];
  for (const t of list) if (typeof t === 'string') Object.assign(out, parseTagString(t));
  for (const key of ['role', 'type', 'tag'] as const) {
    const v = userData[key];
    if (typeof v !== 'string') continue;
    const lower = v.trim().toLowerCase();
    if (isRole(lower)) out.role = lower;
    else Object.assign(out, parseTagString(v));
  }
  if (typeof userData.room === 'string' && userData.room.trim()) out.room = userData.room.trim();
  if (typeof userData.kind === 'string') {
    const kind = normaliseKind(userData.kind);
    if (kind) {
      out.kind = kind;
      out.role ??= 'object';
    }
  }
  return out;
}

/** The node's original (unsanitised) name. */
export function nodeName(o: Object3D): string {
  const n = (o.userData as Record<string, unknown> | undefined)?.name;
  return typeof n === 'string' && n ? n : o.name;
}

/** Own tags of a node. */
export const tagsOf = (o: Object3D): NodeTags =>
  readNodeTags(nodeName(o), (o.userData ?? {}) as Record<string, unknown>);

/** Tags with inheritance from ancestors (up to and including `root`). */
export function resolveTags(o: Object3D, root?: Object3D): ResolvedTags {
  const out: ResolvedTags = {};
  let node: Object3D | null = o;
  while (node) {
    const t = tagsOf(node);
    if (out.role === undefined && t.role !== undefined) {
      out.role = t.role;
      out.roleNode = node;
      if (t.kind !== undefined) out.kind = t.kind;
    }
    if (out.room === undefined && t.room !== undefined) {
      out.room = t.room;
      out.roomNode = node;
    }
    if (node === root) break;
    node = node.parent;
  }
  return out;
}

/** True when any node under `root` carries a role or room tag. */
export function hasTags(root: Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if (found) return;
    const t = tagsOf(o);
    if (t.role !== undefined || t.room !== undefined) found = true;
  });
  return found;
}

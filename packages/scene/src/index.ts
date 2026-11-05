// @intent-studio/scene — 3D scene import → StudioRoom (browser + Node; three.js for math and loaders only).
export const SCENE_VERSION = 1;

export * from './axes';
export * from './load';
export * from './tags';
export * from './classify';
export * from './extract-room';
export { buildManualRoom, assembleRoom, normaliseOutline, type RoomParts } from './room-build';
export * from './display-mesh';
export { orientedBounds, principalAngle, simplifyLoop, type OrientedRect } from './polygon';

export const CORE_VERSION = 1;

export * from './model';
export * from './format';
export * from './units';
export * from './geometry';
export * from './hash';
export * from './fixtures/demo-rooms';
export * from './defaults';
export * from './workplane';
export * from './products';
export * from './ranker';
export * from './heatscale';
export * from './heatmap';
export * from './estimate';
export * from './zones';
export * from './suggestions';
export * from './ai-codecs';
export {
  interpret,
  forTarget,
  findTargets,
  kindsIn,
  levelIn,
  levelTarget,
  wallsNamed,
  clauses,
  intentKey,
  type Targets,
} from './interpreter';
export { fallbackAi, advise, ambientAverage, pickProduct, searchProducts } from './fallback-ai';
export * from './solver';

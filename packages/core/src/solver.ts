// Deterministic fixture solver (spec/solver.md, spec/solver-layouts.md). Implementation lives in ./solver/*; this file
// is the public surface (tiny internal helpers such as the number-format aliases stay in ./solver/context).
export {
  MAX_FIXTURES,
  MAX_KEEP_DIM_MOVES,
  FLOOR_FACTOR,
  CEILING_FACTOR,
  MAX_PACKAGE_ALTERNATIVES,
  SOLVE_ORDER,
  SEARCH_ITERATIONS,
  KEEP_DIM_REACH,
  KEEP_DIM_DEFAULT_MAX,
  PINNED_CLEARANCE,
  LLF,
  hasTarget,
  want,
  leanWant,
  excess,
  shortfall,
  isHandTuned,
  signature,
  isPendant,
  isCove,
  isLinear,
  estimateOf,
  ctxDensity,
  keepDimMargin,
  makeCtx,
  type Ctx,
  type KeepRef,
} from './solver/context';
export * from './solver/layouts';
export * from './solver/solve';

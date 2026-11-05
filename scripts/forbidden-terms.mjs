// The excluded terms (CLAUDE.md), shared by check-forbidden.mjs and the AI eval (scripts/eval).
// Built from fragments so this file does not match itself.
export const FORBIDDEN_TERMS = [
  ['acu', 'ity'],
  ['recommend', '_illuminance'],
  ['Illuminance', 'Recommendation'],
  ['Photometry', 'Id'],
].map((p) => p.join(''));

/** Case-insensitive regex matching any forbidden term. */
export const forbiddenPattern = () => new RegExp(FORBIDDEN_TERMS.join('|'), 'i');

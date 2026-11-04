# Intent Studio Web

Browser lighting-intent designer: import a 3D room, paint intents, a deterministic solver lays out fixtures, an advisory
AI proposes labels/targets/planes/intents/CCT. Plan: `handoff/PLAN.md`. Progress: `handoff/PROGRESS.md` (keep it current).

## Rules

- Core model units are feet and footcandles. Convert only at display and at import/export boundaries.
- `packages/core` is pure: no DOM, no Node APIs, deterministic. Same design in → same layout out.
- The AI never places fixtures or computes illuminance. Every AI call has a deterministic fallback; AI output is
  untrusted: parse defensively, validate with zod, clamp, keep fallback per field.
- Never overwrite a field the designer edited; hand-moved fixtures are pinned.
- Every illuminance number shown is labelled an estimate. No code-compliance claims.
- Forbidden: Acuity catalog/product endpoints, the illuminance recommendation endpoint/tool, Designer link, Copilot SDK.
  CI rejects `acuity`, `recommend_illuminance`, `IlluminanceRecommendation`, `PhotometryId` outside `handoff/`.
- When porting from `handoff/reference/*.cs`, keep constants, ordering and tie-breaks exactly; port its tests first.
- Clean room: never read the original C# source; work from handoff/spec/*.md and handoff/golden/. Questions go to handoff/spec/QUESTIONS.md.

## Commands

- `pnpm -r typecheck && pnpm -r test && pnpm lint` — phase gate
- `pnpm --filter web dev`, `pnpm --filter server dev`
- `pnpm e2e`

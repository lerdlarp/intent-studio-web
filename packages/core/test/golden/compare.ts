// Deep comparison with numeric tolerance for golden parity tests.
export type Tolerance = { abs?: number; rel?: number };

/** Returns a list of mismatch descriptions (empty when equal within tolerance). */
export function diffClose(actual: unknown, expected: unknown, tol: Tolerance = { abs: 1e-6 }, path = '$'): string[] {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Object.is(actual, expected) || actual === expected) return [];
    const d = Math.abs(actual - expected);
    const ok = (tol.abs !== undefined && d <= tol.abs) || (tol.rel !== undefined && d <= tol.rel * Math.abs(expected));
    return ok ? [] : [`${path}: ${actual} != ${expected} (Δ ${d})`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array, got ${JSON.stringify(actual)}`];
    if (actual.length !== expected.length) return [`${path}: length ${actual.length} != ${expected.length}`];
    return expected.flatMap((e, i) => diffClose(actual[i], e, tol, `${path}[${i}]`));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
      return [`${path}: expected object, got ${JSON.stringify(actual)}`];
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
    return [...keys].flatMap((k) =>
      k in e && k in a
        ? diffClose(a[k], e[k], tol, `${path}.${k}`)
        : [`${path}.${k}: missing on ${k in e ? 'actual' : 'expected'}`],
    );
  }
  return Object.is(actual, expected) ? [] : [`${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`];
}

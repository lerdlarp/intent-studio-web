import { contains, distance, orientedRect, polygonDistance } from '../geometry';
import type { P2, StudioFixture, StudioProduct } from '../model';

export interface FixtureFootprint {
  center: P2;
  height: number;
  outline: P2[];
  radius: number;
  reach: number;
}

/** The physical housing in plan, independent of the fixture's target plane. */
export function fixtureFootprint(fixture: StudioFixture, product: StudioProduct): FixtureFootprint {
  const { center, height, orientation } = fixture;
  if (product.isRound) {
    const radius = Math.max(product.length, product.width) / 2;
    return { center, height, outline: [center], radius, reach: radius };
  }
  return {
    center,
    height,
    outline: orientedRect(center, product.length, product.width, orientation),
    radius: 0,
    reach: Math.hypot(product.length, product.width) / 2,
  };
}

export function fixturesOverlap(a: FixtureFootprint, b: FixtureFootprint): boolean {
  if (Math.abs(a.height - b.height) >= 0.5 || distance(a.center, b.center) > a.reach + b.reach) return false;
  return (
    contains(a.outline, b.center) ||
    contains(b.outline, a.center) ||
    polygonDistance(a.outline, b.outline) <= a.radius + b.radius
  );
}

export function overlapsWallWash(
  fixture: StudioFixture,
  product: StudioProduct,
  wallWashes: readonly FixtureFootprint[],
): boolean {
  if (wallWashes.length === 0) return false;
  const footprint = fixtureFootprint(fixture, product);
  return wallWashes.some((wash) => fixturesOverlap(footprint, wash));
}

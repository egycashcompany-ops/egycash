// The in-house grid (spec §9.4, DM-26): dots in one cell group below zoom 15, none group from 15,
// machines at the same place always stack, and a stack fans out on a circle of 18 + 4n px.
import { describe, expect, it } from 'vitest';
import { clusterPoints, spiderfy } from './map-cluster';

const point = (id: string, lat: number, lng: number, x: number, y: number) => ({
  id,
  lat,
  lng,
  px: { x, y },
});

describe('clusterPoints', () => {
  const near = [
    point('a', 30, 31, 10, 10),
    point('b', 30.001, 31.001, 30, 40),
    point('c', 30.5, 31.5, 300, 300),
  ];

  it('groups the dots of one 56 px cell at zoom 12', () => {
    const groups = clusterPoints(near, 56, 12);
    expect(groups.map((g) => [g.kind, g.members.map((m) => m.id)])).toEqual([
      ['cluster', ['a', 'b']],
      ['single', ['c']],
    ]);
    expect(groups[0]?.centerPx).toEqual({ x: 20, y: 25 });
  });

  it('groups nothing from zoom 15', () => {
    expect(clusterPoints(near, 56, 15).map((g) => g.kind)).toEqual(['single', 'single', 'single']);
  });

  it('stacks machines at the same place (≤ 1 m) at any zoom', () => {
    const lobby = [
      point('x', 30, 31, 100, 100),
      point('y', 30.000005, 31.000005, 100, 100), // ≈ 0.7 m away
      point('z', 30.0001, 31, 100, 89), // ≈ 11 m away
    ];
    const atHigh = clusterPoints(lobby, 56, 18);
    expect(atHigh.map((g) => [g.kind, g.members.map((m) => m.id)])).toEqual([
      ['stack', ['x', 'y']],
      ['single', ['z']],
    ]);
    // Alone in its cell at a low zoom, a stack is still a stack, not a cluster bubble.
    const alone = clusterPoints(lobby.slice(0, 2), 56, 10);
    expect(alone.map((g) => g.kind)).toEqual(['stack']);
  });
});

describe('spiderfy', () => {
  it('puts n points on a circle of radius 18 + 4n px, the first at the top', () => {
    const fanned = spiderfy({ x: 100, y: 100 }, 3);
    expect(fanned).toHaveLength(3);
    for (const p of fanned) expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(30, 9);
    expect(fanned[0]?.x).toBeCloseTo(100, 9);
    expect(fanned[0]?.y).toBeCloseTo(70, 9);
  });
});

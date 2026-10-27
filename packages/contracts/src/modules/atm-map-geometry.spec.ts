// The zone geometry, pinned case by case (docs/12-planning/atm-map-zones.md §9.1). The api refuses
// a save with these functions and the web editor warns with them, so a drift here would make the
// editor accept a shape the server then refuses — or count a machine in a zone it is drawn outside.
//
// Coordinates are synthetic: unit squares near (0,0) for the topology, and points around Cairo for
// the metric cases. `ll(lat, lng)`.
import { describe, expect, it } from 'vitest';
import {
  ATM_MAP_ZONE_MAX_POINTS,
  type AtmMapLatLng,
  inBox,
  membershipZones,
  pointInPolygon,
  polygonAreaM2,
  polygonsOverlap,
  project,
  segmentsIntersect,
  selfIntersects,
  zoneGeometryIssues,
  zoneMembership,
} from './atm-map-geometry.js';

const ll = (lat: number, lng: number): AtmMapLatLng => ({ lat, lng });
const ring = (...pairs: [number, number][]): AtmMapLatLng[] => pairs.map(([a, b]) => ll(a, b));

/** A unit-free square [lat0, lat1] × [lng0, lng1]. */
const square = (lat0: number, lng0: number, lat1: number, lng1: number): AtmMapLatLng[] =>
  ring([lat0, lng0], [lat0, lng1], [lat1, lng1], [lat1, lng0]);

const CAIRO_BLOCK = square(30.0, 31.2, 30.1, 31.3);

describe('project — the plane Leaflet draws (DM-48)', () => {
  it('keeps x = lng and maps the equator to y = 0', () => {
    const p = project(ll(0, 31.25));
    expect(p.x).toBe(31.25);
    expect(p.y).toBeCloseTo(0, 12);
  });

  it('stretches latitude the Mercator way, and stays finite at the poles', () => {
    expect(project(ll(30, 0)).y).toBeCloseTo(31.4729, 3);
    expect(Number.isFinite(project(ll(90, 0)).y)).toBe(true);
    expect(Number.isFinite(project(ll(-90, 0)).y)).toBe(true);
  });
});

describe('pointInPolygon', () => {
  it('answers inside and outside', () => {
    expect(pointInPolygon(ll(30.05, 31.25), CAIRO_BLOCK)).toBe(true);
    expect(pointInPolygon(ll(30.2, 31.25), CAIRO_BLOCK)).toBe(false);
  });

  it('counts a point exactly on an edge, or on a vertex, as inside', () => {
    expect(pointInPolygon(ll(30.0, 31.25), CAIRO_BLOCK)).toBe(true);
    expect(pointInPolygon(ll(30.05, 31.3), CAIRO_BLOCK)).toBe(true);
    expect(pointInPolygon(ll(30.0, 31.2), CAIRO_BLOCK)).toBe(true);
  });

  it('leaves a point in the notch of a concave "C" outside', () => {
    const c = ring([0, 0], [0, 3], [1, 3], [1, 1], [2, 1], [2, 3], [3, 3], [3, 0]);
    expect(pointInPolygon(ll(1.5, 2), c)).toBe(false);
    expect(pointInPolygon(ll(1.5, 0.5), c)).toBe(true);
  });

  it('does not double-count a ray that passes through a vertex', () => {
    const diamond = ring([30.0, 31.25], [30.05, 31.3], [30.1, 31.25], [30.05, 31.2]);
    // Same latitude as the two side vertices, east and west of the ring.
    expect(pointInPolygon(ll(30.05, 31.4), diamond)).toBe(false);
    expect(pointInPolygon(ll(30.05, 31.1), diamond)).toBe(false);
    expect(pointInPolygon(ll(30.05, 31.25), diamond)).toBe(true);
  });

  it('classifies a point between the lat/lng chord and the Mercator chord as Leaflet draws it', () => {
    // East edge (24.0, 32.8)–(31.5, 32.3). At lat 28 the lat/lng chord sits at lng 32.5333 and
    // the edge Leaflet draws (straight in Mercator) at 32.5376 — about 420 m further east.
    const zone = ring([24.0, 32.0], [24.0, 32.8], [31.5, 32.3], [31.5, 32.0]);
    const p = ll(28, 32.5355);
    const latLngChord = 32.8 - (0.5 * (28 - 24)) / 7.5;
    expect(p.lng).toBeGreaterThan(latLngChord); // outside, in the naive plane
    expect(pointInPolygon(p, zone)).toBe(true); // inside, as drawn
    expect(pointInPolygon(ll(28, 32.539), zone)).toBe(false);
  });
});

describe('segmentsIntersect and selfIntersects', () => {
  it('finds the crossing of a bow-tie', () => {
    expect(selfIntersects(ring([0, 0], [1, 1], [1, 0], [0, 1]))).toBe(true);
    expect(segmentsIntersect(ll(0, 0), ll(1, 1), ll(1, 0), ll(0, 1))).toBe(true);
  });

  it('passes a square', () => {
    expect(selfIntersects(square(0, 0, 1, 1))).toBe(false);
    expect(selfIntersects(CAIRO_BLOCK)).toBe(false);
  });

  it('does not count consecutive edges that touch only at their shared vertex', () => {
    expect(segmentsIntersect(ll(0, 0), ll(1, 0), ll(1, 0), ll(1, 1))).toBe(false);
    // A straight continuation is not a back-track either.
    expect(selfIntersects(ring([0, 0], [1, 0], [2, 0], [2, 2]))).toBe(false);
  });

  it('counts a collinear overlap of positive length as an intersection', () => {
    expect(segmentsIntersect(ll(0, 0), ll(2, 0), ll(1, 0), ll(3, 0))).toBe(true);
    expect(segmentsIntersect(ll(0, 0), ll(1, 0), ll(2, 0), ll(3, 0))).toBe(false);
  });

  it('finds the consecutive back-track', () => {
    expect(selfIntersects(ring([0, 0], [2, 0], [1, 0], [1, 1]))).toBe(true);
  });

  it('finds a vertex lying on a non-adjacent edge', () => {
    // (0,2) sits on the edge (0,0)–(0,4).
    expect(selfIntersects(ring([0, 0], [0, 4], [3, 4], [0, 2], [-1, 1]))).toBe(true);
  });

  it('finds a vertex repeated at two non-consecutive positions (a pinch)', () => {
    expect(selfIntersects(ring([0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 1]))).toBe(true);
  });

  it('passes a 500-point regular polygon within 50 ms', () => {
    const polygon = Array.from({ length: 500 }, (_, i) => {
      const a = (2 * Math.PI * i) / 500;
      return ll(30 + 0.05 * Math.sin(a), 31 + 0.05 * Math.cos(a));
    });
    const started = performance.now();
    expect(selfIntersects(polygon)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('polygonsOverlap', () => {
  const unit = square(0, 0, 1, 1);

  it('is false for disjoint rings', () => {
    expect(polygonsOverlap(unit, square(2, 2, 3, 3))).toBe(false);
  });

  it('is false for snapped neighbours sharing a full edge', () => {
    expect(polygonsOverlap(unit, square(0, 1, 1, 2))).toBe(false);
  });

  it('is false for rings sharing only a vertex', () => {
    expect(polygonsOverlap(unit, square(1, 1, 2, 2))).toBe(false);
  });

  it('is true for a crossing', () => {
    expect(polygonsOverlap(square(0, 0, 2, 2), square(1, 1, 3, 3))).toBe(true);
  });

  it('is true for containment, both ways round', () => {
    expect(polygonsOverlap(square(0, 0, 4, 4), square(1, 1, 2, 2))).toBe(true);
    expect(polygonsOverlap(square(1, 1, 2, 2), square(0, 0, 4, 4))).toBe(true);
  });

  it("is true for a triangle on a square's own vertices (the edge midpoint test)", () => {
    expect(polygonsOverlap(ring([0, 0], [1, 0], [1, 1]), unit)).toBe(true);
  });

  it('is true for a triangle inside a square that shares two of its sides', () => {
    expect(polygonsOverlap(ring([0, 0], [2, 0], [0, 2]), square(0, 0, 2, 2))).toBe(true);
  });

  it('is true for two identical rings', () => {
    expect(polygonsOverlap(CAIRO_BLOCK, [...CAIRO_BLOCK])).toBe(true);
    // The same vertex set, starting elsewhere.
    expect(polygonsOverlap(unit, [unit[2], unit[3], unit[0], unit[1]] as AtmMapLatLng[])).toBe(
      true,
    );
  });

  it('is false for a C-shaped ring and a small ring in its notch, even though the C centroid falls in it', () => {
    // The C's area centroid is (1.5, ≈1.357): inside the notch, inside the small ring, outside the
    // C itself — the guard that keeps the centroid test from calling this an overlap.
    const c = ring([0, 0], [0, 3], [1, 3], [1, 1], [2, 1], [2, 3], [3, 3], [3, 0]);
    const inNotch = square(1.2, 1.2, 1.8, 2.8);
    expect(pointInPolygon(ll(1.5, 1.357), inNotch)).toBe(true);
    expect(polygonsOverlap(c, inNotch)).toBe(false);
    expect(polygonsOverlap(inNotch, c)).toBe(false);
  });

  it('ignores a vertex 1e-8 inside the other ring (ε)', () => {
    const east = ring([0.25, 1 - 1e-8], [0.25, 2], [0.75, 2], [0.75, 1]);
    expect(polygonsOverlap(unit, east)).toBe(false);
  });

  // The editor snaps a dot onto a neighbour's edge and stores it at 6 decimals (DM-6), which moves
  // it up to 5e-7° per axis off a slanted edge — the two zones still only share a border.
  it('is false for a neighbour whose two dots were snapped onto a slanted edge and rounded', () => {
    const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
    const unproject = (x: number, y: number): AtmMapLatLng =>
      ll((360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / 180)) - 90, x);
    /** The point at `t` along a→b as Leaflet draws the edge (straight in the projected plane). */
    const along = (a: AtmMapLatLng, b: AtmMapLatLng, t: number): AtmMapLatLng => {
      const [pa, pb] = [project(a), project(b)];
      const p = unproject(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t);
      return ll(r6(p.lat), r6(p.lng));
    };
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let overlapping = 0;
    for (let n = 0; n < 300; n += 1) {
      const a = ll(r6(30 + random() * 0.05), r6(31.2 + random() * 0.05));
      const angle = random() * 2 * Math.PI;
      const length = 0.005 + random() * 0.02;
      const b = ll(r6(a.lat + length * Math.sin(angle)), r6(a.lng + length * Math.cos(angle)));
      const normal = { lat: Math.cos(angle) * length, lng: -Math.sin(angle) * length };
      const apex = (sign: number): AtmMapLatLng =>
        ll(
          r6((a.lat + b.lat) / 2 + sign * normal.lat),
          r6((a.lng + b.lng) / 2 + sign * normal.lng),
        );
      const zoneA = [a, b, apex(1)];
      const zoneB = [along(a, b, 0.3), apex(-1), along(a, b, 0.7)];
      if (polygonsOverlap(zoneA, zoneB) || polygonsOverlap(zoneB, zoneA)) overlapping += 1;
    }
    expect(overlapping).toBe(0);
  });

  it('still sees a vertex half a metre inside the other ring', () => {
    const block = square(30.0, 31.2, 30.01, 31.21);
    const east = ring([30.002, 31.21 - 5e-6], [30.002, 31.22], [30.008, 31.22], [30.008, 31.21]);
    expect(polygonsOverlap(block, east)).toBe(true);
  });
});

describe('polygonAreaM2', () => {
  it('measures squares at 30°N', () => {
    expect(polygonAreaM2(square(30, 31, 30.001, 31.001))).toBeGreaterThan(10_707.8 * 0.995);
    expect(polygonAreaM2(square(30, 31, 30.001, 31.001))).toBeLessThan(10_707.8 * 1.005);
    expect(polygonAreaM2(square(30, 31, 30.0001, 31.0001))).toBeCloseTo(107.1, 0);
    expect(polygonAreaM2(square(30, 31, 30.00009, 31.00009))).toBeCloseTo(86.7, 0);
  });

  it('does not depend on the winding', () => {
    expect(polygonAreaM2([...CAIRO_BLOCK].reverse())).toBeCloseTo(polygonAreaM2(CAIRO_BLOCK), 6);
  });
});

describe('zoneGeometryIssues', () => {
  it('passes a proper zone', () => {
    expect(zoneGeometryIssues(CAIRO_BLOCK)).toEqual([]);
  });

  it('reports too few and too many points', () => {
    expect(zoneGeometryIssues(ring([30, 31], [30.01, 31.01]))).toEqual(['TOO_FEW_POINTS']);
    const many = Array.from({ length: ATM_MAP_ZONE_MAX_POINTS + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / (ATM_MAP_ZONE_MAX_POINTS + 1);
      return ll(30 + 0.05 * Math.sin(a), 31 + 0.05 * Math.cos(a));
    });
    expect(zoneGeometryIssues(many)).toEqual(['TOO_MANY_POINTS']);
  });

  it('reports a repeated consecutive point, and last = first, as a duplicate only', () => {
    const [a, b, c, d] = CAIRO_BLOCK as [AtmMapLatLng, AtmMapLatLng, AtmMapLatLng, AtmMapLatLng];
    expect(zoneGeometryIssues([a, b, b, c, d])).toEqual(['DUPLICATE_POINT']);
    expect(zoneGeometryIssues([a, b, c, d, a])).toEqual(['DUPLICATE_POINT']);
    // Equal after 6-decimal rounding.
    expect(zoneGeometryIssues([a, b, { lat: b.lat + 1e-8, lng: b.lng }, c, d])).toEqual([
      'DUPLICATE_POINT',
    ]);
  });

  it('reports a bow-tie and a pinch as a self-intersection', () => {
    expect(zoneGeometryIssues(ring([30, 31], [30.01, 31.01], [30.01, 31], [30, 31.01]))).toEqual([
      'SELF_INTERSECTION',
    ]);
    expect(
      zoneGeometryIssues(
        ring([30, 31], [30.02, 31], [30.01, 31.01], [30.02, 31.02], [30, 31.02], [30.01, 31.01]),
      ),
    ).toEqual(['SELF_INTERSECTION']);
  });

  it('reports a zone under 100 m² as too small', () => {
    expect(zoneGeometryIssues(square(30, 31, 30.00009, 31.00009))).toEqual(['TOO_SMALL']);
    expect(zoneGeometryIssues(square(30, 31, 30.0001, 31.0001))).toEqual([]);
  });
});

// ── Membership (moved from the web, docs/12-planning/atm-settlements-phase1.md §6.9) ────────────

describe('zoneMembership (D-M7, DS-17)', () => {
  const BRANCH = 'b1';
  /** A square of side `size`° with its south-west corner at (lat, lng), counter-clockwise. */
  const box = (lat: number, lng: number, size: number): AtmMapLatLng[] =>
    square(lat, lng, lat + size, lng + size);
  const zones = membershipZones([
    { id: 'other-branch', branchId: 'b2', points: box(30, 31, 0.1) },
    { id: 'first', branchId: BRANCH, points: box(30, 31, 0.1) },
    { id: 'second', branchId: BRANCH, points: box(30.02, 31.02, 0.1) },
  ]);

  it('caches each zone box and keeps the list order', () => {
    expect(zones.map((z) => z.id)).toEqual(['other-branch', 'first', 'second']);
    expect(zones[1]?.box).toEqual({ south: 30, north: 30.1, west: 31, east: 31.1 });
  });

  it('counts the machine for the first zone in list order', () => {
    const m = zoneMembership({ lat: 30.05, lng: 31.05, branchId: BRANCH }, zones);
    expect(m).toEqual({ primary: 'first', all: ['first', 'second'] });
  });

  it('ignores the zones of another branch, even where they cover the point', () => {
    const m = zoneMembership({ lat: 30.01, lng: 31.01, branchId: BRANCH }, zones);
    expect(m.all).not.toContain('other-branch');
    expect(m.primary).toBe('first');
    expect(zoneMembership({ lat: 30.01, lng: 31.01, branchId: 'b3' }, zones)).toEqual({
      primary: null,
      all: [],
    });
  });

  it('a point outside every zone belongs to none', () => {
    expect(zoneMembership({ lat: 29, lng: 31, branchId: BRANCH }, zones)).toEqual({
      primary: null,
      all: [],
    });
  });

  it('the box prefilter tolerates six-decimal rounding, and a point on the edge is inside', () => {
    const [, first] = zones;
    expect(first).toBeDefined();
    expect(inBox(ll(30.1000005, 31.05), first!.box)).toBe(true);
    expect(inBox(ll(30.1001, 31.05), first!.box)).toBe(false);
    expect(zoneMembership({ lat: 30.1, lng: 31.05, branchId: BRANCH }, zones).all).toContain(
      'first',
    );
  });
});

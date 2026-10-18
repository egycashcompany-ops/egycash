// ATM machine map — zone geometry (docs/12-planning/atm-map-zones.md §6.1, DM-48).
//
// Pure functions, shared on purpose: the api validates a zone save with them and the web editor
// draws with them, so the two cannot disagree about whether a zone crosses itself or overlaps
// another. No geo library is installed and none is added (GM-19); everything here is small enough
// to pin case by case in `atm-map-geometry.spec.ts`.
//
// THE PLANE. Leaflet draws a straight edge in Web Mercator, not in latitude/longitude. At 30°N a
// 0.5° diagonal edge differs from the lat/lng-plane edge by about 35 m, so a machine drawn inside a
// zone could count as outside. Every test below except the area therefore runs on `project(p)`:
// x = lng and y = the Mercator latitude in degrees (DM-48). ε is in those projected degrees.
//
// The area is not a topological question, so it stays equirectangular about the mean latitude,
// which is accurate to well under the 100 m² floor at zone sizes.

/** A point on the map, the repository's own `{lat,lng}` shape (DM-6). */
export interface AtmMapLatLng {
  lat: number;
  lng: number;
}

/** A zone is an open ring of 3–500 points; the first point is not repeated at the end (DM-6). */
export const ATM_MAP_ZONE_MIN_POINTS = 3;
export const ATM_MAP_ZONE_MAX_POINTS = 500;
/** Below this a "zone" is a slip of the mouse, not an area anyone divides machines by. */
export const ATM_MAP_ZONE_MIN_AREA_M2 = 100;
/** The mean Earth radius (IUGG), used by the area here and by the api's `haversineMeters`. */
export const ATM_MAP_EARTH_RADIUS_METERS = 6_371_008.8;

export const ATM_MAP_ZONE_GEOMETRY_ISSUES = [
  'TOO_FEW_POINTS',
  'TOO_MANY_POINTS',
  'DUPLICATE_POINT',
  'SELF_INTERSECTION',
  'TOO_SMALL',
] as const;
export type AtmMapZoneGeometryIssue = (typeof ATM_MAP_ZONE_GEOMETRY_ISSUES)[number];

/** Projected degrees. Two points closer than this are the same point; a point this close to an
 *  edge is on it. */
const EPSILON = 1e-7;

/**
 * The overlap test's ε, in projected degrees (≈ 0.2 m). A vertex snapped onto a neighbour's
 * SLANTED edge is stored at 6 decimals, which moves it up to 5e-7° per axis off that edge — up to
 * ≈ 1.2e-6 projected degrees at 60°N, many times `EPSILON`. A tolerance at least as large as that
 * rounding keeps two snapped neighbours from "overlapping" (the mockup's `onBoundary` tolerance is
 * likewise larger than its pixel rounding, `Edit.dc.html:350-353`).
 */
const OVERLAP_EPSILON = 2e-6;

/**
 * Leaflet's own clamp (`SphericalMercator.MAX_LATITUDE`). The Mercator y of ±90° is infinite, and
 * Leaflet never draws beyond this latitude, so "the plane Leaflet draws" stops here too.
 */
const MAX_MERCATOR_LATITUDE = 85.0511287798;

/** Six decimals (≈ 0.11 m), the precision every stored point carries (DM-6, `BranchMapPicker`). */
export const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

interface XY {
  x: number;
  y: number;
}

/** The plane Leaflet draws (DM-48): x = lng, y = the Mercator latitude in degrees. */
export const project = ({ lat, lng }: AtmMapLatLng): XY => {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat));
  return {
    x: lng,
    y: (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)),
  };
};

// ── Primitives (projected plane) ────────────────────────────────────────────────────────────────

const distance = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);

const cross = (o: XY, a: XY, b: XY): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The distance from p to the segment ab (to the point a when the segment has no length). */
const segmentDistance = (p: XY, a: XY, b: XY): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const onSegment = (p: XY, a: XY, b: XY, eps = EPSILON): boolean => segmentDistance(p, a, b) <= eps;

/** Which side of the line through a and b the point p lies on; 0 within ε of the line. */
const side = (a: XY, b: XY, p: XY, eps = EPSILON): -1 | 0 | 1 => {
  const length = distance(a, b);
  if (length === 0) return 0;
  const signed = cross(a, b, p) / length;
  if (Math.abs(signed) <= eps) return 0;
  return signed > 0 ? 1 : -1;
};

/** Each segment's endpoints lie strictly on opposite sides of the other's line. */
const crossesProperly = (a: XY, b: XY, c: XY, d: XY, eps = EPSILON): boolean =>
  side(a, b, c, eps) * side(a, b, d, eps) < 0 && side(c, d, a, eps) * side(c, d, b, eps) < 0;

/** The length two collinear segments share; 0 when they are not collinear. */
const collinearOverlap = (a: XY, b: XY, c: XY, d: XY): number => {
  const [p, q, r, s] = distance(a, b) >= distance(c, d) ? [a, b, c, d] : [c, d, a, b];
  const length = distance(p, q);
  if (length === 0) return 0;
  if (side(p, q, r) !== 0 || side(p, q, s) !== 0) return 0;
  const along = (point: XY): number =>
    ((point.x - p.x) * (q.x - p.x) + (point.y - p.y) * (q.y - p.y)) / length;
  const tr = along(r);
  const ts = along(s);
  return Math.min(length, Math.max(tr, ts)) - Math.max(0, Math.min(tr, ts));
};

/** Any common point at all: a crossing, a touch at an endpoint, or a shared stretch. */
const touches = (a: XY, b: XY, c: XY, d: XY): boolean =>
  crossesProperly(a, b, c, d) ||
  onSegment(c, a, b) ||
  onSegment(d, a, b) ||
  onSegment(a, c, d) ||
  onSegment(b, c, d);

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boxOf = (points: readonly XY[]): Box => {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  }
  return box;
};

const boxesMeet = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX + EPSILON &&
  b.minX <= a.maxX + EPSILON &&
  a.minY <= b.maxY + EPSILON &&
  b.minY <= a.maxY + EPSILON;

const onBoundary = (p: XY, ring: readonly XY[], eps = EPSILON): boolean =>
  ring.some((a, i) => onSegment(p, a, ring[(i + 1) % ring.length] as XY, eps));

/**
 * Even-odd ray casting towards +x. The half-open rule (one end of an edge counts, the other does
 * not) is what keeps a ray through a vertex from being counted twice.
 */
const rayInside = (p: XY, ring: readonly XY[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as XY;
    const b = ring[j] as XY;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/** Inside by more than ε from the boundary. */
const strictlyInside = (p: XY, ring: readonly XY[], eps = EPSILON): boolean =>
  !onBoundary(p, ring, eps) && rayInside(p, ring);

/** The area centroid; the mean of the vertices when the ring has no area. */
const centroidOf = (ring: readonly XY[]): XY => {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j] as XY;
    const b = ring[i] as XY;
    const f = a.x * b.y - b.x * a.y;
    area += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  if (Math.abs(area) < EPSILON * EPSILON) {
    const sum = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / ring.length, y: sum.y / ring.length };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
};

const coordKey = (p: AtmMapLatLng): string => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

// ── Public tests ────────────────────────────────────────────────────────────────────────────────

/**
 * Is p inside the ring, as Leaflet draws it? A point on the boundary counts as inside. The
 * bounding box is tested first, in lat/lng (the projection is monotone on both axes), so most
 * zones are rejected without projecting a single vertex.
 */
export const pointInPolygon = (p: AtmMapLatLng, ring: readonly AtmMapLatLng[]): boolean => {
  if (ring.length < 3) return false;
  const margin = 1e-6;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const v of ring) {
    minLat = Math.min(minLat, v.lat);
    maxLat = Math.max(maxLat, v.lat);
    minLng = Math.min(minLng, v.lng);
    maxLng = Math.max(maxLng, v.lng);
  }
  if (
    p.lat < minLat - margin ||
    p.lat > maxLat + margin ||
    p.lng < minLng - margin ||
    p.lng > maxLng + margin
  ) {
    return false;
  }
  const q = project(p);
  const projected = ring.map(project);
  return onBoundary(q, projected) || rayInside(q, projected);
};

/**
 * Do the segments ab and cd intersect? True for a proper crossing and for a collinear overlap of
 * positive length. Touching at an endpoint alone is not an intersection here.
 */
export const segmentsIntersect = (
  a: AtmMapLatLng,
  b: AtmMapLatLng,
  c: AtmMapLatLng,
  d: AtmMapLatLng,
): boolean => {
  const [pa, pb, pc, pd] = [project(a), project(b), project(c), project(d)];
  return crossesProperly(pa, pb, pc, pd) || collinearOverlap(pa, pb, pc, pd) > EPSILON;
};

/**
 * Does the ring cross or touch itself?
 *   · adjacent edges (sharing a vertex; the first and last edges are adjacent) intersect when they
 *     are collinear and overlap beyond the shared vertex — a back-track such as (0,0)→(2,0)→(1,0);
 *   · non-adjacent edges intersect when they have ANY common point, an endpoint touching the other
 *     edge included;
 *   · a vertex repeated at two non-consecutive positions (a pinch) is a self-intersection.
 * A bounding-box prefilter per edge pair keeps a 500-point ring cheap.
 */
export const selfIntersects = (ring: readonly AtmMapLatLng[]): boolean => {
  const n = ring.length;
  if (n < 3) return false;

  const lastIndex = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const key = coordKey(ring[i] as AtmMapLatLng);
    const previous = lastIndex.get(key);
    if (previous !== undefined && i - previous !== 1 && !(previous === 0 && i === n - 1)) {
      return true;
    }
    lastIndex.set(key, i);
  }

  const points = ring.map(project);
  const edges = points.map((start, i) => {
    const end = points[(i + 1) % n] as XY;
    return { start, end, box: boxOf([start, end]) };
  });

  for (let i = 0; i < n; i += 1) {
    const e = edges[i] as (typeof edges)[number];
    for (let j = i + 1; j < n; j += 1) {
      const f = edges[j] as (typeof edges)[number];
      if (!boxesMeet(e.box, f.box)) continue;
      const followsE = j === i + 1;
      const wraps = i === 0 && j === n - 1;
      if (followsE || wraps) {
        // The shared vertex, and the far end of each edge seen from it.
        const shared = followsE ? e.end : e.start;
        const one = followsE ? e.start : e.end;
        const other = followsE ? f.end : f.start;
        if (distance(shared, one) === 0 || distance(shared, other) === 0) continue;
        const sameDirection =
          (one.x - shared.x) * (other.x - shared.x) + (one.y - shared.y) * (other.y - shared.y) > 0;
        if (side(shared, one, other) === 0 && sameDirection) return true;
        continue;
      }
      if (touches(e.start, e.end, f.start, f.end)) return true;
    }
  }
  return false;
};

/**
 * Do two zones overlap (D-M7 allows it, with a warning)? Shared edges and shared vertices alone —
 * the snapped borders of two neighbours — are not an overlap; "on the boundary" here allows
 * `OVERLAP_EPSILON`, the rounding of a vertex snapped onto a slanted edge. True when any holds:
 *   · a proper edge crossing;
 *   · a vertex of one ring strictly inside the other;
 *   · the midpoint of an edge of one ring strictly inside the other (a triangle on a square's own
 *     vertices, which vertex tests alone miss);
 *   · the centroid of either ring strictly inside the other, counted only when it also lies inside
 *     its own ring (the mockup's `overlaps()`, `Edit.dc.html:354-362`; the guard stops a C-shaped
 *     zone whose centroid falls in its notch from "overlapping" a zone in that notch);
 *   · the two vertex sets are equal (a zone duplicated by snapping).
 */
export const polygonsOverlap = (
  a: readonly AtmMapLatLng[],
  b: readonly AtmMapLatLng[],
): boolean => {
  if (a.length < 3 || b.length < 3) return false;
  const ringA = a.map(project);
  const ringB = b.map(project);
  if (!boxesMeet(boxOf(ringA), boxOf(ringB))) return false;

  const keysA = new Set(a.map(coordKey));
  const keysB = new Set(b.map(coordKey));
  if (keysA.size === keysB.size && [...keysA].every((key) => keysB.has(key))) return true;

  for (let i = 0; i < ringA.length; i += 1) {
    const p = ringA[i] as XY;
    const q = ringA[(i + 1) % ringA.length] as XY;
    for (let j = 0; j < ringB.length; j += 1) {
      const c = ringB[j] as XY;
      const d = ringB[(j + 1) % ringB.length] as XY;
      if (crossesProperly(p, q, c, d, OVERLAP_EPSILON)) return true;
    }
  }

  const pokesInto = (ring: readonly XY[], other: readonly XY[]): boolean => {
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i] as XY;
      const q = ring[(i + 1) % ring.length] as XY;
      if (strictlyInside(p, other, OVERLAP_EPSILON)) return true;
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (strictlyInside(mid, other, OVERLAP_EPSILON)) return true;
    }
    const centre = centroidOf(ring);
    const inOwn = onBoundary(centre, ring) || rayInside(centre, ring);
    return inOwn && strictlyInside(centre, other, OVERLAP_EPSILON);
  };
  return pokesInto(ringA, ringB) || pokesInto(ringB, ringA);
};

/** The ring's area in m²: equirectangular about the mean latitude, then the shoelace formula. */
export const polygonAreaM2 = (ring: readonly AtmMapLatLng[]): number => {
  if (ring.length < 3) return 0;
  const toRadians = Math.PI / 180;
  const meanLat = ring.reduce((sum, p) => sum + p.lat, 0) / ring.length;
  const kx = ATM_MAP_EARTH_RADIUS_METERS * Math.cos(meanLat * toRadians) * toRadians;
  const ky = ATM_MAP_EARTH_RADIUS_METERS * toRadians;
  const origin = ring[0] as AtmMapLatLng;
  // Relative to the first vertex, so the products stay small and keep their precision.
  const xy = ring.map((p) => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky }));
  let twice = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i, i += 1) {
    const p = xy[j] as XY;
    const q = xy[i] as XY;
    twice += p.x * q.y - q.x * p.y;
  }
  return Math.abs(twice) / 2;
};

/**
 * Everything wrong with a zone's points, in this order, or `[]`. Duplicates are consecutive points
 * equal after 6-decimal rounding, last→first included; the remaining tests run on the ring with
 * them removed, so a doubled click is reported once, as a duplicate. A repeated NON-consecutive
 * point is a pinch, `SELF_INTERSECTION`. The area of a ring that crosses itself means nothing, so
 * `TOO_SMALL` is only judged on a simple ring.
 */
export const zoneGeometryIssues = (points: readonly AtmMapLatLng[]): AtmMapZoneGeometryIssue[] => {
  if (points.length < ATM_MAP_ZONE_MIN_POINTS) return ['TOO_FEW_POINTS'];
  if (points.length > ATM_MAP_ZONE_MAX_POINTS) return ['TOO_MANY_POINTS'];

  const rounded = points.map((p) => ({ lat: round6(p.lat), lng: round6(p.lng) }));
  // Each point is kept unless it equals the next one (cyclically).
  const ring = rounded.filter(
    (p, i) => coordKey(p) !== coordKey(rounded[(i + 1) % rounded.length] as AtmMapLatLng),
  );

  const issues: AtmMapZoneGeometryIssue[] = ring.length < rounded.length ? ['DUPLICATE_POINT'] : [];
  if (ring.length < ATM_MAP_ZONE_MIN_POINTS) return issues;
  if (selfIntersects(ring)) {
    issues.push('SELF_INTERSECTION');
    return issues;
  }
  if (polygonAreaM2(ring) < ATM_MAP_ZONE_MIN_AREA_M2) issues.push('TOO_SMALL');
  return issues;
};

// The machine map's geometry, as the editor and the counts use it (docs/12-planning/atm-map-zones.md
// §8.5). Pure: no Leaflet, no DOM — the map canvas hands in pixel positions through a projector.
//
// ONE GEOMETRY, SHARED. Whether a zone crosses itself, overlaps another or contains a machine is
// decided by the contracts' functions (`atm-map-geometry.ts`), the same ones the api validates a
// save with, so the editor can never accept a shape the server refuses. They run in the plane
// Leaflet draws — x = lng, y = the Mercator latitude (DM-48) — and so does everything added here.
//
// EVERY POINT IS ROUNDED ON THE WAY IN. The server stores six decimals (DM-6) and validates the
// rounded ring; the editor rounds each point that enters the draft (`round6`), so the browser's
// checks and the server's checks are made on the same numbers.
//
// MEMBERSHIP (D-M7, DM-9). A machine counts for the FIRST zone of its own branch, in list order,
// that contains it. Zones of another branch never count, and a zone's bounding box is tested before
// its ring, so 2,607 machines against 200 zones stays well inside a frame.
import {
  EGYPT_BOUNDS,
  polygonsOverlap,
  pointInPolygon,
  project,
  round6 as roundCoordinate,
  selfIntersects,
  segmentsIntersect,
  zoneMembership,
  type AtmMapLatLng,
  type LatLngBox,
  type Membership,
  type MembershipZone,
} from '@ecms/contracts';

export {
  polygonAreaM2,
  polygonsOverlap,
  pointInPolygon,
  project,
  segmentsIntersect,
  selfIntersects,
  zoneGeometryIssues,
  type AtmMapLatLng,
} from '@ecms/contracts';
// MEMBERSHIP MOVED TO THE CONTRACTS (docs/12-planning/atm-settlements-phase1.md DS-17, §6.9), so
// the map and Control & Supplies' «إنشاء الخطوط من القطاعات» run the same rule. Re-exported under
// the same names: no map file changed.
export {
  membershipZones,
  zoneMembership,
  type LatLngBox,
  type Membership,
  type MembershipZone,
} from '@ecms/contracts';

/** Inside DM-35's box — where the company's machines are; a point outside carries `outsideEgypt`. */
export const insideEgyptBox = ({ lat, lng }: AtmMapLatLng): boolean =>
  lat >= EGYPT_BOUNDS.south &&
  lat <= EGYPT_BOUNDS.north &&
  lng >= EGYPT_BOUNDS.west &&
  lng <= EGYPT_BOUNDS.east;

/**
 * The machines the default view fits (§8.4): those inside Egypt's box. A mistyped Plus Code far
 * away would otherwise zoom the whole branch out across Africa; it is still drawn, and listed as
 * «خارج حدود مصر» on the unlocated screen. All of them when none is inside.
 */
export const fitDotsOf = <T extends AtmMapLatLng>(dots: readonly T[]): readonly T[] => {
  const inside = dots.filter(insideEgyptBox);
  return inside.length > 0 ? inside : dots;
};

/** A pixel position on the map container (or in Leaflet's world pixels at one zoom). */
export interface PixelPoint {
  x: number;
  y: number;
}

/** Turns a point into pixels at the map's current view — `map.latLngToContainerPoint`. */
export type Projector = (p: AtmMapLatLng) => PixelPoint;

/** A zone as the geometry helpers read it: an id and its open ring. */
export interface GeometryZone {
  id: string;
  points: readonly AtmMapLatLng[];
}

/** Projected degrees, as in the contracts: closer than this is the same point. */
const EPSILON = 1e-7;

/** Six decimals on both axes — every point the draft accepts goes through this (DM-48). */
export const round6 = (p: AtmMapLatLng): AtmMapLatLng => ({
  lat: roundCoordinate(p.lat),
  lng: roundCoordinate(p.lng),
});

/** The key two vertices share when they are the same point after rounding (DM-6). */
export const coordKey = (p: AtmMapLatLng): string => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** The inverse of `project`: a point of the plane Leaflet draws, back to lat/lng. */
const unproject = ({ x, y }: PixelPoint): AtmMapLatLng => ({
  lat: (360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / 180)) - 90,
  lng: x,
});

/**
 * The point a fraction `t` of the way from a to b along the straight edge Leaflet draws — linear in
 * the projected plane, not in lat/lng.
 */
export const alongEdge = (a: AtmMapLatLng, b: AtmMapLatLng, t: number): AtmMapLatLng => {
  const pa = project(a);
  const pb = project(b);
  return unproject({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t });
};

// ── Membership (D-M7, DM-9) ─────────────────────────────────────────────────────────────────────

export const boxOf = (points: readonly AtmMapLatLng[]): LatLngBox => {
  const box = { south: Infinity, north: -Infinity, west: Infinity, east: -Infinity };
  for (const p of points) {
    box.south = Math.min(box.south, p.lat);
    box.north = Math.max(box.north, p.lat);
    box.west = Math.min(box.west, p.lng);
    box.east = Math.max(box.east, p.lng);
  }
  return box;
};

export const boxesMeet = (a: LatLngBox, b: LatLngBox): boolean =>
  a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;

export const NO_MEMBERSHIP: Membership = { primary: null, all: [] };

/** Every located point's membership, keyed by machine id; a point without coordinates has none. */
export const membershipOf = (
  points: readonly {
    machineId: string;
    branchId: string;
    lat: number | null;
    lng: number | null;
  }[],
  zones: readonly MembershipZone[],
): Map<string, Membership> => {
  const result = new Map<string, Membership>();
  for (const p of points) {
    if (p.lat === null || p.lng === null) {
      result.set(p.machineId, NO_MEMBERSHIP);
      continue;
    }
    result.set(
      p.machineId,
      zoneMembership({ lat: p.lat, lng: p.lng, branchId: p.branchId }, zones),
    );
  }
  return result;
};

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────

const projectedDistance = (a: PixelPoint, b: PixelPoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

const onProjectedSegment = (p: PixelPoint, a: PixelPoint, b: PixelPoint): boolean =>
  closestPointOnSegmentPx(p, a, b).distance <= EPSILON;

const sideOf = (a: PixelPoint, b: PixelPoint, p: PixelPoint): -1 | 0 | 1 => {
  const length = projectedDistance(a, b);
  if (length === 0) return 0;
  const signed = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length;
  if (Math.abs(signed) <= EPSILON) return 0;
  return signed > 0 ? 1 : -1;
};

/**
 * Would the next dot's edge cross the path drawn so far? The new edge (last dot → `next`) is tested
 * against the drawn edges by `selfIntersects`'s own rules:
 *   · the edge that ends at the last dot is adjacent: it fails only when the new edge runs back
 *     along it, beyond the shared dot (a back-track);
 *   · every earlier edge fails on ANY common point, an endpoint touching included — which is also
 *     what refuses a dot dropped on an earlier dot (a pinch).
 * Closing the shape is FINISH_DRAW's business (its ring is validated whole), not this function's.
 */
export const wouldCrossWhileDrawing = (
  openPath: readonly AtmMapLatLng[],
  next: AtmMapLatLng,
): boolean => {
  const n = openPath.length;
  if (n < 2) return false;
  const last = openPath[n - 1] as AtmMapLatLng;
  const shared = project(last);
  const other = project(next);
  if (projectedDistance(shared, other) === 0) return false;

  // The adjacent edge: a back-track along it.
  const one = project(openPath[n - 2] as AtmMapLatLng);
  if (projectedDistance(shared, one) > 0) {
    const sameDirection =
      (one.x - shared.x) * (other.x - shared.x) + (one.y - shared.y) * (other.y - shared.y) > 0;
    if (sideOf(shared, one, other) === 0 && sameDirection) return true;
  }

  // Every earlier edge: any common point at all.
  for (let i = 0; i + 1 < n - 1; i += 1) {
    const a = openPath[i] as AtmMapLatLng;
    const b = openPath[i + 1] as AtmMapLatLng;
    if (segmentsIntersect(a, b, last, next)) return true;
    const [pa, pb] = [project(a), project(b)];
    if (
      onProjectedSegment(shared, pa, pb) ||
      onProjectedSegment(other, pa, pb) ||
      onProjectedSegment(pa, shared, other) ||
      onProjectedSegment(pb, shared, other)
    ) {
      return true;
    }
  }
  return false;
};

// ── Snapping ────────────────────────────────────────────────────────────────────────────────────

/** The nearest point of the segment ab to p, how far it is, and where along ab it lies (0…1). */
export const closestPointOnSegmentPx = (
  p: PixelPoint,
  a: PixelPoint,
  b: PixelPoint,
): { point: PixelPoint; distance: number; t: number } => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y), t };
};

/** What a dot or a dragged vertex may snap to, already in pixels. */
export interface SnapCandidates {
  vertices: readonly { zoneId: string; index: number; px: PixelPoint; latlng: AtmMapLatLng }[];
  edges: readonly {
    zoneId: string;
    /** The edge from vertex `index` to vertex `index + 1` (cyclically). */
    index: number;
    a: PixelPoint;
    b: PixelPoint;
    la: AtmMapLatLng;
    lb: AtmMapLatLng;
  }[];
  /** The first dot of the shape being drawn, offered once it has three dots: snapping closes. */
  first?: { px: PixelPoint; latlng: AtmMapLatLng } | null;
}

export interface SnapHit {
  kind: 'vertex' | 'edge' | 'first';
  /** `null` for `first`: the shape being drawn is not a zone yet. */
  zoneId: string | null;
  /** The vertex, or the edge's start vertex; `0` for `first`. */
  index: number;
  latlng: AtmMapLatLng;
}

/**
 * Where the cursor snaps, within `thresholdPx` (inclusive). Closing the shape on its first dot beats
 * everything; then the nearest vertex beats any edge, and the nearest edge beats nothing. An edge
 * snap lands on the edge as Leaflet draws it (`alongEdge`).
 */
export const snapTarget = (
  cursorPx: PixelPoint,
  candidatesPx: SnapCandidates,
  thresholdPx: number,
): SnapHit | null => {
  const first = candidatesPx.first;
  if (first && projectedDistance(cursorPx, first.px) <= thresholdPx) {
    return { kind: 'first', zoneId: null, index: 0, latlng: round6(first.latlng) };
  }

  let bestVertex: SnapHit | null = null;
  let bestDistance = Infinity;
  for (const v of candidatesPx.vertices) {
    const d = projectedDistance(cursorPx, v.px);
    if (d <= thresholdPx && d < bestDistance) {
      bestDistance = d;
      bestVertex = { kind: 'vertex', zoneId: v.zoneId, index: v.index, latlng: round6(v.latlng) };
    }
  }
  if (bestVertex !== null) return bestVertex;

  let bestEdge: SnapHit | null = null;
  bestDistance = Infinity;
  for (const e of candidatesPx.edges) {
    const hit = closestPointOnSegmentPx(cursorPx, e.a, e.b);
    if (hit.distance <= thresholdPx && hit.distance < bestDistance) {
      bestDistance = hit.distance;
      bestEdge = {
        kind: 'edge',
        zoneId: e.zoneId,
        index: e.index,
        latlng: round6(alongEdge(e.la, e.lb, hit.t)),
      };
    }
  }
  return bestEdge;
};

/**
 * The candidates of a set of zones, in pixels. The zones being dragged are left out by the caller
 * (`exclude`), as the mockup's `snapPoint` skips them, so a vertex never snaps onto itself.
 */
export const snapCandidates = (
  zones: readonly GeometryZone[],
  projector: Projector,
  exclude: ReadonlySet<string> = new Set(),
): SnapCandidates => {
  const vertices: SnapCandidates['vertices'][number][] = [];
  const edges: SnapCandidates['edges'][number][] = [];
  for (const zone of zones) {
    if (exclude.has(zone.id)) continue;
    const px = zone.points.map(projector);
    zone.points.forEach((latlng, index) => {
      const next = (index + 1) % zone.points.length;
      vertices.push({ zoneId: zone.id, index, px: px[index] as PixelPoint, latlng });
      edges.push({
        zoneId: zone.id,
        index,
        a: px[index] as PixelPoint,
        b: px[next] as PixelPoint,
        la: latlng,
        lb: zone.points[next] as AtmMapLatLng,
      });
    });
  }
  return { vertices, edges };
};

/**
 * The first dot of a shape on screen (`Edit.dc.html` `drawDown` / `nearFirst`: 14 px): a click
 * this near it closes the shape, and «إغلاق الشكل» shows.
 */
export const CLOSE_SHAPE_PX = 14;

/**
 * How near the first dot a click closes the shape — ONE radius for the close and for its hint, so
 * the hint never promises a close the click does not make: the snap threshold while snapping is on
 * and Alt is not held, never under `CLOSE_SHAPE_PX`.
 */
export const closeShapeRadiusPx = (
  snap: { on: boolean; px: number } | undefined,
  altKey: boolean,
): number => Math.max(snap?.on === true && !altKey ? snap.px : 0, CLOSE_SHAPE_PX);

/** Whether a click at `cursorPx` closes the shape (inclusive, as `snapTarget`'s `first`). */
export const closesShape = (
  cursorPx: PixelPoint,
  firstPx: PixelPoint,
  snap: { on: boolean; px: number } | undefined,
  altKey: boolean,
): boolean => projectedDistance(cursorPx, firstPx) <= closeShapeRadiusPx(snap, altKey);

// ── Shared vertices and edges (DM-6) ────────────────────────────────────────────────────────────

/** Every vertex of the draft at this key — the points two neighbours share. */
export const linkedVertices = (
  draft: readonly GeometryZone[],
  key: string,
): { zoneId: string; index: number }[] => {
  const linked: { zoneId: string; index: number }[] = [];
  for (const zone of draft) {
    zone.points.forEach((p, index) => {
      if (coordKey(p) === key) linked.push({ zoneId: zone.id, index });
    });
  }
  return linked;
};

/**
 * Every draft zone that has the edge between these two keys, in either orientation, with the index
 * of that edge's start vertex. A midpoint drag inserts into all of them (the mockup's `mids.down`),
 * which is what keeps a shared border without a gap.
 */
export const zonesWithEdge = (
  draft: readonly GeometryZone[],
  keyA: string,
  keyB: string,
): { zoneId: string; edgeIndex: number }[] => {
  const found: { zoneId: string; edgeIndex: number }[] = [];
  for (const zone of draft) {
    const n = zone.points.length;
    for (let i = 0; i < n; i += 1) {
      const a = coordKey(zone.points[i] as AtmMapLatLng);
      const b = coordKey(zone.points[(i + 1) % n] as AtmMapLatLng);
      if ((a === keyA && b === keyB) || (a === keyB && b === keyA)) {
        found.push({ zoneId: zone.id, edgeIndex: i });
        break;
      }
    }
  }
  return found;
};

/**
 * The zones a drag moves, which therefore never snap (the mockup's `snapPoint(p, dr.links)`): a
 * vertex moves with every zone that shares it (only its own with Alt); a midpoint inserts into
 * every zone that shares its edge (`INSERT_VERTEX`), so all of them move — leaving one of them a
 * candidate would glue the new point back onto that zone's old edge.
 */
export const draggedZoneIds = (
  zones: readonly GeometryZone[],
  drag: { kind: 'vertex' | 'mid'; zoneId: string; index: number; at: AtmMapLatLng },
  unlink: boolean,
): Set<string> => {
  if (drag.kind === 'vertex') {
    return new Set(
      unlink
        ? [drag.zoneId]
        : [drag.zoneId, ...linkedVertices(zones, coordKey(drag.at)).map((v) => v.zoneId)],
    );
  }
  const zone = zones.find((z) => z.id === drag.zoneId);
  const a = zone?.points[drag.index];
  const b = zone?.points[(drag.index + 1) % (zone?.points.length ?? 1)];
  if (a === undefined || b === undefined) return new Set([drag.zoneId]);
  return new Set([
    drag.zoneId,
    ...zonesWithEdge(zones, coordKey(a), coordKey(b)).map((hit) => hit.zoneId),
  ]);
};

/**
 * The ring with `p` inserted after vertex `edgeIndex`. Unchanged (the same array) when a vertex of
 * the ring already lies within 1e-7° of `p` on both axes — a second insert at the same spot would
 * be a duplicate point.
 */
export const insertOnEdge = (
  zone: GeometryZone,
  edgeIndex: number,
  p: AtmMapLatLng,
): readonly AtmMapLatLng[] => {
  const point = round6(p);
  const near = zone.points.some(
    (q) => Math.abs(q.lat - point.lat) <= EPSILON && Math.abs(q.lng - point.lng) <= EPSILON,
  );
  if (near || edgeIndex < 0 || edgeIndex >= zone.points.length) return zone.points;
  return [...zone.points.slice(0, edgeIndex + 1), point, ...zone.points.slice(edgeIndex + 1)];
};

/** The minimum on-screen length of an edge that gets a midpoint handle (the mockup's 40 px). */
export const MIDPOINT_MIN_EDGE_PX = 40;

/** One blue diamond per edge, at the edge's middle as drawn; hidden on edges under 40 px. */
export const midpoints = (
  zone: GeometryZone,
  projector: Projector,
): { edgeIndex: number; latlng: AtmMapLatLng; hidden: boolean }[] => {
  const n = zone.points.length;
  return zone.points.map((a, edgeIndex) => {
    const b = zone.points[(edgeIndex + 1) % n] as AtmMapLatLng;
    const lengthPx = projectedDistance(projector(a), projector(b));
    return {
      edgeIndex,
      latlng: round6(alongEdge(a, b, 0.5)),
      hidden: lengthPx < MIDPOINT_MIN_EDGE_PX,
    };
  });
};

// ── Overlaps (D-M7: allowed, with a warning) ────────────────────────────────────────────────────

/**
 * The zones this one overlaps, with how many of `points` lie inside both. `points` are the machines
 * the caller counts (in edit mode: all the edit branch's active points, §6.4).
 */
export const overlapsOf = (
  zone: GeometryZone,
  others: readonly GeometryZone[],
  points: readonly { lat: number | null; lng: number | null }[] = [],
): { zoneId: string; machinesInBoth: number }[] => {
  const located = points.filter(
    (p): p is { lat: number; lng: number } => p.lat !== null && p.lng !== null,
  );
  const result: { zoneId: string; machinesInBoth: number }[] = [];
  for (const other of others) {
    if (other.id === zone.id) continue;
    if (!polygonsOverlap(zone.points, other.points)) continue;
    const machinesInBoth = located.filter(
      (p) => pointInPolygon(p, zone.points) && pointInPolygon(p, other.points),
    ).length;
    result.push({ zoneId: other.id, machinesInBoth });
  }
  return result;
};

/** The zones whose ring a move left crossing itself — the drag end's check (§8.6). */
export const crossingZones = (zones: readonly GeometryZone[]): string[] =>
  zones.filter((zone) => selfIntersects(zone.points)).map((zone) => zone.id);

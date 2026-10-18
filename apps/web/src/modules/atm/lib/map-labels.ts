// Where a zone's name label sits (docs/12-planning/atm-map-zones.md §8.5, §8.9). Pure and in pixels:
// the canvas projects the zone and the machine dots, and places labels on `moveend`/`zoomend` for
// the zones in the viewport only (§8.4).
//
// The centroid is the obvious spot and often the wrong one: machines cluster in a zone's middle,
// and a pill on top of them hides exactly what the reader looks for. So the label goes where it is
// furthest from the zone's edges while covering the fewest dots — a 9 × 9 sample of the zone's box,
// scored, with the centroid only breaking ties.
import { type PixelPoint } from './map-geometry';

export interface LabelSize {
  width: number;
  height: number;
}

/** Below this on-screen size, or below zoom 9, a zone gets no label. */
export const LABEL_MIN_BOX_PX = 80;
export const LABEL_MIN_ZOOM = 9;
/** A candidate closer than this to an edge is not considered. */
const EDGE_MARGIN_PX = 8;
/** One dot under the label costs as much as 40 px of distance from the edge. */
const PIN_PENALTY = 40;
const GRID = 9;

const insidePx = (p: PixelPoint, ring: readonly PixelPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as PixelPoint;
    const b = ring[j] as PixelPoint;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

const edgeDistance = (p: PixelPoint, ring: readonly PixelPoint[]): number => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as PixelPoint;
    const b = ring[(i + 1) % ring.length] as PixelPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
};

const centroidPx = (ring: readonly PixelPoint[]): PixelPoint => {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j] as PixelPoint;
    const b = ring[i] as PixelPoint;
    const f = a.x * b.y - b.x * a.y;
    area += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  if (area === 0) {
    const sum = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / ring.length, y: sum.y / ring.length };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
};

/**
 * The label's centre for one zone, or null when the zone is too small on screen (its box under
 * 80 px on both sides), the map is zoomed out below 9, or no spot inside it is 8 px from its edges.
 * Score = distance to the nearest edge − 40 × the dots under the label's rectangle.
 */
export const placeLabel = (
  polygonPx: readonly PixelPoint[],
  pinsPx: readonly PixelPoint[],
  labelSizePx: LabelSize,
  zoom: number,
): PixelPoint | null => {
  if (polygonPx.length < 3 || zoom < LABEL_MIN_ZOOM) return null;
  const xs = polygonPx.map((p) => p.x);
  const ys = polygonPx.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const width = maxX - minX;
  const height = maxY - minY;
  if (Math.max(width, height) < LABEL_MIN_BOX_PX) return null;

  const centre = centroidPx(polygonPx);
  const halfW = labelSizePx.width / 2;
  const halfH = labelSizePx.height / 2;
  let best: { p: PixelPoint; score: number; toCentre: number } | null = null;
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const p = { x: minX + ((i + 0.5) * width) / GRID, y: minY + ((j + 0.5) * height) / GRID };
      if (!insidePx(p, polygonPx)) continue;
      const distance = edgeDistance(p, polygonPx);
      if (distance < EDGE_MARGIN_PX) continue;
      const covered = pinsPx.filter(
        (pin) => Math.abs(pin.x - p.x) <= halfW && Math.abs(pin.y - p.y) <= halfH,
      ).length;
      const score = distance - PIN_PENALTY * covered;
      const toCentre = Math.hypot(p.x - centre.x, p.y - centre.y);
      if (
        best === null ||
        score > best.score ||
        (score === best.score && toCentre < best.toCentre)
      ) {
        best = { p, score, toCentre };
      }
    }
  }
  return best?.p ?? null;
};

export interface PlacedLabel {
  zoneId: string;
  /** The label's centre. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Labels in LIST order (the priority, D-M7); of two that overlap, the later one is dropped, so a
 * zone higher in the list keeps its name on the map.
 */
export const resolveCollisions = (labelsInListOrder: readonly PlacedLabel[]): PlacedLabel[] => {
  const kept: PlacedLabel[] = [];
  for (const label of labelsInListOrder) {
    const clashes = kept.some(
      (other) =>
        Math.abs(other.x - label.x) * 2 < other.width + label.width &&
        Math.abs(other.y - label.y) * 2 < other.height + label.height,
    );
    if (!clashes) kept.push(label);
  }
  return kept;
};

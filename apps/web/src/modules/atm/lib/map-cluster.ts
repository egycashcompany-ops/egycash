// Grouping the machine dots (docs/12-planning/atm-map-zones.md DM-26, §8.9): a small in-house grid,
// because no cluster library is installed and the brief prefers small tested code to a dependency.
//
//   · below zoom 15, dots that fall in the same 56 px cell become one cluster bubble; a click
//     zooms to its bounds;
//   · from zoom 15 there is no grid — every machine is its own dot;
//   · machines at the same place (≤ 1 m apart, typically two ATMs in one lobby) are a "stack" at
//     every zoom, because no zoom ever separates them: a click fans them out (`spiderfy`).
//
// Pixels should be Leaflet's WORLD pixels at the current zoom (`map.project`), not container
// pixels, so the cells do not move under the dots while the map is panned.
import { type PixelPoint } from './map-geometry';

export interface ClusterInput {
  id: string;
  lat: number;
  lng: number;
  px: PixelPoint;
}

export interface ClusterGroup<T extends ClusterInput = ClusterInput> {
  kind: 'single' | 'cluster' | 'stack';
  members: T[];
  centerPx: PixelPoint;
}

export const CLUSTER_CELL_PX = 56;
/** From this zoom the grid is off. */
export const CLUSTER_MAX_ZOOM = 15;
/** Two machines this close are at the same place. */
export const STACK_METERS = 1;

const METERS_PER_DEGREE = 111_195;

const metersBetween = (a: ClusterInput, b: ClusterInput): number => {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * METERS_PER_DEGREE, (a.lng - b.lng) * METERS_PER_DEGREE * k);
};

const centreOf = (members: readonly ClusterInput[]): PixelPoint => {
  const sum = members.reduce((acc, m) => ({ x: acc.x + m.px.x, y: acc.y + m.px.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / members.length, y: sum.y / members.length };
};

/**
 * The machines that stand at the same place, by a 1 m hash and a union over neighbouring cells —
 * linear in the number of points, so 2,607 dots cost nothing per zoom.
 */
const stacksOf = <T extends ClusterInput>(points: readonly T[]): T[][] => {
  const cellDeg = STACK_METERS / METERS_PER_DEGREE;
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    parent[i] = root;
    return root;
  };
  const cells = new Map<string, number[]>();
  const cellOf = (p: ClusterInput): [number, number] => [
    Math.floor(p.lat / cellDeg),
    Math.floor(p.lng / cellDeg),
  ];
  points.forEach((p, i) => {
    const [cy, cx] = cellOf(p);
    const key = `${String(cy)}:${String(cx)}`;
    const bucket = cells.get(key);
    if (bucket === undefined) cells.set(key, [i]);
    else bucket.push(i);
  });
  points.forEach((p, i) => {
    const [cy, cx] = cellOf(p);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const j of cells.get(`${String(cy + dy)}:${String(cx + dx)}`) ?? []) {
          if (j <= i) continue;
          if (metersBetween(p, points[j] as T) <= STACK_METERS) parent[find(j)] = find(i);
        }
      }
    }
  });
  const groups = new Map<number, T[]>();
  points.forEach((p, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [p]);
    else group.push(p);
  });
  return [...groups.values()];
};

/** The dots, bubbles and stacks to draw at this zoom. */
export const clusterPoints = <T extends ClusterInput>(
  pointsPx: readonly T[],
  cellPx: number = CLUSTER_CELL_PX,
  zoom: number,
): ClusterGroup<T>[] => {
  const stacks = stacksOf(pointsPx);
  const asGroup = (members: T[]): ClusterGroup<T> => ({
    kind: members.length > 1 ? 'stack' : 'single',
    members,
    centerPx: centreOf(members),
  });
  if (zoom >= CLUSTER_MAX_ZOOM) return stacks.map(asGroup);

  const cells = new Map<string, T[][]>();
  for (const stack of stacks) {
    const at = (stack[0] as T).px;
    const key = `${String(Math.floor(at.x / cellPx))}:${String(Math.floor(at.y / cellPx))}`;
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [stack]);
    else cell.push(stack);
  }
  return [...cells.values()].map((cell) => {
    if (cell.length === 1) return asGroup(cell[0] as T[]);
    const members = cell.flat();
    return { kind: 'cluster', members, centerPx: centreOf(members) };
  });
};

/** A stack fanned out: n positions on a circle of radius 18 + 4n px, starting at the top. */
export const spiderfy = (centerPx: PixelPoint, n: number): PixelPoint[] => {
  const radius = 18 + 4 * n;
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: centerPx.x + radius * Math.cos(angle), y: centerPx.y + radius * Math.sin(angle) };
  });
};

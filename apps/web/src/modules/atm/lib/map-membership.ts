// Live zone counts while a zone is being reshaped (docs/12-planning/atm-map-zones.md §8.4
// "Performance budget"). Pure; the page calls it at most once per animation frame.
//
// A DRAG CHANGES ONLY WHAT IT TOUCHES. A machine can enter or leave a zone only if it lies inside
// that zone's bounding box before the move or after it. So a gesture recomputes the membership of
// the machines inside the touched zones' old and new boxes — against every zone, because a machine
// leaving the first zone in the list may now count for the second (D-M7) — and keeps every other
// machine's answer as it was. A change of the list itself (a zone added, removed or reordered) is
// not a gesture, and recomputes everything.
import {
  NO_MEMBERSHIP,
  boxOf,
  membershipOf,
  zoneMembership,
  type LatLngBox,
  type Membership,
  type MembershipZone,
} from './map-geometry';

export interface MembershipPoint {
  machineId: string;
  branchId: string;
  lat: number | null;
  lng: number | null;
}

const inAnyBox = (lat: number, lng: number, boxes: readonly LatLngBox[]): boolean =>
  boxes.some(
    (box) =>
      lat >= box.south - 1e-6 &&
      lat <= box.north + 1e-6 &&
      lng >= box.west - 1e-6 &&
      lng <= box.east + 1e-6,
  );

/**
 * The membership after some zones changed shape: `changedBoxes` are those zones' bounding boxes
 * before AND after the change. Machines outside all of them keep their previous answer.
 */
export const refreshMembership = (
  previous: ReadonlyMap<string, Membership>,
  points: readonly MembershipPoint[],
  zones: readonly MembershipZone[],
  changedBoxes: readonly LatLngBox[],
): Map<string, Membership> => {
  const next = new Map(previous);
  for (const p of points) {
    if (p.lat === null || p.lng === null) {
      next.set(p.machineId, NO_MEMBERSHIP);
      continue;
    }
    if (!previous.has(p.machineId) || inAnyBox(p.lat, p.lng, changedBoxes)) {
      next.set(
        p.machineId,
        zoneMembership({ lat: p.lat, lng: p.lng, branchId: p.branchId }, zones),
      );
    }
  }
  return next;
};

/** Whether two lists are the same zones in the same order — a reshape, not a list change. */
export const sameZoneList = (a: readonly { id: string }[], b: readonly { id: string }[]): boolean =>
  a.length === b.length && a.every((zone, i) => zone.id === b[i]?.id);

/**
 * The boxes a reshape touched: for every zone whose ring is not the same array as before, its box
 * before and its box after. Rings are compared by reference — the editor replaces the ring of a
 * zone it changes and keeps every other ring as it was.
 */
export const changedZoneBoxes = (
  before: readonly { id: string; points: readonly { lat: number; lng: number }[] }[],
  after: readonly { id: string; points: readonly { lat: number; lng: number }[] }[],
): LatLngBox[] => {
  const old = new Map(before.map((zone) => [zone.id, zone.points]));
  const boxes: LatLngBox[] = [];
  for (const zone of after) {
    const ring = old.get(zone.id);
    if (ring === zone.points) continue;
    if (ring !== undefined && ring.length > 0) boxes.push(boxOf(ring));
    if (zone.points.length > 0) boxes.push(boxOf(zone.points));
  }
  return boxes;
};

/**
 * The next membership: incremental when only shapes changed since `previous` was computed against
 * `previousZones`, otherwise a full recompute.
 */
export const nextMembership = (
  previous: {
    zones: readonly MembershipZone[];
    points: readonly MembershipPoint[];
    result: ReadonlyMap<string, Membership>;
  } | null,
  points: readonly MembershipPoint[],
  zones: readonly MembershipZone[],
): Map<string, Membership> => {
  if (previous === null || previous.points !== points || !sameZoneList(previous.zones, zones)) {
    return membershipOf(points, zones);
  }
  const boxes = changedZoneBoxes(previous.zones, zones);
  if (boxes.length === 0) return new Map(previous.result);
  return refreshMembership(previous.result, points, zones, boxes);
};

/** How many machines count for each zone (their primary zone, D-M7). */
export const primaryCounts = (
  membership: ReadonlyMap<string, Membership>,
  machineIds?: Iterable<string>,
): Map<string, number> => {
  const counts = new Map<string, number>();
  const ids = machineIds ?? membership.keys();
  for (const id of ids) {
    const primary = membership.get(id)?.primary ?? null;
    if (primary !== null) counts.set(primary, (counts.get(primary) ?? 0) + 1);
  }
  return counts;
};

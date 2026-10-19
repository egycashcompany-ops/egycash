// Live counts while a zone is reshaped (§8.4): recomputing only the machines a drag can reach gives
// exactly the answer a full recompute gives, and a list change recomputes everything.
import { describe, expect, it } from 'vitest';
import { membershipOf, membershipZones } from './map-geometry';
import {
  changedZoneBoxes,
  nextMembership,
  primaryCounts,
  refreshMembership,
  sameZoneList,
  type MembershipPoint,
} from './map-membership';

const B = 'branch-a';
const square = (lat: number, lng: number, size: number) => [
  { lat, lng },
  { lat, lng: lng + size },
  { lat: lat + size, lng: lng + size },
  { lat: lat + size, lng },
];

/** A 10 × 10 grid of machines over 30.00–30.09 / 31.00–31.09. */
const points: MembershipPoint[] = Array.from({ length: 100 }, (_, i) => ({
  machineId: `m${String(i)}`,
  branchId: B,
  lat: 30 + Math.floor(i / 10) * 0.01 + 0.005,
  lng: 31 + (i % 10) * 0.01 + 0.005,
}));

describe('nextMembership', () => {
  const before = membershipZones([
    { id: 'a', branchId: B, points: square(30, 31, 0.03) },
    { id: 'b', branchId: B, points: square(30.05, 31.05, 0.03) },
  ]);
  const first = membershipOf(points, before);

  it('a reshape recomputes only the reachable machines — and agrees with a full recompute', () => {
    const grown = square(30, 31, 0.06);
    const after = [{ ...before[0]!, points: grown, box: before[0]!.box }, before[1]!];
    const live = nextMembership(
      { zones: before, points, result: first },
      points,
      membershipZones(after),
    );
    expect(live).toEqual(membershipOf(points, membershipZones(after)));
    expect(primaryCounts(live).get('a')).toBe(36);
  });

  it('keeps the previous answer of a machine no changed box reaches', () => {
    const stale = new Map(first);
    stale.set('m99', { primary: 'sentinel', all: ['sentinel'] });
    const boxes = changedZoneBoxes(before, [
      { ...before[0]!, points: square(30, 31, 0.02) },
      before[1]!,
    ]);
    const refreshed = refreshMembership(stale, points, before, boxes);
    // m99 sits at the far corner: outside both of a's boxes, so it is not recomputed.
    expect(refreshed.get('m99')?.primary).toBe('sentinel');
  });

  it('a change of the list (a zone added, removed or moved) recomputes everything', () => {
    const reordered = [before[1]!, before[0]!];
    expect(sameZoneList(before, reordered)).toBe(false);
    const result = nextMembership({ zones: before, points, result: new Map() }, points, reordered);
    expect(result).toEqual(membershipOf(points, reordered));
  });

  it('no previous answer is a full recompute', () => {
    expect(nextMembership(null, points, before)).toEqual(first);
  });
});

describe('primaryCounts', () => {
  it('counts each machine once, for its first zone, and only the machines asked', () => {
    const overlapping = membershipZones([
      { id: 'top', branchId: B, points: square(30, 31, 0.05) },
      { id: 'under', branchId: B, points: square(30, 31, 0.1) },
    ]);
    const membership = membershipOf(points, overlapping);
    const counts = primaryCounts(membership);
    expect(counts.get('top')).toBe(25);
    expect(counts.get('under')).toBe(75);
    expect(primaryCounts(membership, ['m0', 'm99']).get('under')).toBe(1);
  });
});

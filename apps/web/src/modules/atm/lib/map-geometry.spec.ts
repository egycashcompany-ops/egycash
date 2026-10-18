// The editor's geometry (spec §9.4): membership by list order and branch, snapping by pixels with an
// inclusive threshold, shared vertices and edges by their six-decimal key, midpoints, the crossing
// test while drawing, rounding on the way into the draft, and the full-recompute budget.
import { describe, expect, it } from 'vitest';
import { type AtmMapZoneSetDto } from '@ecms/contracts';
import {
  CLOSE_SHAPE_PX,
  closeShapeRadiusPx,
  closesShape,
  coordKey,
  draggedZoneIds,
  fitDotsOf,
  insertOnEdge,
  linkedVertices,
  membershipOf,
  membershipZones,
  midpoints,
  overlapsOf,
  round6,
  snapCandidates,
  snapTarget,
  wouldCrossWhileDrawing,
  zoneMembership,
  zonesWithEdge,
  type Projector,
  type SnapCandidates,
} from './map-geometry';
import { initialZoneEditorState, zoneEditorReducer, type ZoneEditorState } from './zone-editor';

const BRANCH = 'b1';

/** A square of side `size`° with its south-west corner at (lat, lng), counter-clockwise. */
const square = (lat: number, lng: number, size: number) => [
  { lat, lng },
  { lat, lng: lng + size },
  { lat: lat + size, lng: lng + size },
  { lat: lat + size, lng },
];

/** A projector that maps one 1e-4° step to one pixel — enough for pixel-threshold tests. */
const px: Projector = (p) => ({ x: p.lng * 10_000, y: -p.lat * 10_000 });

describe('zoneMembership', () => {
  const zones = membershipZones([
    { id: 'other-branch', branchId: 'b2', points: square(30, 31, 0.1) },
    { id: 'first', branchId: BRANCH, points: square(30, 31, 0.1) },
    { id: 'second', branchId: BRANCH, points: square(30.02, 31.02, 0.1) },
  ]);

  it('counts the machine for the first zone in list order (D-M7)', () => {
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

  it('a point outside every zone, and a machine without a point, belong to none', () => {
    const all = membershipOf(
      [
        { machineId: 'm1', branchId: BRANCH, lat: 29, lng: 31 },
        { machineId: 'm2', branchId: BRANCH, lat: null, lng: null },
      ],
      zones,
    );
    expect(all.get('m1')).toEqual({ primary: null, all: [] });
    expect(all.get('m2')).toEqual({ primary: null, all: [] });
  });
});

describe('snapTarget', () => {
  const vertex = { lat: 30, lng: 31 };
  const candidates = (extra: Partial<SnapCandidates> = {}): SnapCandidates => ({
    vertices: [{ zoneId: 'z', index: 0, px: px(vertex), latlng: vertex }],
    edges: [
      {
        zoneId: 'z',
        index: 0,
        a: px(vertex),
        b: px({ lat: 30, lng: 31.1 }),
        la: vertex,
        lb: { lat: 30, lng: 31.1 },
      },
    ],
    ...extra,
  });

  it('a vertex inside the threshold beats an edge that is nearer', () => {
    // 5 px from the vertex along the edge: the edge is at 0 px, the vertex at 5 px.
    const cursor = { x: px(vertex).x + 5, y: px(vertex).y };
    expect(snapTarget(cursor, candidates(), 12)).toMatchObject({ kind: 'vertex', index: 0 });
  });

  it('an edge is taken when no vertex is in reach, on the edge as drawn', () => {
    const cursor = { x: px(vertex).x + 500, y: px(vertex).y - 3 };
    const hit = snapTarget(cursor, candidates(), 12);
    expect(hit).toMatchObject({ kind: 'edge', zoneId: 'z', index: 0 });
    expect(hit?.latlng.lat).toBeCloseTo(30, 6);
    expect(hit?.latlng.lng).toBeCloseTo(31.05, 6);
  });

  it('nothing outside the threshold; the boundary is inclusive (12 in, 12.01 out)', () => {
    const at = (dy: number) => ({ x: px(vertex).x - 500, y: px(vertex).y - dy });
    const only = candidates({ edges: [] });
    const vertexAt = (d: number) => snapTarget({ x: px(vertex).x, y: px(vertex).y - d }, only, 12);
    expect(vertexAt(12)).not.toBeNull();
    expect(vertexAt(12.01)).toBeNull();
    // Far from the edge's span as well: nothing at all.
    expect(snapTarget(at(40), candidates(), 12)).toBeNull();
  });

  it('the first dot while drawing closes the shape, ahead of any vertex', () => {
    const first = { lat: 30.0001, lng: 31 };
    const hit = snapTarget(px(first), candidates({ first: { px: px(first), latlng: first } }), 12);
    expect(hit).toEqual({ kind: 'first', zoneId: null, index: 0, latlng: first });
  });
});

describe('shared vertices and edges', () => {
  const a = { id: 'a', points: [...square(30, 31, 0.1)] };
  const b = {
    id: 'b',
    // Shares a's east edge, written in the other orientation, with float noise below 1e-6.
    points: [
      { lat: 30.1000000004, lng: 31.1 },
      { lat: 30, lng: 31.1000000002 },
      { lat: 30, lng: 31.2 },
      { lat: 30.1, lng: 31.2 },
    ],
  };

  it('linkedVertices finds equal six-decimal keys only', () => {
    expect(linkedVertices([a, b], coordKey({ lat: 30, lng: 31.1 }))).toEqual([
      { zoneId: 'a', index: 1 },
      { zoneId: 'b', index: 1 },
    ]);
    // 1e-6 apart is a different point.
    expect(linkedVertices([a, b], coordKey({ lat: 30.000001, lng: 31.1 }))).toEqual([]);
  });

  it('zonesWithEdge finds the edge in either orientation', () => {
    const keyA = coordKey({ lat: 30, lng: 31.1 });
    const keyB = coordKey({ lat: 30.1, lng: 31.1 });
    expect(zonesWithEdge([a, b], keyA, keyB)).toEqual([
      { zoneId: 'a', edgeIndex: 1 },
      { zoneId: 'b', edgeIndex: 0 },
    ]);
    expect(zonesWithEdge([a, b], keyB, keyA)).toHaveLength(2);
  });

  it('insertOnEdge inserts after the edge start, and skips a near-duplicate', () => {
    const mid = { lat: 30.05, lng: 31.1 };
    const ring = insertOnEdge(a, 1, mid);
    expect(ring).toHaveLength(5);
    expect(ring[2]).toEqual(mid);
    const again = { id: 'a', points: [...ring] };
    expect(insertOnEdge(again, 1, { lat: 30.05000005, lng: 31.1 })).toBe(again.points);
  });

  it('midpoints sit on each edge as drawn and hide edges shorter than 40 px', () => {
    const zone = {
      id: 'z',
      points: [
        { lat: 30, lng: 31 },
        { lat: 30, lng: 31.01 }, // 100 px
        { lat: 30.003, lng: 31.01 }, // 30 px
      ],
    };
    const handles = midpoints(zone, px);
    expect(handles.map((h) => h.hidden)).toEqual([false, true, false]);
    expect(handles[0]?.latlng).toEqual({ lat: 30, lng: 31.005 });
  });

  it('overlapsOf counts the machines inside both zones', () => {
    const other = { id: 'o', points: square(30.05, 31.05, 0.1) };
    expect(
      overlapsOf(
        a,
        [a, other],
        [
          { lat: 30.07, lng: 31.07 },
          { lat: 30.02, lng: 31.02 },
          { lat: null, lng: null },
        ],
      ),
    ).toEqual([{ zoneId: 'o', machinesInBoth: 1 }]);
    // Neighbours sharing a border do not overlap.
    expect(overlapsOf(a, [b])).toEqual([]);
  });
});

describe('wouldCrossWhileDrawing', () => {
  it('refuses the fourth dot of a bow-tie', () => {
    const path = [
      { lat: 30, lng: 31 },
      { lat: 30.01, lng: 31.01 },
      { lat: 30, lng: 31.01 },
    ];
    expect(wouldCrossWhileDrawing(path, { lat: 30.01, lng: 31 })).toBe(true);
    expect(wouldCrossWhileDrawing(path, { lat: 29.99, lng: 31.005 })).toBe(false);
  });

  it('refuses a back-track along the last edge', () => {
    const path = [
      { lat: 30, lng: 31 },
      { lat: 30, lng: 31.02 },
    ];
    expect(wouldCrossWhileDrawing(path, { lat: 30, lng: 31.01 })).toBe(true);
    // Carrying on in the same direction is not a back-track.
    expect(wouldCrossWhileDrawing(path, { lat: 30, lng: 31.03 })).toBe(false);
  });

  it('refuses a dot on an earlier dot or edge (a pinch)', () => {
    const path = [
      { lat: 30, lng: 31 },
      { lat: 30, lng: 31.02 },
      { lat: 30.02, lng: 31.02 },
      { lat: 30.02, lng: 31 },
    ];
    expect(wouldCrossWhileDrawing(path, { lat: 30, lng: 31.01 })).toBe(true);
    expect(wouldCrossWhileDrawing(path, { lat: 30.01, lng: 31.01 })).toBe(false);
  });
});

describe('round6 on the way into the draft (DM-48)', () => {
  const set: AtmMapZoneSetDto = {
    branchId: BRANCH,
    revision: 1,
    zones: [
      {
        id: '6650a1b2c3d4e5f601234567',
        branchId: BRANCH,
        name: 'قطاع 1',
        color: '#483bba',
        order: 0,
        points: square(30, 31, 0.01),
        updatedAt: '2026-10-18T00:00:00.000Z',
      },
    ],
  };
  const raw = { lat: 30.123456789, lng: 31.987654321 };
  const rounded = { lat: 30.123457, lng: 31.987654 };
  const editing = (): ZoneEditorState =>
    zoneEditorReducer(initialZoneEditorState, { type: 'ENTER_EDIT', set });

  it('round6 rounds both axes to six decimals', () => {
    expect(round6(raw)).toEqual(rounded);
  });

  it('every point the reducer accepts is rounded: added, moved, inserted, restored', () => {
    const zoneId = set.zones[0]?.id ?? '';
    let state = zoneEditorReducer(editing(), { type: 'START_DRAW', color: '#d3a813' });
    state = zoneEditorReducer(state, { type: 'ADD_POINT', point: raw });
    expect(state.drawing?.points).toEqual([rounded]);

    state = zoneEditorReducer(editing(), {
      type: 'MOVE_VERTEX',
      zoneId,
      index: 2,
      point: { lat: 30.0200000049, lng: 31.0199999951 },
      unlink: false,
    });
    expect(state.draft[0]?.points[2]).toEqual({ lat: 30.02, lng: 31.02 });

    state = zoneEditorReducer(editing(), {
      type: 'INSERT_VERTEX',
      zoneId,
      edgeIndex: 0,
      point: { lat: 29.9999999, lng: 31.0050000004 },
    });
    expect(state.draft[0]?.points[1]).toEqual({ lat: 30, lng: 31.005 });

    state = zoneEditorReducer(editing(), {
      type: 'RESTORE_DRAFT',
      zones: [{ id: zoneId, name: 'قطاع 1', color: '#483BBA', points: [raw, raw, raw] }],
    });
    expect(state.draft[0]?.points).toEqual([rounded, rounded, rounded]);
    expect(state.draft[0]?.color).toBe('#483bba');
  });
});

describe('performance (§8.4 budget)', () => {
  it('membership for 2,607 points × 200 zones of 50 vertices stays under 200 ms', () => {
    // 200 fifty-sided zones on a 20 × 10 grid, each a circle of 0.02° in a 0.05° cell.
    const zones = membershipZones(
      Array.from({ length: 200 }, (_, z) => {
        const lat = 30 + Math.floor(z / 20) * 0.05;
        const lng = 31 + (z % 20) * 0.05;
        return {
          id: `z${String(z)}`,
          branchId: BRANCH,
          points: Array.from({ length: 50 }, (_, i) =>
            round6({
              lat: lat + 0.02 * Math.sin((2 * Math.PI * i) / 50),
              lng: lng + 0.02 * Math.cos((2 * Math.PI * i) / 50),
            }),
          ),
        };
      }),
    );
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const points = Array.from({ length: 2607 }, (_, i) => ({
      machineId: `m${String(i)}`,
      branchId: BRANCH,
      lat: 29.98 + random() * 0.52,
      lng: 30.98 + random() * 1.02,
    }));

    const started = performance.now();
    const result = membershipOf(points, zones);
    const elapsed = performance.now() - started;

    expect(result.size).toBe(2607);
    expect([...result.values()].some((m) => m.primary !== null)).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('draggedZoneIds — the zones a drag leaves out of snapping', () => {
  // A and B share the edge lng = 31.001 (1 px = 1e-5° below); C only touches B's far corner.
  const A = { id: 'A', points: square(30, 31, 0.001) };
  const B = { id: 'B', points: square(30, 31.001, 0.001) };
  const C = { id: 'C', points: square(30.001, 31.002, 0.001) };
  const zones = [A, B, C];
  const px1: Projector = (p) => ({ x: p.lng * 100_000, y: -p.lat * 100_000 });

  it('a midpoint drag on a shared edge leaves out every zone that shares the edge', () => {
    // A's edge 1 runs (30, 31.001) → (30.001, 31.001): B has it too.
    const at = { lat: 30.0005, lng: 31.001 };
    const moving = draggedZoneIds(zones, { kind: 'mid', zoneId: 'A', index: 1, at }, false);
    expect([...moving].sort()).toEqual(['A', 'B']);
    // Nothing is left to glue the new point back onto B's old edge a few pixels away.
    const candidates = snapCandidates(zones, px1, moving);
    const nudged = px1({ lat: 30.0005, lng: 31.00106 });
    expect(snapTarget(nudged, candidates, 12)).toBeNull();
    // Leaving out the dragged zone alone would snap the 6 px nudge back onto B's edge.
    const ownOnly = snapCandidates(zones, px1, new Set(['A']));
    expect(snapTarget(nudged, ownOnly, 12)).toMatchObject({ kind: 'edge', zoneId: 'B' });
  });

  it('a midpoint on an edge nobody shares leaves out its own zone only', () => {
    const at = { lat: 30, lng: 31.0005 };
    expect([...draggedZoneIds(zones, { kind: 'mid', zoneId: 'A', index: 0, at }, false)]).toEqual([
      'A',
    ]);
  });

  it('a vertex leaves out the zones that share it, or its own zone alone with Alt', () => {
    const at = { lat: 30.001, lng: 31.002 };
    const vertex = { kind: 'vertex' as const, zoneId: 'B', index: 2, at };
    expect([...draggedZoneIds(zones, vertex, false)].sort()).toEqual(['B', 'C']);
    expect([...draggedZoneIds(zones, vertex, true)]).toEqual(['B']);
  });
});

describe('closeShapeRadiusPx — one radius for «إغلاق الشكل» and for the close', () => {
  it('is never under the first dot’s 14 px, and follows a larger snap threshold', () => {
    expect(CLOSE_SHAPE_PX).toBe(14);
    expect(closeShapeRadiusPx({ on: false, px: 12 }, false)).toBe(14);
    expect(closeShapeRadiusPx({ on: true, px: 12 }, false)).toBe(14);
    expect(closeShapeRadiusPx({ on: true, px: 4 }, false)).toBe(14);
    expect(closeShapeRadiusPx({ on: true, px: 30 }, false)).toBe(30);
    expect(closeShapeRadiusPx({ on: true, px: 30 }, true)).toBe(14);
    expect(closeShapeRadiusPx(undefined, false)).toBe(14);
  });

  it('a click under the hint closes the shape, with or without snapping', () => {
    const first = { x: 100, y: 100 };
    for (const snap of [
      { on: false, px: 12 },
      { on: true, px: 12 },
    ]) {
      expect(closesShape({ x: 113, y: 100 }, first, snap, false)).toBe(true);
      expect(closesShape({ x: 113, y: 100 }, first, snap, true)).toBe(true);
      expect(closesShape({ x: 15 + 100, y: 100 }, first, snap, false)).toBe(false);
    }
    expect(closesShape({ x: 128, y: 100 }, first, { on: true, px: 30 }, false)).toBe(true);
    // The snap path agrees: `first` wins within the same radius.
    const hit = snapTarget(
      { x: 128, y: 100 },
      { vertices: [], edges: [], first: { px: first, latlng: { lat: 30, lng: 31 } } },
      closeShapeRadiusPx({ on: true, px: 30 }, false),
    );
    expect(hit?.kind).toBe('first');
  });
});

describe('fitDotsOf — what the default view fits (§8.4)', () => {
  it('leaves a point outside Egypt out of the fit, unless every point is outside', () => {
    const cairo = { lat: 30.04, lng: 31.24 };
    const alex = { lat: 31.2, lng: 29.9 };
    const typo = { lat: -12.5, lng: 31.24 }; // a mistyped Plus Code, south of the equator
    expect(fitDotsOf([cairo, typo, alex])).toEqual([cairo, alex]);
    expect(fitDotsOf([typo])).toEqual([typo]);
    expect(fitDotsOf([])).toEqual([]);
  });
});

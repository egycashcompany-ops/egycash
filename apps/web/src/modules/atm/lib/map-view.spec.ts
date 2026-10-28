// What the panels say (§6.4, §8.8): a zone's breakdown, the save summary, the search, the move
// distance. Every machine below is synthetic.
import { describe, expect, it } from 'vitest';
import { type AtmMapPointDto } from '@ecms/contracts';
import { membershipOf, membershipZones } from './map-geometry';
import {
  areasOf,
  findMachine,
  haversineMeters,
  kilometresText,
  mapFitKey,
  saveSummary,
  zoneBreakdown,
  zoneEditableFromDetail,
} from './map-view';
import { type DraftZone } from './zone-editor';

const B = 'branch-a';
const point = (n: number, over: Partial<AtmMapPointDto> = {}): AtmMapPointDto => ({
  machineId: `m${String(n)}`,
  code: String(1000 + n),
  name: `ماكينة تجريبية ${String(n)}`,
  branchId: B,
  area: `منطقة تجريبية ${String(1 + (n % 2))}`,
  bankName: 'SYN',
  bankCode: n % 3 === 0 ? null : 'NBE',
  active: true,
  lat: 30 + n * 0.001,
  lng: 31 + n * 0.001,
  state: 'located',
  source: 'registerUrl',
  reason: null,
  warnings: [],
  lastSet: null,
  ...over,
});
const square = (lat: number, lng: number, size: number) => [
  { lat, lng },
  { lat, lng: lng + size },
  { lat: lat + size, lng: lng + size },
  { lat: lat + size, lng },
];
const zone = (id: string, points: { lat: number; lng: number }[], name = id): DraftZone => ({
  id,
  name,
  color: '#483bba',
  points,
});

describe('zoneBreakdown', () => {
  const points = Array.from({ length: 10 }, (_, i) => point(i + 1));
  const membership = membershipOf(
    points,
    membershipZones([{ id: 'z', branchId: B, points: square(30, 31, 0.0055) }]),
  );

  it('counts the zone by bank, by area and lists its machines by code', () => {
    const detail = zoneBreakdown('z', points, membership);
    expect(detail.count).toBe(5);
    expect(detail.machines.map((m) => m.code)).toEqual(['1001', '1002', '1003', '1004', '1005']);
    expect(detail.banks).toEqual([
      { code: 'NBE', count: 4, pct: 80 },
      { code: null, count: 1, pct: 20 },
    ]);
    expect(detail.areas.map((a) => [a.name, a.count])).toEqual([
      ['منطقة تجريبية 2', 3],
      ['منطقة تجريبية 1', 2],
    ]);
  });

  // DEC-35: the rows follow the catalog's order, and a bank the order does not name still counts.
  it('orders the banks by the catalog, and never drops one it does not list', () => {
    const mixed = [
      point(1, { bankCode: 'QNB' }),
      point(2, { bankCode: 'NBE' }),
      point(4, { bankCode: 'AAIB' }),
      point(5, { bankCode: 'CIB' }),
      point(3, { bankCode: null }),
    ];
    const zoned = membershipOf(
      mixed,
      membershipZones([{ id: 'z', branchId: B, points: square(30, 31, 0.0055) }]),
    );
    const codes = (order?: readonly string[]) =>
      zoneBreakdown('z', mixed, zoned, order).banks.map((b) => b.code);
    // The catalog puts its seventh bank first; AAIB is not in it, so it follows, then «غير محدد».
    expect(codes(['QNB', 'NBE', 'BM', 'CIB'])).toEqual(['QNB', 'NBE', 'CIB', 'AAIB', null]);
    // Without an order: the six seeds, then the rest sorted.
    expect(codes()).toEqual(['NBE', 'CIB', 'AAIB', 'QNB', null]);
    const total = zoneBreakdown('z', mixed, zoned).banks.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(mixed.length);
  });
});

describe('saveSummary', () => {
  const points = Array.from({ length: 10 }, (_, i) => point(i + 1));
  const ids = points.map((p) => p.machineId);
  const base = [zone('a', square(30, 31, 0.0035)), zone('b', square(30.0055, 31.0055, 0.006))];
  const draft = [
    { ...base[0]!, name: 'renamed' },
    zone('new-1', square(30.0035, 31.0035, 0.002), 'قطاع 3'),
  ];
  const membership = (zones: DraftZone[]) =>
    membershipOf(points, membershipZones(zones.map((z) => ({ ...z, branchId: B }))));
  const summary = saveSummary(base, draft, ids, membership(base), membership(draft));

  it('counts the new, changed and deleted zones', () => {
    expect([summary.created, summary.updated, summary.deleted]).toEqual([1, 1, 1]);
  });

  it('lists every base zone in its order, then the new ones, with before and after', () => {
    expect(summary.rows).toEqual([
      { id: 'a', name: 'renamed', color: '#483bba', before: 3, after: 3 },
      { id: 'b', name: 'b', color: '#483bba', before: 5, after: null },
      { id: 'new-1', name: 'قطاع 3', color: '#483bba', before: null, after: 2 },
    ]);
  });

  it('counts the machines that lose their zone', () => {
    // b held m6…m10 and is deleted; the new zone takes m4 and m5, which had no zone before.
    expect(summary.orphaned).toBe(5);
  });
});

describe('findMachine', () => {
  const points = [point(1), point(12), point(123, { name: 'فرع الإسكندرية' })];

  it('an exact code first, then a code that starts so, then a name', () => {
    expect(findMachine(points, '1012')?.machineId).toBe('m12');
    expect(findMachine(points, '11')?.machineId).toBe('m123');
    expect(findMachine(points, 'الاسكندرية')?.machineId).toBe('m123');
    expect(findMachine(points, '  ')).toBeNull();
    expect(findMachine(points, '9999')).toBeNull();
  });
});

describe('distance, areas, edit button', () => {
  it('measures a move in metres and words it in kilometres', () => {
    const meters = haversineMeters({ lat: 30, lng: 31 }, { lat: 30.01, lng: 31 });
    expect(meters).toBeGreaterThan(1100);
    expect(meters).toBeLessThan(1120);
    expect(kilometresText(meters, 'en')).toBe('1.1');
    // In the Arabic UI the figure is in the page's own digits (DM-21), never «8939.2».
    expect(kilometresText(meters, 'ar')).toBe('١٫١');
    expect(kilometresText(8_939_200, 'ar')).toBe('٨٬٩٣٩٫٢');
  });

  it('offers each area once, sorted', () => {
    expect(areasOf([point(1), point(2), point(3), point(4, { area: ' ' })])).toEqual([
      'منطقة تجريبية 1',
      'منطقة تجريبية 2',
    ]);
  });

  it('offers «تعديل» only on a zone of the edit branch, to an editor', () => {
    expect(zoneEditableFromDetail('a', 'a', true)).toBe(true);
    expect(zoneEditableFromDetail('b', 'a', true)).toBe(false);
    expect(zoneEditableFromDetail('a', null, true)).toBe(false);
    expect(zoneEditableFromDetail('a', 'a', false)).toBe(false);
  });
});

describe('mapFitKey — when the map fits itself (§8.4 default view)', () => {
  const view = {
    editing: false,
    viewBranch: 'b1',
    editBranch: null,
    status: 'active',
    viewReady: true,
    editReady: false,
  };

  it('waits for the data, then fits once per branch and status', () => {
    expect(mapFitKey({ ...view, viewReady: false })).toBeNull();
    expect(mapFitKey(view)).toBe('b1|active');
    expect(mapFitKey({ ...view, viewBranch: 'b2' })).not.toBe(mapFitKey(view));
    expect(mapFitKey({ ...view, status: 'all' })).not.toBe(mapFitKey(view));
  });

  it('entering and leaving edit mode on the same branch keeps the key — and the place', () => {
    const editing = { ...view, editing: true, editBranch: 'b1', editReady: true };
    expect(mapFitKey(editing)).toBe(mapFitKey(view));
    // The edit branch's points still loading fit nothing (no refit, no early fit).
    expect(mapFitKey({ ...editing, editReady: false })).toBeNull();
    // From «كل الفروع», editing one branch is a new view of that branch.
    expect(mapFitKey({ ...editing, viewBranch: 'all' })).toBe('b1|active');
    expect(mapFitKey({ ...view, viewBranch: 'all' })).toBe('all|active');
  });
});

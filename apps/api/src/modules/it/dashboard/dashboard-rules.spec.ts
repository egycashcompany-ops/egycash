// The dashboard's rules, pinned on the rules themselves — «يظهر إجمالى الأصول وإيه فى المخزن وإيه
// متسلم بس أقدر أفلتر بـالفئة.. من خلال Drop Down بـ Multiselection».
//
// What is pinned: what each filter means over the assets; how one `$group` answer becomes the five
// figures (the total being every state, the disposed included); the by-category / by-branch rows
// largest first in a stable order; and how a history entry becomes a line of «آخر الحركات» — who
// it names, which branches, the registrations beside the entries, newest first, cut at eight.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { IT_DASHBOARD_ACTIVITY_KINDS, ItDashboardQuerySchema } from '@ecms/contracts';
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_LIMIT,
  countsByBranch,
  countsByCategory,
  dashboardAssetFilter,
  latestMovements,
  movementOfEvent,
  movementOfRegistration,
  statusCounts,
  toActivityItem,
  type ItDashboardMovement,
} from './dashboard-rules';

const id = (): Types.ObjectId => new Types.ObjectId();

describe('the filters over the assets', () => {
  const LAPTOPS = String(id());
  const SCREENS = String(id());
  const BRANCH = String(id());
  /** The query as the address bar sends it, read the way the route reads it. */
  const fromWire = (raw: Record<string, string>) =>
    dashboardAssetFilter(ItDashboardQuerySchema.parse(raw));

  it('asks nothing when no filter is set — every asset the reader may see', () => {
    expect(fromWire({})).toEqual({});
    // An emptied category list is no category at all.
    expect(fromWire({ categoryId: '' })).toEqual({});
  });

  it('matches an asset in ANY of the chosen categories, in the chosen branch', () => {
    expect(fromWire({ categoryId: `${LAPTOPS},${SCREENS}`, branchId: BRANCH })).toEqual({
      categoryId: { $in: [new Types.ObjectId(LAPTOPS), new Types.ObjectId(SCREENS)] },
      branchId: new Types.ObjectId(BRANCH),
    });
    expect(fromWire({ categoryId: LAPTOPS })).toEqual({
      categoryId: { $in: [new Types.ObjectId(LAPTOPS)] },
    });
  });

  it('refuses a malformed id, or any key it does not know, at the edge', () => {
    expect(() => ItDashboardQuerySchema.parse({ categoryId: `${LAPTOPS},nope` })).toThrow();
    expect(() => ItDashboardQuerySchema.parse({ branchId: 'nope' })).toThrow();
    expect(() => ItDashboardQuerySchema.parse({ status: 'inStock' })).toThrow();
  });
});

describe('the figures', () => {
  it('names the four states and totals them — the disposed included, so the shares add up', () => {
    expect(statusCounts({ inStock: 82, assigned: 80, underMaintenance: 3, disposed: 1 })).toEqual({
      inStock: 82,
      assigned: 80,
      underMaintenance: 3,
      disposed: 1,
      total: 166,
    });
  });

  it('counts a state nobody is in as zero', () => {
    expect(statusCounts({})).toEqual({
      inStock: 0,
      assigned: 0,
      underMaintenance: 0,
      disposed: 0,
      total: 0,
    });
    expect(statusCounts({ assigned: 2 }).total).toBe(2);
  });

  it('lists the categories and the branches largest first, a tie in a stable order', () => {
    const [a, b, c] = [
      '000000000000000000000a01',
      '000000000000000000000a02',
      '000000000000000000000a03',
    ];
    const grouped = {
      [b as string]: { inStock: 1, assigned: 1 },
      [c as string]: { inStock: 9, disposed: 1 },
      [a as string]: { underMaintenance: 2 },
    };
    expect(countsByCategory(grouped).map((row) => [row.categoryId, row.total])).toEqual([
      [c, 10],
      [a, 2],
      [b, 2],
    ]);
    const branches = countsByBranch(grouped);
    expect(branches.map((row) => row.branchId)).toEqual([c, a, b]);
    expect(branches[0]).toEqual({
      branchId: c,
      inStock: 9,
      assigned: 0,
      underMaintenance: 0,
      disposed: 1,
      total: 10,
    });
    expect(countsByCategory({})).toEqual([]);
  });
});

describe('a line of «آخر الحركات»', () => {
  const ASSET = id();
  const HOLDER = String(id());
  const NEXT_HOLDER = String(id());
  const TANTA = String(id());
  const MOHANDESSIN = String(id());
  const at = new Date('2026-11-02T08:30:00.000Z');
  const entry = (type: string, metadata: Record<string, unknown>) => ({
    _id: id(),
    type: type as never,
    at,
    subjectId: ASSET,
    metadata,
  });

  it('reads every kind but the registration from the history — a registration writes none (FR-5)', () => {
    expect(ACTIVITY_EVENT_TYPES).toEqual(
      IT_DASHBOARD_ACTIVITY_KINDS.filter((kind) => kind !== 'registered'),
    );
    expect(ACTIVITY_EVENT_TYPES).not.toContain('registered');
    expect(ACTIVITY_LIMIT).toBe(8);
  });

  it('names whom it was handed to, and whom it came back from', () => {
    const handed = entry('assigned', { employeeId: HOLDER, assignmentId: String(id()) });
    expect(movementOfEvent(handed)).toEqual({
      id: String(handed._id),
      kind: 'assigned',
      at,
      assetId: String(ASSET),
      branchId: null,
      employeeId: HOLDER,
      fromBranchId: null,
      toBranchId: null,
    });
    expect(movementOfEvent(entry('returned', { employeeId: HOLDER })).employeeId).toBe(HOLDER);
  });

  it('names the branches of a move between two — «طنطا ← المهندسين» — and the new holder', () => {
    const moved = movementOfEvent(
      entry('transferred', {
        fromEmployeeId: HOLDER,
        toEmployeeId: NEXT_HOLDER,
        fromBranchId: TANTA,
        toBranchId: MOHANDESSIN,
      }),
    );
    expect(moved).toMatchObject({
      kind: 'transferred',
      branchId: MOHANDESSIN,
      employeeId: NEXT_HOLDER,
      fromBranchId: TANTA,
      toBranchId: MOHANDESSIN,
    });
  });

  it('names no branches for a hand-on within one branch — nothing moved between branches', () => {
    const handedOn = movementOfEvent(
      entry('transferred', {
        fromEmployeeId: HOLDER,
        toEmployeeId: NEXT_HOLDER,
        fromBranchId: TANTA,
        toBranchId: TANTA,
      }),
    );
    expect(handedOn).toMatchObject({
      branchId: TANTA,
      employeeId: NEXT_HOLDER,
      fromBranchId: null,
      toBranchId: null,
    });
  });

  it('names nobody for maintenance or a disposal — and reads no id out of anything but an id', () => {
    for (const type of ['maintenanceStarted', 'maintenanceCompleted', 'disposed']) {
      expect(
        movementOfEvent(entry(type, { employeeId: HOLDER, orderId: String(id()) })),
      ).toMatchObject({ employeeId: null, branchId: null, fromBranchId: null, toBranchId: null });
    }
    expect(movementOfEvent(entry('assigned', { employeeId: '' })).employeeId).toBeNull();
    expect(movementOfEvent(entry('assigned', { employeeId: 42 })).employeeId).toBeNull();
    expect(movementOfEvent(entry('assigned', {})).employeeId).toBeNull();
  });

  it('reads a registration from the asset itself — its id, its creation, its branch', () => {
    const asset = { _id: ASSET, createdAt: at, branchId: new Types.ObjectId(TANTA) };
    expect(movementOfRegistration(asset)).toEqual({
      id: String(ASSET),
      kind: 'registered',
      at,
      assetId: String(ASSET),
      branchId: TANTA,
      employeeId: null,
      fromBranchId: null,
      toBranchId: null,
    });
  });

  it('puts the two streams together newest first, a tie in a stable order, cut at the limit', () => {
    const line = (minute: number, lineId: string): ItDashboardMovement => ({
      id: lineId,
      kind: 'assigned',
      at: new Date(Date.UTC(2026, 10, 2, 8, minute)),
      assetId: String(ASSET),
      branchId: null,
      employeeId: null,
      fromBranchId: null,
      toBranchId: null,
    });
    const lines = [line(1, 'a'), line(9, 'b'), line(5, 'c'), line(9, 'd')];
    expect(latestMovements(lines).map((m) => m.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(latestMovements(lines, 2).map((m) => m.id)).toEqual(['d', 'b']);
    const many = Array.from({ length: 20 }, (_, n) => line(n, String(n).padStart(2, '0')));
    expect(latestMovements(many)).toHaveLength(ACTIVITY_LIMIT);
    expect(latestMovements(many)[0]?.id).toBe('19');
  });

  it('is labelled with the asset and the person as HR keeps them — in the asset’s branch now', () => {
    const asset = {
      assetCode: 'AST-00512',
      name: 'Lenovo ThinkCentre neo 50a 24',
      branchId: new Types.ObjectId(TANTA),
    };
    const handed = movementOfEvent(entry('assigned', { employeeId: HOLDER }));
    expect(
      toActivityItem(handed, asset, { code: '0101002', fullNameAr: 'وليد صفوت جلال' }),
    ).toEqual({
      id: handed.id,
      kind: 'assigned',
      at: '2026-11-02T08:30:00.000Z',
      assetId: String(ASSET),
      assetCode: 'AST-00512',
      assetName: 'Lenovo ThinkCentre neo 50a 24',
      branchId: TANTA,
      employeeId: HOLDER,
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      fromBranchId: null,
      toBranchId: null,
    });
    // A transfer reads its branch from the entry, wherever the asset has gone since.
    const moved = movementOfEvent(
      entry('transferred', { toEmployeeId: HOLDER, fromBranchId: TANTA, toBranchId: MOHANDESSIN }),
    );
    expect(toActivityItem(moved, asset, undefined)?.branchId).toBe(MOHANDESSIN);
  });

  it('keeps the id of a person HR cannot name, and leaves out a line whose asset is unknown', () => {
    const asset = { assetCode: 'AST-00087', name: 'Dell OptiPlex 7070', branchId: id() };
    const returned = movementOfEvent(entry('returned', { employeeId: HOLDER }));
    expect(toActivityItem(returned, asset, undefined)).toMatchObject({
      employeeId: HOLDER,
      employeeCode: null,
      employeeName: null,
    });
    expect(toActivityItem(returned, undefined, undefined)).toBeNull();
  });
});

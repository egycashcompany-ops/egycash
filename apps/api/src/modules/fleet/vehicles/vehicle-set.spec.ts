// The vehicle set (plan R-13, D9, D10, P1-06), against a small in-memory registry.
//
// The registry's model calls are answered from the array below by a matcher that applies EVERY
// clause it is sent — so if a resolver ever added `isDeleted: false` (the old `idsMatching` trap),
// the deleted car would drop out here and the «deleted cars included» cases would fail.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentBranchId, type AuthContext } from '../../../shared/types';
import { FleetVehicleModel } from './vehicle.model';
import {
  idsWithTypes,
  resolveVehicleFilterIds,
  vehicleSet,
  withVehicleFilterMemo,
} from './vehicle-set';

const id = (): string => new Types.ObjectId().toString();
const [T1, T2, O1, O2, B1, B2] = [id(), id(), id(), id(), id(), id()];

interface Car {
  _id: Types.ObjectId;
  code: string;
  typeId: Types.ObjectId;
  operationId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  status: string;
  isDeleted: boolean;
}
const car = (
  code: string,
  typeId: string,
  operationId: string | null,
  branchId: string | null,
  over: Partial<Car> = {},
): Car => ({
  _id: new Types.ObjectId(),
  code,
  typeId: new Types.ObjectId(typeId),
  operationId: operationId === null ? null : new Types.ObjectId(operationId),
  branchId: branchId === null ? null : new Types.ObjectId(branchId),
  status: 'active',
  isDeleted: false,
  ...over,
});

const c1 = car('101', T1, O1, B1); // T1 · O1 · B1
const c2 = car('102', T1, O2, B2); // T1 · O2 · B2
const c3 = car('103', T2, O2, B1, { status: 'outOfService' }); // T2 · O2 · B1
const c4 = car('104', T2, O1, B2, { status: 'disposed' }); // T2 · O1 · B2
const gone = car('105', T1, O1, B1, { isDeleted: true }); // T1 · O1 · B1, soft-deleted
const reused = car('101', T2, null, null, { isDeleted: true }); // an old car whose code 101 was reused
const REGISTRY = [c1, c2, c3, c4, gone, reused];
const idOf = (c: Car): string => String(c._id);

/** Applies every clause: `{field: {$in: [...]}}` or a plain equality. */
const matches = (doc: Car, filter: Record<string, unknown>): boolean =>
  Object.entries(filter).every(([field, wanted]) => {
    const value = (doc as unknown as Record<string, unknown>)[field];
    if (wanted !== null && typeof wanted === 'object' && '$in' in wanted) {
      return (wanted as { $in: unknown[] }).$in.map(String).includes(String(value));
    }
    return String(value) === String(wanted);
  });

const sent: Record<string, unknown>[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(FleetVehicleModel, 'distinct').mockImplementation(((
    field: string,
    filter: Record<string, unknown>,
  ) => {
    sent.push(filter);
    expect(field).toBe('_id');
    return { exec: async () => REGISTRY.filter((doc) => matches(doc, filter)).map((d) => d._id) };
  }) as unknown as typeof FleetVehicleModel.distinct);
  vi.spyOn(FleetVehicleModel, 'find').mockImplementation(((filter: Record<string, unknown>) => {
    sent.push(filter);
    const rows = REGISTRY.filter((doc) => matches(doc, filter)).map((d) => ({ _id: d._id }));
    const chain = { select: () => chain, lean: () => chain, exec: async () => rows };
    return chain;
  }) as unknown as typeof FleetVehicleModel.find);
  vi.spyOn(FleetVehicleModel, 'countDocuments').mockImplementation(((
    filter: Record<string, unknown>,
  ) => {
    sent.push(filter);
    return { exec: async () => REGISTRY.filter((doc) => matches(doc, filter)).length };
  }) as unknown as typeof FleetVehicleModel.countDocuments);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sorted = (ids: readonly string[] | undefined): string[] | undefined =>
  ids === undefined ? undefined : [...ids].sort();

describe('resolveVehicleFilterIds — the set half every screen intersects with its codes', () => {
  it('nothing narrows ⇒ undefined (no vehicle clause), and the registry is not asked', async () => {
    expect(await resolveVehicleFilterIds({})).toBeUndefined();
    expect(
      await resolveVehicleFilterIds({
        typeIds: undefined,
        operationIds: undefined,
        branchIds: undefined,
      }),
    ).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('a type alone: every car of it, the deleted ones INCLUDED', async () => {
    expect(sorted(await resolveVehicleFilterIds({ typeIds: [T1] }))).toEqual(
      sorted([idOf(c1), idOf(c2), idOf(gone)]),
    );
    expect(sorted(await idsWithTypes([T2]))).toEqual(sorted([idOf(c3), idOf(c4), idOf(reused)]));
  });

  it('an operation alone and a branch alone: deleted cars included, every status', async () => {
    expect(sorted(await resolveVehicleFilterIds({ operationIds: [O1] }))).toEqual(
      sorted([idOf(c1), idOf(c4), idOf(gone)]),
    );
    expect(sorted(await resolveVehicleFilterIds({ branchIds: [B1] }))).toEqual(
      sorted([idOf(c1), idOf(c3), idOf(gone)]),
    );
  });

  it('several keys are ANDed; the values of one key are ORed', async () => {
    expect(sorted(await resolveVehicleFilterIds({ typeIds: [T1], branchIds: [B1] }))).toEqual(
      sorted([idOf(c1), idOf(gone)]),
    );
    expect(
      sorted(await resolveVehicleFilterIds({ typeIds: [T1], operationIds: [O1], branchIds: [B1] })),
    ).toEqual(sorted([idOf(c1), idOf(gone)]));
    expect(
      sorted(await resolveVehicleFilterIds({ typeIds: [T1, T2], operationIds: [O2] })),
    ).toEqual(sorted([idOf(c2), idOf(c3)]));
  });

  it('an intersection nobody is in is an EMPTY set — a real answer, never «no clause»', async () => {
    expect(
      await resolveVehicleFilterIds({ typeIds: [T2], branchIds: [B1], operationIds: [O1] }),
    ).toEqual([]);
    expect(await resolveVehicleFilterIds({ typeIds: [id()] })).toEqual([]);
  });

  it('never sends a soft-delete or status clause — the screens’ own resolvers', async () => {
    await resolveVehicleFilterIds({ typeIds: [T1], operationIds: [O1], branchIds: [B1] });
    expect(sent).toHaveLength(3);
    for (const filter of sent) {
      expect(Object.keys(filter)).toHaveLength(1);
      expect(filter).not.toHaveProperty('isDeleted');
      expect(filter).not.toHaveProperty('status');
    }
  });
});

describe('vehicleSet — the dashboard’s set and its echo (R-13)', () => {
  it('nothing narrows ⇒ ids undefined, count null, an empty echo', async () => {
    expect(await vehicleSet({}, null)).toEqual({
      ids: undefined,
      scope: { count: null, typeIds: [], operationIds: [], vehicleCodes: [], branchId: null },
    });
    expect(sent).toEqual([]);
  });

  it('codes resolve through idsByCodes — a reused code names the deleted car too', async () => {
    const { ids, scope } = await vehicleSet({ vehicleCodes: ['101'] }, null, { count: true });
    expect(sorted(ids)).toEqual(sorted([idOf(c1), idOf(reused)]));
    // The set keeps the deleted car (its history); the display count is the registry's: 1.
    expect(scope).toEqual({
      count: 1,
      typeIds: [],
      operationIds: [],
      vehicleCodes: ['101'],
      branchId: null,
    });
  });

  it('codes ∩ types ∩ operations ∩ the switcher’s branch', async () => {
    const { ids, scope } = await vehicleSet(
      { vehicleCodes: ['101', '105', '102'], typeIds: [T1], operationIds: [O1] },
      B1,
      { count: true },
    );
    expect(sorted(ids)).toEqual(sorted([idOf(c1), idOf(gone)]));
    // The echo is the FILTERS the links carry, never the resolved ids.
    expect(scope).toEqual({
      count: 1,
      typeIds: [T1],
      operationIds: [O1],
      vehicleCodes: ['101', '105', '102'],
      branchId: B1,
    });
  });

  it('a branch alone narrows to that branch’s cars, deleted ones included', async () => {
    const { ids, scope } = await vehicleSet({}, B2, { count: true });
    expect(sorted(ids)).toEqual(sorted([idOf(c2), idOf(c4)]));
    expect(scope.count).toBe(2); // c4 is disposed, not deleted: still a registry car
    expect(scope.branchId).toBe(B2);
  });

  it('a set nobody is in counts 0 — not null', async () => {
    const { ids, scope } = await vehicleSet({ typeIds: [T2] }, B1, { count: true });
    expect(ids).toEqual([idOf(c3)]);
    const none = await vehicleSet({ vehicleCodes: ['999'] }, null, { count: true });
    expect(none.ids).toEqual([]);
    expect(none.scope.count).toBe(0);
    expect(scope.count).toBe(1);
  });

  it('the display count is not read unless asked (a reader without the registry): null', async () => {
    const { ids, scope } = await vehicleSet({ vehicleCodes: ['101'] }, null);
    expect(ids).toHaveLength(2);
    expect(scope.count).toBeNull();
    expect(sent.some((filter) => 'isDeleted' in filter)).toBe(false);
  });

  it('«الشركة كلها» with a home branch ⇒ NO branch clause (activeBranchId, never currentBranchId)', async () => {
    const ctx: AuthContext = {
      userId: id(),
      sessionId: 's',
      branchId: B1, // the reader's HOME branch
      departmentId: null,
      sectionId: null,
      locale: 'ar',
      permissions: { 'fleetMaintenance.view': 'organization' },
      permissionVersion: 1,
      isPrivileged: false,
      activeBranchId: null, // the switcher says «الشركة كلها»
    };
    // The trap: the home-branch fallback would name B1 here …
    expect(currentBranchId(ctx)).toBe(B1);
    // … but the set is built from the switcher, so the whole company has no vehicle clause.
    const whole = await vehicleSet({}, ctx.activeBranchId ?? null);
    expect(whole.ids).toBeUndefined();
    expect(whole.scope.branchId).toBeNull();
    expect(sent).toEqual([]);
    const typed = await vehicleSet({ typeIds: [T1] }, ctx.activeBranchId ?? null);
    expect(sorted(typed.ids)).toEqual(sorted([idOf(c1), idOf(c2), idOf(gone)]));
    expect(sent.some((filter) => 'branchId' in filter)).toBe(false);
  });
});

describe('withVehicleFilterMemo — one registry answer per narrowing per dashboard read', () => {
  it('inside one read the same filter is resolved once and each caller gets its own copy', async () => {
    const [a, b, c] = await withVehicleFilterMemo(() =>
      Promise.all([
        resolveVehicleFilterIds({ typeIds: [T1], operationIds: [O1] }),
        resolveVehicleFilterIds({ operationIds: [O1], typeIds: [T1] }),
        resolveVehicleFilterIds({ typeIds: [T1] }),
      ]),
    );
    expect(sorted(a)).toEqual(sorted([idOf(c1), idOf(gone)]));
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    expect(sorted(c)).toEqual(sorted([idOf(c1), idOf(c2), idOf(gone)]));
    // types:T1 once, operations:O1 once — not five reads.
    expect(sent).toHaveLength(2);
  });

  it('the codes too: two modules looking up the same codes ask the registry once', async () => {
    const [a, b] = await withVehicleFilterMemo(() =>
      Promise.all([
        vehicleSet({ vehicleCodes: ['101', '105'] }, null),
        vehicleSet({ vehicleCodes: ['105', '101'] }, null),
      ]),
    );
    expect(sorted(a.ids)).toEqual(sorted([idOf(c1), idOf(gone), idOf(reused)]));
    expect(b.ids).toEqual(a.ids);
    expect(sent).toHaveLength(1);
  });

  it('outside a dashboard read (every screen’s own request) nothing is cached', async () => {
    await resolveVehicleFilterIds({ typeIds: [T1] });
    await resolveVehicleFilterIds({ typeIds: [T1] });
    expect(sent).toHaveLength(2);
  });
});

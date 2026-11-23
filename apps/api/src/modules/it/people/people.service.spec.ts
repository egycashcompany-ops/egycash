// The people IT names, tested as decisions with the directory and the settings mocked.
//
// «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين ... الفنى يكون من مموظفيين الit بس».
//
// Four things have to hold. The register reads in the READER'S scope and carries what each person
// holds now — counted within the reader's ASSET grant, and not at all without it; a person's page
// is also the reader's once their own registers name the person (2026-11-18). A hand-over's box
// names anybody employed, in every branch, with four facts. The technician
// list is the IT departments' people and nobody else — and says when no
// department has been chosen rather than answering with an empty list that looks like «nobody
// matches». And the assign guard refuses anybody who is not a current IT employee, while leaving an
// unconfigured deployment exactly as it was.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DirectoryEmployee, type DirectoryEmployeeListing } from '../../../platform/directory';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  searchDirectoryEmployees: vi.fn(),
  getSelfDirectoryEmployee: vi.fn(),
  resolveSetting: vi.fn(),
  countOpenByEmployees: vi.fn(),
  countAssetIntervals: vi.fn(),
  countLineIntervals: vi.fn(),
  countMovements: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  searchDirectoryEmployees: mocks.searchDirectoryEmployees,
  getSelfDirectoryEmployee: mocks.getSelfDirectoryEmployee,
}));
vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: mocks.resolveSetting },
}));
vi.mock('../assets/assignment.repository', () => ({
  itAssetAssignmentRepository: {
    countOpenByEmployees: mocks.countOpenByEmployees,
    count: mocks.countAssetIntervals,
  },
}));
vi.mock('../mobile-lines/line-assignment.repository', () => ({
  itMobileLineAssignmentRepository: { count: mocks.countLineIntervals },
}));
vi.mock('../consumables/consumable-movement.repository', () => ({
  itConsumableMovementRepository: { count: mocks.countMovements },
}));

const { itPeopleService } = await import('./people.service');

const IT_DEPARTMENT = 'd0000000000000000000000a';
const OTHER_DEPARTMENT = 'd0000000000000000000000b';

const listing = (
  code: string,
  status: DirectoryEmployee['status'] = 'active',
): DirectoryEmployeeListing => ({
  employeeId: `e-${code}`,
  code,
  fullNameAr: `موظف ${code}`,
  status,
  branchId: 'b1',
  departmentId: IT_DEPARTMENT,
  phone: null,
  governorate: null,
  hiredAt: new Date('2024-01-01T00:00:00.000Z'),
  address: null,
  userId: `u-${code}`,
  jobTitleId: 'j1',
  exitedAt: status === 'exited' ? new Date('2026-05-01T00:00:00.000Z') : null,
});

const page = (items: DirectoryEmployeeListing[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const scope = { scope: 'branch', branchId: 'b1' } as never;
/** One selector per register read grant the reader holds — OR-ed by the directory. */
const scopes = [scope, { scope: 'own', userId: 'u1' } as never];
/** The reader's `itAsset.view` — its own selector, so «counted within it» is an assertion. */
const assetScope = { scope: 'organization', branchId: null } as never;
/** Each register's own read scope — three distinct selectors, so «asked in its own» is asserted. */
const lineScope = { scope: 'branch', branchId: 'b-lines' } as never;
const storeScope = { scope: 'branch', branchId: 'b-store' } as never;
const registers = { assets: assetScope, lines: lineScope, consumables: storeScope };
const noRegisters = { assets: null, lines: null, consumables: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countOpenByEmployees.mockResolvedValue(new Map());
  mocks.countAssetIntervals.mockResolvedValue(0);
  mocks.countLineIntervals.mockResolvedValue(0);
  mocks.countMovements.mockResolvedValue(0);
});

describe('the people register', () => {
  it('reads in the reader’s scope and carries what each person holds now', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(
      page([listing('0100001'), listing('0100002', 'exited')]),
    );
    mocks.countOpenByEmployees.mockResolvedValue(new Map([['e-0100002', 2]]));

    const result = await itPeopleService.list(
      { status: 'all', sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25 },
      scopes,
      assetScope,
    );

    expect(mocks.searchDirectoryEmployees).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all', anyOfScopes: scopes }),
    );
    expect(mocks.countOpenByEmployees).toHaveBeenCalledWith(['e-0100001', 'e-0100002'], assetScope);
    expect(result.items.map((p) => [p.code, p.status, p.openCustodyCount])).toEqual([
      ['0100001', 'active', 0],
      ['0100002', 'exited', 2],
    ]);
    expect(result.items[1]?.exitedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('counts no assets for a reader without the asset grant — the register is not asked', async () => {
    // A lines or store keeper (2026-11-17) finds the people they hand things to, and learns from
    // the list nothing of how many devices anybody holds.
    mocks.searchDirectoryEmployees.mockResolvedValue(
      page([listing('0100001'), listing('0100002')]),
    );
    const result = await itPeopleService.list(
      { status: 'all', sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25 },
      scopes,
      null,
    );
    expect(mocks.countOpenByEmployees).not.toHaveBeenCalled();
    expect(result.items.map((p) => p.openCustodyCount)).toEqual([0, 0]);

    mocks.searchDirectoryEmployees.mockResolvedValue(page([listing('0100001')]));
    expect((await itPeopleService.get('e-0100001', scopes, noRegisters)).openCustodyCount).toBe(0);
    expect(mocks.countOpenByEmployees).not.toHaveBeenCalled();
  });

  it('answers 404 for a person the reader could not have found by searching', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(page([]));
    const id = new Types.ObjectId().toHexString();
    await expect(itPeopleService.get(id, scopes, registers)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.searchDirectoryEmployees).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: [id], status: 'all', anyOfScopes: scopes }),
    );
    // Every register was asked and named nobody — so HR was never asked unscoped.
    expect(mocks.searchDirectoryEmployees).toHaveBeenCalledTimes(1);
    expect(mocks.countAssetIntervals).toHaveBeenCalledTimes(1);
    expect(mocks.countLineIntervals).toHaveBeenCalledTimes(1);
    expect(mocks.countMovements).toHaveBeenCalledTimes(1);
  });
});

describe('a person the reader’s registers name — «المُسلِّم يرى ما سلّمه»', () => {
  // A keeper of branch A handed a laptop, a line or a mouse to somebody HR places in branch B: the
  // scoped read misses them, and the page is still the keeper's.
  const id = new Types.ObjectId().toHexString();
  const person = new Types.ObjectId(id);
  const inB = { ...listing('0200001'), employeeId: id, branchId: 'b2' };

  /** The scoped read misses; the unscoped one finds the person. */
  const missThenFind = (): void => {
    mocks.searchDirectoryEmployees.mockResolvedValueOnce(page([]));
    mocks.searchDirectoryEmployees.mockResolvedValueOnce(page([inB]));
  };

  /** The second directory read — the one made only once a register named the person. */
  const unscopedRead = (): Record<string, unknown> | undefined =>
    mocks.searchDirectoryEmployees.mock.calls[1]?.[0] as Record<string, unknown> | undefined;

  it('opens the page when an asset custody interval in the reader’s asset scope names them', async () => {
    missThenFind();
    mocks.countAssetIntervals.mockResolvedValue(1);
    mocks.countOpenByEmployees.mockResolvedValue(new Map([[id, 1]]));

    const result = await itPeopleService.get(id, scopes, registers);

    // Holding the asset, or having signed for a department that holds it (2026-11-19).
    expect(mocks.countAssetIntervals).toHaveBeenCalledWith(
      { $or: [{ assignedToEmployeeId: person }, { responsibleEmployeeId: person }] },
      assetScope,
    );
    // The person read UNSCOPED — neither a scope nor the grants' union — and status `all`.
    expect(unscopedRead()).toEqual({ employeeIds: [id], status: 'all', page: 1, pageSize: 1 });
    expect(unscopedRead()).not.toHaveProperty('scope');
    expect(unscopedRead()).not.toHaveProperty('anyOfScopes');
    expect(result).toMatchObject({ employeeId: id, code: '0200001', branchId: 'b2' });
    // What they hold is still counted within the reader's own `itAsset.view`.
    expect(mocks.countOpenByEmployees).toHaveBeenCalledWith([id], assetScope);
    expect(result.openCustodyCount).toBe(1);
    // The first register that names the person ends it.
    expect(mocks.countLineIntervals).not.toHaveBeenCalled();
    expect(mocks.countMovements).not.toHaveBeenCalled();
  });

  it('opens it for a line interval in the lines scope, and for a movement in the store scope', async () => {
    missThenFind();
    mocks.countLineIntervals.mockResolvedValue(2);
    await expect(itPeopleService.get(id, scopes, registers)).resolves.toMatchObject({
      employeeId: id,
    });
    expect(mocks.countLineIntervals).toHaveBeenCalledWith(
      { assignedToEmployeeId: person },
      lineScope,
    );
    expect(mocks.countMovements).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.countOpenByEmployees.mockResolvedValue(new Map());
    mocks.countAssetIntervals.mockResolvedValue(0);
    mocks.countLineIntervals.mockResolvedValue(0);
    missThenFind();
    mocks.countMovements.mockResolvedValue(3);
    await expect(itPeopleService.get(id, scopes, registers)).resolves.toMatchObject({
      employeeId: id,
    });
    // Issued to them, or a department's memo they signed for.
    expect(mocks.countMovements).toHaveBeenCalledWith(
      { $or: [{ employeeId: person }, { responsibleEmployeeId: person }] },
      storeScope,
    );
  });

  it('asks only the registers the reader holds a grant of', async () => {
    // A store keeper alone: neither custody register is asked, and the assets are not counted.
    missThenFind();
    mocks.countMovements.mockResolvedValue(1);
    const result = await itPeopleService.get(id, scopes, {
      ...noRegisters,
      consumables: storeScope,
    });
    expect(mocks.countAssetIntervals).not.toHaveBeenCalled();
    expect(mocks.countLineIntervals).not.toHaveBeenCalled();
    expect(mocks.countOpenByEmployees).not.toHaveBeenCalled();
    expect(result.openCustodyCount).toBe(0);
  });

  it('asks no register at all when the scoped read found the person', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(page([inB]));
    await itPeopleService.get(id, scopes, registers);
    expect(mocks.searchDirectoryEmployees).toHaveBeenCalledTimes(1);
    expect(mocks.countAssetIntervals).not.toHaveBeenCalled();
    expect(mocks.countLineIntervals).not.toHaveBeenCalled();
    expect(mocks.countMovements).not.toHaveBeenCalled();
  });

  it('is still a 404 when a register names the person but HR no longer has them', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(page([]));
    mocks.countAssetIntervals.mockResolvedValue(1);
    await expect(itPeopleService.get(id, scopes, registers)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the recipients a hand-over may name', () => {
  it('are the employed people of every branch — unscoped, searched, by name, the page asked', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(
      page([listing('0100001'), { ...listing('0200001'), branchId: 'b2' }]),
    );

    const result = await itPeopleService.recipients({ search: 'وليد', pageSize: 5 });

    const asked = mocks.searchDirectoryEmployees.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(asked).toEqual({
      search: 'وليد',
      status: 'employed',
      sortBy: 'name',
      sortDir: 'asc',
      page: 1,
      pageSize: 5,
    });
    // Every branch: neither a grant's reach nor the command bar's branch narrows the box.
    expect(asked).not.toHaveProperty('scope');
    expect(asked).not.toHaveProperty('anyOfScopes');
    expect(asked).not.toHaveProperty('branchId');
    // Four facts a row — none of the register's dates, login, placement ids or custody counts.
    expect(result).toEqual([
      { employeeId: 'e-0100001', code: '0100001', fullNameAr: 'موظف 0100001', branchId: 'b1' },
      { employeeId: 'e-0200001', code: '0200001', fullNameAr: 'موظف 0200001', branchId: 'b2' },
    ]);
    expect(mocks.countOpenByEmployees).not.toHaveBeenCalled();
  });
});

describe('the technicians', () => {
  it('says so when no IT department has been chosen — and asks the directory nothing', async () => {
    mocks.resolveSetting.mockResolvedValue([]);

    const result = await itPeopleService.technicians({
      status: 'employed',
      sortBy: 'name',
      sortDir: 'asc',
      page: 1,
      pageSize: 25,
    });

    expect(result).toEqual({ configured: false, items: [] });
    expect(mocks.searchDirectoryEmployees).not.toHaveBeenCalled();
  });

  it('are the chosen departments’ people, whoever is asking', async () => {
    mocks.resolveSetting.mockResolvedValue([IT_DEPARTMENT]);
    mocks.searchDirectoryEmployees.mockResolvedValue(page([listing('0100009')]));

    const result = await itPeopleService.technicians({
      search: 'أحمد',
      status: 'employed',
      sortBy: 'name',
      sortDir: 'asc',
      page: 1,
      pageSize: 25,
    });

    expect(result.configured).toBe(true);
    expect(result.items.map((t) => [t.code, t.userId])).toEqual([['0100009', 'u-0100009']]);
    const asked = mocks.searchDirectoryEmployees.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(asked).toMatchObject({
      departmentIds: [IT_DEPARTMENT],
      search: 'أحمد',
      status: 'employed',
    });
    // Unscoped on purpose: a branch dispatcher hands work to head-office IT like anybody else.
    expect(asked).not.toHaveProperty('scope');
  });
});

describe('assigning a ticket', () => {
  const employee = (
    status: DirectoryEmployee['status'],
    departmentId: string | null = IT_DEPARTMENT,
  ): DirectoryEmployee => ({ ...listing('0100009', status), departmentId });

  it('behaves exactly as before until an IT department has been chosen', async () => {
    mocks.resolveSetting.mockResolvedValue([]);
    await expect(itPeopleService.assertAssignableTechnician('u-1')).resolves.toBeUndefined();
    expect(mocks.getSelfDirectoryEmployee).not.toHaveBeenCalled();
  });

  it('takes a current IT employee — on leave or suspended is still current', async () => {
    mocks.resolveSetting.mockResolvedValue([IT_DEPARTMENT]);
    for (const status of ['probation', 'active', 'onLeave', 'suspended'] as const) {
      mocks.getSelfDirectoryEmployee.mockResolvedValue(employee(status));
      await expect(
        itPeopleService.assertAssignableTechnician('u-1'),
        status,
      ).resolves.toBeUndefined();
    }
  });

  it('refuses an IT employee who has left', async () => {
    mocks.resolveSetting.mockResolvedValue([IT_DEPARTMENT]);
    mocks.getSelfDirectoryEmployee.mockResolvedValue(employee('exited'));
    await expect(itPeopleService.assertAssignableTechnician('u-1')).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('refuses somebody outside the IT departments', async () => {
    mocks.resolveSetting.mockResolvedValue([IT_DEPARTMENT]);
    mocks.getSelfDirectoryEmployee.mockResolvedValue(employee('active', OTHER_DEPARTMENT));
    await expect(itPeopleService.assertAssignableTechnician('u-1')).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('refuses a login with no employee behind it', async () => {
    mocks.resolveSetting.mockResolvedValue([IT_DEPARTMENT]);
    mocks.getSelfDirectoryEmployee.mockResolvedValue(null);
    await expect(itPeopleService.assertAssignableTechnician('u-1')).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });
});

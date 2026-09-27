// The people IT names, tested as decisions with the directory and the settings mocked.
//
// «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين ... الفنى يكون من مموظفيين الit بس».
//
// Three things have to hold. The register reads in the READER'S scope and carries what each person
// holds now. The technician list is the IT departments' people and nobody else — and says when no
// department has been chosen rather than answering with an empty list that looks like «nobody
// matches». And the assign guard refuses anybody who is not a current IT employee, while leaving an
// unconfigured deployment exactly as it was.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DirectoryEmployee, type DirectoryEmployeeListing } from '../../../platform/directory';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  searchDirectoryEmployees: vi.fn(),
  getSelfDirectoryEmployee: vi.fn(),
  resolveSetting: vi.fn(),
  countOpenByEmployees: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  searchDirectoryEmployees: mocks.searchDirectoryEmployees,
  getSelfDirectoryEmployee: mocks.getSelfDirectoryEmployee,
}));
vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: mocks.resolveSetting },
}));
vi.mock('../assets/assignment.repository', () => ({
  itAssetAssignmentRepository: { countOpenByEmployees: mocks.countOpenByEmployees },
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countOpenByEmployees.mockResolvedValue(new Map());
});

describe('the people register', () => {
  it('reads in the reader’s scope and carries what each person holds now', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(
      page([listing('0100001'), listing('0100002', 'exited')]),
    );
    mocks.countOpenByEmployees.mockResolvedValue(new Map([['e-0100002', 2]]));

    const result = await itPeopleService.list(
      { status: 'all', sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25 },
      scope,
    );

    expect(mocks.searchDirectoryEmployees).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all', scope }),
    );
    expect(mocks.countOpenByEmployees).toHaveBeenCalledWith(['e-0100001', 'e-0100002'], scope);
    expect(result.items.map((p) => [p.code, p.status, p.openCustodyCount])).toEqual([
      ['0100001', 'active', 0],
      ['0100002', 'exited', 2],
    ]);
    expect(result.items[1]?.exitedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('answers 404 for a person the reader could not have found by searching', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue(page([]));
    await expect(itPeopleService.get('e-x', scope)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.searchDirectoryEmployees).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ['e-x'], status: 'all', scope }),
    );
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

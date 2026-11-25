// The people the module names, tested as decisions with the directory mocked (design §7.8, §19.7).
//
// Three things have to hold. The picker offers only the people who work here today — a new
// reference never names a leaver — within the reach of the keys that opened it, OR-ed. Every read
// answers §7.8's seven facts and nothing else of HR's: no phone, no address, no hiring date, no
// login. And the warehouse's two system reads ask the directory unscoped and by id: the keeper a
// write names, and the keepers a page names, each a leaver still named as one. From P2.2 the
// documents' two: the caller's own employee, and the snapshot a document copies of a person, whose
// job title and department are named by the organization catalogue, each null when it names none.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DirectoryEmployee, type DirectoryEmployeeListing } from '../../../platform/directory';
import { NotFoundError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  one: vi.fn(),
  many: vi.fn(),
  self: vi.fn(),
  jobTitles: vi.fn(),
  departments: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  searchDirectoryEmployees: mocks.search,
  getDirectoryEmployee: mocks.one,
  getDirectoryEmployees: mocks.many,
  getSelfDirectoryEmployee: mocks.self,
}));
vi.mock('../../../platform/organization', () => ({
  jobTitleRepository: { findByIdsSystem: mocks.jobTitles },
  departmentRepository: { findByIdsSystem: mocks.departments },
}));

const { administrationPeopleService, peopleScopesOf } = await import('./people.service');

const listing = (
  code: string,
  status: DirectoryEmployee['status'] = 'active',
): DirectoryEmployeeListing => ({
  employeeId: `e-${code}`,
  code,
  fullNameAr: `موظف ${code}`,
  status,
  branchId: 'b1',
  departmentId: 'd1',
  jobTitleId: 'j1',
  phone: '01000000000',
  governorate: 'الجيزة',
  hiredAt: new Date('2024-01-01T00:00:00.000Z'),
  address: 'شارع ما',
  userId: `u-${code}`,
  exitedAt: status === 'exited' ? new Date('2026-05-01T00:00:00.000Z') : null,
});

const page = (items: DirectoryEmployeeListing[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

/**
 * One selector per gate key the caller holds — the create key in A, the edit key in B. Only
 * passed through to the mocked directory, so their shape is what is compared, not built: cast.
 */
const scopes = [
  { scope: 'branch', branchId: 'bA' } as never,
  { scope: 'branch', branchId: 'bB' } as never,
];

/** §7.8's seven facts, exactly. */
const SEVEN = [
  'branchId',
  'code',
  'departmentId',
  'employeeId',
  'fullNameAr',
  'jobTitleId',
  'status',
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the picker', () => {
  it('searches the employed only, within every held key’s reach, as the query asks', async () => {
    mocks.search.mockResolvedValue(page([listing('E-001')]));
    await administrationPeopleService.list(
      {
        search: 'أحمد',
        branchId: 'bA',
        sortBy: 'code',
        sortDir: 'desc',
        page: 2,
        pageSize: 10,
      },
      scopes,
    );
    expect(mocks.search).toHaveBeenCalledWith({
      search: 'أحمد',
      status: 'employed',
      branchId: 'bA',
      sortBy: 'code',
      sortDir: 'desc',
      anyOfScopes: scopes,
      page: 2,
      pageSize: 10,
    });
  });

  it('answers §7.8’s seven facts and nothing else of HR’s, with the directory’s page', async () => {
    mocks.search.mockResolvedValue(page([listing('E-001'), listing('E-002', 'onLeave')]));
    const result = await administrationPeopleService.list(
      { sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25 },
      scopes,
    );
    expect(result.meta.totalItems).toBe(2);
    for (const person of result.items) expect(Object.keys(person).sort()).toEqual(SEVEN);
    expect(result.items[0]).toEqual({
      employeeId: 'e-E-001',
      code: 'E-001',
      fullNameAr: 'موظف E-001',
      status: 'active',
      branchId: 'b1',
      departmentId: 'd1',
      jobTitleId: 'j1',
    });
  });

  it('hands the directory no scope to widen with: none held reads nobody', async () => {
    mocks.search.mockResolvedValue(page([]));
    await administrationPeopleService.list(
      { sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25 },
      [],
    );
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ anyOfScopes: [] }));
  });
});

describe('the reach', () => {
  /** A caller placed in A, holding `permissions`; nothing else of the context is read here. */
  const ctx = (permissions: AuthContext['permissions'], activeBranchId?: string): AuthContext => ({
    userId: 'u1',
    sessionId: 's1',
    branchId: 'bA',
    departmentId: null,
    sectionId: null,
    locale: 'ar',
    permissions,
    permissionVersion: 1,
    isPrivileged: false,
    ...(activeBranchId === undefined ? {} : { activeBranchId }),
  });

  it('is one selector per held gate key, each as its register applies it — none for none held', () => {
    expect(
      peopleScopesOf(
        ctx({
          'administrationWarehouse.create': 'branch',
          'administrationWarehouse.view': 'organization',
        }),
      ),
    ).toEqual([expect.objectContaining({ scope: 'branch', branchId: 'bA' })]);
    expect(
      peopleScopesOf(
        ctx({
          'administrationWarehouse.create': 'branch',
          'administrationWarehouse.edit': 'organization',
        }),
      ).map((selector) => selector.scope),
    ).toEqual(['branch', 'organization']);
    expect(peopleScopesOf(ctx({ 'administrationWarehouse.view': 'organization' }))).toEqual([]);
  });

  it('is narrowed by the top bar as each register is', () => {
    expect(peopleScopesOf(ctx({ 'administrationWarehouse.edit': 'organization' }, 'bB'))).toEqual([
      expect.objectContaining({ scope: 'branch', branchId: 'bB' }),
    ]);
  });
});

describe('one person', () => {
  it('is read through the same scoped search, of every status — a stored keeper who left shows', async () => {
    mocks.search.mockResolvedValue(page([listing('E-009', 'exited')]));
    const person = await administrationPeopleService.get('e-E-009', scopes);
    expect(mocks.search).toHaveBeenCalledWith({
      employeeIds: ['e-E-009'],
      status: 'all',
      anyOfScopes: scopes,
      page: 1,
      pageSize: 1,
    });
    expect(Object.keys(person).sort()).toEqual(SEVEN);
    expect(person.status).toBe('exited');
  });

  it('is a 404 when the reader’s keys do not reach them', async () => {
    mocks.search.mockResolvedValue(page([]));
    await expect(administrationPeopleService.get('e-X', scopes)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('the warehouse’s system reads', () => {
  it('reads the keeper a write names unscoped, by id — the rule then decides', async () => {
    mocks.one.mockResolvedValue(listing('E-003', 'exited'));
    expect(await administrationPeopleService.find('e-E-003')).toMatchObject({ status: 'exited' });
    expect(mocks.one).toHaveBeenCalledWith('e-E-003');
  });

  it('names a page’s keepers in one read, each id once, a leaver marked and nobody left out', async () => {
    mocks.many.mockResolvedValue(
      new Map([
        ['e-E-004', listing('E-004')],
        ['e-E-005', listing('E-005', 'exited')],
      ]),
    );
    const keepers = await administrationPeopleService.keepers(['e-E-004', 'e-E-005', 'e-E-004']);
    expect(mocks.many).toHaveBeenCalledTimes(1);
    expect(mocks.many).toHaveBeenCalledWith(['e-E-004', 'e-E-005']);
    expect(keepers.get('e-E-005')).toEqual({
      employeeId: 'e-E-005',
      code: 'E-005',
      fullNameAr: 'موظف E-005',
      status: 'exited',
    });
    expect([...keepers.keys()]).toEqual(['e-E-004', 'e-E-005']);
  });

  it('asks nothing for a page that names no keeper', async () => {
    expect((await administrationPeopleService.keepers([])).size).toBe(0);
    expect(mocks.many).not.toHaveBeenCalled();
  });
});

describe('the documents’ reads (P2.2)', () => {
  const employee = (over: Partial<DirectoryEmployee> = {}): DirectoryEmployee => ({
    employeeId: 'e-1',
    code: 'E-0001',
    fullNameAr: 'منسق الإدارة',
    status: 'active',
    branchId: 'b1',
    departmentId: 'd1',
    jobTitleId: 'j1',
    phone: null,
    governorate: null,
    hiredAt: null,
    address: null,
    ...over,
  });

  it('reads the caller’s own employee by their login, and nobody else', async () => {
    mocks.self.mockResolvedValue(employee());
    expect(await administrationPeopleService.self('u-1')).toEqual(employee());
    expect(mocks.self).toHaveBeenCalledWith('u-1');
    mocks.self.mockResolvedValue(null);
    expect(await administrationPeopleService.self('u-2')).toBeNull();
  });

  it('copies the name and the snapshot, the names the catalogue’s for the ids HR gives', async () => {
    mocks.jobTitles.mockResolvedValue([{ name: { ar: 'محاسب', en: 'Accountant' } }]);
    mocks.departments.mockResolvedValue([{ name: { ar: 'المشتريات', en: 'Purchasing' } }]);
    expect(await administrationPeopleService.resolvePerson(employee())).toEqual({
      name: 'منسق الإدارة',
      snap: {
        employeeCode: 'E-0001',
        jobTitle: { ar: 'محاسب', en: 'Accountant' },
        departmentId: 'd1',
        departmentName: { ar: 'المشتريات', en: 'Purchasing' },
      },
    });
    expect(mocks.jobTitles).toHaveBeenCalledWith(['j1']);
    expect(mocks.departments).toHaveBeenCalledWith(['d1']);
  });

  it('names nothing for an id that is null or names no row — and never refuses', async () => {
    mocks.jobTitles.mockResolvedValue([]);
    mocks.departments.mockResolvedValue([]);
    const { snap } = await administrationPeopleService.resolvePerson(
      employee({ jobTitleId: null, departmentId: 'd-gone' }),
    );
    expect(snap).toEqual({
      employeeCode: 'E-0001',
      jobTitle: null,
      departmentId: 'd-gone',
      departmentName: null,
    });
    expect(mocks.jobTitles).not.toHaveBeenCalled();
  });
});

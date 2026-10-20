// The register's own rules — «صفحة لإدارتهم … وبردو بفلتر لكل شبكة مع بيانات كل شبكة».
//
// With the data layer mocked, what is pinned is what the service decides: a line is filed only in
// a branch the caller reaches, an edit cannot leave an eSIM with a card serial nor move a line
// somebody holds, the register filters as the screen asks, and the network cards always name the
// three networks, a network with no lines counting zero.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError, ForbiddenError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  unitOfWork: vi.fn(),
  audit: vi.fn(),
  findLine: vi.fn(),
  createLine: vi.fn(),
  updateLine: vi.fn(),
  listLines: vi.fn(),
  countsByNetwork: vi.fn(),
  openIdsMatching: vi.fn(),
  appendEvent: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/directory', () => ({ getDirectoryEmployees: async () => new Map() }));
vi.mock('./mobile-line.repository', () => ({
  itMobileLineRepository: {
    findById: mocks.findLine,
    create: mocks.createLine,
    updateById: mocks.updateLine,
    list: mocks.listLines,
    countsByNetwork: mocks.countsByNetwork,
    ensureCollection: ready(),
  },
}));
vi.mock('./line-assignment.repository', () => ({
  itMobileLineAssignmentRepository: {
    openIdsMatching: mocks.openIdsMatching,
    ensureCollection: ready(),
  },
}));
vi.mock('./line-event.repository', () => ({
  itMobileLineEventRepository: { append: mocks.appendEvent, ensureCollection: ready() },
}));
vi.mock('./line-receipt.repository', () => ({
  itMobileLineReceiptRepository: { ensureCollection: ready(), findByIdsSystem: async () => [] },
}));

const { itMobileLineService, summarizeMobileLines } = await import('./mobile-line.service');

const LINE = String(new Types.ObjectId());
const HOME = String(new Types.ObjectId());
const ELSEWHERE = String(new Types.ObjectId());

/** Holds `itAsset.*` over ONE branch — the home one. */
const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  branchId: HOME,
  departmentId: null,
  sectionId: null,
  permissions: { 'itAsset.create': 'branch', 'itAsset.edit': 'branch' },
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
} as never;
const scope = {} as never;

const line = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(LINE),
  network: 'orange',
  phoneNumber: '01200000001',
  accountNumber: null,
  ratePlan: null,
  simKind: 'physical',
  simSerial: '8920022022712847788',
  status: 'inStock',
  branchId: new Types.ObjectId(HOME),
  currentAssignmentId: null,
  notes: null,
  __v: 2,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({}));
  mocks.createLine.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.updateLine.mockImplementation(async (_id: string, set: Record<string, unknown>) => ({
    ...line(),
    ...set,
  }));
  mocks.listLines.mockResolvedValue({ items: [], meta: {} });
  mocks.openIdsMatching.mockResolvedValue([]);
});

describe('registering a line', () => {
  const input = {
    network: 'vodafone' as const,
    phoneNumber: '01034455917',
    simKind: 'physical' as const,
    branchId: HOME,
  };

  it('files it in stock, with its history entry', async () => {
    const doc = await itMobileLineService.register(input, ctx);
    expect(doc).toMatchObject({ status: 'inStock', currentAssignmentId: null, simSerial: null });
    const [entry] = mocks.appendEvent.mock.calls[0] as [{ type: string }];
    expect(entry.type).toBe('registered');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'create' }));
  });

  it('refuses a branch the caller’s itAsset.create does not reach — nothing is written', async () => {
    await expect(
      itMobileLineService.register({ ...input, branchId: ELSEWHERE }, ctx),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.createLine).not.toHaveBeenCalled();
  });
});

describe('editing a line', () => {
  it('refuses to move a line somebody holds to another branch — it is returned first', async () => {
    mocks.findLine.mockResolvedValue(line({ status: 'assigned' }));
    const attempt = itMobileLineService.update(
      LINE,
      { branchId: ELSEWHERE, version: 2 },
      ctx,
      scope,
    );
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/return it before moving it/);
    expect(mocks.updateLine).not.toHaveBeenCalled();
  });

  it('still edits a held line’s other facts', async () => {
    mocks.findLine.mockResolvedValue(line({ status: 'assigned' }));
    mocks.updateLine.mockImplementation(async (_id: string, set: Record<string, unknown>) => ({
      ...line({ status: 'assigned' }),
      ...set,
    }));
    await itMobileLineService.update(LINE, { ratePlan: 'Flex 120', version: 2 }, ctx, scope);
    expect(mocks.updateLine).toHaveBeenCalledWith(
      LINE,
      { ratePlan: 'Flex 120' },
      expect.objectContaining({ version: 2 }),
    );
    const [entry] = mocks.appendEvent.mock.calls[0] as [{ metadata: { fields: string[] } }];
    expect(entry.metadata.fields).toEqual(['ratePlan']);
  });

  it('refuses a move into a branch the caller’s itAsset.edit does not reach', async () => {
    mocks.findLine.mockResolvedValue(line());
    await expect(
      itMobileLineService.update(LINE, { branchId: ELSEWHERE, version: 2 }, ctx, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses an eSIM that keeps the card serial it had — the line as it ENDS UP', async () => {
    mocks.findLine.mockResolvedValue(line());
    await expect(
      itMobileLineService.update(LINE, { simKind: 'esim', version: 2 }, ctx, scope),
    ).rejects.toThrow(/eSIM has no card serial/);
    expect(mocks.updateLine).not.toHaveBeenCalled();
  });

  it('refuses a serial typed onto a line that is an eSIM', async () => {
    mocks.findLine.mockResolvedValue(line({ simKind: 'esim', simSerial: null }));
    await expect(
      itMobileLineService.update(
        LINE,
        { simSerial: '8920022022712847788', version: 2 },
        ctx,
        scope,
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('makes a line an eSIM when its serial is cleared with it', async () => {
    mocks.findLine.mockResolvedValue(line());
    await itMobileLineService.update(
      LINE,
      { simKind: 'esim', simSerial: null, version: 2 },
      ctx,
      scope,
    );
    expect(mocks.updateLine).toHaveBeenCalledWith(
      LINE,
      { simKind: 'esim', simSerial: null },
      expect.anything(),
    );
  });
});

describe('the register’s filters', () => {
  const filterOf = (): Record<string, unknown> =>
    (mocks.listLines.mock.calls[0] as [{ filter: Record<string, unknown> }])[0].filter;

  it('reads by network then number when no column is asked for', async () => {
    await itMobileLineService.list({ page: 1, pageSize: 25, sortDir: 'desc' }, scope);
    const [params] = mocks.listLines.mock.calls[0] as [{ sorts: unknown }];
    expect(params.sorts).toEqual([
      { by: 'network', dir: 'asc' },
      { by: 'phoneNumber', dir: 'asc' },
    ]);
  });

  it('matches the pressed networks, and a holder through the OPEN interval', async () => {
    const open = [new Types.ObjectId()];
    mocks.openIdsMatching.mockResolvedValue(open);
    const EMPLOYEE = String(new Types.ObjectId());

    await itMobileLineService.list(
      {
        page: 1,
        pageSize: 25,
        sortDir: 'desc',
        networks: ['vodafone', 'orange'],
        holderEmployeeId: EMPLOYEE,
        holderKind: 'employee',
      },
      scope,
    );

    expect(filterOf()).toMatchObject({
      network: { $in: ['vodafone', 'orange'] },
      currentAssignmentId: { $in: open },
    });
    // Both holder facts in ONE read of the open intervals — the intersection, not two lists.
    expect(mocks.openIdsMatching).toHaveBeenCalledWith({
      employeeId: EMPLOYEE,
      holderKind: 'employee',
    });
  });

  it('searches a number typed in Arabic digits, literally, and a car’s code or plate', async () => {
    const byCar = [new Types.ObjectId()];
    mocks.openIdsMatching.mockResolvedValue(byCar);

    await itMobileLineService.list(
      { page: 1, pageSize: 25, sortDir: 'desc', search: '٠١٠.٣' },
      scope,
    );

    const { $or } = filterOf() as { $or: Record<string, unknown>[] };
    const [byNumber] = $or;
    // The digits as the register stores them — the separator is not part of the number.
    expect(String(byNumber?.phoneNumber)).toBe(String(/0103/));
    expect($or).toContainEqual({ currentAssignmentId: { $in: byCar } });
  });

  it('finds a pasted number and a card serial in its printed groups', async () => {
    mocks.openIdsMatching.mockResolvedValue([]);

    // Copied from a chat: the international prefix, spaces and an invisible direction mark.
    await itMobileLineService.list(
      { page: 1, pageSize: 25, sortDir: 'desc', search: '\u200e+20 10 1234 5678' },
      scope,
    );
    const pasted = (filterOf() as { $or: Record<string, unknown>[] }).$or;
    expect(String(pasted[0]?.phoneNumber)).toBe(String(/01012345678/));
    expect(String(pasted[1]?.simSerial)).toBe(String(/01012345678/));

    await itMobileLineService.list(
      { page: 1, pageSize: 25, sortDir: 'desc', search: '8920 0220 2271' },
      scope,
    );
    const last = mocks.listLines.mock.calls.at(-1) as [
      { filter: { $or: Record<string, unknown>[] } },
    ];
    const card = last[0].filter.$or;
    expect(String(card[1]?.simSerial)).toBe(String(/892002202271/));
    // A plan or a note is matched as typed.
    expect(String(card[2]?.ratePlan)).toBe(String(/8920 0220 2271/i));
  });
});

describe('the network cards', () => {
  it('always names the three networks, in order, and a network with no lines counts zero', () => {
    const summary = summarizeMobileLines({
      statuses: [
        { _id: { network: 'vodafone', key: 'inStock' }, count: 2 },
        { _id: { network: 'vodafone', key: 'assigned' }, count: 5 },
        { _id: { network: 'orange', key: 'suspended' }, count: 1 },
      ],
      accounts: [
        { _id: { network: 'vodafone', key: '8.29280625.1' }, count: 3 },
        { _id: { network: 'vodafone', key: null }, count: 4 },
        { _id: { network: 'orange', key: '6.293541' }, count: 1 },
      ],
      ratePlans: [
        { _id: { network: 'vodafone', key: 'Flex 80' }, count: 4 },
        { _id: { network: 'vodafone', key: 'Flex 120' }, count: 4 },
      ],
    });

    expect(summary.networks.map((n) => n.network)).toEqual(['vodafone', 'etisalat', 'orange']);
    expect(summary.networks[0]).toMatchObject({ total: 7, inStock: 2, assigned: 5, suspended: 0 });
    expect(summary.networks[1]).toEqual({
      network: 'etisalat',
      total: 0,
      inStock: 0,
      assigned: 0,
      suspended: 0,
      accounts: [],
      ratePlans: [],
    });
    // Largest first; «no account» kept as null rather than dropped.
    expect(summary.networks[0]?.accounts).toEqual([
      { value: null, count: 4 },
      { value: '8.29280625.1', count: 3 },
    ]);
    // Equal counts read the same every time.
    expect(summary.networks[0]?.ratePlans.map((p) => p.value)).toEqual(['Flex 120', 'Flex 80']);
    expect(summary.networks[2]).toMatchObject({ total: 1, suspended: 1 });
  });
});

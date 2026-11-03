// «وزود الفلتر بتاع الجدول ببيانات الجدول» — a filter for each of the custody register's columns.
// Then «وفى /it/custody بردو عايز الصنف يبقي بعد الفئة ... والأتنين يكونوا Multiselect» — several
// categories, and «الصنف» as several of the register's asset names.
//
// Then the dashboard's «أصول مع موظفين تركوا العمل» opened as a list: «حالة المستلِم», the holders
// HR shows as having left — read live, the holders once and HR once, and only when asked.
//
// Four things are pinned here, and the third is the one a later tidy-up would most likely break:
//   1. how each filter becomes a database condition — pure, so it is asserted on the condition
//      itself: every filter its own clause, so two that touch one field narrow together;
//   2. the asset-side filters — any chosen category, any chosen name EXACTLY (a name holding a
//      comma arriving whole), and the search, all ANDed;
//   3. what the search matches — the asset's code, name or serial, typed in either digit set, its
//      characters taken literally;
//   4. that the sets a filter names (the assets, the signed receipts) are read ONCE, under the
//      right scope, and only when a filter asks — the data layer is mocked so what is tested is
//      the decision, not Mongo.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListItAssignmentsQuerySchema, joinNameList } from '@ecms/contracts';
import type * as AssignmentRepositoryModule from './assignment.repository';

const mocks = vi.hoisted(() => ({
  idsMatching: vi.fn(),
  findById: vi.fn(),
  signedIds: vi.fn(),
  listFiltered: vi.fn(),
  countByHolder: vi.fn(),
  getDirectoryEmployees: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  getDirectoryEmployees: mocks.getDirectoryEmployees,
}));
vi.mock('./asset.repository', () => ({
  itAssetRepository: { idsMatching: mocks.idsMatching, findById: mocks.findById },
}));
vi.mock('./receipt.repository', () => ({
  itCustodyReceiptRepository: { signedIds: mocks.signedIds },
}));
// The repository's PAGE read is mocked; its filter translation is the real one, pinned below.
vi.mock('./assignment.repository', async (importOriginal) => ({
  ...(await importOriginal<typeof AssignmentRepositoryModule>()),
  itAssetAssignmentRepository: {
    listFiltered: mocks.listFiltered,
    countByHolder: mocks.countByHolder,
  },
}));

const { assignmentRegisterFilter } = await import('./assignment.repository');
const { exitedHolderIds, itAssetAssignmentService, registerAssetFilter } =
  await import('./assignment.service');

const NOW = new Date('2026-10-28T10:00:00.000Z');
const id = (): Types.ObjectId => new Types.ObjectId();

describe('each register filter as a database condition', () => {
  it('asks nothing when no filter is set', () => {
    expect(assignmentRegisterFilter({}, NOW)).toEqual({});
  });

  it('keeps the status filter as it was: out, or returned', () => {
    expect(assignmentRegisterFilter({ open: true }, NOW)).toEqual({ returnedAt: null });
    expect(assignmentRegisterFilter({ open: false }, NOW)).toEqual({ returnedAt: { $ne: null } });
  });

  it('narrows to the assets «الصنف» and the category matched — together with an asset named outright', () => {
    const asset = id();
    const matched = [id(), id()];
    expect(assignmentRegisterFilter({ assetIds: matched }, NOW)).toEqual({
      assetId: { $in: matched },
    });
    // Both read `assetId`: as separate clauses neither overwrites the other.
    expect(assignmentRegisterFilter({ assetId: String(asset), assetIds: matched }, NOW)).toEqual({
      $and: [{ assetId: asset }, { assetId: { $in: matched } }],
    });
  });

  it('answers NOTHING when nothing matched the asset-side filters — never the whole register', () => {
    expect(assignmentRegisterFilter({ assetIds: [] }, NOW)).toEqual({ assetId: { $in: [] } });
  });

  it('reads «تاريخ التسليم» as whole CAIRO days: from its first moment, to the end of its last', () => {
    // October 2026 is summer time in Cairo (UTC+3) until the night of the 29th.
    const from = new Date('2026-10-01T00:00:00.000Z');
    expect(assignmentRegisterFilter({ assignedFrom: from }, NOW)).toEqual({
      assignedAt: { $gte: new Date('2026-09-30T21:00:00.000Z') },
    });
    // The screen sends the day; whatever hour it carries, «إلى» runs to Cairo's midnight after it.
    for (const to of ['2026-10-15T00:00:00.000Z', '2026-10-15T13:45:00.000Z']) {
      expect(assignmentRegisterFilter({ assignedTo: new Date(to) }, NOW)).toEqual({
        assignedAt: { $lt: new Date('2026-10-15T21:00:00.000Z') },
      });
    }
    // The month's last day ends after summer time did: midnight at UTC+2.
    expect(
      assignmentRegisterFilter({ assignedFrom: from, assignedTo: new Date('2026-10-31') }, NOW),
    ).toEqual({
      assignedAt: {
        $gte: new Date('2026-09-30T21:00:00.000Z'),
        $lt: new Date('2026-10-31T22:00:00.000Z'),
      },
    });
  });

  it('files a hand-over typed after midnight in Cairo under the day the table prints', () => {
    // 28 October 01:30 in Cairo is 27 October 22:30 UTC — the row reads «28 أكتوبر».
    const handedOver = new Date('2026-10-27T22:30:00.000Z');
    const day = new Date('2026-10-28');
    const window = assignmentRegisterFilter({ assignedFrom: day, assignedTo: day }, NOW) as {
      assignedAt: { $gte: Date; $lt: Date };
    };
    expect(handedOver >= window.assignedAt.$gte && handedOver < window.assignedAt.$lt).toBe(true);
  });

  it('reads «تاريخ الاسترجاع» the same way, on the return — beside the status, not instead of it', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    expect(
      assignmentRegisterFilter(
        { open: false, returnedFrom: from, returnedTo: new Date('2026-09-30') },
        NOW,
      ),
    ).toEqual({
      $and: [
        { returnedAt: { $ne: null } },
        {
          returnedAt: {
            $gte: new Date('2026-08-31T21:00:00.000Z'),
            $lt: new Date('2026-09-30T21:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('calls an interval overdue only while it is still out, past a due date it has', () => {
    expect(assignmentRegisterFilter({ overdue: true }, NOW)).toEqual({
      $and: [{ returnedAt: null }, { expectedReturnAt: { $lt: NOW } }],
    });
    // `false` is the complement, as `open: false` is: returned, no due date, or not due yet.
    expect(assignmentRegisterFilter({ overdue: false }, NOW)).toEqual({
      $or: [
        { returnedAt: { $ne: null } },
        { expectedReturnAt: null },
        { expectedReturnAt: { $gte: NOW } },
      ],
    });
  });

  it('reads «إيصال الاستلام» as the receipt column does: none, signed, or awaiting the signature', () => {
    const signed = [id(), id()];
    expect(assignmentRegisterFilter({ receipt: { state: 'none' } }, NOW)).toEqual({
      receiptId: null,
    });
    expect(
      assignmentRegisterFilter({ receipt: { state: 'signed', signedReceiptIds: signed } }, NOW),
    ).toEqual({ receiptId: { $in: signed } });
    // Awaiting: a paper, and not one of the signed — the same yes/no the row's badge shows.
    expect(
      assignmentRegisterFilter({ receipt: { state: 'unsigned', signedReceiptIds: signed } }, NOW),
    ).toEqual({ receiptId: { $ne: null, $nin: signed } });
  });

  it('reads «حالة المستلِم» as the leavers HR named — and every other holder for «على رأس العمل»', () => {
    const leavers = [id(), id()];
    expect(
      assignmentRegisterFilter({ holderExited: { exited: true, exitedEmployeeIds: leavers } }, NOW),
    ).toEqual({ assignedToEmployeeId: { $in: leavers } });
    expect(
      assignmentRegisterFilter(
        { holderExited: { exited: false, exitedEmployeeIds: leavers } },
        NOW,
      ),
    ).toEqual({ assignedToEmployeeId: { $nin: leavers } });
    // Nobody has left: «ترك العمل» is honestly empty, «على رأس العمل» everybody.
    expect(
      assignmentRegisterFilter({ holderExited: { exited: true, exitedEmployeeIds: [] } }, NOW),
    ).toEqual({ assignedToEmployeeId: { $in: [] } });
    // Beside the holder named outright: both read the holder, so neither overwrites the other.
    const employee = id();
    expect(
      assignmentRegisterFilter(
        {
          employeeId: String(employee),
          holderExited: { exited: true, exitedEmployeeIds: leavers },
        },
        NOW,
      ),
    ).toEqual({
      $and: [{ assignedToEmployeeId: employee }, { assignedToEmployeeId: { $in: leavers } }],
    });
  });

  it('combines every filter with the ones the register already had', () => {
    const employee = id();
    const branch = id();
    const matched = [id()];
    const filter = assignmentRegisterFilter(
      {
        open: true,
        assetIds: matched,
        employeeId: String(employee),
        branchId: String(branch),
        assignedFrom: new Date('2026-10-01'),
        overdue: true,
        receipt: { state: 'none' },
      },
      NOW,
    );
    expect(filter).toEqual({
      $and: [
        { returnedAt: null },
        { assetId: { $in: matched } },
        { assignedToEmployeeId: employee },
        { branchId: branch },
        { assignedAt: { $gte: new Date('2026-09-30T21:00:00.000Z') } },
        { returnedAt: null },
        { expectedReturnAt: { $lt: NOW } },
        { receiptId: null },
      ],
    });
  });
});

describe('the categories and «الصنف» — the asset-side multi-select filters', () => {
  const LAPTOPS = id();
  const SCREENS = id();
  /** The query as the address bar sends it, read the way the route reads it. */
  const fromWire = (raw: Record<string, string>) =>
    registerAssetFilter(ListItAssignmentsQuerySchema.parse(raw));

  it('matches an asset in ANY of the chosen categories — and a single id still reads', () => {
    expect(fromWire({ categoryId: `${String(LAPTOPS)},${String(SCREENS)}` })).toEqual({
      categoryId: { $in: [LAPTOPS, SCREENS] },
    });
    expect(fromWire({ categoryId: String(LAPTOPS) })).toEqual({ categoryId: { $in: [LAPTOPS] } });
  });

  /** «الصنف» commits the asset register's own names, so a pick is every asset by THAT name. */
  it('matches ANY of the chosen names, each exactly — never as part of a longer name', () => {
    expect(fromWire({ assetName: 'Lenovo ThinkPad,شاشة Dell' })).toEqual({
      name: { $in: ['Lenovo ThinkPad', 'شاشة Dell'] },
    });
  });

  it('keeps a name holding a comma whole, from the address bar to the filter', () => {
    const names = ['Raml, Station', 'HP, LaserJet, M402', 'طابعة'];
    expect(fromWire({ assetName: joinNameList(names) })).toEqual({ name: { $in: names } });
  });

  it('ANDs the categories, the names and the search into one asset filter', () => {
    const filter = fromWire({
      categoryId: `${String(LAPTOPS)},${String(SCREENS)}`,
      assetName: 'Lenovo ThinkPad',
      search: 'PF5',
    });
    expect(filter?.categoryId).toEqual({ $in: [LAPTOPS, SCREENS] });
    expect(filter?.name).toEqual({ $in: ['Lenovo ThinkPad'] });
    // The search keeps its own clause over code, name and serial — beside the exact names.
    expect((filter?.$or as unknown[] | undefined)?.length).toBe(3);
  });

  it('is nothing at all when every list is empty', () => {
    expect(fromWire({ categoryId: '', assetName: '', search: '' })).toBeNull();
    expect(registerAssetFilter({ categoryId: undefined, assetName: undefined })).toBeNull();
  });
});

describe('what the search box matches', () => {
  const pattern = (search: string): RegExp => {
    const filter = registerAssetFilter({ search });
    const or = (filter?.$or ?? []) as Record<string, RegExp>[];
    // One pattern, over the three things a row names the asset by.
    expect(or.map((clause) => Object.keys(clause)[0])).toEqual([
      'assetCode',
      'name',
      'serialNumber',
    ]);
    const first = or[0]?.assetCode;
    expect(or.every((clause) => Object.values(clause)[0] === first)).toBe(true);
    return first as RegExp;
  };

  it('is nothing at all when neither it nor the category is set', () => {
    expect(registerAssetFilter({})).toBeNull();
    expect(registerAssetFilter({ search: '   ' })).toBeNull();
    // A box holding only the invisible marks a paste brings is an empty box.
    expect(registerAssetFilter({ search: '\u200f\u200e' })).toBeNull();
  });

  it('finds the code, the name or the serial anywhere in it, whatever the letter case', () => {
    expect(pattern('lenovo').test('Lenovo ThinkCentre neo 50a 24')).toBe(true);
    expect(pattern('ast-0012').test('AST-00121')).toBe(true);
    expect(pattern('kx8z').test('PF5KX8ZT')).toBe(true);
  });

  it('takes what was typed literally — a bracket or a dot is not a pattern', () => {
    const literal = pattern('neo (50a)');
    expect(literal.test('Lenovo neo (50a)')).toBe(true);
    expect(literal.test('Lenovo neo 50a')).toBe(false);
    expect(pattern('A.B').test('AXB')).toBe(false);
  });

  it('folds Arabic-Indic digits and drops the direction marks a copied serial carries', () => {
    expect(pattern('٥٠a').test('neo 50a 24')).toBe(true);
    expect(pattern('۲۴').test('neo 50a 24')).toBe(true);
    expect(pattern('\u200ePF5KX8ZT\u200f').test('PF5KX8ZT')).toBe(true);
  });

  it('finds a name kept in Arabic digits by any digit set — the register keeps names as typed', () => {
    expect(pattern('24').test('شاشة ٢٤ بوصة')).toBe(true);
    expect(pattern('٢٤').test('شاشة ٢٤ بوصة')).toBe(true);
    expect(pattern('شاشة ٢٤ بوصة').test('شاشة ٢٤ بوصة')).toBe(true);
    expect(pattern('۲۴').test('شاشة ٢٤ بوصة')).toBe(true);
    // A digit is its own value in every set — never another digit.
    expect(pattern('25').test('شاشة ٢٤ بوصة')).toBe(false);
  });

  it('narrows by the category alone, or by the category AND the text', () => {
    const category = id();
    expect(registerAssetFilter({ categoryId: [String(category)] })).toEqual({
      categoryId: { $in: [category] },
    });
    const both = registerAssetFilter({ categoryId: [String(category)], search: 'Lenovo' });
    expect(both?.categoryId).toEqual({ $in: [category] });
    expect(both?.$or).toHaveLength(3);
  });
});

describe('the register reads each set a filter names once, and only when asked', () => {
  const scope = {
    scope: 'branch',
    userId: String(id()),
    branchId: String(id()),
    departmentId: null,
    sectionId: null,
  } as const;
  const page = { items: [], meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 } };
  const query = (raw: Record<string, string>) => ListItAssignmentsQuerySchema.parse(raw);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFiltered.mockResolvedValue(page);
  });

  it('reads nothing beyond the page when only the interval’s own filters are set', async () => {
    const employee = String(id());
    await itAssetAssignmentService.list(
      query({ open: 'true', employeeId: employee, assignedFrom: '2026-10-01', overdue: 'true' }),
      scope,
    );
    expect(mocks.idsMatching).not.toHaveBeenCalled();
    expect(mocks.signedIds).not.toHaveBeenCalled();
    expect(mocks.listFiltered).toHaveBeenCalledTimes(1);
    const params = mocks.listFiltered.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      open: true,
      employeeId: employee,
      assignedFrom: new Date('2026-10-01T00:00:00.000Z'),
      overdue: true,
      assetIds: undefined,
      receipt: undefined,
      page: 1,
      pageSize: 25,
      scope,
    });
    expect(params.now).toBeInstanceOf(Date);
  });

  it('reads the matching assets ONCE, under the caller’s scope, for the categories, «الصنف» and the search together', async () => {
    const laptops = String(id());
    const screens = String(id());
    const matched = [id(), id()];
    mocks.idsMatching.mockResolvedValue(matched);
    await itAssetAssignmentService.list(
      query({
        search: 'Lenovo',
        categoryId: `${laptops},${screens}`,
        assetName: joinNameList(['Lenovo ThinkPad', 'Raml, Station']),
      }),
      scope,
    );
    expect(mocks.idsMatching).toHaveBeenCalledTimes(1);
    const [filter, readScope] = mocks.idsMatching.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(filter.categoryId).toEqual({
      $in: [new Types.ObjectId(laptops), new Types.ObjectId(screens)],
    });
    expect(filter.name).toEqual({ $in: ['Lenovo ThinkPad', 'Raml, Station'] });
    expect(filter.$or).toHaveLength(3);
    expect(readScope).toBe(scope);
    expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({ assetIds: matched });
  });

  it('hands an empty match on as an empty set — the register then answers nothing', async () => {
    mocks.idsMatching.mockResolvedValue([]);
    await itAssetAssignmentService.list(query({ search: 'لا يوجد' }), scope);
    expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({ assetIds: [] });
  });

  it('reads the signed receipts once for «موقّع» or «بانتظار التوقيع», and not at all for «بدون إيصال»', async () => {
    const signed = [id()];
    mocks.signedIds.mockResolvedValue(signed);
    for (const state of ['signed', 'unsigned'] as const) {
      vi.clearAllMocks();
      mocks.listFiltered.mockResolvedValue(page);
      mocks.signedIds.mockResolvedValue(signed);
      await itAssetAssignmentService.list(query({ receipt: state }), scope);
      expect(mocks.signedIds).toHaveBeenCalledTimes(1);
      expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({
        receipt: { state, signedReceiptIds: signed },
      });
    }
    vi.clearAllMocks();
    mocks.listFiltered.mockResolvedValue(page);
    await itAssetAssignmentService.list(query({ receipt: 'none' }), scope);
    expect(mocks.signedIds).not.toHaveBeenCalled();
    expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({ receipt: { state: 'none' } });
  });

  it('asks HR about the holders only when «حالة المستلِم» is set', async () => {
    await itAssetAssignmentService.list(query({ open: 'true' }), scope);
    expect(mocks.countByHolder).not.toHaveBeenCalled();
    expect(mocks.getDirectoryEmployees).not.toHaveBeenCalled();
    expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({ holderExited: undefined });
  });

  it('reads the holders of the rows every OTHER filter keeps once, and asks HR about them in one batch', async () => {
    const leaver = String(id());
    const employed = String(id());
    const matched = [id()];
    mocks.idsMatching.mockResolvedValue(matched);
    mocks.countByHolder.mockResolvedValue(
      new Map([
        [leaver, 2],
        [employed, 1],
      ]),
    );
    mocks.getDirectoryEmployees.mockResolvedValue(
      new Map([
        [leaver, { status: 'exited' }],
        [employed, { status: 'onLeave' }],
      ]),
    );
    const branch = String(id());
    for (const [raw, exited] of [
      ['true', true],
      ['false', false],
    ] as const) {
      vi.clearAllMocks();
      mocks.listFiltered.mockResolvedValue(page);
      await itAssetAssignmentService.list(
        query({ open: 'true', branchId: branch, categoryId: String(id()), holderExited: raw }),
        scope,
      );
      // Narrowed by the others — out, in this branch, in the chosen category — under the scope.
      expect(mocks.countByHolder).toHaveBeenCalledTimes(1);
      expect(mocks.countByHolder).toHaveBeenCalledWith(
        {
          $and: [
            { returnedAt: null },
            { assetId: { $in: matched } },
            { branchId: new Types.ObjectId(branch) },
          ],
        },
        scope,
      );
      expect(mocks.getDirectoryEmployees).toHaveBeenCalledTimes(1);
      // On leave is still employed: only the leaver is named.
      expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({
        holderExited: { exited, exitedEmployeeIds: [new Types.ObjectId(leaver)] },
      });
    }
  });

  it('names nobody a leaver whom HR does not know, nor anything that is not an id', () => {
    const known = String(id());
    const stranger = String(id());
    expect(
      exitedHolderIds(
        [known, stranger, 'not-an-id'],
        new Map([
          [known, { status: 'exited' as const }],
          ['not-an-id', { status: 'exited' as const }],
        ]),
      ),
    ).toEqual([new Types.ObjectId(known)]);
  });

  it('hands an empty set on when nobody holds anything, without asking HR', async () => {
    mocks.countByHolder.mockResolvedValue(new Map());
    await itAssetAssignmentService.list(query({ holderExited: 'true' }), scope);
    expect(mocks.getDirectoryEmployees).not.toHaveBeenCalled();
    expect(mocks.listFiltered.mock.calls[0]?.[0]).toMatchObject({
      holderExited: { exited: true, exitedEmployeeIds: [] },
    });
  });

  it('leaves an asset’s own custody chain unfiltered by the register’s columns', async () => {
    const asset = String(id());
    mocks.findById.mockResolvedValue({ _id: new Types.ObjectId(asset) });
    await itAssetAssignmentService.listForAsset(
      asset,
      query({ search: 'Lenovo', receipt: 'signed', overdue: 'true' }),
      scope,
    );
    expect(mocks.idsMatching).not.toHaveBeenCalled();
    expect(mocks.signedIds).not.toHaveBeenCalled();
    const params = mocks.listFiltered.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.assetId).toBe(asset);
    expect(params).not.toHaveProperty('overdue');
    expect(params).not.toHaveProperty('receipt');
  });
});

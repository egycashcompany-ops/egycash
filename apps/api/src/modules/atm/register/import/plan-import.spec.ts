// The plan's decisions (spec §6.4, §10.2) against an IN-MEMORY world: which rows link, reactivate,
// create or cannot couple; which blockers stand; and that a branch out of the importer's reach
// yields nothing. Codes, names and key values are synthetic.
import { describe, expect, it } from 'vitest';
import {
  atmBankSeedOf,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterImportCategoryDto,
  type DataScope,
} from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { type ParsedRegisterFile, type ParsedRow, type RegisterRowValues } from './parse-rows';
import {
  planRegisterImport,
  type ImportPlan,
  type PlanMaster,
  type PlanStoredEntry,
  type PlanWorld,
} from './plan-import';

const ALEX = '64b000000000000000000004';
const TANTA = '64b000000000000000000002';
const USER = '64b0000000000000000000aa';
const FAKE_KEY = 'FAKE-KEY-0042';

const ctxOf = (
  permissions: Record<string, DataScope>,
  branchId: string | null = null,
): AuthContext => ({
  userId: USER,
  sessionId: 'spec',
  branchId,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});
const ORG = ctxOf({
  'atmRegister.import': 'organization',
  'atmRegister.viewSecrets': 'organization',
});

const nulls = <T extends string>(fields: readonly T[]): Record<T, null> =>
  Object.fromEntries(fields.map((f) => [f, null])) as Record<T, null>;

let nextRow = 3;
const parsedRow = (
  values: Partial<RegisterRowValues>,
  extra: Partial<ParsedRow> = {},
): ParsedRow => {
  const full: RegisterRowValues = {
    ...nulls([
      'operationType',
      'vendor',
      'model',
      'serial',
      'openTime',
      'closeTime',
      'accessHoursNotes',
      'receiptNotes',
      'locationPlusCode',
      'endDate',
      'receivedByName',
      'handoverName',
      'handoverNotes',
      'locationUrl',
      'hub',
    ] as const),
    keys: nulls([
      'supervisorCode',
      'supervisorCount',
      'safeDoorCount',
      'alanki',
      'combinationKeyCode',
      'combinationKeyCount',
      'cashUnitCode',
      'cashUnitCount',
    ] as const),
    cassettes: nulls([
      'withdrawalType',
      'withdrawalCount',
      'withdrawal1',
      'withdrawal2',
      'withdrawal3',
      'withdrawal4',
      'withdrawal5',
      'depositType',
      'depositCount',
      'collectionCount',
      'recycle200',
      'recycle100',
      'recycle50',
      'spareCount',
      'spare1',
      'spare2',
      'spare3',
      'spare4',
      'spare5',
    ] as const),
    branchCode: 'EGYCASH-4',
    area: 'Smouha',
    bankCode: 'NBE',
    machineCode: null,
    name: 'Synthetic ATM',
    startDate: '2025-01-01',
    ...values,
  };
  const status = full.endDate !== null ? 'ended' : full.startDate !== null ? 'open' : 'pending';
  return {
    importRow: nextRow++,
    values: full,
    status,
    issues: [],
    legacyMarks: null,
    plaintextCombination: null,
    openPeriodExempt: false,
    branchCellPresent: full.branchCode !== null,
    dateUnreadable: false,
    carriesSecrets: false,
    ...extra,
  };
};

const file = (rows: ParsedRow[]): ParsedRegisterFile => ({
  rows,
  headerFills: [],
  sentinelRow: null,
  lastDataRow: rows.at(-1)?.importRow ?? 2,
});

const master = (over: Partial<PlanMaster> & { machineCode: string }): PlanMaster => ({
  id: `m-${over.machineCode}`,
  branchId: ALEX,
  name: 'Synthetic ATM',
  area: 'Smouha',
  bankName: 'NBE',
  isActive: true,
  ...over,
});

const world = (over: Partial<PlanWorld> = {}): PlanWorld => {
  const codes = new Map<AtmRegisterBranchCode, string>([
    ['EGYCASH-4', ALEX],
    ['EGYCASH-2', TANTA],
  ]);
  return {
    settings: {
      branchIdByCode: codes,
      codeByBranchId: new Map([...codes].map(([code, id]) => [id, code])),
      // The seeds' own labels — what the catalog holds until someone curates it (DEC-35).
      opsLabel: (bank: AtmBankCode) => atmBankSeedOf(bank)?.opsLabel ?? bank,
    },
    branches: new Map([
      [ALEX, { name: { en: 'Alexandria', ar: 'الإسكندرية' }, active: true }],
      [TANTA, { name: { en: 'Tanta', ar: 'طنطا' }, active: true }],
    ]),
    masters: [],
    imported: new Map(),
    openByCode: new Map(),
    nbeForexBranchIds: new Set(),
    runInProgress: false,
    secretStoreAvailable: true,
    ...over,
  };
};

const category = (
  plan: ImportPlan,
  key: AtmRegisterImportCategoryDto['key'],
): AtmRegisterImportCategoryDto => {
  const found = plan.categories.find((c) => c.key === key);
  if (found === undefined) throw new Error(`no category ${key}`);
  return found;
};
const rowsOf = (plan: ImportPlan, key: AtmRegisterImportCategoryDto['key']): number[] =>
  category(plan, key).items.map((i) => i.importRow);

describe('reconciliation of open rows', () => {
  it('link adopts the master label and lists differences; a blank-area row with an active master links', () => {
    const differs = parsedRow({ machineCode: '99990001', bankCode: 'BM', name: 'Other name' });
    const blankArea = parsedRow({ machineCode: '99990002', area: null });
    const plan = planRegisterImport(
      file([differs, blankArea]),
      world({
        masters: [
          master({ machineCode: '99990001', bankName: 'MISR' }),
          master({ machineCode: '99990002' }),
        ],
      }),
      ORG,
    );
    const link = category(plan, 'link');
    expect(link.approvable).toBe(true);
    expect(link.items).toEqual([
      expect.objectContaining({
        importRow: differs.importRow,
        machineId: 'm-99990001',
        masterBankLabel: 'MISR',
        differences: ['name'],
      }),
      expect.objectContaining({ importRow: blankArea.importRow, differences: ['area'] }),
    ]);
  });

  it('reactivate an archived master, create a missing one', () => {
    const archived = parsedRow({ machineCode: '99990003' });
    const missing = parsedRow({ machineCode: '99990004' });
    const plan = planRegisterImport(
      file([archived, missing]),
      world({ masters: [master({ machineCode: '99990003', isActive: false })] }),
      ORG,
    );
    expect(category(plan, 'reactivate').items).toEqual([
      expect.objectContaining({ importRow: archived.importRow, machineId: 'm-99990003' }),
    ]);
    expect(rowsOf(plan, 'create')).toEqual([missing.importRow]);
  });

  it('cannot couple: blank area, no name, no bank, no code, placeholder', () => {
    const rows = [
      parsedRow({ machineCode: '99990005', area: null }),
      parsedRow({ machineCode: '99990006', name: null }),
      parsedRow({ machineCode: '99990007', bankCode: null }),
      parsedRow({ machineCode: null }),
      parsedRow({ machineCode: '#' }),
    ];
    const plan = planRegisterImport(file(rows), world(), ORG);
    expect(category(plan, 'cannotCouple').items.map((i) => i.reason)).toEqual([
      'blankArea',
      'noName',
      'noBank',
      'noCode',
      'placeholderCode',
    ]);
    expect(category(plan, 'cannotCouple').approvable).toBe(false);
  });

  it('activeElsewhere is its own report category with from → to pairs', () => {
    const rows = [parsedRow({ machineCode: '99990008' }), parsedRow({ machineCode: '99990009' })];
    const plan = planRegisterImport(
      file(rows),
      world({
        masters: [
          master({ machineCode: '99990008', branchId: TANTA }),
          master({ machineCode: '99990009', branchId: TANTA }),
          // A master in Alex as well does not save the row: DEC-9 is checked first.
          master({ machineCode: '99990009', branchId: ALEX }),
        ],
      }),
      ORG,
    );
    const elsewhere = category(plan, 'activeElsewhere');
    expect(elsewhere.items.map((i) => [i.reason, i.otherBranchCode])).toEqual([
      ['activeElsewhere', 'EGYCASH-2'],
      ['activeElsewhere', 'EGYCASH-2'],
    ]);
    expect(elsewhere.pairs).toEqual([
      expect.objectContaining({ fromBranchCode: 'EGYCASH-2', toBranchCode: 'EGYCASH-4', count: 2 }),
    ]);
    expect(rowsOf(plan, 'link')).toEqual([]);
  });

  it('the second row of a duplicate-open pair links to the master the first one creates', () => {
    const first = parsedRow({ machineCode: '99990010' }, { openPeriodExempt: true });
    const second = parsedRow(
      { machineCode: '99990010', name: 'Second name' },
      { openPeriodExempt: true },
    );
    const plan = planRegisterImport(file([first, second]), world(), ORG);
    expect(rowsOf(plan, 'create')).toEqual([first.importRow]);
    expect(category(plan, 'link').items).toEqual([
      expect.objectContaining({
        importRow: second.importRow,
        machineId: null,
        masterBankLabel: 'NBE',
        differences: ['name'],
      }),
    ]);
  });

  it('nbeForex: applicable with the branch label, labelMissing without, keepsMasterLabel on a link', () => {
    const fx = parsedRow({ machineCode: '99990011', area: 'Smouha FX' });
    const fxTanta = parsedRow({
      machineCode: '99990012',
      branchCode: 'EGYCASH-2',
      area: 'Tanta fx',
    });
    const fxLinked = parsedRow({ machineCode: '99990013', area: 'Smouha FX' });
    const notFx = parsedRow({ machineCode: '99990014', area: 'FXville' });
    const plan = planRegisterImport(
      file([fx, fxTanta, fxLinked, notFx]),
      world({ nbeForexBranchIds: new Set([ALEX]), masters: [master({ machineCode: '99990013' })] }),
      ORG,
    );
    const forex = category(plan, 'nbeForex');
    expect(forex.items.map((i) => [i.importRow, i.reason])).toEqual([
      [fx.importRow, null],
      [fxTanta.importRow, 'labelMissing'],
      [fxLinked.importRow, 'keepsMasterLabel'],
    ]);
    expect(forex.count).toBe(1);
  });

  it('activeMasterWithoutOpenEntry lists in-reach masters with no open period anywhere', () => {
    const row = parsedRow({ machineCode: '99990015' });
    const tantaRow = parsedRow({ machineCode: '99990016', branchCode: 'EGYCASH-2' });
    const plan = planRegisterImport(
      file([row, tantaRow]),
      world({
        masters: [
          master({ machineCode: '99990015' }), // has its open row → linked
          master({ machineCode: '99990017' }), // nothing open → listed
          master({ machineCode: '99990018' }), // open in the register → not listed
          master({ machineCode: '99990019', branchId: TANTA }), // Tanta, out of reach below
        ],
        openByCode: new Map([['99990018', [{ id: 'e-18', branchId: ALEX, importRow: null }]]]),
      }),
      ctxOf({ 'atmRegister.import': 'branch', 'atmRegister.viewSecrets': 'branch' }, ALEX),
    );
    expect(category(plan, 'activeMasterWithoutOpenEntry').items.map((i) => i.machineCode)).toEqual([
      '99990017',
    ]);
  });
});

describe('blockers', () => {
  it('dateUnreadable', () => {
    const plan = planRegisterImport(
      file([parsedRow({ machineCode: '99990020' }, { dateUnreadable: true })]),
      world(),
      ORG,
    );
    expect(plan.blockers).toContain('dateUnreadable');
  });

  it('openInRegister — but never for an in-file pair', () => {
    const blocked = parsedRow({ machineCode: '99990021' });
    const pairA = parsedRow({ machineCode: '99990022' }, { openPeriodExempt: true });
    const pairB = parsedRow({ machineCode: '99990022' }, { openPeriodExempt: true });
    const imported = new Map<number, PlanStoredEntry>([
      [
        pairA.importRow,
        {
          id: 'e-pairA',
          importRow: pairA.importRow,
          branchId: ALEX,
          isDeleted: false,
          status: 'open',
          machineId: null,
          opsBankLabel: null,
          columns: new Map(),
        },
      ],
    ]);
    const plan = planRegisterImport(
      file([blocked, pairA, pairB]),
      world({
        imported,
        openByCode: new Map([
          ['99990021', [{ id: 'e-manual', branchId: TANTA, importRow: null }]],
          ['99990022', [{ id: 'e-pairA', branchId: ALEX, importRow: pairA.importRow }]],
        ]),
      }),
      ORG,
    );
    expect(plan.blockers).toContain('openInRegister');
    expect(category(plan, 'openInRegister').items).toEqual([
      expect.objectContaining({
        importRow: blocked.importRow,
        entryId: 'e-manual',
        otherBranchCode: 'EGYCASH-2',
      }),
    ]);
  });

  it('changedSinceImport lists the differing column letters, never values, and never AO', () => {
    const row = parsedRow(
      {
        machineCode: '99990023',
        endDate: '2025-06-01',
        handoverName: 'Receiver',
        keys: { ...parsedRow({}).values.keys, supervisorCode: FAKE_KEY },
      },
      { plaintextCombination: '11 - 22 - 33' },
    );
    const columns = new Map<string, string | null>();
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'AQ', 'J', 'AT', 'AR'])
      columns.set(letter, null);
    columns.set('A', 'EGYCASH-4');
    columns.set('B', 'Smouha');
    columns.set('C', 'NBE');
    columns.set('D', '99990023');
    columns.set('E', 'Synthetic ATM');
    columns.set('AQ', '2025-01-01');
    columns.set('AR', '2025-05-01'); // changed in the file
    columns.set('J', 'FAKE-KEY-OLD'); // changed in the file
    columns.set('AT', null); // added in the file
    const plan = planRegisterImport(
      file([row]),
      world({
        imported: new Map([
          [
            row.importRow,
            {
              id: 'e-23',
              importRow: row.importRow,
              branchId: ALEX,
              isDeleted: false,
              status: 'ended',
              machineId: null,
              opsBankLabel: null,
              columns,
            },
          ],
        ]),
      }),
      ORG,
    );
    expect(plan.blockers).toContain('changedSinceImport');
    const item = category(plan, 'changedSinceImport').items[0];
    expect(item?.columns).toEqual(['J', 'AR', 'AT']);
    expect(item?.entryId).toBe('e-23');
    const text = JSON.stringify(plan);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('FAKE-KEY-OLD');
    expect(text).not.toContain('11 - 22 - 33');
  });

  // SEC-1: the per-column comparison is an equality test, so it may only run over what the
  // importer could read — or a changing guess would read the stored value through the letters.
  describe('changedSinceImport is never an oracle (review finding SEC-1)', () => {
    const storedOf = (
      row: ParsedRow,
      branchId: string,
      over: Partial<Record<string, string | null>> = {},
    ): PlanStoredEntry => ({
      id: `e-${String(row.importRow)}`,
      importRow: row.importRow,
      branchId,
      isDeleted: false,
      status: 'ended',
      machineId: null,
      opsBankLabel: null,
      columns: new Map<string, string | null>(
        Object.entries({
          A: branchId === ALEX ? 'EGYCASH-4' : 'EGYCASH-2',
          B: row.values.area,
          C: row.values.bankCode,
          D: row.values.machineCode,
          E: row.values.name,
          AQ: row.values.startDate,
          AR: row.values.endDate,
          ...over,
        }),
      ),
    });
    const guess = (supervisorCode: string, receiptNotes: string | null = null): ParsedRow =>
      parsedRow({
        machineCode: '99990040',
        endDate: '2025-06-01',
        receiptNotes,
        keys: { ...parsedRow({}).values.keys, supervisorCode },
      });
    const columnsFor = (
      row: ParsedRow,
      stored: PlanStoredEntry,
      ctx: AuthContext,
    ): string[] | undefined =>
      category(
        planRegisterImport(
          file([row]),
          world({ imported: new Map([[row.importRow, stored]]) }),
          ctx,
        ),
        'changedSinceImport',
      ).items[0]?.columns;

    it('an importer without viewSecrets over the entry: the K columns are not compared', () => {
      const noSecrets = ctxOf({ 'atmRegister.import': 'organization' });
      for (const attempt of ['WRONG-GUESS', FAKE_KEY]) {
        const row = guess(attempt, 'a guessed note');
        const stored = storedOf(row, ALEX, { J: FAKE_KEY, AN: 'the real note' });
        expect(columnsFor(row, stored, noSecrets), attempt).toBeUndefined();
      }
      // Branch-scoped viewSecrets in Tanta does not cover an Alexandria entry either.
      const tantaSecrets = ctxOf(
        { 'atmRegister.import': 'organization', 'atmRegister.viewSecrets': 'branch' },
        TANTA,
      );
      const row = guess('WRONG-GUESS');
      expect(columnsFor(row, storedOf(row, ALEX, { J: FAKE_KEY }), tantaSecrets)).toBeUndefined();
      // A P column still counts — that value is the importer's to see.
      const renamed = guess('WRONG-GUESS');
      expect(
        columnsFor(renamed, storedOf(renamed, ALEX, { J: FAKE_KEY, E: 'Old name' }), noSecrets),
      ).toEqual(['E']);
    });

    it('an importer whose viewSecrets covers the entry still sees a K column differ', () => {
      const row = guess('WRONG-GUESS');
      expect(columnsFor(row, storedOf(row, ALEX, { J: FAKE_KEY }), ORG)).toEqual(['J']);
    });

    it('an entry imported into a branch out of reach: column A only, no entry id, nothing compared', () => {
      const tantaImporter = ctxOf(
        { 'atmRegister.import': 'branch', 'atmRegister.viewSecrets': 'branch' },
        TANTA,
      );
      const answers = ['WRONG-GUESS', FAKE_KEY].map((attempt) => {
        // The file relabels an Alexandria row as Tanta's.
        const row = parsedRow({
          branchCode: 'EGYCASH-2',
          machineCode: '99990041',
          endDate: '2025-06-01',
          name: attempt === FAKE_KEY ? 'Synthetic ATM' : 'Guessed name',
          keys: { ...parsedRow({}).values.keys, supervisorCode: attempt },
        });
        const stored = storedOf(row, ALEX, { J: FAKE_KEY, E: 'Synthetic ATM' });
        const plan = planRegisterImport(
          file([row]),
          world({
            imported: new Map([[row.importRow, stored]]),
            nbeForexBranchIds: new Set([TANTA]),
          }),
          tantaImporter,
        );
        expect(plan.blockers).toContain('changedSinceImport');
        return category(plan, 'changedSinceImport').items[0];
      });
      for (const item of answers) {
        expect(item?.columns).toEqual(['A']);
        expect(item?.entryId).toBeNull();
      }
    });

    // REG-3: a deleted entry is skipped wherever it sat — the out-of-reach rule above must not
    // turn it into a blocker the importer could never clear.
    it('a deleted entry out of reach is skipped, not reported', () => {
      const tantaImporter = ctxOf(
        { 'atmRegister.import': 'branch', 'atmRegister.viewSecrets': 'branch' },
        TANTA,
      );
      const row = parsedRow({
        branchCode: 'EGYCASH-2',
        machineCode: '99990042',
        endDate: '2025-06-01',
      });
      const stored = { ...storedOf(row, ALEX), isDeleted: true };
      const plan = planRegisterImport(
        file([row]),
        world({
          imported: new Map([[row.importRow, stored]]),
          nbeForexBranchIds: new Set([TANTA]),
        }),
        tantaImporter,
      );
      expect(plan.blockers).not.toContain('changedSinceImport');
      expect(category(plan, 'changedSinceImport').items).toEqual([]);
    });
  });

  it('secretsOutOfReach: branch-scoped viewSecrets over another branch, and no-branch rows', () => {
    const tantaSecrets = ctxOf(
      { 'atmRegister.import': 'organization', 'atmRegister.viewSecrets': 'branch' },
      TANTA,
    );
    const inTanta = parsedRow(
      { machineCode: '99990024', branchCode: 'EGYCASH-2' },
      { carriesSecrets: true },
    );
    const inAlex = parsedRow({ machineCode: '99990025' }, { carriesSecrets: true });
    const noBranch = parsedRow(
      { machineCode: '99990026', branchCode: null },
      { carriesSecrets: true },
    );
    expect(planRegisterImport(file([inTanta]), world(), tantaSecrets).blockers).not.toContain(
      'secretsOutOfReach',
    );
    expect(planRegisterImport(file([inTanta, inAlex]), world(), tantaSecrets).blockers).toContain(
      'secretsOutOfReach',
    );
    expect(planRegisterImport(file([noBranch]), world(), tantaSecrets).blockers).toContain(
      'secretsOutOfReach',
    );
    // Without any key value the rows need no secrets reach.
    const plain = parsedRow({ machineCode: '99990027' });
    expect(planRegisterImport(file([plain]), world(), tantaSecrets).blockers).not.toContain(
      'secretsOutOfReach',
    );
  });

  it('branchOutOfReach for no-branch rows and another branch; that branch yields no item', () => {
    const alexImporter = ctxOf(
      { 'atmRegister.import': 'branch', 'atmRegister.viewSecrets': 'branch' },
      ALEX,
    );
    const noBranch = parsedRow({ machineCode: '99990028', branchCode: null });
    expect(planRegisterImport(file([noBranch]), world(), alexImporter).blockers).toContain(
      'branchOutOfReach',
    );

    const tanta = parsedRow(
      // What `convertBank` makes of a text the workbook's six do not hold: no bank, and the issue.
      { machineCode: '99990029', branchCode: 'EGYCASH-2', bankCode: null },
      { issues: [{ code: 'unknownBank', column: 'C', detail: 'QNB' }] },
    );
    const alex = parsedRow({ machineCode: '99990030' });
    const plan = planRegisterImport(
      file([tanta, alex]),
      world({ masters: [master({ machineCode: '99990031', branchId: TANTA })] }),
      alexImporter,
    );
    expect(plan.blockers).toContain('branchOutOfReach');
    expect(plan.branches.map((b) => [b.code, b.inReach, b.rows])).toEqual([
      ['EGYCASH-2', false, 1],
      ['EGYCASH-4', true, 1],
    ]);
    const items = plan.categories.flatMap((c) => c.items);
    expect(items.map((i) => i.importRow)).toEqual([alex.importRow]);
    expect(plan.issues.rows.map((r) => r.importRow)).toEqual([]);
    expect(JSON.stringify(plan.categories)).not.toContain('99990029');
    expect(JSON.stringify(plan.categories)).not.toContain('99990031');
    expect(plan.couplingBranchIds).toEqual([ALEX]);
  });

  it('branchUnmapped, branchInactive, secretStoreUnavailable, runInProgress, reportMismatch', () => {
    const unmapped = parsedRow({ machineCode: '99990032', branchCode: 'EGYCASH-7' });
    const tanta = parsedRow(
      { machineCode: '99990033', branchCode: 'EGYCASH-2' },
      { plaintextCombination: '01 - 02 - 03' },
    );
    const plan = planRegisterImport(
      file([unmapped, tanta]),
      world({
        branches: new Map([[TANTA, { name: { en: 'Tanta', ar: 'طنطا' }, active: false }]]),
        secretStoreAvailable: false,
        runInProgress: true,
      }),
      ORG,
    );
    expect(plan.blockers).toEqual([
      'branchUnmapped',
      'branchInactive',
      'reportMismatch',
      'secretStoreUnavailable',
      'runInProgress',
    ]);
  });

  it('counts rows by status and the already-imported ones', () => {
    const open = parsedRow({ machineCode: '99990034' });
    const ended = parsedRow({ machineCode: '99990035', endDate: '2025-02-01' });
    const pending = parsedRow({ machineCode: '99990036', startDate: null });
    const plan = planRegisterImport(
      file([open, ended, pending]),
      world({
        imported: new Map([
          [
            ended.importRow,
            {
              id: 'e-35',
              importRow: ended.importRow,
              branchId: ALEX,
              isDeleted: false,
              status: 'ended',
              machineId: null,
              opsBankLabel: null,
              columns: new Map([
                ['A', 'EGYCASH-4'],
                ['B', 'Smouha'],
                ['C', 'NBE'],
                ['D', '99990035'],
                ['E', 'Synthetic ATM'],
                ['AQ', '2025-01-01'],
                ['AR', '2025-02-01'],
              ]),
            },
          ],
        ]),
      }),
      ORG,
    );
    expect(plan.counts).toEqual({ rows: 3, open: 1, ended: 1, pending: 1, alreadyImported: 1 });
    expect(category(plan, 'entries').count).toBe(2);
    expect(plan.rowsToImport.map((r) => r.importRow)).toEqual([open.importRow, pending.importRow]);
    expect(plan.blockers).not.toContain('changedSinceImport');
  });
});

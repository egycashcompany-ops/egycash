// The Full list import plan over an in-memory world (docs/12-planning/atm-settlements-phase1.md
// §5.3, §10.2): one outcome per row, its flags, the bank's machines missing from the file and the
// REP. TAPE standard rows. Every code, name and count below is invented.
import { describe, expect, it } from 'vitest';
import {
  type AtmBankCode,
  type AtmCassetteSlot,
  type AtmLayoutImportFlag,
  type AtmLayoutImportRowDto,
} from '@ecms/contracts';
import { type RawCellValue } from '../../register/import/cell-convert';
import {
  helpNumbers,
  planLayoutImport,
  type LayoutImportLayout,
  type LayoutImportMachine,
  type LayoutImportWorld,
} from './plan-layout-import';
import {
  type MasterDayLine,
  type MasterFullListRow,
  type MasterStandardRow,
  type MasterWorkbookRead,
} from './read-master-workbook';

// ── Cells and rows ──────────────────────────────────────────────────────────────────────────────

const v = (value: string | number | null): RawCellValue =>
  value === null
    ? { kind: 'empty' }
    : typeof value === 'number'
      ? { kind: 'number', value }
      : { kind: 'string', value };

interface RowInput {
  code: string | number | null;
  denominations: (string | number | null)[];
  location?: string;
  type?: string | null;
  features?: string | null;
  hub?: string | null;
  help?: string | null;
}

let nextRow = 3;
const fileRow = (input: RowInput): MasterFullListRow => ({
  row: nextRow++,
  code: v(input.code),
  location: v(input.location ?? `ماكينة اختبار ${String(input.code)}`),
  denominations: input.denominations.map(v),
  typeLabel: v(input.type === undefined ? 'BRK (T1)' : input.type),
  featuresLabel: v(input.features === undefined ? 'Withdrawall' : input.features),
  hubLabel: v(input.hub === undefined ? 'منطقة اختبار' : input.hub),
  help: v(
    input.help === undefined
      ? input.denominations.filter((d) => d !== 0 && d !== null).join('---')
      : input.help,
  ),
});

const standard = (row: 1 | 2, values: (string | number | null)[]): MasterStandardRow => ({
  row,
  total: v(values[0] ?? null),
  counts: [200, 100, 50].map((denomination, i) => ({
    denomination,
    cell: v(values[i + 1] ?? null),
  })),
});

const read = (
  fullList: MasterFullListRow[],
  extra: { standardRows?: MasterStandardRow[]; dayLines?: MasterDayLine[] } = {},
): MasterWorkbookRead => ({
  fullList,
  standardRows: extra.standardRows ?? [],
  dayLines: extra.dayLines ?? [],
});

// ── The world ───────────────────────────────────────────────────────────────────────────────────

const machine = (code: string, over: Partial<LayoutImportMachine> = {}): LayoutImportMachine => ({
  id: `id-${code}`,
  machineCode: code,
  name: `ماكينة اختبار ${code}`,
  area: 'منطقة اختبار',
  bankName: 'BRK',
  isActive: true,
  ...over,
});

const slots = (...denominations: number[]): AtmCassetteSlot[] =>
  denominations.map((d, i) =>
    d === 0
      ? { slot: i + 1, kind: 'empty', denomination: null, currency: null }
      : { slot: i + 1, kind: 'withdrawal', denomination: d, currency: 'EGP' },
  );

const layout = (over: Partial<LayoutImportLayout> = {}): LayoutImportLayout => ({
  revision: 2,
  slots: slots(200, 200, 100, 50),
  typeLabel: 'BRK (T1)',
  featuresLabel: 'Withdrawall',
  hubLabel: 'منطقة اختبار',
  source: 'import',
  ...over,
});

type Entry = { bankCode: AtmBankCode | null; cassettes?: Record<string, string | null> };

const world = (
  machines: LayoutImportMachine[],
  over: {
    entries?: Record<string, Entry[]>;
    layouts?: Record<string, LayoutImportLayout>;
    standardLoads?: LayoutImportWorld['standardLoads'];
  } = {},
): LayoutImportWorld => ({
  bankCode: 'BRK',
  machines,
  // Every machine has one open BRK entry unless the test says otherwise.
  registerRows: new Map(
    machines.map((m) => [m.id, over.entries?.[m.machineCode] ?? [{ bankCode: 'BRK' }]]),
  ),
  layouts: new Map(
    Object.entries(over.layouts ?? {}).map(([code, l]) => [`id-${code}`, l] as const),
  ),
  standardLoads: over.standardLoads ?? [],
});

const only = (plan: ReturnType<typeof planLayoutImport>, code: string): AtmLayoutImportRowDto => {
  const found = plan.rows.filter((r) => r.code === code);
  expect(found).toHaveLength(1);
  return found[0]!;
};

const flagsOf = (input: RowInput, w: LayoutImportWorld, dayLines: MasterDayLine[] = []) =>
  planLayoutImport(read([fileRow(input)], { dayLines }), w).rows[0]?.flags ?? [];

// ── Outcomes ────────────────────────────────────────────────────────────────────────────────────

describe('one outcome per row (§5.3)', () => {
  it('gives every outcome, each on its own row', () => {
    const machines = [
      machine('BRKN9001', { isActive: false }), // archived
      machine('BRKN9002'), // noRegisterBank
      machine('BRKN9003'), // otherBank (two banks)
      machine('BRKN9004'), // otherBank (another bank)
      machine('BRKN9005'), // new
      machine('BRKN9006'), // same
      machine('BRKN9007'), // changed
      machine('BRKN9008'), // changedManual
    ];
    const plan = planLayoutImport(
      read([
        fileRow({ code: null, denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9000', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9001', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9002', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9003', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9004', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9005', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9006', denominations: [200, 200, 100, 50] }),
        fileRow({ code: 'BRKN9007', denominations: [200, 100, 50, 20] }),
        fileRow({ code: 'BRKN9008', denominations: [200, 100, 50, 20] }),
      ]),
      world(machines, {
        entries: {
          BRKN9002: [],
          BRKN9003: [{ bankCode: 'BRK' }, { bankCode: 'BM' }],
          BRKN9004: [{ bankCode: 'BM' }],
        },
        layouts: {
          BRKN9006: layout(),
          BRKN9007: layout(),
          BRKN9008: layout({ source: 'manual', revision: 5 }),
        },
      }),
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual([
      'invalid',
      'notFound',
      'archived',
      'noRegisterBank',
      'otherBank',
      'otherBank',
      'new',
      'same',
      'changed',
      'changedManual',
    ]);
    expect(plan.counts).toMatchObject({
      invalid: 1,
      duplicateInFile: 0,
      notFound: 1,
      archived: 1,
      noRegisterBank: 1,
      otherBank: 2,
      new: 1,
      same: 1,
      changed: 1,
      changedManual: 1,
    });
    // noRegisterBank shows the machine's Operations bank label; no other row does.
    expect(only(plan, 'BRKN9002').bankName).toBe('BRK');
    expect(only(plan, 'BRKN9004').bankName).toBeNull();
    // changed shows before and after, with the layout's revision.
    const changed = only(plan, 'BRKN9007');
    expect(changed.revision).toBe(2);
    expect(changed.before).toEqual(slots(200, 200, 100, 50));
    expect(changed.after).toEqual(slots(200, 100, 50, 20));
    expect(only(plan, 'BRKN9008').revision).toBe(5);
    // new has no revision and no before.
    expect(only(plan, 'BRKN9005')).toMatchObject({ revision: null, before: null });
  });

  it('a duplicated code marks every occurrence', () => {
    const plan = planLayoutImport(
      read([
        fileRow({ code: 'BRKN9001', denominations: [200, 100, 50, 0] }),
        fileRow({ code: ' BRKN9001', denominations: [200, 200, 100, 50] }),
      ]),
      world([machine('BRKN9001')]),
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual(['duplicateInFile', 'duplicateInFile']);
  });

  it('invalid: a blank code, a denomination not one of the six, all four empty', () => {
    const plan = planLayoutImport(
      read([
        fileRow({ code: '   ', denominations: [200, 100, 50, 0] }),
        fileRow({ code: 'BRKN9001', denominations: [200, 25, 50, 0] }),
        fileRow({ code: 'BRKN9002', denominations: [0, null, 0, null] }),
        fileRow({ code: 'BRKN9003', denominations: [200, 'two hundred', 50, 0] }),
      ]),
      world([machine('BRKN9001'), machine('BRKN9002'), machine('BRKN9003')]),
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    expect(plan.rows[1]?.after).toBeNull();
  });

  it('reads 0 and blank alike as no cassette, and a numeric text as its number', () => {
    const plan = planLayoutImport(
      read([fileRow({ code: 'BRKN9001', denominations: [null, '50', ' 100 ', 200] })]),
      world([machine('BRKN9001')]),
    );
    expect(plan.rows[0]?.after).toEqual(slots(0, 50, 100, 200));
    expect(plan.rows[0]?.outcome).toBe('new');
  });

  it('a label over its cap → invalid + labelTooLong, never truncated', () => {
    const plan = planLayoutImport(
      read([
        fileRow({ code: 'BRKN9001', denominations: [200, 100, 50, 0], type: 'T'.repeat(61) }),
        fileRow({ code: 'BRKN9002', denominations: [200, 100, 50, 0], features: 'F'.repeat(41) }),
        fileRow({ code: 'BRKN9003', denominations: [200, 100, 50, 0], hub: 'H'.repeat(61) }),
        fileRow({ code: 'BRKN9004', denominations: [200, 100, 50, 0], type: 'T'.repeat(60) }),
      ]),
      world([machine('BRKN9001'), machine('BRKN9002'), machine('BRKN9003'), machine('BRKN9004')]),
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual(['invalid', 'invalid', 'invalid', 'new']);
    expect(plan.rows.slice(0, 3).every((r) => r.flags.includes('labelTooLong'))).toBe(true);
    expect(plan.rows[0]?.typeLabel.after).toBeNull();
    expect(plan.rows[3]?.typeLabel.after).toBe('T'.repeat(60));
  });

  it('the zero-padding case → notFound (DS-6: exact match only)', () => {
    const plan = planLayoutImport(
      read([fileRow({ code: 'BRKN0901', denominations: [200, 100, 50, 0] })]),
      world([machine('BRKN901')]),
    );
    expect(plan.rows[0]?.outcome).toBe('notFound');
  });

  it('leading zeros are the ECMS rule, so a code typed with them still matches', () => {
    const plan = planLayoutImport(
      read([fileRow({ code: '00099990001', denominations: [200, 100, 50, 0] })]),
      world([machine('99990001')]),
    );
    expect(plan.rows[0]).toMatchObject({ code: '99990001', outcome: 'new' });
  });

  it('same vs changed: a slot, or any one of the three labels', () => {
    const w = world([machine('BRKN9001')], { layouts: { BRKN9001: layout() } });
    const outcome = (input: Partial<RowInput>) =>
      planLayoutImport(
        read([fileRow({ code: 'BRKN9001', denominations: [200, 200, 100, 50], ...input })]),
        w,
      ).rows[0]?.outcome;
    expect(outcome({})).toBe('same');
    // Cleaning first: spaces collapsed and a format character dropped are still the same label.
    expect(outcome({ type: '  BRK  (T1)‏' })).toBe('same');
    expect(outcome({ denominations: [200, 200, 100, 20] })).toBe('changed');
    expect(outcome({ type: 'BRK (T2)' })).toBe('changed');
    expect(outcome({ features: 'Deposit' })).toBe('changed');
    expect(outcome({ hub: 'منطقة أخرى' })).toBe('changed');
    expect(outcome({ hub: null })).toBe('changed');
  });
});

// ── Flags ───────────────────────────────────────────────────────────────────────────────────────

describe('flags (§5.3)', () => {
  const w = world([machine('BRKN9001')]);

  it('reversedOrder and helpOrderOpposite on a reversed row, never helpDisagrees', () => {
    const flags = flagsOf(
      { code: 'BRKN9001', denominations: [0, 50, 100, 200], help: '200---100---50' },
      w,
    );
    expect(flags).toContain('reversedOrder');
    expect(flags).toContain('helpOrderOpposite');
    expect(flags).not.toContain('helpDisagrees');
  });

  it('helpDisagrees by multiset; the same order flags nothing', () => {
    expect(
      flagsOf({ code: 'BRKN9001', denominations: [200, 200, 100, 50], help: '200---100---50' }, w),
    ).toContain('helpDisagrees');
    expect(
      flagsOf(
        { code: 'BRKN9001', denominations: [200, 200, 100, 50], help: '200---200---100---50' },
        w,
      ),
    ).toEqual([]);
  });

  it('reads a HELP of 10,000 dashes in linear time', () => {
    const started = Date.now();
    expect(helpNumbers({ kind: 'string', value: '-'.repeat(10_000) })).toEqual([]);
    expect(helpNumbers({ kind: 'string', value: `${'-'.repeat(10_000)}200` })).toEqual([]);
    expect(helpNumbers({ kind: 'string', value: ' 200---1x0---50 ' })).toEqual([200, 50]);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('typeMentionsRecycle, case-insensitive', () => {
    expect(
      flagsOf({ code: 'BRKN9001', denominations: [200, 100, 50, 0], type: 'BRK(DN)Recycle' }, w),
    ).toContain('typeMentionsRecycle');
  });

  it('areaDiffers and nameDiffers against the machine, after cleaning', () => {
    const flags = flagsOf(
      { code: 'BRKN9001', denominations: [200, 100, 50, 0], hub: 'منطقة أخرى', location: 'x' },
      w,
    );
    expect(flags).toEqual(expect.arrayContaining(['areaDiffers', 'nameDiffers']));
    const cleanSame = flagsOf(
      {
        code: 'BRKN9001',
        denominations: [200, 100, 50, 0],
        hub: ' منطقة  اختبار ',
        location: 'ماكينة   اختبار BRKN9001',
      },
      w,
    );
    expect(cleanSame).toEqual([]);
  });

  it('repTapeDiffers when today’s line disagrees, blank and 0 counted alike', () => {
    const day = (denominations: (number | null)[]): MasterDayLine => ({
      row: 8,
      code: v('BRKN9001'),
      denominations: denominations.map(v),
    });
    const input: RowInput = { code: 'BRKN9001', denominations: [200, 100, 50, 0] };
    expect(flagsOf(input, w, [day([200, 100, 50, null])])).toEqual([]);
    expect(flagsOf(input, w, [day([200, 100, 50, 20])])).toEqual(['repTapeDiffers']);
  });

  it('registerCountDiffers and registerDenominationsDiffer on plain integers only', () => {
    const withEntry = (cassettes: Record<string, string | null>) =>
      world([machine('BRKN9001')], { entries: { BRKN9001: [{ bankCode: 'BRK', cassettes }] } });
    const input: RowInput = { code: 'BRKN9001', denominations: [200, 100, 50, 0] };
    const agree = {
      withdrawalCount: '3',
      withdrawal1: '200',
      withdrawal2: '100',
      withdrawal3: '50',
    };
    expect(flagsOf(input, withEntry(agree))).toEqual([]);
    expect(flagsOf(input, withEntry({ ...agree, withdrawalCount: '4' }))).toEqual([
      'registerCountDiffers',
    ]);
    expect(flagsOf(input, withEntry({ ...agree, withdrawal3: '20' }))).toEqual([
      'registerDenominationsDiffer',
    ]);
    // Free text is not compared, and an entry that names nothing differs from nothing.
    expect(
      flagsOf(input, withEntry({ withdrawalCount: 'four', withdrawal1: '200 + 100' })),
    ).toEqual([]);
    expect(flagsOf(input, withEntry({}))).toEqual([]);
  });

  it('idFormat and codeWhitespace', () => {
    const flags: AtmLayoutImportFlag[] = [
      ...flagsOf({ code: 'BRK 9001', denominations: [200, 100, 50, 0] }, w),
    ];
    expect(flags).toEqual(expect.arrayContaining(['idFormat', 'codeWhitespace']));
    expect(flagsOf({ code: ' BRKN9001 ', denominations: [200, 100, 50, 0] }, w)).toEqual([]);
  });

  it('counts each flag over the rows', () => {
    const plan = planLayoutImport(
      read([
        fileRow({ code: 'BRKN9001', denominations: [0, 50, 100, 200], help: '200---100---50' }),
        fileRow({ code: 'BRKN9002', denominations: [0, 50, 100, 200], help: '200---100---50' }),
      ]),
      world([machine('BRKN9001'), machine('BRKN9002')]),
    );
    expect(plan.flags.reversedOrder).toBe(2);
    expect(plan.flags.helpOrderOpposite).toBe(2);
    expect(plan.flags.helpDisagrees).toBe(0);
  });
});

// ── The rest of the report ──────────────────────────────────────────────────────────────────────

describe('missingFromFile', () => {
  it("lists the bank's active machines no row matched — not archived, not another bank", () => {
    const plan = planLayoutImport(
      read([fileRow({ code: 'BRKN9001', denominations: [200, 100, 50, 0] })]),
      world(
        [
          machine('BRKN9001'),
          machine('BRKN9003'),
          machine('BRKN9002'),
          machine('BRKN9004', { isActive: false }),
          machine('BRKN9005'),
          machine('BRKN9006'),
        ],
        { entries: { BRKN9005: [{ bankCode: 'BM' }], BRKN9006: [] } },
      ),
    );
    expect(plan.missingFromFile).toEqual([
      { machineId: 'id-BRKN9002', machineCode: 'BRKN9002', machineName: 'ماكينة اختبار BRKN9002' },
      { machineId: 'id-BRKN9003', machineCode: 'BRKN9003', machineName: 'ماكينة اختبار BRKN9003' },
    ]);
  });
});

describe('REP. TAPE standard rows (DS-8)', () => {
  it('new, same, mismatch and invalid', () => {
    const plan = planLayoutImport(
      read([], {
        standardRows: [
          standard(1, [835_000, 3100, 1700, 900]),
          standard(2, [625_000, 2300, 1300, 700]),
        ],
      }),
      world([], {
        standardLoads: [
          {
            notes: [
              { denomination: 50, notes: 700 },
              { denomination: 200, notes: 2300 },
              { denomination: 100, notes: 1300 },
            ],
          },
        ],
      }),
    );
    expect(plan.standardLoads).toEqual([
      {
        row: 1,
        notes: [
          { denomination: 200, notes: 3100 },
          { denomination: 100, notes: 1700 },
          { denomination: 50, notes: 900 },
        ],
        outcome: 'new',
      },
      {
        row: 2,
        notes: [
          { denomination: 200, notes: 2300 },
          { denomination: 100, notes: 1300 },
          { denomination: 50, notes: 700 },
        ],
        outcome: 'same',
      },
    ]);
    const outcome = (values: (string | number | null)[]) =>
      planLayoutImport(read([], { standardRows: [standard(1, values)] }), world([]))
        .standardLoads[0]?.outcome;
    expect(outcome([835_100, 3100, 1700, 900])).toBe('mismatch');
    expect(outcome([null, 3100, 1700, 900])).toBe('invalid');
    expect(outcome([835_000, 'x', 1700, 900])).toBe('invalid');
    expect(outcome([835_000, 3100, 1700, 900.5])).toBe('invalid');
    expect(outcome([20_200_000, 100_001, 0, 0])).toBe('invalid');
    expect(outcome([0, 0, 0, 0])).toBe('new');
  });
});

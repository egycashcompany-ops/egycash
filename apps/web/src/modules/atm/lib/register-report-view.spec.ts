// The Data Report's model (spec §8.5, §10.2), pinned without rendering: the sheet's orders and
// labels (with D7's three fixes and the provisional total label of DEC-28), the total bar last,
// every cell present with 0 for nothing, only the branches the server shows (DEC-27), the owner's
// colours, and a geometry whose first category stands at the LEFT (DEC-19).
//
// The counts come from the contracts' own fold over synthetic groups — the same fold the server
// runs — so a fixture cannot drift from what the endpoint sends.
//
// The banks are the catalog's (DEC-35, DEC-40): a seventh bank gets its bar after BRK and its series
// after NXT, in its catalog colour, while the six keep the sheet's places; an older server that
// sends no bank fields still gets the sheet's six.
import { describe, expect, it } from 'vitest';
import {
  ATM_BANK_SEED,
  ATM_DATA_REPORT_CELLS,
  ATM_REGISTER_BRANCH_CODES,
  ATM_REPORT_TOTALS_COLOR,
  atmBankSeedOf,
  atmReportBankOrders,
  foldAtmRegisterReport,
  readAtmReportCell,
  type AtmRegisterBranchCode,
  type AtmRegisterReportBankDto,
  type AtmRegisterReportDto,
  type AtmRegisterReportGroup,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  GROUPED_CHART,
  SINGLE_CHART,
  barPath,
  groupedChartLayout,
  hasBranchCategories,
  labelColumns,
  labelTracks,
  niceStep,
  registerReportView,
  reportCount,
  singleChartLayout,
} from './register-report-view';

const GROUPS: AtmRegisterReportGroup[] = [
  { branchCode: 'EGYCASH-1', bankCode: 'NBE', count: 40 },
  { branchCode: 'EGYCASH-1', bankCode: 'BM', count: 12 },
  // Alexandria: NXT and HDB each in their own cell (the S2/S3 regressions of §10.2).
  { branchCode: 'EGYCASH-4', bankCode: 'NXT', count: 3 },
  { branchCode: 'EGYCASH-4', bankCode: 'HDB', count: 5 },
  { branchCode: 'EGYCASH-7', bankCode: 'CIB', count: 2 },
  // In operation with no bank: the branch figures only.
  { branchCode: 'EGYCASH-6', bankCode: null, count: 1 },
  // In operation in a branch without a register code: the bank figures only.
  { branchCode: null, bankCode: 'BRK', count: 4 },
];

/** The six as the catalog seeds them — what the server sends while no bank has been added. */
const SEED_BANKS: AtmRegisterReportBankDto[] = ATM_BANK_SEED.map((seed) => ({
  code: seed.code,
  name: seed.name,
  color: seed.color,
  isActive: true,
  isSeed: true,
}));

/** A seventh, runtime-added bank (synthetic). */
const QNB: AtmRegisterReportBankDto = {
  code: 'QNB',
  name: { ar: 'بنك تجريبي', en: 'Synthetic Bank' },
  color: '#7030A0',
  isActive: true,
  isSeed: false,
};

/** The report DTO as the endpoint builds it: the fold over the catalog's banks, and their orders. */
const dto = (
  shown: readonly AtmRegisterBranchCode[] = ATM_REGISTER_BRANCH_CODES,
  groups: readonly AtmRegisterReportGroup[] = GROUPS,
  extras: readonly AtmRegisterReportBankDto[] = [],
): AtmRegisterReportDto => {
  const orders = atmReportBankOrders(extras.map((bank) => bank.code));
  return {
    generatedAt: '2026-03-16T08:00:00.000Z',
    branchesShown: [...shown],
    counts: foldAtmRegisterReport(groups, shown, orders.section3),
    banks: [...SEED_BANKS, ...extras],
    section1Banks: orders.section1,
    section3Banks: orders.section3,
  };
};

const viewOf = (report: AtmRegisterReportDto = dto(), locale: Locale = 'ar') =>
  registerReportView(report, locale, (key, params) => translate(locale, key, params));

describe('section 1 — the banks, then the total', () => {
  it('keeps the sheet order AD..AI, the Data Report names, and the total bar last', () => {
    const { section1 } = viewOf();
    expect(section1.bars.map((bar) => bar.key)).toEqual([
      's1.NXT',
      's1.NBE',
      's1.BM',
      's1.CIB',
      's1.HDB',
      's1.BRK',
      's1.total',
    ]);
    expect(section1.bars.map((bar) => bar.label)).toEqual([
      'NXT BANK',
      'البنك الأهلي المصري',
      'بنك مصر',
      'البنك التجارى الدولى',
      'بنك التعمير والاسكان',
      'بنك البركة',
      'إجمالي عدد الماكينات',
    ]);
    expect(section1.bars.map((bar) => bar.isTotal)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('carries the fold — unmapped branches count here, bank-less machines do not', () => {
    const { section1 } = viewOf();
    expect(section1.bars.map((bar) => bar.value)).toEqual([3, 40, 12, 2, 5, 4, 66]);
    expect(section1.total).toBe(66);
  });

  it('is drawn in the workbook blue, #4472C4', () => {
    expect(viewOf().section1.color).toBe(ATM_REPORT_TOTALS_COLOR);
    expect(ATM_REPORT_TOTALS_COLOR).toBe('#4472C4');
  });

  it('names the banks in English for an English reader', () => {
    const { section1 } = viewOf(dto(), 'en');
    expect(section1.bars[1]?.label).toBe('National Bank of Egypt');
    expect(section1.bars[6]?.label).toBe('Total machines');
  });
});

describe('section 2 — the branches, then the total', () => {
  it('keeps the sheet order (وصال first) with the typo-fixed labels', () => {
    const { section2 } = viewOf();
    expect(section2.bars.map((bar) => bar.key)).toEqual([
      's2.EGYCASH-7',
      's2.EGYCASH-1',
      's2.EGYCASH-2',
      's2.EGYCASH-3',
      's2.EGYCASH-4',
      's2.EGYCASH-5',
      's2.EGYCASH-6',
      's2.total',
    ]);
    expect(section2.bars.map((bar) => bar.label)).toEqual([
      'فرع إيجي كاش وصال',
      'فرع إيجي كاش المهندسين',
      'فرع إيجي كاش طنطا',
      'فرع إيجي كاش أسيوط',
      'فرع إيجي كاش الإسكندرية',
      'فرع إيجي كاش أكتوبر',
      'فرع إيجي كاش بور سعيد',
      'إجمالي عدد الماكينات',
    ]);
    expect(section2.color).toBe(ATM_REPORT_TOTALS_COLOR);
  });

  it('writes a zero for an empty branch, never leaves it out', () => {
    const { section2 } = viewOf();
    expect(section2.bars.map((bar) => bar.value)).toEqual([2, 52, 0, 0, 8, 0, 1, 63]);
    expect(reportCount(0)).toBe('0');
  });
});

describe('section 3 — branches × banks', () => {
  it('keeps the sheet rows and columns, with the owner colours per bank', () => {
    const { section3 } = viewOf();
    expect(section3.groups.map((group) => group.key)).toEqual([
      'EGYCASH-1',
      'EGYCASH-5',
      'EGYCASH-2',
      'EGYCASH-3',
      'EGYCASH-4',
      'EGYCASH-6',
      'EGYCASH-7',
    ]);
    expect(section3.groups.map((group) => group.label)).toEqual([
      'إيجي كــاش ( المهندسين )',
      'إيجي كــاش ( أكتوبر )',
      'إيجي كــاش ( طنطا )',
      'إيجي كــاش ( أسيــوط )',
      'إيجي كــاش ( الاســكندرية )',
      'إيجي كــاش ( بور سعيد )',
      'إيجي كــاش (وصال )',
    ]);
    expect(section3.series.map((series) => series.key)).toEqual([
      'NBE',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
    ]);
    for (const series of section3.series) {
      expect(series.color).toBe(atmBankSeedOf(series.key)?.color);
    }
    expect(section3.series[5]?.label).toBe('NXT BANK');
  });

  it('holds all six numbers for every branch, zeros included, and no total', () => {
    const { section3 } = viewOf();
    const row = (code: string) =>
      section3.groups.find((group) => group.key === code)?.cells.map((cell) => cell.value);
    expect(row('EGYCASH-1')).toEqual([40, 12, 0, 0, 0, 0]);
    // Alexandria: HDB once, NXT once — never folded into each other.
    expect(row('EGYCASH-4')).toEqual([0, 0, 0, 5, 0, 3]);
    // The bank-less machine of Port Said is in no bank cell.
    expect(row('EGYCASH-6')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(section3.groups.every((group) => group.cells.length === 6)).toBe(true);
    expect(section3.total).toBe(62);
  });
});

describe('a bank added to the catalog (DEC-40)', () => {
  const groups: AtmRegisterReportGroup[] = [
    ...GROUPS,
    { branchCode: 'EGYCASH-1', bankCode: 'QNB', count: 6 },
    { branchCode: 'EGYCASH-4', bankCode: 'QNB', count: 1 },
  ];
  const view = viewOf(dto(ATM_REGISTER_BRANCH_CODES, groups, [QNB]));

  it('gets a bar after BRK, before the total, named as the catalog names it', () => {
    expect(view.section1.bars.map((bar) => bar.key)).toEqual([
      's1.NXT',
      's1.NBE',
      's1.BM',
      's1.CIB',
      's1.HDB',
      's1.BRK',
      's1.QNB',
      's1.total',
    ]);
    expect(view.section1.bars[6]).toMatchObject({ label: 'بنك تجريبي', value: 7 });
    expect(view.section1.total).toBe(73);
    expect(
      viewOf(dto(ATM_REGISTER_BRANCH_CODES, groups, [QNB]), 'en').section1.bars[6]?.label,
    ).toBe('Synthetic Bank');
  });

  it('gets a series after NXT in its catalog colour, and a cell in every branch', () => {
    const { section3 } = view;
    expect(section3.series.map((series) => series.key)).toEqual([
      'NBE',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
      'QNB',
    ]);
    expect(section3.series[6]).toEqual({ key: 'QNB', label: 'بنك تجريبي', color: '#7030A0' });
    const row = (code: string) =>
      section3.groups.find((group) => group.key === code)?.cells.map((cell) => cell.value);
    expect(row('EGYCASH-1')).toEqual([40, 12, 0, 0, 0, 0, 6]);
    expect(row('EGYCASH-4')).toEqual([0, 0, 0, 5, 0, 3, 1]);
    expect(section3.groups.every((group) => group.cells.length === 7)).toBe(true);
  });

  it('leaves the six exactly as the sheet has them', () => {
    const six = viewOf();
    const withSeventh = view;
    const sixBars = (v: typeof six) => v.section1.bars.filter((bar) => bar.key !== 's1.QNB');
    expect(sixBars(withSeventh).slice(0, 6)).toEqual(sixBars(six).slice(0, 6));
    expect(withSeventh.section3.series.slice(0, 6)).toEqual(six.section3.series);
    expect(withSeventh.section2.bars.map((bar) => bar.key)).toEqual(
      six.section2.bars.map((bar) => bar.key),
    );
  });

  it('names a curated seed as the catalog names it now', () => {
    const curated = dto();
    curated.banks = curated.banks.map((bank) =>
      bank.code === 'NBE' ? { ...bank, name: { ar: 'الأهلي', en: 'NBE' } } : bank,
    );
    expect(viewOf(curated).section1.bars[1]?.label).toBe('الأهلي');
  });

  it('draws a bank the server names without a known colour in the grey of «بنك غير محدد»', () => {
    const report = dto(ATM_REGISTER_BRANCH_CODES, groups, [QNB]);
    report.banks = report.banks.filter((bank) => bank.code !== 'QNB');
    const series = viewOf(report).section3.series[6];
    expect(series).toEqual({ key: 'QNB', label: 'QNB', color: '#6b7280' });
  });
});

describe('an older server that sends no bank fields (a rolling deploy)', () => {
  it("still draws the sheet's six, in the sheet's orders and colours", () => {
    const current: Partial<AtmRegisterReportDto> = dto();
    delete current.banks;
    delete current.section1Banks;
    delete current.section3Banks;
    const view = viewOf(current as AtmRegisterReportDto);
    expect(view).toEqual(viewOf());
    expect(view.section1.bars).toHaveLength(7);
    expect(view.section3.series.map((series) => series.color)).toEqual(
      ATM_BANK_SEED.map((seed) => seed.color),
    );
  });
});

describe('every number is a sheet cell', () => {
  it('reads each bar and cell through the same cell list the import check uses', () => {
    const report = dto();
    const view = viewOf(report);
    const keyed = new Map(ATM_DATA_REPORT_CELLS.map((cell) => [cell.key, cell]));
    const drawn = [
      ...view.section1.bars,
      ...view.section2.bars,
      ...view.section3.groups.flatMap((group) => group.cells),
    ];
    expect(drawn).toHaveLength(57);
    for (const { key, value } of drawn) {
      const cell = keyed.get(key);
      expect(cell, key).toBeDefined();
      if (cell !== undefined) expect(value, key).toBe(readAtmReportCell(report.counts, cell));
    }
  });
});

describe('a reader sees only the branches the server shows', () => {
  it('draws Alexandria alone for an Alexandria-scoped reader', () => {
    const view = viewOf(dto(['EGYCASH-4']));
    expect(view.section2.bars.map((bar) => bar.key)).toEqual(['s2.EGYCASH-4', 's2.total']);
    expect(view.section3.groups.map((group) => group.key)).toEqual(['EGYCASH-4']);
    // Section 1 is per bank and always has its six banks.
    expect(view.section1.bars).toHaveLength(7);
  });

  it('keeps the sheet order whatever order the server lists the branches in', () => {
    const view = viewOf(dto(['EGYCASH-6', 'EGYCASH-1', 'EGYCASH-7']));
    expect(view.section2.bars.map((bar) => bar.key)).toEqual([
      's2.EGYCASH-7',
      's2.EGYCASH-1',
      's2.EGYCASH-6',
      's2.total',
    ]);
    expect(view.section3.groups.map((group) => group.key)).toEqual([
      'EGYCASH-1',
      'EGYCASH-6',
      'EGYCASH-7',
    ]);
  });

  it('has no branch category to draw when no branch is shown', () => {
    const view = viewOf(dto([]));
    expect(hasBranchCategories(view.section2)).toBe(false);
    expect(view.section3.groups).toEqual([]);
  });
});

describe('the two notes and the empty report', () => {
  it('passes the unmapped and the bank-less counts through', () => {
    const view = viewOf();
    expect(view.activeWithUnmappedBranch).toBe(4);
    expect(view.activeWithoutBank).toBe(1);
    expect(view.empty).toBe(false);
  });

  it('is empty only when nothing at all is in operation', () => {
    const empty = viewOf(dto(ATM_REGISTER_BRANCH_CODES, []));
    expect(empty.empty).toBe(true);
    expect(empty.section1.bars.every((bar) => bar.value === 0)).toBe(true);
    // A bank-less machine is still a machine in operation.
    const bankless = viewOf(
      dto(ATM_REGISTER_BRANCH_CODES, [{ branchCode: 'EGYCASH-2', bankCode: null, count: 1 }]),
    );
    expect(bankless.empty).toBe(false);
  });
});

describe('the drawing of charts 1–2', () => {
  const { section1 } = viewOf();
  const layout = singleChartLayout(section1.bars);

  it('puts the first category at the left and the total bar last, past the divider', () => {
    expect(layout.marks.map((mark) => mark.key)).toEqual(section1.bars.map((bar) => bar.key));
    const xs = layout.marks.map((mark) => mark.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.min(...xs)).toBe(layout.marks[0]?.x);
    const lastCategory = layout.marks[5];
    const total = layout.marks[6];
    expect(layout.dividerX).not.toBeNull();
    if (lastCategory === undefined || total === undefined || layout.dividerX === null) return;
    expect(layout.dividerX).toBeGreaterThan(lastCategory.slotX + lastCategory.slotWidth);
    expect(layout.dividerX).toBeLessThan(total.slotX);
  });

  it('keeps bars at most 24 px, scaled to the tallest (the total), a zero flat on the baseline', () => {
    expect(layout.marks.every((mark) => mark.width <= 24)).toBe(true);
    const total = layout.marks[6];
    expect(total?.height).toBe(SINGLE_CHART.plot);
    expect(total?.y).toBe(layout.baseline - SINGLE_CHART.plot);
    const nbe = layout.marks[1];
    expect(nbe?.height).toBeCloseTo((40 / 66) * SINGLE_CHART.plot, 1);
    const zero = singleChartLayout(viewOf().section2.bars).marks[2];
    expect(zero?.value).toBe(0);
    expect(zero?.height).toBe(0);
  });

  it('lays the labels under their own slots', () => {
    expect(labelColumns(layout)).toEqual([2, 3, 4, 5, 6, 7, 9]);
    expect(labelTracks(layout).split(' minmax').length).toBe(10);
  });
});

describe('the drawing of chart 3', () => {
  const { section3 } = viewOf();
  const layout = groupedChartLayout(section3.groups, section3.series.length);

  it('runs the branches left to right, six bars each, 2 px apart', () => {
    expect(layout.marks).toHaveLength(42);
    const xs = layout.marks.map((mark) => mark.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(layout.marks[0]?.key).toBe('s3.EGYCASH-1.NBE');
    for (let g = 0; g < 7; g += 1) {
      const group = layout.marks.slice(g * 6, g * 6 + 6);
      for (let i = 1; i < group.length; i += 1) {
        const before = group[i - 1];
        const after = group[i];
        if (before === undefined || after === undefined) continue;
        expect(after.x - (before.x + before.width)).toBe(GROUPED_CHART.gap);
      }
    }
    expect(layout.marks.every((mark) => mark.width <= 24)).toBe(true);
    expect(layout.slots.map((slot) => slot.key)).toEqual(section3.groups.map((g) => g.key));
  });

  it('has light value gridlines on clean steps, none past the plot', () => {
    expect(layout.gridlines.map((line) => line.value)).toEqual([10, 20, 30, 40]);
    expect(layout.gridlines.every((line) => line.y >= GROUPED_CHART.top)).toBe(true);
    expect(layout.dividerX).toBeNull();
  });

  it('draws no gridline over an empty report', () => {
    const empty = viewOf(dto(ATM_REGISTER_BRANCH_CODES, [])).section3;
    const flat = groupedChartLayout(empty.groups, empty.series.length);
    expect(flat.gridlines).toEqual([]);
    expect(flat.marks.every((mark) => mark.height === 0)).toBe(true);
  });
});

describe('a bar', () => {
  it('stands square on the baseline with a 4 px rounded data end', () => {
    const d = barPath({ x: 10, y: 20, width: 24, height: 100 });
    expect(d.startsWith('M10 120 V24 A4 4 0 0 1 14 20 H30 A4 4 0 0 1 34 24 V120')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('rounds no more than its own height allows, and draws nothing for a zero', () => {
    expect(barPath({ x: 0, y: 99, width: 24, height: 1 })).toContain('A1 1');
    expect(barPath({ x: 0, y: 100, width: 24, height: 0 })).toBe('');
  });
});

describe('clean steps', () => {
  it('splits the tallest value into at most four lines', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(7)).toBe(2);
    expect(niceStep(40)).toBe(10);
    expect(niceStep(66)).toBe(20);
    expect(niceStep(1061)).toBe(500);
  });
});

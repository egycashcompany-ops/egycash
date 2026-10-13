// The Data Report page's model (spec §8.5), kept apart from React so every rule below is pinned
// without rendering: which categories each section shows and in what order, what they are called,
// which number each bar and each table cell carries, and where on the drawing each bar stands.
//
// The numbers are the server's fold (`foldAtmRegisterReport`, D7) and are read through the SAME
// cell list the import's 57-number check reads (`ATM_DATA_REPORT_CELLS` + `readAtmReportCell`), so
// the page and the cut-over check cannot disagree about what a cell holds. The browser only picks
// the cells of the branches the server says this reader may see (`branchesShown`, DEC-27) and
// places them; it never adds, filters or recounts a number.
//
// ORDER IS THE SHEET'S. The workbook has no right-to-left setting and every category axis runs
// min→max, so the first category — NXT, وصال, المهندسين — sits at the LEFT and the total bar at the
// RIGHT; the drawings and tables render `dir="ltr"` inside the Arabic page to keep it that way
// (DEC-19). The layout below therefore grows `x` with the category index, whatever the page's
// direction.
//
// COLOURS ARE THE OWNER'S. Charts 1–2 are one series in the workbook theme's accent1 #4472C4; chart
// 3 carries the six bank colours (D7), the same in both themes. Those colours fail the palette
// checks (spec §8.5), which is why every bar has its value written on it, chart 3 has a legend, and
// every chart has its table — the relief is mandatory, not decoration.
import {
  ATM_BANK_NAMES,
  ATM_BANK_REPORT_COLORS,
  ATM_DATA_REPORT_CELLS,
  ATM_REPORT_SECTION3_BANKS,
  ATM_REPORT_SECTION3_BRANCHES,
  ATM_REPORT_TOTALS_COLOR,
  readAtmReportCell,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterReportDto,
  type AtmReportCellRef,
  type Locale,
} from '@ecms/contracts';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * A count as the sheet shows it: Latin digits, no grouping (the cells are plain numbers), and `0`
 * written out — a zero is a fact on this report, never a blank (D7).
 */
export const reportCount = (value: number): string => String(value);

/** One bar of a single-series chart and the cell of the table under it. */
export interface ReportBar {
  /** The sheet cell's key (`s1.NXT`, `s2.EGYCASH-7`, `s1.total` …) — see `ATM_DATA_REPORT_CELLS`. */
  key: string;
  label: string;
  value: number;
  isTotal: boolean;
}

/** Sections 1 and 2: one series, the categories in the sheet's order, then the total bar. */
export interface ReportSingleSection {
  section: 1 | 2;
  title: string;
  color: string;
  /** Categories left to right, the total bar LAST. */
  bars: ReportBar[];
  total: number;
}

export interface ReportSeries {
  key: AtmBankCode;
  label: string;
  color: string;
}

/** One branch of section 3: six numbers, in the series' order. */
export interface ReportGroup {
  key: AtmRegisterBranchCode;
  label: string;
  /** The sheet cells, one per series, `s3.<branch>.<bank>`. */
  cells: { key: string; value: number }[];
}

/** Section 3: branches × banks, no totals (the sheet has none). */
export interface ReportGroupedSection {
  section: 3;
  title: string;
  series: ReportSeries[];
  groups: ReportGroup[];
  /** Σ of the drawn cells — only for the drawing's one-line summary. */
  total: number;
}

export interface RegisterReportView {
  generatedAt: string;
  section1: ReportSingleSection;
  section2: ReportSingleSection;
  section3: ReportGroupedSection;
  /** ACTIVE entries counted in section 1 only — their branch has no register code. */
  activeWithUnmappedBranch: number;
  /** ACTIVE entries counted in the branch figures only — they carry no bank. */
  activeWithoutBank: number;
  /** No machine in operation in this reader's reach at all. */
  empty: boolean;
}

const cellsOf = (section: 1 | 2 | 3): AtmReportCellRef[] =>
  ATM_DATA_REPORT_CELLS.filter((cell) => cell.section === section);

const bankLabel = (bank: AtmBankCode, locale: Locale): string => ATM_BANK_NAMES[bank][locale];

/** The report's model, from the server's DTO, in the reader's language. */
export const registerReportView = (
  dto: AtmRegisterReportDto,
  locale: Locale,
  t: Translate,
): RegisterReportView => {
  const { counts } = dto;
  const shown = new Set<AtmRegisterBranchCode>(dto.branchesShown);
  const totalLabel = t('atm.registerReport.total');

  const section1Bars: ReportBar[] = cellsOf(1).map((cell) => ({
    key: cell.key,
    label: cell.isTotal || cell.bankCode === null ? totalLabel : bankLabel(cell.bankCode, locale),
    value: readAtmReportCell(counts, cell),
    isTotal: cell.isTotal,
  }));

  // A branch outside the reader's reach is not a zero: it is not on the page at all (DEC-27).
  const section2Bars: ReportBar[] = cellsOf(2)
    .filter((cell) => cell.isTotal || (cell.branchCode !== null && shown.has(cell.branchCode)))
    .map((cell) => ({
      key: cell.key,
      label:
        cell.isTotal || cell.branchCode === null
          ? totalLabel
          : t(`atm.registerReport.branch2.${cell.branchCode}`),
      value: readAtmReportCell(counts, cell),
      isTotal: cell.isTotal,
    }));

  const section3Cells = cellsOf(3);
  const groups: ReportGroup[] = ATM_REPORT_SECTION3_BRANCHES.filter((code) => shown.has(code)).map(
    (code) => ({
      key: code,
      label: t(`atm.registerReport.branch3.${code}`),
      cells: ATM_REPORT_SECTION3_BANKS.map((bank) => {
        const cell = section3Cells.find((c) => c.branchCode === code && c.bankCode === bank);
        return {
          key: `s3.${code}.${bank}`,
          value: cell === undefined ? 0 : readAtmReportCell(counts, cell),
        };
      }),
    }),
  );

  return {
    generatedAt: dto.generatedAt,
    section1: {
      section: 1,
      title: t('atm.registerReport.section1'),
      color: ATM_REPORT_TOTALS_COLOR,
      bars: section1Bars,
      total: counts.section1.total,
    },
    section2: {
      section: 2,
      title: t('atm.registerReport.section2'),
      color: ATM_REPORT_TOTALS_COLOR,
      bars: section2Bars,
      total: counts.section2.total,
    },
    section3: {
      section: 3,
      title: t('atm.registerReport.section3'),
      series: ATM_REPORT_SECTION3_BANKS.map((bank) => ({
        key: bank,
        label: bankLabel(bank, locale),
        color: ATM_BANK_REPORT_COLORS[bank],
      })),
      groups,
      total: groups.reduce(
        (sum, group) => sum + group.cells.reduce((row, cell) => row + cell.value, 0),
        0,
      ),
    },
    activeWithUnmappedBranch: counts.activeWithUnmappedBranch,
    activeWithoutBank: counts.activeWithoutBank,
    // Every ACTIVE entry either has a bank (section 1 counts it) or has none (counted apart).
    empty: counts.section1.total + counts.activeWithoutBank === 0,
  };
};

/** True when section 2 has a branch to draw; its total alone would be a lone zero bar. */
export const hasBranchCategories = (section: ReportSingleSection): boolean =>
  section.bars.some((bar) => !bar.isTotal);

// ── Geometry ───────────────────────────────────────────────────────────────────────────────────
// The drawings are laid out in their own pixel units (the SVG's viewBox). A bar is never thicker
// than 24 px (spec §8.5); a chart that needs more room than its card scrolls sideways rather than
// squeezing its labels.

/** Charts 1–2. */
export const SINGLE_CHART = {
  padX: 16,
  slot: 96,
  bar: 24,
  /** The air between the last category and the total bar; the divider runs down its middle. */
  totalGap: 32,
  /** Room above the tallest bar for its value. */
  top: 26,
  plot: 176,
  bottom: 2,
} as const;

/** Chart 3. */
export const GROUPED_CHART = {
  padX: 16,
  bar: 20,
  /** The surface gap between two touching bars of one branch. */
  gap: 2,
  /** The air between two branches. */
  groupPad: 28,
  top: 22,
  plot: 200,
  bottom: 2,
} as const;

/** One drawn bar. `height` is 0 for a zero — the value label still stands on the baseline. */
export interface BarMark {
  key: string;
  /** The bar's left edge (and the slot's, for the hover target: `slotX`, `slotWidth`). */
  x: number;
  width: number;
  y: number;
  height: number;
  value: number;
  isTotal: boolean;
  /** The centre of the bar — where its value label and its tooltip sit. */
  cx: number;
  slotX: number;
  slotWidth: number;
}

/** A category's column under the drawing, for its label. */
export interface CategorySlot {
  key: string;
  x: number;
  width: number;
}

export interface ChartLayout {
  width: number;
  height: number;
  baseline: number;
  marks: BarMark[];
  slots: CategorySlot[];
  /** Value gridlines (chart 3 only): the y of each line and its value. */
  gridlines: { y: number; value: number }[];
  /** The 1 px divider before the total bar (charts 1–2), or null. */
  dividerX: number | null;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** A clean step (1, 2 or 5 × 10ⁿ) that splits `max` into at most four lines. */
export const niceStep = (max: number, lines = 4): number => {
  if (max <= 0) return 1;
  const raw = max / lines;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  return Math.max(1, step);
};

const barHeight = (value: number, top: number, plot: number): number => {
  if (value <= 0 || top <= 0) return 0;
  // A small count is still visibly more than nothing.
  return round(Math.max(1, (value / top) * plot));
};

/** Charts 1–2: the categories, a gap with the divider, then the total bar. */
export const singleChartLayout = (bars: readonly ReportBar[]): ChartLayout => {
  const g = SINGLE_CHART;
  const categories = bars.filter((bar) => !bar.isTotal);
  const total = bars.find((bar) => bar.isTotal);
  const top = bars.reduce((max, bar) => Math.max(max, bar.value), 0);
  const baseline = g.top + g.plot;

  const slotXs = categories.map((_, i) => g.padX + i * g.slot);
  const totalSlotX = g.padX + categories.length * g.slot + (categories.length > 0 ? g.totalGap : 0);
  const ordered: { bar: ReportBar; slotX: number }[] = [
    ...categories.map((bar, i) => ({ bar, slotX: slotXs[i] ?? 0 })),
    ...(total === undefined ? [] : [{ bar: total, slotX: totalSlotX }]),
  ];

  const marks = ordered.map(({ bar, slotX }): BarMark => {
    const height = barHeight(bar.value, top, g.plot);
    const x = slotX + (g.slot - g.bar) / 2;
    return {
      key: bar.key,
      x,
      width: g.bar,
      y: round(baseline - height),
      height,
      value: bar.value,
      isTotal: bar.isTotal,
      cx: x + g.bar / 2,
      slotX,
      slotWidth: g.slot,
    };
  });

  const width =
    g.padX * 2 +
    categories.length * g.slot +
    (total === undefined ? 0 : g.slot + (categories.length > 0 ? g.totalGap : 0));
  return {
    width,
    height: baseline + g.bottom,
    baseline,
    marks,
    slots: marks.map((mark) => ({ key: mark.key, x: mark.slotX, width: mark.slotWidth })),
    gridlines: [],
    dividerX:
      total !== undefined && categories.length > 0
        ? g.padX + categories.length * g.slot + g.totalGap / 2
        : null,
  };
};

/** Chart 3: one cluster per branch, the six banks side by side inside it. */
export const groupedChartLayout = (
  groups: readonly ReportGroup[],
  seriesCount: number,
): ChartLayout => {
  const g = GROUPED_CHART;
  const inner = seriesCount * g.bar + Math.max(0, seriesCount - 1) * g.gap;
  const slot = inner + g.groupPad;
  const max = groups.reduce(
    (most, group) => group.cells.reduce((m, cell) => Math.max(m, cell.value), most),
    0,
  );
  const step = niceStep(max);
  const top = max === 0 ? 0 : Math.ceil(max / step) * step;
  const baseline = g.top + g.plot;

  const marks: BarMark[] = groups.flatMap((group, gi) => {
    const slotX = g.padX + gi * slot;
    return group.cells.map((cell, si): BarMark => {
      const x = slotX + g.groupPad / 2 + si * (g.bar + g.gap);
      const height = barHeight(cell.value, top, g.plot);
      return {
        key: cell.key,
        x,
        width: g.bar,
        y: round(baseline - height),
        height,
        value: cell.value,
        isTotal: false,
        cx: x + g.bar / 2,
        // The hover target is the bar's own column, gap included, from the plot's top.
        slotX: x - g.gap / 2,
        slotWidth: g.bar + g.gap,
      };
    });
  });

  const gridlines: { y: number; value: number }[] = [];
  if (top > 0) {
    for (let value = step; value <= top; value += step) {
      gridlines.push({ y: round(baseline - (value / top) * g.plot), value });
    }
  }

  return {
    width: g.padX * 2 + groups.length * slot,
    height: baseline + g.bottom,
    baseline,
    marks,
    slots: groups.map((group, gi) => ({ key: group.key, x: g.padX + gi * slot, width: slot })),
    gridlines,
    dividerX: null,
  };
};

/**
 * A bar with a 4 px rounded data end and a square foot on the baseline. Empty for a zero — there is
 * nothing to draw, and the value label says `0`.
 */
export const barPath = (mark: Pick<BarMark, 'x' | 'y' | 'width' | 'height'>): string => {
  if (mark.height <= 0) return '';
  const r = round(Math.min(4, mark.width / 2, mark.height));
  const { x, y, width: w } = mark;
  const base = round(y + mark.height);
  return [
    `M${String(round(x))} ${String(base)}`,
    `V${String(round(y + r))}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(round(x + r))} ${String(round(y))}`,
    `H${String(round(x + w - r))}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(round(x + w))} ${String(round(y + r))}`,
    `V${String(base)}`,
    'Z',
  ].join(' ');
};

/**
 * The CSS grid tracks that put each category's label exactly under its slot: the slots and the air
 * between them, as fractions of the drawing's width (so the labels follow the drawing when it is
 * scaled for print).
 */
export const labelTracks = (layout: Pick<ChartLayout, 'width' | 'slots'>): string => {
  const tracks: string[] = [];
  const track = (size: number): void => {
    if (size > 0) tracks.push(`minmax(0, ${String(round(size))}fr)`);
  };
  let end = 0;
  for (const slot of layout.slots) {
    track(slot.x - end);
    track(slot.width);
    end = slot.x + slot.width;
  }
  track(layout.width - end);
  return tracks.join(' ');
};

/** Which grid track (1-based) holds the label of each slot — after the air tracks before it. */
export const labelColumns = (layout: Pick<ChartLayout, 'slots'>): number[] => {
  const columns: number[] = [];
  let column = 0;
  let end = 0;
  for (const slot of layout.slots) {
    if (slot.x - end > 0) column += 1;
    column += 1;
    columns.push(column);
    end = slot.x + slot.width;
  }
  return columns;
};

// «آخر التقارير» as a file — the sample's «تصدير Excel» and «تصدير PDF» beside the title. What every
// IT register's file shares — the walk over every page the filters match, the report form, the tab
// opened before the rows are gathered — is `register-export.ts`; this is what a check report says.
//
// THE REPORTS THE FILTERS MATCH, NOT THE CARDS ON SCREEN. The list is paged; a reader who narrows it
// to «آخر ٧ أيام · المهندسين · بها عطل» and presses Excel means every such report. So the file asks
// `GET /it/vehicle-checks` again with the list's own filters, the paging taken off, and walks every
// page — newest first, the list's order.
//
// One line per report: the car, the branch it was filed under, the day it is for, when it was sent
// and by whom, then the eleven devices in the owner's order — each in the form's own words, «يعمل»,
// «لا يعمل» or «لم يُفحص» — then how many failed, the note, and how many photos it holds. In the
// sheet the two counts are numbers a reader can sum; on paper every figure is in the reader's
// digits, and an empty box reads «—».
import { IT_VEHICLE_CHECK_ITEMS, type ItVehicleCheckDto, type Locale } from '@ecms/contracts';
import { formatBusinessDateTime, formatNumber } from '../../../shared/lib/format';
import { type XlsxCell } from '../../../shared/lib/xlsx-writer';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { filterLine, itRegisterReport, namedFilter, type Translate } from './register-export';
import {
  answerCounts,
  carText,
  deviceLabel,
  deviceState,
  formatYmd,
  stateWord,
  type VehicleCheckFilters,
} from './vehicle-check-dashboard';

export interface VehicleCheckRegisterContext {
  t: Translate;
  locale: Locale;
  /** Branch id → its name, as the page resolves it. */
  branchName: ReadonlyMap<string, string>;
}

/** The heading row: who and when, the eleven devices, then the counts and the note. */
export const vehicleCheckRegisterHeader = (t: Translate, locale: Locale): string[] => [
  t('it.vehicleChecks.columns.car'),
  t('it.assets.columns.branch'),
  t('it.vehicleChecks.columns.day'),
  t('it.vehicleChecks.columns.sentAt'),
  t('it.vehicleChecks.columns.reporter'),
  ...IT_VEHICLE_CHECK_ITEMS.map((item) => deviceLabel(t, locale, item)),
  t('it.vehicleChecks.columns.faults'),
  t('it.vehicleCheck.notes'),
  t('it.vehicleCheck.photos'),
];

const line = <F extends XlsxCell>(
  row: ItVehicleCheckDto,
  { t, locale, branchName }: VehicleCheckRegisterContext,
  empty: string,
  figure: (n: number) => F,
): (string | F)[] => [
  row.vehicleCode,
  // The branch the car had when the report was filed — the report's own, and its scope's anchor.
  // One the options no longer hold (a closed branch) is a blank, as on the custody register.
  row.branchId === null ? empty : (branchName.get(row.branchId) ?? empty),
  formatYmd(row.checkDate, locale),
  formatBusinessDateTime(row.createdAt, locale),
  row.reportedByName,
  ...IT_VEHICLE_CHECK_ITEMS.map((item) => stateWord(t, deviceState(row.items[item]))),
  figure(answerCounts(row.items).notWorking),
  row.notes ?? empty,
  figure(row.photos.length),
];

/** One report as a line of the workbook: the two counts as numbers, a blank where nothing is. */
export const vehicleCheckSheetLine = (
  row: ItVehicleCheckDto,
  context: VehicleCheckRegisterContext,
): XlsxCell[] => line<number>(row, context, '', (n) => n);

/** One report as a line of the printed page: every figure in the reader's digits, «—» for nothing. */
export const vehicleCheckPaperLine = (
  row: ItVehicleCheckDto,
  context: VehicleCheckRegisterContext,
): string[] => line<string>(row, context, '—', (n) => formatNumber(n, context.locale));

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface VehicleCheckRegisterFilters {
  /**
   * The period's two days, in the reader's words — one when the period is «اليوم»; both `null` for
   * every day, the list of a car pinned by its id (`reportsWindow`).
   */
  from: string | null;
  to: string | null;
  /** The branch by name; `''` for one set but not among the options; `null` for every branch. */
  branch: string | null;
  /** «السيارة» as typed, or the code of the car picked from a report. */
  car: string | null;
  faults: boolean;
  /** The device «لا يعمل», by its label. */
  device: string | null;
}

/**
 * The page's filters, named for paper. A filter in force is never dropped: a register narrowed to
 * one branch that printed without saying so would read as the company's. So a car picked by its id
 * with no code beside it (an edited link) is named by the gathered rows — every one is that car's —
 * and else said to be one car («سيارة محددة»).
 */
export const vehicleCheckRegisterFilters = ({
  t,
  locale,
  filters,
  window,
  branchName,
  rows,
}: {
  t: Translate;
  locale: Locale;
  filters: VehicleCheckFilters;
  /** The days the list covers — `reportsWindow`'s, `null` for every day. */
  window: { from: string; to: string } | null;
  branchName: ReadonlyMap<string, string>;
  rows: readonly ItVehicleCheckDto[];
}): VehicleCheckRegisterFilters => {
  const typed = carText(filters.car);
  return {
    from: window === null ? null : formatYmd(window.from, locale),
    to: window === null ? null : formatYmd(window.to, locale),
    branch: filters.branchId === '' ? null : (branchName.get(filters.branchId) ?? ''),
    car:
      typed !== ''
        ? typed
        : filters.vehicleId === ''
          ? null
          : (rows.find((row) => row.vehicleId === filters.vehicleId)?.vehicleCode ??
            t('it.vehicleChecks.export.oneCar')),
    faults: filters.faults,
    device: filters.device === null ? null : deviceLabel(t, locale, filters.device),
  };
};

/** The period as the printed page names it: its days, its one day, or «كل الأيام». */
const periodWords = (t: Translate, from: string | null, to: string | null): string => {
  if (from === null || to === null) return t('it.vehicleChecks.export.allDays');
  return from === to
    ? t('it.vehicleChecks.export.dayIs', { day: from })
    : t('it.vehicleChecks.export.periodIs', { range: t('it.export.dayRange', { from, to }) });
};

/**
 * What the printed page is a view OF, under its title: the period's days (or «كل الأيام» for a
 * car pinned by its id), the branch, then every other filter that is set — the car, «بها عطل», the
 * device — and the day it was taken.
 */
export const vehicleCheckRegisterSubtitle = (
  t: Translate,
  filters: VehicleCheckRegisterFilters & { asOf: string },
): string =>
  filterLine([
    periodWords(t, filters.from, filters.to),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.car === null ? null : t('it.vehicleChecks.export.carIs', { code: filters.car }),
    filters.faults ? t('it.vehicleChecks.export.faultsOnly') : null,
    filters.device === null
      ? null
      : t('it.vehicleChecks.export.deviceIs', { device: filters.device }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);

/** The printed register: the company's report form, landscape for nineteen columns. */
export const vehicleCheckRegisterReport = (
  rows: readonly ItVehicleCheckDto[],
  context: VehicleCheckRegisterContext,
  subtitle: string,
): FleetReport =>
  itRegisterReport({
    t: context.t,
    title: context.t('it.vehicleChecks.title'),
    header: vehicleCheckRegisterHeader(context.t, context.locale),
    rows: rows.map((row) => vehicleCheckPaperLine(row, context)),
    subtitle,
    orientation: 'landscape',
  });

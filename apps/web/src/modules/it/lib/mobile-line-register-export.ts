// The mobile-line register as a file — the asset and custody registers' Excel and PDF, on the
// lines' screen: every line the filters match, in the table's order, not the page on screen. What
// every IT register's file shares is `register-export.ts`; this is what the lines' table says.
//
// The columns are the table's, with the holder's code given a column of its own (in a sheet a
// code is something to filter by, not a caption): the network, the number, the plan, the SIM
// serial, the account, the status, the holder, their code, the branch and the hand-over date.
//
// TEXT, NOT LOGOS. A sheet's cell and the report form's row hold words, so the network is written
// by its name. And the number, the ICCID and the account are passed as STRINGS: the workbook keeps
// a JS number numeric, which would drop the line's leading 0 and the last digits of a 20-digit
// ICCID.
import {
  type ItMobileLineDto,
  type ItMobileLineHolderDto,
  type ItMobileLineHolderKind,
  type ItMobileLineStatus,
  type ItMobileNetwork,
  type Locale,
} from '@ecms/contracts';
import { formatDate } from '../../../shared/lib/format';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { filterLine, itRegisterReport, namedFilter, type Translate } from './register-export';

export interface MobileLineRegisterContext {
  t: Translate;
  locale: Locale;
  /** Branch id → its name, as the table resolves it. */
  branchName: ReadonlyMap<string, string>;
}

/** Who holds a line, as far as a label needs: an employee, or a car by its code and plate. */
export type MobileLineHolderFacts = Pick<
  ItMobileLineHolderDto,
  'kind' | 'employeeId' | 'employeeName' | 'employeeCode' | 'vehicleCode' | 'vehiclePlate'
>;

/** «سيارة 204 — س ص 63»: a car by what the network's sheet wrote — its code, its plate, or both. */
const carLabel = (t: Translate, holder: MobileLineHolderFacts): string => {
  const car = [holder.vehicleCode, holder.vehiclePlate]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' — ');
  const word = t('it.mobileLines.holderKind.vehicle');
  return car === '' ? word : `${word} ${car}`;
};

/**
 * The holder in one line of text — «محمد أحمد علي (0100052)», or «سيارة 204 — س ص 63». An employee
 * HR cannot name is shown by the code, then the id the row carries, never by a guess.
 */
export const mobileLineHolderLabel = (t: Translate, holder: MobileLineHolderFacts): string => {
  if (holder.kind === 'vehicle') return carLabel(t, holder);
  if (holder.employeeName !== null) {
    return holder.employeeCode === null
      ? holder.employeeName
      : `${holder.employeeName} (${holder.employeeCode})`;
  }
  return holder.employeeCode ?? holder.employeeId ?? '—';
};

/** The heading row, in the table's order. */
export const mobileLineRegisterHeader = (t: Translate): string[] => [
  t('it.mobileLines.columns.network'),
  t('it.mobileLines.columns.number'),
  t('it.mobileLines.columns.plan'),
  t('it.mobileLines.columns.simSerial'),
  t('it.mobileLines.columns.account'),
  t('it.assets.columns.status'),
  t('it.custody.holder'),
  t('it.mobileLines.columns.holderCode'),
  t('it.assets.columns.branch'),
  t('it.custody.assignedAt'),
];

/**
 * One line as a line of the file. `empty` is what a blank cell holds: nothing in the sheet, «—» on
 * paper. A car holder is «سيارة» with its plate, its code in the code column — the employee's code
 * is where an employee's would be.
 */
export const mobileLineRegisterLine = (
  row: ItMobileLineDto,
  { t, locale, branchName }: MobileLineRegisterContext,
  empty: string,
): string[] => {
  const holder = row.holder;
  const car = holder?.kind === 'vehicle';
  const plate = holder?.vehiclePlate ?? null;
  return [
    t(`it.mobileLines.network.${row.network}`),
    row.phoneNumber,
    row.ratePlan ?? empty,
    row.simKind === 'esim' ? t('it.mobileLines.esim') : (row.simSerial ?? empty),
    row.accountNumber ?? empty,
    t(`it.mobileLines.status.${row.status}`),
    holder === null
      ? empty
      : car
        ? plate === null
          ? t('it.mobileLines.holderKind.vehicle')
          : `${t('it.mobileLines.holderKind.vehicle')} — ${plate}`
        : (holder.employeeName ?? holder.employeeId ?? empty),
    holder === null ? empty : car ? (holder.vehicleCode ?? empty) : (holder.employeeCode ?? empty),
    branchName.get(row.branchId) ?? empty,
    holder === null ? empty : formatDate(holder.assignedAt, locale),
  ];
};

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface MobileLineRegisterFilters {
  /** The networks pressed; empty is every network. */
  networks: readonly ItMobileNetwork[];
  status: ItMobileLineStatus | null;
  /** `''` when a branch is set but its name is not among the options. */
  branch: string | null;
  holder: string | null;
  kind: ItMobileLineHolderKind | null;
  search: string | null;
}

/**
 * The screen's filters, named for paper. A filter in force is never dropped: a branch whose name
 * cannot be had prints as «فرع محدد», and a holder as the rows' own name for them, the chip's
 * label, or, failing both, the id.
 */
export const mobileLineRegisterFilters = ({
  networks,
  search,
  status,
  branchId,
  branchName,
  holderId,
  holderLabel,
  kind,
  rows,
}: {
  networks: readonly ItMobileNetwork[];
  search: string;
  status: string;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  holderId: string;
  holderLabel: string;
  kind: string;
  rows: readonly ItMobileLineDto[];
}): MobileLineRegisterFilters => ({
  networks,
  search: search.trim() === '' ? null : search.trim(),
  status: status === '' ? null : (status as ItMobileLineStatus),
  branch: branchId === '' ? null : (branchName.get(branchId) ?? ''),
  holder:
    holderId === ''
      ? null
      : rows.find((row) => row.holder?.employeeId === holderId)?.holder?.employeeName ||
        holderLabel ||
        holderId,
  kind: kind === '' ? null : (kind as ItMobileLineHolderKind),
});

/**
 * What the printed page is a view OF, under its title: the networks, the status, the branch, who
 * holds the lines, the search, and the day it was taken — a register on paper is only true as of
 * a date.
 */
export const mobileLineRegisterSubtitle = (
  t: Translate,
  filters: MobileLineRegisterFilters & { asOf: string },
): string =>
  filterLine([
    filters.networks.length === 0
      ? t('it.mobileLines.allNetworks')
      : filters.networks.map((network) => t(`it.mobileLines.network.${network}`)).join('، '),
    filters.status === null
      ? t('it.mobileLines.allStatuses')
      : t(`it.mobileLines.status.${filters.status}`),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.kind === null ? null : t(`it.mobileLines.heldBy.${filters.kind}`),
    filters.holder === null ? null : t('it.export.holderIs', { name: filters.holder }),
    filters.search === null ? null : t('it.export.searchIs', { q: filters.search }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);

/** The printed register: the company's report form, landscape for ten columns, nobody signs it. */
export const mobileLineRegisterReport = (
  rows: readonly ItMobileLineDto[],
  context: MobileLineRegisterContext,
  subtitle: string,
): FleetReport =>
  itRegisterReport({
    t: context.t,
    title: context.t('it.nav.mobileLines'),
    header: mobileLineRegisterHeader(context.t),
    rows: rows.map((row) => mobileLineRegisterLine(row, context, '—')),
    subtitle,
    orientation: 'landscape',
  });

// The consumables ledger as a file (FR-20) — «حركات المستهلكات» as Excel and PDF: every movement
// the filters match, newest first, as the table orders them. What every IT register's file shares
// is `register-export.ts`; this is what the ledger's table says.
//
// The columns are the table's — the date, the movement, the item, the quantity, the employee,
// what it was installed on, the reason, the memo and who recorded it — with the codes the table
// stacks under a name given columns of their own (in a sheet a code is something to filter by,
// not a caption), and the memo's signature in words beside its number.
//
// THE QUANTITY IS SIGNED BY ITS KIND, and is a number in the sheet: a receipt or a return adds to
// the store, an issue or a scrap takes from it, so a column of one item's movements sums to what
// the store gained over the period. On paper it is written in the reader's digits.
import {
  IT_CONSUMABLE_ISSUE_REASONS,
  formatConsumableMemoNumber,
  type ItConsumableIssueReason,
  type ItConsumableMovementDto,
  type ItConsumableMovementKind,
  type Locale,
} from '@ecms/contracts';
import { formatDate, formatDateTime } from '../../../shared/lib/format';
import { type XlsxCell } from '../../../shared/lib/xlsx-writer';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { paperCells } from './consumable-register-export';
import { filterLine, itRegisterReport, namedFilter, type Translate } from './register-export';

// ── What a movement says, read BY KIND — the screens' columns read these too ──

/** Which way a kind moves the store: a receipt and a return add to it, an issue and a scrap take. */
export const MOVEMENT_SIGN: Readonly<Record<ItConsumableMovementKind, 1 | -1>> = {
  received: 1,
  issued: -1,
  scrapped: -1,
  returned: 1,
};

const isIssueReason = (value: string | null): value is ItConsumableIssueReason =>
  (IT_CONSUMABLE_ISSUE_REASONS as readonly string[]).includes(value ?? '');

/**
 * A movement's reason in words: an issue's «جديد» / «بدل تالف», a scrap's own text, nothing for a
 * receipt or a return (their notes say what there is to say).
 */
export const movementReason = (t: Translate, movement: ItConsumableMovementDto): string | null => {
  if (movement.kind === 'issued') {
    return isIssueReason(movement.reason) ? t(`it.consumables.reason.${movement.reason}`) : null;
  }
  if (movement.kind === 'scrapped') {
    const reason = movement.reason?.trim() ?? '';
    return reason === '' ? null : reason;
  }
  return null;
};

/**
 * The reason cell as the table shows it: the reason, and the movement's notes beside it — a
 * receipt's supplier invoice, the source an opening balance names — so the file can be read
 * against the papers as the screen can. Null when there is neither.
 */
export const movementReasonAndNotes = (
  t: Translate,
  movement: ItConsumableMovementDto,
): string | null => {
  const reason = movementReason(t, movement);
  const notes = movement.notes?.trim() ?? '';
  if (notes === '') return reason;
  return reason === null ? notes : `${reason} — ${notes}`;
};

/** «محمد أحمد علي (0100052)» — or the code, then the id, never a guess. */
export const movementEmployee = (movement: ItConsumableMovementDto): string | null => {
  if (movement.employeeId === null) return null;
  if (movement.employeeName !== null) {
    return movement.employeeCode === null
      ? movement.employeeName
      : `${movement.employeeName} (${movement.employeeCode})`;
  }
  return movement.employeeCode ?? movement.employeeId;
};

/** «AST-00012 — لاب توب Lenovo» — what the reader's scope lets the server name, or nothing. */
export const movementAsset = (movement: ItConsumableMovementDto): string | null => {
  if (movement.assetId === null) return null;
  const label = [movement.assetCode, movement.assetName]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' — ');
  return label === '' ? null : label;
};

// ── The file ─────────────────────────────────────────────────────────────────

export interface ConsumableMovementRegisterContext {
  t: Translate;
  locale: Locale;
  /** Type id → its name, from the `consumableType` catalog the table reads. */
  typeName: ReadonlyMap<string, string>;
  /** User id → their name, for «بواسطة»; an id it cannot name is left blank, never guessed. */
  userName: ReadonlyMap<string, string>;
}

/** The heading row, in the table's order — each code right after the name it belongs to. */
export const consumableMovementRegisterHeader = (t: Translate): string[] => [
  t('it.consumables.movements.columns.at'),
  t('it.consumables.movements.columns.kind'),
  t('it.consumables.movements.columns.item'),
  t('it.consumables.export.itemCode'),
  t('it.consumables.columns.type'),
  t('it.consumables.movements.columns.qty'),
  t('it.consumables.movements.columns.employee'),
  t('it.custody.export.holderCode'),
  t('it.consumables.movements.columns.installedOn'),
  t('it.consumables.movements.columns.reason'),
  t('it.consumables.export.memoNumber'),
  t('it.consumables.export.memoState'),
  t('it.consumables.movements.columns.by'),
];

/**
 * One movement as a line of the workbook. `empty` is what a blank cell holds — nothing in the
 * sheet, «—» on paper. The quantity is a signed number; everything else is words.
 */
export const consumableMovementRegisterLine = (
  row: ItConsumableMovementDto,
  { t, locale, typeName, userName }: ConsumableMovementRegisterContext,
  empty: string,
): XlsxCell[] => [
  formatDateTime(row.at, locale),
  t(`it.consumables.kind.${row.kind}`),
  row.consumableName ?? t('it.custody.assetUnknown'),
  row.consumableCode ?? empty,
  row.typeId === null ? empty : (typeName.get(row.typeId) ?? empty),
  MOVEMENT_SIGN[row.kind] * row.qty,
  row.employeeId === null ? empty : (row.employeeName ?? row.employeeId),
  row.employeeCode ?? empty,
  movementAsset(row) ?? (row.assetId === null ? empty : t('it.custody.assetUnknown')),
  movementReasonAndNotes(t, row) ?? empty,
  row.memoNumber === null ? empty : formatConsumableMemoNumber(row.memoNumber),
  row.memoId === null
    ? empty
    : row.memoSigned === true
      ? t('it.custody.receipt.signed')
      : t('it.custody.receipt.awaitingSignature'),
  row.byUserId === null ? empty : (userName.get(row.byUserId) ?? empty),
];

/** A date window as paper writes it — each bound a day in the reader's words, null when open. */
export interface MovementDayWindow {
  from: string | null;
  to: string | null;
}

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface ConsumableMovementRegisterFilters {
  kind: ItConsumableMovementKind | null;
  /** `''` when a type is set but its name is not among the options. */
  type: string | null;
  /** `''` when a branch is set but its name is not among the options. */
  branch: string | null;
  employee: string | null;
  asset: string | null;
  period: MovementDayWindow | null;
  search: string | null;
}

/**
 * A day the reader PICKED, written for paper: the screen holds it as `YYYY-MM-DD`, which read as
 * an instant is UTC midnight — the day before anywhere west of Greenwich. Read at local midnight
 * it is the day that was picked (the custody register's rule).
 */
const pickedDay = (day: string, locale: Locale): string => formatDate(`${day}T00:00:00`, locale);

/**
 * The screen's filters, named for paper. A filter in force is never dropped: a person or an asset
 * is named by the gathered rows first (every one of them is theirs), then the chip's label, then
 * the id; a type or a branch whose name cannot be had prints as «نوع محدد» / «فرع محدد».
 */
export const consumableMovementRegisterFilters = ({
  locale,
  kind,
  typeId,
  typeName,
  branchId,
  branchName,
  employeeId,
  employeeLabel,
  assetId,
  assetLabel,
  from,
  to,
  search,
  rows,
}: {
  locale: Locale;
  kind: ItConsumableMovementKind | null;
  typeId: string;
  typeName: ReadonlyMap<string, string>;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  employeeId: string;
  employeeLabel: string;
  assetId: string;
  assetLabel: string;
  from: string;
  to: string;
  search: string;
  rows: readonly ItConsumableMovementDto[];
}): ConsumableMovementRegisterFilters => {
  const byEmployee = rows.find((row) => row.employeeId === employeeId && row.employeeName !== null);
  const byAsset = rows.find((row) => row.assetId === assetId && movementAsset(row) !== null);
  return {
    kind,
    type: typeId === '' ? null : (typeName.get(typeId) ?? ''),
    branch: branchId === '' ? null : (branchName.get(branchId) ?? ''),
    employee: employeeId === '' ? null : byEmployee?.employeeName || employeeLabel || employeeId,
    asset:
      assetId === ''
        ? null
        : (byAsset === undefined ? null : movementAsset(byAsset)) || assetLabel || assetId,
    period:
      from === '' && to === ''
        ? null
        : {
            from: from === '' ? null : pickedDay(from, locale),
            to: to === '' ? null : pickedDay(to, locale),
          },
    search: search.trim() === '' ? null : search.trim(),
  };
};

/** «من … إلى …», or the one bound that is set. */
const windowText = (t: Translate, window: MovementDayWindow): string =>
  window.from !== null && window.to !== null
    ? t('it.export.dayRange', { from: window.from, to: window.to })
    : window.from !== null
      ? t('it.export.dayFrom', { from: window.from })
      : t('it.export.dayTo', { to: window.to ?? '' });

/**
 * What the printed page is a view OF, under its title: the movement, the type, the branch, then
 * every other filter that is set — the employee, the asset, the period, the search — and the day
 * it was taken.
 */
export const consumableMovementRegisterSubtitle = (
  t: Translate,
  filters: ConsumableMovementRegisterFilters & { asOf: string },
): string =>
  filterLine([
    filters.kind === null
      ? t('it.consumables.movements.allKinds')
      : t(`it.consumables.kind.${filters.kind}`),
    namedFilter(t, filters.type, {
      all: 'it.consumables.allTypes',
      one: 'it.consumables.export.oneType',
    }),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.employee === null
      ? null
      : t('it.consumables.export.employeeIs', { name: filters.employee }),
    filters.asset === null ? null : t('it.consumables.export.assetIs', { name: filters.asset }),
    filters.period === null
      ? null
      : t('it.consumables.export.periodIs', { range: windowText(t, filters.period) }),
    filters.search === null ? null : t('it.export.searchIs', { q: filters.search }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);

/** The printed ledger: the company's report form, landscape for thirteen columns, nobody signs it. */
export const consumableMovementRegisterReport = (
  rows: readonly ItConsumableMovementDto[],
  context: ConsumableMovementRegisterContext,
  subtitle: string,
): FleetReport =>
  itRegisterReport({
    t: context.t,
    title: context.t('it.nav.consumableMovements'),
    header: consumableMovementRegisterHeader(context.t),
    rows: rows.map((row) =>
      paperCells(consumableMovementRegisterLine(row, context, '—'), context.locale),
    ),
    subtitle,
    orientation: 'landscape',
  });

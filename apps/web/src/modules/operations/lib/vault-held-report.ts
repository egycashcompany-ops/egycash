// «تقرير الخزينة» — what the vault holds NOW, as «سجل الخزينة» shows it (`VaultHeldReportDialog.tsx`):
// the decisions over the server's answer (`GET /operations/reports/vault/held`), pure, so they are
// asserted directly.
//
// THE OWNER: «سجل الخزينه لما اوس على تقرير يفتح ززى موديل زى لوحة التحكم اللى عملنها فى العهدة». The
// report left the band over the history and became a modal opened from the history's toolbar, built
// as Fleet's custody dashboard is — and like it, it leads with figure tiles. The tiles are read off
// the server's GRAND TOTAL, never the rows added up (Q27), and the money is split by the boards' one
// classifier (`reportMoney` → `currencyKind`: code, name or legacy alias), so «المصري» on a tile is
// «المصري» in the table's «الإجمالي» under it, figure for figure.
import {
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsReportTotalsDto,
  type OperationsVaultHeldReportDto,
} from '@ecms/contracts';
import {
  bankRank,
  reportMoney,
  reportRowsInOrder,
  type ReportBoardRow,
  type ReportMoney,
} from './report-board';

/**
 * The report's rows as the table draws them: the banks in the reference order (Q31), the
 * unattributed bucket last — exactly as «تجميع الخزينة» orders its own.
 */
export const heldReportRows = (
  rows: OperationsVaultHeldReportDto['rows'],
  banks: readonly Pick<OperationsBankDto, 'id' | 'code' | 'sortOrder'>[],
): ReportBoardRow[] => {
  const rankOf = bankRank(banks);
  return reportRowsInOrder(
    rows,
    (row) => row.bankId === null,
    (row) => rankOf(row.bankId),
  ).map((row) => ({
    key: row.bankId ?? 'unattributed',
    label: row.bankName,
    unattributed: row.bankId === null,
    totals: row.totals,
  }));
};

/** The figure tiles across the report's top — what the vault holds now, in one look. */
export interface HeldReportTiles {
  /** «عدد المحصنات». */
  count: number;
  /** «المصري», «الدولار» and «عملات أخرى» — the last kept apart per currency for its breakdown. */
  money: ReportMoney;
  /** «الحقائب», «الكراتين», «الصناديق» — counted once per محصنة by the server (Q26). */
  bags: number;
  cartons: number;
  boxes: number;
}

/**
 * The tiles, from the grand total alone. With no محصنة held the server's total is all zeros and
 * so is every tile: the custody dashboard's rule — the figures keep their frame and say 0 — rather
 * than a screen with nothing on it.
 */
export const heldReportTiles = (
  grandTotal: OperationsReportTotalsDto,
  catalog: readonly OperationsCurrencyDto[],
): HeldReportTiles => ({
  count: grandTotal.shipmentCount,
  money: reportMoney(grandTotal.currencies, catalog),
  bags: grandTotal.bagCount,
  cartons: grandTotal.cartonCount,
  boxes: grandTotal.boxCount,
});

/**
 * Which face the report wears — the custody dashboard's three (`custodyDashboardView`). An answer
 * is shown whenever there is one, even beside a failed refetch (dimmed while a new one is on its
 * way); the error face is for a report that never answered.
 */
export type HeldReportFace = 'loading' | 'error' | 'ready';
export const heldReportFace = (query: {
  isError: boolean;
  data: OperationsVaultHeldReportDto | undefined;
}): HeldReportFace => {
  if (query.data !== undefined) return 'ready';
  if (query.isError) return 'error';
  return 'loading';
};

/**
 * Does this modal answer Escape — is it the TOP dialog on the page? The report opens the boards'
 * «عملات أخرى» breakdown over itself; that dialog is the later root in the page's
 * `[data-dialog-root]` stack (the shared Dialog and `DesignDialog` read the same stack), and while
 * it is up, Escape closes it alone: the report under it stays open. Where Tab goes meanwhile is
 * `focusScope`'s.
 */
export const isTopDialog = <T>(roots: readonly T[], mine: T | null): boolean =>
  mine !== null && roots.length > 0 && roots[roots.length - 1] === mine;

/**
 * Where Tab keeps the focus while this modal is up: in the report itself, or, while a dialog it
 * opened sits over it (the «عملات أخرى» breakdown), in that dialog. The boards' breakdown keeps no
 * focus of its own, so a report that simply stopped trapping under it let Tab walk out of both into
 * the history behind: in the browser, 30 of 40 presses landed on the page under the modal. A dialog
 * that was already open UNDER the report (one earlier in the stack) never takes its focus. `null`
 * while the modal is not mounted.
 */
export const focusScope = <T>(roots: readonly T[], mine: T | null): T | null => {
  if (mine === null) return null;
  const at = roots.indexOf(mine);
  if (at === -1 || at === roots.length - 1) return mine;
  return roots[roots.length - 1] ?? mine;
};

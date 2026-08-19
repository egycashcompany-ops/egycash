// The daily board's client-side decisions — extracted as pure functions so they can be asserted
// directly, rather than through a simulated DOM.
//
// WHAT BELONGS HERE AND WHAT DOES NOT. The board's MEMBERSHIP — which shipments the desk works
// today — is a business rule and lives on the server (`GET /operations/shipments/day-board`).
// What lives here is presentation over an already-fetched day: the operator's search boxes, the
// row numbering, and the status wording. The legacy screen mixed the two, filtering rows by
// reading their rendered background colour (main_ops.ejs:995) — a genuinely fragile idea this
// replaces with data.
import {
  type OperationsShipmentDto,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';

/**
 * The eight filters the legacy board offered (main_ops.ejs:966-1010), as data.
 *
 * Legacy matched each with a case-insensitive substring test over the rendered cell text. That
 * behaviour is PRESERVED — an operator types a fragment of a bank or branch name, not an exact
 * value — but it now runs over the shipment's fields rather than over its HTML.
 */
export interface DayBoardFilters {
  bank: string;
  origin: string;
  destination: string;
  area: string;
  notes: string;
  type: OperationsShipmentType | '';
  received: 'yes' | 'no' | '';
}

export const EMPTY_DAY_BOARD_FILTERS: DayBoardFilters = {
  bank: '',
  origin: '',
  destination: '',
  area: '',
  notes: '',
  type: '',
  received: '',
};

export const hasActiveFilter = (filters: DayBoardFilters): boolean =>
  Object.values(filters).some((value) => value !== '');

/** Case-insensitive substring, with an empty needle matching everything — the legacy semantics. */
const matches = (haystack: string | null, needle: string): boolean =>
  needle === '' || (haystack ?? '').toLowerCase().includes(needle.trim().toLowerCase());

/**
 * A shipment counts as RECEIVED when it has reached the terminal status.
 *
 * Legacy carried two orthogonal fields — `received` (0/1) and `status` — and let them disagree:
 * `/mohsana` and `/receive_mohsana` flipped `received` alone while `/main_ops` moved both
 * (discovery §6.3, quirk Q23, decided NORMALIZE — merge them). The domain has one lifecycle, so
 * the board reads the one that survived.
 */
export const isReceived = (shipment: { status: OperationsShipmentStatus }): boolean =>
  shipment.status === 'completed';

/**
 * The row labels the board displays, resolved from the shipment's own fields.
 *
 * A row is "the display of a shipment on a day", and which DATE that day refers to depends on the
 * type: a daily shipment is worked on its collection date, a secured one on its delivery date
 * (contad_app.js:263-264). Stating it here keeps the row honest about which date it is showing.
 */
export const boardDateOf = (shipment: OperationsShipmentDto): string | null =>
  shipment.shipmentType === 'daily' ? shipment.collectionDate : shipment.deliveryDate;

export const filterDayBoard = (
  shipments: readonly OperationsShipmentDto[],
  filters: DayBoardFilters,
  bankNameOf: (bankId: string) => string,
  branchNameOf: (branchId: string) => string,
): OperationsShipmentDto[] =>
  shipments.filter(
    (shipment) =>
      matches(bankNameOf(shipment.mainBankId), filters.bank) &&
      matches(branchNameOf(shipment.originBranchId), filters.origin) &&
      matches(branchNameOf(shipment.destinationBranchId), filters.destination) &&
      matches(shipment.areaName, filters.area) &&
      matches(shipment.notes, filters.notes) &&
      (filters.type === '' || shipment.shipmentType === filters.type) &&
      (filters.received === '' ||
        (filters.received === 'yes') === isReceived(shipment)),
  );

/**
 * The legacy board numbered rows DESCENDING — the first (newest) row carries the highest number,
 * counting down to 1 (main_ops.ejs:847-849). It reads as "how many shipments so far today", and
 * operators call shipments by it, so it is preserved rather than replaced with a 1..n index.
 */
export const legacyRowNumber = (index: number, total: number): number => total - index;

/**
 * True when the shipment's destination bank differs from its main bank. The legacy board
 * highlighted exactly this in dark red (main_ops.ejs:867-870) because a cross-bank movement is
 * the case an operator must not miss.
 */
export const isCrossBank = (shipment: OperationsShipmentDto): boolean =>
  shipment.secondaryBankId !== null && shipment.secondaryBankId !== shipment.mainBankId;

/** Total per currency across a shipment's lines — the money the row shows. */
export const totalsByCurrency = (
  shipment: OperationsShipmentDto,
): { currencyId: string; amount: number }[] => {
  const totals = new Map<string, number>();
  for (const line of shipment.lines) {
    totals.set(line.currencyId, (totals.get(line.currencyId) ?? 0) + line.amount);
  }
  return [...totals.entries()].map(([currencyId, amount]) => ({ currencyId, amount }));
};

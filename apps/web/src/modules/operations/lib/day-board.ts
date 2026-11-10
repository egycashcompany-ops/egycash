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
  type OperationsDayBoardShipmentDto,
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
  /** Legacy's «قائد الطاقم» box (main_ops.ejs:800) — the captain of the row's leg, by name. */
  captain: string;
  type: OperationsShipmentType | '';
  received: 'yes' | 'no' | '';
}

export const EMPTY_DAY_BOARD_FILTERS: DayBoardFilters = {
  bank: '',
  origin: '',
  destination: '',
  area: '',
  notes: '',
  captain: '',
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

export const filterDayBoard = <T extends OperationsShipmentDto>(
  shipments: readonly T[],
  filters: DayBoardFilters,
  bankNameOf: (bankId: string) => string,
  branchNameOf: (branchId: string) => string,
  captainNameOf: (shipment: T) => string = () => '',
): T[] =>
  shipments.filter(
    (shipment) =>
      matches(bankNameOf(shipment.mainBankId), filters.bank) &&
      matches(branchNameOf(shipment.originBranchId), filters.origin) &&
      matches(branchNameOf(shipment.destinationBranchId), filters.destination) &&
      matches(captainNameOf(shipment), filters.captain) &&
      matches(shipment.areaName, filters.area) &&
      matches(shipment.notes, filters.notes) &&
      (filters.type === '' || shipment.shipmentType === filters.type) &&
      (filters.received === '' ||
        (filters.received === 'yes') === isReceived(shipment)),
  );

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

/**
 * The money on the board, per currency — the legacy strip «مصري = … دولار = …» (main_ops.ejs:744,
 * 3179-3317), over the rows SHOWN rather than the whole day, so a bank filter answers "how much
 * for this bank". Each currency on its own: legacy's «عملات أجنبية» added dollars to euros, a sum
 * with no meaning, and it is not reproduced.
 */
export const boardTotals = (
  shipments: readonly OperationsShipmentDto[],
): { currencyId: string; amount: number }[] => {
  const totals = new Map<string, number>();
  for (const shipment of shipments) {
    for (const line of shipment.lines) {
      totals.set(line.currencyId, (totals.get(line.currencyId) ?? 0) + line.amount);
    }
  }
  return [...totals.entries()].map(([currencyId, amount]) => ({ currencyId, amount }));
};

/**
 * Was the money collected from ANOTHER bank than the one billed? The main bank is the billed bank,
 * so the bank the money came from is the origin branch's — worth showing exactly when it differs,
 * as the legacy board showed the to-bank (main_ops.ejs:867-872).
 */
export const isOtherOriginBank = (row: OperationsDayBoardShipmentDto): boolean =>
  row.origin !== null && row.origin.bankId !== row.mainBankId;

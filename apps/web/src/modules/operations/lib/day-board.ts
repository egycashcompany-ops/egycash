// The daily board's client-side decisions — extracted as pure functions so they can be asserted
// directly, rather than through a simulated DOM.
//
// WHAT BELONGS HERE AND WHAT DOES NOT. The board's MEMBERSHIP — which shipments the desk works
// today — is a business rule and lives on the server (`GET /operations/shipments/day-board`).
// What lives here is presentation over an already-fetched day: the operator's search boxes, the
// row numbering, the status wording, what a branch cell prints and the order of the figures. The
// legacy screen mixed the two, filtering rows by reading their rendered background colour
// (main_ops.ejs:995) — a genuinely fragile idea this replaces with data.
import {
  type OperationsCurrencyDto,
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
 * WHO delivered a board row, as the owner set it out: «لو تم التسليم من القائد من برا الحالة هتكون
 * تم التسليم بس الصف لونه اصفر ولما ادوس انا على صح من عندى يبقى الصف اخضر».
 *
 *   · `desk`    — the desk pressed ✓: the shipment is completed. Green, «تم التسليم».
 *   · `captain` — the crew captain confirmed delivery from the mobile app, and the desk has not
 *                 yet: the leg is delivered, the shipment is not. Yellow, «تم التسليم».
 *   · `none`    — neither. «لم يتم التسليم».
 *
 * The desk wins: once it confirms, the row is green whatever the captain did. A plain shipment
 * (no board fields) can only be `desk` or `none`.
 */
export type BoardDelivery = 'desk' | 'captain' | 'none';

export const boardDelivery = (
  row: { status: OperationsShipmentStatus } & Partial<Pick<OperationsDayBoardShipmentDto, 'captainDeliveredAt'>>,
): BoardDelivery =>
  isReceived(row) ? 'desk' : row.captainDeliveredAt != null ? 'captain' : 'none';

/**
 * The row labels the board displays, resolved from the shipment's own fields.
 *
 * A row is "the display of a shipment on a day", and which DATE that day refers to depends on the
 * type: a daily shipment is worked on its collection date, a secured one on its delivery date
 * (contad_app.js:263-264). Stating it here keeps the row honest about which date it is showing.
 */
export const boardDateOf = (shipment: OperationsShipmentDto): string | null =>
  shipment.shipmentType === 'daily' ? shipment.collectionDate : shipment.deliveryDate;

/** Which branch column a value belongs to — «من فرع» or «الى فرع». */
export type BoardBranchSide = 'origin' | 'destination';

/**
 * «من فرع» / «الى فرع» match what the cell SHOWS, as legacy's did: it read `cells[3/4].innerText`
 * (main_ops.ejs:988-989), so a bank printed above a branch was searchable too. `cellTextOf` is
 * that text — on the board, `branchCellText`; a caller holding plain shipments passes the branch
 * name by id.
 */
export const filterDayBoard = <T extends OperationsShipmentDto>(
  shipments: readonly T[],
  filters: DayBoardFilters,
  bankNameOf: (bankId: string) => string,
  cellTextOf: (shipment: T, side: BoardBranchSide) => string,
  captainNameOf: (shipment: T) => string = () => '',
): T[] =>
  shipments.filter(
    (shipment) =>
      matches(bankNameOf(shipment.mainBankId), filters.bank) &&
      matches(cellTextOf(shipment, 'origin'), filters.origin) &&
      matches(cellTextOf(shipment, 'destination'), filters.destination) &&
      matches(captainNameOf(shipment), filters.captain) &&
      matches(shipment.areaName, filters.area) &&
      matches(shipment.notes, filters.notes) &&
      (filters.type === '' || shipment.shipmentType === filters.type) &&
      // «التسليم» filters on what the status column SAYS: a captain's delivery reads «تم التسليم»
      // there too, so it is found under «تم التسليم» here.
      (filters.received === '' ||
        (filters.received === 'yes') === (boardDelivery(shipment) !== 'none')),
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
 * for this bank". The figures group it as legacy did (`boardFigures`); this is every currency on
 * its own, which the «عملات أخرى» breakdown lists.
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
 * Where a currency sits in the figures: the domestic currency first, then the dollar, then the
 * rest — the order the legacy strip read «مصري = … دولار = …» in (main_ops.ejs:3315). A currency
 * the catalog cannot name goes last: its chip says «…», which is not worth reading first.
 */
const currencyRank = (currency: Pick<OperationsCurrencyDto, 'code'> | undefined): number =>
  currency === undefined ? 3 : currency.code === 'EGP' ? 0 : currency.code === 'USD' ? 1 : 2;

/**
 * The board's figures in the order they are shown: `boardTotals` over the rows it is GIVEN — the
 * page passes the filtered rows, so a bank filter answers "how much for this bank" — then EGP,
 * USD, the rest by name, and an unknown currency last. Ties keep `boardTotals`' order.
 */
export const orderedBoardTotals = (
  shipments: readonly OperationsShipmentDto[],
  currencyOf: (currencyId: string) => Pick<OperationsCurrencyDto, 'code' | 'name'> | undefined,
): { currencyId: string; amount: number }[] =>
  boardTotals(shipments).sort((a, b) => {
    const left = currencyOf(a.currencyId);
    const right = currencyOf(b.currencyId);
    return (
      currencyRank(left) - currencyRank(right) ||
      (left?.name ?? '').localeCompare(right?.name ?? '')
    );
  });

/**
 * The figures over the rows shown, as the owner set them out: «مصري» and «دولار» each on its own,
 * then «عملات أخرى» — «مجموع كل العملات ما عدا المصرى والدولار» — whose click lists each of those
 * currencies apart. Legacy summed the same set (main_ops.ejs:3309 `foregn = euro1 + gbp1 + …`,
 * every currency but the pound and the dollar) and printed «عملات أجنبية = …».
 *
 * The pound and the dollar are known by their CODE (EGP, USD); a currency the catalog cannot name
 * yet counts with the others. `others` reads by name, as the breakdown lists it.
 */
export const boardFigures = (
  shipments: readonly OperationsShipmentDto[],
  currencyOf: (currencyId: string) => Pick<OperationsCurrencyDto, 'code' | 'name'> | undefined,
): {
  egp: number;
  usd: number;
  others: { currencyId: string; amount: number }[];
  othersSum: number;
} => {
  let egp = 0;
  let usd = 0;
  const others: { currencyId: string; amount: number }[] = [];
  for (const total of orderedBoardTotals(shipments, currencyOf)) {
    const code = currencyOf(total.currencyId)?.code;
    if (code === 'EGP') egp += total.amount;
    else if (code === 'USD') usd += total.amount;
    else others.push(total);
  }
  return { egp, usd, others, othersSum: others.reduce((sum, total) => sum + total.amount, 0) };
};

/**
 * Was the money collected from ANOTHER bank than the one billed? The main bank is the billed bank,
 * so the bank the money came from is the origin branch's — worth showing exactly when it differs,
 * as the legacy board showed the to-bank (main_ops.ejs:867-872).
 */
export const isOtherOriginBank = (row: OperationsDayBoardShipmentDto): boolean =>
  row.origin !== null && row.origin.bankId !== row.mainBankId;

/**
 * A bank's name, or null when there is none to print. The server sends `bankName: ''` for a bank
 * it can no longer name, and the catalog lookup answers '' the same way. Passed through, that ''
 * would be a "bank" the page draws as an empty line, so it counts as no bank; on the destination
 * side the secondary bank's name is tried next, as it is when the branch itself is gone.
 */
const named = (name: string | undefined): string | null =>
  name === undefined || name === '' ? null : name;

/**
 * What a branch cell PRINTS: the branch, and above it a bank exactly when the bank is news.
 *
 *   · «الى فرع» — the destination bank when the movement crosses banks (`isCrossBank`), as legacy
 *     printed `sec_bank` in dark red above `to_name` (main_ops.ejs:867-871).
 *   · «من فرع» — the origin branch's bank when it is not the billed one (`isOtherOriginBank`).
 *
 * `bank` is null when the cell prints none; `branch` is null when the branch could not be resolved
 * (the page draws «…» there, which nobody types into a search box).
 */
export const branchCell = (
  row: OperationsDayBoardShipmentDto,
  side: BoardBranchSide,
  bankNameOf: (bankId: string) => string,
): { bank: string | null; branch: string | null } =>
  side === 'origin'
    ? {
        bank: isOtherOriginBank(row) ? named(row.origin?.bankName) : null,
        branch: row.origin?.name ?? null,
      }
    : {
        bank: isCrossBank(row)
          ? (named(row.destination?.bankName) ?? named(bankNameOf(row.secondaryBankId ?? '')))
          : null,
        branch: row.destination?.name ?? null,
      };

/**
 * The branch cell as text — what legacy's «من فرع» / «الى فرع» boxes searched (`innerText`: the
 * bank line, a line break, the branch). A bank the cell does not print is not in it, so typing a
 * bank's name never finds a row whose cell does not say it.
 */
export const branchCellText = (
  row: OperationsDayBoardShipmentDto,
  side: BoardBranchSide,
  bankNameOf: (bankId: string) => string,
): string => {
  const cell = branchCell(row, side, bankNameOf);
  return [cell.bank, cell.branch].filter((line) => line !== null && line !== '').join('\n');
};

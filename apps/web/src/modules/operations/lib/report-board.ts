// The reports' decisions over an answer the server already rolled up — «تجميع الخزينة» and «تقرير
// القادة» on the boards' look (`components/ReportBoard.tsx`). Pure, so they are asserted directly.
//
// WHAT THE SERVER DECIDES AND WHAT THIS DOES. The server rolls the shipments up — which ones, how
// many, their packages counted once (Q26), the grand total kept apart from the rows (Q27), a
// shipment with no money still counted (Q28). Its rows carry every currency on its own
// (`OperationsReportTotalsDto.currencies`), and the contract leaves the legacy «المصري / الدولار /
// اجمالي العملات» buckets to the client as a VIEW of those. This file is that view, and nothing
// more: it splits a row's money by the boards' own classifier, orders it by the reference list,
// and puts the rows in the order the screen reads them. It never adds one row to another.
//
// «اجمالي العملات» IS «عملات أخرى». Legacy's `total_other` (contad_app.js:5057) was every currency
// that is neither the pound nor the dollar — exactly the boards' rule, «المصرى لوحده الدولار لوحده و
// اى حاجه غير الاتنين دول يتحسب عملات اخرى». So the split is `currencyKind` (lib/day-board.ts) —
// code, name or legacy alias — and never a code compared to `EGP`: the production catalog's codes
// are the legacy numbers «1», «2», «3», and a pound known only by `EGP` lands among the others.
import {
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import { compareCurrencies, currencyKind, type CurrencyKind, type OtherCurrencyCard } from './day-board';

/** One currency's money in a report row, with what the screen needs to name and key it. */
export interface ReportMoneyLine {
  /**
   * The currency's id — or, where the server could not resolve one, its printed name: two such
   * lines of the same name are the same money to a reader, and a key must still be unique.
   */
  key: string;
  currencyId: string | null;
  /** The catalog's name for it, or the one the server printed. */
  name: string;
  amount: number;
}

/** A report line's key — its currency's id, or its printed name where it has none. */
export const reportLineKey = (line: OperationsReportCurrencyTotalDto): string =>
  line.currencyId ?? `name:${line.currencyName}`;

const byId = (catalog: readonly OperationsCurrencyDto[]): Map<string, OperationsCurrencyDto> =>
  new Map(catalog.map((currency) => [currency.id, currency]));

/**
 * Is this line the pound, the dollar, or another currency? The catalog's currency decides — its
 * code, name and legacy aliases, as on every board. A currency the catalog does not hold (yet, or
 * any more) is judged by the name the server printed, which is the catalog's own name for it.
 */
export const reportLineKind = (
  line: OperationsReportCurrencyTotalDto,
  catalog: ReadonlyMap<string, OperationsCurrencyDto>,
): CurrencyKind => {
  const known = line.currencyId === null ? undefined : catalog.get(line.currencyId);
  return currencyKind(known ?? { code: '', name: line.currencyName });
};

/**
 * Report lines in the reference list's order (`compareCurrencies` — «ترتيب العملات … على حسب
 * ترتيبها ف شاشة البيانات المرجعية»), a currency the catalog does not hold after every one it does,
 * by name. The server sends them alphabetically, which is nobody's order.
 */
const inCatalogOrder = (
  lines: readonly OperationsReportCurrencyTotalDto[],
  catalog: ReadonlyMap<string, OperationsCurrencyDto>,
): ReportMoneyLine[] => {
  const known = (line: OperationsReportCurrencyTotalDto): OperationsCurrencyDto | undefined =>
    line.currencyId === null ? undefined : catalog.get(line.currencyId);
  return [...lines]
    .sort((a, b) => {
      const left = known(a);
      const right = known(b);
      if (left !== undefined && right !== undefined) return compareCurrencies(left, right);
      if (left !== undefined || right !== undefined) return left === undefined ? 1 : -1;
      return a.currencyName.localeCompare(b.currencyName, 'ar');
    })
    .map((line) => ({
      key: reportLineKey(line),
      currencyId: line.currencyId,
      name: known(line)?.name ?? line.currencyName,
      amount: line.amount,
    }));
};

/** A row's money as the legacy columns read it: «المصري», «الدولار», «عملات أخرى». */
export interface ReportMoney {
  egp: number;
  usd: number;
  /** Every other currency on the row, each on its own, in the reference list's order. */
  others: ReportMoneyLine[];
  /** «عملات أخرى» — the others added together, which is why a click lists them apart. */
  othersSum: number;
}

/**
 * A row's money split the boards' way (`currencyKind`): the pound alone, the dollar alone, and
 * «عملات أخرى» — every other currency, summed for the column and kept apart for its breakdown.
 * Over ONE row's own currencies: the grand total's split is the grand total's, never the rows'.
 */
export const reportMoney = (
  currencies: readonly OperationsReportCurrencyTotalDto[],
  catalog: readonly OperationsCurrencyDto[],
): ReportMoney => {
  const known = byId(catalog);
  let egp = 0;
  let usd = 0;
  const other: OperationsReportCurrencyTotalDto[] = [];
  for (const line of currencies) {
    const kind = reportLineKind(line, known);
    if (kind === 'pound') egp += line.amount;
    else if (kind === 'dollar') usd += line.amount;
    else other.push(line);
  }
  const others = inCatalogOrder(other, known);
  return { egp, usd, others, othersSum: others.reduce((sum, line) => sum + line.amount, 0) };
};

/**
 * The «عملات أخرى» breakdown of one row, as the boards' dialog draws it (`OtherCurrenciesDialog`):
 * a card per currency with its share of the figure. A report's row no longer says which shipment
 * carried which currency, so the cards carry no shipment count (`OtherCurrencyCard.shipments`).
 * Keyed by `ReportMoneyLine.key`, which `reportCurrencyLookup` resolves.
 */
export const reportOtherCards = (money: ReportMoney): OtherCurrencyCard[] =>
  money.others.map((line) => ({
    currencyId: line.key,
    amount: line.amount,
    share: money.othersSum === 0 ? 0 : line.amount / money.othersSum,
  }));

/**
 * The currency behind a `ReportMoneyLine.key`, for the dialog's cards: the catalog's own, or — for
 * one the catalog no longer holds — a stand-in carrying the name the server printed, so the card
 * reads that name rather than «…».
 */
export const reportCurrencyLookup = (
  catalog: readonly OperationsCurrencyDto[],
  lines: readonly ReportMoneyLine[],
): ((key: string) => OperationsCurrencyDto | undefined) => {
  const known = byId(catalog);
  const printed = new Map(lines.map((line) => [line.key, line.name]));
  return (key) => {
    const own = known.get(key);
    if (own !== undefined) return own;
    const name = printed.get(key);
    return name === undefined
      ? undefined
      : {
          id: key,
          code: '',
          name,
          legacyAliases: [],
          sortOrder: null,
          isActive: false,
          version: 0,
          createdAt: '',
          updatedAt: '',
        };
  };
};

/** One line of «إجمالي قيمة الشحنات»'s currency list. */
export interface VaultValueLine extends ReportMoneyLine {
  /** Nothing of it is held — drawn dimmed, so the money stands out of the full list. */
  zero: boolean;
}

/** «إجمالي قيمة الشحنات» — the vault roll-up's panel beside its table. */
export interface VaultValuePanel {
  /** «إجمالي المصري». */
  egp: number;
  /**
   * «إجمالي العملات الأجنبية» — every currency but the pound, THE DOLLAR INCLUDED. Legacy's second
   * aggregation took out the pound alone (contad_app.js:1559), so this is wider than a row's «عملات
   * أخرى», which also leaves the dollar out. The two words name two different sums, as legacy's did.
   */
  foreign: number;
  /**
   * Each currency but the pound, in the reference list's order, as legacy listed every currency of
   * its data list (امريكى، يورو، جنيه استرلينى …) whether or not the vault held any: every ACTIVE
   * currency of the catalog — 0 where none is held — then any the vault holds that the catalog has
   * retired or does not list. A retired currency with nothing held is not listed: it is not one
   * the vault can still receive.
   */
  lines: VaultValueLine[];
}

/**
 * The panel, from the server's GRAND TOTAL — its own currencies, split by the boards' classifier.
 * Not from the rows (Q27), and not from the server's `foreignCurrencies`, which tells the pound by
 * its code alone (`EGP`): on the production catalog, whose pound is coded «1», that list would
 * count the pound as foreign.
 */
export const vaultValuePanel = (
  grandTotal: readonly OperationsReportCurrencyTotalDto[],
  catalog: readonly OperationsCurrencyDto[],
): VaultValuePanel => {
  const known = byId(catalog);
  const held = new Map<string, number>();
  let egp = 0;
  let foreign = 0;
  const foreignLines: OperationsReportCurrencyTotalDto[] = [];
  for (const line of grandTotal) {
    if (reportLineKind(line, known) === 'pound') {
      egp += line.amount;
      continue;
    }
    foreign += line.amount;
    foreignLines.push(line);
    const key = reportLineKey(line);
    held.set(key, (held.get(key) ?? 0) + line.amount);
  }
  // The catalog's currencies with nothing held, as zero lines beside the ones the vault holds.
  const unheld: OperationsReportCurrencyTotalDto[] = catalog
    .filter(
      (currency) =>
        currency.isActive && !held.has(currency.id) && currencyKind(currency) !== 'pound',
    )
    .map((currency) => ({ currencyId: currency.id, currencyName: currency.name, amount: 0 }));
  const lines = inCatalogOrder([...foreignLines, ...unheld], known).map((line) => ({
    ...line,
    zero: line.amount === 0,
  }));
  return { egp, foreign, lines };
};

/**
 * A report's rows in the order the screen reads them. The row the server could not attribute (no
 * bank, no captain) goes LAST, just above the total — the server sorts it by its empty name, which
 * put it first, ahead of every named row. Given an `order` (the banks' reference order), the named
 * rows follow it; otherwise, and between rows it ranks alike, they keep the server's order.
 */
export const reportRowsInOrder = <R>(
  rows: readonly R[],
  unattributed: (row: R) => boolean,
  order?: (row: R) => number,
): R[] =>
  [...rows].sort(
    (a, b) =>
      Number(unattributed(a)) - Number(unattributed(b)) ||
      (order === undefined || unattributed(a) ? 0 : order(a) - order(b)),
  );

/**
 * The banks' reference order — Q31: legacy ranked them by a 22-name `$switch` written into the
 * aggregation (contad_app.js:1449); the bank's own `sortOrder` replaced it (null after every placed
 * one), then its code. As a rank by bank id; a bank the catalog does not list goes after them all.
 */
export const bankRank = (
  banks: readonly Pick<OperationsBankDto, 'id' | 'code' | 'sortOrder'>[],
): ((bankId: string | null) => number) => {
  const ranked = [...banks].sort(
    (a, b) =>
      (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.code - b.code,
  );
  const rank = new Map(ranked.map((bank, index) => [bank.id, index]));
  return (bankId) => (bankId === null ? rank.size : (rank.get(bankId) ?? rank.size));
};

/** A row of a report's table, as the page hands it to the board. */
export interface ReportBoardRow {
  key: string;
  /** The bank's or the captain's name. */
  label: string;
  /** The server could not attribute it — no bank, or no captain. Drawn, never dropped. */
  unattributed: boolean;
  totals: OperationsReportTotalsDto;
}

/** A line of the drawn table: a numbered row, or the total under them. */
export type ReportTableLine =
  | ({ kind: 'row'; serial: number } & ReportBoardRow)
  | { kind: 'total'; key: 'total'; totals: OperationsReportTotalsDto };

/**
 * The table's lines: the rows, numbered («م») in the order given, then «الإجمالي» — the SERVER's
 * grand total, handed through as it came (Q27: legacy appended its total INTO the rows, and a
 * reader who added the rows up counted everything twice; here no row is ever added to another).
 * No rows, no total: an empty report says so in the table's place instead of a row of zeros.
 */
export const reportTableLines = (
  rows: readonly ReportBoardRow[],
  grandTotal: OperationsReportTotalsDto | undefined,
): ReportTableLine[] =>
  rows.length === 0 || grandTotal === undefined
    ? []
    : [
        ...rows.map((row, index) => ({ kind: 'row' as const, serial: index + 1, ...row })),
        { kind: 'total', key: 'total', totals: grandTotal },
      ];

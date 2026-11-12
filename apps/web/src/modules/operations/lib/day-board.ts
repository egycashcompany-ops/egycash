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
  OPERATIONS_SECURED_STAGES,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsSecuredStage,
  type OperationsShipmentDto,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { fold } from '../../../shared/lib/fold';
import { matchesVehicleCode } from '../../fleet/lib/vehicle-code-match';

/**
 * The eight filters the legacy board offered (main_ops.ejs:966-1010), as data — and the van's code,
 * which it did not: «ضيف كود العربيه ف الفلاتر».
 *
 * Legacy matched each with a case-insensitive substring test over the rendered cell text. That
 * behaviour is PRESERVED — an operator types a fragment of a bank or branch name, not an exact
 * value — but it now runs over the shipment's fields rather than over its HTML.
 *
 * Declared in the order the bar shows them, which is the table's column order («ارتب الفلاتر على
 * حسب عواميد الجدول»): the van, the bank, the two branches, the area, the captain, (the day), the
 * type, the status — the delivery on the day board and the history, the محصنة's stage on the
 * secured screen — the notes.
 */
export interface DayBoardFilters {
  /**
   * The «السيارة» column's code — the van of the row's leg (`row.crew.vehicleCode`). Matched the
   * way every vehicle-code box in the application matches (`matchesVehicleCode`): Arabic-Indic
   * digits folded, and «150 - 151» naming both vans.
   */
  vehicle: string;
  bank: string;
  origin: string;
  destination: string;
  area: string;
  notes: string;
  /** Legacy's «قائد الطاقم» box (main_ops.ejs:800) — the captain of the row's leg, by name. */
  captain: string;
  type: OperationsShipmentType | '';
  received: 'yes' | 'no' | '';
  /**
   * The secured screen's «الحالة» — where a محصنة stands (`securedStage`), one stage at a time. A
   * daily row has no stage, so it drops out of this filter. The secured screen offers it in place
   * of «التسليم», whose two answers cannot tell its stages apart.
   */
  stage: OperationsSecuredStage | '';
}

export const EMPTY_DAY_BOARD_FILTERS: DayBoardFilters = {
  vehicle: '',
  bank: '',
  origin: '',
  destination: '',
  area: '',
  captain: '',
  type: '',
  received: '',
  stage: '',
  notes: '',
};

/** The URL params the board's filters live in — one per filter, by the filter's own name. */
export const DAY_BOARD_FILTER_PARAMS = Object.keys(
  EMPTY_DAY_BOARD_FILTERS,
) as readonly (keyof DayBoardFilters)[];

/**
 * Which board a screen draws (`ShipmentsBoard`'s `kind`):
 *
 *   · `shipments` — the day board and the history: daily rows and محصنات side by side, «النوع»
 *     telling them apart, and «التسليم» (`received`) as the status filter;
 *   · `secured` — the secured screen, where every row is a محصنة: no «النوع» (it would say «محصنة»
 *     on every row, and its filter could only empty the table), and the محصنة's stage (`stage`)
 *     as the status filter.
 */
export type BoardKind = 'shipments' | 'secured';

/** The filter params a board offers no box for. */
const UNOFFERED: Record<BoardKind, readonly (keyof DayBoardFilters)[]> = {
  shipments: ['stage'],
  secured: ['type', 'received'],
};

/**
 * The filters a board READS — every one it offers a box for. A param with no box on screen must
 * not narrow the table (an old link, a hand-typed `?stage=` on the day board), so it is read as
 * empty (`offeredFilters`); and a page remembers exactly these.
 */
export const boardFilterParams = (kind: BoardKind): readonly (keyof DayBoardFilters)[] =>
  DAY_BOARD_FILTER_PARAMS.filter((name) => !UNOFFERED[kind].includes(name));

/**
 * The filters with every one the board offers no box for read as empty — and, given the stages
 * its «الحالة» box offers (`stages`), a stage it does not offer read as empty too: the vault queue
 * offers «لم يتم التسليم» only with «الكل», and an old `?stage=awaitingPickup` left behind once
 * «الكل» is off must not empty the table with nothing on screen to say why.
 */
export const offeredFilters = (
  filters: DayBoardFilters,
  kind: BoardKind,
  stages?: readonly OperationsSecuredStage[],
): DayBoardFilters => {
  const offered: DayBoardFilters = {
    ...filters,
    ...Object.fromEntries(UNOFFERED[kind].map((name) => [name, ''])),
  };
  return stages !== undefined && offered.stage !== '' && !stages.includes(offered.stage)
    ? { ...offered, stage: '' }
    : offered;
};

/**
 * The filters a URL holds. A value the select filters cannot take (a hand-edited `?type=x`) reads
 * as no filter rather than as a filter nothing matches — an empty board with no way to tell why.
 */
export const readDayBoardFilters = (params: URLSearchParams): DayBoardFilters => {
  const type = params.get('type') ?? '';
  const received = params.get('received') ?? '';
  const stage = params.get('stage') ?? '';
  return {
    vehicle: params.get('vehicle') ?? '',
    bank: params.get('bank') ?? '',
    origin: params.get('origin') ?? '',
    destination: params.get('destination') ?? '',
    area: params.get('area') ?? '',
    captain: params.get('captain') ?? '',
    type: type === 'daily' || type === 'secured' ? type : '',
    received: received === 'yes' || received === 'no' ? received : '',
    stage: (OPERATIONS_SECURED_STAGES as readonly string[]).includes(stage)
      ? (stage as OperationsSecuredStage)
      : '',
    notes: params.get('notes') ?? '',
  };
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

/**
 * A row's colour by who delivered it (`boardDelivery`): green once the desk confirmed — legacy's
 * `#a9e6b8` (main_ops.ejs:851) — yellow while only the crew captain has, none before either.
 */
export const rowTint = (delivery: BoardDelivery): string | undefined =>
  delivery === 'desk'
    ? '!bg-emerald-50 dark:!bg-emerald-950/30'
    : delivery === 'captain'
      ? '!bg-amber-50 dark:!bg-yellow-400/10'
      : undefined;

export const boardDelivery = (
  row: { status: OperationsShipmentStatus } & Partial<
    Pick<OperationsDayBoardShipmentDto, 'captainDeliveredAt'>
  >,
): BoardDelivery =>
  isReceived(row) ? 'desk' : row.captainDeliveredAt != null ? 'captain' : 'none';

/**
 * Does the «الحالة» cell say «تم التسليم»? What the «التسليم» filter answers. A daily row says it
 * once anybody delivered it (`boardDelivery` — the captain's yellow and the desk's green alike). A
 * SECURED row's cell shows its stage (`lib/secured-stage.ts`) and says «تم التسليم» once it is
 * `completed`; before that it reads «لم يتم التسليم», «تم الاستلام من القائد», «بالخزينة» or
 * «خرجت للتسليم» — none of them a delivery. The one exception is the daily rule's own: a dispatched
 * محصنة its DELIVERY captain has delivered from the app says «تم التسليم» on a yellow row
 * (`shownStage`), so it is found here too. A row with no stage (a plain shipment, or a daily row)
 * keeps the daily rule.
 */
export const saysDelivered = (
  row: { status: OperationsShipmentStatus } & Partial<
    Pick<OperationsDayBoardShipmentDto, 'captainDeliveredAt' | 'securedStage'>
  >,
): boolean =>
  // Not `shownStage` itself (secured-stage.ts reads this file); the same rule — a dispatched row
  // falls to `boardDelivery`, which reads its delivery captain's `captainDeliveredAt`.
  row.securedStage != null && row.securedStage !== 'dispatched'
    ? row.securedStage === 'completed'
    : boardDelivery(row) !== 'none';

/**
 * The row labels the board displays, resolved from the shipment's own fields.
 *
 * A row is "the display of a shipment on a day", and which DATE that day refers to depends on the
 * type: a daily shipment is worked on its collection date, a secured one on its delivery date
 * (contad_app.js:263-264). Stating it here keeps the row honest about which date it is showing.
 */
export const boardDateOf = (shipment: OperationsShipmentDto): string | null =>
  shipment.shipmentType === 'daily' ? shipment.collectionDate : shipment.deliveryDate;

/** A row's secured stage, or null — a plain shipment (no board fields) has none to read. */
const readStage = (shipment: OperationsShipmentDto): OperationsSecuredStage | null =>
  (shipment as Partial<Pick<OperationsDayBoardShipmentDto, 'securedStage'>>).securedStage ?? null;

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
  vehicleCodeOf: (shipment: T) => string = () => '',
): T[] =>
  shipments.filter(
    (shipment) =>
      // A row with no van yet ("book now, crew later") has no code to match: it drops out of a van
      // filter rather than matching every code. A box holding no code narrows nothing.
      matchesVehicleCode(vehicleCodeOf(shipment), filters.vehicle) &&
      matches(bankNameOf(shipment.mainBankId), filters.bank) &&
      matches(cellTextOf(shipment, 'origin'), filters.origin) &&
      matches(cellTextOf(shipment, 'destination'), filters.destination) &&
      matches(captainNameOf(shipment), filters.captain) &&
      matches(shipment.areaName, filters.area) &&
      matches(shipment.notes, filters.notes) &&
      (filters.type === '' || shipment.shipmentType === filters.type) &&
      // «التسليم» filters on what the status column SAYS: a captain's delivery reads «تم التسليم»
      // there too, so it is found under «تم التسليم» here — and a محصنة only once it is delivered
      // (by the desk, or by its delivery captain from the app).
      (filters.received === '' || (filters.received === 'yes') === saysDelivered(shipment)) &&
      (filters.stage === '' || readStage(shipment) === filters.stage),
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
 * What a spelling is compared as, folded — `fold`, with tatweel dropped and spaces made one.
 *
 * The spaces are made one BEFORE folding as well as after: `fold` keeps only the plain space and
 * drops every other blank as punctuation, so a name pasted from Excel or Word with a no-break space
 * or a tab between its words («جنيه مصري») would otherwise fold to one word, «جنيهمصري», which
 * spells nothing.
 */
const foldedCurrency = (value: string): string =>
  fold(value.replace(/\u0640/gu, '').replace(/\s+/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();

/** What a spelling is compared as, raw — for the ones whose punctuation is the word. */
const rawCurrency = (value: string): string => value.replace(/\s+/gu, '').toUpperCase();

/**
 * WHICH CURRENCY IS THE POUND, AND WHICH THE DOLLAR — «انا عاوز المصرى لوحده الدولار لوحده و اى حاجه
 * غير الاتنين دول يتحسب عملات اخرى».
 *
 * The figures used to know the two by their CODE alone (`EGP`, `USD`). The production catalog's
 * codes are the legacy numbers the owner typed — «1» مصري, «2» دولار, «3» يورو — so neither was
 * found, and the whole day's money landed in «عملات أخرى» beside a pound and a dollar of 0. The
 * catalog was never wrong: a currency is the code, the name and the legacy spellings together
 * (legacy classified money by literal synonym lists, `['مصري','جنيه','EGP']` and
 * `['دولار','USD']` — contad_app.js:5029, 5043), so all three are read here.
 *
 * Each value is compared WHOLE, never by "contains": «جنيه استرليني» is pound sterling and «دولار
 * كندي» the Canadian dollar, and both are other currencies. Two forms are compared, because the
 * shared Arabic fold removes punctuation, and for some spellings the punctuation is the word:
 *
 *   · folded (`fold`: hamza forms, ى/ي, ة/ه, diacritics, Arabic-Indic digits, punctuation dropped;
 *     runs of spaces made one) — «مصرى», «جنية», «الدولار الأمريكى», «L.E», «ج.م», «U.S. Dollar»;
 *   · raw, upper-cased with the spaces taken out — «$», «US$», «E£», which fold to nothing or to a
 *     fragment («US$» → «us», «E£» → «e») that is not worth recognising on its own.
 */
const POUND_FOLDED = new Set(
  [
    'EGP',
    'LE',
    'مصري',
    'المصري',
    'جنيه',
    'الجنيه',
    'جنيه مصري',
    'الجنيه المصري',
    // «ج.م» and «ج. م» — what fold leaves of them.
    'جم',
    'ج م',
    'egyptian pound',
    'egyptian pounds',
  ].map((value) => foldedCurrency(value)),
);
const POUND_RAW = new Set(['E£', '£E']);
const DOLLAR_FOLDED = new Set(
  [
    'USD',
    'دولار',
    'الدولار',
    'دولار امريكي',
    'الدولار الامريكي',
    'dollar',
    'dollars',
    'us dollar',
    'us dollars',
  ].map((value) => foldedCurrency(value)),
);
const DOLLAR_RAW = new Set(['$', 'US$', 'USD$', 'U.S.$']);

const spells = (value: string, folded: ReadonlySet<string>, raw: ReadonlySet<string>): boolean => {
  const key = foldedCurrency(value);
  return (key !== '' && folded.has(key)) || raw.has(rawCurrency(value));
};

/** The two currencies the figures keep apart, and everything else. */
export type CurrencyKind = 'pound' | 'dollar' | 'other';

/**
 * Is this currency the Egyptian pound, the US dollar, or another one? By its code, its name or any
 * legacy alias (`legacyAliases`), each compared whole. A currency that spells BOTH (a catalog entry
 * named «دولار» with «EGP» among its aliases) is a contradiction the figures cannot settle, so it
 * is counted with the others rather than guessed at; so is one the catalog cannot name yet.
 */
export const currencyKind = (
  currency:
    | (Pick<OperationsCurrencyDto, 'code' | 'name'> &
        Partial<Pick<OperationsCurrencyDto, 'legacyAliases'>>)
    | undefined,
): CurrencyKind => {
  if (currency === undefined) return 'other';
  const spellings = [currency.code, currency.name, ...(currency.legacyAliases ?? [])];
  const pound = spellings.some((value) => spells(value, POUND_FOLDED, POUND_RAW));
  const dollar = spellings.some((value) => spells(value, DOLLAR_FOLDED, DOLLAR_RAW));
  return pound === dollar ? 'other' : pound ? 'pound' : 'dollar';
};

/**
 * The catalog's pound or dollar — what the figures' «مصري» and «دولار» pills are labelled with.
 * The first one, if a catalog holds two (an old `1` and a new `EGP`, say): the sums count both.
 */
export const currencyOfKind = <C extends Pick<OperationsCurrencyDto, 'code' | 'name'>>(
  currencies: readonly C[],
  kind: Exclude<CurrencyKind, 'other'>,
): C | undefined => currencies.find((currency) => currencyKind(currency) === kind);

/**
 * The code worth printing beside an amount as its unit: an alphabetic one (EUR, GBP, SAR). The
 * legacy catalog's numbers — «1», «2», «3» — are row numbers the owner typed, not units, and a
 * reader seeing «450,000 3» would read a figure that is not there.
 */
export const currencyUnit = (currency: Pick<OperationsCurrencyDto, 'code'> | undefined): string => {
  const code = currency?.code.trim() ?? '';
  return /^[A-Za-z]{2,5}$/u.test(code) ? code.toUpperCase() : '';
};

/**
 * THE CATALOG'S ORDER — «ترتيب العملات فى الجدول لما تظهر تكون على حسب ترتيبها ف شاشة البيانات
 * المرجعية». The reference-data screen drags the currencies into order («زى شاشة الحركة بالظبط»),
 * and every screen that lists currencies follows it: a board row's money lines, the «عملات أخرى»
 * dialog, the shipment form's pickers. It REPLACES the pound-first rule those lists used to follow
 * (the legacy strip's «مصري = … دولار = …»): the owner arranges the list, so the list decides. The
 * figures' three pills are not a list and keep their own order — «مصري», «دولار», «عملات أخرى».
 *
 * The SERVER's order, exactly (`byCatalogOrder`, currency.service.ts — the order `GET
 * /operations/currencies` answers in when no `sortBy` is asked for): the dragged place first, a
 * currency nobody placed after every placed one; then the CODE read as a person reads it, '2'
 * before '10' (the production codes are the legacy numbers «1», «2», «3»…); then the name. Stated
 * here as well because a screen orders ids it looked up, not the list the server sent.
 */
type CatalogPlace = Pick<OperationsCurrencyDto, 'code' | 'name'> &
  Partial<Pick<OperationsCurrencyDto, 'sortOrder'>>;

const UNPLACED = Number.MAX_SAFE_INTEGER;
const CODE_ORDER = new Intl.Collator('en', { numeric: true });
const NAME_ORDER = new Intl.Collator('ar');

/** Two currencies in the catalog's order — for `[...currencies].sort(compareCurrencies)`. */
export const compareCurrencies = (left: CatalogPlace, right: CatalogPlace): number =>
  (left.sortOrder ?? UNPLACED) - (right.sortOrder ?? UNPLACED) ||
  CODE_ORDER.compare(left.code, right.code) ||
  NAME_ORDER.compare(left.name, right.name);

/**
 * The catalog's order as a comparator over currency IDS — what a screen holding ids sorts with (a
 * shipment's lines, a list of totals, a picker's options by id): `ids.sort(currencyOrder(catalog))`.
 * An id the catalog does not hold goes after every one it does; ties keep the caller's order (the
 * sort is stable), so an unloaded catalog changes nothing.
 */
export const currencyOrder = (
  currencies: readonly (CatalogPlace & Pick<OperationsCurrencyDto, 'id'>)[],
): ((leftId: string, rightId: string) => number) => {
  const rank = new Map(
    [...currencies].sort(compareCurrencies).map((currency, index) => [currency.id, index]),
  );
  // `rank.size`, never Infinity: Infinity − Infinity is NaN, which no sort can read.
  return (leftId, rightId) => (rank.get(leftId) ?? rank.size) - (rank.get(rightId) ?? rank.size);
};

/** How the figures look a currency up — the page passes the catalog's own rows. */
type CurrencyLookup = (
  currencyId: string,
) => (CatalogPlace & Partial<Pick<OperationsCurrencyDto, 'legacyAliases'>>) | undefined;

/**
 * Money in the catalog's order (`compareCurrencies`): `boardTotals` over the rows it is GIVEN —
 * the page passes the filtered rows, so a bank filter answers "how much for this bank" — and a
 * currency the catalog cannot name last (its chip says «…», which is not worth reading first).
 * Ties keep `boardTotals`' order, so before the catalog loads nothing moves.
 */
export const orderedBoardTotals = (
  shipments: readonly OperationsShipmentDto[],
  currencyOf: CurrencyLookup,
): { currencyId: string; amount: number }[] =>
  boardTotals(shipments).sort((a, b) => {
    const left = currencyOf(a.currencyId);
    const right = currencyOf(b.currencyId);
    if (left === undefined || right === undefined) {
      return Number(left === undefined) - Number(right === undefined);
    }
    return compareCurrencies(left, right);
  });

/**
 * The figures over the rows shown, as the owner set them out: «مصري» and «دولار» each on its own,
 * then «عملات أخرى» — «مجموع كل العملات ما عدا المصرى والدولار» — whose click lists each of those
 * currencies apart. Legacy summed the same set (main_ops.ejs:3309 `foregn = euro1 + gbp1 + …`,
 * every currency but the pound and the dollar) and printed «عملات أجنبية = …».
 *
 * The pound and the dollar are known by `currencyKind` — code, name or legacy alias — never by
 * the code alone; a currency the catalog cannot name yet counts with the others. `others` reads in
 * the catalog's order, as `orderedBoardTotals` orders it.
 */
export const boardFigures = (
  shipments: readonly OperationsShipmentDto[],
  currencyOf: CurrencyLookup,
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
    const kind = currencyKind(currencyOf(total.currencyId));
    if (kind === 'pound') egp += total.amount;
    else if (kind === 'dollar') usd += total.amount;
    else others.push(total);
  }
  return { egp, usd, others, othersSum: others.reduce((sum, total) => sum + total.amount, 0) };
};

/** One card of the «عملات أخرى» dialog. */
export interface OtherCurrencyCard {
  currencyId: string;
  amount: number;
  /**
   * How many of the shipments shown carry this currency on at least one line. Absent where the
   * figure is a report's, whose rows are already rolled up and no longer say which shipment carried
   * which currency — the card then says nothing about it rather than guess.
   */
  shipments?: number | undefined;
  /** Its part of the «عملات أخرى» sum, 0..1 — the card's slim bar. */
  share: number;
}

/**
 * What the «عملات أخرى» dialog shows — «يفتح فورم ب كل عملة لوحدها كام»: every currency the figure
 * adds together (exactly `boardFigures().others`, so the dialog can never list a currency the pill
 * did not count), each with its sum, the number of shipments shown that carry it and its share of
 * the figure; in the CATALOG'S ORDER (`orderedBoardTotals`) — «ترتيب العملات … على حسب ترتيبها ف شاشة
 * البيانات المرجعية», as every other list of currencies reads. (It read largest first before the
 * owner arranged the catalog; the share bar still says which is most of the sum.) Also the figure
 * itself and how many shipments carry any of them.
 */
export const otherCurrencies = (
  shipments: readonly OperationsShipmentDto[],
  currencyOf: CurrencyLookup,
): { cards: OtherCurrencyCard[]; sum: number; shipments: number } => {
  const { others, othersSum } = boardFigures(shipments, currencyOf);
  const ids = new Set(others.map((total) => total.currencyId));
  const carrying = new Map<string, number>();
  let anyOther = 0;
  for (const shipment of shipments) {
    const own = new Set(shipment.lines.map((line) => line.currencyId).filter((id) => ids.has(id)));
    if (own.size > 0) anyOther += 1;
    for (const id of own) carrying.set(id, (carrying.get(id) ?? 0) + 1);
  }
  // `others` is already in the catalog's order (`boardFigures` → `orderedBoardTotals`).
  const cards = others.map((total) => ({
    ...total,
    shipments: carrying.get(total.currencyId) ?? 0,
    share: othersSum === 0 ? 0 : total.amount / othersSum,
  }));
  return { cards, sum: othersSum, shipments: anyOther };
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

// The bank catalog as the screens read it (DEC-35, docs/12-planning/atm-efficiency-register.md).
//
// The owner's call (final): a bank added at runtime is a FULL register bank — it shows in the
// register, the Data Report, settlements and the map like the workbook's six. So no screen may
// keep its own list of six any more: every name, colour and order a screen shows for a bank comes
// through `makeBankLookup` over `GET /atm/banks`, and every lookup falls back from the catalog to
// the seed and then to the code itself. A page whose catalog is still loading — or a consumer
// somebody missed — therefore shows «البنك الأهلي المصري» for NBE and `QNB` for a seventh bank,
// never a blank and never somebody else's colour.
//
// Pure: the pages call `useAtmBankLookup()` once and hand the lookup down, so the components it
// reaches render without a query client (the unlocated list's rows are pinned to that).
import {
  ATM_BANK_SEED,
  atmBankColor,
  atmBankName,
  type AtmBankCode,
  type AtmRefLabelOptionsDto,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { NO_ZONE_GREY, needsCasing } from './map-colors';

/** What a lookup needs of a bank: the catalog's own rows, or the register meta's. */
export interface LookupBank {
  code: AtmBankCode;
  name: LocalizedString;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

/** The six, as the catalog seeds them — what a lookup holds before the catalog has answered. */
const SEED_BANKS: readonly LookupBank[] = ATM_BANK_SEED.map((seed) => ({
  code: seed.code,
  name: seed.name,
  color: seed.color,
  sortOrder: seed.sortOrder,
  isActive: true,
}));

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Catalog rows in the catalog's order — the data-edit table lists them as the pickers do. */
export const sortByCatalogOrder = <T extends Pick<LookupBank, 'code' | 'sortOrder'>>(
  banks: readonly T[],
): T[] => [...banks].sort((a, b) => a.sortOrder - b.sortOrder || byCode(a.code, b.code));

export interface BankLookup {
  /** Every bank, archived ones included (a machine may still carry one), in catalog order. */
  ordered: readonly LookupBank[];
  /** The banks a picker or a legend offers: the active ones, in catalog order. */
  active: readonly LookupBank[];
  /** `ordered`'s codes. */
  codes: readonly AtmBankCode[];
  /** The bank's name in the reader's language: catalog, then seed, then the code. */
  name: (code: AtmBankCode, locale: Locale) => string;
  /** The bank's colour: catalog, then seed, then the grey of «بنك غير محدد» (DM-17). */
  color: (code: AtmBankCode | null) => string;
  /**
   * Whether the bank's dot needs a dark ring on the map. Decided by contrast (WCAG 1.4.11, the
   * zone outlines' own rule), not by a list: a curated or seventh bank's colour gets the ring
   * exactly when it needs one. For the six seeds this is CIB, HDB and BRK, as the list said.
   */
  isPale: (code: AtmBankCode | null) => boolean;
}

/** Where each seed sorts — the place an older server's row, which carries no `sortOrder`, takes. */
const SEED_ORDER: ReadonlyMap<string, number> = new Map(
  ATM_BANK_SEED.map((seed) => [seed.code, seed.sortOrder]),
);

/**
 * A bank row as a server may send it. An OLDER server — a rollback, or a tab still on this bundle
 * during a rolling deploy (design §9) — answers `GET /atm/register/meta` with `{ code, name,
 * opsLabel, color }` only: no `isActive`, no `sortOrder`.
 */
export type IncomingBank = Pick<LookupBank, 'code' | 'name' | 'color'> &
  Partial<Pick<LookupBank, 'sortOrder' | 'isActive'>>;

/**
 * A lookup over the catalog's banks. `undefined` (still loading, or refused) is the six seeds, so
 * every screen keeps working on the workbook's banks while the catalog is on its way.
 *
 * A row without the catalog's fields is filled BEFORE anything reads it — active, in its seed's
 * place — the way the report page guards against an older server (`reportBanksOf`, DEC-40). Only
 * filtering on `isActive !== false` would not do: the pickers and the register filter work out
 * «مؤرشف» from `ordered` themselves, so every bank would be offered and still be marked archived,
 * and before that, none could be chosen at all — a receipt with a start date could not be saved.
 */
export const makeBankLookup = (banks?: readonly IncomingBank[]): BankLookup => {
  const rows: LookupBank[] = (banks ?? SEED_BANKS).map((bank) => ({
    ...bank,
    isActive: bank.isActive ?? true,
    sortOrder: bank.sortOrder ?? SEED_ORDER.get(bank.code) ?? 0,
  }));
  // The catalog's order: `sortOrder`, then the code — the order the server's pickers use.
  const ordered = sortByCatalogOrder(rows);
  const color = (code: AtmBankCode | null): string =>
    code === null ? NO_ZONE_GREY : (atmBankColor(code, ordered) ?? NO_ZONE_GREY);
  return {
    ordered,
    active: ordered.filter((bank) => bank.isActive),
    codes: ordered.map((bank) => bank.code),
    name: (code, locale) => atmBankName(code, locale, ordered),
    color,
    isPale: (code) => needsCasing(color(code)),
  };
};

/**
 * `codes` in the catalog's order, then any code the catalog does not hold (sorted) — so a count is
 * never dropped because its bank is missing from the list, the way the report's fold appends an
 * unlisted bank rather than lose it.
 */
export const inCatalogOrder = (lookup: BankLookup, codes: Iterable<AtmBankCode>): AtmBankCode[] => {
  const wanted = new Set(codes);
  const known = lookup.codes.filter((code) => wanted.has(code));
  const unknown = [...wanted].filter((code) => !lookup.codes.includes(code)).sort(byCode);
  return [...known, ...unknown];
};

/**
 * The banks a map legend or filter shows: every ACTIVE bank, plus any other code the map's points
 * (or a remembered filter) carry — an archived bank is not offered for new machines, but its
 * machines are still on the map in its colour and must still be named.
 */
export const banksOnShow = (
  lookup: BankLookup,
  present: Iterable<AtmBankCode | null>,
): AtmBankCode[] => {
  const codes = new Set(lookup.active.map((bank) => bank.code));
  for (const code of present) if (code !== null) codes.add(code);
  return inCatalogOrder(lookup, codes);
};

// ── Area labels (DEC-38) ────────────────────────────────────────────────────────────────────────

/** An area label's names: `name` is what machines store; the other two are what pickers show. */
export interface LabelNames {
  name: string;
  nameAr: string | null;
  nameEn: string | null;
}

/**
 * An area as the reader's pickers show it: the name in their language, else the other one, else
 * the stored name. ONLY where areas are listed or chosen — boards, the daily report, the map and
 * exports keep the stored string, which is what every machine and operation carries.
 */
export const labelText = (label: LabelNames, locale: Locale): string =>
  (locale === 'ar' ? (label.nameAr ?? label.nameEn) : (label.nameEn ?? label.nameAr)) ?? label.name;

/** A picker option's text: `labelText`, with the stored name after it when the two differ. */
export const areaOptionText = (label: LabelNames, locale: Locale): string => {
  const text = labelText(label, locale);
  return text === label.name ? text : `${text} (${label.name})`;
};

// ── Bank options of the data-edit dialogs ───────────────────────────────────────────────────────

export interface BankOptionGroup {
  code: AtmBankCode;
  /** The bank's name in the reader's language — the `<optgroup>` label. */
  label: string;
  /** The texts a machine may store for it: the catalog's Operations label first, then spellings. */
  values: string[];
}

/**
 * The options endpoint's banks grouped by bank («البنك الأهلي المصري» → NBE, NBE FOREX), in the
 * catalog's order. Each value is exactly the text the machine stores, so picking a spelling stores
 * the spelling — the server resolves its bank. A value offered twice is offered once.
 */
export const bankOptionGroups = (
  banks: AtmRefLabelOptionsDto['banks'],
  lookup: BankLookup,
  locale: Locale,
): BankOptionGroup[] => {
  const byBank = new Map<AtmBankCode, { own: string[]; spellings: string[] }>();
  for (const option of banks) {
    const group = byBank.get(option.bankCode) ?? { own: [], spellings: [] };
    (option.kind === 'bank' ? group.own : group.spellings).push(option.value);
    byBank.set(option.bankCode, group);
  }
  return inCatalogOrder(lookup, byBank.keys()).map((code) => {
    const group = byBank.get(code) ?? { own: [], spellings: [] };
    return {
      code,
      label: lookup.name(code, locale),
      values: [...new Set([...group.own, ...[...group.spellings].sort(byCode)])],
    };
  });
};

// The company's sheet against the cards — pure, so every rule is pinned by a unit spec.
//
// A sheet row is matched to a card BY NAME («EGYCASH-3674-B257539»): the companies mask the card
// number down to its last four digits, and those repeat within a company, so a match by number
// would pair the wrong cards. Names are compared after Unicode NFKC, trimming, folding runs of
// spaces and upper-casing.
//
// Nothing ambiguous is ever decidable. A name the sheet gives with different numbers or balances
// (or with a balance that cannot be read beside one that can), a name two live cards share, an
// unreadable balance and a row with no name are CONFLICTS: they are shown, and no ✓ / ✗ may name
// their card. A name the sheet repeats identically counts once and is listed as a duplicate.
import {
  FLEET_FUEL_SHEET_NAME_PREFIX,
  type FleetFuelCardCompany,
  type FleetFuelSheetConflict,
} from '@ecms/contracts';
import { type FuelSheetInvalidRow, type FuelSheetRow } from './read-fuel-sheet';

export const normaliseCardName = (s: string): string =>
  s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();

export const lastFourDigits = (s: string): string => s.replace(/\D/gu, '').slice(-4);

const piastres = (egp: number): number => Math.round(egp * 100);

/** Code-unit order — the same on every machine, whatever its locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What the comparison needs of a live card. */
export interface CompareCard {
  id: string;
  name: string;
  number: string;
  balance: number;
}

export interface ReconcileMatch {
  cardId: string;
  sheet: FuelSheetRow;
  /** The card's balance as read. */
  systemBalance: number;
  /** Sheet − system, to the piastre. */
  difference: number;
  numberMatches: boolean;
}

export interface ReconcileDuplicate extends FuelSheetRow {
  times: number;
}

export interface ReconcileConflict {
  reason: FleetFuelSheetConflict;
  name: string;
  cardId: string | null;
  rows: { row: number; number: string; balance: number | null }[];
}

export interface ReconcilePlan {
  /** Largest |difference| first, then by name. */
  differs: ReconcileMatch[];
  /** In sheet order. */
  equal: ReconcileMatch[];
  /** In sheet order. */
  sheetOnly: FuelSheetRow[];
  /** Card ids, by name. */
  systemOnly: string[];
  duplicates: ReconcileDuplicate[];
  conflicts: ReconcileConflict[];
  sheetCompany: FleetFuelCardCompany | null;
}

type AnyRow = (FuelSheetRow & { reason?: undefined }) | FuelSheetInvalidRow;

const conflictRows = (rows: readonly AnyRow[]): ReconcileConflict['rows'] =>
  rows.map((r) => ({ row: r.row, number: r.number, balance: r.balance }));

/**
 * The company whose prefix every row's name carries, else `null`. `EGYCASHTCS-` is tested before
 * `EGYCASH-`, which it begins with.
 */
export const sheetCompanyOf = (names: readonly string[]): FleetFuelCardCompany | null => {
  if (names.length === 0) return null;
  const prefixes = (
    Object.entries(FLEET_FUEL_SHEET_NAME_PREFIX) as [FleetFuelCardCompany, string][]
  )
    .map(([company, prefix]) => ({ company, prefix: prefix.toUpperCase() }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const companyOf = (name: string): FleetFuelCardCompany | null =>
    prefixes.find(({ prefix }) => normaliseCardName(name).startsWith(prefix))?.company ?? null;
  const first = companyOf(names[0] ?? '');
  return first !== null && names.every((name) => companyOf(name) === first) ? first : null;
};

export const compareFuelSheet = (input: {
  rows: readonly FuelSheetRow[];
  invalid: readonly FuelSheetInvalidRow[];
  cards: readonly CompareCard[];
}): ReconcilePlan => {
  // ── The system side: each name → its live cards ──
  const cardsByName = new Map<string, CompareCard[]>();
  for (const card of input.cards) {
    const key = normaliseCardName(card.name);
    cardsByName.set(key, [...(cardsByName.get(key) ?? []), card]);
  }
  const onlyCardOf = (key: string): CompareCard | null => {
    const found = cardsByName.get(key) ?? [];
    return found.length === 1 ? (found[0] ?? null) : null;
  };

  // ── The sheet side: every named row, valid or not, grouped by name in sheet order ──
  const conflicts: ReconcileConflict[] = [];
  const groups = new Map<string, AnyRow[]>();
  const all: AnyRow[] = [...input.rows, ...input.invalid].sort((a, b) => a.row - b.row);
  for (const row of all) {
    if (row.reason === 'noName') {
      conflicts.push({ reason: 'noName', name: '', cardId: null, rows: conflictRows([row]) });
      continue;
    }
    const key = normaliseCardName(row.name);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const inConflict = new Set<string>();
  const matched = new Set<string>();
  const differs: ReconcileMatch[] = [];
  const equal: ReconcileMatch[] = [];
  const sheetOnly: FuelSheetRow[] = [];
  const duplicates: ReconcileDuplicate[] = [];

  for (const [key, group] of groups) {
    const first = group[0];
    if (first === undefined) continue;
    const card = onlyCardOf(key);
    const conflict = (reason: FleetFuelSheetConflict): void => {
      conflicts.push({
        reason,
        name: first.name,
        cardId: card?.id ?? null,
        rows: conflictRows(group),
      });
      if (card !== null) inConflict.add(card.id);
    };
    if ((cardsByName.get(key) ?? []).length > 1) {
      conflict('systemNameTwice');
      continue;
    }
    const valid = group.filter((r): r is FuelSheetRow => r.reason === undefined);
    if (valid.length === 0) {
      conflict('badBalance');
      continue;
    }
    const sheet = valid[0] as FuelSheetRow;
    const same =
      valid.length === group.length &&
      valid.every(
        (r) =>
          lastFourDigits(r.number) === lastFourDigits(sheet.number) &&
          piastres(r.balance) === piastres(sheet.balance),
      );
    if (!same) {
      conflict('sheetRowsDiffer');
      continue;
    }
    if (group.length > 1) duplicates.push({ ...sheet, times: group.length });
    if (card === null) {
      sheetOnly.push(sheet);
      continue;
    }
    matched.add(card.id);
    const sheetLast4 = lastFourDigits(sheet.number);
    const line: ReconcileMatch = {
      cardId: card.id,
      sheet,
      systemBalance: card.balance,
      difference: (piastres(sheet.balance) - piastres(card.balance)) / 100,
      numberMatches: sheetLast4.length < 4 || sheetLast4 === lastFourDigits(card.number),
    };
    (line.difference === 0 ? equal : differs).push(line);
  }

  // A name two cards share is a conflict even when the sheet does not name it.
  for (const [key, cards] of cardsByName) {
    if (cards.length < 2 || groups.has(key)) continue;
    conflicts.push({
      reason: 'systemNameTwice',
      name: cards[0]?.name ?? '',
      cardId: null,
      rows: [],
    });
  }
  const twice = new Set(
    [...cardsByName.values()]
      .filter((cards) => cards.length > 1)
      .flatMap((cards) => cards.map((c) => c.id)),
  );

  differs.sort(
    (a, b) =>
      Math.abs(piastres(b.difference)) - Math.abs(piastres(a.difference)) ||
      byText(normaliseCardName(a.sheet.name), normaliseCardName(b.sheet.name)),
  );
  conflicts.sort((a, b) => (a.rows[0]?.row ?? Infinity) - (b.rows[0]?.row ?? Infinity));
  const systemOnly = input.cards
    .filter((card) => !matched.has(card.id) && !inConflict.has(card.id) && !twice.has(card.id))
    .sort((a, b) => byText(normaliseCardName(a.name), normaliseCardName(b.name)))
    .map((card) => card.id);

  return {
    differs,
    equal,
    sheetOnly,
    systemOnly,
    duplicates,
    conflicts,
    sheetCompany: sheetCompanyOf(all.flatMap((row) => (row.name === '' ? [] : [row.name]))),
  };
};

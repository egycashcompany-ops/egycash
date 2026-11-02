// The company's sheet against the cards — pure, so every rule is pinned by a unit spec.
//
// A sheet row is matched to a card BY NAME («EGYCASH-3674-B257539»): the companies mask the card
// number down to its last four digits, and those repeat within a company, so a match by number
// would pair the wrong cards. On his Wataniya statement it would pair fifteen: the system holds
// those fifteen cards' numbers crossed, and only the name (with its car and its balance) is right.
// The name is the one the reader rebuilt («EGYCASH» + plate + chassis), compared CANONICALLY —
// NFKC, upper case, split on spaces, «-» and «_», and an all-digit part read without its leading
// zeros (Excel turns a chassis «046466» typed into a number cell into 46466).
//
// The number CHECKS the match and never makes it — with one exception: a FULL number the sheet
// prints, on exactly one card whose name the sheet does not give, is that card (full numbers are
// unique, `ux_fuel_card_number`). A name matched with a number that is not the card's says so
// (`numberMatches: false`) and names the card that does hold it (`numberHolderId`) — a crossed
// number's partner.
//
// Nothing ambiguous is ever decidable. A name the sheet gives with different numbers or balances
// (or with a balance that cannot be read beside one that can), a name two live cards share that
// neither the number nor the car code tells apart, an unreadable balance, a number whose last four
// fit two or more cards, a row with no name whose last four fit one card, and a card two rows
// claim are CONFLICTS: they are shown, and no ✓ / ✗ may name their card. A row the sheet repeats
// identically counts once and is listed as a duplicate.
import {
  FLEET_FUEL_SHEET_NAME_PREFIX,
  type FleetFuelCardCompany,
  type FleetFuelSheetConflict,
  type FleetFuelSheetNumberKind,
} from '@ecms/contracts';
import {
  FULL_NUMBER,
  MASKED_NUMBER,
  type FuelSheetInvalidRow,
  type FuelSheetRow,
} from './read-fuel-sheet';

export const normaliseCardName = (s: string): string =>
  s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();

/**
 * The key a card name is matched by: NFKC, upper case, split on spaces, «-» and «_», each
 * all-digit part without its leading zeros, joined with «-».
 */
export const canonCardName = (s: string): string =>
  s
    .normalize('NFKC')
    .toUpperCase()
    .split(/[\s\-_]+/u)
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/u.test(part) ? part.replace(/^0+(?=\d)/u, '') : part))
    .join('-');

export const lastFourDigits = (s: string): string => s.replace(/\D/gu, '').slice(-4);

/** A car code or a label, folded for comparison: NFKC, trimmed, case-folded, no spaces. */
export const foldSheetCode = (s: string): string =>
  s.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, '');

const piastres = (egp: number): number => Math.round(egp * 100);

/** Code-unit order — the same on every machine, whatever its locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** «EGYCASH», «EGYCASHTCS» — what a statement prints instead of a name. */
const BARE_PREFIXES = new Set(
  Object.values(FLEET_FUEL_SHEET_NAME_PREFIX).map((prefix) =>
    canonCardName(prefix.replace(/-$/u, '')),
  ),
);

/** The row gives a name to check — not empty, not the bare company prefix. */
export const hasNameToCheck = (builtName: string): boolean => {
  const key = canonCardName(builtName);
  return key !== '' && !BARE_PREFIXES.has(key);
};

/** What the sheet's number says, read by its kind. */
export interface SheetNumber {
  kind: FleetFuelSheetNumberKind;
  /** Every digit printed. */
  digits: string;
  /** The digits printed before a mask («548»). */
  prefix: string;
  /** The digits printed after a mask, or the last four of the digits. */
  tail: string;
}

export const sheetNumberOf = (number: string, kind: FleetFuelSheetNumberKind): SheetNumber => {
  const spaced = number.replace(/\s/gu, '');
  const digits = spaced.replace(/\D/gu, '');
  if (kind === 'masked') {
    const parts = MASKED_NUMBER.exec(spaced);
    return { kind, digits, prefix: parts?.[1] ?? '', tail: parts?.[2] ?? digits.slice(-4) };
  }
  if (kind === 'full' && !FULL_NUMBER.test(spaced)) return { kind, digits, prefix: '', tail: '' };
  return { kind, digits, prefix: '', tail: digits.slice(-4) };
};

/**
 * Whether the sheet's number is this card's: `true` / `false`, or `null` when the sheet's number
 * cannot say (empty, fewer than four digits). An imprecise number is compared on the fifteen
 * digits a spreadsheet keeps.
 */
export const numberFits = (sheet: SheetNumber, cardNumber: string): boolean | null => {
  const card = cardNumber.replace(/\D/gu, '');
  switch (sheet.kind) {
    case 'full':
      return card === sheet.digits;
    case 'masked':
      return card.endsWith(sheet.tail) && card.startsWith(sheet.prefix);
    case 'imprecise':
      return card.length === sheet.digits.length && card.slice(0, 15) === sheet.digits.slice(0, 15);
    case 'other':
      return sheet.tail.length < 4 ? null : card.slice(-4) === sheet.tail;
    case 'none':
      return null;
  }
};

/** What the comparison needs of a live card. */
export interface CompareCard {
  id: string;
  name: string;
  number: string;
  balance: number;
  /** The car's code, or the card's label on no car. */
  place?: string | null;
}

export interface ReconcileMatch {
  cardId: string;
  sheet: FuelSheetRow;
  /** The card's balance as read. */
  systemBalance: number;
  /** Sheet − system, to the piastre. */
  difference: number;
  numberMatches: boolean;
  matchedBy: 'name' | 'number';
  nameMatches: boolean;
  /** The live card that holds the sheet's number when this one does not. */
  numberHolderId: string | null;
  /** The sheet's car code against the card's place — a hint; `null` without a code. */
  placeMatches: boolean | null;
}

export interface ReconcileDuplicate extends FuelSheetRow {
  times: number;
}

export interface ReconcileConflict {
  reason: FleetFuelSheetConflict;
  name: string;
  cardId: string | null;
  candidateIds: string[];
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
 * The company whose prefix every row's name carries, else `null`. A name counts when it IS the
 * bare prefix («EGYCASH») or starts with «PREFIX-»; `EGYCASHTCS` is tested before `EGYCASH`, which
 * it begins with.
 */
export const sheetCompanyOf = (names: readonly string[]): FleetFuelCardCompany | null => {
  if (names.length === 0) return null;
  const prefixes = (
    Object.entries(FLEET_FUEL_SHEET_NAME_PREFIX) as [FleetFuelCardCompany, string][]
  )
    .map(([company, prefix]) => ({ company, prefix: prefix.toUpperCase() }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const companyOf = (name: string): FleetFuelCardCompany | null => {
    const normal = normaliseCardName(name);
    return (
      prefixes.find(
        ({ prefix }) => normal === prefix.replace(/-$/u, '') || normal.startsWith(prefix),
      )?.company ?? null
    );
  };
  const first = companyOf(names[0] ?? '');
  return first !== null && names.every((name) => companyOf(name) === first) ? first : null;
};

/** The sheet's car code against a card's place, folded — `null` when the sheet gives no code. */
export const codeMatchesPlace = (
  code: string | null,
  place: string | null | undefined,
): boolean | null =>
  code === null || code.trim() === ''
    ? null
    : place != null && foldSheetCode(code) === foldSheetCode(place);

export const compareFuelSheet = (input: {
  rows: readonly FuelSheetRow[];
  invalid: readonly FuelSheetInvalidRow[];
  cards: readonly CompareCard[];
  /** How a matched row's code is judged against its card — by default, the folded place. */
  samePlace?: (row: FuelSheetRow, card: CompareCard) => boolean | null;
}): ReconcilePlan => {
  const samePlace =
    input.samePlace ??
    ((row: FuelSheetRow, card: CompareCard) => codeMatchesPlace(row.code, card.place));

  // ── The system side: each canonical name → its live cards ──
  const cardsByName = new Map<string, CompareCard[]>();
  for (const card of input.cards) {
    const key = canonCardName(card.name);
    cardsByName.set(key, [...(cardsByName.get(key) ?? []), card]);
  }
  /** The cards the row's number fits — never on an empty, short or imprecise number. */
  const numbered = (row: AnyRow): CompareCard[] => {
    const sheet = sheetNumberOf(row.number, row.numberKind);
    if (sheet.kind === 'none' || sheet.kind === 'imprecise') return [];
    return input.cards.filter((card) => numberFits(sheet, card.number) === true);
  };

  /** Of the cards sharing a name, the one the number — else the car code — tells apart. */
  const twinOf = (sheet: FuelSheetRow, twins: readonly CompareCard[]): CompareCard | null => {
    const fits = numbered(sheet).filter((card) => twins.includes(card));
    if (fits.length === 1) return fits[0] ?? null;
    const byCode = twins.filter((card) => samePlace(sheet, card) === true);
    return byCode.length === 1 ? (byCode[0] ?? null) : null;
  };

  // ── The sheet side: rows grouped by what identifies them, in sheet order ──
  // A row that gives a name is grouped by it; one that gives none, by its full number; any other
  // row stands alone (a bare «EGYCASH» on every row is not one card).
  const all: AnyRow[] = [...input.rows, ...input.invalid].sort((a, b) => a.row - b.row);
  const groups = new Map<string, AnyRow[]>();
  for (const row of all) {
    const named = hasNameToCheck(row.builtName);
    const sheet = sheetNumberOf(row.number, row.numberKind);
    const key = named
      ? `n:${canonCardName(row.builtName)}`
      : sheet.kind === 'full'
        ? `d:${sheet.digits}`
        : `r:${String(row.row)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const conflicts: ReconcileConflict[] = [];
  const inConflict = new Set<string>();
  const claims: { card: CompareCard; sheet: FuelSheetRow; matchedBy: 'name' | 'number' }[] = [];
  const sheetOnly: FuelSheetRow[] = [];
  const duplicates: ReconcileDuplicate[] = [];
  const namesSeen = new Set<string>();

  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const named = hasNameToCheck(first.builtName);
    const nameKey = canonCardName(first.builtName);
    if (named) namesSeen.add(nameKey);
    const byName = named ? (cardsByName.get(nameKey) ?? []) : [];
    const valid = group.filter(
      (r): r is FuelSheetRow & { reason?: undefined } => r.reason === undefined,
    );
    const sheet = valid[0];
    const consistent =
      valid.length === group.length &&
      sheet !== undefined &&
      valid.every(
        (r) =>
          lastFourDigits(r.number) === lastFourDigits(sheet.number) &&
          piastres(r.balance) === piastres(sheet.balance),
      );
    /** The card a conflict names: the name's only card, else a full number's. */
    const cardOf = (): CompareCard | null => {
      if (byName.length === 1) return byName[0] ?? null;
      if (named || sheetNumberOf(first.number, first.numberKind).kind !== 'full') return null;
      const found = numbered(first);
      return found.length === 1 ? (found[0] ?? null) : null;
    };
    const conflict = (
      reason: FleetFuelSheetConflict,
      card: CompareCard | null,
      candidateIds: string[] = [],
    ): void => {
      conflicts.push({
        reason,
        name: first.builtName,
        cardId: card?.id ?? null,
        candidateIds,
        rows: conflictRows(group),
      });
      if (card !== null) inConflict.add(card.id);
    };

    // A name two live cards share: the number, then the car code, may tell them apart.
    if (byName.length > 1) {
      const pick = consistent && sheet !== undefined ? twinOf(sheet, byName) : null;
      if (pick === null || sheet === undefined) {
        conflict('systemNameTwice', null);
        for (const card of byName) inConflict.add(card.id);
        continue;
      }
      if (group.length > 1) duplicates.push({ ...sheet, times: group.length });
      claims.push({ card: pick, sheet, matchedBy: 'name' });
      continue;
    }
    if (sheet === undefined) {
      conflict('badBalance', cardOf());
      continue;
    }
    if (!consistent) {
      conflict('sheetRowsDiffer', cardOf());
      continue;
    }
    if (group.length > 1) duplicates.push({ ...sheet, times: group.length });

    const only = byName[0];
    if (only !== undefined) {
      claims.push({ card: only, sheet, matchedBy: 'name' });
      continue;
    }
    // The name is on no card, or the sheet gives none: a full number may say which card it is.
    // A row that NAMES a card no card carries is the sheet's own (a new card) — its masked last
    // four are no evidence against a name. A row that names nothing is listed with the cards its
    // last four fit, and decided by nobody.
    const fits = numbered(sheet);
    const [fit] = fits;
    if (
      sheetNumberOf(sheet.number, sheet.numberKind).kind === 'full' &&
      fits.length === 1 &&
      fit !== undefined
    ) {
      claims.push({ card: fit, sheet, matchedBy: 'number' });
    } else if (!named && fits.length === 1 && fit !== undefined) {
      conflict('lastFourOnly', null, [fit.id]);
    } else if (!named && fits.length > 1) {
      conflict(
        'ambiguousNumber',
        null,
        fits.map((card) => card.id),
      );
    } else {
      sheetOnly.push(sheet);
    }
  }

  // One card claimed by two rows: neither row decides it.
  const claimsOf = new Map<string, typeof claims>();
  for (const claim of claims) {
    claimsOf.set(claim.card.id, [...(claimsOf.get(claim.card.id) ?? []), claim]);
  }
  const differs: ReconcileMatch[] = [];
  const equal: ReconcileMatch[] = [];
  const matched = new Set<string>();
  for (const [cardId, cardClaims] of claimsOf) {
    const [claim] = cardClaims;
    if (claim === undefined) continue;
    if (cardClaims.length > 1) {
      conflicts.push({
        reason: 'cardTwice',
        name: claim.card.name,
        cardId,
        candidateIds: [],
        rows: conflictRows(cardClaims.map((c) => c.sheet)),
      });
      inConflict.add(cardId);
      continue;
    }
    const { card, sheet, matchedBy } = claim;
    matched.add(cardId);
    const number = sheetNumberOf(sheet.number, sheet.numberKind);
    const numberMatches = numberFits(number, card.number) ?? true;
    const holders = numberMatches ? [] : numbered(sheet).filter((other) => other.id !== cardId);
    const line: ReconcileMatch = {
      cardId,
      sheet,
      systemBalance: card.balance,
      difference: (piastres(sheet.balance) - piastres(card.balance)) / 100,
      numberMatches,
      matchedBy,
      nameMatches: matchedBy === 'name',
      numberHolderId: holders.length === 1 ? (holders[0]?.id ?? null) : null,
      placeMatches: samePlace(sheet, card),
    };
    (line.difference === 0 ? equal : differs).push(line);
  }
  const bySheetRow = (a: ReconcileMatch, b: ReconcileMatch): number => a.sheet.row - b.sheet.row;
  equal.sort(bySheetRow);

  // A name two cards share is a conflict even when the sheet does not name it.
  const twiceUnseen = new Set<string>();
  for (const [key, cards] of cardsByName) {
    if (cards.length < 2 || namesSeen.has(key)) continue;
    conflicts.push({
      reason: 'systemNameTwice',
      name: cards[0]?.name ?? '',
      cardId: null,
      candidateIds: [],
      rows: [],
    });
    for (const card of cards) twiceUnseen.add(card.id);
  }

  differs.sort(
    (a, b) =>
      Math.abs(piastres(b.difference)) - Math.abs(piastres(a.difference)) ||
      byText(normaliseCardName(a.sheet.builtName), normaliseCardName(b.sheet.builtName)),
  );
  conflicts.sort((a, b) => (a.rows[0]?.row ?? Infinity) - (b.rows[0]?.row ?? Infinity));
  const systemOnly = input.cards
    .filter(
      (card) => !matched.has(card.id) && !inConflict.has(card.id) && !twiceUnseen.has(card.id),
    )
    .sort((a, b) => byText(normaliseCardName(a.name), normaliseCardName(b.name)))
    .map((card) => card.id);

  return {
    differs,
    equal,
    sheetOnly,
    systemOnly,
    duplicates,
    conflicts,
    sheetCompany: sheetCompanyOf(
      all.flatMap((row) => (row.builtName === '' ? [] : [row.builtName])),
    ),
  };
};

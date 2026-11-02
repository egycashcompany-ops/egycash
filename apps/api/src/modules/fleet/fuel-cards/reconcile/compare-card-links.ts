// «ربط الكروت بالسيارات» — the sheet's car code against the card's car. Pure, so every rule is
// pinned by a unit spec; the service loads the registry, the aliases and the cards, and stores
// what this returns.
//
// THE SHEET'S CODES ARE NOT THE REGISTRY'S. 43 of the 426 go-live cards carry another spelling
// («suz 62» = 62, «m g 3» = MG 3, «geely» = كولراى, «194» = 288) or a label («سفر 1», «اسبير»). A
// code is resolved, in order: a remembered ALIAS (seeded from go-live, or «تذكّر هذا الكود») → the
// registry's car CODE (folded: «m g 3» = «MG 3») → a LABEL (the card's own, another card's of the
// company, or a label word «سفر…» / «اسبير») → unresolved («كود غير معروف»).
//
// NOTHING IS EVER DECIDED HERE. Each matched card whose place the sheet says otherwise becomes a
// row the owner confirms (`attach` / `move` / `detach` / `unknownCode`). The chassis in the card's
// name is shown as EVIDENCE (`chassisCar`): it names the right car for 411 of his 415 go-live cards,
// while the sheet's code column is itself wrong for one pair (MG 2 ↔ 172). A sheet-only row becomes
// a «كارت في الشيت وليس في النظام» with where the sheet puts it.
//
// One card per company per car (`ux_fuel_card_vehicle_company`): a target car whose card does not
// move away is `slotHeldBy` it; a card that frees this one's slot (a swap, a chain) is `pairWith`.
// The 0849 pair waits for the card-number repair (`inRepair`): its names and balances sit on the
// wrong records, so a move by the sheet would put each number on the wrong car.
import { type FleetFuelLinkKind, type FleetFuelLinkResolver } from '@ecms/contracts';
import { foldSheetCode } from './compare-fuel-sheet';
import { type FuelSheetRow } from './read-fuel-sheet';

/**
 * The two full numbers of the 0849 pair (go-live asset `fuel-cards-2026-10-04.json`) — until the
 * card-number repair (6d) runs, then emptied. Their links are shown, never applied.
 */
export const FUEL_CARD_LINKS_IN_REPAIR: readonly string[] = [
  '5485640006210849',
  '5485640006880849',
];

/** Where a card is, or where the sheet puts it. */
export interface LinkPlace {
  vehicleId: string | null;
  vehicleCode: string | null;
  label: string | null;
}

export interface LinkVehicle {
  id: string;
  code: string;
  chassisNumber: string;
}

export interface LinkCard {
  id: string;
  number: string;
  vehicleId: string | null;
  label: string | null;
}

/** A remembered sheet code — to a car (by id, else by code) or to a label. */
export interface LinkAlias {
  vehicleId: string | null;
  vehicleCode: string | null;
  label: string | null;
}

export interface ResolvedCode {
  place: LinkPlace;
  by: FleetFuelLinkResolver;
}

/** «سفر 1…», «اسبير» — words that name a card on no car. */
export const isLabelWord = (code: string): boolean => {
  const key = foldSheetCode(code);
  return key.startsWith('سفر') || key === 'اسبير';
};

/** A chassis compared without its letter prefix and leading zeros («MB060216» = «60216»). */
export const bareChassis = (chassis: string): string =>
  chassis
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toUpperCase()
    .replace(/^[A-Z]+/u, '')
    .replace(/^0+/u, '');

/** The chassis a sheet row carries: its chassis column, else its name's third segment. */
export const rowChassis = (row: Pick<FuelSheetRow, 'chassis' | 'builtName'>): string =>
  bareChassis(row.chassis ?? row.builtName.split('-')[2] ?? '');

/** Keys that name exactly one thing — a fold two entries share decides nothing. */
const uniqueBy = <T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T> => {
  const seen = new Map<string, T | null>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === '') continue;
    seen.set(key, seen.has(key) ? null : item);
  }
  return new Map([...seen].filter((entry): entry is [string, T] => entry[1] !== null));
};

export interface LinkWorld {
  vehicles: readonly LinkVehicle[];
  /** Folded sheet code → its alias. */
  aliases: ReadonlyMap<string, LinkAlias>;
  /** The company's live cards. */
  cards: readonly LinkCard[];
}

/** The resolver and the evidence, built once per read. */
export const linkResolver = (world: LinkWorld) => {
  const byId = new Map(world.vehicles.map((v) => [v.id, v]));
  const byCode = uniqueBy(world.vehicles, (v) => foldSheetCode(v.code));
  const byChassis = uniqueBy(world.vehicles, (v) => bareChassis(v.chassisNumber));
  const labels = uniqueBy(
    world.cards.flatMap((card) => (card.vehicleId === null && card.label ? [card.label] : [])),
    (label) => foldSheetCode(label),
  );
  const car = (v: LinkVehicle): LinkPlace => ({
    vehicleId: v.id,
    vehicleCode: v.code,
    label: null,
  });

  /** Where the sheet's code puts a card; `null` when nothing answers to it. */
  const resolve = (code: string, card: LinkCard | null): ResolvedCode | null => {
    const key = foldSheetCode(code);
    if (key === '') return null;
    const alias = world.aliases.get(key);
    if (alias !== undefined) {
      const v =
        (alias.vehicleId === null ? undefined : byId.get(alias.vehicleId)) ??
        (alias.vehicleCode === null ? undefined : byCode.get(foldSheetCode(alias.vehicleCode)));
      if (v !== undefined) return { place: car(v), by: 'alias' };
      if (alias.vehicleId === null && alias.vehicleCode === null && alias.label !== null) {
        return { place: { vehicleId: null, vehicleCode: null, label: alias.label }, by: 'alias' };
      }
    }
    const v = byCode.get(key);
    if (v !== undefined) return { place: car(v), by: 'code' };
    const own = card?.vehicleId === null && card.label && foldSheetCode(card.label) === key;
    const label = own
      ? (card.label as string)
      : (labels.get(key) ?? (isLabelWord(code) ? code.trim() : null));
    return label === null
      ? null
      : { place: { vehicleId: null, vehicleCode: null, label }, by: 'label' };
  };

  /** The car whose chassis the row carries — evidence only. */
  const chassisCar = (row: Pick<FuelSheetRow, 'chassis' | 'builtName'>): string | null => {
    const bare = rowChassis(row);
    return bare === '' ? null : (byChassis.get(bare)?.code ?? null);
  };

  return { resolve, chassisCar, vehicle: (id: string) => byId.get(id) };
};
export type LinkResolver = ReturnType<typeof linkResolver>;

/** A card's place now. */
export const placeOf = (card: LinkCard, resolver: LinkResolver): LinkPlace =>
  card.vehicleId === null
    ? { vehicleId: null, vehicleCode: null, label: card.label }
    : {
        vehicleId: card.vehicleId,
        vehicleCode: resolver.vehicle(card.vehicleId)?.code ?? null,
        label: null,
      };

/** Two places are the same: the same car, or both on no car under the same (folded) label. */
const samePlace = (a: LinkPlace, b: LinkPlace): boolean =>
  a.vehicleId !== null || b.vehicleId !== null
    ? a.vehicleId === b.vehicleId
    : foldSheetCode(a.label ?? '') === foldSheetCode(b.label ?? '');

/**
 * The sheet's code against a matched card — `true` where it puts the card where it is, `false`
 * where elsewhere (or nowhere known), `null` when the sheet has no code column or the cell is empty.
 */
export const placeVerdict = (
  code: string | null,
  card: LinkCard,
  resolver: LinkResolver,
  carColumn: boolean,
): boolean | null => {
  if (!carColumn || code === null || code.trim() === '') return null;
  const resolved = resolver.resolve(code, card);
  return resolved !== null && samePlace(resolved.place, placeOf(card, resolver));
};

export interface CardLink {
  cardId: string;
  sheetRow: number;
  sheetCode: string | null;
  kind: FleetFuelLinkKind;
  from: LinkPlace;
  /** `null` for an unknown code. */
  to: LinkPlace | null;
  resolvedBy: FleetFuelLinkResolver | null;
  chassisCar: string | null;
  /** The card holding the target car's slot that does not move away. */
  slotHeldBy: string | null;
  /** The card freeing this one's slot, or taking the slot this one frees. */
  pairWith: string | null;
  inRepair: boolean;
}

export interface SheetNewCard {
  row: FuelSheetRow;
  to: LinkPlace | null;
  resolvedBy: FleetFuelLinkResolver | null;
  chassisCar: string | null;
  slotHeldBy: string | null;
}

const digitsOf = (number: string): string => number.replace(/\D/gu, '');

/**
 * Every matched card whose place the sheet says otherwise, and every sheet-only row with where the
 * sheet puts it. A sheet without a car-code column proposes no link.
 */
export const compareCardLinks = (input: {
  matches: readonly { cardId: string; sheet: FuelSheetRow }[];
  sheetOnly: readonly FuelSheetRow[];
  carColumn: boolean;
  world: LinkWorld;
  resolver?: LinkResolver;
  inRepair?: readonly string[];
}): { links: CardLink[]; newCards: SheetNewCard[] } => {
  const resolver = input.resolver ?? linkResolver(input.world);
  const repair = new Set((input.inRepair ?? FUEL_CARD_LINKS_IN_REPAIR).map(digitsOf));
  const cardById = new Map(input.world.cards.map((card) => [card.id, card]));
  const holderOf = new Map(
    input.world.cards.flatMap((card) => (card.vehicleId === null ? [] : [[card.vehicleId, card]])),
  );

  const links: Omit<CardLink, 'slotHeldBy' | 'pairWith'>[] = [];
  if (input.carColumn) {
    for (const { cardId, sheet } of [...input.matches].sort((a, b) => a.sheet.row - b.sheet.row)) {
      const card = cardById.get(cardId);
      if (card === undefined) continue;
      const from = placeOf(card, resolver);
      const base = {
        cardId,
        sheetRow: sheet.row,
        sheetCode: sheet.code,
        from,
        chassisCar: resolver.chassisCar(sheet),
        inRepair: repair.has(digitsOf(card.number)),
      };
      if (sheet.code === null || sheet.code.trim() === '') {
        // «متشال»: the sheet carries no code for a card the system has on a car — offer to take it
        // off, under the old car's code.
        if (card.vehicleId !== null) {
          const label = from.vehicleCode ?? '';
          if (label !== '') {
            links.push({
              ...base,
              kind: 'detach',
              to: { vehicleId: null, vehicleCode: null, label },
              resolvedBy: null,
            });
          }
        }
        continue;
      }
      const resolved = resolver.resolve(sheet.code, card);
      if (resolved === null) {
        links.push({ ...base, kind: 'unknownCode', to: null, resolvedBy: null });
        continue;
      }
      if (samePlace(resolved.place, from)) continue;
      if (resolved.place.vehicleId !== null) {
        links.push({
          ...base,
          kind: card.vehicleId === null ? 'attach' : 'move',
          to: resolved.place,
          resolvedBy: resolved.by,
        });
      } else if (card.vehicleId !== null) {
        links.push({ ...base, kind: 'detach', to: resolved.place, resolvedBy: resolved.by });
      }
      // A card on no car the sheet names under another label: no place to change it to.
    }
  }

  // Who frees a slot, and who takes one.
  const target = new Map(links.map((link) => [link.cardId, link.to]));
  const leaves = (cardId: string, vehicleId: string): boolean => {
    const to = target.get(cardId);
    return to != null && to.vehicleId !== vehicleId;
  };
  const takers = new Map<string, string>();
  for (const link of links) {
    if (link.to?.vehicleId != null && !takers.has(link.to.vehicleId)) {
      takers.set(link.to.vehicleId, link.cardId);
    }
  }
  const withSlots: CardLink[] = links.map((link) => {
    const vehicleId = link.to?.vehicleId ?? null;
    const holder = vehicleId === null ? undefined : holderOf.get(vehicleId);
    const held = holder !== undefined && holder.id !== link.cardId ? holder : undefined;
    const frees = held !== undefined && leaves(held.id, vehicleId as string);
    const taker = link.from.vehicleId === null ? undefined : takers.get(link.from.vehicleId);
    return {
      ...link,
      slotHeldBy: held !== undefined && !frees ? held.id : null,
      pairWith: frees
        ? (held?.id ?? null)
        : taker !== undefined && taker !== link.cardId
          ? taker
          : null,
    };
  });

  const newCards: SheetNewCard[] = input.sheetOnly.map((row) => {
    const resolved = input.carColumn && row.code !== null ? resolver.resolve(row.code, null) : null;
    const vehicleId = resolved?.place.vehicleId ?? null;
    const holder = vehicleId === null ? undefined : holderOf.get(vehicleId);
    return {
      row,
      to: resolved?.place ?? null,
      resolvedBy: resolved?.by ?? null,
      chassisCar: resolver.chassisCar(row),
      slotHeldBy: holder?.id ?? null,
    };
  });

  return { links: withSlots, newCards };
};

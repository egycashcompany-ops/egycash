// The drivers' bar, as DATA: counts in, one card per fine out, one batch payload at the end.
//
// The bar is a counting exercise before it is a data-entry one — «this car got two speeding and
// one seatbelt» — and only then does each fine need the person, the day and the money. Keeping
// that shape here rather than in the panel means the rules can be tested without a DOM: how many
// cards a set of counts opens, what each is called, when the batch is complete, and what it sends.
//
// It decides NOTHING about which types exist. The caller hands it the driver-side catalog, and a
// house that adds a fifth kind of driver fine gets a fifth counter with no code change.
import { type RecordFleetDriverViolations } from '@ecms/contracts';

export interface DriverEntryType {
  id: string;
  name: string;
}

/** One fine being entered: which type it is, and which of that type's count it is. */
export interface DriverEntryCard {
  /** Stable across re-renders while the counts hold — `${typeId}:${ordinal}`. */
  key: string;
  typeId: string;
  typeName: string;
  /** 1-based, per type: the second «سرعة» of this car is `2`. */
  ordinal: number;
  date: string;
  driverEmployeeId: string;
  /** Kept as typed, so a half-written number is not silently read as zero. */
  amount: string;
}

const blank = (type: DriverEntryType, ordinal: number): DriverEntryCard => ({
  key: `${type.id}:${ordinal}`,
  typeId: type.id,
  typeName: type.name,
  ordinal,
  date: '',
  driverEmployeeId: '',
  amount: '',
});

/**
 * The cards a set of counts asks for, in the catalog's own order.
 *
 * Existing cards are CARRIED OVER by key: raising «سرعة» from one to two must not blank the first
 * one's driver, and lowering it back must not resurrect the second's. A count that shrinks drops
 * the highest ordinals, which is what a reader who typed one number too many expects.
 */
export const entryCards = (
  types: readonly DriverEntryType[],
  counts: Readonly<Record<string, number>>,
  existing: readonly DriverEntryCard[] = [],
): DriverEntryCard[] => {
  const held = new Map(existing.map((card) => [card.key, card]));
  const cards: DriverEntryCard[] = [];
  for (const type of types) {
    const wanted = Math.max(0, Math.trunc(counts[type.id] ?? 0));
    for (let ordinal = 1; ordinal <= wanted; ordinal += 1) {
      const fresh = blank(type, ordinal);
      const kept = held.get(fresh.key);
      // The NAME comes from the live catalog every time — a renamed type renames its cards.
      cards.push(kept === undefined ? fresh : { ...kept, typeName: type.name });
    }
  }
  return cards;
};

/** «سرعة - 2». The type's own name, never a legacy one-letter code. */
export const cardLabel = (card: DriverEntryCard): string => `${card.typeName} - ${card.ordinal}`;

const isMoney = (value: string): boolean => /^\d+(\.\d{1,2})?$/.test(value.trim());

/** Which cards are not yet fileable, by key — the panel points at them rather than just refusing. */
export const incompleteCards = (cards: readonly DriverEntryCard[]): string[] =>
  cards
    .filter(
      (card) => card.date === '' || card.driverEmployeeId === '' || !isMoney(card.amount),
    )
    .map((card) => card.key);

/** Every card named a driver, a day and an amount — and there is at least one card. */
export const entryComplete = (cards: readonly DriverEntryCard[]): boolean =>
  cards.length > 0 && incompleteCards(cards).length === 0;

/** What the cards add up to, for the panel's own footer. Non-numeric amounts count as nothing. */
export const entryTotal = (cards: readonly DriverEntryCard[]): number =>
  cards.reduce((sum, card) => sum + (isMoney(card.amount) ? Number(card.amount) : 0), 0);

/**
 * The ONE request the bar sends. Throws rather than sending a half-filled card: the batch is
 * atomic on the server, and a client that trims silently would file fewer fines than the reader
 * counted and report success.
 */
export const toBatchPayload = (
  vehicleId: string,
  cards: readonly DriverEntryCard[],
): RecordFleetDriverViolations => {
  if (vehicleId === '') throw new Error('a batch needs the vehicle it is filed against');
  if (!entryComplete(cards)) throw new Error('every card needs a date, a driver and an amount');
  return {
    vehicleId,
    rows: cards.map((card) => ({
      date: new Date(`${card.date}T00:00:00.000Z`),
      driverEmployeeId: card.driverEmployeeId,
      violationTypeId: card.typeId,
      amount: Number(card.amount),
    })),
  };
};

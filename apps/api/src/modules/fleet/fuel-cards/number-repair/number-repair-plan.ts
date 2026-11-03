// «تصحيح أرقام الكروت» (6d) — the PURE planner. Given the live cards on the definition's cars (no
// PIN value: only whether one is stored) and the repair's own `dataFix` lines, it says what each
// record reads, what each unit may do, and — for a ready unit — exactly what to write. The service
// reads and writes; every rule is here, pinned by `number-repair-plan.spec.ts`.
//
// A record reads «before» when the owner's three facts are what he reviewed — the live Wataniya card
// on its car, holding the number it held at go-live, under its name (compared with `===`, «S» and
// all) — and «after» when they are what the repair leaves. The expiry, the photo and the PIN are NOT
// part of it: they belong to the physical card, travel with its number, and may be renewed, replaced
// or typed at any time (the repair carries whatever the card holds when it runs). A unit is fixed
// whole or not at all:
//   · done   — the repair RAN: its `dataFix` line is there for every record (found by what the line
//              says — the number it gave, the name it gave —, never by the car the card is on now:
//              a card moved, replaced or deleted later never makes a repaired unit pending again),
//              or, for a cycle only, every record reads «after» (fixed by hand);
//   · ready  — every record reads «before», and the unit has no `dataFix` line;
//   · held   — anything else: the records that read «before» wait with it («موقوف مع الدائرة»), the
//              others are `changed` («تغيّر — لن يُلمس») with what differs.
// The pair is never «fixed by hand»: its balances move by the opening's difference, which a hand
// swap of the names cannot be known to have done (`repairLine`).
import {
  type FleetFuelCardCompany,
  type FleetFuelNumberRepairCycleUnit,
  type FleetFuelNumberRepairField,
  type FleetFuelNumberRepairRowState,
  type FleetFuelNumberRepairUnit,
  type FleetFuelNumberRepairUnitState,
} from '@ecms/contracts';
import {
  REPAIR_PAIR,
  REPAIR_RECORDS,
  recordsOf,
  type RepairCycleRecord,
  type RepairPairRecord,
} from './number-repair-definition';

/** A live card as the planner sees it — never its PIN, only whether one is stored. */
export interface RepairLiveCard {
  id: string;
  company: FleetFuelCardCompany;
  /** The car's code; `null` on a card on no car. */
  vehicleCode: string | null;
  label: string | null;
  name: string;
  number: string;
  /** `YYYY-MM-DD`, or `null` when none is on file. */
  expiresAt: string | null;
  hasPin: boolean;
  image: { fileName: string; size: number } | null;
  balance: number;
  version: number;
}

/** One `dataFix` line of the repair. */
export interface RepairLine {
  movementId: string;
  cardId: string;
  unit: FleetFuelNumberRepairUnit;
  /** A cycle line: the number it gave the record — which record the line is. */
  numberAfter: string | null;
  /** A pair line: the name it gave the record — which record the line is. */
  nameAfter: string | null;
  at: Date;
  by: string | null;
}

export interface RepairWorld {
  /** The live Wataniya card on each of the definition's cars, by car code (absent: none). */
  byCar: ReadonlyMap<string, RepairLiveCard>;
  /** The live Wataniya cards holding one of the definition's numbers, by number. */
  byNumber: ReadonlyMap<string, RepairLiveCard>;
  lines: readonly RepairLine[];
}

export interface PlannedChange {
  field: FleetFuelNumberRepairField;
  expected: string | null;
  now: string | null;
}

export interface PlannedRow {
  car: string;
  card: RepairLiveCard | null;
  readsBefore: boolean;
  readsAfter: boolean;
  state: FleetFuelNumberRepairRowState;
  /** What differs from «before» — on a `changed` row only. */
  changes: PlannedChange[];
  /** This record's `dataFix` line of the unit, when written. */
  line: RepairLine | null;
}

/** A ready cycle record's write: the right number, and the card whose PIN, photo, expiry come with it. */
export interface CycleWrite {
  cardId: string;
  version: number;
  car: string;
  numberBefore: string;
  numberAfter: string;
  /** The card holding `numberAfter` today — its PIN, photo and expiry move with the number. */
  takeFrom: string;
  /** The live expiries (`YYYY-MM-DD`) — this record's today, and the one that comes with the number. */
  expiryBefore: string | null;
  expiryAfter: string | null;
  balance: number;
}

/** A ready pair record's write: the other name, the opening's difference on the balance. */
export interface PairWrite {
  cardId: string;
  version: number;
  car: string;
  nameBefore: string;
  nameAfter: string;
  openingBefore: number;
  openingAfter: number;
  delta: number;
  balance: number;
}

export interface PlannedCycle {
  unit: FleetFuelNumberRepairCycleUnit;
  state: FleetFuelNumberRepairUnitState;
  records: RepairCycleRecord[];
  rows: PlannedRow[];
  /** In chain order; `[]` unless ready. */
  writes: CycleWrite[];
}

export interface PlannedPair {
  unit: 'pair';
  state: FleetFuelNumberRepairUnitState;
  records: readonly RepairPairRecord[];
  rows: PlannedRow[];
  writes: PairWrite[];
}

export type PlannedUnit = PlannedCycle | PlannedPair;

export const last4 = (number: string): string => number.replace(/\D/gu, '').slice(-4);
const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/** Every number the definition names, with the byte size of its go-live photo. */
const GO_LIVE_PHOTO_BYTES = new Map<string, number>([
  ...REPAIR_RECORDS.map((r) => [r.before.number, r.before.photoBytes] as const),
  ...REPAIR_PAIR.map((p) => [p.number, p.photoBytes] as const),
]);

/** The number whose go-live photo `image` is, among the definition's; `null` otherwise. */
export const goLivePhotoNumber = (image: RepairLiveCard['image']): string | null => {
  if (image === null) return null;
  const stem = /^(\d{12,19})\.jpg$/u.exec(image.fileName)?.[1];
  if (stem === undefined) return null;
  return GO_LIVE_PHOTO_BYTES.get(stem) === image.size ? stem : null;
};

/** The live Wataniya card holding `number` under `name` — the owner's facts; the car is the lookup. */
const reads = (card: RepairLiveCard, name: string, number: string): boolean =>
  card.company === 'wataniya' && card.number === number && card.name === name;

/** How `card` (or its absence) differs from what the owner reviewed: car, number, name. */
const changesFrom = (
  car: string,
  card: RepairLiveCard | null,
  name: string,
  number: string,
  world: RepairWorld,
): PlannedChange[] => {
  if (card === null) {
    // The card itself is elsewhere (another car, or none) — or gone.
    const moved = world.byNumber.get(number);
    return moved === undefined
      ? [{ field: 'missing', expected: car, now: null }]
      : [{ field: 'vehicle', expected: car, now: moved.vehicleCode ?? moved.label }];
  }
  const changes: PlannedChange[] = [];
  if (card.number !== number) {
    changes.push({ field: 'number', expected: last4(number), now: last4(card.number) });
  }
  if (card.name !== name) changes.push({ field: 'name', expected: name, now: card.name });
  return changes;
};

/** Every live card of the world, by id — where a repaired record's card is, whatever car it is on. */
const cardsById = (world: RepairWorld): Map<string, RepairLiveCard> =>
  new Map([...world.byCar.values(), ...world.byNumber.values()].map((card) => [card.id, card]));

/**
 * The card a row shows: once its line is written, the card the line is on (when it is still live
 * and in the world); otherwise — or when it is gone — the live card on the record's car today.
 */
const shownCard = (
  line: RepairLine | null,
  onCar: RepairLiveCard | null,
  byId: ReadonlyMap<string, RepairLiveCard>,
): RepairLiveCard | null => (line === null ? onCar : (byId.get(line.cardId) ?? onCar));

/** One cycle: its rows' states and, when ready, its writes. */
export const planCycle = (
  unit: FleetFuelNumberRepairCycleUnit,
  world: RepairWorld,
): PlannedCycle => {
  const records = recordsOf(unit);
  const unitLines = world.lines.filter((line) => line.unit === unit);
  const rows = records.map((record) => {
    const card = world.byCar.get(record.car) ?? null;
    return {
      record,
      card,
      readsBefore: card !== null && reads(card, record.name, record.before.number),
      readsAfter: card !== null && reads(card, record.name, record.after.number),
      line: unitLines.find((line) => line.numberAfter === record.after.number) ?? null,
    };
  });
  const state: FleetFuelNumberRepairUnitState =
    rows.every((row) => row.line !== null) || rows.every((row) => row.readsAfter)
      ? 'done'
      : unitLines.length === 0 && rows.every((row) => row.readsBefore)
        ? 'ready'
        : 'held';
  const byId = cardsById(world);
  const planned: PlannedRow[] = rows.map((row) => {
    const rowState: FleetFuelNumberRepairRowState =
      state === 'done' ? 'done' : state === 'ready' ? 'ok' : row.readsBefore ? 'held' : 'changed';
    return {
      car: row.record.car,
      card: state === 'done' ? shownCard(row.line, row.card, byId) : row.card,
      readsBefore: row.readsBefore,
      readsAfter: row.readsAfter,
      state: rowState,
      changes:
        rowState === 'changed'
          ? changesFrom(row.record.car, row.card, row.record.name, row.record.before.number, world)
          : [],
      line: row.line,
    };
  });
  const writes: CycleWrite[] =
    state !== 'ready'
      ? []
      : rows.map((row, i) => {
          const card = row.card as RepairLiveCard;
          const donor = rows[(i - 1 + rows.length) % rows.length]?.card as RepairLiveCard;
          return {
            cardId: card.id,
            version: card.version,
            car: row.record.car,
            numberBefore: row.record.before.number,
            numberAfter: row.record.after.number,
            takeFrom: donor.id,
            expiryBefore: card.expiresAt,
            expiryAfter: donor.expiresAt,
            balance: card.balance,
          };
        });
  return { unit, state, records, rows: planned, writes };
};

/** The 0849 pair: both records or neither. */
export const planPair = (world: RepairWorld): PlannedPair => {
  const pairLines = world.lines.filter((line) => line.unit === 'pair');
  const rows = REPAIR_PAIR.map((record) => {
    const card = world.byCar.get(record.car) ?? null;
    return {
      record,
      card,
      readsBefore: card !== null && reads(card, record.nameBefore, record.number),
      readsAfter: card !== null && reads(card, record.nameAfter, record.number),
      line: pairLines.find((line) => line.nameAfter === record.nameAfter) ?? null,
    };
  });
  // Its two lines are written in one transaction: both there — the pair ran, wherever its cards
  // are now. One line alone is never «ready»: the pair is never applied twice.
  const state: FleetFuelNumberRepairUnitState = rows.every((row) => row.line !== null)
    ? 'done'
    : pairLines.length === 0 && rows.every((row) => row.readsBefore)
      ? 'ready'
      : 'held';
  const byId = cardsById(world);
  const planned: PlannedRow[] = rows.map((row) => {
    const waits = row.readsBefore && row.line === null;
    const rowState: FleetFuelNumberRepairRowState =
      state === 'done' ? 'done' : state === 'ready' ? 'ok' : waits ? 'held' : 'changed';
    const changes =
      rowState !== 'changed'
        ? []
        : [
            ...(row.readsBefore
              ? []
              : changesFrom(
                  row.record.car,
                  row.card,
                  row.record.nameBefore,
                  row.record.number,
                  world,
                )),
            // Swapped without the repair's line, or the line without the swap: the balances
            // cannot be known to be right.
            ...((row.readsAfter && row.line === null) || (row.readsBefore && row.line !== null)
              ? [
                  {
                    field: 'repairLine' as const,
                    expected: yesNo(!row.readsBefore),
                    now: yesNo(row.line !== null),
                  },
                ]
              : []),
          ];
    return {
      car: row.record.car,
      card: state === 'done' ? shownCard(row.line, row.card, byId) : row.card,
      readsBefore: row.readsBefore,
      readsAfter: row.readsAfter,
      state: rowState,
      changes,
      line: row.line,
    };
  });
  const writes: PairWrite[] =
    state !== 'ready'
      ? []
      : rows.map((row) => {
          const card = row.card as RepairLiveCard;
          return {
            cardId: card.id,
            version: card.version,
            car: row.record.car,
            nameBefore: row.record.nameBefore,
            nameAfter: row.record.nameAfter,
            openingBefore: row.record.openingBefore,
            openingAfter: row.record.openingAfter,
            delta: row.record.delta,
            balance: card.balance,
          };
        });
  return { unit: 'pair', state, records: REPAIR_PAIR, rows: planned, writes };
};

/** One unit by name. */
export const planUnit = (unit: FleetFuelNumberRepairUnit, world: RepairWorld): PlannedUnit =>
  unit === 'pair' ? planPair(world) : planCycle(unit, world);

/** The four units, in execution order. */
export const planRepair = (world: RepairWorld): { cycles: PlannedCycle[]; pair: PlannedPair } => ({
  cycles: (['C4', 'C5', 'C6'] as const).map((unit) => planCycle(unit, world)),
  pair: planPair(world),
});

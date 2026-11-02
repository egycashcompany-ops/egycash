// «تصحيح أرقام الكروت» (6d) — the PURE planner. Given the live cards on the definition's cars (no
// PIN value: only whether one is stored) and the repair's own `dataFix` lines, it says what each
// record reads, what each unit may do, and — for a ready unit — exactly what to write. The service
// reads and writes; every rule is here, pinned by `number-repair-plan.spec.ts`.
//
// A record reads «before» when it is exactly what the owner reviewed (number, name — compared with
// `===`, «S» and all —, car, expiry, the go-live photo of its number, PIN yes/no), and «after» when
// it is exactly what the repair leaves. A unit is fixed whole or not at all:
//   · done   — its `dataFix` lines are on every record (the repair ran: later edits — a PIN typed,
//              a photo replaced — never undo that), or, for a cycle only, every record reads «after»
//              (fixed by hand);
//   · ready  — every record reads «before» (the pair: and has no `dataFix` line);
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
  type RepairCardFacts,
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
  expiryBefore: string;
  expiryAfter: string;
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

const isPhotoOf = (image: RepairLiveCard['image'], facts: RepairCardFacts): boolean =>
  image !== null && image.fileName === `${facts.number}.jpg` && image.size === facts.photoBytes;

const reads = (card: RepairLiveCard, name: string, facts: RepairCardFacts): boolean =>
  card.company === 'wataniya' &&
  card.number === facts.number &&
  card.name === name &&
  card.expiresAt === facts.expiresAt &&
  card.hasPin === facts.hasPin &&
  isPhotoOf(card.image, facts);

/** How `card` (or its absence) differs from what the owner reviewed. */
const changesFrom = (
  car: string,
  card: RepairLiveCard | null,
  name: string,
  facts: RepairCardFacts,
  world: RepairWorld,
): PlannedChange[] => {
  if (card === null) {
    // The card itself is elsewhere (another car, or none) — or gone.
    const moved = world.byNumber.get(facts.number);
    return moved === undefined
      ? [{ field: 'missing', expected: car, now: null }]
      : [{ field: 'vehicle', expected: car, now: moved.vehicleCode ?? moved.label }];
  }
  const changes: PlannedChange[] = [];
  if (card.number !== facts.number) {
    changes.push({ field: 'number', expected: last4(facts.number), now: last4(card.number) });
  }
  if (card.name !== name) changes.push({ field: 'name', expected: name, now: card.name });
  if (card.expiresAt !== facts.expiresAt) {
    changes.push({ field: 'expiry', expected: facts.expiresAt, now: card.expiresAt });
  }
  if (!isPhotoOf(card.image, facts)) {
    const shown = goLivePhotoNumber(card.image);
    changes.push({
      field: 'photo',
      expected: last4(facts.number),
      now: card.image === null ? null : shown === null ? 'other' : last4(shown),
    });
  }
  if (card.hasPin !== facts.hasPin) {
    changes.push({ field: 'pin', expected: yesNo(facts.hasPin), now: yesNo(card.hasPin) });
  }
  return changes;
};

const lineOf = (
  world: RepairWorld,
  unit: FleetFuelNumberRepairUnit,
  card: RepairLiveCard | null,
): RepairLine | null =>
  card === null
    ? null
    : (world.lines.find((line) => line.unit === unit && line.cardId === card.id) ?? null);

/** One cycle: its rows' states and, when ready, its writes. */
export const planCycle = (
  unit: FleetFuelNumberRepairCycleUnit,
  world: RepairWorld,
): PlannedCycle => {
  const records = recordsOf(unit);
  const rows = records.map((record) => {
    const card = world.byCar.get(record.car) ?? null;
    return {
      record,
      card,
      readsBefore: card !== null && reads(card, record.name, record.before),
      readsAfter: card !== null && reads(card, record.name, record.after),
      line: lineOf(world, unit, card),
    };
  });
  const state: FleetFuelNumberRepairUnitState =
    rows.every((row) => row.line !== null) || rows.every((row) => row.readsAfter)
      ? 'done'
      : rows.every((row) => row.readsBefore)
        ? 'ready'
        : 'held';
  const planned: PlannedRow[] = rows.map((row) => {
    const rowState: FleetFuelNumberRepairRowState =
      state === 'done' ? 'done' : state === 'ready' ? 'ok' : row.readsBefore ? 'held' : 'changed';
    return {
      car: row.record.car,
      card: row.card,
      readsBefore: row.readsBefore,
      readsAfter: row.readsAfter,
      state: rowState,
      changes:
        rowState === 'changed'
          ? changesFrom(row.record.car, row.card, row.record.name, row.record.before, world)
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
            expiryBefore: row.record.before.expiresAt,
            expiryAfter: row.record.after.expiresAt,
            balance: card.balance,
          };
        });
  return { unit, state, records, rows: planned, writes };
};

const pairFacts = (record: RepairPairRecord): RepairCardFacts => ({
  number: record.number,
  expiresAt: record.expiresAt,
  hasPin: record.hasPin,
  photoBytes: record.photoBytes,
});

/** The 0849 pair: both records or neither. */
export const planPair = (world: RepairWorld): PlannedPair => {
  const rows = REPAIR_PAIR.map((record) => {
    const card = world.byCar.get(record.car) ?? null;
    const facts = pairFacts(record);
    return {
      record,
      card,
      readsBefore: card !== null && reads(card, record.nameBefore, facts),
      readsAfter: card !== null && reads(card, record.nameAfter, facts),
      line: lineOf(world, 'pair', card),
    };
  });
  const anyLine = world.lines.some((line) => line.unit === 'pair');
  const state: FleetFuelNumberRepairUnitState = rows.every((row) => row.line !== null)
    ? 'done'
    : !anyLine && rows.every((row) => row.readsBefore)
      ? 'ready'
      : 'held';
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
                  pairFacts(row.record),
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
      card: row.card,
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

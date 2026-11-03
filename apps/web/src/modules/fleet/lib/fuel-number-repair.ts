// «تصحيح أرقام الكروت» (6d) — the screen's pure half: which units are ready, held or done, what the
// owner's «تأكيد التنفيذ ✓» sends, what each row says about a record changed by hand, and which log
// lines came before the repair. Nothing here touches React or the network; every rule is pinned by
// `fuel-number-repair.spec.ts`.
//
// The server decides every state (`GET /fleet/fuel-cards/number-repair` is a live dry run): a unit
// is `ready` (every record reads the reviewed «before»), `held` (a record changed by hand — it is
// never touched, and its whole cycle waits with it) or `done`. The screen only reads those states;
// it never guesses one. A card number is only ever its printed start and last four, and a PIN is
// never in the dry run at all — only whether one is stored (yes/no).
import {
  type ExecuteFleetFuelNumberRepair,
  type FleetFuelCardMovementDto,
  type FleetFuelNumberRepairChangeDto,
  type FleetFuelNumberRepairCycleDto,
  type FleetFuelNumberRepairDto,
  type FleetFuelNumberRepairResultDto,
  type FleetFuelNumberRepairUnit,
  type FleetFuelNumberRepairUnitState,
} from '@ecms/contracts';

/** The repair's own screen, under «مطابقة أرصدة الكروت». */
export const NUMBER_REPAIR_PATH = '/fleet/fuel-cards/reconcile/numbers';
/** «مطابقة أرصدة الكروت» — where the repair is reached from, and where its next step is. */
export const RECONCILE_PATH = '/fleet/fuel-cards/reconcile';
/**
 * «سجل التدقيق», filtered to the repair's rows: every repaired card has one audit row with the
 * action `correct` on the fleet's `fuelCard` entity.
 */
export const REPAIR_AUDIT_PATH = '/system/audit?moduleId=fleet&entityType=fuelCard&action=correct';

/**
 * Moving a number, its PIN, photo and expiry is a card edit; the pair's ±11,872.62 is money — so
 * «تنفيذ التصحيح» needs both grants on one reader (the server checks the same two).
 */
export const EXECUTE_GRANTS = ['fleetFuelCard.edit', 'fleetFuelCharge.approve'] as const;
export const mayExecute = (can: (permission: string) => boolean): boolean =>
  EXECUTE_GRANTS.every((grant) => can(grant));

/** At least one of the 17 records has its live card — a database without them shows nothing. */
export const hasAnyCard = (repair: FleetFuelNumberRepairDto): boolean =>
  repair.cycles.some((cycle) => cycle.rows.some((row) => row.cardId !== null)) ||
  repair.pair.rows.some((row) => row.cardId !== null);

/**
 * The yellow box on «مطابقة أرصدة الكروت»: while the repair is not done, and only where its cards
 * exist (a development database without the 17 cards reads every unit held, «pending» for ever).
 */
export const entryShows = (repair: FleetFuelNumberRepairDto | undefined): boolean =>
  repair !== undefined && repair.state !== 'done' && hasAnyCard(repair);

/** A unit's state as the dry run reads it. */
export const unitStateOf = (
  repair: FleetFuelNumberRepairDto,
  unit: FleetFuelNumberRepairUnit,
): FleetFuelNumberRepairUnitState =>
  unit === 'pair'
    ? repair.pair.state
    : (repair.cycles.find((cycle) => cycle.unit === unit)?.state ?? 'held');

/** How many records a unit holds — a cycle's rows, the pair's two. */
export const recordsOf = (
  repair: FleetFuelNumberRepairDto,
  unit: FleetFuelNumberRepairUnit,
): number =>
  unit === 'pair'
    ? repair.pair.rows.length
    : (repair.cycles.find((cycle) => cycle.unit === unit)?.rows.length ?? 0);

/** The cycles that are ready now, in the dry run's order. */
export const readyCyclesOf = (repair: FleetFuelNumberRepairDto): FleetFuelNumberRepairCycleDto[] =>
  repair.cycles.filter((cycle) => cycle.state === 'ready');

/** The cars of a unit's records that changed by hand («تغيّر — لن يُلمس»). */
export const changedCarsOf = (rows: readonly { car: string; state: string }[]): string[] =>
  rows.filter((row) => row.state === 'changed').map((row) => row.car);

/** A held unit: which, the cars that changed in it, and how many records wait with them. */
export interface HeldUnit {
  unit: FleetFuelNumberRepairUnit;
  /** The cycle's «دائرة N»; `null` for the pair. */
  n: 1 | 2 | 3 | null;
  changed: string[];
  records: number;
}
export const heldUnitsOf = (repair: FleetFuelNumberRepairDto): HeldUnit[] => [
  ...repair.cycles
    .filter((cycle) => cycle.state === 'held')
    .map((cycle) => ({
      unit: cycle.unit,
      n: cycle.n,
      changed: changedCarsOf(cycle.rows),
      records: cycle.rows.length,
    })),
  ...(repair.pair.state === 'held'
    ? [
        {
          unit: 'pair' as const,
          n: null,
          changed: changedCarsOf(repair.pair.rows),
          records: repair.pair.rows.length,
        },
      ]
    : []),
];

/**
 * «تأكيد التنفيذ ✓» sends the ready units the reviewed dry run showed, in execution order — and
 * only once «راجعتُ الصفوف» is ticked. `null`: nothing may be sent yet.
 */
export const executeBodyOf = (
  repair: FleetFuelNumberRepairDto,
  reviewed: boolean,
): ExecuteFleetFuelNumberRepair | null =>
  !reviewed || repair.readyUnits.length === 0
    ? null
    : { reviewed: true, units: [...repair.readyUnits] };

/** The records the execution wrote — the units it executed, counted in records. */
export const executedRecordsOf = (result: FleetFuelNumberRepairResultDto): number =>
  result.executed.reduce((sum, unit) => sum + recordsOf(result.repair, unit), 0);

/** The receivers left without a PIN among the READY cycles — what the confirmation names. */
export const noPinReadyOf = (repair: FleetFuelNumberRepairDto): string[] =>
  readyCyclesOf(repair).flatMap((cycle) =>
    cycle.rows.filter((row) => !row.pinAfter).map((row) => row.car),
  );

/** The expiry moves with the number to a different date; equal reads «التاريخ نفسه». */
export const expiryMoves = (row: { expiryBefore: string; expiryAfter: string }): boolean =>
  row.expiryBefore.slice(0, 10) !== row.expiryAfter.slice(0, 10);

/** To the piastre. */
const piastres = (value: number): number => Math.round(value * 100);
/** The pair row whose go-live statement figure differs from its new opening («بديل»). */
export const statementDiffers = (row: {
  statementOpening: number;
  openingAfter: number;
}): boolean => piastres(row.statementOpening) !== piastres(row.openingAfter);
/**
 * The pair's balance before and after: while pending, the live balance and the live balance with
 * the opening's difference; once done, the live balance is the «after», and before is it less the
 * difference.
 */
export const pairBalancesOf = (
  row: { balance: number | null; balanceAfter: number | null; delta: number },
  done: boolean,
): { before: number | null; after: number | null } =>
  done
    ? {
        before:
          row.balanceAfter === null
            ? null
            : (piastres(row.balanceAfter) - piastres(row.delta)) / 100,
        after: row.balanceAfter,
      }
    : { before: row.balance, after: row.balanceAfter };

// ── A record changed by hand ────────────────────────────────────────────────────────────────────

/** What a change's «expected» / «now» is, so the screen writes it in its own form. */
export type ChangeShown =
  | { kind: 'number'; last4: string }
  | { kind: 'date'; day: string }
  | { kind: 'text'; text: string }
  | { kind: 'pin'; stored: boolean }
  | { kind: 'photo'; last4: string }
  | { kind: 'photoOther' }
  | { kind: 'none' };

/** One side of a change, by its field: a last four, a day, a name or a car, yes/no, a photo. */
export const changeShown = (
  field: FleetFuelNumberRepairChangeDto['field'],
  value: string | null,
): ChangeShown => {
  if (value === null) return { kind: 'none' };
  switch (field) {
    case 'number':
      return { kind: 'number', last4: value.slice(-4) };
    case 'expiry':
      return { kind: 'date', day: value.slice(0, 10) };
    case 'pin':
      return { kind: 'pin', stored: value === 'yes' };
    case 'photo':
      return value === 'other' ? { kind: 'photoOther' } : { kind: 'photo', last4: value.slice(-4) };
    default:
      return { kind: 'text', text: value };
  }
};

/** The change that explains a changed expiry, when it is one. */
export const expiryChangeOf = (
  changes: readonly FleetFuelNumberRepairChangeDto[],
): FleetFuelNumberRepairChangeDto | undefined =>
  changes.find((change) => change.field === 'expiry');

// ── The card's log ──────────────────────────────────────────────────────────────────────────────

/** When the card's `dataFix` line was written — the newest, should there be more; `null` without. */
export const repairLineAtOf = (lines: readonly FleetFuelCardMovementDto[]): number | null => {
  const times = lines
    .filter((line) => line.kind === 'dataFix')
    .map((line) => Date.parse(line.at))
    .filter((at) => !Number.isNaN(at));
  return times.length === 0 ? null : Math.max(...times);
};

/** «سُجِّلت قبل التصحيح»: a line older than the card's `dataFix` line (only on a card that has one). */
export const beforeRepair = (line: FleetFuelCardMovementDto, fixedAt: number | null): boolean =>
  fixedAt !== null && line.kind !== 'dataFix' && Date.parse(line.at) < fixedAt;

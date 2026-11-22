// «تعديل الجهاز» — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم» (owner, 2026-11-17): the
// device an ISSUED unit sits in, corrected on the ledger after the issue. Asked what the printed memo
// does, the owner chose «تتحدّث بالجهاز الجديد»: a reprint prints the new device, the change is
// recorded (who, when, from which device to which), and the signed copy already filed stays as it is.
//
// The dialog's state and every decision it makes, as pure functions — so each is proven without a
// browser, and the dialog (`components/ConsumableInstalledOnDialog.tsx`) only wires them:
//   · WHO IS OFFERED IT. Only an `issued` row has a device; the action rides the issue's own grant
//     (`itConsumable.assign`) and, since its box searches the register of devices, the reader's
//     `itAsset.view` — the same two the issue's «مركّب على» needs. The server judges both again.
//   · WHAT IS CHOSEN. A device (from the recipient's own devices, or «جهاز آخر» — the whole register),
//     or «بدون جهاز». Choosing one undoes the other. Nothing is chosen for the user: the dialog opens
//     with the current device shown above, and the box empty.
//   · WHAT IS SENT. Only a change: nothing chosen yet, or the very device the row already names, sends
//     nothing. The row's `version` rides along, so a change somebody made first is a 409 rather than
//     overwritten.
//   · WHAT A REFUSAL SAYS. A 409 is said in the dialog's own words — somebody changed the row first,
//     and the ledger is read again under it; anything else is the platform's own wording of the
//     server's answer. The version a 409 refused is remembered past any change of choice: while the
//     row the dialog shows is still at that version (the re-read could not show it — it left the
//     list), another save is certain to be refused, so none is offered.
//   · A COUNTED ISSUE (2026-11-19, «عداد الطابعة»). A toner issued with the printer's counter reading
//     carries it as part of that one fact: it moves with the device, so another device takes a new
//     reading (required); the same device with a new reading corrects it — typing a reading with no
//     device picked means that; and «بدون جهاز» takes the reading off with the device. The rule
//     follows the ROW (`counterReading` not null), never the type's flag as it stands now: a row
//     recorded without a reading takes none afterwards, and offers no box for one. The server
//     places the reading on its printer's timeline; its refusal is said on the reading's box.
import {
  type ItAssetDto,
  type ItConsumableMovementDto,
  type Locale,
  type SetItConsumableInstalledOn,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { counterFailures, counterValue, type CounterProblem } from './consumable-counter';
import { assetHolderKey, departmentKey } from './consumable-issue-holder';

/** The two grants «تعديل الجهاز» needs: the issue's own, and the register of devices its box searches. */
export const INSTALLED_ON_GRANTS = ['itConsumable.assign', 'itAsset.view'] as const;

/** Whether this reader is offered «تعديل الجهاز» at all — the ledger draws its column only then. */
export const mayChangeDevices = (can: (permission: string) => boolean): boolean =>
  INSTALLED_ON_GRANTS.every((permission) => can(permission));

/** Whether ONE row offers it: only an issued unit sits in a device. */
export const mayChangeInstalledOn = (
  movement: Pick<ItConsumableMovementDto, 'kind'>,
  can: (permission: string) => boolean,
): boolean => movement.kind === 'issued' && mayChangeDevices(can);

/**
 * Why the last save was refused: somebody changed the row first, the printer's counter refused the
 * reading (said on its box), or what the server said.
 */
export type InstalledOnFailure =
  | { kind: 'conflict' }
  | { kind: 'counter'; problem: CounterProblem }
  | { kind: 'refused'; message: string };

export interface InstalledOnState {
  /** The device picked, '' while none is. */
  assetId: string;
  /** That device as the picker offered it, its holder with it; null when none is picked. */
  asset: ItAssetDto | null;
  /** «بدون جهاز» — the unit is to be recorded as installed on no device. */
  none: boolean;
  /** «قراءة عداد الطابعة» as typed — a counted issue only; '' while none is. */
  counterReading: string;
  /** «تم تصفير عداد الطابعة» on that reading. */
  counterReset: boolean;
  /** The last save's refusal; null before any, and again once the choice changes. */
  failure: InstalledOnFailure | null;
  /** The version a 409 refused — kept when the choice changes, forgotten only when it reopens. */
  refusedVersion: number | null;
}

export type InstalledOnEvent =
  /** The box's pick — '' with no asset when its chip is cleared. */
  | { type: 'device'; assetId: string; asset: ItAssetDto | null }
  /** «بدون جهاز» ticked or unticked. */
  | { type: 'none'; none: boolean }
  /** The reading box or its reset tick. */
  | { type: 'counter'; counterReading: string; counterReset: boolean }
  /** The save was refused — `version` is the one the request carried. */
  | { type: 'failed'; failure: InstalledOnFailure; version: number }
  /** The dialog opened again: nothing chosen. */
  | { type: 'reset' };

/** The dialog as it opens: the box empty, nothing ticked, nothing typed, nothing refused. */
export const installedOnStart = (): InstalledOnState => ({
  assetId: '',
  asset: null,
  none: false,
  counterReading: '',
  counterReset: false,
  failure: null,
  refusedVersion: null,
});

export const installedOnReducer = (
  state: InstalledOnState,
  event: InstalledOnEvent,
): InstalledOnState => {
  switch (event.type) {
    case 'device': {
      // A device picked is a device chosen: «بدون جهاز» goes. A cleared chip leaves it as it was.
      // A reading belongs to the printer it was read on: another device starts the box again.
      const moved = event.assetId !== state.assetId;
      return {
        assetId: event.assetId,
        asset: event.assetId === '' ? null : event.asset,
        none: event.assetId === '' ? state.none : false,
        counterReading: moved ? '' : state.counterReading,
        counterReset: moved ? false : state.counterReset,
        failure: null,
        refusedVersion: state.refusedVersion,
      };
    }
    case 'none':
      // «بدون جهاز» empties the box, and takes the reading off with the device.
      return event.none
        ? {
            assetId: '',
            asset: null,
            none: true,
            counterReading: '',
            counterReset: false,
            failure: null,
            refusedVersion: state.refusedVersion,
          }
        : { ...state, none: false, failure: null };
    case 'counter':
      return {
        ...state,
        counterReading: event.counterReading,
        counterReset: event.counterReset,
        failure: null,
      };
    case 'failed':
      return {
        ...state,
        failure: event.failure,
        refusedVersion: event.failure.kind === 'conflict' ? event.version : state.refusedVersion,
      };
    case 'reset':
      return installedOnStart();
  }
};

/** The row's facts the counter's rules read. */
type CounterRow = Pick<ItConsumableMovementDto, 'assetId' | 'counterReading' | 'counterReset'>;

/** Whether the row was issued with the printer's counter — and so moves with a reading. */
export const installedOnCounted = (
  movement: Pick<ItConsumableMovementDto, 'counterReading'>,
): boolean => movement.counterReading !== null;

/**
 * The device the choice names: an id, null for «بدون جهاز», or undefined while nothing is chosen.
 * On a counted row, a reading typed with no device picked names the device the row is on: it
 * corrects the reading taken there.
 */
export const installedOnTarget = (
  state: Pick<InstalledOnState, 'assetId' | 'none'> &
    Partial<Pick<InstalledOnState, 'counterReading'>>,
  movement?: CounterRow,
): string | null | undefined => {
  if (state.none) return null;
  if (state.assetId !== '') return state.assetId;
  const typed = (state.counterReading ?? '').trim() !== '';
  return movement !== undefined && installedOnCounted(movement) && typed
    ? (movement.assetId ?? undefined)
    : undefined;
};

/**
 * Whether the choice is what the row already says — a save that would change nothing: the device it
 * names and, on a counted row, the reading and reset it carries (or no reading typed at all).
 */
export const installedOnUnchanged = (
  movement: CounterRow,
  state: Pick<InstalledOnState, 'assetId' | 'none' | 'counterReading' | 'counterReset'>,
): boolean => {
  const target = installedOnTarget(state, movement);
  if (target !== movement.assetId) return false;
  if (!installedOnCounted(movement) || target === null) return true;
  const typed = state.counterReading.trim();
  return (
    typed === '' ||
    (counterValue(typed) === movement.counterReading &&
      state.counterReset === movement.counterReset)
  );
};

/**
 * The PATCH body for the choice, or null when there is nothing to send: nothing chosen yet, or what
 * the row already says — or, on a counted row moving to a device, no valid reading yet (the box
 * says why). The row's own `version` rides along; a row recorded without a reading sends none.
 */
export const installedOnRequest = (
  movement: CounterRow & Pick<ItConsumableMovementDto, 'version'>,
  state: Pick<InstalledOnState, 'assetId' | 'none' | 'counterReading' | 'counterReset'>,
): SetItConsumableInstalledOn | null => {
  const target = installedOnTarget(state, movement);
  if (target === undefined || installedOnUnchanged(movement, state)) return null;
  if (!installedOnCounted(movement) || target === null) {
    return { assetId: target, version: movement.version };
  }
  const reading = counterValue(state.counterReading);
  if (Number.isNaN(reading)) return null;
  return {
    assetId: target,
    counterReading: reading,
    ...(state.counterReset ? { counterReset: true } : {}),
    version: movement.version,
  };
};

/**
 * What the reading box says before any save, on a counted row moving to a device: a reading that is
 * not a whole number in range. An empty box says nothing — its asterisk does, and the save waits.
 */
export const installedOnReadingProblem = (
  movement: CounterRow,
  state: Pick<InstalledOnState, 'assetId' | 'none' | 'counterReading'>,
): CounterProblem | null => {
  if (!installedOnCounted(movement) || state.none) return null;
  const typed = state.counterReading.trim();
  return typed !== '' && Number.isNaN(counterValue(typed)) ? { kind: 'readingInvalid' } : null;
};

/**
 * Whether the row as the dialog shows it is at a version a 409 already refused — so any save from
 * here is certain to be refused again. A re-read that still lists the row brings its new version and
 * ends this; a row that has left the list keeps the one refused.
 */
export const installedOnStale = (
  movement: Pick<ItConsumableMovementDto, 'version'>,
  state: Pick<InstalledOnState, 'refusedVersion'>,
): boolean => state.refusedVersion !== null && state.refusedVersion === movement.version;

/**
 * Who an issue went to, as the custodian key the holder rules compare: the employee's id, or — an
 * issue to a department (2026-11-19) — the department at its place.
 */
export const recipientKey = (
  movement: Pick<ItConsumableMovementDto, 'employeeId'> &
    Partial<Pick<ItConsumableMovementDto, 'departmentId' | 'locationId'>>,
): string =>
  (movement.departmentId ?? null) === null
    ? (movement.employeeId ?? '')
    : departmentKey(movement.departmentId ?? '', movement.locationId ?? '');

/**
 * A device somebody other than the recipient holds — picked through «جهاز آخر» (a shared printer, a
 * colleague's screen) — so the dialog can say whose it is. Null for the recipient's own device (the
 * person's, or the department's at its place), a device in stock, or nothing picked.
 */
export const pickedHeldByOther = (
  movement: Pick<ItConsumableMovementDto, 'employeeId'> &
    Partial<Pick<ItConsumableMovementDto, 'departmentId' | 'locationId'>>,
  state: Pick<InstalledOnState, 'assetId' | 'asset'>,
): NonNullable<ItAssetDto['holder']> | null => {
  const holder = state.asset?.holder ?? null;
  if (state.assetId === '' || holder === null) return null;
  return assetHolderKey(holder) === recipientKey(movement) ? null : holder;
};

/**
 * A refusal, read: a 409 is somebody's change first; a refusal of the printer's counter is said on
 * the reading's box, with the reading it was held against; anything else, the server's answer
 * worded.
 */
export const installedOnFailure = (error: unknown, locale: Locale): InstalledOnFailure => {
  if (error instanceof ApiError && error.status === 409) return { kind: 'conflict' };
  const [counter] = counterFailures(error);
  return counter === undefined
    ? { kind: 'refused', message: errorMessage(error, locale) }
    : { kind: 'counter', problem: counter.problem };
};

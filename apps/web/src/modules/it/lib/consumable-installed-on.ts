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
import {
  type ItAssetDto,
  type ItConsumableMovementDto,
  type Locale,
  type SetItConsumableInstalledOn,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';

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

/** Why the last save was refused: somebody changed the row first, or what the server said. */
export type InstalledOnFailure = { kind: 'conflict' } | { kind: 'refused'; message: string };

export interface InstalledOnState {
  /** The device picked, '' while none is. */
  assetId: string;
  /** That device as the picker offered it, its holder with it; null when none is picked. */
  asset: ItAssetDto | null;
  /** «بدون جهاز» — the unit is to be recorded as installed on no device. */
  none: boolean;
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
  /** The save was refused — `version` is the one the request carried. */
  | { type: 'failed'; failure: InstalledOnFailure; version: number }
  /** The dialog opened again: nothing chosen. */
  | { type: 'reset' };

/** The dialog as it opens: the box empty, nothing ticked, nothing refused. */
export const installedOnStart = (): InstalledOnState => ({
  assetId: '',
  asset: null,
  none: false,
  failure: null,
  refusedVersion: null,
});

export const installedOnReducer = (
  state: InstalledOnState,
  event: InstalledOnEvent,
): InstalledOnState => {
  switch (event.type) {
    case 'device':
      // A device picked is a device chosen: «بدون جهاز» goes. A cleared chip leaves it as it was.
      return {
        assetId: event.assetId,
        asset: event.assetId === '' ? null : event.asset,
        none: event.assetId === '' ? state.none : false,
        failure: null,
        refusedVersion: state.refusedVersion,
      };
    case 'none':
      // «بدون جهاز» empties the box, so the two never stand together.
      return event.none
        ? {
            assetId: '',
            asset: null,
            none: true,
            failure: null,
            refusedVersion: state.refusedVersion,
          }
        : { ...state, none: false, failure: null };
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

/**
 * The device the choice names: an id, null for «بدون جهاز», or undefined while nothing is chosen.
 */
export const installedOnTarget = (
  state: Pick<InstalledOnState, 'assetId' | 'none'>,
): string | null | undefined =>
  state.none ? null : state.assetId === '' ? undefined : state.assetId;

/** Whether the choice is the device the row already names — a save that would change nothing. */
export const installedOnUnchanged = (
  movement: Pick<ItConsumableMovementDto, 'assetId'>,
  state: Pick<InstalledOnState, 'assetId' | 'none'>,
): boolean => installedOnTarget(state) === movement.assetId;

/**
 * The PATCH body for the choice, or null when there is nothing to send: nothing chosen yet, or the
 * device the row already names. The row's own `version` rides along.
 */
export const installedOnRequest = (
  movement: Pick<ItConsumableMovementDto, 'assetId' | 'version'>,
  state: Pick<InstalledOnState, 'assetId' | 'none'>,
): SetItConsumableInstalledOn | null => {
  const target = installedOnTarget(state);
  if (target === undefined || target === movement.assetId) return null;
  return { assetId: target, version: movement.version };
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
 * A device somebody other than the recipient holds — picked through «جهاز آخر» (a shared printer, a
 * colleague's screen) — so the dialog can say whose it is. Null for the recipient's own device, a
 * device in stock, or nothing picked.
 */
export const pickedHeldByOther = (
  movement: Pick<ItConsumableMovementDto, 'employeeId'>,
  state: Pick<InstalledOnState, 'assetId' | 'asset'>,
): NonNullable<ItAssetDto['holder']> | null => {
  const holder = state.asset?.holder ?? null;
  if (state.assetId === '' || holder === null) return null;
  return holder.employeeId === movement.employeeId ? null : holder;
};

/** A refusal, read: a 409 is somebody's change first; anything else, the server's answer worded. */
export const installedOnFailure = (error: unknown, locale: Locale): InstalledOnFailure =>
  error instanceof ApiError && error.status === 409
    ? { kind: 'conflict' }
    : { kind: 'refused', message: errorMessage(error, locale) };

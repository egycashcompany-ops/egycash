// «نقل إلى فرع» — «عايز إمكانية نقل أصل أو مستهلك إلى فرع تاني» (2026-11-11): which of the assets
// picked on the register can go to the branch chosen, and why the others cannot.
//
// The server is the judge (`POST /it/assets/move-branch` refuses the whole request when any asset
// cannot move), so the screen leaves out exactly what it would refuse, says why beside each one,
// and sends the rest: a disposed asset is gone, one under maintenance moves when it comes back,
// and one already in the chosen branch has nowhere to go. An asset HELD by an employee moves too —
// «ينتقل مع عهدته»: its custody goes with it and the holder keeps it. No paper («لا، السجل كفاية»):
// the asset's history is the record.
import {
  IT_ASSET_MOVE_MAX,
  type ItAssetDto,
  type Locale,
  type MoveItAssetsToBranch,
} from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';
import { custodyPlural } from '../../fleet/lib/custody-words';
import { type Translate } from './register-export';

/** Why an asset stays where it is — each one the server refuses too. */
export const ASSET_MOVE_REFUSALS = ['disposed', 'underMaintenance', 'alreadyThere'] as const;
export type AssetMoveRefusal = (typeof ASSET_MOVE_REFUSALS)[number];

/** What the move does to one asset: it goes (with its custody when held), or it stays and why. */
export type AssetMoveEligibility =
  { movable: true; held: boolean } | { movable: false; reason: AssetMoveRefusal };

/** The facts the rule reads — what the register's row and the asset's page both carry. */
export type MovableAsset = Pick<ItAssetDto, 'id' | 'status' | 'branchId' | 'hasActiveMaintenance'>;

/**
 * One asset against the branch chosen. `toBranchId` empty is «not chosen yet»: only what no branch
 * could change (disposed, under maintenance) is refused before then.
 *
 * «Under maintenance» is the status OR an order still open or in progress: an `open` order (the
 * preventive sweep's among them) leaves the asset `inStock`, and the server refuses the move of
 * such an asset all the same — so the status alone does not say it.
 */
export const assetMoveEligibility = (
  asset: Pick<ItAssetDto, 'status' | 'branchId' | 'hasActiveMaintenance'>,
  toBranchId: string,
): AssetMoveEligibility => {
  if (asset.status === 'disposed') return { movable: false, reason: 'disposed' };
  if (asset.status === 'underMaintenance' || asset.hasActiveMaintenance) {
    return { movable: false, reason: 'underMaintenance' };
  }
  if (toBranchId !== '' && asset.branchId === toBranchId) {
    return { movable: false, reason: 'alreadyThere' };
  }
  return { movable: true, held: asset.status === 'assigned' };
};

export interface AssetMovePlan<T extends MovableAsset> {
  /** What the request carries, in the order the assets were picked. */
  movable: T[];
  /** What is left out, each with the reason the dialog shows beside it. */
  refused: { asset: T; reason: AssetMoveRefusal }[];
  /** Some asset that moves is held — the dialog says the custody goes with it. */
  anyHeld: boolean;
  /** More than one request may carry (`IT_ASSET_MOVE_MAX`). */
  tooMany: boolean;
}

/** The picked assets, split into what moves to `toBranchId` and what stays. */
export const assetMovePlan = <T extends MovableAsset>(
  assets: readonly T[],
  toBranchId: string,
): AssetMovePlan<T> => {
  const movable: T[] = [];
  const refused: { asset: T; reason: AssetMoveRefusal }[] = [];
  let anyHeld = false;
  for (const asset of assets) {
    const verdict = assetMoveEligibility(asset, toBranchId);
    if (verdict.movable) {
      movable.push(asset);
      if (verdict.held) anyHeld = true;
    } else {
      refused.push({ asset, reason: verdict.reason });
    }
  }
  return { movable, refused, anyHeld, tooMany: movable.length > IT_ASSET_MOVE_MAX };
};

/**
 * The branch every picked asset already sits in, or null when they sit in more than one. The
 * picker leaves it out: moving them all to where they all are is no move.
 */
export const sharedBranch = (assets: readonly Pick<ItAssetDto, 'branchId'>[]): string | null => {
  const first = assets[0]?.branchId;
  if (first === undefined) return null;
  return assets.every((asset) => asset.branchId === first) ? first : null;
};

/**
 * The request — null until it can be sent: a branch chosen, something to move, within the bound.
 * `at` is the dialog's `datetime-local` text (empty: the server stamps now); `notes` its box.
 */
export const assetMoveRequest = (
  plan: AssetMovePlan<MovableAsset>,
  toBranchId: string,
  at: string,
  notes: string,
): MoveItAssetsToBranch | null => {
  if (toBranchId === '' || plan.movable.length === 0 || plan.tooMany) return null;
  return {
    assetIds: plan.movable.map((asset) => asset.id),
    toBranchId,
    ...(at === '' ? {} : { at: new Date(at) }),
    ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
  };
};

/** «نُقل ٣ أصول إلى المهندسين» — the toast, in Arabic's five count forms. */
export const assetsMovedWords = (
  t: Translate,
  locale: Locale,
  count: number,
  branch: string,
): string =>
  t(`it.assets.move.moved.${custodyPlural(locale, count)}`, {
    count: formatNumber(count, locale),
    branch,
  });

// «نقل إلى فرع» — the rules of moving assets to another branch, pure (no database, no request):
// which asset may move, how a refusal reads, and what the move answers.
//
// «عايز إمكانية نقل أصل أو مستهلك إلى فرع تاني» (2026-11-11). Several assets at once, to ONE branch,
// at once — «فوراً», no «in transit» and nothing to confirm at the other end — and with no paper:
// «لا، السجل كفاية», the asset's history is the record. An asset in stock simply changes branch; one
// an employee holds moves WITH its custody — «ينتقل مع عهدته» — which is exactly custody's transfer
// to a new branch in the same hands (`custody.service.ts`). What may not move is what custody would
// refuse to move as well: a disposed asset (terminal, FR-4) and one under maintenance (the
// technician has it, design §2.7) — and one already in the branch chosen, which a move would not
// move at all; nor a held one dated before the custody it carries began, which custody's transfer
// refuses as well («the transfer cannot precede the assignment it closes»).
import {
  type ItAssetBranchMoveDto,
  type ItAssetsBranchMoveResultDto,
  type ItAssetStatus,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { keyReachesBranch, type AuthContext } from '../../../shared/types';

/** Why one asset does not move. */
export type AssetMoveRefusal = 'disposed' | 'underMaintenance' | 'alreadyThere' | 'beforeCustody';

/** The facts the rule reads off an asset — its state, its branch, and an open maintenance order. */
export interface AssetMoveCandidate {
  status: ItAssetStatus;
  branchId: string;
  /** An ACTIVE maintenance order holds it, whatever its status says (custody's IT-4 guard). */
  activeMaintenance: boolean;
  /**
   * When its holder received it — the OPEN interval's `assignedAt` — for one an employee holds;
   * null for one nobody does. The move closes that interval at its own date, which cannot come
   * first.
   */
  heldSince: Date | null;
}

/**
 * Whether one asset may move to `toBranchId` on `at`, and if not, why — in the order the reasons
 * outrank each other: a disposed asset is not there to move at all, one in the technician's hands
 * is not IT's to move today, then where it already is, and only then the date the move gives.
 */
export const assetMoveRefusal = (
  asset: AssetMoveCandidate,
  toBranchId: string,
  at: Date,
): AssetMoveRefusal | null => {
  if (asset.status === 'disposed') return 'disposed';
  if (asset.status === 'underMaintenance' || asset.activeMaintenance) return 'underMaintenance';
  if (asset.branchId === toBranchId) return 'alreadyThere';
  if (asset.heldSince !== null && at.getTime() < asset.heldSince.getTime()) return 'beforeCustody';
  return null;
};

const REFUSAL_TEXT: Record<AssetMoveRefusal, string> = {
  disposed: 'disposed; a disposed asset accepts no further operation (FR-4)',
  underMaintenance:
    'under maintenance; complete or cancel its maintenance order before you move it',
  alreadyThere: 'already in that branch',
  beforeCustody:
    "held only since after the move's date; the move cannot precede the assignment it closes",
};

const ORDER: readonly AssetMoveRefusal[] = [
  'disposed',
  'underMaintenance',
  'alreadyThere',
  'beforeCustody',
];

/**
 * The ONE refusal of a move that names every asset holding it back — not the first one found, so
 * the screen (and whoever reads the log) can see the whole list at once — or null when every asset
 * may move. A move is all or nothing, so a single refused asset refuses the request.
 *
 * Its status follows custody's: a maintenance order in hand is a conflict with the asset's state
 * (409, `assertNoActiveMaintenance`), a disposed asset, a branch it is already in or a date before
 * its custody began is a rule (422). When both kinds are in one request the rule wins: dropping the
 * asset that is under maintenance would still not let the request through.
 */
export const assetMoveRefusalError = (
  refused: readonly { assetCode: string; reason: AssetMoveRefusal }[],
): BusinessRuleError | ConflictError | null => {
  if (refused.length === 0) return null;
  const parts = ORDER.flatMap((reason) => {
    const codes = refused.filter((entry) => entry.reason === reason).map((e) => e.assetCode);
    if (codes.length === 0) return [];
    const subject =
      codes.length === 1 ? `asset ${codes[0] ?? ''} is` : `assets ${codes.join(', ')} are`;
    return [`${subject} ${REFUSAL_TEXT[reason]}`];
  });
  const message = `nothing was moved: ${parts.join('; ')}`;
  return refused.every((entry) => entry.reason === 'underMaintenance')
    ? new ConflictError(message)
    : new BusinessRuleError(message);
};

/**
 * What a move answers, asset by asset in the order the request named them: where each came from,
 * and who still holds it when it moved with its custody (null for one in stock).
 */
export const assetsBranchMoveResult = (
  toBranchId: string,
  moved: readonly ItAssetBranchMoveDto[],
): ItAssetsBranchMoveResultDto => ({
  toBranchId,
  moved: moved.map((entry) => ({
    assetId: entry.assetId,
    assetCode: entry.assetCode,
    fromBranchId: entry.fromBranchId,
    toBranchId: entry.toBranchId,
    holderEmployeeId: entry.holderEmployeeId,
  })),
});

/** A branch as the organisation lists it — its id, and whether it is live. */
export interface MoveTargetCandidate {
  id: string;
  status: 'active' | 'inactive';
}

/**
 * The branches the caller may move assets — and send consumables — to, in the order given: every
 * ACTIVE branch their `itAsset.assign` reaches as a whole, by the very test both actions apply
 * (`keyReachesBranch`) — so a picker built from it never offers a branch the move would answer
 * with 403, nor one it would refuse as inactive.
 *
 * Why the server says it: the account's `branchIds` are the reach of ALL its grants, so a client
 * judging by them offered branches this one grant does not reach — a `department`-scoped grant
 * (never a whole branch), or a `branch`-scoped one whose other grants reach further.
 */
export const moveTargetBranchIds = (
  ctx: AuthContext,
  branches: readonly MoveTargetCandidate[],
): string[] =>
  branches
    .filter(
      (branch) => branch.status === 'active' && keyReachesBranch(ctx, 'itAsset.assign', branch.id),
    )
    .map((branch) => branch.id);

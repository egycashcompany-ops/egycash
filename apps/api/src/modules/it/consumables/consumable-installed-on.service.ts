// «تعديل الجهاز» — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم» (owner, 2026-11-17): the
// device an issued unit sits in, corrected after the issue. Asked what the printed memo does, the
// owner chose «تتحدّث بالجهاز الجديد»: a reprint shows the new device, the change is recorded (who,
// when, from which device to which), and the signed copy already filed stays as it is.
//
// The ledger stays append-only for QUANTITIES: this is the one fact of a row that may be corrected,
// because it describes where the unit went and moves no counter (the movement model's header).
//
// The issue's own rules, because it is the issue's own field: gated on `itConsumable.assign`, the
// movement found within the caller's `itConsumable.view` (the store's read grant, as every custody
// write here is scoped); a device named within the caller's OWN `itAsset.view` — without that grant
// every asset id is «not found», so the store's grant is never a way to probe the register — and
// not disposed. Clearing it («بدون جهاز») needs no asset grant: it names no device.
//
// ONE transaction: the movement's device (and its version) and the memo line that is this movement,
// re-snapshotted from the register now. The assets are read BEFORE it, as the issue reads them —
// another module's data has no business holding a ledger write open. The audit rows (the item's and
// the memo's) and the refresh signals follow the commit, as every consumables write's do.
import { type SetItConsumableInstalledOn } from '@ecms/contracts';
import { BusinessRuleError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { itAssetRepository } from '../assets/asset.repository';
import { type ItAssetDoc } from '../assets/asset.model';
import { itConsumableMovementRepository, notAnIssue } from './consumable-movement.repository';
import { itConsumableMemoRepository } from './consumable-memo.repository';
import {
  change,
  consumableEntityRef,
  consumableMemoEntityRef,
  ensureItConsumableCollections,
  signalConsumable,
  signalConsumableMemo,
} from './consumable-history';
import { type ItConsumableMovementDoc } from './consumable-movement.model';
import { type ItConsumableMemoLineSub } from './consumable-memo.model';

/** What a memo line prints for its device — the audit's «from» and «to» on the paper's trail. */
type LineDevice = { assetId: string; assetCode: string | null; assetName: string | null } | null;

const lineDevice = (
  line: Pick<ItConsumableMemoLineSub, 'assetId' | 'assetCode' | 'assetName'>,
): LineDevice =>
  line.assetId == null
    ? null
    : {
        assetId: String(line.assetId),
        assetCode: line.assetCode ?? null,
        assetName: line.assetName ?? null,
      };

class ItConsumableInstalledOnService {
  /**
   * The device a caller may name: one their own `itAsset.view` shows them. No grant (`assetScope`
   * null) — the register is not asked, and every id is the same «not found» as one outside it.
   */
  private async readAsset(assetId: string, assetScope: ScopeSelector | null): Promise<ItAssetDoc> {
    const asset =
      assetScope === null ? null : await itAssetRepository.findById(assetId, assetScope);
    if (asset === null) throw new NotFoundError('asset not found');
    return asset;
  }

  /**
   * Set (or clear, with null) the device an issued movement's unit sits in. Answers the movement
   * as it now stands — as it was when nothing needed writing (the device it already names).
   *
   * Refused, in this order: a movement the caller cannot see, or a deleted one — 404; any kind but
   * `issued` — 422; a device outside the caller's `itAsset.view`, or any device without it — 404;
   * a version somebody else moved on — 409; a disposed device — 422. The same device as now is
   * answered 200 with nothing written, whatever version came with it: what was asked is what is.
   */
  async setInstalledOn(
    id: string,
    input: SetItConsumableInstalledOn,
    ctx: AuthContext,
    scope: ScopeSelector,
    assetScope: ScopeSelector | null,
  ): Promise<ItConsumableMovementDoc> {
    const movement = await itConsumableMovementRepository.findById(id, scope);
    if (movement === null) throw new NotFoundError('movement not found');
    if (movement.kind !== 'issued') throw notAnIssue(movement.kind);

    const asset = input.assetId === null ? null : await this.readAsset(input.assetId, assetScope);
    const from = movement.assetId == null ? null : String(movement.assetId);
    const to = asset === null ? null : String(asset._id);
    if (from === to) return movement;

    if (input.version !== movement.__v) throw new StaleDocumentError();
    if (asset !== null && asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed; nothing can be installed on it`,
      );
    }

    await ensureItConsumableCollections();
    const by = ctx.userId;
    const done = await unitOfWork(async (session) => {
      const updated = await itConsumableMovementRepository.setInstalledOn(
        id,
        asset === null ? null : asset._id,
        { version: input.version, previous: movement.assetId ?? null, scope, by, session },
      );
      // The paper's line — the issue's snapshot of the register, taken again now.
      const line =
        movement.memoId == null
          ? null
          : await itConsumableMemoRepository.setLineDevice(
              movement.memoId,
              movement._id,
              asset === null
                ? null
                : { assetId: asset._id, assetCode: asset.assetCode, assetName: asset.name },
              { by, session },
            );
      return { updated, line };
    });

    // After the commit: the item's trail, then the paper's — and the refresh of both topics, with
    // the store, so a branch-scoped reader's open ledger, card or memo reads again too.
    const movementId = String(movement._id);
    const consumableId = String(movement.consumableId);
    const branchId = String(movement.branchId);
    await auditService.record({
      entityRef: consumableEntityRef(consumableId),
      action: 'update',
      changes: [change('installedOn', from, to), change('movementId', null, movementId)],
    });
    signalConsumable(consumableId, branchId);
    if (done.line !== null && movement.memoId != null) {
      const memoId = String(movement.memoId);
      await auditService.record({
        entityRef: consumableMemoEntityRef(memoId),
        action: 'update',
        changes: [
          change(
            'installedOn',
            lineDevice(done.line),
            lineDevice({
              assetId: asset?._id ?? null,
              assetCode: asset?.assetCode ?? null,
              assetName: asset?.name ?? null,
            }),
          ),
          change('movementId', null, movementId),
        ],
      });
      signalConsumableMemo(memoId, branchId);
    }
    return done.updated;
  }
}

export const itConsumableInstalledOnService = new ItConsumableInstalledOnService();

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
//
// «عداد الطابعة» (2026-11-19): on a COUNTED issue — its row carries a `counterReading` — the reading
// taken on the device is part of that one fact. The rule follows the ROW, never the type's flag as
// it stands now: a row written with a reading keeps it, and one written without takes none
// afterwards. So a counted toner moves to another printer only with that printer's reading (checked
// on its timeline, and the old printer checked for a reset the readings after it rest on); the same
// device with a new reading corrects it; and «بدون جهاز» — «it never went in» — takes the reading off
// with the device. Both printers are locked inside the transaction, as the issue locks them, so a
// change and an issue on one printer never judge against a timeline the other is writing.
//
// «One memo, one printer, one reading»: the lines of one memo on one printer are one display read
// once, so every write of a counted row's reading on a printer — a correction on the same one, or
// a move onto one where rows of its memo already sit — writes that reading and reset to EVERY
// counted row of the memo on that printer, in the same transaction, under the lock already held.
// The placement is judged once, for the group (its rows are not each other's neighbours); each
// other row's version moves on, and each one whose value changed gets its item's audit row and
// refresh signal. A move OFF a printer leaves the memo's rows there as they are: they keep their
// reading, and the removal check still guards a reset the later readings rest on.
import { Types } from 'mongoose';
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
import { counterPlacement, counterRemoval, counterSiblings } from './consumable-counter';
import {
  counterRefused,
  counterRequired,
  lockAndReadTimelines,
  type CounterTimelineEntry,
} from './consumable-counter.service';
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
   *
   * On a counted issue (the row carries a reading), also: a reading sent for a row recorded without
   * one — 422; a device named with no reading — 422 `IT_CONSUMABLE_COUNTER_REQUIRED`; a reading the
   * new printer's timeline refuses — 422 `…_BELOW_PREVIOUS` / `…_ABOVE_NEXT`, judged inside the
   * transaction; a reset the old printer's later readings rest on, moved off it — 422. The same
   * device with the same reading and reset is the «nothing written» answer. A reading written on a
   * printer is written to the memo's other counted rows on it too («one memo, one printer, one
   * reading»), each audited and signalled as its item's own change.
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

    // The row's own reading makes it counted — never its type's flag as it stands now.
    const before =
      typeof movement.counterReading === 'number'
        ? { reading: movement.counterReading, reset: movement.counterReset === true }
        : null;
    const sentReading = input.counterReading;
    const sentReset = input.counterReset === true;
    let counter: { reading: number | null; reset: boolean } | undefined;
    if (before === null) {
      if (sentReading !== undefined || sentReset) {
        throw new BusinessRuleError(
          'this issue was recorded without a counter reading; one is not added afterwards',
        );
      }
    } else if (to === null) {
      // «بدون جهاز» — it never went in: the reading leaves with the device.
      counter = { reading: null, reset: false };
    } else if (sentReading === undefined) {
      throw counterRequired([
        {
          field: 'counterReading',
          code: 'REQUIRED',
          message: 'a toner moves with the counter reading of the printer it is on now',
        },
      ]);
    } else {
      counter = { reading: sentReading, reset: sentReset };
    }

    const deviceChanged = from !== to;
    const readingChanged =
      counter !== undefined &&
      (counter.reading !== (before?.reading ?? null) || counter.reset !== (before?.reset ?? false));
    if (!deviceChanged && !readingChanged) return movement;

    if (input.version !== movement.__v) throw new StaleDocumentError();
    // A device written off takes nothing new; a reading corrected on the one it already names is
    // a correction of the past, and stays possible.
    if (deviceChanged && asset !== null && asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed; nothing can be installed on it`,
      );
    }
    // The printer a counted toner leaves, named as the ledger names it — for the one refusal that
    // speaks of it.
    const leaving =
      counter !== undefined && from !== null && deviceChanged
        ? await itAssetRepository.findById(from, scope)
        : null;

    const movementId = String(movement._id);
    await ensureItConsumableCollections();
    const by = ctx.userId;
    const done = await unitOfWork(async (session) => {
      /**
       * «One memo, one printer, one reading» — the memo's other rows on the printer it now names
       * whose reading this write changes, and the reading and reset they take.
       */
      let group: { reading: number; reset: boolean; rows: CounterTimelineEntry[] } | null = null;
      if (counter !== undefined) {
        // Both printers locked, then read IN this transaction — an issue on either waits for this.
        const timelines = await lockAndReadTimelines(
          [from, to].filter((printer): printer is string => printer !== null),
          session,
        );
        if (from !== null && deviceChanged) {
          const removal = counterRemoval(timelines.get(from) ?? [], movementId);
          if (!removal.ok) {
            throw new BusinessRuleError(
              `this reading starts ${leaving?.assetCode ?? 'the printer'}'s counter again and the readings after it start from it: it cannot leave the printer`,
            );
          }
        }
        if (asset !== null && to !== null && counter.reading !== null) {
          const timeline = timelines.get(to) ?? [];
          const entry = {
            id: movementId,
            at: movement.at,
            reading: counter.reading,
            reset: counter.reset,
            memoId: movement.memoId == null ? null : String(movement.memoId),
          };
          // Judged once, for the memo's rows on this printer together: they are not each other's
          // neighbours.
          const placement = counterPlacement(timeline, entry);
          if (!placement.ok) {
            throw counterRefused(placement, {
              field: 'counterReading',
              reading: counter.reading,
              assetCode: asset.assetCode,
            });
          }
          const rows = counterSiblings(timeline, entry).filter(
            (row) => row.reading !== entry.reading || row.reset !== entry.reset,
          );
          if (rows.length > 0) group = { reading: entry.reading, reset: entry.reset, rows };
        }
      }
      const updated = await itConsumableMovementRepository.setInstalledOn(
        id,
        asset === null ? null : asset._id,
        {
          version: input.version,
          previous: movement.assetId ?? null,
          scope,
          by,
          session,
          ...(counter === undefined ? {} : { counter }),
        },
      );
      // «One memo, one printer, one reading»: the memo's other rows on this printer take it too —
      // the lock is already held.
      if (group !== null && asset !== null && movement.memoId != null) {
        await itConsumableMovementRepository.setMemoCounterOnPrinter(
          group.rows.map((row) => new Types.ObjectId(row.id)),
          { memoId: movement.memoId, assetId: asset._id },
          { reading: group.reading, reset: group.reset },
          { by, session },
        );
      }
      // The paper's line — the issue's snapshot of the register, taken again now. The paper carries
      // no reading, so a correction of the reading alone leaves it as it is.
      const line =
        movement.memoId == null || !deviceChanged
          ? null
          : await itConsumableMemoRepository.setLineDevice(
              movement.memoId,
              movement._id,
              asset === null
                ? null
                : { assetId: asset._id, assetCode: asset.assetCode, assetName: asset.name },
              { by, session },
            );
      return { updated, line, group };
    });

    // After the commit: the item's trail, then the paper's — and the refresh of both topics, with
    // the store, so a branch-scoped reader's open ledger, card or memo reads again too. The item's
    // row names what changed: the device, the reading, the reset.
    const consumableId = String(movement.consumableId);
    const branchId = String(movement.branchId);
    const oldReading = before?.reading ?? null;
    const oldReset = before?.reset ?? false;
    await auditService.record({
      entityRef: consumableEntityRef(consumableId),
      action: 'update',
      changes: [
        ...(deviceChanged ? [change('installedOn', from, to)] : []),
        ...(counter !== undefined && counter.reading !== oldReading
          ? [change('counterReading', oldReading, counter.reading)]
          : []),
        ...(counter !== undefined && counter.reset !== oldReset
          ? [change('counterReset', oldReset, counter.reset)]
          : []),
        change('movementId', null, movementId),
      ],
    });
    signalConsumable(consumableId, branchId);
    // Each other row of the memo on that printer whose reading this rewrote: its own item's trail
    // and refresh — one memo is one store's, so the store is this one.
    if (done.group !== null) {
      const { reading, reset, rows } = done.group;
      for (const sibling of rows) {
        await auditService.record({
          entityRef: consumableEntityRef(sibling.consumableId),
          action: 'update',
          changes: [
            ...(sibling.reading !== reading
              ? [change('counterReading', sibling.reading, reading)]
              : []),
            ...(sibling.reset !== reset ? [change('counterReset', sibling.reset, reset)] : []),
            change('movementId', null, sibling.id),
          ],
        });
        signalConsumable(sibling.consumableId, branchId);
      }
    }
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

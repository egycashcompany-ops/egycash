// «صرف لموظف» — the one action that writes a memo (FR-20): «وأتبدل لمين واطبعله مذكره ولو حاجة
// بتتركب فى حاجة تانية زى الهرد والماوس والكابلات أقدر أذكر الجهاز اللى أتركب عليه من اللأصول».
//
// ONE action, ONE memo, ONE transaction: every line's movement, every item's counters and the memo
// that lists them commit together or not at all — so the paper never lists what the store did not
// give, nor the store give what the paper does not list. The memo's number is reserved INSIDE that
// transaction (`reserveSequenceBlock`), so a refused issue gives it back and the series has no gap.
// The audit rows follow the commit, as every custody write's do: the audit service is not part of
// the transaction, and a row written inside it would outlive an issue the database then refused.
//
// Refused before anything is written: a leaver («اللى موجود بس», the custody rule), an item the
// caller cannot see, a retired one, more than its store holds, items from two stores (a memo is one
// store's paper — «each branch keeps its own stock»), and an asset the caller cannot see or one
// that is disposed. HR and the assets are read BEFORE the transaction — another module's data has
// no business holding a stock write open — and the quantities are guarded again INSIDE it, in the
// update's filter, so two people issuing the last unit at once cannot both succeed.
import { Types } from 'mongoose';
import { type IssueItConsumables } from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { refuseLeaver } from '../assets/custody.service';
import { readReceiptHolder } from '../assets/receipt-holder';
import { itAssetRepository } from '../assets/asset.repository';
import { itCatalogItemRepository } from '../catalog-items/catalog-item.repository';
import { reserveSequenceBlock } from '../shared/sequence';
import { CONSUMABLE_MEMO_SEQUENCE_KEY } from './consumable-number';
import { beforeStockEffect, canTake, stockEffect, type StockEffect } from './consumable-stock';
import { itConsumableRepository } from './consumable.repository';
import { itConsumableMovementRepository } from './consumable-movement.repository';
import { itConsumableMemoRepository } from './consumable-memo.repository';
import {
  auditConsumableMemoIssued,
  auditStockMovement,
  change,
  consumableMovementRow,
  ensureItConsumableCollections,
} from './consumable-history';
import { type ItConsumableDoc } from './consumable.model';
import { type ItConsumableMovementDoc } from './consumable-movement.model';
import { type ItConsumableMemoDoc, type ItConsumableMemoLineSub } from './consumable-memo.model';

export interface ItConsumableIssueResult {
  memo: ItConsumableMemoDoc;
  /** Every item on the memo, as it stands after the issue. */
  consumables: ItConsumableDoc[];
}

/**
 * «مسؤول تكنولوجيا المعلومات» — the issuer's name as the paper prints it: Arabic, the paper's own
 * language, falling back to the English one an account may carry alone.
 */
const issuerNameOf = (ctx: AuthContext): string | null => {
  const ar = ctx.identity?.displayName.ar.trim() ?? '';
  const en = ctx.identity?.displayName.en.trim() ?? '';
  return ar !== '' ? ar : en !== '' ? en : null;
};

/** The refusal both the early check and the guarded write give — one message for one rule. */
const notEnough = (item: ItConsumableDoc, qty: number): BusinessRuleError =>
  new BusinessRuleError(
    `item ${item.code} has ${String(item.onHandQty)} on hand and cannot give ${String(qty)}`,
  );

interface IssuedLine {
  line: IssueItConsumables['lines'][number];
  effect: StockEffect;
  item: ItConsumableDoc;
  movement: ItConsumableMovementDoc;
}

class ItConsumableIssueService {
  async issue(
    input: IssueItConsumables,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItConsumableIssueResult> {
    const issuedAt = input.issuedAt ?? new Date();

    // 1. HR first — a leaver is refused before anything else is read, let alone written.
    const holder = await readReceiptHolder(input.employeeId);
    refuseLeaver(holder.employee);

    // 2. The items as the caller sees them: every one found, active, holding enough, one store.
    const found = await itConsumableRepository.findManyByIds(
      input.lines.map((line) => line.consumableId),
      scope,
    );
    const items = new Map(found.map((item) => [String(item._id), item]));
    for (const line of input.lines) {
      const item = items.get(line.consumableId);
      if (item === undefined) throw new NotFoundError('consumable not found');
      if (!item.active) {
        throw new BusinessRuleError(`item ${item.code} is inactive and cannot be issued`);
      }
      if (!canTake(item.onHandQty, line.qty)) throw notEnough(item, line.qty);
    }
    const stores = [...new Set(found.map((item) => String(item.branchId)))];
    const [store] = stores;
    if (store === undefined) throw new NotFoundError('consumable not found');
    if (stores.length > 1) {
      throw new BusinessRuleError(
        "a memo lists one store's items: issue each branch's items on a memo of its own",
      );
    }

    // 3. «مركّب على» — an asset the caller can see, and one that still exists as a device.
    const assetIds = [...new Set(input.lines.flatMap((line) => line.assetId ?? []))];
    const assets = new Map(
      (assetIds.length === 0 ? [] : await itAssetRepository.findManyByIds(assetIds, scope)).map(
        (asset) => [String(asset._id), asset],
      ),
    );
    for (const assetId of assetIds) {
      const asset = assets.get(assetId);
      if (asset === undefined) throw new NotFoundError('asset not found');
      if (asset.status === 'disposed') {
        throw new BusinessRuleError(
          `asset ${asset.assetCode} is disposed; nothing can be installed on it`,
        );
      }
    }

    // 4. The types' names, for the paper's «النوع» column — a snapshot, like everything it prints.
    const types = new Map(
      (await itCatalogItemRepository.findByIdsSystem(found.map((item) => String(item.typeId)))).map(
        (type) => [String(type._id), { ar: type.name.ar, en: type.name.en }],
      ),
    );

    await ensureItConsumableCollections();
    const by = ctx.userId;
    const done = await unitOfWork(async (session) => {
      const memoNumber = await reserveSequenceBlock(CONSUMABLE_MEMO_SEQUENCE_KEY, 1, session);
      // Allocated up front so every movement can name its memo as it is written.
      const memoId = new Types.ObjectId();
      const issued: IssuedLine[] = [];
      for (const line of input.lines) {
        const effect = stockEffect('issued', line.qty, line.reason);
        const item = await itConsumableRepository.moveStock(line.consumableId, effect, {
          session,
          by,
          scope,
          activeFor: 'issue',
        });
        const movement = await itConsumableMovementRepository.create(
          consumableMovementRow({
            item,
            kind: 'issued',
            qty: line.qty,
            at: issuedAt,
            byUserId: by,
            employeeId: input.employeeId,
            assetId: line.assetId ?? null,
            reason: line.reason,
            memoId,
            notes: input.notes ?? null,
          }),
          { by, session },
        );
        issued.push({ line, effect, item, movement });
      }

      const lines: ItConsumableMemoLineSub[] = issued.map(({ line, item, movement }) => {
        const asset = line.assetId === undefined ? undefined : assets.get(line.assetId);
        return {
          consumableId: item._id,
          movementId: movement._id,
          code: item.code,
          name: item.name,
          typeName: types.get(String(item.typeId)) ?? null,
          unit: item.unit,
          qty: line.qty,
          reason: line.reason,
          assetId: asset?._id ?? null,
          assetCode: asset?.assetCode ?? null,
          assetName: asset?.name ?? null,
        };
      });
      const memo = await itConsumableMemoRepository.create(
        {
          _id: memoId,
          memoNumber,
          issuedAt,
          employeeId: new Types.ObjectId(input.employeeId),
          // The signer as printed — no national ID on this paper.
          employeeCode: holder.employeeCode,
          employeeName: holder.employeeName,
          jobTitle: holder.jobTitle,
          issuedByUserId: new Types.ObjectId(by),
          issuedByName: issuerNameOf(ctx),
          branchId: new Types.ObjectId(store),
          lines,
          notes: input.notes ?? null,
          signedCopy: null,
        },
        { by, session },
      );
      return { memo, issued };
    });

    // After the commit: each item's movement on its own trail, then the paper's.
    for (const { line, effect, item, movement } of done.issued) {
      await auditStockMovement({
        consumableId: String(item._id),
        kind: 'issued',
        before: beforeStockEffect(item, effect),
        after: item,
        extra: [
          change('movementId', null, String(movement._id)),
          change('employeeId', null, input.employeeId),
          change('reason', null, line.reason),
          ...(line.assetId === undefined ? [] : [change('assetId', null, line.assetId)]),
          change('memoNumber', null, done.memo.memoNumber),
        ],
      });
    }
    await auditConsumableMemoIssued(done.memo);
    return { memo: done.memo, consumables: done.issued.map((entry) => entry.item) };
  }
}

export const itConsumableIssueService = new ItConsumableIssueService();

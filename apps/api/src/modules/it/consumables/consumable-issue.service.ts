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
//
// «عداد الطابعة» (2026-11-19) — «يعني إجبارى أدخل عدد الورق المطبوع عند تركيب الحبارة»: an item whose
// type `requiresCounterReading` («حبارات») goes onto ONE printer («مركّب على»), one cartridge a line,
// with that printer's counter reading — refused before anything is written when any of the three is
// missing (`IT_CONSUMABLE_COUNTER_REQUIRED`, one detail per gap), and any other item takes no
// reading. The type is read as it stands now, retired or not. INSIDE the transaction, under each
// printer's lock, the reading is judged against the printer's timeline as it is then: STRICTLY
// above its last reading — «وأكيد مش هيدخل عدد ورق أقل أو مساوي للى موجود» — unless it is a reset,
// and strictly below a later one when the issue is backdated (`consumable-counter.ts`). The lines of
// this memo on one printer share one reading (the contract's rule): they are one placement.
//
// «صرف لإدارة» (2026-11-19) — «عند تسليم الأصول والمستهلكات … أعينها فى مكان بس تبقى على عهده
// الإدارة»: the memo may go to a DEPARTMENT kept at a PLACE instead of an employee, signed for by
// the department's responsible person. They are read with the asset hand-over's own seam
// (`readCustodian`): a signer who has left, a department that is not active and a place that is
// retired are refused before anything else is read — and, once the store is known, a place outside
// the store's branch («each branch keeps its own stock»: the place is where this store's items go).
// The ledger rows then name the department, the place and the signer and no employee; the memo's
// signer is the responsible person, and it names the department and the place (`custodian`). The
// number series, the store and the counter are the same: a toner onto a printer a department holds
// takes that printer's reading, judged on its timeline as any other.
import { Types } from 'mongoose';
import { type AuditChange, type IssueItConsumables } from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { refuseLeaver } from '../assets/custody.service';
import {
  custodianRefusal,
  custodianSnapshot,
  readCustodian,
  type CustodianRead,
} from '../assets/custodian';
import { readReceiptHolder, type ReceiptHolder } from '../assets/receipt-holder';
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
import { counterPlacement } from './consumable-counter';
import {
  counterRefused,
  counterRequired,
  lockAndReadTimelines,
  type CounterGap,
} from './consumable-counter.service';
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

/**
 * Who the memo goes to, as HR and the catalogs answer: the employee — or the department, its place
 * and its responsible person — and, either way, the SIGNER whose name the paper prints.
 */
interface Recipient {
  /** The signer's employee id: the employee, or the department's responsible person. */
  signerId: string;
  signer: ReceiptHolder;
  /** The department and the place, on an issue to a department; null on an employee's. */
  custodian: CustodianRead | null;
}

/**
 * Exactly one of the two — which the contract already holds; a caller that slipped past it is
 * refused rather than guessed at. A leaver is refused either way: as the employee it would go to,
 * or as the person who would sign for the department.
 */
const readRecipient = async (input: IssueItConsumables): Promise<Recipient> => {
  if (input.department !== undefined && input.employeeId === undefined) {
    const custodian = await readCustodian(input.department);
    return {
      signerId: custodian.holder.responsibleEmployeeId,
      signer: custodian.signer,
      custodian,
    };
  }
  if (input.employeeId !== undefined && input.department === undefined) {
    const signer = await readReceiptHolder(input.employeeId);
    refuseLeaver(signer.employee);
    return { signerId: input.employeeId, signer, custodian: null };
  }
  throw new BusinessRuleError('a memo is issued to an employee or to a department — exactly one');
};

/**
 * Who an item's audit row says it went to: the employee — or the department, the place and who
 * signed for it, in place of an employee.
 */
const recipientChanges = ({ signerId, custodian }: Recipient): AuditChange[] =>
  custodian === null
    ? [change('employeeId', null, signerId)]
    : [
        change('departmentId', null, custodian.holder.departmentId),
        change('locationId', null, custodian.holder.locationId),
        change('responsibleEmployeeId', null, signerId),
      ];

/** The refusal both the early check and the guarded write give — one message for one rule. */
const notEnough = (item: ItConsumableDoc, qty: number): BusinessRuleError =>
  new BusinessRuleError(
    `item ${item.code} has ${String(item.onHandQty)} on hand and cannot give ${String(qty)}`,
  );

/** A counted line's reading — what its row carries and its audit records. */
interface LineCounter {
  reading: number;
  reset: boolean;
}

/**
 * A line as the transaction writes it — with its reading when counted, and its movement's id,
 * allocated up front: a counted line's place on the printer's timeline is the row it becomes.
 */
interface PlannedLine {
  line: IssueItConsumables['lines'][number];
  index: number;
  counter: LineCounter | null;
  movementId: Types.ObjectId;
}

interface IssuedLine {
  line: IssueItConsumables['lines'][number];
  effect: StockEffect;
  item: ItConsumableDoc;
  movement: ItConsumableMovementDoc;
  counter: LineCounter | null;
}

class ItConsumableIssueService {
  /**
   * `scope` is the store's (the caller's `itConsumable.view`); `assetScope` is the ASSET register's
   * — the caller's own `itAsset.view`, or null without it. An «installed on» names a device, and
   * the store's grant must not become a way to find devices the caller cannot read: without the
   * asset grant every asset id is «not found», exactly as one outside its scope is.
   */
  async issue(
    input: IssueItConsumables,
    ctx: AuthContext,
    scope: ScopeSelector,
    assetScope: ScopeSelector | null,
  ): Promise<ItConsumableIssueResult> {
    const issuedAt = input.issuedAt ?? new Date();

    // 1. HR first — a leaver is refused before anything else is read, let alone written; and for a
    //    department, the department and its place, each refused unless it is live.
    const recipient = await readRecipient(input);
    const { signer, custodian } = recipient;

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
    // A department's place is one of the store's branch's places: what this store gives is kept
    // there, and a memo names one place.
    if (custodian !== null && custodian.locationBranchId !== store) {
      throw custodianRefusal(
        'body.department.locationId',
        'OTHER_BRANCH',
        "a memo to a department names a place in the store's branch; this place is in another branch",
      );
    }

    // 3. «مركّب على» — an asset the caller can see under their ASSET grant, and one that still
    //    exists as a device. No `itAsset.view`, no asset: the register is not asked at all.
    const assetIds = [...new Set(input.lines.flatMap((line) => line.assetId ?? []))];
    const assets = new Map(
      (assetIds.length === 0 || assetScope === null
        ? []
        : await itAssetRepository.findManyByIds(assetIds, assetScope)
      ).map((asset) => [String(asset._id), asset]),
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

    // 4. The types: their names, for the paper's «النوع» column — a snapshot, like everything it
    //    prints — and whether an item of the type takes the printer's counter, as it stands now.
    const types = new Map(
      (await itCatalogItemRepository.findByIdsSystem(found.map((item) => String(item.typeId)))).map(
        (type) => [
          String(type._id),
          {
            name: { ar: type.name.ar, en: type.name.en },
            requiresCounterReading: type.requiresCounterReading ?? false,
          },
        ],
      ),
    );

    // 5. «عداد الطابعة» — a counted line names its printer, its reading, and one cartridge; any other
    //    line names no reading. Every gap of every line is one refusal, so the screen marks them all.
    const planned: PlannedLine[] = [];
    const gaps: CounterGap[] = [];
    input.lines.forEach((line, index) => {
      // Every line's item was found at step 2.
      const item = items.get(line.consumableId);
      if (item === undefined) throw new NotFoundError('consumable not found');
      if (types.get(String(item.typeId))?.requiresCounterReading !== true) {
        if (line.counterReading !== undefined || line.counterReset === true) {
          throw new BusinessRuleError(
            `item ${item.code} does not take the printer's counter; send no reading`,
          );
        }
        planned.push({ line, index, counter: null, movementId: new Types.ObjectId() });
        return;
      }
      const prefix = `item ${item.code} takes the printer's counter:`;
      if (line.assetId === undefined) {
        gaps.push({
          field: `lines.${String(index)}.assetId`,
          code: 'REQUIRED',
          message: `${prefix} name the printer it is installed on («مركّب على»)`,
        });
      }
      if (line.counterReading === undefined) {
        gaps.push({
          field: `lines.${String(index)}.counterReading`,
          code: 'REQUIRED',
          message: `${prefix} its reading is required`,
        });
      }
      if (line.qty !== 1) {
        gaps.push({
          field: `lines.${String(index)}.qty`,
          code: 'ONE_CARTRIDGE',
          message: `${prefix} one cartridge per line, on the printer it goes into`,
        });
      }
      planned.push({
        line,
        index,
        counter: { reading: line.counterReading ?? 0, reset: line.counterReset === true },
        movementId: new Types.ObjectId(),
      });
    });
    const [gap, ...moreGaps] = gaps;
    if (gap !== undefined) throw counterRequired([gap, ...moreGaps]);
    // Each counted printer's place on its timeline: its first line (the others repeat its reading).
    const printers = new Map<string, PlannedLine & { counter: LineCounter }>();
    for (const entry of planned) {
      const { counter, line } = entry;
      if (counter !== null && line.assetId !== undefined && !printers.has(line.assetId)) {
        printers.set(line.assetId, { ...entry, counter });
      }
    }

    await ensureItConsumableCollections();
    const by = ctx.userId;
    const done = await unitOfWork(async (session) => {
      const memoNumber = await reserveSequenceBlock(CONSUMABLE_MEMO_SEQUENCE_KEY, 1, session);
      // Allocated up front so every movement can name its memo as it is written.
      const memoId = new Types.ObjectId();

      // The printers' readings — locked, then read IN this transaction, so the last reading is
      // the one another clerk wrote a moment ago.
      if (printers.size > 0) {
        const timelines = await lockAndReadTimelines([...printers.keys()], session);
        for (const [assetId, { index, counter, movementId }] of printers) {
          const placement = counterPlacement(timelines.get(assetId) ?? [], {
            id: String(movementId),
            at: issuedAt,
            reading: counter.reading,
            reset: counter.reset,
            memoId: String(memoId),
          });
          if (!placement.ok) {
            throw counterRefused(placement, {
              field: `lines.${String(index)}.counterReading`,
              reading: counter.reading,
              assetCode: assets.get(assetId)?.assetCode ?? assetId,
            });
          }
        }
      }

      const issued: IssuedLine[] = [];
      for (const { line, counter, movementId } of planned) {
        const effect = stockEffect('issued', line.qty, line.reason);
        const item = await itConsumableRepository.moveStock(line.consumableId, effect, {
          session,
          by,
          scope,
          activeFor: 'issue',
        });
        const movement = await itConsumableMovementRepository.create(
          {
            ...consumableMovementRow({
              item,
              kind: 'issued',
              qty: line.qty,
              at: issuedAt,
              byUserId: by,
              // Who it went to: the employee — or the department, and then no employee at all.
              employeeId: custodian === null ? recipient.signerId : null,
              department: custodian?.holder ?? null,
              assetId: line.assetId ?? null,
              reason: line.reason,
              memoId,
              notes: input.notes ?? null,
            }),
            _id: movementId,
            // Beside the row's one shape, and only on a counted row: an old row has no such key,
            // and «no reading» reads the same on both (the model's header).
            ...(counter === null
              ? {}
              : {
                  counterReading: counter.reading,
                  ...(counter.reset ? { counterReset: true } : {}),
                }),
          },
          { by, session },
        );
        issued.push({ line, effect, item, movement, counter });
      }

      const lines: ItConsumableMemoLineSub[] = issued.map(({ line, item, movement }) => {
        const asset = line.assetId === undefined ? undefined : assets.get(line.assetId);
        return {
          consumableId: item._id,
          movementId: movement._id,
          code: item.code,
          name: item.name,
          typeName: types.get(String(item.typeId))?.name ?? null,
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
          employeeId: new Types.ObjectId(recipient.signerId),
          // The signer as printed — no national ID on this paper.
          employeeCode: signer.employeeCode,
          employeeName: signer.employeeName,
          jobTitle: signer.jobTitle,
          // «لصالح إدارة … بموقع …» — the department and the place, as named today.
          custodian: custodian === null ? null : custodianSnapshot(custodian),
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
    for (const { line, effect, item, movement, counter } of done.issued) {
      await auditStockMovement({
        consumableId: String(item._id),
        kind: 'issued',
        before: beforeStockEffect(item, effect),
        after: item,
        extra: [
          change('movementId', null, String(movement._id)),
          ...recipientChanges(recipient),
          change('reason', null, line.reason),
          ...(line.assetId === undefined ? [] : [change('assetId', null, line.assetId)]),
          ...(counter === null ? [] : [change('counterReading', null, counter.reading)]),
          ...(counter?.reset === true ? [change('counterReset', null, true)] : []),
          change('memoNumber', null, done.memo.memoNumber),
        ],
      });
    }
    await auditConsumableMemoIssued(done.memo);
    return { memo: done.memo, consumables: done.issued.map((entry) => entry.item) };
  }
}

export const itConsumableIssueService = new ItConsumableIssueService();

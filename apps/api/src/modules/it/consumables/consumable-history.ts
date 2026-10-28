// The few things every write on the consumables does the same way — and the go-live import with
// them: name the audited entities, describe an item and a movement for the audit trail, build a
// ledger row, and build the indexes first.
//
// There is no separate history stream: the movement ledger IS the item's history (every unit in
// and out, by whom, to whom, on which memo), and the item's own facts — registered, edited — are
// the audit trail's, exactly as the spare parts' are.
import { Types } from 'mongoose';
import { type AuditChange, type ItConsumableMovementKind } from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { publishAuditedChange } from '../../../platform/realtime';
import { diffChanges } from '../../../shared/utils/diff';
import {
  NO_STOCK,
  applyStockEffect,
  stockEffect,
  type ConsumableCounters,
} from './consumable-stock';
import { type ItConsumableDoc } from './consumable.model';
import { type ItConsumableMovementDoc } from './consumable-movement.model';
import { type ItConsumableMemoDoc } from './consumable-memo.model';
import { itConsumableRepository } from './consumable.repository';
import { itConsumableMovementRepository } from './consumable-movement.repository';
import { itConsumableMemoRepository } from './consumable-memo.repository';

/** The audited item — a LITERAL pair, so the realtime registry's scan can classify it. */
export const consumableEntityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'consumable',
  entityId: id,
});

/** The audited memo — a LITERAL pair, for the same scan. */
export const consumableMemoEntityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'consumableMemo',
  entityId: id,
});

/** An audit row's change: the transition, not a diff of the whole row. */
export const change = (field: string, from: unknown, to: unknown): AuditChange => ({
  field,
  old: from,
  new: to,
});

/** The item's facts as the audit trail compares them — never the counters, which movements audit. */
export const consumableSnapshot = (doc: ItConsumableDoc) => ({
  code: doc.code,
  name: doc.name,
  typeId: String(doc.typeId),
  unit: doc.unit,
  branchId: String(doc.branchId),
  minQty: doc.minQty ?? null,
  notes: doc.notes ?? null,
  active: doc.active,
});

/** The counters a movement moved, before → after — and none it did not. */
export const counterChanges = (
  before: ConsumableCounters,
  after: ConsumableCounters,
): AuditChange[] =>
  (['onHandQty', 'issuedQty', 'scrappedQty'] as const)
    .filter((field) => before[field] !== after[field])
    .map((field) => change(field, before[field], after[field]));

/**
 * The audit verb of each movement. `receive` is the store's inbound verb (the spare parts'); an
 * issue to a person and a return from one are the custody pair a dispute filters on; a scrap is a
 * write-off, which is what `dispose` names.
 */
export const MOVEMENT_AUDIT_ACTION = {
  received: 'receive',
  issued: 'assign',
  scrapped: 'dispose',
  returned: 'return',
} as const satisfies Record<ItConsumableMovementKind, string>;

/** The audit row an item's registration writes — AFTER the commit that wrote it. */
export const auditConsumableCreated = async (doc: ItConsumableDoc): Promise<void> => {
  await auditService.record({
    entityRef: consumableEntityRef(String(doc._id)),
    action: 'create',
    changes: diffChanges({}, consumableSnapshot(doc)),
  });
};

/**
 * A movement is audited under its own verb — `receive`, `assign`, `dispose`, `return`, the words a
 * dispute filters on — and to the realtime layer those are not data-change words (ADR-029), so the
 * audit row announces nothing. One `update` signal on the item's topic, WITH its store, makes every
 * open store screen, ledger and card read again, a branch-scoped reader of that store included. No
 * audit row of its own — the `fleet/custody/custody-memo-guard.ts` precedent. Best-effort, as every
 * signal is.
 */
export const signalConsumable = (consumableId: string, branchId: string): void => {
  publishAuditedChange({
    entityRef: { moduleId: 'it', entityType: 'consumable', entityId: consumableId },
    action: 'update',
    at: new Date().toISOString(),
    branchId,
  });
};

/**
 * The audit row a movement writes on its item — AFTER the commit, like every custody audit: the
 * audit service is not part of the transaction, so a row written inside it would outlive a write
 * the database then refused, and a retried transaction would write it twice. The item as it now
 * stands names its store, which the refresh signal that follows goes to.
 */
export const auditStockMovement = async (input: {
  consumableId: string;
  kind: ItConsumableMovementKind;
  before: ConsumableCounters;
  after: ConsumableCounters & { branchId: Types.ObjectId };
  extra?: readonly AuditChange[];
}): Promise<void> => {
  await auditService.record({
    entityRef: consumableEntityRef(input.consumableId),
    action: MOVEMENT_AUDIT_ACTION[input.kind],
    changes: [...counterChanges(input.before, input.after), ...(input.extra ?? [])],
  });
  signalConsumable(input.consumableId, String(input.after.branchId));
};

/** The audit row of a memo: who was issued what, on which number. */
export const auditConsumableMemoIssued = async (memo: ItConsumableMemoDoc): Promise<void> => {
  await auditService.record({
    entityRef: consumableMemoEntityRef(String(memo._id)),
    action: 'create',
    changes: [
      change('employeeId', null, String(memo.employeeId)),
      change('memoNumber', null, memo.memoNumber),
      change(
        'items',
        null,
        memo.lines.map((line) => ({ code: line.code, qty: line.qty, reason: line.reason })),
      ),
    ],
  });
};

export interface ConsumableItemInput {
  code: string;
  name: string;
  typeId: Types.ObjectId;
  unit: string;
  branchId: Types.ObjectId;
  minQty?: number | null;
  notes?: string | null;
  /** The opening delivery, if any — written beside the item as its first `received` movement. */
  openingQty?: number | null;
}

/**
 * A new item's row, every key present, its counters what its opening delivery makes of an empty
 * item. The service's «إضافة صنف» and the go-live import both build from here, so an opening
 * balance is the same three numbers whichever of them wrote it.
 */
export const consumableItemRow = (input: ConsumableItemInput): Partial<ItConsumableDoc> => ({
  code: input.code,
  name: input.name,
  typeId: input.typeId,
  unit: input.unit,
  branchId: input.branchId,
  minQty: input.minQty ?? null,
  notes: input.notes ?? null,
  active: true,
  ...(input.openingQty == null
    ? NO_STOCK
    : applyStockEffect(NO_STOCK, stockEffect('received', input.openingQty))),
});

export interface ConsumableMovementInput {
  item: Pick<ItConsumableDoc, '_id' | 'branchId'>;
  kind: ItConsumableMovementKind;
  qty: number;
  at: Date;
  byUserId: string | null;
  employeeId?: string | null;
  assetId?: string | null;
  reason?: string | null;
  memoId?: Types.ObjectId | null;
  notes?: string | null;
}

/**
 * One ledger row, every key present — null where the kind has nothing to say — so the ledger reads
 * one shape whatever moved. The row copies the item's store: an item never changes branch, so the
 * ledger is scoped with no join.
 */
export const consumableMovementRow = (
  input: ConsumableMovementInput,
): Partial<ItConsumableMovementDoc> => ({
  consumableId: input.item._id,
  kind: input.kind,
  qty: input.qty,
  at: input.at,
  branchId: input.item.branchId,
  byUserId: input.byUserId === null ? null : new Types.ObjectId(input.byUserId),
  employeeId: input.employeeId == null ? null : new Types.ObjectId(input.employeeId),
  assetId: input.assetId == null ? null : new Types.ObjectId(input.assetId),
  reason: input.reason ?? null,
  memoId: input.memoId ?? null,
  notes: input.notes ?? null,
});

/**
 * Every collection the store writes, with its indexes, before the first write of any path — and for
 * the go-live import, before its one transaction. `autoIndex` is off in production, so the unique
 * indexes this store stands on (one code one item, one name per store, one number per memo) would
 * otherwise never be built; and an insert inside a transaction must not be what creates the
 * collection (`mobile-lines/ensure-collection.ts`).
 */
export const ensureItConsumableCollections = async (): Promise<void> => {
  await Promise.all([
    itConsumableRepository.ensureCollection(),
    itConsumableMovementRepository.ensureCollection(),
    itConsumableMemoRepository.ensureCollection(),
  ]);
};

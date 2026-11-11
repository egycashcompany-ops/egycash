// `it_consumable_movements` — the consumables store's ledger, append-only (ADR-024's shape): every
// unit in («توريد», «مرتجع») and out («صرف», «هالك») — and between two branches' stores («تحويل إلى
// فرع»: a `transferredOut` row in one, a `transferredIn` row in the other, sharing one
// `transferId`) — one row per movement, never edited. A mistake
// is corrected by an opposing movement — which is what keeps every on-hand figure explainable six
// months later — and the repository offers nothing that changes a row.
//
// `qty` is always POSITIVE and the kind says which way it moved: a ledger read by people, where
// «−3» beside «صرف» would say the same thing twice and invite the sign to disagree with the word.
// What each kind does to the item's counters is `consumable-stock.ts`.
//
// It answers «وأتبدل لمين» — an issue names the employee it went to and, «لو حاجة بتتركب فى حاجة
// تانية», the register's asset it was installed on. That makes it a record that names a person, and
// the workforce reset KEEPS it: it is the stock ledger, and deleting it would leave every on-hand
// figure without the movements that explain it.
import { Schema, model, type Types } from 'mongoose';
import { IT_CONSUMABLE_MOVEMENT_KINDS, type ItConsumableMovementKind } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItConsumableMovementDoc extends BaseDocFields {
  consumableId: Types.ObjectId;
  kind: ItConsumableMovementKind;
  /** Positive; the kind carries the direction. */
  qty: number;
  /** When it happened — what the ledger orders by, as typed (it defaults to the moment of entry). */
  at: Date;
  /** The item's store — fixed for the item's life, so the ledger is scoped with no join. */
  branchId: Types.ObjectId;
  byUserId: Types.ObjectId | null;
  /** `issued`: who it went to; `returned`: who brought it back, when known. Null otherwise. */
  employeeId: Types.ObjectId | null;
  /** `issued`: the asset it was installed on, when it was. Null otherwise. */
  assetId: Types.ObjectId | null;
  /** `issued`: `new` | `replacement`; `scrapped`: why, as written. Null otherwise. */
  reason: string | null;
  /** `issued`: the memo the employee signed for it. */
  memoId: Types.ObjectId | null;
  notes: string | null;
  /**
   * A transfer between two stores — «لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني»: the id its two
   * movements share (one transfer of several items shares one id across all of them). Null
   * otherwise.
   */
  transferId: Types.ObjectId | null;
  /** `transferredOut`: the branch it went to; `transferredIn`: the branch it came from. */
  counterpartBranchId: Types.ObjectId | null;
  /** A transfer: the other store's item of the same name — the other half of the pair. */
  counterpartConsumableId: Types.ObjectId | null;
}

const movementSchema = new Schema<ItConsumableMovementDoc>(
  {
    consumableId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: IT_CONSUMABLE_MOVEMENT_KINDS, required: true },
    qty: { type: Number, required: true, min: 1 },
    at: { type: Date, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    byUserId: { type: Schema.Types.ObjectId, default: null },
    employeeId: { type: Schema.Types.ObjectId, default: null },
    assetId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, default: null },
    memoId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    transferId: { type: Schema.Types.ObjectId, default: null },
    counterpartBranchId: { type: Schema.Types.ObjectId, default: null },
    counterpartConsumableId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One item's movements, newest first — the item's own movements list.
movementSchema.index({ consumableId: 1, at: -1 }, { name: 'ix_consumable_at' });
// The ledger across items, scoped to the stores a reader sees, newest first.
movementSchema.index({ branchId: 1, at: -1 }, { name: 'ix_branch_at' });
// «وأتبدل لمين» — what a person was issued: the IT history page of an employee.
movementSchema.index({ employeeId: 1, at: -1 }, { name: 'ix_employee_at' });
// «المستهلكات المركّبة عليه» — what was installed on an asset: its detail page.
movementSchema.index({ assetId: 1, at: -1 }, { name: 'ix_asset_at' });
// The movements one memo lists.
movementSchema.index({ memoId: 1 }, { name: 'ix_memo' });
// The movements one transfer wrote — both halves of every line, in both stores.
movementSchema.index({ transferId: 1 }, { name: 'ix_transfer' });

export const ItConsumableMovementModel = model<ItConsumableMovementDoc>(
  'ItConsumableMovement',
  movementSchema,
  'it_consumable_movements',
);

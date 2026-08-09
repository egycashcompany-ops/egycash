// `it_maintenance_orders` — one collection, two shapes discriminated by `kind` (design §2.7, the
// Fleet violations precedent).
//
// The consumed parts are NOT stored here. They are movement rows keyed by `orderId` (ADR-024): one
// source of truth, and no drift between an embedded list and the ledger.
//
// `assetStatusBefore` is the one field the design implies without naming: completion must return
// the asset to its PRIOR custody state (an assigned laptop under repair is still that person's
// laptop), so the status it held at `start` has to be remembered rather than guessed.
import { Schema, model, type Types } from 'mongoose';
import {
  IT_ASSET_STATUSES,
  IT_MAINTENANCE_KINDS,
  IT_MAINTENANCE_ORDER_STATUSES,
  type ItAssetStatus,
  type ItMaintenanceKind,
  type ItMaintenanceOrderStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItMaintenanceOrderDoc extends BaseDocFields {
  orderCode: string;
  kind: ItMaintenanceKind;
  assetId: Types.ObjectId;
  planId: Types.ObjectId | null;
  ticketId: Types.ObjectId | null;
  status: ItMaintenanceOrderStatus;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  performedByUserId: Types.ObjectId | null;
  vendorId: Types.ObjectId | null;
  cost: number | null;
  summary: string | null;
  assetStatusBefore: ItAssetStatus | null;
  /**
   * Denormalized from the asset at creation, so "this branch's maintenance board" needs no join —
   * the `it_asset_assignments.branchId` precedent, and for the same reason (§7: `branchId` on the
   * asset is the anchor a branch-scoped technician reads through).
   *
   * NOT re-synced when the asset later transfers branches. Like an assignment row, an order records
   * where the work was RAISED; retro-stamping it would rewrite which branch did the repair.
   */
  branchId: Types.ObjectId;
}

const orderSchema = new Schema<ItMaintenanceOrderDoc>(
  {
    orderCode: { type: String, required: true },
    kind: { type: String, required: true, enum: IT_MAINTENANCE_KINDS },
    assetId: { type: Schema.Types.ObjectId, required: true },
    planId: { type: Schema.Types.ObjectId, default: null },
    ticketId: { type: Schema.Types.ObjectId, default: null },
    status: {
      type: String,
      required: true,
      enum: IT_MAINTENANCE_ORDER_STATUSES,
      default: 'open',
    },
    scheduledFor: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    performedByUserId: { type: Schema.Types.ObjectId, default: null },
    vendorId: { type: Schema.Types.ObjectId, default: null },
    cost: { type: Number, default: null },
    summary: { type: String, default: null },
    assetStatusBefore: { type: String, enum: [...IT_ASSET_STATUSES, null], default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code is permanent and never reused (FR-1) — unique across deleted rows too.
orderSchema.index({ orderCode: 1 }, { unique: true, name: 'ux_order_code' });
orderSchema.index({ assetId: 1, status: 1 }, { name: 'ix_asset_status' });
// The branch board: "what is open in my branch", the scoped list's own index.
orderSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
orderSchema.index({ ticketId: 1 }, { name: 'ix_ticket', sparse: true });
// §4.6's idempotency question: "does this plan already have an order that is not finished?".
orderSchema.index(
  { planId: 1, status: 1 },
  { name: 'ix_plan_status', partialFilterExpression: { isDeleted: false } },
);

export const ItMaintenanceOrderModel = model<ItMaintenanceOrderDoc>(
  'ItMaintenanceOrder',
  orderSchema,
  'it_maintenance_orders',
);

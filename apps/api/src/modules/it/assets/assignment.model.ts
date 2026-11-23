// `it_asset_assignments` — custody intervals (design §2.5).
//
// One row per period an asset was out. `returnedAt === null` means the interval is OPEN, and the
// asset carries its id as `currentAssignmentId`.
//
// The invariant that matters is "at most ONE open interval per asset", and it is enforced by a
// partial unique index rather than by the service that happens to write it (ADR-021). A guard in
// code loses the race: two concurrent assigns both read `inStock`, both pass, and both insert.
// The index makes that second insert a database error instead of a silently corrupt custody chain.
//
// The holder is an EMPLOYEE, or — since 2026-11-19 — a DEPARTMENT kept at a PLACE and signed for by
// its responsible person («في عهدة إدارة … — الموقع …»): «أعينها فى مكان بس تبقى على عهده الإدارة ..
// زى السيرفرات والكاميرات والسويتشات». Separate fields, the mobile lines' precedent, never the signer
// in `assignedToEmployeeId`: that would make a department's server the signer's own custody — on
// the holder column, the leavers' panels and the «already held» checks. Every interval written
// before carries no `holderKind` and reads `employee` (`custody-holder.ts`); nothing is migrated.
import { Schema, model, type Types } from 'mongoose';
import { IT_ASSET_HOLDER_KINDS, type ItAssetHolderKind } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItAssetAssignmentDoc extends BaseDocFields {
  assetId: Types.ObjectId;
  /** `employee` or `department`. ABSENT on every interval before 2026-11-19 — read `?? 'employee'`. */
  holderKind?: ItAssetHolderKind;
  /** The employee holder; null only on a department interval. */
  assignedToEmployeeId: Types.ObjectId | null;
  /** A department interval: the platform department that holds it (any branch's). */
  departmentId?: Types.ObjectId | null;
  /** …the place («المواقع») it is kept at — always in the interval's own `branchId`… */
  locationId?: Types.ObjectId | null;
  /** …and the current employee who signed for the department. */
  responsibleEmployeeId?: Types.ObjectId | null;
  assignedByUserId: Types.ObjectId | null;
  assignedAt: Date;
  conditionOnIssue: string | null;
  expectedReturnAt: Date | null;
  returnedAt: Date | null;
  returnedToUserId: Types.ObjectId | null;
  conditionOnReturn: string | null;
  notes: string | null;
  /** Denormalized from the asset so the "assets out per branch" read needs no join. */
  branchId: Types.ObjectId;
  /**
   * The custody receipt (إيصال استلام) the interval was handed over on (FR-18). `null` for an
   * interval opened before receipts existed — optional in the type for the same reason.
   */
  receiptId?: Types.ObjectId | null;
}

/** Whether the row being validated is a department interval — the holder fields' one switch. */
function heldByDepartment(this: { holderKind?: ItAssetHolderKind }): boolean {
  return this.holderKind === 'department';
}

/** An employee interval names its employee — the invariant the schema keeps for both kinds. */
function heldByEmployee(this: { holderKind?: ItAssetHolderKind }): boolean {
  return this.holderKind !== 'department';
}

const assignmentSchema = new Schema<ItAssetAssignmentDoc>(
  {
    assetId: { type: Schema.Types.ObjectId, required: true },
    holderKind: { type: String, enum: IT_ASSET_HOLDER_KINDS, default: 'employee' },
    assignedToEmployeeId: { type: Schema.Types.ObjectId, default: null, required: heldByEmployee },
    departmentId: { type: Schema.Types.ObjectId, default: null, required: heldByDepartment },
    locationId: { type: Schema.Types.ObjectId, default: null, required: heldByDepartment },
    responsibleEmployeeId: {
      type: Schema.Types.ObjectId,
      default: null,
      required: heldByDepartment,
    },
    assignedByUserId: { type: Schema.Types.ObjectId, default: null },
    assignedAt: { type: Date, required: true },
    conditionOnIssue: { type: String, default: null },
    expectedReturnAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    returnedToUserId: { type: Schema.Types.ObjectId, default: null },
    conditionOnReturn: { type: String, default: null },
    notes: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    receiptId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// THE custody invariant, in the only place that can actually hold it under concurrency.
assignmentSchema.index(
  { assetId: 1 },
  {
    unique: true,
    name: 'ux_open_assignment_per_asset',
    partialFilterExpression: { returnedAt: null, isDeleted: false },
  },
);
// The asset's custody list, newest first.
assignmentSchema.index({ assetId: 1, assignedAt: -1 }, { name: 'ix_asset_assignedAt' });
// "What does this person hold?" — the exit-checklist question (§9.1) and the holder's own view.
assignmentSchema.index(
  { assignedToEmployeeId: 1, returnedAt: 1 },
  { name: 'ix_employee_open' },
);
// Branch-scoped reads of everything currently out.
assignmentSchema.index({ branchId: 1, returnedAt: 1 }, { name: 'ix_branch_open' });
// Department custody's three questions — what a department holds, what is kept at a place («إيه
// اللي في غرفة السيرفرات»), what a person signed for. Partial, so the employee intervals (every row
// before 2026-11-19) cost them nothing; a query uses one only when it names its field's id.
assignmentSchema.index(
  { departmentId: 1, returnedAt: 1 },
  { name: 'ix_department_open', partialFilterExpression: { departmentId: { $type: 'objectId' } } },
);
assignmentSchema.index(
  { locationId: 1, returnedAt: 1 },
  { name: 'ix_location_open', partialFilterExpression: { locationId: { $type: 'objectId' } } },
);
assignmentSchema.index(
  { responsibleEmployeeId: 1, returnedAt: 1 },
  {
    name: 'ix_responsible_open',
    partialFilterExpression: { responsibleEmployeeId: { $type: 'objectId' } },
  },
);

export const ItAssetAssignmentModel = model<ItAssetAssignmentDoc>(
  'ItAssetAssignment',
  assignmentSchema,
  'it_asset_assignments',
);

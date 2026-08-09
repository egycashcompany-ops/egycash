// `it_asset_assignments` — custody intervals (design §2.5).
//
// One row per period an asset was out. `returnedAt === null` means the interval is OPEN, and the
// asset carries its id as `currentAssignmentId`.
//
// The invariant that matters is "at most ONE open interval per asset", and it is enforced by a
// partial unique index rather than by the service that happens to write it (ADR-021). A guard in
// code loses the race: two concurrent assigns both read `inStock`, both pass, and both insert.
// The index makes that second insert a database error instead of a silently corrupt custody chain.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItAssetAssignmentDoc extends BaseDocFields {
  assetId: Types.ObjectId;
  assignedToEmployeeId: Types.ObjectId;
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
}

const assignmentSchema = new Schema<ItAssetAssignmentDoc>(
  {
    assetId: { type: Schema.Types.ObjectId, required: true },
    assignedToEmployeeId: { type: Schema.Types.ObjectId, required: true },
    assignedByUserId: { type: Schema.Types.ObjectId, default: null },
    assignedAt: { type: Date, required: true },
    conditionOnIssue: { type: String, default: null },
    expectedReturnAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    returnedToUserId: { type: Schema.Types.ObjectId, default: null },
    conditionOnReturn: { type: String, default: null },
    notes: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
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

export const ItAssetAssignmentModel = model<ItAssetAssignmentDoc>(
  'ItAssetAssignment',
  assignmentSchema,
  'it_asset_assignments',
);

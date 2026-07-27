// Shared schema fragments every stage record carries, in the style of `baseFields`.
//   • placement snapshot — immutable, written at creation (RW4)
//   • attempt markers    — the append-only re-attempt mechanism (RW13/I12)
import { Schema, type Types } from 'mongoose';

export interface StagePlacement {
  jobPositionId: Types.ObjectId | null;
  jobTitleId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  sectionId: Types.ObjectId | null;
}

export interface StagePlacementLabel {
  position: string | null;
  branch: string | null;
  department: string | null;
}

export const placementSchema = new Schema<StagePlacement>(
  {
    jobPositionId: { type: Schema.Types.ObjectId, default: null },
    jobTitleId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    sectionId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

export const placementLabelSchema = new Schema<StagePlacementLabel>(
  {
    position: { type: String, default: null },
    branch: { type: String, default: null },
    department: { type: String, default: null },
  },
  { _id: false },
);

export const emptyPlacement = (): StagePlacement => ({
  jobPositionId: null,
  jobTitleId: null,
  departmentId: null,
  branchId: null,
  sectionId: null,
});

export const emptyPlacementLabel = (): StagePlacementLabel => ({
  position: null,
  branch: null,
  department: null,
});

/** Fields every stage record carries so the engine can drive it uniformly. */
export const stageFields = {
  attempt: { type: Number, required: true, default: 1 },
  supersededAt: { type: Date, default: null },
  supersededBy: { type: Schema.Types.ObjectId, default: null },
  supersededByReturnId: { type: String, default: null },
  placementSnapshot: { type: placementSchema, default: emptyPlacement },
  placementSnapshotLabel: { type: placementLabelSchema, default: emptyPlacementLabel },
} as const;

export interface StageDocFields {
  attempt: number;
  supersededAt: Date | null;
  supersededBy: Types.ObjectId | null;
  supersededByReturnId: string | null;
  placementSnapshot: StagePlacement;
  placementSnapshotLabel: StagePlacementLabel;
}

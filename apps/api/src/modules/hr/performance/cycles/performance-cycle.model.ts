// One round of reviewing (P-HR-PRF D1, D2, D3, D8).
//
// THE CYCLE CARRIES NO PERSON, and that is why it declares no `departmentId`. It NAMES branches and
// departments in its scope, which is a different thing: a scope is a set the round is addressed to,
// not the placement of a row. `performance-scope-guards.spec.ts` requires the two axes on every
// collection that carries a person and explicitly exempts this one, the same way Training's guard
// exempts the course and the session.
//
// THE SCALE IS STORED HERE (D8) rather than compiled in, so §8 Q5 is a question the owner answers
// with data instead of a release. A review copies the scale it was rated on when it finalizes; two
// rounds run on different rulers can then at least be told apart, which a bare number could not.
import { Schema, model, type Types } from 'mongoose';
import {
  PERFORMANCE_CYCLE_STATUSES,
  type LocalizedString,
  type PerformanceCycleStatus,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

/** A named point on the scale. Not every point has to have one — see `PerformanceScaleSchema`. */
export interface PerformanceScaleLabel {
  value: number;
  name: LocalizedString;
}

export interface PerformanceCycleDoc extends BaseDocFields {
  name: LocalizedString;
  /** The period being ASSESSED, which is not when the assessing happens. */
  periodStart: Date;
  periodEnd: Date;
  status: PerformanceCycleStatus;
  /** `everyone`, or the branches and departments this round was addressed to (D3). */
  scopeKind: 'everyone' | 'filter';
  scopeBranchIds: Types.ObjectId[];
  scopeDepartmentIds: Types.ObjectId[];
  scaleMin: number;
  scaleMax: number;
  scaleLabels: PerformanceScaleLabel[];
  /** Advisory. Nothing closes a review on a date — that would be a decision nobody has given. */
  dueAt: Date | null;
  note: string | null;
  openedAt: Date | null;
  openedBy: Types.ObjectId | null;
  /** What the materializer wrote. The round's receipt, in the shape the payroll run's is. */
  reviewCount: number;
  closedAt: Date | null;
  closedBy: Types.ObjectId | null;
  closeNote: string | null;
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const scaleLabelSchema = new Schema<PerformanceScaleLabel>(
  { value: { type: Number, required: true }, name: { type: localized, required: true } },
  { _id: false },
);

const performanceCycleSchema = new Schema<PerformanceCycleDoc>(
  {
    ...baseFields,
    name: { type: localized, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: PERFORMANCE_CYCLE_STATUSES,
      required: true,
      default: 'draft',
    },
    scopeKind: { type: String, enum: ['everyone', 'filter'], required: true, default: 'filter' },
    scopeBranchIds: { type: [Schema.Types.ObjectId], default: [] },
    scopeDepartmentIds: { type: [Schema.Types.ObjectId], default: [] },
    scaleMin: { type: Number, required: true, default: 1 },
    scaleMax: { type: Number, required: true, default: 5 },
    scaleLabels: { type: [scaleLabelSchema], default: [] },
    dueAt: { type: Date, default: null },
    note: { type: String, default: null },
    openedAt: { type: Date, default: null },
    openedBy: { type: Schema.Types.ObjectId, default: null },
    reviewCount: { type: Number, required: true, default: 0 },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    closeNote: { type: String, default: null },
  },
  baseSchemaOptions,
);

performanceCycleSchema.index({ status: 1, periodEnd: -1 }, { name: 'ix_status_periodEnd' });

export const PerformanceCycleModel = model<PerformanceCycleDoc>(
  'HrPerformanceCycle',
  performanceCycleSchema,
  'hr_performance_cycles',
);

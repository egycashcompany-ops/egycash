// Regularization requests (v1.1 §2/§7) — the ONLY channel that changes a day, and it changes it
// the ADR-027 way: on final approval the proposal becomes manual punches, the old punches are
// superseded, and the day is recomputed. The document itself is what Payroll's retro engine will
// read for `postFreeze` corrections (P-HR-08) — the frozen row never moves.
import { Schema, model, type Types } from 'mongoose';
import { type AttendanceRegularizationStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface AttendanceRegularizationDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  workDate: Date;
  proposedInAt: Date;
  proposedOutAt: Date;
  reason: string;
  status: AttendanceRegularizationStatus;
  /** Stamped at FINAL approval when the day was frozen (§7) — the forward-adjustment marker. */
  postFreeze: boolean;
  /** D7 HR direct edit: filed and applied by HR in one act, mandatory reason audited. */
  direct: boolean;
  managerDecidedBy: Types.ObjectId | null;
  managerDecidedAt: Date | null;
  managerComment: string | null;
  hrDecidedBy: Types.ObjectId | null;
  hrDecidedAt: Date | null;
  hrComment: string | null;
  cancelledAt: Date | null;
  branchId: Types.ObjectId | null;
}

const regularizationSchema = new Schema<AttendanceRegularizationDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    workDate: { type: Date, required: true },
    proposedInAt: { type: Date, required: true },
    proposedOutAt: { type: Date, required: true },
    reason: { type: String, required: true },
    status: { type: String, required: true },
    postFreeze: { type: Boolean, required: true, default: false },
    direct: { type: Boolean, required: true, default: false },
    managerDecidedBy: { type: Schema.Types.ObjectId, default: null },
    managerDecidedAt: { type: Date, default: null },
    managerComment: { type: String, default: null },
    hrDecidedBy: { type: Schema.Types.ObjectId, default: null },
    hrDecidedAt: { type: Date, default: null },
    hrComment: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

regularizationSchema.index({ employeeId: 1, workDate: 1 }, { name: 'ix_employee_workDate' });
regularizationSchema.index({ status: 1 }, { name: 'ix_status' });

export const AttendanceRegularizationModel = model<AttendanceRegularizationDoc>(
  'AttendanceRegularization',
  regularizationSchema,
  'hr_attendance_regularizations',
);

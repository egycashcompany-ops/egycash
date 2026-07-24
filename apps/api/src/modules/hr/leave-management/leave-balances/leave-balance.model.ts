// Balance cache + THE atomic reservation gate (frozen design §4, R1). One row per
// (employee, banked type, leave-year). `available = granted + carriedOver + adjusted −
// reserved − consumed`; the ONLY way days are reserved is the conditional update in the
// balance service. Rebuildable from the ledger.
import { Schema, type Types, model } from 'mongoose';

export interface LeaveBalanceDoc {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** The BANKED type this row banks (requests arrive via their balanceTypeId). */
  typeId: Types.ObjectId;
  year: number;
  granted: number;
  carriedOver: number;
  adjusted: number;
  reserved: number;
  consumed: number;
  createdAt: Date;
  updatedAt: Date;
}

const balanceSchema = new Schema<LeaveBalanceDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    typeId: { type: Schema.Types.ObjectId, required: true },
    year: { type: Number, required: true },
    granted: { type: Number, required: true, default: 0 },
    carriedOver: { type: Number, required: true, default: 0 },
    adjusted: { type: Number, required: true, default: 0 },
    reserved: { type: Number, required: true, default: 0 },
    consumed: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

balanceSchema.index({ employeeId: 1, typeId: 1, year: 1 }, { unique: true, name: 'ux_employee_type_year' });

export const LeaveBalanceModel = model<LeaveBalanceDoc>(
  'LeaveBalance',
  balanceSchema,
  'hr_leave_balances',
);

export const availableOf = (b: Pick<LeaveBalanceDoc, 'granted' | 'carriedOver' | 'adjusted' | 'reserved' | 'consumed'>): number =>
  b.granted + b.carriedOver + b.adjusted - b.reserved - b.consumed;

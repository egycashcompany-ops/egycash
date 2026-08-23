// The ATM machine master — legacy collection `atm` (models/atm.js).
//
// Field-for-field parity with two deliberate changes recorded in the port doc:
//   · `branchId` is NEW — legacy separated branches by deployment, not by data (decision D-branch).
//   · uniqueness of `machineCode` per branch is an INDEX — legacy had none and guarded only by a
//     read-then-insert in the bulk add (contad_app.js:2429-2451), which races. The legacy delete
//     renames the code to `<code>-D` (:2500) precisely so the code can return; with a partial
//     index over live rows the rename is kept for parity of the stored data, and the index holds
//     regardless.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AtmMachineDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  /** Legacy `bank` — a label from the ATM bank list, denormalized onto the machine. */
  bankName: string;
  /** Legacy `mach_id`, normalized (trimmed, no leading zeros). */
  machineCode: string;
  name: string;
  /** Legacy `zone` — every live write path stores '' (contad_app.js:2443); kept for parity. */
  zone: string;
  area: string;
  /** Legacy `status: 1` — /all_atm and the mail reader read only active machines. */
  isActive: boolean;
}

const machineSchema = new Schema<AtmMachineDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    bankName: { type: String, required: true },
    machineCode: { type: String, required: true },
    name: { type: String, required: true },
    zone: { type: String, required: true, default: '' },
    area: { type: String, required: true },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

machineSchema.index(
  { branchId: 1, machineCode: 1 },
  { unique: true, name: 'ux_branch_code', partialFilterExpression: { isDeleted: false } },
);
machineSchema.index({ branchId: 1, isActive: 1, area: 1 }, { name: 'ix_branch_active_area' });

export const AtmMachineModel = model<AtmMachineDoc>('AtmMachine', machineSchema, 'atm_machines');

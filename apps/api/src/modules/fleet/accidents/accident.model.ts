// Accidents (fleet design §2.8, §4.6, FR-10). The stored COLOR of the legacy became a real
// status enum; both directions of open↔closed are legal and audited. Amounts are typed numbers
// entered as facts; «إجمالي المتبقي» is derived on read (`fleetAccidentRemaining`), together with
// what transfers moved in from and out to other cars' files.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { FLEET_ACCIDENT_STATUSES, type FleetAccidentStatus } from '@ecms/contracts';

/**
 * One share of a transfer: how much was drawn from ONE of the source car's files.
 *
 * A transfer names a car; the car's «المتبقي» only exists as the sum over its files, so the amount
 * has to come off particular files for every figure — row, filtered strip, car — to agree. It is
 * drawn oldest first, and these lines are what was drawn from where.
 */
export interface FleetAccidentTransferLine {
  accidentId: Types.ObjectId;
  amount: number;
}

/**
 * «خدت من مين» — an amount moved INTO this file from another car's remaining.
 *
 * Kept on the receiving file, so the file and what it took are one document and one version.
 * Removing a transfer does not delete it: `voidedAt` is set and every figure stops counting it —
 * deleted data stays in the database and is never shown.
 */
export interface FleetAccidentTransfer {
  _id: Types.ObjectId;
  fromVehicleId: Types.ObjectId;
  /** The source car's code AT THE TIME — the log reads the same after a car is renumbered. */
  fromVehicleCode: string;
  amount: number;
  lines: FleetAccidentTransferLine[];
  at: Date;
  by: Types.ObjectId | null;
  /** Who recorded it, as their name read then — the log's «بواسطة». */
  byName: string | null;
  voidedAt: Date | null;
  voidedBy: Types.ObjectId | null;
  /** Why it stopped counting: removed from the log, or a file on either side was deleted. */
  voidReason: 'removed' | 'fileDeleted' | null;
}

export interface FleetAccidentDoc extends BaseDocFields {
  /** `null` ONLY on a file from the old book for a car the registry never had — see the odometer log. */
  vehicleId: Types.ObjectId | null;
  /** The old book's car code, set only where `vehicleId` is null. */
  vehicleCode: string | null;
  /** `null` ONLY on a file from the old book that recorded no date; every new file has one. */
  occurredAt: Date | null;
  culprit: string;
  culpritEmployeeId: Types.ObjectId | null;
  /** Every driver of ours at fault; the first is `culpritEmployeeId`. Absent on older files. */
  culpritEmployeeIds?: Types.ObjectId[];
  statement: string;
  companyCost: number;
  amountCollected: number;
  paidAmount: number;
  /** Every transfer this file received, live and voided. Optional: files before this had none. */
  transfersIn?: FleetAccidentTransfer[];
  /** Σ of the LIVE `transfersIn` amounts — kept beside them in the same write, for sort and sums. */
  transferredIn?: number;
  /** Σ of the live transfer lines drawn from THIS file — kept in the same transaction as them. */
  transferredOut?: number;
  status: FleetAccidentStatus;
  notes: string | null;
}

const transferLineSchema = new Schema<FleetAccidentTransferLine>(
  {
    accidentId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const transferSchema = new Schema<FleetAccidentTransfer>({
  fromVehicleId: { type: Schema.Types.ObjectId, required: true },
  fromVehicleCode: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  lines: { type: [transferLineSchema], default: [] },
  at: { type: Date, required: true },
  by: { type: Schema.Types.ObjectId, default: null },
  byName: { type: String, default: null },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: Schema.Types.ObjectId, default: null },
  voidReason: { type: String, enum: ['removed', 'fileDeleted', null], default: null },
});

const accidentSchema = new Schema<FleetAccidentDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    occurredAt: { type: Date, default: null },
    culprit: { type: String, required: true },
    culpritEmployeeId: { type: Schema.Types.ObjectId, default: null },
    culpritEmployeeIds: { type: [Schema.Types.ObjectId], default: [] },
    statement: { type: String, required: true },
    companyCost: { type: Number, required: true, min: 0 },
    amountCollected: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    transfersIn: { type: [transferSchema], default: [] },
    transferredIn: { type: Number, default: 0, min: 0 },
    transferredOut: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: FLEET_ACCIDENT_STATUSES, required: true },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

accidentSchema.index({ vehicleId: 1, occurredAt: -1 }, { name: 'ix_vehicle_occurred' });
accidentSchema.index({ status: 1 }, { name: 'ix_status' });
// «every accident this driver caused» — the exact question the culprit picker asks, and the one
// the name substring could only guess at. Declared here rather than as `index: true` on the path,
// because every index in this module is NAMED: an unnamed one cannot be checked for presence.
accidentSchema.index({ culpritEmployeeId: 1, occurredAt: -1 }, { name: 'ix_culprit_occurred' });
// …and every file ANY of several drivers caused.
accidentSchema.index({ culpritEmployeeIds: 1, occurredAt: -1 }, { name: 'ix_culprits_occurred' });
// «ادت ل مين» — the files that took from a car: one car's log reads them by the SOURCE car.
accidentSchema.index({ 'transfersIn.fromVehicleId': 1 }, { name: 'ix_transfer_from' });
// «who drew from this file» — what deleting a file, or moving it to another car, has to find.
accidentSchema.index({ 'transfersIn.lines.accidentId': 1 }, { name: 'ix_transfer_lines' });

export const FleetAccidentModel = model<FleetAccidentDoc>(
  'FleetAccident',
  accidentSchema,
  'fleet_accidents',
);

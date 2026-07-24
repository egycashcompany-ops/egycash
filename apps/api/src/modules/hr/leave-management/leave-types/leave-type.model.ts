// Leave Type catalog (frozen design §2) — law and policy as DATA. Every entitlement amount,
// approval shape, counting mode and pay tier is a field here; seeded Egyptian Labor Law
// defaults are editable configuration (L4: HR verifies before production). Deactivated, never
// hard-deleted — history keeps referencing a type.
import { Schema, model } from 'mongoose';
import {
  type LeaveApprovalShape,
  type LeaveAttachmentStage,
  type LeaveBalanceSource,
  type LeaveCarryoverMode,
  type LeaveCountingMode,
  type LeaveEntitlementStep,
  type LeavePayModel,
  type LeavePayTier,
  type LocalizedString,
} from '@ecms/contracts';
import { type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface LeaveTypeDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  payModel: LeavePayModel;
  payTiers: LeavePayTier[];
  balanceSource: LeaveBalanceSource;
  balanceTypeId: Types.ObjectId | null;
  baseDays: number | null;
  entitlementSteps: LeaveEntitlementStep[];
  ageStepAge: number | null;
  ageStepDays: number | null;
  minServiceMonths: number;
  gender: 'male' | 'female' | null;
  maxPerService: number | null;
  allowedDuringProbation: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
  maxPerYearDays: number | null;
  maxPerOccasionDays: number | null;
  backdateDays: number;
  requiresAttachment: boolean;
  attachmentStage: LeaveAttachmentStage;
  allowHalfDay: boolean;
  countingMode: LeaveCountingMode;
  affectsEmployeeStatus: boolean;
  statusThresholdDays: number | null;
  approvalShape: LeaveApprovalShape;
  carryoverMode: LeaveCarryoverMode;
  carryoverCapDays: number | null;
  carryoverExpiryMonths: number | null;
  negativeCapDays: number;
  active: boolean;
  sortOrder: number;
}

const leaveTypeSchema = new Schema<LeaveTypeDoc>(
  {
    code: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    payModel: { type: String, required: true, default: 'paid' },
    payTiers: {
      type: [new Schema({ days: Number, payRate: Number }, { _id: false })],
      default: [],
    },
    balanceSource: { type: String, required: true, default: 'self' },
    balanceTypeId: { type: Schema.Types.ObjectId, ref: 'LeaveType', default: null },
    baseDays: { type: Number, default: null },
    entitlementSteps: {
      type: [new Schema({ afterServiceYears: Number, days: Number }, { _id: false })],
      default: [],
    },
    ageStepAge: { type: Number, default: null },
    ageStepDays: { type: Number, default: null },
    minServiceMonths: { type: Number, required: true, default: 0 },
    gender: { type: String, default: null },
    maxPerService: { type: Number, default: null },
    allowedDuringProbation: { type: Boolean, required: true, default: true },
    minNoticeDays: { type: Number, required: true, default: 0 },
    maxConsecutiveDays: { type: Number, default: null },
    maxPerYearDays: { type: Number, default: null },
    maxPerOccasionDays: { type: Number, default: null },
    backdateDays: { type: Number, required: true, default: 0 },
    requiresAttachment: { type: Boolean, required: true, default: false },
    attachmentStage: { type: String, required: true, default: 'beforeApproval' },
    allowHalfDay: { type: Boolean, required: true, default: false },
    countingMode: { type: String, required: true, default: 'workdays' },
    affectsEmployeeStatus: { type: Boolean, required: true, default: false },
    statusThresholdDays: { type: Number, default: null },
    approvalShape: { type: String, required: true, default: 'managerOnly' },
    carryoverMode: { type: String, required: true, default: 'carryAll' },
    carryoverCapDays: { type: Number, default: null },
    carryoverExpiryMonths: { type: Number, default: null },
    negativeCapDays: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true, default: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

leaveTypeSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);

export const LeaveTypeModel = model<LeaveTypeDoc>('LeaveType', leaveTypeSchema, 'hr_leave_types');

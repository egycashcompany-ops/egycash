// `it_mobile_lines` — the company's SIM lines (FR-19): «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز
// أعملهم صفحة لإدارتهم وتسليمهم».
//
// A register of its own beside the assets, not rows inside it: a line is a number on a network's
// business account, not a device with a category, a serial and a specifications table, and every
// read of `it_assets` (the custody register, the people's counts, the asset delete guard) assumes
// a device.
//
// `status` is DERIVED, as an asset's is (FR-2): the named actions move it and nothing else does.
// The line carries no employee id — who holds it lives on the custody interval alone, so a
// workforce reset that purges the intervals leaves no person's id behind on the line itself.
import { Schema, model, type Types } from 'mongoose';
import {
  IT_MOBILE_LINE_STATUSES,
  IT_MOBILE_NETWORKS,
  IT_MOBILE_SIM_KINDS,
  type ItMobileLineStatus,
  type ItMobileNetwork,
  type ItMobileSimKind,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItMobileLineDoc extends BaseDocFields {
  network: ItMobileNetwork;
  /** The 11-digit local number, ASCII — unique in the register. */
  phoneNumber: string;
  accountNumber: string | null;
  ratePlan: string | null;
  simKind: ItMobileSimKind;
  /** The ICCID — null for an eSIM, which has no card to read one from. */
  simSerial: string | null;
  status: ItMobileLineStatus;
  /** The data-scope anchor, as an asset's branch is. */
  branchId: Types.ObjectId;
  /**
   * Head of the OPEN custody interval, `null` unless `assigned`. A read convenience: the interval
   * collection is the truth, and «one open interval per line» is its partial unique index.
   */
  currentAssignmentId: Types.ObjectId | null;
  notes: string | null;
}

const mobileLineSchema = new Schema<ItMobileLineDoc>(
  {
    network: { type: String, enum: IT_MOBILE_NETWORKS, required: true },
    phoneNumber: { type: String, required: true },
    accountNumber: { type: String, default: null },
    ratePlan: { type: String, default: null },
    simKind: { type: String, enum: IT_MOBILE_SIM_KINDS, required: true, default: 'physical' },
    simSerial: { type: String, default: null },
    status: { type: String, enum: IT_MOBILE_LINE_STATUSES, required: true, default: 'inStock' },
    branchId: { type: Schema.Types.ObjectId, required: true },
    currentAssignmentId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A number is one line. The database holds that, so two people registering the same number at
// once get a conflict instead of two rows for one SIM.
mobileLineSchema.index(
  { phoneNumber: 1 },
  { unique: true, name: 'ux_phone_number', partialFilterExpression: { isDeleted: false } },
);
// The card's ICCID is unique when there is one. An eSIM stores null rather than the word «eSIM»:
// a partial filter cannot say `$ne`, and a repeated literal would collide on every eSIM line.
mobileLineSchema.index(
  { simSerial: 1 },
  {
    unique: true,
    name: 'ux_sim_serial',
    partialFilterExpression: { isDeleted: false, simSerial: { $type: 'string' } },
  },
);
// Branch-scoped reads by state — the register's own filter.
mobileLineSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
// The register's default order: by network, then by number.
mobileLineSchema.index({ network: 1, phoneNumber: 1 }, { name: 'ix_network_number' });

export const ItMobileLineModel = model<ItMobileLineDoc>(
  'ItMobileLine',
  mobileLineSchema,
  'it_mobile_lines',
);

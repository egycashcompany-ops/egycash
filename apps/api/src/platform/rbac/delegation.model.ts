// A direct, per-site grant: the permission keys one account holds in one branch, handed out by a
// manager who holds them there (ADR-032).
//
// No role in between. A role is a company-wide bundle an administrator curates; a delegation is
// what «مدير الحركة» ticks for one of his people in one site, and the two sites he follows are two
// records that say nothing about each other. Always branch scope, always exactly one branch.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface DelegatedGrantDoc extends BaseDocFields {
  userId: Types.ObjectId;
  branchId: Types.ObjectId;
  /** Registered permission keys. Never empty on a live row — an empty list is a removed grant. */
  permissionKeys: string[];
  /** Who last wrote the list. Null for a system write. */
  grantedBy: Types.ObjectId | null;
}

const delegatedGrantSchema = new Schema<DelegatedGrantDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    permissionKeys: { type: [String], required: true, default: [] },
    grantedBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);
delegatedGrantSchema.index({ userId: 1 }, { name: 'ix_userId' });
// The fan-out «everyone holding X in site B» reads this: keys are indexed inside the array.
delegatedGrantSchema.index({ branchId: 1, permissionKeys: 1 }, { name: 'ix_branchId_permissionKeys' });
// One live record per (account, site) — the site's table, replaced whole on every write.
delegatedGrantSchema.index(
  { userId: 1, branchId: 1 },
  { unique: true, name: 'ux_userId_branchId', partialFilterExpression: { isDeleted: false } },
);

export const DelegatedGrantModel = model<DelegatedGrantDoc>(
  'DelegatedGrant',
  delegatedGrantSchema,
  'delegated_grants',
);

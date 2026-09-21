// A direct grant over one UNIT: the permission keys one account holds in one department of one
// branch — or, when the grant is made by somebody who holds the whole branch, in the branch as a
// whole — handed out by a manager who holds them there (ADR-032, Gap 1).
//
// No role in between. A role is a company-wide bundle an administrator curates; a delegation is
// what «مدير الحركة» ticks for one of his people in one site, and the two sites he follows are two
// records that say nothing about each other. A branch on its own never means "every department in
// it" for a delegate unless the grant says so, and only a whole-branch holder can say so.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface DelegatedGrantDoc extends BaseDocFields {
  userId: Types.ObjectId;
  /**
   * The branch the grant sits in — or `null` when it is not about one branch at all, which is
   * only the «this department, everywhere» shape below.
   */
  branchId: Types.ObjectId | null;
  /**
   * The department copy (in `branchId`) the grant is confined to — or `null` for the whole branch.
   * Rows written before the field existed carry no value and read as `null`: whole-branch grants,
   * which is exactly what they were.
   */
  departmentId: Types.ObjectId | null;
  /**
   * The company-wide department (ADR-031) this grant is about, when it reaches every branch.
   *
   * The third shape a delegation can take, and the one a general manager needs: «الحركة، في كل
   * الفروع» — his own authority, handed to a deputy in one row instead of one row per branch. The
   * owner asked for it in as many words: «هيدى نفس اللى هو ماسك، ليه، نايب يعتبر». Without it he
   * would tick five branches by hand, and the sixth branch somebody opens next month would be
   * invisible to the deputy — the same reason «الفرع كله» exists one axis over.
   */
  departmentCatalogId: Types.ObjectId | null;
  /** Set only with `departmentCatalogId`: the grant follows that department into every branch. */
  allBranches: boolean;
  /** Registered permission keys. Never empty on a live row — an empty list is a removed grant. */
  permissionKeys: string[];
  /** Who last wrote the list. Null for a system write. */
  grantedBy: Types.ObjectId | null;
}

const delegatedGrantSchema = new Schema<DelegatedGrantDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    departmentCatalogId: { type: Schema.Types.ObjectId, default: null },
    allBranches: { type: Boolean, default: false },
    permissionKeys: { type: [String], required: true, default: [] },
    grantedBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);
delegatedGrantSchema.index({ userId: 1 }, { name: 'ix_userId' });
// The fan-out «everyone holding X in site B» reads this: keys are indexed inside the array.
delegatedGrantSchema.index({ branchId: 1, permissionKeys: 1 }, { name: 'ix_branchId_permissionKeys' });
// One live record per (account, unit) — the unit's table, replaced whole on every write. A
// whole-branch row carries `null`, which the index treats as one value beside the departments.
// Replaces `ux_userId_branchId`, which allowed one row per branch only; the boot step drops it.
delegatedGrantSchema.index(
  { userId: 1, branchId: 1, departmentId: 1, departmentCatalogId: 1 },
  {
    unique: true,
    name: 'ux_userId_unit',
    partialFilterExpression: { isDeleted: false },
  },
);
// «This department, everywhere» is read by catalog rather than by branch, so the branch index
// above cannot serve it: the fan-out «who holds X over الحركة in every branch» has no branch to
// look under.
delegatedGrantSchema.index(
  { departmentCatalogId: 1, permissionKeys: 1 },
  { name: 'ix_departmentCatalogId_permissionKeys' },
);

/**
 * The indexes this schema has replaced — dropped at boot when still present (see bootstrap).
 *
 * `ux_userId_branchId` allowed one row per branch, before a grant could name a department.
 * `ux_userId_branchId_department` allowed one per department in a branch, before a grant could
 * name a department in EVERY branch — two such grants would collide on `(userId, null, null)`.
 */
export const SUPERSEDED_DELEGATION_INDEXES = [
  'ux_userId_branchId',
  'ux_userId_branchId_department',
] as const;

export const DelegatedGrantModel = model<DelegatedGrantDoc>(
  'DelegatedGrant',
  delegatedGrantSchema,
  'delegated_grants',
);

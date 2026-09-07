// The schema half of an org-unit CATALOG (P-ORG-2) — the company's own list of departments and of
// sections, each entry named once for the whole company.
//
// A catalog entry is NOT an org unit. It carries no branch, no manager, no acting-manager window
// and no materialized path, because it is not a place anybody works: it is the company's word for
// a kind of department. Where that department actually exists is the `departments` row that names
// it, which keeps every field a unit has today.
//
// Shaped after the cost-centre catalog, which is the same idea already in this codebase: an
// organization-wide list with a unique code among the living and no hierarchy of its own.
//
// SCHEMA HELPERS ONLY. Nothing here imports the audit service or the event bus — this file is
// pulled in at schema-definition time by both catalog MODELS, and `org-unit.ts` carries a comment
// about the cycle that closes when a model reaches the audit surface. The service half lives in
// `org-catalog.service.ts`, which no model imports.
import { Schema } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { localizedField } from './org-unit';

export interface OrgCatalogDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  description: LocalizedString | null;
  status: 'active' | 'inactive';
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

export const orgCatalogFields = {
  code: { type: String, required: true, uppercase: true, trim: true },
  name: localizedField,
  description: { type: localizedSubSchema, default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  ...baseFields,
} as const;

export { baseSchemaOptions };

/** Unique among the living, exactly as the job-title and cost-centre catalogs do it. */
export const addOrgCatalogIndexes = (schema: Schema): void => {
  schema.index(
    { code: 1 },
    { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
  );
  schema.index({ status: 1 }, { name: 'ix_status' });
};

// The company's sections, named once (P-ORG-2), each belonging to a company-wide DEPARTMENT entry.
//
// The parent is the department CATALOG entry, never a branch's department row: «العد والفرز» is a
// section of Operations for the whole company, and hanging that fact off one branch's copy of
// Operations would make a company-level statement the property of whichever branch happened to be
// created first.
import { Schema, model, type Types } from 'mongoose';
import {
  addOrgCatalogIndexes,
  baseSchemaOptions,
  orgCatalogFields,
  type OrgCatalogDoc,
} from '../shared/org-catalog';

export interface SectionCatalogDoc extends OrgCatalogDoc {
  departmentCatalogId: Types.ObjectId;
}

const sectionCatalogSchema = new Schema<SectionCatalogDoc>(
  {
    ...orgCatalogFields,
    departmentCatalogId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
addOrgCatalogIndexes(sectionCatalogSchema);
sectionCatalogSchema.index(
  { departmentCatalogId: 1, status: 1 },
  { name: 'ix_departmentCatalogId_status' },
);

export const SectionCatalogModel = model<SectionCatalogDoc>(
  'SectionCatalog',
  sectionCatalogSchema,
  'section_catalog',
);

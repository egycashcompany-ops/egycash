// The company's departments, named once (P-ORG-2). See `shared/org-catalog.ts` for what a catalog
// entry is and, more importantly, what it is not.
import { Schema, model } from 'mongoose';
import {
  addOrgCatalogIndexes,
  baseSchemaOptions,
  orgCatalogFields,
  type OrgCatalogDoc,
} from '../shared/org-catalog';

export type DepartmentCatalogDoc = OrgCatalogDoc;

const departmentCatalogSchema = new Schema<DepartmentCatalogDoc>(
  { ...orgCatalogFields },
  baseSchemaOptions,
);
addOrgCatalogIndexes(departmentCatalogSchema);

export const DepartmentCatalogModel = model<DepartmentCatalogDoc>(
  'DepartmentCatalog',
  departmentCatalogSchema,
  'department_catalog',
);

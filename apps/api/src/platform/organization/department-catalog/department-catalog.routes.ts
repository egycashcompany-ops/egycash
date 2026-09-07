import { makeOrgCatalogRouter } from '../shared/org-catalog.http';
import {
  departmentCatalogHandlers,
  departmentCatalogHttpConfig,
} from './department-catalog.controller';

export const buildDepartmentCatalogRouter = (): ReturnType<typeof makeOrgCatalogRouter> =>
  makeOrgCatalogRouter(departmentCatalogHttpConfig, departmentCatalogHandlers);

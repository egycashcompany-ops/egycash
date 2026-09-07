import {
  CreateDepartmentCatalogSchema,
  UpdateDepartmentCatalogSchema,
  type DepartmentCatalogDto,
} from '@ecms/contracts';
import { makeOrgCatalogHandlers, type OrgCatalogHttpConfig } from '../shared/org-catalog.http';
import { departmentCatalogService, toDepartmentCatalogDto } from './department-catalog.service';
import { type DepartmentCatalogDoc } from './department-catalog.model';

export const departmentCatalogHttpConfig: OrgCatalogHttpConfig<
  DepartmentCatalogDoc,
  DepartmentCatalogDto
> = {
  // The unit's own resource — see the comment at the top of `org-catalog.http.ts`.
  resource: 'department',
  service: departmentCatalogService,
  toDto: toDepartmentCatalogDto,
  createSchema: CreateDepartmentCatalogSchema,
  updateSchema: UpdateDepartmentCatalogSchema,
  basePath: '/api/v1/platform/department-catalog',
};

export const departmentCatalogHandlers = makeOrgCatalogHandlers(departmentCatalogHttpConfig);

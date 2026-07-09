import { Types } from 'mongoose';
import { type DepartmentDto } from '@ecms/contracts';
import { CreateDepartmentSchema, UpdateDepartmentSchema } from './department.validation';
import { makeOrgUnitHandlers, type OrgUnitHttpConfig } from '../shared/org-unit.http';
import { departmentService, toDepartmentDto } from './department.service';
import { type DepartmentDoc } from './department.model';

export const departmentHttpConfig: OrgUnitHttpConfig<DepartmentDoc, DepartmentDto> = {
  resource: 'department',
  service: departmentService,
  toDto: toDepartmentDto,
  createSchema: CreateDepartmentSchema,
  updateSchema: UpdateDepartmentSchema,
  listFilter: (query) =>
    query.branchId === undefined ? {} : { branchId: new Types.ObjectId(query.branchId) },
  basePath: '/api/v1/platform/departments',
};

export const departmentHandlers = makeOrgUnitHandlers(departmentHttpConfig);

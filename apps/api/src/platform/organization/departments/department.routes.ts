import { makeOrgUnitRouter } from '../shared/org-unit.http';
import { departmentHandlers, departmentHttpConfig } from './department.controller';

export const buildDepartmentsRouter = (): ReturnType<typeof makeOrgUnitRouter> =>
  makeOrgUnitRouter(departmentHttpConfig, departmentHandlers);

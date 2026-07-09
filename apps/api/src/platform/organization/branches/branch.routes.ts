import { makeOrgUnitRouter } from '../shared/org-unit.http';
import { branchHandlers, branchHttpConfig } from './branch.controller';

export const buildBranchesRouter = (): ReturnType<typeof makeOrgUnitRouter> =>
  makeOrgUnitRouter(branchHttpConfig, branchHandlers);

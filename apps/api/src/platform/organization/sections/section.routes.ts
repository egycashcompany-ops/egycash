import { makeOrgUnitRouter } from '../shared/org-unit.http';
import { sectionHandlers, sectionHttpConfig } from './section.controller';

export const buildSectionsRouter = (): ReturnType<typeof makeOrgUnitRouter> =>
  makeOrgUnitRouter(sectionHttpConfig, sectionHandlers);

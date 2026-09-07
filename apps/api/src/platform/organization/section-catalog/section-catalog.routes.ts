import { makeOrgCatalogRouter } from '../shared/org-catalog.http';
import { sectionCatalogHandlers, sectionCatalogHttpConfig } from './section-catalog.controller';

export const buildSectionCatalogRouter = (): ReturnType<typeof makeOrgCatalogRouter> =>
  makeOrgCatalogRouter(sectionCatalogHttpConfig, sectionCatalogHandlers);

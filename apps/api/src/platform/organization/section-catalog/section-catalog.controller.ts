import { Types } from 'mongoose';
import {
  CreateSectionCatalogSchema,
  UpdateSectionCatalogSchema,
  type SectionCatalogDto,
} from '@ecms/contracts';
import { makeOrgCatalogHandlers, type OrgCatalogHttpConfig } from '../shared/org-catalog.http';
import { sectionCatalogService, toSectionCatalogDto } from './section-catalog.service';
import { type SectionCatalogDoc } from './section-catalog.model';

export const sectionCatalogHttpConfig: OrgCatalogHttpConfig<SectionCatalogDoc, SectionCatalogDto> =
  {
    resource: 'section',
    service: sectionCatalogService,
    toDto: toSectionCatalogDto,
    createSchema: CreateSectionCatalogSchema,
    updateSchema: UpdateSectionCatalogSchema,
    // `?departmentId=` narrows to one department CATALOG entry — the list query's existing parameter,
    // reused rather than a second one meaning almost the same thing.
    listFilter: (query) =>
      query.departmentId === undefined
        ? {}
        : { departmentCatalogId: new Types.ObjectId(query.departmentId) },
    basePath: '/api/v1/platform/section-catalog',
  };

export const sectionCatalogHandlers = makeOrgCatalogHandlers(sectionCatalogHttpConfig);

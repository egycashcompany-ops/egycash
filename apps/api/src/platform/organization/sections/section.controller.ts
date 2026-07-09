import { Types } from 'mongoose';
import { type SectionDto } from '@ecms/contracts';
import { CreateSectionSchema, UpdateSectionSchema } from './section.validation';
import { makeOrgUnitHandlers, type OrgUnitHttpConfig } from '../shared/org-unit.http';
import { sectionService, toSectionDto } from './section.service';
import { type SectionDoc } from './section.model';

export const sectionHttpConfig: OrgUnitHttpConfig<SectionDoc, SectionDto> = {
  resource: 'section',
  service: sectionService,
  toDto: toSectionDto,
  createSchema: CreateSectionSchema,
  updateSchema: UpdateSectionSchema,
  listFilter: (query) => ({
    ...(query.branchId === undefined ? {} : { branchId: new Types.ObjectId(query.branchId) }),
    ...(query.departmentId === undefined
      ? {}
      : { departmentId: new Types.ObjectId(query.departmentId) }),
  }),
  basePath: '/api/v1/platform/sections',
};

export const sectionHandlers = makeOrgUnitHandlers(sectionHttpConfig);

// `/api/v1/platform/org-chart` (P-ORG-3). The read is open to whoever may see the chart page
// (`department.view`) or work on job titles — the job form's department and section selects read it,
// and a job editor may lack `department.view` (§4.4, ADR-038). The section writes take the section
// keys (§1.3); job places are written through the job title's own endpoints, never here (§5.2).
import { Router } from 'express';
import { z } from 'zod';
import {
  AddChartSectionSchema,
  RenameChartSectionSchema,
  StopChartSectionSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../auth';
import { authorize, authorizeAny } from '../../rbac';
import { addChartSection, getOrgChart, renameChartSection, stopChartSection } from './org-chart.controller';

const SectionParamSchema = z.object({ sectionCatalogId: objectId() }).strict();

export const buildOrgChartRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('department.view', 'jobTitle.view', 'jobTitle.create', 'jobTitle.edit'),
    asyncHandler(getOrgChart),
  );
  router.post(
    '/sections',
    authenticate,
    authorize('section.create'),
    validate({ body: AddChartSectionSchema }),
    asyncHandler(addChartSection),
  );
  router.patch(
    '/sections/:sectionCatalogId',
    authenticate,
    authorize('section.edit'),
    validate({ body: RenameChartSectionSchema, params: SectionParamSchema }),
    asyncHandler(renameChartSection),
  );
  router.post(
    '/sections/:sectionCatalogId/stop',
    authenticate,
    authorize('section.edit'),
    validate({ body: StopChartSectionSchema, params: SectionParamSchema }),
    asyncHandler(stopChartSection),
  );
  return router;
};

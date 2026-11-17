// `/api/v1/platform/org-chart` (P-ORG-3). The read is open to whoever may see the chart page
// (`department.view`) or work on job titles — the job form's department and section selects read it,
// and a job editor may lack `department.view` (§4.4, ADR-038).
import { Router } from 'express';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { authenticate } from '../../auth';
import { authorizeAny } from '../../rbac';
import { getOrgChart } from './org-chart.controller';

export const buildOrgChartRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('department.view', 'jobTitle.view', 'jobTitle.create', 'jobTitle.edit'),
    asyncHandler(getOrgChart),
  );
  return router;
};

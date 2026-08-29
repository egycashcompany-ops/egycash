// Router: authenticate → authorize → validate → controller.
//
// TWO KEYS AND NEITHER IS AN EMPLOYEE KEY (D3). `medicalRecord.view` reads and
// `medicalRecord.manage` writes, and holding `employee.view`, `employee.edit` or every other HR
// permission in the system grants neither. A line manager who may read somebody's attendance,
// salary band and contract may not read their blood type.
//
// `medicalCheck.*` is RECRUITMENT's key, about an applicant's pre-employment exam (D1). Different
// subject, different question, different door — and `medical-visibility.spec.ts` refuses to let
// this feature borrow it.
import { Router } from 'express';
import { z } from 'zod';
import {
  ListMedicalProfilesQuerySchema,
  UpsertMedicalProfileSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  getMedicalProfile,
  getMyMedicalProfile,
  listMedicalProfiles,
  upsertMedicalProfile,
} from './medical.controller';

const EmployeeIdParamSchema = z.object({ employeeId: objectId() }).strict();

export const buildMedicalProfilesRouter = (): Router => {
  const router = Router();
  /**
   * D5 — every employee login, no key.
   *
   * DECLARED BEFORE `/:employeeId`, because Express matches in order and the id route would
   * otherwise swallow `me`. That is the trap `/platform/job-titles/options` fell into, answering
   * 404 to two shipped screens.
   *
   * There is no permission here on purpose: gating your own health record behind
   * `medicalRecord.view` would mean you could read it only if you could also read everybody's.
   */
  router.get('/me', authenticate, asyncHandler(getMyMedicalProfile));
  router.get(
    '/',
    authenticate,
    authorize('medicalRecord.view'),
    validate({ query: ListMedicalProfilesQuerySchema }),
    asyncHandler(listMedicalProfiles),
  );
  router.get(
    '/:employeeId',
    authenticate,
    authorize('medicalRecord.view'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getMedicalProfile),
  );
  /**
   * One endpoint for create and correct, because there is one row per person and «has anybody
   * written anything yet» is not a distinction the caller should have to make. A profile is
   * corrected rather than versioned — it says what is true now (D6).
   *
   * PATCH rather than PUT because every field in the body is optional: an HR officer recording only
   * a blood type must not thereby erase the allergies somebody else recorded last year. The verb
   * matches the schema, and both match every other write in this codebase.
   */
  router.patch(
    '/:employeeId',
    authenticate,
    authorize('medicalRecord.manage'),
    validate({ body: UpsertMedicalProfileSchema, params: EmployeeIdParamSchema }),
    asyncHandler(upsertMedicalProfile),
  );
  return router;
};

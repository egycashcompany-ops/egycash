// Licences (design §7, §12).
//
// `itLicense.view` returns the licence KEY in plain text. That is §13-Q5's adopted decision —
// masking with a reveal-with-audit endpoint was considered at design approval and rejected — so
// there is deliberately NO reveal route here, and the permission is the whole boundary.
//
// No DELETE: a licence is a purchase record. Installations point at it forever.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItLicenseSchema,
  ListItLicensesQuerySchema,
  ListItSoftwareInstallationsQuerySchema,
  UpdateItLicenseSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItLicense,
  getItLicense,
  listItLicenseInstallations,
  listItLicenses,
  updateItLicense,
} from './license.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
/** The path already names the licence, so the query may not name a second one. */
const SeatsQuerySchema = ListItSoftwareInstallationsQuerySchema.omit({ licenseId: true });

export const buildItLicensesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itLicense.view'),
    validate({ query: ListItLicensesQuerySchema }),
    asyncHandler(listItLicenses),
  );
  router.post(
    '/',
    authenticate,
    authorize('itLicense.manage'),
    validate({ body: CreateItLicenseSchema }),
    asyncHandler(createItLicense),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itLicense.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItLicense),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itLicense.manage'),
    validate({ body: UpdateItLicenseSchema, params: IdParamSchema }),
    asyncHandler(updateItLicense),
  );
  // The list behind `seatsUsed`. Reading it needs the SOFTWARE grant, because the rows are
  // installations — a licence viewer who cannot see installations sees the count and not the names.
  router.get(
    '/:id/installations',
    authenticate,
    authorize('itSoftware.view'),
    validate({ query: SeatsQuerySchema, params: IdParamSchema }),
    asyncHandler(listItLicenseInstallations),
  );
  return router;
};

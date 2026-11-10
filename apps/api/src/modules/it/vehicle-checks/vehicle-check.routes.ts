// Vehicle device check routes (FR-21; docs/12-planning/it-vehicle-checks-design.md §6.1).
//
// The phone form rides `itVehicleCheck.create`, its one grant: listing the active cars, filing a
// report and adding photos to one's own report. The car list is IT's own endpoint, so a reporter
// needs neither `fleetVehicle.view` nor `itAsset.view`.
//
// The dashboard (2026-11-10, «الـ Dashboard … هتبقي عند الـ IT») rides `itVehicleCheck.view` for
// every read — the figures, the list, one report and its photos — and `itVehicleCheck.delete` for
// removing a wrong report. Neither is implied by the form's grant: a reporter files and never reads
// back. The literal segments come before '/:id', so the id matcher never swallows them.
import { Router } from 'express';
import {
  CreateItVehicleCheckSchema,
  ItVehicleCheckDashboardQuerySchema,
  ItVehicleCheckIdParamSchema,
  ItVehicleCheckPhotoFieldsSchema,
  ItVehicleCheckPhotoParamSchema,
  ListItVehicleChecksQuerySchema,
  PaginationQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { signedCopyUpload } from '../assets/receipt.controller';
import {
  addItVehicleCheckPhoto,
  deleteItVehicleCheck,
  fileItVehicleCheck,
  getItVehicleCheck,
  getItVehicleCheckDashboard,
  getItVehicleCheckPhoto,
  listItVehicleCheckCars,
  listItVehicleChecks,
} from './vehicle-check.controller';

export const buildItVehicleChecksRouter = (): Router => {
  const router = Router();
  router.get(
    '/dashboard',
    authenticate,
    authorize('itVehicleCheck.view'),
    validate({ query: ItVehicleCheckDashboardQuerySchema }),
    asyncHandler(getItVehicleCheckDashboard),
  );
  router.get(
    '/vehicles',
    authenticate,
    authorize('itVehicleCheck.create'),
    validate({ query: PaginationQuerySchema }),
    asyncHandler(listItVehicleCheckCars),
  );
  router.get(
    '/',
    authenticate,
    authorize('itVehicleCheck.view'),
    validate({ query: ListItVehicleChecksQuerySchema }),
    asyncHandler(listItVehicleChecks),
  );
  router.post(
    '/',
    authenticate,
    authorize('itVehicleCheck.create'),
    validate({ body: CreateItVehicleCheckSchema }),
    asyncHandler(fileItVehicleCheck),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itVehicleCheck.view'),
    validate({ params: ItVehicleCheckIdParamSchema }),
    asyncHandler(getItVehicleCheck),
  );
  router.get(
    '/:id/photos/:fileId',
    authenticate,
    authorize('itVehicleCheck.view'),
    validate({ params: ItVehicleCheckPhotoParamSchema }),
    asyncHandler(getItVehicleCheckPhoto),
  );
  // The grant first, so a caller without it is refused before any byte is buffered; then the
  // multipart intake, whose text field `clientPhotoId` is validated beside the id.
  router.post(
    '/:id/photos',
    authenticate,
    authorize('itVehicleCheck.create'),
    signedCopyUpload(),
    validate({ params: ItVehicleCheckIdParamSchema, body: ItVehicleCheckPhotoFieldsSchema }),
    asyncHandler(addItVehicleCheckPhoto),
  );
  // The id param as the asset delete takes it — `{ id }`, strict.
  router.delete(
    '/:id',
    authenticate,
    authorize('itVehicleCheck.delete'),
    validate({ params: ItVehicleCheckIdParamSchema }),
    asyncHandler(deleteItVehicleCheck),
  );
  return router;
};

// Vehicle device check routes (FR-21; docs/12-planning/it-vehicle-checks-design.md §6.1). Every
// route rides `itVehicleCheck.create`, the form's one grant: listing the active cars, filing a
// report and adding photos to one's own report. The car list is IT's own endpoint, so a reporter
// needs neither `fleetVehicle.view` nor `itAsset.view`. Nothing here reads a report back — that
// comes with the dashboard and its `itVehicleCheck.view`.
import { Router } from 'express';
import {
  CreateItVehicleCheckSchema,
  ItVehicleCheckIdParamSchema,
  ItVehicleCheckPhotoFieldsSchema,
  PaginationQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { signedCopyUpload } from '../assets/receipt.controller';
import {
  addItVehicleCheckPhoto,
  fileItVehicleCheck,
  listItVehicleCheckCars,
} from './vehicle-check.controller';

export const buildItVehicleChecksRouter = (): Router => {
  const router = Router();
  router.get(
    '/vehicles',
    authenticate,
    authorize('itVehicleCheck.create'),
    validate({ query: PaginationQuerySchema }),
    asyncHandler(listItVehicleCheckCars),
  );
  router.post(
    '/',
    authenticate,
    authorize('itVehicleCheck.create'),
    validate({ body: CreateItVehicleCheckSchema }),
    asyncHandler(fileItVehicleCheck),
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
  return router;
};

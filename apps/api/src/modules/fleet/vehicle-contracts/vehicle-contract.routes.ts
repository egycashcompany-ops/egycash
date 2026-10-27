// «عقود توريد السيارات» — the screen's own grants: view, create, edit, delete, and `receive` for
// «تسجيل استلام» (separate from edit, as licensing separates «تم»). Static paths before `/:id`.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetVehicleContractSchema,
  FleetVehicleContractSummaryQuerySchema,
  ListFleetVehicleContractsQuerySchema,
  OrderFleetVehicleContractFilesSchema,
  SaveFleetVehicleContractDeliverySchema,
  UpdateFleetVehicleContractSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartSingle } from '../license-image-upload';
import {
  addVehicleContractDelivery,
  createVehicleContract,
  deleteVehicleContract,
  deleteVehicleContractDelivery,
  deleteVehicleContractFile,
  getVehicleContract,
  getVehicleContractFile,
  listVehicleContracts,
  orderVehicleContractFiles,
  updateVehicleContract,
  updateVehicleContractDelivery,
  uploadVehicleContractFile,
  vehicleContractSummary,
  vehicleContractSuppliers,
} from './vehicle-contract.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const DeliveryParamSchema = z.object({ id: objectId(), deliveryId: objectId() }).strict();
const FileParamSchema = z.object({ id: objectId(), fileId: objectId() }).strict();

const VIEW = 'fleetVehicleContract.view';

export const buildFleetVehicleContractsRouter = (): Router => {
  const router = Router();
  // «الإحصائيات» — over the whole filtered set, never a page.
  router.get(
    '/summary',
    authenticate,
    authorize(VIEW),
    validate({ query: FleetVehicleContractSummaryQuerySchema }),
    asyncHandler(vehicleContractSummary),
  );
  // The «المورد» filter's options.
  router.get('/suppliers', authenticate, authorize(VIEW), asyncHandler(vehicleContractSuppliers));
  router.get(
    '/',
    authenticate,
    authorize(VIEW),
    validate({ query: ListFleetVehicleContractsQuerySchema }),
    asyncHandler(listVehicleContracts),
  );
  router.get(
    '/:id',
    authenticate,
    authorize(VIEW),
    validate({ params: IdParamSchema }),
    asyncHandler(getVehicleContract),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetVehicleContract.create'),
    validate({ body: CreateFleetVehicleContractSchema }),
    asyncHandler(createVehicleContract),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetVehicleContract.edit'),
    validate({ body: UpdateFleetVehicleContractSchema, params: IdParamSchema }),
    asyncHandler(updateVehicleContract),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetVehicleContract.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteVehicleContract),
  );
  // «تسجيل استلام».
  router.post(
    '/:id/deliveries',
    authenticate,
    authorize('fleetVehicleContract.receive'),
    validate({ body: SaveFleetVehicleContractDeliverySchema, params: IdParamSchema }),
    asyncHandler(addVehicleContractDelivery),
  );
  router.patch(
    '/:id/deliveries/:deliveryId',
    authenticate,
    authorize('fleetVehicleContract.receive'),
    validate({ body: SaveFleetVehicleContractDeliverySchema, params: DeliveryParamSchema }),
    asyncHandler(updateVehicleContractDelivery),
  );
  router.delete(
    '/:id/deliveries/:deliveryId',
    authenticate,
    authorize('fleetVehicleContract.receive'),
    validate({ params: DeliveryParamSchema }),
    asyncHandler(deleteVehicleContractDelivery),
  );
  // «مرفقات العقد». The order before `/:id/files/:fileId`, which would read `order` as an id.
  router.put(
    '/:id/files/order',
    authenticate,
    authorize('fleetVehicleContract.edit'),
    validate({ body: OrderFleetVehicleContractFilesSchema, params: IdParamSchema }),
    asyncHandler(orderVehicleContractFiles),
  );
  // A new contract's pages are uploaded by its creator right after the save — create or edit.
  router.post(
    '/:id/files',
    authenticate,
    authorizeAny('fleetVehicleContract.create', 'fleetVehicleContract.edit'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadVehicleContractFile),
  );
  router.get(
    '/:id/files/:fileId',
    authenticate,
    authorize(VIEW),
    validate({ params: FileParamSchema }),
    asyncHandler(getVehicleContractFile),
  );
  router.delete(
    '/:id/files/:fileId',
    authenticate,
    authorize('fleetVehicleContract.edit'),
    validate({ params: FileParamSchema }),
    asyncHandler(deleteVehicleContractFile),
  );
  return router;
};

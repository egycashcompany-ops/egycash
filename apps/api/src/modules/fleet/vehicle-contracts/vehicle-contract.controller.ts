// Thin HTTP mapping only (ADR-003). Every read takes the server's clock as «اليوم», so the supply
// alarm a screen shows is the one its `alarm` filter selects.
import { type Request, type Response } from 'express';
import {
  type CreateFleetVehicleContract,
  type FleetVehicleContractSummaryQuery,
  type ListFleetVehicleContractsQuery,
  type OrderFleetVehicleContractFiles,
  type SaveFleetVehicleContractDelivery,
  type UpdateFleetVehicleContract,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { ValidationError } from '../../../shared/errors';
import { uploadFileName } from '../upload-file-name';
import { fleetVehicleContractAttachments as attachments } from './vehicle-contract-attachments';
import { fleetVehicleContractService as service } from './vehicle-contract.service';

type IdParam = { id: string };
type DeliveryParam = { id: string; deliveryId: string };
type FileParam = { id: string; fileId: string };

export const listVehicleContracts = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetVehicleContractsQuery>(req);
  okPage(res, await service.list(query, new Date()), (dto) => dto);
};

export const vehicleContractSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetVehicleContractSummaryQuery>(req);
  ok(res, await service.summary(query, new Date()));
};

export const vehicleContractSuppliers = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await service.suppliers());
};

export const getVehicleContract = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await service.get(params.id, new Date()));
};

export const createVehicleContract = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetVehicleContract>(req);
  created(res, await service.create(body, authContext(req).userId));
};

export const updateVehicleContract = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetVehicleContract, never, IdParam>(req);
  ok(res, await service.update(params.id, body, authContext(req).userId));
};

export const deleteVehicleContract = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await service.remove(params.id, authContext(req).userId);
  noContent(res);
};

export const addVehicleContractDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SaveFleetVehicleContractDelivery, never, IdParam>(req);
  created(res, await service.addDelivery(params.id, body, authContext(req).userId));
};

export const updateVehicleContractDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SaveFleetVehicleContractDelivery, never, DeliveryParam>(req);
  ok(
    res,
    await service.updateDelivery(params.id, params.deliveryId, body, authContext(req).userId),
  );
};

export const deleteVehicleContractDelivery = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, DeliveryParam>(req);
  ok(res, await service.removeDelivery(params.id, params.deliveryId, authContext(req).userId));
};

export const orderVehicleContractFiles = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<OrderFleetVehicleContractFiles, never, IdParam>(req);
  ok(res, await attachments.orderFiles(params.id, body));
};

export const uploadVehicleContractFile = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  // Multer reads the part's name as latin1; an Arabic «صفحة 1.png» is turned back here (D8), and
  // that decoded name is what the Files service stores, shows and searches.
  const file = await attachments.addFile(authContext(req), params.id, {
    originalName: uploadFileName(uploaded.originalname),
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  created(res, file);
};

export const getVehicleContractFile = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, FileParam>(req);
  const file = await attachments.readFile(authContext(req), params.id, params.fileId);
  res.setHeader('Content-Type', file.mime);
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
};

export const deleteVehicleContractFile = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, FileParam>(req);
  await attachments.removeFile(authContext(req), params.id, params.fileId);
  noContent(res);
};

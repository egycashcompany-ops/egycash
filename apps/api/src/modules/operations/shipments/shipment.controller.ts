// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CompleteOperationsShipment,
  type CreateOperationsShipment,
  type ListOperationsShipmentsQuery,
  type UpdateOperationsShipment,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toShipmentDto } from '../operations.mappers';
import { operationsShipmentService } from './shipment.service';

type IdParam = { id: string };

export const listShipments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsShipmentsQuery>(req);
  okPage(res, await operationsShipmentService.list(query), toShipmentDto);
};

export const getShipment = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toShipmentDto(await operationsShipmentService.getById(params.id)));
};

export const createShipment = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsShipment>(req);
  const doc = await operationsShipmentService.create(body, authContext(req).userId);
  created(res, toShipmentDto(doc));
};

export const updateShipment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsShipment, never, IdParam>(req);
  const doc = await operationsShipmentService.update(params.id, body, authContext(req).userId);
  ok(res, toShipmentDto(doc));
};

export const completeShipment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CompleteOperationsShipment, never, IdParam>(req);
  const doc = await operationsShipmentService.complete(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

export const reopenShipment = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CompleteOperationsShipment, never, IdParam>(req);
  const doc = await operationsShipmentService.reopen(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

export const deleteShipment = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await operationsShipmentService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};

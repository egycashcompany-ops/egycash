import { type Request, type Response } from 'express';
import {
  type CancelItMaintenanceOrder,
  type CompleteItMaintenanceOrder,
  type CreateItMaintenanceOrder,
  type ListItMaintenanceOrdersQuery,
  type StartItMaintenanceOrder,
  type UpdateItMaintenanceOrder,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItMaintenanceOrderDto, toItSparePartMovementDto } from '../it.mappers';
import { itMaintenanceOrderService } from './order.service';

type IdParam = { id: string };

export const listItMaintenanceOrders = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItMaintenanceOrdersQuery>(req);
  okPage(res, await itMaintenanceOrderService.list(query), toItMaintenanceOrderDto);
};

export const getItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItMaintenanceOrderDto(await itMaintenanceOrderService.getById(params.id)));
};

export const createItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItMaintenanceOrder>(req);
  const { order } = await itMaintenanceOrderService.create(body, authContext(req));
  created(res, toItMaintenanceOrderDto(order));
};

export const updateItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItMaintenanceOrder, never, IdParam>(req);
  const doc = await itMaintenanceOrderService.update(params.id, body, authContext(req));
  ok(res, toItMaintenanceOrderDto(doc));
};

export const startItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<StartItMaintenanceOrder, never, IdParam>(req);
  const doc = await itMaintenanceOrderService.start(params.id, body, authContext(req));
  ok(res, toItMaintenanceOrderDto(doc));
};

export const completeItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CompleteItMaintenanceOrder, never, IdParam>(req);
  const doc = await itMaintenanceOrderService.complete(params.id, body, authContext(req));
  ok(res, toItMaintenanceOrderDto(doc));
};

export const cancelItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CancelItMaintenanceOrder, never, IdParam>(req);
  const doc = await itMaintenanceOrderService.cancel(params.id, body, authContext(req));
  ok(res, toItMaintenanceOrderDto(doc));
};

/** The parts an order consumed — its movement rows, which are the single source (ADR-024). */
export const listItMaintenanceOrderParts = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const rows = await itMaintenanceOrderService.listParts(params.id);
  ok(res, rows.map(toItSparePartMovementDto));
};

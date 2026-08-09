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
import { scopeSelector } from '../../../shared/types';
import { toItMaintenanceOrderDto, toItSparePartMovementDto } from '../it.mappers';
import { itMaintenanceOrderService } from './order.service';

type IdParam = { id: string };

/**
 * Reads ride the maintenance grant's own scope. Using `itAsset.view` instead would fall back to
 * `own` for a technician who holds no asset grant, and `own` on a collection with no owner field
 * means "rows you created" — which is nobody's idea of a maintenance board.
 */
const readScope = (req: Request) => scopeSelector(authContext(req), 'itMaintenance.view');

export const listItMaintenanceOrders = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItMaintenanceOrdersQuery>(req);
  okPage(res, await itMaintenanceOrderService.list(query, readScope(req)), toItMaintenanceOrderDto);
};

export const getItMaintenanceOrder = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(
    res,
    toItMaintenanceOrderDto(await itMaintenanceOrderService.getById(params.id, readScope(req))),
  );
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
  const rows = await itMaintenanceOrderService.listParts(params.id, readScope(req));
  ok(res, rows.map(toItSparePartMovementDto));
};

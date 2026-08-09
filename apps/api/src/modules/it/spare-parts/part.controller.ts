import { type Request, type Response } from 'express';
import {
  type CreateItSparePart,
  type ListItSparePartMovementsQuery,
  type ListItSparePartsQuery,
  type ReceiveItSparePart,
  type UpdateItSparePart,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItSparePartDto, toItSparePartMovementDto } from '../it.mappers';
import { itSparePartService } from './part.service';

type IdParam = { id: string };

export const listItSpareParts = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItSparePartsQuery>(req);
  okPage(res, await itSparePartService.list(query), toItSparePartDto);
};

export const getItSparePart = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItSparePartDto(await itSparePartService.getById(params.id)));
};

export const createItSparePart = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItSparePart>(req);
  const doc = await itSparePartService.create(body, authContext(req));
  created(res, toItSparePartDto(doc));
};

export const updateItSparePart = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItSparePart, never, IdParam>(req);
  const doc = await itSparePartService.update(params.id, body, authContext(req));
  ok(res, toItSparePartDto(doc));
};

/** A receipt is a movement, and the response says so: the new on-hand AND the row that moved it. */
export const receiveItSparePart = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReceiveItSparePart, never, IdParam>(req);
  const { part, movement } = await itSparePartService.receive(params.id, body, authContext(req));
  created(res, {
    part: toItSparePartDto(part),
    movement: toItSparePartMovementDto(movement),
  });
};

/**
 * One part's ledger. The `partId` comes from the path, so a query that named a different one would
 * be answering a question nobody asked — the path wins.
 */
export const listItSparePartMovements = async (req: Request, res: Response): Promise<void> => {
  const { query, params } = validated<never, ListItSparePartMovementsQuery, IdParam>(req);
  const page = await itSparePartService.listMovements({ ...query, partId: params.id });
  okPage(res, page, toItSparePartMovementDto);
};

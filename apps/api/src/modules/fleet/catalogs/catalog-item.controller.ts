// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetCatalogItem,
  type ListFleetCatalogQuery,
  type UpdateFleetCatalogItem,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toCatalogItemDto } from '../fleet.mappers';
import { fleetCatalogItemService } from './catalog-item.service';

type IdParam = { id: string };

export const listCatalogItems = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetCatalogQuery>(req);
  okPage(res, await fleetCatalogItemService.list(query), toCatalogItemDto);
};

export const createCatalogItem = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetCatalogItem>(req);
  const doc = await fleetCatalogItemService.create(body, authContext(req).userId);
  created(res, toCatalogItemDto(doc));
};

export const updateCatalogItem = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetCatalogItem, never, IdParam>(req);
  const doc = await fleetCatalogItemService.update(params.id, body, authContext(req).userId);
  ok(res, toCatalogItemDto(doc));
};

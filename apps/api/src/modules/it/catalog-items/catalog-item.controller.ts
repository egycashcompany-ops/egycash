// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateItCatalogItem,
  type ListItCatalogQuery,
  type UpdateItCatalogItem,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItCatalogItemDto } from '../it.mappers';
import { itCatalogItemService } from './catalog-item.service';

type IdParam = { id: string };

export const listItCatalogItems = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItCatalogQuery>(req);
  okPage(res, await itCatalogItemService.list(query), toItCatalogItemDto);
};

export const createItCatalogItem = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItCatalogItem>(req);
  const doc = await itCatalogItemService.create(body, authContext(req).userId);
  created(res, toItCatalogItemDto(doc));
};

export const updateItCatalogItem = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItCatalogItem, never, IdParam>(req);
  const doc = await itCatalogItemService.update(params.id, body, authContext(req).userId);
  ok(res, toItCatalogItemDto(doc));
};

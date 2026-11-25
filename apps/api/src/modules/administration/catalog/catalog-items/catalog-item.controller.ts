// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateAdministrationCatalogItem,
  type ListAdministrationCatalogItemsQuery,
  type UpdateAdministrationCatalogItem,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { toAdministrationCatalogItemDto } from '../../administration.mappers';
import { administrationCatalogItemService } from './catalog-item.service';

type IdParam = { id: string };

export const listAdministrationCatalogItems = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { query } = validated<never, ListAdministrationCatalogItemsQuery>(req);
  okPage(res, await administrationCatalogItemService.list(query), toAdministrationCatalogItemDto);
};

export const createAdministrationCatalogItem = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body } = validated<CreateAdministrationCatalogItem>(req);
  const doc = await administrationCatalogItemService.create(body, authContext(req));
  created(res, toAdministrationCatalogItemDto(doc));
};

export const updateAdministrationCatalogItem = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationCatalogItem, never, IdParam>(req);
  const doc = await administrationCatalogItemService.update(params.id, body, authContext(req));
  ok(res, toAdministrationCatalogItemDto(doc));
};

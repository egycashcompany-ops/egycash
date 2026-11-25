// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateAdministrationItem,
  type ListAdministrationItemsQuery,
  type UpdateAdministrationItem,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { toAdministrationItemDto } from '../../administration.mappers';
import { administrationItemService } from './item.service';

type IdParam = { id: string };

export const listAdministrationItems = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAdministrationItemsQuery>(req);
  const page = await administrationItemService.list(query);
  const labels = await administrationItemService.labels(page.items);
  okPage(res, page, (doc) => toAdministrationItemDto(doc, labels));
};

export const getAdministrationItem = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await administrationItemService.getById(params.id);
  ok(res, toAdministrationItemDto(doc, await administrationItemService.labels([doc])));
};

export const createAdministrationItem = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAdministrationItem>(req);
  const doc = await administrationItemService.create(body, authContext(req));
  created(res, toAdministrationItemDto(doc, await administrationItemService.labels([doc])));
};

export const updateAdministrationItem = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationItem, never, IdParam>(req);
  const doc = await administrationItemService.update(params.id, body, authContext(req));
  ok(res, toAdministrationItemDto(doc, await administrationItemService.labels([doc])));
};

// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateAdministrationItemCategory,
  type ListAdministrationItemCategoriesQuery,
  type UpdateAdministrationItemCategory,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { toAdministrationItemCategoryDto } from '../../administration.mappers';
import { administrationItemCategoryService } from './item-category.service';

type IdParam = { id: string };

export const listAdministrationItemCategories = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { query } = validated<never, ListAdministrationItemCategoriesQuery>(req);
  const page = await administrationItemCategoryService.list(query);
  const parents = await administrationItemCategoryService.parentNames(page.items);
  okPage(res, page, (doc) => toAdministrationItemCategoryDto(doc, parents));
};

export const createAdministrationItemCategory = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body } = validated<CreateAdministrationItemCategory>(req);
  const doc = await administrationItemCategoryService.create(body, authContext(req));
  const parents = await administrationItemCategoryService.parentNames([doc]);
  created(res, toAdministrationItemCategoryDto(doc, parents));
};

export const updateAdministrationItemCategory = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationItemCategory, never, IdParam>(req);
  const doc = await administrationItemCategoryService.update(params.id, body, authContext(req));
  const parents = await administrationItemCategoryService.parentNames([doc]);
  ok(res, toAdministrationItemCategoryDto(doc, parents));
};

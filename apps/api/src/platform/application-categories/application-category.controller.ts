import { type Request, type Response } from 'express';
import {
  type CreateApplicationCategory,
  type ListApplicationCategoriesQuery,
  type UpdateApplicationCategory,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext } from '../auth';
import { applicationCategoryService } from './application-category.service';

type IdParam = { id: string };

export const listApplicationCategories = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListApplicationCategoriesQuery>(req);
  const page = await applicationCategoryService.list(query, scopeSelector(ctx, 'applicationCategory.view'));
  okPage(res, page, (doc) => applicationCategoryService.toDto(doc));
};

export const getApplicationCategory = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, applicationCategoryService.toDto(await applicationCategoryService.getById(params.id)));
};

export const createApplicationCategory = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateApplicationCategory>(req);
  const doc = await applicationCategoryService.create(body, ctx.userId);
  created(
    res,
    applicationCategoryService.toDto(doc),
    `/api/v1/platform/application-categories/${String(doc._id)}`,
  );
};

export const updateApplicationCategory = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateApplicationCategory, never, IdParam>(req);
  ok(
    res,
    applicationCategoryService.toDto(
      await applicationCategoryService.update(params.id, body, ctx.userId),
    ),
  );
};

export const deleteApplicationCategory = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await applicationCategoryService.softDelete(params.id, ctx.userId);
  noContent(res);
};

import { type Request, type Response } from 'express';
import {
  type CreateFileCategory,
  type PaginationQuery,
  type UpdateFileCategory,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { fileCategoryService } from './file-category.service';

type IdParam = { id: string };

export const listFileCategories = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, PaginationQuery>(req);
  const page = await fileCategoryService.list(query);
  okPage(res, page, (doc) => fileCategoryService.toDto(doc));
};

export const createFileCategory = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateFileCategory>(req);
  const doc = await fileCategoryService.create(body, ctx.userId);
  created(
    res,
    fileCategoryService.toDto(doc),
    `/api/v1/platform/file-categories/${String(doc._id)}`,
  );
};

export const updateFileCategory = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateFileCategory, never, IdParam>(req);
  ok(res, fileCategoryService.toDto(await fileCategoryService.update(params.id, body, ctx.userId)));
};

export const deleteFileCategory = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await fileCategoryService.softDelete(params.id, ctx.userId);
  noContent(res);
};

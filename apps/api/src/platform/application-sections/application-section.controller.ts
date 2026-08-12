import { type Request, type Response } from 'express';
import {
  type CreateApplicationSection,
  type ListApplicationSectionsQuery,
  type ReorderApplicationSections,
  type UpdateApplicationSection,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext } from '../auth';
import { applicationSectionService } from './application-section.service';

type IdParam = { id: string };

export const listApplicationSections = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListApplicationSectionsQuery>(req);
  const page = await applicationSectionService.list(
    query,
    scopeSelector(ctx, 'applicationCategory.view'),
  );
  okPage(res, page, (doc) => applicationSectionService.toDto(doc));
};

export const getApplicationSection = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, applicationSectionService.toDto(await applicationSectionService.getById(params.id)));
};

export const createApplicationSection = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateApplicationSection>(req);
  const doc = await applicationSectionService.create(body, ctx.userId);
  created(
    res,
    applicationSectionService.toDto(doc),
    `/api/v1/platform/application-sections/${String(doc._id)}`,
  );
};

export const updateApplicationSection = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateApplicationSection, never, IdParam>(req);
  ok(
    res,
    applicationSectionService.toDto(
      await applicationSectionService.update(params.id, body, ctx.userId),
    ),
  );
};

export const deleteApplicationSection = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await applicationSectionService.softDelete(params.id, ctx.userId);
  noContent(res);
};

/** Reorder by position — the client sends the order it wants, the server renumbers. */
export const reorderApplicationSections = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ReorderApplicationSections>(req);
  const docs = await applicationSectionService.reorder(body);
  ok(res, docs.map((doc) => applicationSectionService.toDto(doc)));
};

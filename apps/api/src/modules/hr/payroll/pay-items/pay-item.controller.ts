// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type CreatePayItem, type ListPayItemsQuery, type UpdatePayItem } from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { payItemService } from './pay-item.service';

type IdParam = { id: string };

export const listPayItems = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListPayItemsQuery, never>(req);
  const page = await payItemService.list(query, scopeSelector(ctx, 'payItem.view'));
  okPage(res, page, (doc) => payItemService.toDto(doc));
};

export const getPayItem = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, payItemService.toDto(await payItemService.getById(params.id)));
};

export const createPayItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreatePayItem, never, never>(req);
  const doc = await payItemService.create(body, ctx.userId);
  created(res, payItemService.toDto(doc), `/api/v1/hr/payroll/pay-items/${String(doc._id)}`);
};

export const updatePayItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdatePayItem, never, IdParam>(req);
  ok(res, payItemService.toDto(await payItemService.update(params.id, body, ctx.userId)));
};

export const deletePayItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await payItemService.softDelete(params.id, ctx.userId);
  noContent(res);
};

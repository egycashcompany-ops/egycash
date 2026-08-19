// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldDelivery,
  type GoldDocumentAction,
  type GoldNextNumberDto,
  type GoldPrintResultDto,
  type ListGoldDeliveryQuery,
  type UpdateGoldDelivery,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, ok, validated } from '../../../platform/web';
import { NotFoundError } from '../../../shared/errors';
import { scopeSelector } from '../../../shared/types';
import { goldBarRepository } from '../bars/bar.repository';
import { toGoldBarLineDto, toGoldDeliveryReceiptDto } from '../gold.mappers';
import { resolveGoldLabels } from '../shared/labels';
import { goldDeliveryService } from './delivery.service';

type IdParam = { id: string };

export const goldDeliveryNextNumber = async (_req: Request, res: Response): Promise<void> => {
  const payload: GoldNextNumberDto = { number: await goldDeliveryService.nextNumber() };
  ok(res, payload);
};

export const listGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldDeliveryQuery>(req);
  const ctx = authContext(req);
  const page = await goldDeliveryService.list(query, scopeSelector(ctx, 'goldDelivery.view'));
  const labels = await resolveGoldLabels({
    companyIds: page.items.map((r) => r.companyId),
    representativeIds: page.items.map((r) => r.representativeId),
    branches: true,
  });
  ok(
    res,
    page.items.map((doc) => toGoldDeliveryReceiptDto(doc, labels)),
    page.meta,
  );
};

export const getGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldDeliveryService.getById(params.id, scopeSelector(ctx, 'goldDelivery.view'));
  const [labels, bars] = await Promise.all([
    resolveGoldLabels({
      companyIds: [doc.companyId],
      representativeIds: [doc.representativeId],
      branches: true,
    }),
    goldBarRepository.findByIds(doc.barIds),
  ]);
  ok(res, toGoldDeliveryReceiptDto(doc, labels, bars.map(toGoldBarLineDto)));
};

export const createGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldDelivery>(req);
  const doc = await goldDeliveryService.create(body, authContext(req));
  created(res, toGoldDeliveryReceiptDto(doc));
};

export const updateGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldDelivery, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldDeliveryService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldDelivery.edit'),
  );
  ok(res, toGoldDeliveryReceiptDto(doc));
};

export const confirmGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GoldDocumentAction, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldDeliveryService.confirm(
    params.id,
    body.version,
    ctx.userId,
    scopeSelector(ctx, 'goldDelivery.confirm'),
  );
  ok(res, toGoldDeliveryReceiptDto(doc));
};

export const revertGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GoldDocumentAction, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldDeliveryService.revert(
    params.id,
    body.version,
    ctx.userId,
    scopeSelector(ctx, 'goldDelivery.revert'),
  );
  ok(res, toGoldDeliveryReceiptDto(doc));
};

export const printGoldDelivery = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const result = await goldDeliveryService.recordPrint(
    params.id,
    scopeSelector(ctx, 'goldDelivery.view'),
  );
  if (result === null) throw new NotFoundError();
  const payload: GoldPrintResultDto = {
    printCount: result.printCount,
    lastPrintedAt: result.lastPrintedAt.toISOString(),
  };
  ok(res, payload);
};

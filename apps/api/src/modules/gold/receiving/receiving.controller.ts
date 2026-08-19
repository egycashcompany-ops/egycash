// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldReceiving,
  type GoldDocumentAction,
  type GoldNextNumberDto,
  type GoldPrintResultDto,
  type ListGoldReceivingQuery,
  type UpdateGoldReceiving,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, ok, validated } from '../../../platform/web';
import { NotFoundError } from '../../../shared/errors';
import { scopeSelector } from '../../../shared/types';
import { toGoldReceivingReceiptDto } from '../gold.mappers';
import { resolveGoldLabels } from '../shared/labels';
import { goldReceivingService } from './receiving.service';

type IdParam = { id: string };

export const goldReceivingNextNumber = async (_req: Request, res: Response): Promise<void> => {
  const payload: GoldNextNumberDto = { number: await goldReceivingService.nextNumber() };
  ok(res, payload);
};

export const listGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldReceivingQuery>(req);
  const ctx = authContext(req);
  const page = await goldReceivingService.list(query, scopeSelector(ctx, 'goldReceiving.view'));
  const labels = await resolveGoldLabels({
    companyIds: page.items.map((r) => r.companyId),
    representativeIds: page.items.map((r) => r.representativeId),
    branches: true,
  });
  ok(
    res,
    page.items.map((doc) => toGoldReceivingReceiptDto(doc, labels)),
    page.meta,
  );
};

export const getGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldReceivingService.getById(
    params.id,
    scopeSelector(ctx, 'goldReceiving.view'),
  );
  const labels = await resolveGoldLabels({
    companyIds: [doc.companyId],
    representativeIds: [doc.companyDelegateId, doc.storageDelegateId, doc.representativeId],
    vaultCodeIds: doc.lines.map((line) => line.vaultId),
    drawerIds: doc.lines.map((line) => line.drawerId),
    branches: true,
  });
  ok(res, toGoldReceivingReceiptDto(doc, labels));
};

export const createGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldReceiving>(req);
  const doc = await goldReceivingService.create(body, authContext(req));
  created(res, toGoldReceivingReceiptDto(doc));
};

export const updateGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldReceiving, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldReceivingService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldReceiving.edit'),
  );
  ok(res, toGoldReceivingReceiptDto(doc));
};

export const confirmGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GoldDocumentAction, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldReceivingService.confirm(
    params.id,
    body.version,
    ctx.userId,
    scopeSelector(ctx, 'goldReceiving.confirm'),
  );
  ok(res, toGoldReceivingReceiptDto(doc));
};

export const revertGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GoldDocumentAction, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldReceivingService.revert(
    params.id,
    body.version,
    ctx.userId,
    scopeSelector(ctx, 'goldReceiving.revert'),
  );
  ok(res, toGoldReceivingReceiptDto(doc));
};

export const printGoldReceiving = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const result = await goldReceivingService.recordPrint(
    params.id,
    scopeSelector(ctx, 'goldReceiving.view'),
  );
  if (result === null) throw new NotFoundError();
  const payload: GoldPrintResultDto = {
    printCount: result.printCount,
    lastPrintedAt: result.lastPrintedAt.toISOString(),
  };
  ok(res, payload);
};

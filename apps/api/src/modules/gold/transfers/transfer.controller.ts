// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldTransfer,
  type GoldDocumentAction,
  type GoldNextNumberDto,
  type GoldPrintResultDto,
  type ListGoldTransfersQuery,
  type UpdateGoldTransfer,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, ok, validated } from '../../../platform/web';
import { NotFoundError } from '../../../shared/errors';
import { scopeSelector } from '../../../shared/types';
import { goldBarRepository } from '../bars/bar.repository';
import { toGoldBarLineDto, toGoldTransferDto } from '../gold.mappers';
import { resolveGoldLabels } from '../shared/labels';
import { goldTransferService } from './transfer.service';

type IdParam = { id: string };

export const goldTransferNextNumber = async (_req: Request, res: Response): Promise<void> => {
  const payload: GoldNextNumberDto = { number: await goldTransferService.nextNumber() };
  ok(res, payload);
};

export const listGoldTransfers = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldTransfersQuery>(req);
  const ctx = authContext(req);
  const page = await goldTransferService.list(query, scopeSelector(ctx, 'goldTransfer.view'));
  const labels = await resolveGoldLabels({
    companyIds: page.items.flatMap((t) => [t.currentOwnerId, t.newOwnerId]),
    branches: true,
  });
  ok(
    res,
    page.items.map((doc) => toGoldTransferDto(doc, labels)),
    page.meta,
  );
};

export const getGoldTransfer = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldTransferService.getById(params.id, scopeSelector(ctx, 'goldTransfer.view'));
  const [labels, bars] = await Promise.all([
    resolveGoldLabels({
      companyIds: [doc.currentOwnerId, doc.newOwnerId],
      representativeIds: [doc.currentOwnerDelegateId, doc.newOwnerDelegateId],
      branches: true,
    }),
    goldBarRepository.findByIds(doc.barIds),
  ]);
  ok(res, toGoldTransferDto(doc, labels, bars.map(toGoldBarLineDto)));
};

export const createGoldTransfer = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldTransfer>(req);
  const doc = await goldTransferService.create(body, authContext(req));
  created(res, toGoldTransferDto(doc));
};

export const updateGoldTransfer = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldTransfer, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldTransferService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldTransfer.edit'),
  );
  ok(res, toGoldTransferDto(doc));
};

export const confirmGoldTransfer = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GoldDocumentAction, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldTransferService.confirm(
    params.id,
    body.version,
    ctx.userId,
    scopeSelector(ctx, 'goldTransfer.confirm'),
  );
  ok(res, toGoldTransferDto(doc));
};

export const revertGoldTransfer = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GoldDocumentAction, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldTransferService.revert(
    params.id,
    body.version,
    ctx.userId,
    scopeSelector(ctx, 'goldTransfer.revert'),
  );
  ok(res, toGoldTransferDto(doc));
};

export const printGoldTransfer = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const result = await goldTransferService.recordPrint(
    params.id,
    scopeSelector(ctx, 'goldTransfer.view'),
  );
  if (result === null) throw new NotFoundError();
  const payload: GoldPrintResultDto = {
    printCount: result.printCount,
    lastPrintedAt: result.lastPrintedAt.toISOString(),
  };
  ok(res, payload);
};

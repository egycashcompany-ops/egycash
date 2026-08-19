// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldBar,
  type GoldBarFacetsDto,
  type GoldBarHistoryDto,
  type ListGoldBarsQuery,
  type UpdateGoldBar,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, validated } from '../../../platform/web';
import { scopeSelector } from '../../../shared/types';
import { toGoldBarDto, toGoldBarHistoryDto } from '../gold.mappers';
import { resolveGoldLabels } from '../shared/labels';
import { goldBarService } from './bar.service';

type IdParam = { id: string };

export const listGoldBars = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldBarsQuery>(req);
  const ctx = authContext(req);
  const page = await goldBarService.list(query, scopeSelector(ctx, 'goldBar.view'));
  const labels = await resolveGoldLabels({
    companyIds: page.items.map((b) => b.companyId),
    vaultCodeIds: page.items.map((b) => b.currentVaultId),
    drawerIds: page.items.map((b) => b.currentDrawerId),
    branches: true,
  });
  ok(
    res,
    page.items.map((bar) => toGoldBarDto(bar, labels)),
    page.meta,
  );
};

export const getGoldBar = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const bar = await goldBarService.getById(params.id, scopeSelector(ctx, 'goldBar.view'));
  const labels = await resolveGoldLabels({
    companyIds: [bar.companyId],
    vaultCodeIds: [bar.currentVaultId],
    drawerIds: [bar.currentDrawerId],
    branches: true,
  });
  ok(res, toGoldBarDto(bar, labels));
};

export const getGoldBarHistory = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const bar = await goldBarService.getById(params.id, scopeSelector(ctx, 'goldBar.view'));
  const payload: GoldBarHistoryDto = {
    serialNumber: bar.serialNumber,
    history: toGoldBarHistoryDto(bar),
  };
  ok(res, payload);
};

export const createGoldBar = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldBar>(req);
  const doc = await goldBarService.create(body, authContext(req).userId);
  created(res, toGoldBarDto(doc));
};

export const updateGoldBar = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldBar, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldBarService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldBar.edit'),
  );
  ok(res, toGoldBarDto(doc));
};

export const deleteGoldBar = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await goldBarService.remove(params.id, ctx.userId, scopeSelector(ctx, 'goldBar.edit'));
  noContent(res);
};

export const goldBarFacets = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const payload: GoldBarFacetsDto = {
    purities: await goldBarService.purities(scopeSelector(ctx, 'goldBar.view')),
  };
  ok(res, payload);
};

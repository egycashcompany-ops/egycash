// Thin HTTP mapping only (ADR-003). The labels endpoint answers with a PDF when the chromium
// driver is configured and with the printable HTML sheet otherwise — same content, two envelopes.
import { type Request, type Response } from 'express';
import {
  type CreateItAsset,
  type ItAssetLabels,
  type ListItAssetsQuery,
  type UpdateItAsset,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toItAssetDto } from '../it.mappers';
import { itAssetService } from './asset.service';

type IdParam = { id: string };
type CodeParam = { code: string };

export const listItAssets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItAssetsQuery>(req);
  const scope = scopeSelector(authContext(req), 'itAsset.view');
  okPage(res, await itAssetService.list(query, scope), toItAssetDto);
};

export const getItAsset = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const scope = scopeSelector(authContext(req), 'itAsset.view');
  ok(res, toItAssetDto(await itAssetService.getById(params.id, scope)));
};

export const getItAssetByCode = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, CodeParam>(req);
  const scope = scopeSelector(authContext(req), 'itAsset.view');
  ok(res, toItAssetDto(await itAssetService.getByCode(params.code, scope)));
};

export const createItAsset = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItAsset>(req);
  const doc = await itAssetService.register(body, authContext(req).userId);
  created(res, toItAssetDto(doc));
};

export const updateItAsset = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItAsset, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await itAssetService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'itAsset.edit'),
  );
  ok(res, toItAssetDto(doc));
};

export const deleteItAsset = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await itAssetService.remove(params.id, ctx.userId, scopeSelector(ctx, 'itAsset.delete'));
  noContent(res);
};

export const renderItAssetLabels = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ItAssetLabels>(req);
  const scope = scopeSelector(authContext(req), 'itAsset.view');
  const sheet = await itAssetService.renderLabels(body, scope);
  if (sheet.kind === 'pdf') {
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', 'attachment; filename="asset-labels.pdf"')
      .send(sheet.body);
    return;
  }
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(sheet.body);
};

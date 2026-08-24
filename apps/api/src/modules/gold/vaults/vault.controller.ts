// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldVault,
  type GenerateGoldLayout,
  type GoldDrawerCompanyDto,
  type GoldLayoutPreviewDto,
  type ListGoldVaultsQuery,
  type PreviewGoldLayout,
  type ReorderGoldItems,
  type UpdateGoldVault,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, validated } from '../../../platform/web';
import { scopeSelector } from '../../../shared/types';
import { goldCompanyRepository } from '../companies/company.repository';
import { goldFloorRepository } from '../floors/floor.repository';
import { toGoldBarDto, toGoldDrawerDto, toGoldVaultDto } from '../gold.mappers';
import { branchNames } from '../shared/ecms-refs';
import { goldVaultService } from './vault.service';

type IdParam = { id: string };

export const listGoldVaults = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldVaultsQuery>(req);
  const ctx = authContext(req);
  const page = await goldVaultService.list(query, scopeSelector(ctx, 'goldVault.view'));
  const [branches, floorDocs, counts] = await Promise.all([
    branchNames(),
    goldFloorRepository.listOrdered(),
    Promise.all(page.items.map(async (v) => goldVaultService.drawerCount(String(v._id)))),
  ]);
  const floors = new Map(floorDocs.map((f) => [String(f._id), f.name]));
  ok(
    res,
    page.items.map((vault, i) => toGoldVaultDto(vault, counts[i] ?? 0, { branches, floors })),
    page.meta,
  );
};

export const getGoldVault = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const vault = await goldVaultService.getById(params.id, scopeSelector(ctx, 'goldVault.view'));
  const [branches, floorDocs, count] = await Promise.all([
    branchNames(),
    goldFloorRepository.listOrdered(),
    goldVaultService.drawerCount(params.id),
  ]);
  const floors = new Map(floorDocs.map((f) => [String(f._id), f.name]));
  ok(res, toGoldVaultDto(vault, count, { branches, floors }));
};

export const createGoldVault = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldVault>(req);
  const doc = await goldVaultService.create(body, authContext(req));
  created(res, toGoldVaultDto(doc, 0));
};

export const updateGoldVault = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldVault, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldVaultService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldVault.edit'),
  );
  ok(res, toGoldVaultDto(doc, await goldVaultService.drawerCount(params.id)));
};

export const deleteGoldVault = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await goldVaultService.remove(params.id, ctx.userId, scopeSelector(ctx, 'goldVault.delete'));
  noContent(res);
};

export const previewGoldLayout = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewGoldLayout>(req);
  const drawers = await goldVaultService.previewLayout(body);
  const last = drawers[drawers.length - 1];
  const payload: GoldLayoutPreviewDto = {
    count: drawers.length,
    from: drawers[0]?.number ?? null,
    to: last?.number ?? null,
    drawers,
  };
  ok(res, payload);
};

export const generateGoldLayout = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GenerateGoldLayout, never, IdParam>(req);
  const ctx = authContext(req);
  const result = await goldVaultService.generateLayout(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldVault.edit'),
  );
  ok(res, {
    vault: toGoldVaultDto(result.vault, result.drawerCount),
    drawerCount: result.drawerCount,
  });
};

export const reshapeGoldLayout = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<GenerateGoldLayout, never, IdParam>(req);
  const ctx = authContext(req);
  const result = await goldVaultService.reshapeLayout(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldVault.edit'),
  );
  ok(res, {
    vault: toGoldVaultDto(result.vault, result.drawerCount),
    drawerCount: result.drawerCount,
  });
};

export const reorderGoldVaults = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ReorderGoldItems>(req);
  await goldVaultService.reorder(body);
  noContent(res);
};

export const listGoldVaultDrawers = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const { drawers, byDrawer } = await goldVaultService.listDrawers(
    params.id,
    scopeSelector(ctx, 'goldVault.view'),
  );
  const companyIds = [...byDrawer.values()].flat().map((entry) => entry.id);
  const names = await goldCompanyRepository.namesOf(companyIds);
  ok(
    res,
    drawers.map((drawer) => {
      const owners: GoldDrawerCompanyDto[] = (byDrawer.get(String(drawer._id)) ?? []).map(
        (entry) => ({ id: entry.id, name: names.get(entry.id) ?? '؟', count: entry.count }),
      );
      return toGoldDrawerDto(drawer, owners);
    }),
  );
};

export const getGoldDrawer = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const { drawer, bars } = await goldVaultService.getDrawer(
    params.id,
    scopeSelector(ctx, 'goldVault.view'),
  );
  const companies = await goldCompanyRepository.namesOf(
    bars
      .map((bar) => (bar.companyId === null ? '' : String(bar.companyId)))
      .filter((v) => v !== ''),
  );
  ok(res, {
    drawer: toGoldDrawerDto(drawer),
    bars: bars.map((bar) => toGoldBarDto(bar, { companies })),
  });
};

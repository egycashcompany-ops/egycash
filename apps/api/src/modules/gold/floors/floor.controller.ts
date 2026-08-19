// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type CreateGoldFloor, type ReorderGoldItems, type UpdateGoldFloor } from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, validated } from '../../../platform/web';
import { scopeSelector } from '../../../shared/types';
import { toGoldFloorDto } from '../gold.mappers';
import { branchNames } from '../shared/ecms-refs';
import { goldFloorService } from './floor.service';

type IdParam = { id: string };

export const listGoldFloors = async (req: Request, res: Response): Promise<void> => {
  const scope = scopeSelector(authContext(req), 'goldVault.view');
  const [floors, branches] = await Promise.all([goldFloorService.list(scope), branchNames()]);
  ok(
    res,
    floors.map((floor) => toGoldFloorDto(floor, { branches })),
  );
};

export const createGoldFloor = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldFloor>(req);
  const doc = await goldFloorService.create(body, authContext(req));
  created(res, toGoldFloorDto(doc));
};

export const updateGoldFloor = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldFloor, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await goldFloorService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'goldVault.edit'),
  );
  ok(res, toGoldFloorDto(doc));
};

export const reorderGoldFloors = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ReorderGoldItems>(req);
  await goldFloorService.reorder(body);
  noContent(res);
};

export const deleteGoldFloor = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await goldFloorService.remove(params.id, ctx.userId, scopeSelector(ctx, 'goldVault.delete'));
  noContent(res);
};

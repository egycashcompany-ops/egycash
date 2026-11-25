// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateAdministrationWarehouse,
  type ListAdministrationWarehousesQuery,
  type UpdateAdministrationWarehouse,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { type AuthContext } from '../../../../shared/types';
import { toAdministrationWarehouseDto } from '../../administration.mappers';
import { type AdministrationWarehouseDoc } from './warehouse.model';
import { administrationWarehouseService as service } from './warehouse.service';

type IdParam = { id: string };

/** One warehouse as this reader gets it: its labels, and whether they may edit it. */
const dtoOf = async (doc: AdministrationWarehouseDoc, ctx: AuthContext) =>
  toAdministrationWarehouseDto(doc, await service.labels([doc]), service.canEdit(ctx, doc));

export const listAdministrationWarehouses = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAdministrationWarehousesQuery>(req);
  const ctx = authContext(req);
  const page = await service.list(query, ctx);
  const labels = await service.labels(page.items);
  okPage(res, page, (doc) => toAdministrationWarehouseDto(doc, labels, service.canEdit(ctx, doc)));
};

export const listAdministrationWarehouseBranchOptions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  ok(res, await service.branchOptions(authContext(req)));
};

export const getAdministrationWarehouse = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await dtoOf(await service.get(params.id, ctx), ctx));
};

export const createAdministrationWarehouse = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAdministrationWarehouse>(req);
  const ctx = authContext(req);
  created(res, await dtoOf(await service.create(body, ctx), ctx));
};

export const updateAdministrationWarehouse = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationWarehouse, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await dtoOf(await service.update(params.id, body, ctx), ctx));
};

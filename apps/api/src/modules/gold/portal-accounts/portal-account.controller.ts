// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ChangeGoldPortalAccountStatus,
  type CreateGoldPortalAccount,
  type ListGoldPortalAccountsQuery,
  type UpdateGoldPortalAccount,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, validated } from '../../../platform/web';
import { goldPortalAccountService } from './portal-account.service';

type IdParam = { id: string };

export const listGoldPortalAccounts = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldPortalAccountsQuery>(req);
  const page = await goldPortalAccountService.list(query);
  ok(res, page.items, page.meta);
};

export const getGoldPortalAccount = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await goldPortalAccountService.getById(params.id));
};

export const createGoldPortalAccount = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldPortalAccount>(req);
  created(res, await goldPortalAccountService.create(body, authContext(req).userId));
};

export const updateGoldPortalAccount = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldPortalAccount, never, IdParam>(req);
  ok(res, await goldPortalAccountService.update(params.id, body, authContext(req).userId));
};

export const changeGoldPortalAccountStatus = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ChangeGoldPortalAccountStatus, never, IdParam>(req);
  ok(res, await goldPortalAccountService.changeStatus(params.id, body, authContext(req).userId));
};

export const resendGoldPortalSetupLink = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await goldPortalAccountService.resendSetupLink(params.id);
  noContent(res);
};

export const deleteGoldPortalAccount = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await goldPortalAccountService.remove(params.id, authContext(req).userId);
  noContent(res);
};

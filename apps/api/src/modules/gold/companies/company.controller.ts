// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldCompany,
  type ListGoldCompaniesQuery,
  type UpdateGoldCompany,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { toGoldCompanyDto } from '../gold.mappers';
import { goldCompanyService } from './company.service';

type IdParam = { id: string };

export const listGoldCompanies = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldCompaniesQuery>(req);
  okPage(res, await goldCompanyService.list(query), toGoldCompanyDto);
};

export const getGoldCompany = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toGoldCompanyDto(await goldCompanyService.getById(params.id)));
};

export const createGoldCompany = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldCompany>(req);
  const doc = await goldCompanyService.create(body, authContext(req).userId);
  created(res, toGoldCompanyDto(doc));
};

export const updateGoldCompany = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldCompany, never, IdParam>(req);
  const doc = await goldCompanyService.update(params.id, body, authContext(req).userId);
  ok(res, toGoldCompanyDto(doc));
};

export const deleteGoldCompany = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await goldCompanyService.remove(params.id, authContext(req).userId);
  noContent(res);
};

// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateGoldRepresentative,
  type ListGoldRepresentativesQuery,
  type UpdateGoldRepresentative,
} from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { goldCompanyRepository } from '../companies/company.repository';
import { toGoldRepresentativeDto } from '../gold.mappers';
import { goldRepresentativeService } from './representative.service';

type IdParam = { id: string };

export const listGoldRepresentatives = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListGoldRepresentativesQuery>(req);
  const page = await goldRepresentativeService.list(query);
  // One name lookup for the whole page, never one per row.
  const companies = await goldCompanyRepository.namesOf(
    page.items.map((doc) => String(doc.companyId)),
  );
  okPage(res, page, (doc) => toGoldRepresentativeDto(doc, { companies }));
};

export const getGoldRepresentative = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await goldRepresentativeService.getById(params.id);
  const companies = await goldCompanyRepository.namesOf([String(doc.companyId)]);
  ok(res, toGoldRepresentativeDto(doc, { companies }));
};

export const createGoldRepresentative = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateGoldRepresentative>(req);
  const doc = await goldRepresentativeService.create(body, authContext(req).userId);
  created(res, toGoldRepresentativeDto(doc));
};

export const updateGoldRepresentative = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateGoldRepresentative, never, IdParam>(req);
  const doc = await goldRepresentativeService.update(params.id, body, authContext(req).userId);
  ok(res, toGoldRepresentativeDto(doc));
};

export const deleteGoldRepresentative = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await goldRepresentativeService.remove(params.id, authContext(req).userId);
  noContent(res);
};

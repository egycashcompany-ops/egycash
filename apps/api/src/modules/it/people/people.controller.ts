// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListItPeopleQuery, type ListItTechniciansQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { itPeopleService } from './people.service';

/** People are read in the custody grant's scope — the same reach the custody register has. */
const peopleScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');

export const listItPeople = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItPeopleQuery>(req);
  const page = await itPeopleService.list(query, peopleScope(req));
  ok(res, page.items, page.meta);
};

export const getItPerson = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { employeeId: string }>(req);
  ok(res, await itPeopleService.get(params.employeeId, peopleScope(req)));
};

export const listItTechnicians = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItTechniciansQuery>(req);
  ok(res, await itPeopleService.technicians(query));
};

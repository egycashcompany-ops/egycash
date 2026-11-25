// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListAdministrationPeopleQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { type ScopeSelector } from '../../../shared/types';
import { administrationPeopleService, peopleScopesOf } from './people.service';

/** The picker's reach for this caller — the same reach a write naming a person is held to. */
const peopleScopes = (req: Request): ScopeSelector[] => peopleScopesOf(authContext(req));

export const listAdministrationPeople = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAdministrationPeopleQuery>(req);
  const page = await administrationPeopleService.list(query, peopleScopes(req));
  ok(res, page.items, page.meta);
};

export const getAdministrationPerson = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { employeeId: string }>(req);
  ok(res, await administrationPeopleService.get(params.employeeId, peopleScopes(req)));
};

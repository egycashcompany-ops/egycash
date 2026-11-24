// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListAdministrationPeopleQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { hasPermission, scopeSelector, type ScopeSelector } from '../../../shared/types';
import { administrationPeopleService } from './people.service';

/**
 * The keys that open the people reads in Phase 1: whoever names a warehouse's keeper — on a create
 * or an edit (§7.8). The list grows with each document that names a person, by its create key.
 */
export const ADMINISTRATION_PEOPLE_GRANTS: readonly [string, ...string[]] = [
  'administrationWarehouse.create',
  'administrationWarehouse.edit',
];

/**
 * A person is found when ANY of those keys the caller holds reaches them — one selector per held
 * key, each exactly as its register applies it, OR-ed by the directory (`anyOfScopes`). Never the
 * widest key standing for the others: a create key over A and an edit key over B reach both.
 */
const peopleScopes = (req: Request): ScopeSelector[] => {
  const ctx = authContext(req);
  return ADMINISTRATION_PEOPLE_GRANTS.filter((key) => hasPermission(ctx, key)).map((key) =>
    scopeSelector(ctx, key),
  );
};

export const listAdministrationPeople = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAdministrationPeopleQuery>(req);
  const page = await administrationPeopleService.list(query, peopleScopes(req));
  ok(res, page.items, page.meta);
};

export const getAdministrationPerson = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { employeeId: string }>(req);
  ok(res, await administrationPeopleService.get(params.employeeId, peopleScopes(req)));
};

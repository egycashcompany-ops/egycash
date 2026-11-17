// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListItPeopleQuery, type ListItTechniciansQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { hasPermission, scopeSelector, type ScopeSelector } from '../../../shared/types';
import { itPeopleService } from './people.service';

/**
 * The read grants of the three registers that name a holder — the assets, the mobile lines and
 * the consumables. ANY of them opens `/it/people` (`people.routes.ts`).
 */
export const IT_PEOPLE_GRANTS: readonly [string, ...string[]] = [
  'itAsset.view',
  'itMobileLine.view',
  'itConsumable.view',
];

/**
 * People are found when ANY of those grants the caller holds reaches them — one selector per held
 * grant, each exactly as that register applies it, OR-ed by the directory (`anyOfScopes`). Never
 * one key standing for the others: two grants can reach different units (the assets over A and B,
 * the store over A alone; an `own` grant beside a branch grant), and any single selector would
 * lose some register's holders.
 */
const peopleScopes = (req: Request): ScopeSelector[] => {
  const ctx = authContext(req);
  return IT_PEOPLE_GRANTS.filter((key) => hasPermission(ctx, key)).map((key) =>
    scopeSelector(ctx, key),
  );
};

/**
 * What each person holds of the ASSETS is counted only within the caller's own `itAsset.view` —
 * null without it, and the count is then not asked at all: a lines or store keeper finds people,
 * and does not learn from the list how many devices anybody holds.
 */
const assetCountScope = (req: Request): ScopeSelector | null => {
  const ctx = authContext(req);
  return hasPermission(ctx, 'itAsset.view') ? scopeSelector(ctx, 'itAsset.view') : null;
};

export const listItPeople = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItPeopleQuery>(req);
  const page = await itPeopleService.list(query, peopleScopes(req), assetCountScope(req));
  ok(res, page.items, page.meta);
};

export const getItPerson = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { employeeId: string }>(req);
  ok(res, await itPeopleService.get(params.employeeId, peopleScopes(req), assetCountScope(req)));
};

export const listItTechnicians = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItTechniciansQuery>(req);
  ok(res, await itPeopleService.technicians(query));
};

// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type ListItPeopleQuery,
  type ListItRecipientsQuery,
  type ListItTechniciansQuery,
} from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { hasPermission, scopeSelector, type ScopeSelector } from '../../../shared/types';
import { itPeopleService, type ItRegisterScopes } from './people.service';

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
 * The HAND-OVER grants of the same three registers. ANY of them opens `/it/people/recipients` —
 * the box a hand-over names its recipient in, in every branch (owner, 2026-11-18: «صاحب صلاحية
 * التسليم»).
 */
export const IT_RECIPIENT_GRANTS: readonly [string, ...string[]] = [
  'itAsset.assign',
  'itMobileLine.assign',
  'itConsumable.assign',
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

/**
 * Each register's own read scope, exactly as that register's list applies it — null for a grant
 * the caller does not hold, so that register is not asked. A person page the scoped read missed
 * is still the reader's when one of these registers NAMES the person (`people.service.get`).
 */
const registerScopes = (req: Request): ItRegisterScopes => {
  const ctx = authContext(req);
  const scopeOf = (key: string): ScopeSelector | null =>
    hasPermission(ctx, key) ? scopeSelector(ctx, key) : null;
  return {
    assets: scopeOf('itAsset.view'),
    lines: scopeOf('itMobileLine.view'),
    consumables: scopeOf('itConsumable.view'),
  };
};

export const getItPerson = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { employeeId: string }>(req);
  ok(res, await itPeopleService.get(params.employeeId, peopleScopes(req), registerScopes(req)));
};

/**
 * A hand-over's box: who may be named, in every branch. No scope is read off the caller at all —
 * neither a grant's reach nor the command bar's branch: the act's own grant opened the route, the
 * search is required and the page is small (`people.service.recipients`).
 */
export const listItRecipients = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItRecipientsQuery>(req);
  ok(res, await itPeopleService.recipients(query));
};

export const listItTechnicians = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItTechniciansQuery>(req);
  ok(res, await itPeopleService.technicians(query));
};

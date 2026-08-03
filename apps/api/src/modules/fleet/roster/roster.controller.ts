// Thin HTTP mapping only (ADR-003). Both handlers answer with the refreshed board — one
// round-trip per save is exactly what a drag-and-drop scheduler needs (owner FL-5 point 7).
import { type Request, type Response } from 'express';
import { type FleetRosterQuery, type PlanFleetRoster } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { fleetRosterService } from './roster.service';

export const getRosterDay = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetRosterQuery>(req);
  const scope = scopeSelector(authContext(req), 'fleetRoster.view');
  ok(res, await fleetRosterService.board(query.date, scope));
};

export const planRoster = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PlanFleetRoster>(req);
  const ctx = authContext(req);
  const scope = scopeSelector(ctx, 'fleetRoster.plan');
  const { changedCount } = await fleetRosterService.plan(body, ctx.userId, scope);
  ok(res, { ...(await fleetRosterService.board(body.date, scope)), changedCount });
};

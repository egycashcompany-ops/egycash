// Thin HTTP mapping only (ADR-003). Both handlers answer with the refreshed board — one
// round-trip per save is what a drag-and-drop board needs, the same way the roster does it.
import { type Request, type Response } from 'express';
import { type SaveFleetFixedRoster } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { fleetFixedRosterService } from './fixed-roster.service';

export const getFixedRoster = async (req: Request, res: Response): Promise<void> => {
  const scope = scopeSelector(authContext(req), 'fleetRoster.view');
  ok(res, await fleetFixedRosterService.board(scope));
};

export const saveFixedRoster = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveFleetFixedRoster>(req);
  const ctx = authContext(req);
  const scope = scopeSelector(ctx, 'fleetRoster.plan');
  const { changedCount } = await fleetFixedRosterService.save(body, ctx.userId, scope);
  ok(res, { ...(await fleetFixedRosterService.board(scope)), changedCount });
};

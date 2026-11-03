import { type Request, type Response } from 'express';
import { type ListActiveUsersQuery } from '@ecms/contracts';
import { noContent, ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext } from '../auth';
import { presenceService } from './presence.service';

/**
 * «Somebody is working here» — 204 either way, and nothing to read back.
 *
 * Staff only. An external account (a vault customer, a candidate) is not a user of the system this
 * page describes: `authenticate` already confines one away from this path, and this is the second
 * lock, so a surface registered for them later can never start counting their minutes.
 */
export const heartbeat = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  if ((ctx.external ?? null) === null) await presenceService.recordHeartbeat(ctx.userId);
  noContent(res);
};

export const listActiveUsers = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListActiveUsersQuery>(req);
  ok(
    res,
    await presenceService.listActiveUsers(
      query,
      scopeSelector(ctx, 'activeUser.view'),
      ctx.locale,
    ),
  );
};

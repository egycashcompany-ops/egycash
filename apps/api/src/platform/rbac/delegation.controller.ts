// Thin HTTP mapping only (ADR-003). Every handler passes the caller's context: the per-site
// ceiling lives in the service and there is no unguarded path.
import { type Request, type Response } from 'express';
import { type SetDelegation } from '@ecms/contracts';
import { ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { delegationService } from './delegation.service';

export const myDelegationCatalog = async (req: Request, res: Response): Promise<void> => {
  ok(res, await delegationService.catalogFor(authContext(req)));
};

export const userDelegations = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { userId: string }>(req);
  ok(res, await delegationService.forUser(authContext(req), params.userId));
};

export const setUserDelegation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SetDelegation, never, { userId: string; branchId: string }>(req);
  ok(
    res,
    await delegationService.set(authContext(req), params.userId, params.branchId, body.permissionKeys),
  );
};

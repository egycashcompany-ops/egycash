import { type Request, type Response } from 'express';
import { ok } from '../../infrastructure/http/respond';
import { authContext } from '../auth';
import { meApplicationsService } from './me-applications.service';
import { rbacService } from '../rbac';
import { reduceToMyPermissions } from './my-permissions';

// The caller's own effective navigation. No authorize() gate — every authenticated user may read the
// applications they themselves can open, and the resolver answers with exactly those: the ones their
// effective permissions entitle them to, nothing else.
export const getMyApplications = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, await meApplicationsService.listEffective(ctx.permissions));
};

// «صلاحياتي» — the caller's own permissions, in force right now, grouped by the screen each opens.
//
// No authorize() gate, and no `:id`: the route serves the account that is signed in and cannot be
// pointed at another one. The administration answer (`/platform/users/:id/effective-permissions`)
// is gated on `user.view` + `role.view` and stays that way — an ordinary employee holds neither,
// which is exactly why reading HIS OWN authority needs a route of its own rather than a relaxed
// gate on that one.
export const getMyPermissions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  // Unscoped on purpose: the scope argument exists to hide OTHER people's records, and the target
  // here is the caller. A `user.view` scope he may not hold would 404 him out of his own answer.
  const explained = await rbacService.explainEffectivePermissions(ctx.userId);
  ok(res, reduceToMyPermissions(explained, await rbacService.listPermissionCatalog()));
};

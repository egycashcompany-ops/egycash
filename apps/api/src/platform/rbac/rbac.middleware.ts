// authorize('<resource>.<action>') — deny by default; all 403s are audited
// (permission probing is a signal, Security Architecture §2).
//
// The gate also notices when it lets an EMERGENCY through. A break-glass key — `file.purge`,
// `user.setupLink`, `user.manageSessions` — is one whose holders carry mandatory 2FA and sit on
// the quarterly review precisely because exercising it is an event: the row the action itself
// writes (`purge`) says what was done, and `breakGlassUsed` says an emergency power was the
// authority. It is raised as a security signal at once (§5), not found by the hourly sweep.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../../shared/errors';
import { hasPermission, type AuthContext } from '../../shared/types';
import { auditService, flagBreakGlassUse } from '../audit';
import { authContextOrNull } from '../auth';
import { rbacService } from './rbac.service';

/** Fire-and-forget, like the denial audit: an alarm must never fail the request it is about. */
const noteBreakGlass = (req: Request, ctx: AuthContext, permission: string): void => {
  void flagBreakGlassUse({
    userId: ctx.userId,
    permission,
    route: `${req.method} ${req.baseUrl}${req.path}`,
  });
};

export const authorize = (permissionKey: string): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = authContextOrNull(req);
    if (ctx === null) {
      next(new UnauthenticatedError());
      return;
    }
    if (!hasPermission(ctx, permissionKey)) {
      void auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
        action: 'permissionDenied',
        changes: [{ field: 'permission', old: null, new: permissionKey }],
      });
      next(new ForbiddenError());
      return;
    }
    if (rbacService.isBreakGlassPermission(permissionKey)) noteBreakGlass(req, ctx, permissionKey);
    next();
  };
};

/**
 * Passes when the caller holds ANY of the listed permissions. For endpoints whose exact
 * permission depends on the targeted record (e.g. cancelling a Personnel Action requires the
 * permission of that action's group) — the service resolves the fine-grained rule; this gate
 * keeps unauthorized callers out at the route like `authorize` does.
 */
export const authorizeAny = (...permissionKeys: [string, ...string[]]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = authContextOrNull(req);
    if (ctx === null) {
      next(new UnauthenticatedError());
      return;
    }
    const held = permissionKeys.filter((key) => hasPermission(ctx, key));
    if (held.length === 0) {
      void auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
        action: 'permissionDenied',
        changes: [{ field: 'permission', old: null, new: permissionKeys.join('|') }],
      });
      next(new ForbiddenError());
      return;
    }
    // An emergency only when nothing ordinary would have let the caller through.
    if (held.every((key) => rbacService.isBreakGlassPermission(key))) {
      noteBreakGlass(req, ctx, held.join('|'));
    }
    next();
  };
};

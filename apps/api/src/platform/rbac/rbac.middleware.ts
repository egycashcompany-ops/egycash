// authorize('<resource>.<action>') — deny by default; all 403s are audited
// (permission probing is a signal, Security Architecture §2).
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../../shared/errors';
import { hasPermission } from '../../shared/types';
import { auditService } from '../audit';
import { authContextOrNull } from '../auth';

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
    if (!permissionKeys.some((key) => hasPermission(ctx, key))) {
      void auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
        action: 'permissionDenied',
        changes: [{ field: 'permission', old: null, new: permissionKeys.join('|') }],
      });
      next(new ForbiddenError());
      return;
    }
    next();
  };
};

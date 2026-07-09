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

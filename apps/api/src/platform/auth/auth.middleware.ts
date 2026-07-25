// authenticate — verifies the JWT, checks the denylist, loads the caller's
// effective permissions, and attaches the AuthContext every request carries.
// FIRST-LOGIN GATE (auth design 4.2): while `mustChangePassword` is set, every authenticated
// endpoint except the allowlist below fails with PASSWORD_CHANGE_REQUIRED — server-enforced,
// the web gate screen is just UX on top.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ErrorCodes } from '@ecms/contracts';
import { AppError, UnauthenticatedError } from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { setActor } from '../../infrastructure/http/request-context';
import { authService } from './auth.service';

interface AuthedRequest extends Request {
  authContext?: AuthContext;
}

export const authContextOrNull = (req: Request): AuthContext | null =>
  (req as AuthedRequest).authContext ?? null;

export const authContext = (req: Request): AuthContext => {
  const ctx = authContextOrNull(req);
  if (ctx === null) throw new UnauthenticatedError();
  return ctx;
};

export const authenticate: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    next(new UnauthenticatedError());
    return;
  }
  authService
    .buildAuthContext(header.slice('Bearer '.length))
    .then(async (ctx) => {
      (req as AuthedRequest).authContext = ctx;
      setActor({
        userId: ctx.userId,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      const path = req.originalUrl.split('?')[0] ?? '';
      if (!GATE_EXEMPT.test(path) && (await authService.passwordGateActive(ctx.userId))) {
        next(
          new AppError(
            ErrorCodes.PASSWORD_CHANGE_REQUIRED,
            403,
            'Password change required before continuing',
          ),
        );
        return;
      }
      next();
    })
    .catch(next);
};

// The gate must let the user change the password, see who they are, and leave.
// Matched against the path only (query string stripped) so no query value can fake an exemption.
const GATE_EXEMPT = /\/auth\/(password\/change|me|logout|refresh)$/;

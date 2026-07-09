// authenticate — verifies the JWT, checks the denylist, loads the caller's
// effective permissions, and attaches the AuthContext every request carries.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { UnauthenticatedError } from '../../shared/errors';
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
    .then((ctx) => {
      (req as AuthedRequest).authContext = ctx;
      setActor({
        userId: ctx.userId,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      next();
    })
    .catch(next);
};

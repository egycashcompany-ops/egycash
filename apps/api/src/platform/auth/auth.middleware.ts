// authenticate — verifies the JWT, checks the denylist, loads the caller's
// effective permissions, and attaches the AuthContext every request carries.
// FIRST-LOGIN GATE (auth design 4.2): while `mustChangePassword` is set, every authenticated
// endpoint except the allowlist below fails with PASSWORD_CHANGE_REQUIRED — server-enforced,
// the web gate screen is just UX on top.
import { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ErrorCodes } from '@ecms/contracts';
import { AppError, ForbiddenError, UnauthenticatedError } from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { setActor } from '../../infrastructure/http/request-context';
import { auditService } from '../audit';
import { authService } from './auth.service';
import { ACTIVE_BRANCH_HEADER, resolveActiveBranch } from './active-branch';
import { externalMayReach } from './external-surfaces';

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
      // The command bar's branch narrowing. Read here rather than per module so every list in the
      // application answers the same question the switcher is asking; `scopeSelector` applies it,
      // and can only ever narrow an organization-wide grant.
      const active = req.headers[ACTIVE_BRANCH_HEADER];
      ctx.activeBranchId = await resolveActiveBranch(
        typeof active === 'string' ? active : undefined,
      );
      (req as AuthedRequest).authContext = ctx;
      setActor({
        userId: ctx.userId,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        // Carried so an audited write can name its actor without a lookup of its own.
        identity: ctx.identity ?? null,
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
      // Confinement (see external-surfaces.ts). Employees short-circuit on the first test — the
      // field is unset for every one of them — so this costs a null check on the hot path.
      const external = ctx.external ?? null;
      if (external !== null && !externalMayReach(external, req.method, path)) {
        // Recorded, not just refused: an external account probing outside its surface is the
        // shape of an incident, and the row is what makes it visible afterwards.
        void auditService.record({
          entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
          action: 'permissionDenied',
          changes: [
            { field: 'externalSurface', old: null, new: `${req.method} ${path}` },
          ],
        });
        next(new ForbiddenError());
        return;
      }
      next();
    })
    .catch(next);
};

/**
 * Authenticate IF a token is offered, and continue anonymously if not (ADR-023).
 *
 * Exists for exactly one route: the signed file stream. That endpoint is unauthenticated by
 * design — a capability URL is what lets a branding logo load in an `<img>` from another origin —
 * but a file whose owning entity is guarded needs the caller's identity to check the ticket's
 * subject and re-run the module's authorizer. Demanding a session outright would break every
 * unguarded embed; ignoring one offered would make the guarded case impossible.
 *
 * A token that is present but INVALID still fails: silently downgrading a bad credential to
 * anonymous would let a guarded file be probed with a junk header instead of none.
 */
export const authenticateOptional: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    next();
    return;
  }
  authenticate(req, res, next);
};

// The gate must let the user change the password, see who they are, and leave.
// Matched against the path only (query string stripped) so no query value can fake an exemption.
const GATE_EXEMPT = /\/auth\/(password\/change|me|logout|refresh)$/;

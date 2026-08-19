// The one place a portal request learns WHICH customer it is.
//
// Two properties are load-bearing here, and both are deliberate:
//
// 1. **The company is read from the database on every request, not from the auth snapshot.** The
//    snapshot is cached for a minute, and a minute is the wrong answer for this question: switching
//    a customer company to `inactive`, or re-pointing an account after a merger, has to take effect
//    on the very next request. Two indexed reads buy that. (The snapshot's copy of the subject is
//    used only by the coarse confinement gate, where staleness is harmless.)
//
// 2. **`PortalCompany` is a branded string with exactly one producer.** Every portal read takes one
//    as its first parameter, so a read that forgot to scope does not compile, and no value from
//    `req.query`, `req.params` or `req.body` can become a confinement argument — a plain string
//    will not typecheck. The cast that mints it exists once, below, and an eslint rule forbids
//    writing another anywhere under `modules/gold`.
import { type Request, type RequestHandler } from 'express';
import { Types } from 'mongoose';
import { authContext } from '../../../platform/auth';
import { userService } from '../../../platform/users';
import { ForbiddenError } from '../../../shared/errors';
import { goldCompanyRepository } from '../companies/company.repository';

declare const brand: unique symbol;

/** A gold company id that has been PROVEN to be the caller's own. */
export type PortalCompany = string & { readonly [brand]: 'PortalCompany' };

/** The subject type this module registers with the platform for its customers. */
export const GOLD_PORTAL_SUBJECT = 'goldCompany';

interface PortalRequest extends Request {
  portalCompany?: PortalCompany;
}

/**
 * Prove the caller is a live customer of ours, and mint their company id.
 *
 * Every refusal is the same 403 with no detail: which of the four reasons applied — no binding,
 * a binding pointing elsewhere, a deleted company, a deactivated one — is not something an
 * unauthenticated-in-spirit caller gets to learn.
 */
export const requireGoldPortal: RequestHandler = (req, _res, next) => {
  void (async (): Promise<void> => {
    const ctx = authContext(req);
    const user = await userService.getById(ctx.userId);
    const subject = user.externalSubject ?? null;
    if (
      subject === null ||
      subject.moduleId !== 'gold' ||
      subject.subjectType !== GOLD_PORTAL_SUBJECT
    ) {
      throw new ForbiddenError();
    }
    const company = await goldCompanyRepository.findById(String(subject.subjectId));
    if (company === null || company.status !== 'active') throw new ForbiddenError();

    // The only cast in the module. eslint forbids `as PortalCompany` everywhere else.
    (req as PortalRequest).portalCompany = String(subject.subjectId) as PortalCompany;
  })().then(
    () => {
      next();
    },
    (error: unknown) => {
      next(error);
    },
  );
};

/** The caller's company. Throws rather than returning null: reaching a portal read without one is a bug. */
export const portalCompany = (req: Request): PortalCompany => {
  const company = (req as PortalRequest).portalCompany;
  if (company === undefined) throw new ForbiddenError();
  return company;
};

/** The same value as a Mongo id, for the aggregations. */
export const portalCompanyId = (company: PortalCompany): Types.ObjectId =>
  new Types.ObjectId(String(company));

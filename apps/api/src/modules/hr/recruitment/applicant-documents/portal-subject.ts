// Whose file is this? — asked of the SESSION, and of nothing else (D-APP-9).
//
// This is the single most important file in the feature, and it is nine lines for a reason. Every
// portal read and every portal write resolves the candidate HERE, from the external subject on
// their own user record. There is no `:applicantId` in any portal route, no `applicantId` in any
// portal body, and no query parameter that names a person.
//
// That is not defence in depth, it is the absence of a hole. «Could a candidate fetch somebody
// else's birth certificate by changing an id?» has no answer because there is no id to change:
// the only thing that decides whose set is loaded is which account signed in, and the only way to
// change that is to be a different person.
//
// The same shape gold's `portalCompany` already uses. Written separately rather than shared: both
// are three lines, and the day one population's rule changes, a shared helper is exactly what
// makes the other one change with it by accident.
import { type Request } from 'express';
import { ForbiddenError } from '../../../../shared/errors';
import { authContext } from '../../../../platform/auth';
import { userService } from '../../../../platform/users';
import { APPLICANT_PORTAL_SUBJECT } from '../applicant-portal';

/**
 * The applicant this request belongs to.
 *
 * Throws rather than returning null: reaching a portal route without a portal subject is not a
 * refusal to explain, it is a caller who should never have got past the confinement gate — and a
 * plain 403 with no detail is all any of the ways that could happen deserve.
 */
export const portalApplicantId = async (req: Request): Promise<string> => {
  const ctx = authContext(req);
  const user = await userService.getById(ctx.userId).catch(() => null);
  const subject = user?.externalSubject ?? null;
  if (
    subject === null ||
    subject.moduleId !== 'hr' ||
    subject.subjectType !== APPLICANT_PORTAL_SUBJECT
  ) {
    throw new ForbiddenError();
  }
  return String(subject.subjectId);
};

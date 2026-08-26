// What an EXTERNAL account is allowed to reach — the whole of it, in one file.
//
// An external account is somebody outside the company: a vault customer today. It authenticates
// like everyone else and it carries permissions like everyone else, and neither of those is enough
// on its own. Permissions answer "may you do this thing"; they cannot answer "should you be able
// to reach the staff directory at all", because plenty of endpoints are deliberately open to any
// authenticated caller. Two live examples, both correct for employees and both wrong for a
// customer: `POST /platform/directory/resolve` names staff and their job titles, and gold's own
// `/print` endpoints are POSTs that bump a counter.
//
// So confinement is a separate, coarser question asked before authorization, and it is answered
// the only way that stays right as the codebase grows: DENY BY DEFAULT. An external caller may
// reach exactly three things —
//
//   1. its own account: the whole `/auth` router, which is either pre-authentication or
//      self-service by construction (login, refresh, logout, me, password change, TOTP, sessions);
//   2. the READ surface its owning module registered for it, by GET;
//   3. the WRITE surface its owning module registered for it, if it registered one at all.
//
// A route added tomorrow anywhere else in ECMS is out of reach without anybody remembering this
// file exists. That is the property worth having.
//
// THE THIRD ONE IS NEW, AND NARROW (ADR-027, amended 2026-08-26). It was added for the applicant
// portal, whose entire purpose is that a candidate uploads their own certificates — a thing a
// read-only account cannot do. It changes nothing for a subject type that does not ask: a customer
// who registers no write surface is exactly as incapable of writing as before, which is why this
// is a second opt-in call and not a flag on the first.
//
// **Dependency direction**, as in `file-authorizers.ts`: modules PUSH their surface in at boot and
// this file imports nothing from any module.
import { env } from '../../infrastructure/config/env';
import { type ExternalSubject } from '../../shared/types';

/** `${moduleId}:${subjectType}` → the single route prefix that subject may read. */
const surfaces = new Map<string, string>();

/**
 * `${moduleId}:${subjectType}` → the single route prefix that subject may WRITE under.
 *
 * A SEPARATE map, not a widened value in the first one, so that "may read here" and "may write
 * here" stay two answers. They happen to be the same prefix for the applicant portal; that is a
 * fact about that module, not a rule, and a module that wants both says both.
 */
const writeSurfaces = new Map<string, string>();

const keyOf = (moduleId: string, subjectType: string): string => `${moduleId}:${subjectType}`;

/**
 * Declare the read surface for one kind of external subject, e.g.
 * `registerExternalSurface('gold', 'goldCompany', '/gold/portal')`.
 *
 * One prefix per subject type on purpose. A list would invite the surface to creep outward one
 * entry at a time; a single prefix means widening it is a visible decision about where the
 * customer-facing routes live.
 */
export const registerExternalSurface = (
  moduleId: string,
  subjectType: string,
  prefix: string,
): void => {
  surfaces.set(keyOf(moduleId, subjectType), prefix);
};

/**
 * Declare the WRITE surface for one kind of external subject, e.g.
 * `registerExternalWriteSurface('hr', 'applicant', '/hr/applicant-portal')`.
 *
 * Opt-in, one prefix, and absent unless a module asks: the default for every external subject is
 * still that it cannot write anywhere at all. Registering this does NOT grant reads — a module
 * that wants both calls both — and it does not skip authorization: this gate answers "should this
 * caller reach this area", permissions still answer "may they do this".
 */
export const registerExternalWriteSurface = (
  moduleId: string,
  subjectType: string,
  prefix: string,
): void => {
  writeSurfaces.set(keyOf(moduleId, subjectType), prefix);
};

/** Path containment that cannot be fooled by a shared prefix: `/gold/portalx` is not under `/gold/portal`. */
const under = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`);

/**
 * May this external caller reach this request?
 *
 * A subject type nobody registered gets self-service only — the fail-closed answer, so a module
 * that forgets to declare its surface locks its own customers out rather than opening ECMS to them.
 */
export const externalMayReach = (
  subject: ExternalSubject,
  method: string,
  path: string,
): boolean => {
  if (under(path, `${env.BASE_PATH}/api/v1/auth`)) return true;
  const key = keyOf(subject.moduleId, subject.subjectType);
  const map = method === 'GET' || method === 'HEAD' ? surfaces : writeSurfaces;
  const prefix = map.get(key);
  return prefix !== undefined && under(path, `${env.BASE_PATH}/api/v1${prefix}`);
};

/** Test seam — the registry is process-wide and boot-populated. */
export const clearExternalSurfaces = (): void => {
  surfaces.clear();
  writeSurfaces.clear();
};

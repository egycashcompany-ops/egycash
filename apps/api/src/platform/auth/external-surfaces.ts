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
// reach exactly two things —
//
//   1. its own account: the whole `/auth` router, which is either pre-authentication or
//      self-service by construction (login, refresh, logout, me, password change, TOTP, sessions);
//   2. the surface its owning module registered for it, and only by GET.
//
// A route added tomorrow anywhere else in ECMS is out of reach without anybody remembering this
// file exists. That is the property worth having.
//
// **Dependency direction**, as in `file-authorizers.ts`: modules PUSH their surface in at boot and
// this file imports nothing from any module.
import { env } from '../../infrastructure/config/env';
import { type ExternalSubject } from '../../shared/types';

/** `${moduleId}:${subjectType}` → the single route prefix that subject may read. */
const surfaces = new Map<string, string>();

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
  if (method !== 'GET' && method !== 'HEAD') return false;
  const prefix = surfaces.get(keyOf(subject.moduleId, subject.subjectType));
  return prefix !== undefined && under(path, `${env.BASE_PATH}/api/v1${prefix}`);
};

/** Test seam — the registry is process-wide and boot-populated. */
export const clearExternalSurfaces = (): void => {
  surfaces.clear();
};

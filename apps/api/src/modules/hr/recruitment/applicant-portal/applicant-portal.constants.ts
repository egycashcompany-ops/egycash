// The applicant portal's identity, in one place (P-HR-APP, ADR-027).
//
// `subjectType` is the string the platform keys everything off — the confinement surfaces, the
// identity resolver, the `kind` an admin screen renders. It is written once here and imported;
// three copies of a magic string is how a portal quietly stops being confined.
export const APPLICANT_PORTAL_SUBJECT = 'applicant';

/** Read and write both live under this one prefix (ADR-027 amendment). */
export const APPLICANT_PORTAL_PREFIX = '/hr/applicant-portal';

/** The role a portal account carries. One permission, and it grants nothing wide. */
export const APPLICANT_PORTAL_ROLE_KEY = 'hr-applicant-portal';
export const APPLICANT_PORTAL_PERMISSION = 'applicantPortal.view';

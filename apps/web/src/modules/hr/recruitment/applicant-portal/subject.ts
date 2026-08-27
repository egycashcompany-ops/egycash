// The subject type, spelled once on this side too.
//
// It has to match `APPLICANT_PORTAL_SUBJECT` on the API exactly — it is what the sign-in request
// carries and what `me.external.subjectType` is compared against. Written here rather than typed
// into four components, for the same reason the API keeps its own copy in one file.
export const APPLICANT_PORTAL_SUBJECT = 'applicant';

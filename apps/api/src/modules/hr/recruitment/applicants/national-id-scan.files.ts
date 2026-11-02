// The scratch reference a card scan lands on, and who may reach it (ADR-023).
//
// WHY THIS EXISTS. Reading a card used to be done entirely through the GENERIC file surface: the
// browser listed `/platform/file-categories` to find the National-ID category, uploaded through
// `POST /platform/files`, and the reader then pulled the bytes back with the generic download
// rule. Those three paths need `file.view`, `file.create` and `file.download` — permissions no HR
// role holds, and should not: `file.view` lists files across the whole system, ID cards included.
// So an HR user got an empty category list and the misleading «لا توجد فئة ملفات للصور مُهيّأة».
//
// Reading a card now needs exactly the permission that registering an applicant needs, because
// that is the act it is part of. The module serves it through its own endpoint and polices it
// here, which is the arrangement `readEntityOwnedBuffer` requires: it drops the generic
// file-level grant only for an entity type a module has explicitly CLAIMED, so claiming this one
// is what makes the scan readable to the role that owns it and to nobody new.
//
// THE ENTITY TYPE IS THE ONE ALREADY IN USE. Every scan filed before this authorizer existed
// carries `applicantOcr`, so keeping the string brings them under the same rule rather than
// leaving a population of unclaimed card images behind.
import { hasPermission, type AuthContext } from '../../../../shared/types';
import { type FileEntityAuthorizer } from '../../../../platform/files';

/** The scratch entity a card scan is filed against, before the applicant exists. */
export const APPLICANT_CARD_SCAN_ENTITY_TYPE = 'applicantOcr';

/**
 * The scratch `entityId`, which is the SAME for everybody on purpose.
 *
 * A scan is filed seconds before the applicant it belongs to exists, so there is no entity to
 * name yet. Per-user buckets were the alternative and they buy nothing here: the gate is the
 * permission either way, the images live for the length of one registration, and a bucket keyed by
 * user would leave every scan uploaded before this change unreadable by the rule that replaced it.
 */
export const APPLICANT_CARD_SCAN_ENTITY_ID = 'pending';

/**
 * One rule, and it is the registration's own key.
 *
 * `applicant.create` and not a file permission: a card scan is a step inside registering an
 * applicant, and anybody who may register one may read the card they just photographed. An
 * external account — a candidate on the portal — holds no staff permission at all, so the same
 * check refuses them without needing a clause of its own.
 *
 * No `understandsDelete`, deliberately: a scratch scan is never deleted by this flow, so a delete
 * arrives here as a `write` and is answered by the same key. Opting in would be a statement that
 * this authorizer has a branch for it, and it does not.
 */
export const hrApplicantCardScanFileAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: APPLICANT_CARD_SCAN_ENTITY_TYPE,
    authorize: async ({ ctx }: { ctx: AuthContext }): Promise<boolean> =>
      hasPermission(ctx, 'applicant.create'),
  },
];

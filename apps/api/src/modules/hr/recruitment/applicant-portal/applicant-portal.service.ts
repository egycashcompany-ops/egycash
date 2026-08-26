// The applicant portal's account — created when a candidate clears screening, and never before.
//
// WHY NOT AT APPLICATION (D-APP-2). Opening an account for everyone who applies would give the
// company a login for every CV it has ever received, and would make the portal a way to learn
// whether a given national ID belongs to somebody who applied here and was turned down. The
// account is a consequence of clearing screening, not a door.
//
// The account is an ORDINARY ECMS user with `externalSubject` naming the applicant (ADR-027) — no
// second authentication system, no second password store, no second audit trail. What is unusual
// is only that it never gets a password: it signs in with a one-time code (P-HR-APP §4), so the
// activation token this creation produces is deliberately discarded.
import { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { sendWhatsApp } from '../../../../infrastructure/messaging/whatsapp';
import { env } from '../../../../infrastructure/config/env';
import { auditService } from '../../../../platform/audit';
import { rbacService } from '../../../../platform/rbac';
import { userService, type UserDoc } from '../../../../platform/users';
import { applicantRepository } from '../applicants/applicant.repository';
import { type ApplicantDoc } from '../applicants/applicant.model';
import {
  APPLICANT_PORTAL_PERMISSION,
  APPLICANT_PORTAL_ROLE_KEY,
  APPLICANT_PORTAL_SUBJECT,
} from './applicant-portal.constants';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'applicantPortalAccount',
  entityId: id,
});

/** The sign-in page. A link, not a key — it opens the form, and the code is still required. */
export const portalSignInUrl = (): string => `${env.WEB_PUBLIC_URL}/applicant-portal`;

const inviteMessage = (name: string): string =>
  `${name}\nتم قبولك في مرحلة الفرز المبدئي.\nادخل على بوابة المتقدمين لرفع مستنداتك ومتابعة موقفك:\n${portalSignInUrl()}\nالدخول بالرقم القومي ورقم الموبايل، وسيصلك رمز تأكيد.`;

class ApplicantPortalService {
  /** The account for this applicant, or null. The single reader — everything else goes through it. */
  async accountFor(applicantId: string): Promise<UserDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return userService.findByExternalSubject('hr', APPLICANT_PORTAL_SUBJECT, applicantId);
  }

  /**
   * Open the portal for an applicant who has just cleared screening. Idempotent.
   *
   * Re-running it — a redelivered event, a screening flipped back to accepted — finds the existing
   * account and does nothing, rather than failing or making a second login for one person.
   */
  async openFor(applicant: ApplicantDoc): Promise<UserDoc> {
    const applicantId = String(applicant._id);
    const existing = await this.accountFor(applicantId);
    if (existing !== null) return existing;

    // The role is re-asserted rather than looked up: the same idempotent helper the seed calls, so
    // a deployment that somehow skipped the seed converges instead of failing on the first
    // candidate.
    const role = await rbacService.ensureManagedRole(
      APPLICANT_PORTAL_ROLE_KEY,
      { en: 'Applicant portal', ar: 'بوابة المتقدمين' },
      [APPLICANT_PORTAL_PERMISSION],
    );
    const { user } = await userService.create(
      {
        username: `applicant-${applicant.code}`,
        firstName: { ar: applicant.fullNameAr, en: applicant.fullNameEn ?? applicant.fullNameAr },
        lastName: { ar: '-', en: '-' },
        ...(applicant.contact?.primaryPhone === undefined
          ? {}
          : { phone: applicant.contact.primaryPhone }),
        locale: 'ar',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
      {
        username: `applicant-${applicant.code}`,
        externalSubject: {
          moduleId: 'hr',
          subjectType: APPLICANT_PORTAL_SUBJECT,
          subjectId: applicantId,
        },
      },
    );
    await rbacService.ensureAssignment(String(user._id), String(role._id), 'organization');
    // ACTIVE IMMEDIATELY, AND THAT IS NOT A SHORTCUT. `userService.create` leaves an account
    // `invited`, waiting for somebody to follow an activation link and choose a password — and
    // every authenticated request refuses an account that is not active. A candidate never gets
    // that link: they sign in with a one-time code, so an account left `invited` would hand out a
    // session token that fails on the very next request. Activating here also DISCARDS the
    // activation token in the same write, which is the half that keeps the door shut: the account
    // is active with no password, and the password login path refuses a null credential outright,
    // so there is no way into it except the code.
    await userService.forceActivate(String(user._id));
    await auditService.record({
      entityRef: entityRef(applicantId),
      action: 'create',
      changes: [{ field: 'portalAccount', old: null, new: applicant.code }],
    });
    return user;
  }

  /**
   * Send the candidate their portal link (D-APP-3ب).
   *
   * THE RECIPIENT IS NOT CHOSEN. It goes to the mobile already on the applicant, never to a number
   * supplied with the request — somebody who wants it to reach a different phone corrects the
   * applicant first, and that is an audited act. The link opens the sign-in page and nothing more;
   * the one-time code is still required, so a link that reaches the wrong person is an address,
   * not a key.
   */
  async sendPortalLink(
    applicantId: string,
    by: string,
  ): Promise<{ ok: boolean; detail: string | null }> {
    const applicant = await applicantRepository.getById(applicantId).catch(() => null);
    if (applicant === null) return { ok: false, detail: 'applicant not found' };
    const phone = applicant.contact?.primaryPhone ?? '';
    if (phone.trim() === '') return { ok: false, detail: 'no phone number on file' };

    const sent = await sendWhatsApp(phone, inviteMessage(applicant.fullNameAr));
    await auditService.record({
      entityRef: entityRef(applicantId),
      action: 'update',
      changes: [
        { field: 'portalLinkSent', old: null, new: sent.ok ? 'delivered' : 'failed' },
        { field: 'by', old: null, new: by },
      ],
    });
    return sent;
  }

  /**
   * The identity resolver the platform asks (P-HR-APP §4).
   *
   * ANSWERS null FOR EVERY KIND OF NO, and that is the point: no such national ID, an applicant
   * who never cleared screening, one whose application was refused, a mismatched phone. The
   * platform is told a user or nothing, so the sign-in screen cannot say which — otherwise anybody
   * holding a national ID could ask this company whether its owner applied here.
   *
   * A REJECTED APPLICANT KEEPS THEIR ACCOUNT. They sign in and read that they were refused
   * (D-APP-7ب); it is the pipeline that is over, not their access to the answer.
   */
  async resolveIdentity(query: { identifier: string; phone: string }): Promise<UserDoc | null> {
    const nationalId = query.identifier.trim();
    const phone = query.phone.trim();
    if (nationalId === '' || phone === '') return null;

    const applicant = await applicantRepository.findAnyByNationalId(nationalId);
    if (applicant === null) return null;
    // The phone must match what the company holds. It is not a secret, but requiring it means the
    // code is sent to a number this company chose to trust rather than one a caller supplied.
    if ((applicant.contact?.primaryPhone ?? '') !== phone) return null;
    return this.accountFor(String(applicant._id));
  }
}

export const applicantPortalService = new ApplicantPortalService();

/** Boot wiring: HR answers the platform's identity question for its own population. */
export const applicantPortalIdentityResolver = (query: {
  identifier: string;
  phone: string;
}): Promise<UserDoc | null> =>
  applicantPortalService.resolveIdentity(query).catch((error: unknown) => {
    logger.warn({ err: error }, 'applicant portal identity resolution failed');
    return null;
  });

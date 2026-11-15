// Where a candidate's own uploads live, and who may read them back.
//
// TWO THINGS, AND THEY ARE NOT THE SAME THING. The CATEGORY decides what may be stored — images
// and PDF, capped — through the same mechanism every other attachment in ECMS goes through
// (D-APP-10). The AUTHORIZER decides who may read one back (ADR-023), and it exists because a
// category cannot answer that: a category is about bytes, and this question is about people.
//
// Images are allowed alongside PDF, unlike the hiring-documents category. What is being asked for
// is a photograph of a certificate taken on a phone; refusing that would mean telling people
// without a scanner to go and find one.
import { APPLICANT_DOCUMENT_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../../platform/files';
import { userService } from '../../../../platform/users';
import { hasPermission, type AuthContext } from '../../../../shared/types';
import { APPLICANT_PORTAL_SUBJECT } from '../applicant-portal';

/** The entity a candidate's documents are filed against — their own applicant record. */
export const APPLICANT_DOCUMENT_ENTITY_TYPE = 'applicantDocuments';

const APPLICANT_DOCS_CATEGORY: CreateFileCategory = {
  key: APPLICANT_DOCUMENT_FILE_CATEGORY,
  name: { ar: 'مستندات بوّابة المتقدّمين', en: 'Applicant portal documents' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed. */
export const ensureApplicantDocsCategory = async (): Promise<void> => {
  const cat = await fileCategoryService.ensure(APPLICANT_DOCS_CATEGORY);
  cachedCategoryId = String(cat._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveApplicantDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(APPLICANT_DOCS_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};

/**
 * A CANDIDATE reaching their own file — decided against their SESSION, never the request.
 *
 * This is D-APP-9 made structural. The subject id comes off the token; the entity id comes off the
 * file. If they match it is their own document, and if they do not it is somebody else's. There is
 * no parameter in between for anyone to tamper with, so "could a candidate ask for another
 * candidate's birth certificate" is not a question with a bad answer — it has no way to be asked.
 */
const externalSubjectOf = async (
  ctx: AuthContext,
): Promise<{ moduleId: string; subjectType: string; subjectId: string } | null> => {
  const user = await userService.getById(ctx.userId).catch(() => null);
  const subject = user?.externalSubject ?? null;
  if (subject === null) return null;
  return {
    moduleId: subject.moduleId,
    subjectType: subject.subjectType,
    subjectId: String(subject.subjectId),
  };
};

/**
 * The context the PUBLIC APPLICATION files a new applicant's papers under: nobody is signed in,
 * and the candidate filing their own certificates is exactly the act the portal account exists
 * for — it simply does not exist yet. Built only on the server, after the application has been
 * accepted, and good for that one applicant's folder; a request can never carry it.
 */
const PUBLIC_APPLY_FILING = Symbol('publicApplyFiling');
export const publicApplyFilingContext = (applicantId: string): AuthContext =>
  ({
    userId: null,
    permissions: {},
    branchId: null,
    departmentId: null,
    sectionId: null,
    isPrivileged: false,
    [PUBLIC_APPLY_FILING]: applicantId,
  }) as unknown as AuthContext;
const publicApplyFilingOf = (ctx: AuthContext): string | null =>
  ((ctx as unknown as Record<symbol, unknown>)[PUBLIC_APPLY_FILING] as string | undefined) ?? null;

/**
 * HR putting a clearer copy into a candidate's folder — a blurred card, a photo taken sideways.
 * The signed-in reviewer, marked for ONE applicant, and only by the dedicated HR route after its
 * own permission check; the generic file routes never build it, so they stay read-only for staff.
 */
const HR_FILING = Symbol('hrFiling');
export const hrFilingContext = (ctx: AuthContext, applicantId: string): AuthContext =>
  ({ ...ctx, [HR_FILING]: applicantId }) as unknown as AuthContext;
const hrFilingOf = (ctx: AuthContext): string | null =>
  ((ctx as unknown as Record<symbol, unknown>)[HR_FILING] as string | undefined) ?? null;

export const hrApplicantDocumentFileAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: APPLICANT_DOCUMENT_ENTITY_TYPE,
    // Removing is not overwriting, and here the two answers differ — see the `intent === 'delete'`
    // branch below.
    understandsDelete: true,
    authorize: async ({ ctx, entityId, intent }) => {
      // The public application filing a new applicant's papers: their own folder, never a removal.
      const filing = publicApplyFilingOf(ctx);
      if (filing !== null) return intent !== 'delete' && filing === entityId;
      // HR replacing a paper through its own route: that applicant's folder only.
      const hrFiling = hrFilingOf(ctx);
      if (hrFiling !== null && intent !== 'delete') return hrFiling === entityId;
      const subject = await externalSubjectOf(ctx);
      if (subject !== null) {
        // The candidate's own way in, and the ONLY one an external account has. Any other
        // external subject — a gold customer, whatever comes next — is refused outright rather
        // than falling through to a permission check it could never satisfy anyway.
        if (subject.moduleId !== 'hr' || subject.subjectType !== APPLICANT_PORTAL_SUBJECT) {
          return false;
        }
        return subject.subjectId === entityId;
      }
      // Staff, REMOVING: the one staff write there is, and it is a removal rather than a change.
      // HR must be able to clear out the folder of a candidate who will not continue, and the
      // folder holds what the candidate handed in as well as what HR attached. `.delete` and not
      // `.review`: ruling on a document and emptying somebody's file are different acts, and
      // whoever may do the second should have been handed the key on purpose.
      //
      // This grants no new ROUTE. `DELETE /platform/files/:id` is behind `file.delete` and the
      // folder delete is behind `applicantDocument.delete`; this gate is the second of the two,
      // never the only one. What it does NOT open is the rest of writing — replacing a
      // candidate's certificate or editing its metadata still falls to the refusal below.
      if (intent === 'delete') return hasPermission(ctx, 'applicantDocument.delete');
      // Staff: reading is the reviewer's job; WRITING is not staff work at all. Nobody in HR
      // uploads a certificate on a candidate's behalf through this door — a document is evidence
      // about a person, and evidence somebody else could file in your name is worth less than
      // evidence you filed yourself.
      return intent === 'read' && hasPermission(ctx, 'applicantDocument.review');
    },
  },
];

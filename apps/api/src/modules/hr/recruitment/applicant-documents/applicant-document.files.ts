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

export const hrApplicantDocumentFileAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: APPLICANT_DOCUMENT_ENTITY_TYPE,
    authorize: async ({ ctx, entityId, intent }) => {
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
      // Staff: reading is the reviewer's job; WRITING is not staff work at all. Nobody in HR
      // uploads a certificate on a candidate's behalf through this door — a document is evidence
      // about a person, and evidence somebody else could file in your name is worth less than
      // evidence you filed yourself.
      return intent === 'read' && hasPermission(ctx, 'applicantDocument.review');
    },
  },
];

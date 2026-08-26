// Handing documents in, replacing them, and HR ruling on them.
//
// The service does three jobs and delegates the fourth: it asks the CATALOGUE what this candidate
// owes, asks the RULES what may happen, asks the FILES service to hold the bytes, and lets the
// REPOSITORY state the condition in the same write that changes things. What is deliberately not
// here is a read-then-check-then-write anywhere on the mutation paths — see the repository.
import { Types } from 'mongoose';
import {
  APPLICANT_DOCUMENT_REVIEW_STATUSES,
  HrApplicantDocumentEvents,
  type ApplicantDocumentDto,
  type ApplicantDocumentReviewStatus,
  type ApplicantDocumentSetDto,
  type ApplicantDocumentSlotDto,
  type ReviewApplicantDocument,
  type UploadApplicantDocument,
} from '@ecms/contracts';
import { emit } from '../../../../platform/kernel/event-bus';
import { auditService } from '../../../../platform/audit';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { jobTitleService } from '../../../../platform/organization';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { applicantService } from '../applicants';
import { type ApplicantDoc } from '../applicants/applicant.model';
import {
  isComplete,
  licenseClassProblem,
  mayReplace,
  missingFor,
  pendingReviewCount,
  typesFor,
  type DocumentTypeFacts,
} from './applicant-document-rules';
import { applicantDocumentRepository } from './applicant-document.repository';
import { applicantDocumentTypeService } from './applicant-document-type.service';
import { type ApplicantDocumentTypeDoc } from './applicant-document-type.model';
import { type ApplicantDocumentSetDoc } from './applicant-document.model';
import { APPLICANT_DOCUMENT_ENTITY_TYPE, resolveApplicantDocsCategoryId } from './applicant-document.files';

const entityRef = (applicantId: string) => ({
  moduleId: 'hr',
  entityType: APPLICANT_DOCUMENT_ENTITY_TYPE,
  entityId: applicantId,
});

const factsOf = (doc: ApplicantDocumentTypeDoc): DocumentTypeFacts => ({
  id: String(doc._id),
  key: doc.key,
  applicability: doc.applicability,
  required: doc.required,
  licenseClassRequired: doc.licenseClassRequired,
  order: doc.order,
  active: doc.active,
});

const slotDto = (type: DocumentTypeFacts, name: ApplicantDocumentTypeDoc['name']): ApplicantDocumentSlotDto => ({
  typeId: type.id,
  typeKey: type.key,
  typeName: name,
  required: type.required,
  licenseClassRequired: type.licenseClassRequired,
  order: type.order,
});

/** The statuses a candidate may still overwrite — derived from the rule, never restated. */
const REPLACEABLE: ApplicantDocumentReviewStatus[] = APPLICANT_DOCUMENT_REVIEW_STATUSES.filter(
  (status) => mayReplace(status),
);

class ApplicantDocumentService {
  /**
   * Is this candidate applying to DRIVE? (D-APP-5)
   *
   * Read off the seat, not the person: the job title's `requiresDrivingTest`, exactly as the
   * evaluation-phase materializer already asks it. A candidate who has not typed a licence into
   * their form is still applying to drive, and a missing or deleted title means "no", which is the
   * answer that asks for less rather than more.
   */
  private async isDriver(applicant: ApplicantDoc): Promise<boolean> {
    const jobTitleId = applicant.placement?.jobTitleId ?? null;
    if (jobTitleId === null) return false;
    const jobTitle = await jobTitleService.getById(String(jobTitleId)).catch(() => null);
    return jobTitle?.requiresDrivingTest ?? false;
  }

  /**
   * The catalogue rows asked of this candidate, with their names, ordered.
   *
   * `catalogue` is a parameter so a LIST can read the five rows once instead of once per candidate
   * on the page. Optional rather than required because every single-candidate caller would
   * otherwise have to fetch it just to hand it back.
   */
  private async askedOf(
    applicant: ApplicantDoc,
    catalogue?: ApplicantDocumentTypeDoc[],
  ): Promise<{ facts: DocumentTypeFacts; name: ApplicantDocumentTypeDoc['name'] }[]> {
    const [rows, isDriver] = await Promise.all([
      catalogue === undefined ? applicantDocumentTypeService.all() : Promise.resolve(catalogue),
      this.isDriver(applicant),
    ]);
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return typesFor(rows.map(factsOf), isDriver).map((facts) => {
      const row = byId.get(facts.id);
      if (row === undefined) throw new NotFoundError();
      return { facts, name: row.name };
    });
  }

  /** The whole picture for one candidate — what they owe, what they handed in, where it stands. */
  async setFor(applicantId: string): Promise<ApplicantDocumentSetDto> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null) throw new NotFoundError();
    const asked = await this.askedOf(applicant);
    const set = await applicantDocumentRepository.ensureFor(
      applicantId,
      applicant.code,
      applicant.fullNameAr,
    );
    return this.toDto(set, asked);
  }

  private toDto(
    set: ApplicantDocumentSetDoc,
    asked: { facts: DocumentTypeFacts; name: ApplicantDocumentTypeDoc['name'] }[],
  ): ApplicantDocumentSetDto {
    const handedIn = set.documents.map((doc) => ({
      typeId: String(doc.typeId),
      status: doc.status,
    }));
    const facts = asked.map((entry) => entry.facts);
    const nameById = new Map(asked.map((entry) => [entry.facts.id, entry.name]));
    const documents: ApplicantDocumentDto[] = set.documents.map((doc) => ({
      typeId: String(doc.typeId),
      typeKey: doc.typeKey,
      typeName: doc.typeName,
      required: doc.required,
      status: doc.status,
      fileId: String(doc.fileId),
      fileName: doc.fileName,
      fileVersion: doc.fileVersion,
      licenseClass: doc.licenseClass,
      uploadedAt: doc.uploadedAt.toISOString(),
      reviewedAt: doc.reviewedAt === null ? null : doc.reviewedAt.toISOString(),
      reviewNote: doc.reviewNote,
      mayReplace: mayReplace(doc.status),
    }));
    return {
      id: String(set._id),
      applicantId: String(set.applicantId),
      applicantCode: set.applicantCode,
      applicantName: set.applicantName,
      documents,
      missing: missingFor(facts, handedIn).map((type) => {
        const name = nameById.get(type.id);
        if (name === undefined) throw new NotFoundError();
        return slotDto(type, name);
      }),
      complete: isComplete(facts, handedIn),
      pendingReview: pendingReviewCount(handedIn),
      createdAt: set.createdAt.toISOString(),
      updatedAt: set.updatedAt.toISOString(),
    };
  }

  /**
   * Hand a document in, or hand a better one in.
   *
   * ONE ENTRY POINT for both, because from where the candidate stands they are one act: they are
   * putting a file in a slot. Which of the two writes runs is decided by whether the slot is
   * already filled, and BOTH of those writes name the state they need — so two tabs racing each
   * other end with one file in the slot and one honest refusal, never with a lost document.
   */
  async submit(
    ctx: AuthContext,
    applicantId: string,
    meta: UploadApplicantDocument,
    binary: UploadedBinary,
  ): Promise<ApplicantDocumentSetDto> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null) throw new NotFoundError();
    const asked = await this.askedOf(applicant);
    const target = asked.find((entry) => entry.facts.id === meta.typeId);
    // A type this candidate is NOT asked for is refused the same way an unknown one is. Somebody
    // who is not applying to drive has no professional-licence slot at all, and inventing one for
    // them would put a document on their file that nobody asked for and nobody will review.
    if (target === undefined) {
      throw new ValidationError([
        { field: 'typeId', code: 'INVALID', message: 'this document is not asked of this applicant' },
      ]);
    }
    const problem = licenseClassProblem(target.facts, meta.licenseClass);
    if (problem !== null) {
      throw new ValidationError([
        {
          field: 'licenseClass',
          code: 'INVALID',
          message:
            problem === 'missing'
              ? 'a professional driving licence must state its class — first or second'
              : 'this document has no licence class',
        },
      ]);
    }

    const set = await applicantDocumentRepository.ensureFor(
      applicantId,
      applicant.code,
      applicant.fullNameAr,
    );
    const existing = set.documents.find((doc) => String(doc.typeId) === meta.typeId) ?? null;
    if (existing !== null && !mayReplace(existing.status)) {
      throw new BusinessRuleError('this document was already accepted and can no longer be replaced');
    }

    const categoryId = await resolveApplicantDocsCategoryId();
    const licenseClass = meta.licenseClass ?? null;

    if (existing === null) {
      const file = await fileService.upload(
        ctx,
        {
          moduleId: 'hr',
          entityType: APPLICANT_DOCUMENT_ENTITY_TYPE,
          entityId: applicantId,
          categoryId,
          displayName: target.name.ar,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
      const added = await applicantDocumentRepository.addDocument(applicantId, {
        typeId: new Types.ObjectId(meta.typeId),
        typeKey: target.facts.key,
        typeName: target.name,
        required: target.facts.required,
        status: 'pending',
        fileId: file._id,
        fileName: file.originalName,
        fileVersion: file.fileVersion,
        licenseClass,
        uploadedAt: new Date(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      });
      // Null means another request filled the slot between the read and this write. The rule is
      // "one document per slot", so the loser is told to try again rather than being handed a
      // second row that would make the slot ambiguous forever.
      if (added === null) throw new ConflictError('this document was just uploaded — reload and replace it');
      await auditService.record({
        entityRef: entityRef(applicantId),
        action: 'create',
        changes: [{ field: 'document', old: null, new: target.facts.key }],
      });
      await emit(HrApplicantDocumentEvents.Uploaded, {
        applicantId,
        applicantCode: applicant.code,
        typeKey: target.facts.key,
      });
      return this.toDto(added, asked);
    }

    // `fileService.replace` keeps every prior version, so a candidate who improves a photograph
    // never destroys what the company already had.
    const file = await fileService.replace(ctx, String(existing.fileId), binary);
    const replaced = await applicantDocumentRepository.replaceDocument(
      applicantId,
      meta.typeId,
      REPLACEABLE,
      {
        fileId: file._id,
        fileName: file.originalName,
        fileVersion: file.fileVersion,
        licenseClass,
        uploadedAt: new Date(),
      },
    );
    if (replaced === null) {
      throw new BusinessRuleError('this document was decided while you were uploading — reload it');
    }
    await auditService.record({
      entityRef: entityRef(applicantId),
      action: 'update',
      changes: [
        {
          field: 'document',
          old: `${existing.typeKey}:v${String(existing.fileVersion)}`,
          new: `${existing.typeKey}:v${String(file.fileVersion)}`,
        },
      ],
    });
    await emit(HrApplicantDocumentEvents.Replaced, {
      applicantId,
      applicantCode: applicant.code,
      typeKey: target.facts.key,
    });
    return this.toDto(replaced, asked);
  }

  /** HR rules on one slot. Only what is still waiting, and only once. */
  async review(
    ctx: AuthContext,
    applicantId: string,
    typeId: string,
    input: ReviewApplicantDocument,
  ): Promise<ApplicantDocumentSetDto> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null) throw new NotFoundError();
    const asked = await this.askedOf(applicant);
    const note = (input.note ?? '').trim();
    const reviewed = await applicantDocumentRepository.reviewDocument(applicantId, typeId, {
      status: input.outcome,
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: note === '' ? null : note,
    });
    // Null covers both "no such slot" and "somebody already ruled on it", and they are the same
    // answer to the reviewer: what you were looking at is not what is there now.
    if (reviewed === null) {
      throw new ConflictError('this document is no longer waiting for a decision');
    }
    const slot = reviewed.documents.find((doc) => String(doc.typeId) === typeId);
    await auditService.record({
      entityRef: entityRef(applicantId),
      action: 'update',
      changes: [
        { field: 'review', old: 'pending', new: input.outcome },
        { field: 'typeKey', old: null, new: slot?.typeKey ?? typeId },
      ],
    });
    await emit(HrApplicantDocumentEvents.Reviewed, {
      applicantId,
      applicantCode: applicant.code,
      typeKey: slot?.typeKey ?? '',
    });
    const dto = this.toDto(reviewed, asked);
    if (dto.complete && dto.pendingReview === 0) {
      await emit(HrApplicantDocumentEvents.SetCompleted, {
        applicantId,
        applicantCode: applicant.code,
        typeKey: '',
      });
    }
    return dto;
  }

  /** The staff-side list. */
  async list(query: {
    page: number;
    pageSize: number;
    pendingOnly?: boolean;
    applicantId?: string;
    search?: string;
  }): Promise<{ items: ApplicantDocumentSetDto[]; total: number }> {
    const { items, total } = await applicantDocumentRepository.list(query);
    // Read the catalogue ONCE for the whole page. Each candidate still needs their own job title
    // asked — that is per person by definition — but the five rows are the same five rows.
    const catalogue = await applicantDocumentTypeService.all();
    const decorated = await Promise.all(
      items.map(async (set) => {
        const applicant = await applicantService.findByIdSystem(String(set.applicantId));
        const asked = applicant === null ? [] : await this.askedOf(applicant, catalogue);
        return this.toDto(set, asked);
      }),
    );
    return { items: decorated, total };
  }
}

export const applicantDocumentService = new ApplicantDocumentService();

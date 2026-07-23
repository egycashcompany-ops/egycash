// Electronic Employee File assembly (Stage 7) — the final stage of the seven-stage recruitment
// workflow and the handoff artifact to the Employee module (BD-008). Once an employee's hiring
// documents are completed, their file is assembled ONCE: it links all applicant history
// (screening, interviews, offer, hiring documents) and builds the initial Employee Timeline
// from the recruitment milestones (applicant registered → screening accepted → each interview
// passed → offer accepted → employee created → hiring documents completed → file opened). After
// assembly, notes may be appended to the timeline; the post-hire employee lifecycle belongs to
// the Employee module, not here. Assembly and notes publish events, notify, and are audited.
//
// Cross-feature access to the Applicant, Screening, Interview, Job Offer, Employee, and Hiring
// Documents aggregates goes through their barrels only (ADR-003).
import { Types } from 'mongoose';
import {
  HrEmployeeFileEvents,
  HrEmployeeFileTemplates,
  type AddEmployeeFileNote,
  type CreateEmployeeFile,
  type ListEmployeeFilesQuery,
  type Paginated,
  type RemoveEmployeeFileDocument,
  type UploadEmployeeFileDocument,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { notificationsService } from '../../../../platform/notifications';
import { applicantService } from '../applicants';
import { screeningService } from '../screening';
import { interviewService } from '../interviews';
import { jobOfferService } from '../job-offers';
import { employeeService } from '../employees';
import { hiringDocumentsService } from '../hiring-documents';
import { employeeFileRepository, type EmployeeFileListFilter } from './employee-file.repository';
import { resolveEmployeeFileCategoryId } from './employee-file.files';
import {
  type EmployeeFileDoc,
  type EmployeeFileDocument,
  type EmployeeFileLinks,
  type EmployeeTimelineEntry,
} from './employee-file.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employeeFile', entityId: id });

const milestone = (
  at: Date,
  type: EmployeeTimelineEntry['type'],
  refType: string | null,
  refId: Types.ObjectId | null,
  detail: string | null,
  by: Types.ObjectId | null = null,
): EmployeeTimelineEntry => ({ at, type, refType, refId, detail, by });

class EmployeeFileService {
  /** Fire-and-forget assembly notification to the reporting manager + the assembler. */
  private async notifyCreated(doc: EmployeeFileDoc, managerId: Types.ObjectId | null): Promise<void> {
    const recipients = new Set<string>();
    if (managerId !== null) recipients.add(String(managerId));
    if (doc.createdBy !== null) recipients.add(String(doc.createdBy));
    await notificationsService
      .notify({
        template: HrEmployeeFileTemplates.Created,
        to: { userIds: [...recipients] },
        data: { employeeCode: doc.employeeCode },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  private payload(doc: EmployeeFileDoc): Record<string, unknown> {
    return {
      employeeFileId: String(doc._id),
      employeeId: String(doc.employeeId),
      employeeCode: doc.employeeCode,
    };
  }

  /**
   * Assemble the Electronic Employee File for an employee whose hiring documents are complete
   * (BD-008). Gathers the full applicant history, builds the initial Employee Timeline, and
   * links every recruitment aggregate. One file per employee.
   */
  async create(ctx: AuthContext, input: CreateEmployeeFile, scope: ScopeSelector): Promise<EmployeeFileDoc> {
    const employee = await employeeService.getById(input.employeeId, scope);

    // Gate: the file is assembled only from a COMPLETED hiring case.
    const hiringDocs = await hiringDocumentsService.findByEmployeeId(input.employeeId);
    if (hiringDocs === null || hiringDocs.status !== 'completed') {
      throw new BusinessRuleError('hiring documents must be completed before assembling the employee file');
    }

    const existing = await employeeFileRepository.findByEmployeeId(input.employeeId);
    if (existing !== null) {
      throw new ConflictError('this employee already has an electronic file');
    }

    // Gather the recruitment history (read-only, via barrels).
    const applicantId = String(employee.applicantId);
    const applicant = await applicantService.getById(applicantId, scope);
    const screening = await screeningService.findByApplicantId(applicantId);
    const interviews = await interviewService.listByApplicant(applicantId);
    const offer = await jobOfferService.acceptedOfferById(String(employee.jobOfferId));

    // Build the initial Employee Timeline from the milestones (oldest first).
    const timeline: EmployeeTimelineEntry[] = [];
    timeline.push(milestone(applicant.createdAt, 'applicantRegistered', 'applicant', applicant._id, applicant.code));
    if (screening !== null && screening.status === 'accepted' && screening.decidedAt !== null) {
      timeline.push(milestone(screening.decidedAt, 'screeningAccepted', 'screening', screening._id, null));
    }
    for (const interview of interviews) {
      if (interview.status === 'completed' && interview.outcome === 'passed' && interview.decidedAt !== null) {
        timeline.push(
          milestone(interview.decidedAt, 'interviewPassed', 'interview', interview._id, interview.stageName.en),
        );
      }
    }
    const offerAcceptedAt = offer?.acceptedSnapshot?.acceptedAt ?? offer?.respondedAt ?? null;
    if (offer !== null && offerAcceptedAt !== null) {
      timeline.push(milestone(offerAcceptedAt, 'offerAccepted', 'jobOffer', offer._id, offer.code));
    }
    timeline.push(milestone(employee.hiredAt, 'employeeCreated', 'employee', employee._id, employee.code));
    if (hiringDocs.completedAt !== null) {
      timeline.push(milestone(hiringDocs.completedAt, 'hiringDocumentsCompleted', 'hiringDocuments', hiringDocs._id, null));
    }
    timeline.push(milestone(new Date(), 'fileOpened', null, null, null, new Types.ObjectId(ctx.userId)));
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

    const links: EmployeeFileLinks = {
      applicantId: employee.applicantId,
      jobRequisitionId: employee.jobRequisitionId,
      screeningId: screening === null ? null : screening._id,
      interviewIds: interviews.map((i) => i._id),
      jobOfferId: employee.jobOfferId,
      hiringDocumentsId: hiringDocs._id,
    };

    // Independent COPIES of every hiring document (HR-spec): each is re-stored as a fresh file
    // under this employee file, so editing/removing a copy never touches the original hiring
    // document. `copiedFromFileId` records the source for traceability.
    const categoryId = await resolveEmployeeFileCategoryId();
    const documents: EmployeeFileDocument[] = [];
    const now = new Date();
    for (const item of hiringDocs.documents) {
      const copy = await fileService.copy(ctx, String(item.fileId), {
        moduleId: 'hr',
        entityType: 'employeeFile',
        entityId: String(employee._id),
        categoryId,
        displayName: item.typeName.en,
        visibility: 'private',
      });
      documents.push({
        _id: new Types.ObjectId(),
        source: 'hiringDocumentCopy',
        name: item.typeName.en,
        fileId: copy._id,
        fileName: copy.originalName,
        copiedFromFileId: item.fileId,
        uploadedBy: new Types.ObjectId(ctx.userId),
        uploadedAt: now,
      });
    }

    const doc = await employeeFileRepository.create(
      {
        employeeId: employee._id,
        employeeCode: employee.code,
        applicantId: employee.applicantId,
        branchId: employee.branchId,
        status: 'active',
        links,
        documents,
        timeline,
      },
      { by: ctx.userId },
    );

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'employeeCode', old: null, new: employee.code }],
    });
    await emit(HrEmployeeFileEvents.Created, this.payload(doc));
    await this.notifyCreated(doc, employee.employment.managerId);
    return doc;
  }

  async list(query: ListEmployeeFilesQuery, scope: ScopeSelector): Promise<Paginated<EmployeeFileDoc>> {
    return employeeFileRepository.listEmployeeFiles({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListEmployeeFilesQuery): EmployeeFileListFilter {
    return {
      status: query.status,
      employeeId: query.employeeId,
      applicantId: query.applicantId,
      branchId: query.branchId,
      search: query.search,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<EmployeeFileDoc> {
    return employeeFileRepository.getById(id, scope);
  }

  /** Append a free-form note to the Employee Timeline (keeps the timeline growable). */
  async addNote(ctx: AuthContext, id: string, input: AddEmployeeFileNote, scope: ScopeSelector): Promise<EmployeeFileDoc> {
    const before = await employeeFileRepository.getById(id, scope);
    const entry = milestone(new Date(), 'note', null, null, input.note, new Types.ObjectId(ctx.userId));
    const updated = await employeeFileRepository.updateById(
      id,
      { timeline: [...before.timeline, entry] },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'timeline', old: before.timeline.length, new: updated.timeline.length }],
    });
    await emit(HrEmployeeFileEvents.NoteAdded, this.payload(updated));
    return updated;
  }

  /**
   * Upload an additional CUSTOM document (a fresh file, not a copy) into the Employee File with a
   * user-defined name. Independent of the hiring documents entirely.
   */
  async uploadDocument(
    ctx: AuthContext,
    id: string,
    meta: UploadEmployeeFileDocument,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<EmployeeFileDoc> {
    const before = await employeeFileRepository.getById(id, scope);
    const categoryId = await resolveEmployeeFileCategoryId();
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'employeeFile',
        entityId: id,
        categoryId,
        displayName: meta.name,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
    const entry: EmployeeFileDocument = {
      _id: new Types.ObjectId(),
      source: 'custom',
      name: meta.name,
      fileId: file._id,
      fileName: file.originalName,
      copiedFromFileId: null,
      uploadedBy: new Types.ObjectId(ctx.userId),
      uploadedAt: new Date(),
    };
    const updated = await employeeFileRepository.updateById(
      id,
      { documents: [...before.documents, entry] },
      { by: ctx.userId, version: meta.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'document', old: null, new: `custom:${meta.name}` }],
    });
    return updated;
  }

  /**
   * Remove a document from the Employee File. Only this file's independent copy/upload is deleted —
   * the original hiring document (`copiedFromFileId`) is never touched.
   */
  async removeDocument(
    ctx: AuthContext,
    id: string,
    documentId: string,
    meta: RemoveEmployeeFileDocument,
    scope: ScopeSelector,
  ): Promise<EmployeeFileDoc> {
    const before = await employeeFileRepository.getById(id, scope);
    const doc = before.documents.find((d) => String(d._id) === documentId);
    if (doc === undefined) {
      throw new ValidationError([{ field: 'documentId', code: 'INVALID', message: 'no such document in this file' }]);
    }
    const updated = await employeeFileRepository.updateById(
      id,
      { documents: before.documents.filter((d) => String(d._id) !== documentId) },
      { by: ctx.userId, version: meta.version, scope },
    );
    // Soft-delete this file's own copy/upload only (never the source hiring document).
    await fileService.softDelete(ctx, String(doc.fileId)).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'document', old: `${doc.source}:${doc.name}`, new: null }],
    });
    return updated;
  }
}

export const employeeFileService = new EmployeeFileService();

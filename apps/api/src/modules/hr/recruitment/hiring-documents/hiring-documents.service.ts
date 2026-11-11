// Hiring Documents lifecycle (Stage 6). After an employee is created (Stage 5), their hiring
// documents are collected: an administrator defines the required/optional document types; each
// document is an uploaded PDF whose bytes and version history live in the platform Files
// service (the original is preserved; replacement is a new version). A set cannot be completed
// while an active required type the employee's job collects (A27) is missing, and once completed it is immutable except through
// the versioning (replace) workflow. Creation/upload/replace/completion publish events, are
// audited, and completion notifies. Scope is Stage 6 only.
//
// Cross-feature access to the Employee aggregate goes through its barrel; file bytes go through
// the platform Files service barrel (ADR-003).
import { Types } from 'mongoose';
import {
  HrHiringDocumentsEvents,
  HrHiringDocumentsTemplates,
  type BulkActionResultDto,
  type BulkHiringDocuments,
  type CompleteHiringDocuments,
  type CreateHiringDocuments,
  type FileDto,
  type ListHiringDocumentsQuery,
  type Paginated,
  type ReplaceHiringDocument,
  type UploadHiringDocument,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, StaleDocumentError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { notificationsService } from '../../../../platform/notifications';
import { employeeRepository, employeeService } from '../../employee-management/employees';
import { runBulk } from '../workflow/bulk-runner';
import { hiringDocumentsRepository, type HiringDocumentsListFilter } from './hiring-documents.repository';
import { hiringDocumentTypeRepository } from './hiring-document-type.repository';
import { collectsFor } from './hiring-document-type.model';
import { computeMissingRequired, type HiringChecklist } from './hiring-documents.mapper';
import { resolveHiringDocsCategoryId } from './hiring-documents.files';
import { type HiringDocumentItem, type HiringDocumentsDoc } from './hiring-documents.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'hiringDocuments', entityId: id });

class HiringDocumentsService {
  /**
   * What each set's employee's job collects (A27): the active types for that job, and the required
   * ones among them — the checklist the set is shown with, and the completion gate. One read of the
   * catalog and one of the employees, however many sets. An employee who cannot be read (gone
   * from the register) is collected from as if the job were unknown: every-job types only.
   */
  async checklistsFor(docs: readonly HiringDocumentsDoc[]): Promise<Map<string, HiringChecklist>> {
    const types = await hiringDocumentTypeRepository.listActive();
    const employeeIds = [...new Set(docs.map((doc) => String(doc.employeeId)))];
    const employees = employeeIds.length === 0 ? [] : await employeeRepository.findByIdsSystem(employeeIds);
    const jobOf = new Map(employees.map((e) => [String(e._id), String(e.employment.jobTitleId)]));
    const out = new Map<string, HiringChecklist>();
    for (const doc of docs) {
      const job = jobOf.get(String(doc.employeeId)) ?? null;
      const mine = types.filter((type) => collectsFor(type, job));
      out.set(String(doc._id), {
        typeKeys: mine.map((type) => type.key),
        requiredKeys: mine.filter((type) => type.required).map((type) => type.key),
      });
    }
    return out;
  }

  /** One set's checklist. */
  async checklistFor(doc: HiringDocumentsDoc): Promise<HiringChecklist> {
    return (await this.checklistsFor([doc])).get(String(doc._id)) ?? { typeKeys: [], requiredKeys: [] };
  }

  /** Fire-and-forget completion notification to the reporting manager + the creator. */
  private async notifyCompleted(doc: HiringDocumentsDoc): Promise<void> {
    const recipients = new Set<string>();
    if (doc.managerId !== null) recipients.add(String(doc.managerId));
    if (doc.createdBy !== null) recipients.add(String(doc.createdBy));
    await notificationsService
      .notify({
        template: HrHiringDocumentsTemplates.Completed,
        to: { userIds: [...recipients] },
        data: { employeeCode: doc.employeeCode },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  private payload(doc: HiringDocumentsDoc): Record<string, unknown> {
    return {
      hiringDocumentsId: String(doc._id),
      employeeId: String(doc.employeeId),
      employeeCode: doc.employeeCode,
    };
  }

  /** Open the hiring-documents set for an employee (one per employee). */
  async create(ctx: AuthContext, input: CreateHiringDocuments, scope: ScopeSelector): Promise<HiringDocumentsDoc> {
    const employee = await employeeService.getById(input.employeeId, scope);
    const existing = await hiringDocumentsRepository.findByEmployeeId(input.employeeId);
    if (existing !== null) {
      throw new ConflictError('this employee already has a hiring-documents set');
    }
    const doc = await hiringDocumentsRepository.create(
      {
        employeeId: employee._id,
        employeeCode: employee.code,
        applicantId: employee.applicantId,
        branchId: employee.branchId,
        managerId: employee.employment.managerId,
        status: 'inProgress',
        documents: [],
        completedAt: null,
        completedBy: null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'employeeCode', old: null, new: employee.code }],
    });
    await emit(HrHiringDocumentsEvents.Created, this.payload(doc));
    return doc;
  }

  /**
   * The employee's set, opened now if there is none yet — what «تعيين» lands on, so the clerk who
   * just hired somebody is one click from printing and filing their papers (A27).
   */
  async openFor(ctx: AuthContext, employeeId: string, scope: ScopeSelector): Promise<HiringDocumentsDoc> {
    const existing = await hiringDocumentsRepository.findByEmployeeId(employeeId);
    if (existing !== null) {
      await employeeService.getById(employeeId, scope); // the caller must still reach the employee
      return existing;
    }
    return this.create(ctx, { employeeId }, scope);
  }

  async list(query: ListHiringDocumentsQuery, scope: ScopeSelector): Promise<Paginated<HiringDocumentsDoc>> {
    return hiringDocumentsRepository.listHiringDocuments({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListHiringDocumentsQuery): HiringDocumentsListFilter {
    return {
      status: query.status,
      employeeId: query.employeeId,
      branchId: query.branchId,
      search: query.search,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<HiringDocumentsDoc> {
    return hiringDocumentsRepository.getById(id, scope);
  }

  /**
   * The employee's hiring-documents set, if any — read by the Electronic Employee File
   * (Stage 7) to gate assembly on completion and to link the hiring-documents history.
   */
  async findByEmployeeId(employeeId: string): Promise<HiringDocumentsDoc | null> {
    return hiringDocumentsRepository.findByEmployeeId(employeeId);
  }

  /** Upload the first PDF for a document type (a type present already must be replaced instead). */
  async uploadDocument(
    ctx: AuthContext,
    id: string,
    meta: UploadHiringDocument,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<HiringDocumentsDoc> {
    const before = await hiringDocumentsRepository.getById(id, scope);
    if (before.status === 'completed') {
      throw new BusinessRuleError('hiring documents are completed; replace an existing document instead');
    }
    const type = await hiringDocumentTypeRepository.findActiveById(meta.typeId);
    if (type === null) {
      throw new ValidationError([
        { field: 'typeId', code: 'INVALID', message: 'unknown or inactive hiring document type' },
      ]);
    }
    if (before.documents.some((d) => String(d.typeId) === meta.typeId)) {
      throw new ConflictError('a document for this type already exists — replace it instead');
    }
    // Reject a stale request BEFORE writing bytes, so a lost optimistic-concurrency race
    // never leaves an orphaned file version (HD-01). updateById re-checks atomically below.
    if (before.__v !== meta.version) throw new StaleDocumentError();

    const categoryId = await resolveHiringDocsCategoryId();
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'hiringDocuments',
        entityId: id,
        categoryId,
        displayName: type.name.en,
        visibility: 'private',
        tags: [],
        ...(meta.notes === undefined ? {} : { description: meta.notes }),
      },
      binary,
    );

    const item: HiringDocumentItem = {
      typeId: new Types.ObjectId(meta.typeId),
      typeKey: type.key,
      typeName: type.name,
      required: type.required,
      fileId: file._id,
      fileName: file.originalName,
      fileVersion: file.fileVersion,
      notes: meta.notes ?? null,
      uploadedBy: new Types.ObjectId(ctx.userId),
      uploadedAt: new Date(),
    };
    const updated = await hiringDocumentsRepository.updateById(
      id,
      { documents: [...before.documents, item] },
      { by: ctx.userId, version: meta.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'document', old: null, new: `${type.key}:v${file.fileVersion}` }],
    });
    await emit(HrHiringDocumentsEvents.DocumentUploaded, { ...this.payload(updated), typeKey: type.key });
    return updated;
  }

  /**
   * Replace an existing document with a new PDF version — the ONLY mutation allowed after a set
   * is completed (previous versions are preserved by the Files service).
   */
  async replaceDocument(
    ctx: AuthContext,
    id: string,
    typeId: string,
    meta: ReplaceHiringDocument,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<HiringDocumentsDoc> {
    const before = await hiringDocumentsRepository.getById(id, scope);
    const current = before.documents.find((d) => String(d.typeId) === typeId);
    if (current === undefined) {
      throw new ValidationError([
        { field: 'typeId', code: 'INVALID', message: 'no document of this type to replace' },
      ]);
    }
    const file = await fileService.replace(ctx, String(current.fileId), binary);
    const documents = before.documents.map((d) =>
      String(d.typeId) === typeId
        ? { ...d, fileId: file._id, fileName: file.originalName, fileVersion: file.fileVersion, uploadedBy: new Types.ObjectId(ctx.userId), uploadedAt: new Date() }
        : d,
    );
    const updated = await hiringDocumentsRepository.updateById(id, { documents }, {
      by: ctx.userId,
      version: meta.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'document', old: `${current.typeKey}:v${current.fileVersion}`, new: `${current.typeKey}:v${file.fileVersion}` }],
    });
    await emit(HrHiringDocumentsEvents.DocumentReplaced, { ...this.payload(updated), typeKey: current.typeKey });
    return updated;
  }

  /** All versions of a type's document (original + replacements), newest handling by the Files service. */
  async listDocumentVersions(
    id: string,
    typeId: string,
    scope: ScopeSelector,
    ctx: AuthContext,
  ): Promise<FileDto[]> {
    const before = await hiringDocumentsRepository.getById(id, scope);
    const current = before.documents.find((d) => String(d.typeId) === typeId);
    if (current === undefined) {
      throw new ValidationError([
        { field: 'typeId', code: 'INVALID', message: 'no document of this type' },
      ]);
    }
    // `ctx` threaded for ADR-023: the Files service asks the owning module before returning
    // versions. Hiring documents register no authorizer, so this behaves exactly as before.
    const versions = await fileService.listVersions(String(current.fileId), undefined, ctx);
    return versions.map((f) => fileService.toDto(f));
  }

  /** Complete the set — refused while any active required document type is missing. */
  async complete(
    ctx: AuthContext,
    id: string,
    meta: CompleteHiringDocuments,
    scope: ScopeSelector,
  ): Promise<HiringDocumentsDoc> {
    const before = await hiringDocumentsRepository.getById(id, scope);
    if (before.status === 'completed') {
      throw new BusinessRuleError('hiring documents are already completed');
    }
    // Only what the employee's job collects is required of it (A27).
    const missing = computeMissingRequired(before, (await this.checklistFor(before)).requiredKeys);
    if (missing.length > 0) {
      throw new BusinessRuleError(`cannot complete: missing required documents (${missing.join(', ')})`);
    }
    const updated = await hiringDocumentsRepository.updateById(
      id,
      { status: 'completed', completedAt: new Date(), completedBy: new Types.ObjectId(ctx.userId) },
      { by: ctx.userId, version: meta.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: 'completed' }],
    });
    await emit(HrHiringDocumentsEvents.Completed, this.payload(updated));
    await this.notifyCompleted(updated);
    return updated;
  }

  /**
   * Complete a whole selection (RW17/I4). Each set runs `complete` on its own — same gate, same
   * audit, same event, same notification — so a set still missing a mandatory document fails as
   * THAT item and is named in the envelope while the rest complete.
   */
  async bulk(
    ctx: AuthContext,
    input: BulkHiringDocuments,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.ids,
      async (id) => {
        const current = await hiringDocumentsRepository.getById(id, scope);
        await this.complete(ctx, id, { version: current.__v }, scope);
      },
      {
        entityType: 'hiringDocuments',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }
}

export const hiringDocumentsService = new HiringDocumentsService();

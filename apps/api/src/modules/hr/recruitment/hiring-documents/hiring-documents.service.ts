// Hiring Documents lifecycle (Stage 6). After an employee is created (Stage 5), their hiring
// documents are collected: an administrator defines the required/optional document types; each
// document is an uploaded PDF whose bytes and version history live in the platform Files
// service (the original is preserved; replacement is a new version). A set cannot be completed
// while an active required type is missing, and once completed it is immutable except through
// the versioning (replace) workflow. Creation/upload/replace/completion publish events, are
// audited, and completion notifies. Scope is Stage 6 only.
//
// Cross-feature access to the Employee aggregate goes through its barrel; file bytes go through
// the platform Files service barrel (ADR-003).
import { Types } from 'mongoose';
import {
  HrHiringDocumentsEvents,
  HrHiringDocumentsTemplates,
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
import { employeeService } from '../employees';
import { hiringDocumentsRepository, type HiringDocumentsListFilter } from './hiring-documents.repository';
import { hiringDocumentTypeRepository } from './hiring-document-type.repository';
import { resolveHiringDocsCategoryId } from './hiring-documents.files';
import { type HiringDocumentItem, type HiringDocumentsDoc } from './hiring-documents.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'hiringDocuments', entityId: id });

class HiringDocumentsService {
  /** Active required document-type keys — drives the completion gate and DTO `missingRequired`. */
  async activeRequiredKeys(): Promise<string[]> {
    return (await hiringDocumentTypeRepository.listActiveRequired()).map((t) => t.key);
  }

  /** Fire-and-forget completion notification to the reporting manager + the creator. */
  private async notifyCompleted(doc: HiringDocumentsDoc): Promise<void> {
    const recipients = new Set<string>([String(doc.managerId), doc.createdBy === null ? '' : String(doc.createdBy)]);
    recipients.delete('');
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
  async listDocumentVersions(id: string, typeId: string, scope: ScopeSelector): Promise<FileDto[]> {
    const before = await hiringDocumentsRepository.getById(id, scope);
    const current = before.documents.find((d) => String(d.typeId) === typeId);
    if (current === undefined) {
      throw new ValidationError([
        { field: 'typeId', code: 'INVALID', message: 'no document of this type' },
      ]);
    }
    const versions = await fileService.listVersions(String(current.fileId));
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
    const present = new Set(before.documents.map((d) => d.typeKey));
    const missing = (await hiringDocumentTypeRepository.listActiveRequired())
      .map((t) => t.key)
      .filter((k) => !present.has(k));
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
}

export const hiringDocumentsService = new HiringDocumentsService();

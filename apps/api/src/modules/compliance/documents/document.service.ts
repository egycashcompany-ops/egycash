// The files inside a Compliance folder (design §3.2, §6, §7). The responsible person puts them in,
// renames them and takes them out; a person the folder is shared with may only open one and
// download it — and each of those is written to the access log, which is what the seen report is
// read from.
import {
  type AddComplianceDocument,
  type ComplianceAccessAction,
  type ComplianceDocumentKind,
  type CompliancePreviewDto,
  type ComplianceSeenReportDto,
  type ComplianceSeenSummaryDto,
  type ComplianceViewerReportDto,
  type CompliancePersonDto,
  type ListComplianceDocumentsQuery,
  type Paginated,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { fileService, type UploadedBinary } from '../../../platform/files';
import { NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { complianceAccessRepository, type PersonAccess } from '../access-log/access.repository';
import {
  auditDocumentCreated,
  auditDocumentDeleted,
  auditDocumentRenamed,
  type DocumentSnapshot,
} from '../compliance-audit';
import { complianceFolderService } from '../folders/folder.service';
import { type ComplianceFolderDoc } from '../folders/folder.model';
import { compliancePeopleService } from '../people/people.service';
import { assertComplianceManager, isComplianceManager } from '../shared/authority';
import { storeFolderFile } from '../shared/file-categories';
import { type ComplianceDocumentDoc } from './document.model';
import { complianceDocumentRepository as repository } from './document.repository';
import { previewOf } from './preview';

const documentSnapshot = (doc: ComplianceDocumentDoc): DocumentSnapshot => ({
  folderId: String(doc.folderId),
  name: doc.name,
  fileName: doc.fileName,
  size: doc.size,
});

/** A file's own name without its extension — the name a document takes when none is typed. */
const baseName = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  const bare = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  return (bare === '' ? fileName : bare).slice(0, 150);
};

/** The bytes a person asked for, and how the response names them. */
export interface ComplianceDocumentContent {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

class ComplianceDocumentService {
  /**
   * One folder's files, newest first. For the responsible person each carries how many of the
   * folder's people have seen it; a reader gets the files alone.
   */
  async list(
    ctx: AuthContext,
    folderId: string,
    query: ListComplianceDocumentsQuery,
  ): Promise<{
    folder: ComplianceFolderDoc;
    page: Paginated<ComplianceDocumentDoc>;
    seen: Map<string, ComplianceSeenSummaryDto> | null;
  }> {
    const folder = await complianceFolderService.getReadable(ctx, folderId);
    const page = await repository.list({
      filter: repository.ofFolder(folderId),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'uploadedAt',
      sortDir: 'desc',
      sortableFields: ['uploadedAt'],
    });
    if (!isComplianceManager(ctx)) return { folder, page, seen: null };
    // The people the folder is shared with who still have an account: one whose account was
    // deleted is neither counted as shared with nor named in the report.
    const resolved = await compliancePeopleService.byIds(
      folder.viewerUserIds.map(String),
      ctx.userId,
    );
    const viewers = [...resolved.keys()];
    const counts = await complianceAccessRepository.seenCounts(
      page.items.map((doc) => String(doc._id)),
      viewers,
    );
    const seen = new Map<string, ComplianceSeenSummaryDto>(
      page.items.map((doc) => [
        String(doc._id),
        { seenBy: counts.get(String(doc._id)) ?? 0, sharedWith: viewers.length },
      ]),
    );
    return { folder, page, seen };
  }

  /**
   * Put one file in a folder: the bytes go to Files under the folder, then the link is written. A
   * link that fails withdraws the upload, so no file is left that nothing names.
   */
  async add(
    ctx: AuthContext,
    folderId: string,
    input: AddComplianceDocument,
    binary: UploadedBinary,
    kind: ComplianceDocumentKind,
  ): Promise<ComplianceDocumentDoc> {
    assertComplianceManager(ctx);
    const folder = await complianceFolderService.getReadable(ctx, folderId);
    const name = input.name ?? baseName(binary.originalName);
    await repository.ensureCollection();
    const file = await storeFolderFile(ctx, String(folder._id), 'documents', name, binary);
    let doc: ComplianceDocumentDoc;
    try {
      doc = await repository.create(
        {
          folderId: folder._id,
          fileId: new Types.ObjectId(String(file._id)),
          name,
          fileName: binary.originalName,
          kind,
          mime: file.mime,
          size: file.size,
          uploadedByUserId: new Types.ObjectId(ctx.userId),
          uploadedAt: new Date(),
        },
        { by: ctx.userId },
      );
    } catch (error) {
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    await auditDocumentCreated(String(doc._id), documentSnapshot(doc));
    return doc;
  }

  async rename(
    ctx: AuthContext,
    id: string,
    name: string,
    version: number,
  ): Promise<ComplianceDocumentDoc> {
    assertComplianceManager(ctx);
    const before = await repository.getById(id);
    if (before.__v !== version) throw new StaleDocumentError();
    const after = await repository.updateById(id, { name }, { by: ctx.userId, version });
    await auditDocumentRenamed(id, before.name, after.name);
    return after;
  }

  /** Take a file out of its folder; its bytes are withdrawn from Files, its access log kept. */
  async remove(ctx: AuthContext, id: string, version: number): Promise<void> {
    assertComplianceManager(ctx);
    const doc = await repository.getById(id);
    if (doc.__v !== version) throw new StaleDocumentError();
    await fileService.softDelete(ctx, String(doc.fileId)).catch(() => undefined);
    await repository.softDeleteById(id, { by: ctx.userId });
    await auditDocumentDeleted(id, documentSnapshot(doc));
  }

  /**
   * One file's bytes, for someone who may see its folder — and, when that someone is one of the
   * people the folder is shared with, one row in the access log. The responsible person's own
   * openings are not counted: the report is about the people the file was shared with.
   */
  async content(
    ctx: AuthContext,
    id: string,
    action: ComplianceAccessAction,
  ): Promise<ComplianceDocumentContent> {
    const { doc, folder } = await this.readable(ctx, id);
    const { buffer, doc: file } = await fileService.readEntityOwnedBuffer(ctx, String(doc.fileId));
    await this.record(ctx, doc, folder, action);
    return { buffer, mime: file.mime, fileName: doc.fileName };
  }

  /** A Word or Excel file read into the page, recorded as one opening — the same act as a PDF's. */
  async preview(ctx: AuthContext, id: string): Promise<CompliancePreviewDto> {
    const { doc, folder } = await this.readable(ctx, id);
    if (doc.kind === 'pdf') return { kind: 'unavailable' };
    const { buffer } = await fileService.readEntityOwnedBuffer(ctx, String(doc.fileId));
    const preview = await previewOf(doc.kind, doc.fileName, buffer);
    // Counted only when something was shown: «cannot be shown here» is not a person having seen it.
    if (preview.kind !== 'unavailable') await this.record(ctx, doc, folder, 'view');
    return preview;
  }

  /**
   * Who has seen one file (§7): everyone the folder is shared with now — those who have not seen it
   * first, then the most recent — and apart from them, anyone who saw it while it was shared with
   * them and is no longer on the list.
   */
  async seenReport(ctx: AuthContext, id: string): Promise<ComplianceSeenReportDto> {
    assertComplianceManager(ctx);
    const { doc, folder } = await this.readable(ctx, id);
    const accesses = await complianceAccessRepository.byPerson(String(doc._id));
    const byUser = new Map(accesses.map((access) => [access.userId, access]));
    const current = folder.viewerUserIds.map(String);
    const currentSet = new Set(current);
    const formerIds = accesses.map((a) => a.userId).filter((userId) => !currentSet.has(userId));
    const people = await compliancePeopleService.byIds([...current, ...formerIds], ctx.userId);

    const line = (userId: string): ComplianceViewerReportDto | null => {
      const person = people.get(userId);
      if (person === undefined) return null;
      return toViewerReport(person, byUser.get(userId));
    };
    const viewers = current
      .map(line)
      .filter((row): row is ComplianceViewerReportDto => row !== null)
      .sort(bySeenThenRecent);
    const former = formerIds
      .map(line)
      .filter((row): row is ComplianceViewerReportDto => row !== null)
      .sort(bySeenThenRecent);
    return { documentId: String(doc._id), viewers, former };
  }

  /** The file and its folder, when the caller may see the folder; a 404 otherwise. */
  private async readable(
    ctx: AuthContext,
    id: string,
  ): Promise<{ doc: ComplianceDocumentDoc; folder: ComplianceFolderDoc }> {
    // One answer for a file that does not exist and a file in a folder the caller may not see, so
    // the answer says nothing about which.
    const doc = await repository.findById(id);
    if (doc === null) throw new NotFoundError('file not found');
    try {
      const folder = await complianceFolderService.getReadable(ctx, String(doc.folderId));
      return { doc, folder };
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError('file not found');
      throw error;
    }
  }

  private async record(
    ctx: AuthContext,
    doc: ComplianceDocumentDoc,
    folder: ComplianceFolderDoc,
    action: ComplianceAccessAction,
  ): Promise<void> {
    const shared = folder.viewerUserIds.some((userId) => String(userId) === ctx.userId);
    if (!shared) return;
    await complianceAccessRepository.record({
      documentId: String(doc._id),
      folderId: String(folder._id),
      userId: ctx.userId,
      action,
    });
  }
}

const toViewerReport = (
  person: CompliancePersonDto,
  access: PersonAccess | undefined,
): ComplianceViewerReportDto => ({
  person,
  seen: access !== undefined,
  viewCount: access?.viewCount ?? 0,
  downloadCount: access?.downloadCount ?? 0,
  firstAt: access === undefined ? null : access.firstAt.toISOString(),
  lastAt: access === undefined ? null : access.lastAt.toISOString(),
  events: (access?.events ?? []).map((event) => ({
    action: event.action,
    at: event.at.toISOString(),
  })),
});

/** Not seen first — those are who the report is for — then the most recently seen. */
const bySeenThenRecent = (a: ComplianceViewerReportDto, b: ComplianceViewerReportDto): number => {
  if (a.seen !== b.seen) return a.seen ? 1 : -1;
  return (
    (b.lastAt ?? '').localeCompare(a.lastAt ?? '') ||
    a.person.name.ar.localeCompare(b.person.name.ar, 'ar')
  );
};

export const complianceDocumentService = new ComplianceDocumentService();

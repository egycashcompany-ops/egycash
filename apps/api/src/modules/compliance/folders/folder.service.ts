// The Compliance files shelf (design §3.1, §4): the folders, their names, their cover pictures and
// who sees them. Every write is the responsible person's (`complianceFile.manage`); every read asks
// the folder's list, so a person not on it learns nothing — not even that the folder exists (404).
import {
  foldName,
  type CreateComplianceFolder,
  type ListComplianceFoldersQuery,
  type Paginated,
  type UpdateComplianceFolder,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { isDuplicateKeyError } from '../../../shared/base/index-sync';
import { ConflictError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import {
  auditFolderCreated,
  auditFolderDeleted,
  auditFolderUpdated,
  type FolderSnapshot,
} from '../compliance-audit';
import { complianceDocumentRepository } from '../documents/document.repository';
import { compliancePeopleService } from '../people/people.service';
import { assertComplianceManager, isComplianceManager } from '../shared/authority';
import { storeFolderFile } from '../shared/file-categories';
import { folderNameTaken, mayReadFolder, viewerChanges, viewersRefused } from './folder-rules';
import { type ComplianceFolderDoc } from './folder.model';
import { complianceFolderRepository as repository } from './folder.repository';
import { syncReaderGrants } from './reader-role';

const snapshot = (doc: ComplianceFolderDoc): FolderSnapshot => ({
  name: doc.name,
  viewerUserIds: doc.viewerUserIds.map(String).sort(),
  cover: doc.cover === null ? null : String(doc.cover.fileId),
});

const objectIds = (ids: readonly string[]): Types.ObjectId[] =>
  ids.map((id) => new Types.ObjectId(id));

/** A rename or a create that a unique index refused after the service's own check passed. */
const asNameTaken = (error: unknown): unknown =>
  error instanceof ConflictError || isDuplicateKeyError(error) ? folderNameTaken() : error;

class ComplianceFolderService {
  /** One page of the shelf: every folder for the responsible person, a reader's own otherwise. */
  async list(
    ctx: AuthContext,
    query: ListComplianceFoldersQuery,
  ): Promise<Paginated<ComplianceFolderDoc>> {
    const viewerId = isComplianceManager(ctx) ? null : ctx.userId;
    return repository.list({
      filter: repository.shelfFilter(viewerId, query.search),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'name',
      sortDir: query.sortBy === undefined ? 'asc' : query.sortDir,
      sortableFields: ['name', 'createdAt', 'updatedAt'],
    });
  }

  /** One folder the caller may see, or a 404 — never a 403 that would say it exists. */
  async getReadable(ctx: AuthContext, id: string): Promise<ComplianceFolderDoc> {
    const folder = await repository.findById(id);
    if (
      folder === null ||
      !mayReadFolder(isComplianceManager(ctx), ctx.userId, folder.viewerUserIds.map(String))
    ) {
      throw new NotFoundError('folder not found');
    }
    return folder;
  }

  async create(ctx: AuthContext, input: CreateComplianceFolder): Promise<ComplianceFolderDoc> {
    assertComplianceManager(ctx);
    const nameKey = foldName(input.name);
    await repository.ensureCollection();
    if ((await repository.findLiveByNameKey(nameKey)) !== null) throw folderNameTaken();
    await this.assertEligible(ctx, input.viewerUserIds);

    let doc: ComplianceFolderDoc;
    try {
      doc = await repository.create(
        { name: input.name, nameKey, cover: null, viewerUserIds: objectIds(input.viewerUserIds) },
        { by: ctx.userId },
      );
    } catch (error) {
      throw asNameTaken(error);
    }
    await auditFolderCreated(String(doc._id), snapshot(doc));
    await syncReaderGrants(input.viewerUserIds);
    return doc;
  }

  /** A rename, a new list of who sees it, or both — under the version the person saw. */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateComplianceFolder,
  ): Promise<ComplianceFolderDoc> {
    assertComplianceManager(ctx);
    const before = await repository.getById(id);
    if (before.__v !== input.version) throw new StaleDocumentError();

    const set: Partial<ComplianceFolderDoc> = {};
    if (input.name !== undefined && input.name !== before.name) {
      const nameKey = foldName(input.name);
      if ((await repository.findLiveByNameKey(nameKey, id)) !== null) throw folderNameTaken();
      set.name = input.name;
      set.nameKey = nameKey;
    }
    let changed: { added: string[]; removed: string[] } = { added: [], removed: [] };
    if (input.viewerUserIds !== undefined) {
      changed = viewerChanges(before.viewerUserIds.map(String), input.viewerUserIds);
      // Only the people ADDED are judged: someone already on the list whose account was suspended
      // since stays until they are taken off, rather than blocking every other change to the list.
      await this.assertEligible(ctx, changed.added);
      set.viewerUserIds = objectIds(input.viewerUserIds);
    }

    await repository.ensureCollection();
    let after: ComplianceFolderDoc;
    try {
      after = await repository.updateById(id, set, { by: ctx.userId, version: input.version });
    } catch (error) {
      throw asNameTaken(error);
    }
    await auditFolderUpdated(id, snapshot(before), snapshot(after));
    await syncReaderGrants([...changed.added, ...changed.removed]);
    return after;
  }

  /**
   * Delete a folder, and with it every file inside and its picture. The files are withdrawn from
   * Files first — while the folder still exists for the authorizer to answer — then their links,
   * then the folder. The access log is kept: it records what happened.
   */
  async remove(ctx: AuthContext, id: string, version: number): Promise<void> {
    assertComplianceManager(ctx);
    const folder = await repository.getById(id);
    if (folder.__v !== version) throw new StaleDocumentError();

    const documents = await complianceDocumentRepository.liveOfFolder(id);
    for (const document of documents) {
      await fileService.softDelete(ctx, String(document.fileId)).catch(() => undefined);
      await complianceDocumentRepository.softDeleteById(String(document._id), { by: ctx.userId });
    }
    if (folder.cover !== null) {
      await fileService.softDelete(ctx, String(folder.cover.fileId)).catch(() => undefined);
    }
    await repository.softDeleteById(id, { by: ctx.userId });
    await auditFolderDeleted(id, snapshot(folder));
    await syncReaderGrants(folder.viewerUserIds.map(String));
  }

  /**
   * Put a picture on the folder's front, or change it. The new picture is stored first; the link is
   * one versioned write; the old picture is withdrawn after. A link that misses withdraws the new
   * picture, so no file is left that nothing names.
   */
  async setCover(
    ctx: AuthContext,
    id: string,
    version: number,
    binary: UploadedBinary,
  ): Promise<ComplianceFolderDoc> {
    assertComplianceManager(ctx);
    const before = await repository.getById(id);
    if (before.__v !== version) throw new StaleDocumentError();

    await repository.ensureCollection();
    const file: FileDoc = await storeFolderFile(ctx, id, 'covers', 'cover', binary);
    let after: ComplianceFolderDoc;
    try {
      after = await repository.updateById(
        id,
        { cover: { fileId: new Types.ObjectId(String(file._id)), setAt: new Date() } },
        { by: ctx.userId, version },
      );
    } catch (error) {
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    if (before.cover !== null) {
      await fileService.softDelete(ctx, String(before.cover.fileId)).catch(() => undefined);
    }
    await auditFolderUpdated(id, snapshot(before), snapshot(after));
    return after;
  }

  /** Take the picture off; the folder wears the plain front again. */
  async removeCover(ctx: AuthContext, id: string, version: number): Promise<ComplianceFolderDoc> {
    assertComplianceManager(ctx);
    const before = await repository.getById(id);
    if (before.__v !== version) throw new StaleDocumentError();
    if (before.cover === null) return before;
    const after = await repository.updateById(id, { cover: null }, { by: ctx.userId, version });
    await fileService.softDelete(ctx, String(before.cover.fileId)).catch(() => undefined);
    await auditFolderUpdated(id, snapshot(before), snapshot(after));
    return after;
  }

  /** The folder's picture, for anyone who may see the folder. */
  async readCover(ctx: AuthContext, id: string): Promise<{ buffer: Buffer; mime: string }> {
    const folder = await this.getReadable(ctx, id);
    if (folder.cover === null) throw new NotFoundError('this folder has no picture');
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(
      ctx,
      String(folder.cover.fileId),
    );
    return { buffer, mime: doc.mime };
  }

  /**
   * 422 unless every id names an active employee account. Checked for the people a write ADDS, so
   * a list is never refused for someone already on it.
   */
  private async assertEligible(ctx: AuthContext, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const found = await compliancePeopleService.byIds(userIds, ctx.userId, {
      activeEmployeesOnly: true,
    });
    const refused = userIds.filter((id) => !found.has(String(new Types.ObjectId(id))));
    if (refused.length > 0) throw viewersRefused(refused);
  }
}

export const complianceFolderService = new ComplianceFolderService();

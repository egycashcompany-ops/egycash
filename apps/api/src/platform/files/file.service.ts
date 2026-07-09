// File Management Service (ADR-010, Platform Core §7). Business rules:
// category-driven intake validation, versioning via groups, archive/restore,
// soft delete (default) vs permission-gated permanent delete, and authorized,
// audited downloads via the signed-URL abstraction (provider presigning where
// the store supports it, app-level HMAC signing otherwise).
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Types, type FilterQuery } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  type DownloadTicketDto,
  type FileDto,
  type ListFilesQuery,
  type Paginated,
  type UpdateFile,
  type UploadFileFields,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/logging/logger';
import { getStorageProvider } from '../../infrastructure/storage';
import { AppError, BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { hasPermission, type AuthContext, type ScopeSelector } from '../../shared/types';
import { diffChanges } from '../../shared/utils/diff';
import { hmacSha256, safeEqualHex, sha256Buffer } from '../../shared/utils/crypto';
import { auditService } from '../audit';
import { emit, nudgeOutboxRelay } from '../kernel/event-bus';
import { unitOfWork } from '../kernel/unit-of-work';
import { fileRepository } from './file.repository';
import { fileCategoryRepository } from './file-category.repository';
import { enqueueFileProcessing, hasFileProcessor } from './file.processors';
import { type FileDoc } from './file.model';
import { type FileCategoryDoc } from './file-category.model';

export interface UploadedBinary {
  originalName: string;
  mime: string;
  size: number;
  buffer: Buffer;
}

const entityRefOf = (fileId: string) => ({
  moduleId: 'platform',
  entityType: 'file',
  entityId: fileId,
});

const sanitizeExtension = (originalName: string): string => {
  const ext = extname(originalName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
};

const mimeAllowed = (mime: string, allowed: string[]): boolean =>
  allowed.some((rule) =>
    rule.endsWith('/*') ? mime.startsWith(rule.slice(0, -1)) : mime === rule,
  );

const fileEventPayload = (doc: FileDoc) => ({
  fileId: String(doc._id),
  groupId: String(doc.groupId),
  fileVersion: doc.fileVersion,
  entityRef: doc.entityRef,
  categoryId: String(doc.categoryId),
  mime: doc.mime,
  size: doc.size,
});

class FileService {
  // ── Intake rules (category-driven) ─────────────────────────────────────────

  private async loadActiveCategory(categoryId: string): Promise<FileCategoryDoc> {
    const category = await fileCategoryRepository.findById(categoryId);
    if (category === null) throw new NotFoundError('File category not found');
    if (category.status !== 'active') {
      throw new BusinessRuleError('File category is inactive', ErrorCodes.FILE_CATEGORY_INACTIVE);
    }
    return category;
  }

  private assertCategoryRules(binary: UploadedBinary, category: FileCategoryDoc): void {
    if (!mimeAllowed(binary.mime, category.allowedMimeTypes)) {
      throw new BusinessRuleError(
        `Type ${binary.mime} is not allowed for category ${category.key}`,
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
      );
    }
    if (binary.size > category.maxSizeMb * 1024 * 1024) {
      throw new BusinessRuleError(
        `File exceeds the ${category.maxSizeMb} MB limit of category ${category.key}`,
        ErrorCodes.FILE_TOO_LARGE,
      );
    }
  }

  // ── Upload / replace ───────────────────────────────────────────────────────

  private async storeVersion(params: {
    binary: UploadedBinary;
    category: FileCategoryDoc;
    groupId: Types.ObjectId;
    fileVersion: number;
    fields: Pick<FileDoc, 'entityRef' | 'visibility' | 'tags'> & {
      displayName: string;
      description: string | null;
    };
    by: string;
  }): Promise<FileDoc> {
    const { binary, category, groupId, fileVersion, fields, by } = params;
    const provider = getStorageProvider();
    const extension = sanitizeExtension(binary.originalName);
    const storedName = `${fileVersion}-${randomUUID()}${extension}`;
    const key = `files/${String(groupId)}/${storedName}`;

    // Binary first; the metadata transaction owns the commit decision — a failed
    // transaction leaves an orphan binary which is deleted best-effort.
    await provider.put(key, binary.buffer, { contentType: binary.mime });
    try {
      const doc = await unitOfWork(async (session) => {
        await fileRepository.markGroupNotLatest(groupId, session);
        const created = await fileRepository.create(
          {
            groupId,
            fileVersion,
            isLatest: true,
            originalName: binary.originalName,
            storedName,
            displayName: fields.displayName,
            description: fields.description,
            mime: binary.mime,
            extension,
            size: binary.size,
            checksum: `sha256:${sha256Buffer(binary.buffer)}`,
            categoryId: category._id,
            tags: fields.tags,
            visibility: fields.visibility,
            status: 'active',
            scanStatus: hasFileProcessor('virusScan') ? 'pending' : 'unscanned',
            entityRef: fields.entityRef,
            storage: { driver: provider.driver, key },
            uploadedBy: new Types.ObjectId(by),
            uploadedAt: new Date(),
          },
          { by, session },
        );
        await emit(PlatformEvents.FileUploaded, fileEventPayload(created), {
          reliable: true,
          session,
        });
        return created;
      });
      nudgeOutboxRelay();
      return doc;
    } catch (error) {
      await provider.delete(key).catch((cleanupError: unknown) => {
        logger.warn({ err: cleanupError, key }, 'orphan binary cleanup failed');
      });
      throw error;
    }
  }

  async upload(
    ctx: AuthContext,
    fields: UploadFileFields,
    binary: UploadedBinary,
  ): Promise<FileDoc> {
    const category = await this.loadActiveCategory(fields.categoryId);
    this.assertCategoryRules(binary, category);

    const entityRef = {
      moduleId: fields.moduleId,
      entityType: fields.entityType,
      entityId: fields.entityId,
    };
    const group = await fileRepository.createGroup(entityRef);
    const doc = await this.storeVersion({
      binary,
      category,
      groupId: group._id,
      fileVersion: 1,
      fields: {
        entityRef,
        visibility: fields.visibility,
        tags: fields.tags ?? [],
        displayName: fields.displayName ?? binary.originalName,
        description: fields.description ?? null,
      },
      by: ctx.userId,
    });

    await auditService.record({
      entityRef: entityRefOf(String(doc._id)),
      action: 'create',
      changes: diffChanges(
        {},
        {
          originalName: doc.originalName,
          mime: doc.mime,
          size: doc.size,
          checksum: doc.checksum,
          category: category.key,
          entity: `${entityRef.moduleId}/${entityRef.entityType}/${entityRef.entityId}`,
        },
      ),
    });
    await enqueueFileProcessing(doc._id);
    return doc;
  }

  /** Replace = version n+1 in the same group; previous versions stay retrievable. */
  async replace(ctx: AuthContext, fileId: string, binary: UploadedBinary): Promise<FileDoc> {
    const current = await fileRepository.getById(fileId);
    if (!current.isLatest) {
      throw new BusinessRuleError('Only the latest version of a file can be replaced');
    }
    if (current.status !== 'active') {
      throw new BusinessRuleError('Archived files cannot be replaced — restore first');
    }
    const category = await this.loadActiveCategory(String(current.categoryId));
    this.assertCategoryRules(binary, category);

    const fileVersion = await fileRepository.allocateVersion(current.groupId);
    const doc = await this.storeVersion({
      binary,
      category,
      groupId: current.groupId,
      fileVersion,
      fields: {
        entityRef: current.entityRef,
        visibility: current.visibility,
        tags: current.tags,
        displayName: current.displayName,
        description: current.description,
      },
      by: ctx.userId,
    });

    await auditService.record({
      entityRef: entityRefOf(String(doc._id)),
      action: 'update',
      changes: [
        { field: 'fileVersion', old: current.fileVersion, new: doc.fileVersion },
        { field: 'checksum', old: current.checksum, new: doc.checksum },
      ],
    });
    await enqueueFileProcessing(doc._id);
    return doc;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async getById(id: string, scope?: ScopeSelector): Promise<FileDoc> {
    return fileRepository.getById(id, scope);
  }

  async listVersions(id: string, scope?: ScopeSelector): Promise<FileDoc[]> {
    const doc = await fileRepository.getById(id, scope);
    return fileRepository.listVersions(doc.groupId);
  }

  async list(query: ListFilesQuery, scope: ScopeSelector): Promise<Paginated<FileDoc>> {
    const filter: Record<string, unknown> = {
      isLatest: true,
      status: query.status ?? 'active',
    };
    if (query.moduleId !== undefined) filter['entityRef.moduleId'] = query.moduleId;
    if (query.entityType !== undefined) filter['entityRef.entityType'] = query.entityType;
    if (query.entityId !== undefined) filter['entityRef.entityId'] = query.entityId;
    if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.tag !== undefined) filter.tags = query.tag;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ originalName: pattern }, { displayName: pattern }, { description: pattern }];
    }
    return fileRepository.list({
      filter: filter as FilterQuery<FileDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['uploadedAt', 'size', 'originalName', 'createdAt'],
      scope,
    });
  }

  // ── Metadata update ────────────────────────────────────────────────────────

  async update(ctx: AuthContext, id: string, input: UpdateFile): Promise<FileDoc> {
    const before = await fileRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.displayName !== undefined) set.displayName = input.displayName;
    if (input.description !== undefined) set.description = input.description;
    if (input.visibility !== undefined) set.visibility = input.visibility;
    if (input.tags !== undefined) set.tags = input.tags;
    if (input.categoryId !== undefined) {
      const category = await this.loadActiveCategory(input.categoryId);
      set.categoryId = category._id;
    }
    const after = await fileRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRefOf(id),
      action: 'update',
      changes: diffChanges(
        {
          displayName: before.displayName,
          description: before.description,
          visibility: before.visibility,
          tags: before.tags,
          categoryId: before.categoryId,
        },
        {
          displayName: after.displayName,
          description: after.description,
          visibility: after.visibility,
          tags: after.tags,
          categoryId: after.categoryId,
        },
      ),
    });
    return after;
  }

  // ── Archive / restore ──────────────────────────────────────────────────────

  async archive(ctx: AuthContext, id: string): Promise<FileDoc> {
    const before = await fileRepository.getById(id);
    if (before.status === 'archived') return before;
    const after = await fileRepository.updateById(
      id,
      { status: 'archived', archivedAt: new Date() },
      { by: ctx.userId, version: before.__v },
    );
    await auditService.record({ entityRef: entityRefOf(id), action: 'archive' });
    await emit(PlatformEvents.FileArchived, fileEventPayload(after), { reliable: true });
    nudgeOutboxRelay();
    return after;
  }

  async restore(ctx: AuthContext, id: string): Promise<FileDoc> {
    const before = await fileRepository.getById(id);
    if (before.status === 'active') return before;
    const after = await fileRepository.updateById(
      id,
      { status: 'active', archivedAt: null },
      { by: ctx.userId, version: before.__v },
    );
    await auditService.record({ entityRef: entityRefOf(id), action: 'restore' });
    await emit(PlatformEvents.FileRestored, fileEventPayload(after), { reliable: true });
    nudgeOutboxRelay();
    return after;
  }

  // ── Delete (soft by default; permanent is break-glass) ───────────────────

  async softDelete(ctx: AuthContext, id: string, scope?: ScopeSelector): Promise<void> {
    const doc = await fileRepository.softDeleteById(id, { by: ctx.userId, scope });
    await auditService.record({ entityRef: entityRefOf(id), action: 'delete' });
    await emit(PlatformEvents.FileDeleted, fileEventPayload(doc), { reliable: true });
    nudgeOutboxRelay();
  }

  /**
   * Permanent delete (file.purge, audited break-glass): removes the binary from
   * storage and hard-deletes the metadata document. The audit record preserves
   * the fact and the fingerprint of what existed.
   */
  async permanentDelete(ctx: AuthContext, id: string): Promise<void> {
    const doc = await fileRepository.findAnyById(id);
    if (doc === null) throw new NotFoundError();

    await getStorageProvider().delete(doc.storage.key);
    await fileRepository.hardDelete(doc._id);
    if ((await fileRepository.countInGroup(doc.groupId)) === 0) {
      await fileRepository.deleteGroup(doc.groupId);
    }

    await auditService.record({
      entityRef: entityRefOf(id),
      action: 'purge',
      changes: diffChanges(
        {
          originalName: doc.originalName,
          checksum: doc.checksum,
          size: doc.size,
          entity: `${doc.entityRef.moduleId}/${doc.entityRef.entityType}/${doc.entityRef.entityId}`,
          fileVersion: doc.fileVersion,
        },
        {},
      ),
    });
    await emit(
      PlatformEvents.FileDeleted,
      { ...fileEventPayload(doc), permanent: true },
      { reliable: true },
    );
    nudgeOutboxRelay();
    logger.warn({ fileId: id, by: ctx.userId }, 'BREAK-GLASS: file permanently deleted');
  }

  // ── Download (authorized + audited; signed-URL abstraction) ───────────────

  private appSignedUrl(fileId: string, expiresAtEpoch: number): string {
    const signature = hmacSha256(env.STORAGE_SIGNING_SECRET, `${fileId}.${expiresAtEpoch}`);
    return `${env.API_PUBLIC_URL}/api/v1/platform/files/signed/${fileId}?e=${expiresAtEpoch}&s=${signature}`;
  }

  verifyAppSignature(fileId: string, expiresAtEpoch: number, signature: string): boolean {
    if (Number.isNaN(expiresAtEpoch) || expiresAtEpoch * 1000 < Date.now()) return false;
    return safeEqualHex(
      hmacSha256(env.STORAGE_SIGNING_SECRET, `${fileId}.${expiresAtEpoch}`),
      signature,
    );
  }

  /** Authorization: public → any authenticated user; private → file.download. */
  private async authorizeDownload(ctx: AuthContext, doc: FileDoc): Promise<void> {
    if (doc.scanStatus === 'blocked') {
      throw new BusinessRuleError('File is blocked by the virus scanner', ErrorCodes.FILE_BLOCKED);
    }
    if (doc.visibility === 'private' && !hasPermission(ctx, 'file.download')) {
      await auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
        action: 'permissionDenied',
        changes: [{ field: 'permission', old: null, new: 'file.download' }],
      });
      throw new ForbiddenError();
    }
  }

  async issueDownloadTicket(ctx: AuthContext, id: string): Promise<DownloadTicketDto> {
    const doc = await fileRepository.getById(id);
    await this.authorizeDownload(ctx, doc);

    const ttl = env.SIGNED_URL_TTL_SECONDS;
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttl;
    const presigned = await getStorageProvider().getSignedUrl(doc.storage.key, ttl, {
      filename: `${doc.displayName}${doc.extension}`,
      contentType: doc.mime,
    });
    const url = presigned ?? this.appSignedUrl(String(doc._id), expiresAtEpoch);

    // Every download is individually audited (Security Architecture §5).
    await auditService.record({ entityRef: entityRefOf(id), action: 'download' });
    return { url, expiresAt: new Date(expiresAtEpoch * 1000).toISOString() };
  }

  /** Streaming behind an app-signed capability URL (local/railway drivers). */
  async openSignedStream(
    fileId: string,
    expiresAtEpoch: number,
    signature: string,
  ): Promise<{ doc: FileDoc; stream: NodeJS.ReadableStream }> {
    if (!this.verifyAppSignature(fileId, expiresAtEpoch, signature)) {
      throw new AppError(ErrorCodes.FILE_SIGNATURE_INVALID, 403, 'Signed URL invalid or expired');
    }
    const doc = await fileRepository.findById(fileId);
    if (doc === null) throw new NotFoundError();
    if (doc.scanStatus === 'blocked') {
      throw new BusinessRuleError('File is blocked by the virus scanner', ErrorCodes.FILE_BLOCKED);
    }
    const stream = await getStorageProvider().getStream(doc.storage.key);
    return { doc, stream };
  }

  // ── DTO ────────────────────────────────────────────────────────────────────

  toDto(doc: FileDoc): FileDto {
    return {
      id: String(doc._id),
      groupId: String(doc.groupId),
      fileVersion: doc.fileVersion,
      isLatest: doc.isLatest,
      originalName: doc.originalName,
      storedName: doc.storedName,
      displayName: doc.displayName,
      description: doc.description,
      mime: doc.mime,
      extension: doc.extension,
      size: doc.size,
      checksum: doc.checksum,
      categoryId: String(doc.categoryId),
      tags: doc.tags,
      visibility: doc.visibility,
      status: doc.status,
      scanStatus: doc.scanStatus,
      entityRef: doc.entityRef,
      storageDriver: doc.storage.driver,
      uploadedBy: doc.uploadedBy === null ? null : String(doc.uploadedBy),
      uploadedAt: doc.uploadedAt.toISOString(),
      version: doc.__v,
    };
  }
}

export const fileService = new FileService();

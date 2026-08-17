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
import {
  authorizeFileEntity,
  hasFileEntityAuthorizer,
  type FileAccessIntent,
} from './file-authorizers';
import { type FileDoc } from './file.model';
import { type FileCategoryDoc } from './file-category.model';
import { signedFileUrl } from './signed-url';

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

const streamToBuffer = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
};

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
    // ADR-023 — attaching a file to an entity IS a write to that entity. Not in the ADR's table
    // (which enumerates the paths that read or mutate an EXISTING file), but the same rule: a
    // caller who may not touch a ticket must not be able to plant a file on it.
    if (!(await authorizeFileEntity(ctx, entityRef, 'write'))) throw new ForbiddenError();
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
    await this.assertEntityAccess(ctx, current, 'write');
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

  /**
   * Independent COPY of a file's current bytes into a NEW group under a different entity. The copy
   * is a standalone v1 with freshly stored bytes and its own history — replacing, versioning, or
   * deleting it never touches the source (and vice-versa). Used by the Electronic Employee File to
   * hold copies of the hiring documents that stay put even if the originals are later changed.
   */
  async copy(
    ctx: AuthContext,
    sourceFileId: string,
    target: {
      moduleId: string;
      entityType: string;
      entityId: string;
      categoryId: string;
      displayName: string;
      visibility: FileDoc['visibility'];
      tags?: string[];
      description?: string | null;
    },
  ): Promise<FileDoc> {
    const source = await fileRepository.getById(sourceFileId);
    // ADR-023 — copying READS the source's bytes. Before this, `copy` was the quietest way to get
    // them: no authorization call at all, and the copy lands under an entityRef the caller chooses.
    await this.assertEntityAccess(ctx, source, 'read');
    const category = await this.loadActiveCategory(target.categoryId);
    const buffer = await streamToBuffer(await getStorageProvider().getStream(source.storage.key));
    const binary: UploadedBinary = {
      originalName: source.originalName,
      mime: source.mime,
      size: source.size,
      buffer,
    };
    const entityRef = { moduleId: target.moduleId, entityType: target.entityType, entityId: target.entityId };
    const group = await fileRepository.createGroup(entityRef);
    const doc = await this.storeVersion({
      binary,
      category,
      groupId: group._id,
      fileVersion: 1,
      fields: {
        entityRef,
        visibility: target.visibility,
        tags: target.tags ?? [],
        displayName: target.displayName,
        description: target.description ?? null,
      },
      by: ctx.userId,
    });
    await auditService.record({
      entityRef: entityRefOf(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'copiedFrom', old: null, new: sourceFileId },
        { field: 'checksum', old: null, new: doc.checksum },
      ],
    });
    await enqueueFileProcessing(doc._id);
    return doc;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * `ctx` is optional ONLY for the internal callers that have already authorized (upload returning
   * its own row). Every request-driven read passes it, and without it a guarded file is refused —
   * the safe default for a signature that could otherwise be used to skip the check.
   */
  async getById(id: string, scope?: ScopeSelector, ctx?: AuthContext): Promise<FileDoc> {
    const doc = await fileRepository.getById(id, scope);
    if (ctx !== undefined) await this.assertEntityAccess(ctx, doc, 'read');
    else if (this.isGuarded(doc)) throw new NotFoundError();
    return doc;
  }

  async listVersions(id: string, scope: ScopeSelector | undefined, ctx: AuthContext): Promise<FileDoc[]> {
    const doc = await this.getById(id, scope, ctx);
    return fileRepository.listVersions(doc.groupId);
  }

  async list(
    query: ListFilesQuery,
    scope: ScopeSelector,
    ctx?: AuthContext,
  ): Promise<Paginated<FileDoc>> {
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
    const page = await fileRepository.list({
      filter: filter as FilterQuery<FileDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['uploadedAt', 'size', 'originalName', 'createdAt'],
      scope,
    });
    // ADR-023 — a listing spans many entities, so guarded rows are FILTERED rather than throwing:
    // one inaccessible row must not blank a legitimate page. Without a caller no guarded row is
    // returned at all, which is the safe reading of "nobody asked".
    if (ctx === undefined) {
      return { ...page, items: page.items.filter((doc) => !this.isGuarded(doc)) };
    }
    // One question per distinct entity, not per row: a ticket with twelve attachments is one
    // lookup, and the memo also bounds what a wide page can cost.
    const decisions = new Map<string, Promise<boolean>>();
    const allowed = await Promise.all(
      page.items.map((doc) => {
        const id = `${doc.entityRef.moduleId}/${doc.entityRef.entityType}/${doc.entityRef.entityId}`;
        let decision = decisions.get(id);
        if (decision === undefined) {
          decision = authorizeFileEntity(ctx, doc.entityRef, 'read');
          decisions.set(id, decision);
        }
        return decision;
      }),
    );
    const items = page.items.filter((_doc, index) => allowed[index] === true);
    // `meta.totalItems` stays the repository's count deliberately: recomputing it would need the
    // authorizer run over every matching row in the collection, not just this page.
    return { ...page, items };
  }

  // ── Metadata update ────────────────────────────────────────────────────────

  async update(ctx: AuthContext, id: string, input: UpdateFile): Promise<FileDoc> {
    const before = await fileRepository.getById(id);
    // A `visibility` change is exactly why this is a WRITE check: without it, `file.edit` would be
    // a way to flip a guarded file to `public` and widen what the owning module allows.
    await this.assertEntityAccess(ctx, before, 'write');
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
    await this.assertEntityAccess(ctx, before, 'write');
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
    await this.assertEntityAccess(ctx, before, 'write');
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
    await this.assertEntityAccess(ctx, await fileRepository.getById(id, scope), 'write');
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
    await this.assertEntityAccess(ctx, doc, 'write');

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

  /**
   * The signed payload. For a GUARDED file (ADR-023 · T2) the subject is part of it, which is what
   * turns the URL from a bearer capability into one person's ticket: a link leaked to a colleague
   * verifies against THEIR id and fails.
   */
  private signaturePayload(fileId: string, expiresAtEpoch: number, userId: string | null): string {
    return userId === null
      ? `${fileId}.${expiresAtEpoch}`
      : `${fileId}.${expiresAtEpoch}.${userId}`;
  }

  private appSignedUrl(fileId: string, expiresAtEpoch: number, userId: string | null): string {
    return signedFileUrl({
      fileId,
      expiresAtEpoch,
      signature: hmacSha256(
        env.STORAGE_SIGNING_SECRET,
        this.signaturePayload(fileId, expiresAtEpoch, userId),
      ),
      basePath: env.BASE_PATH,
      apiPublicUrl: env.API_PUBLIC_URL,
      servesWebApp: env.WEB_STATIC_DIR !== '',
    });
  }

  verifyAppSignature(
    fileId: string,
    expiresAtEpoch: number,
    signature: string,
    userId: string | null = null,
  ): boolean {
    if (Number.isNaN(expiresAtEpoch) || expiresAtEpoch * 1000 < Date.now()) return false;
    return safeEqualHex(
      hmacSha256(env.STORAGE_SIGNING_SECRET, this.signaturePayload(fileId, expiresAtEpoch, userId)),
      signature,
    );
  }

  /** Whether this file's owning entity type is GUARDED by a module authorizer (ADR-023). */
  private isGuarded(doc: FileDoc): boolean {
    const ref = doc.entityRef as FileDoc['entityRef'] | undefined;
    return ref !== undefined && hasFileEntityAuthorizer(ref.moduleId, ref.entityType);
  }

  /**
   * ADR-023 — the owning entity decides. THE central gate: every path that can reach a file's
   * metadata or its bytes calls this, not just download.
   *
   * Silent for entity types no module has claimed, so files outside the seam keep the rules they
   * had. For a guarded entity the answer is final in one direction only: it can refuse a caller
   * that `visibility` would have allowed, and it can never be overridden by a file-level grant.
   *
   * `notFound` is the right shape for reads: the existence of a file attached to an entity the
   * caller cannot see is itself information. Writes answer 403, because reaching a write path at
   * all means the caller already proved they can see the file.
   */
  private async assertEntityAccess(
    ctx: AuthContext,
    doc: FileDoc,
    intent: FileAccessIntent,
  ): Promise<void> {
    if (await authorizeFileEntity(ctx, doc.entityRef, intent)) return;
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
      action: 'permissionDenied',
      changes: [
        {
          field: 'fileEntity',
          old: null,
          new: `${doc.entityRef.moduleId}/${doc.entityRef.entityType}:${intent}`,
        },
      ],
    });
    throw intent === 'read' ? new NotFoundError() : new ForbiddenError();
  }

  /**
   * Authorization for the BYTES: scanner, then the owning entity (ADR-023), then the file-level
   * rule (public → any authenticated user; private → `file.download`).
   *
   * Order matters. The entity check runs FIRST and independently, so a `public` file attached to a
   * guarded entity is still refused — otherwise a `file.edit` holder flipping `visibility` would
   * become a way to publish another module's confidential data.
   */
  private async authorizeDownload(ctx: AuthContext, doc: FileDoc): Promise<void> {
    if (doc.scanStatus === 'blocked') {
      throw new BusinessRuleError('File is blocked by the virus scanner', ErrorCodes.FILE_BLOCKED);
    }
    await this.assertEntityAccess(ctx, doc, 'read');
    if (doc.visibility === 'private' && !hasPermission(ctx, 'file.download')) {
      await auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: ctx.userId },
        action: 'permissionDenied',
        changes: [{ field: 'permission', old: null, new: 'file.download' }],
      });
      throw new ForbiddenError();
    }
  }

  /** Authorized byte read for server-side embedding (e.g. branding logos in renders). */
  async readBuffer(ctx: AuthContext, id: string): Promise<{ doc: FileDoc; buffer: Buffer }> {
    const doc = await fileRepository.getById(id);
    // `authorizeDownload` already asks the owning entity (ADR-023) before the file-level rule.
    await this.authorizeDownload(ctx, doc);
    const buffer = await streamToBuffer(await getStorageProvider().getStream(doc.storage.key));
    return { doc, buffer };
  }

  /**
   * Byte read for a document a MODULE owns and serves through its own endpoint.
   *
   * The difference from `readBuffer` is one rule, and only one: the generic file-level grant
   * (`file.download` for a private file) is not applied. That rule exists for the GENERIC file
   * surface, where nothing has vouched for the caller and `visibility` is all there is to go on.
   * Here the module's own endpoint has already authorized the read against the entity's
   * permission and data scope, and the ADR-023 authorizer below re-asks it independently — so
   * requiring a second, unrelated platform grant would not add a check, it would just make a
   * module's own document unreadable to the very role that owns it.
   *
   * Everything else is unchanged and non-negotiable:
   *   • a blocked file is still refused, exactly as `authorizeDownload` refuses it;
   *   • `assertEntityAccess` still runs, so an entity type WITHOUT an authorizer gets no benefit
   *     from this path — an unclaimed type answers `true` and would be readable by any caller,
   *     which is why the guard below refuses to serve one at all.
   *
   * That last guard is what stops this becoming a way around the file-level rule: it is usable
   * only for entity types a module has explicitly claimed and therefore actively polices.
   */
  async readEntityOwnedBuffer(
    ctx: AuthContext,
    id: string,
  ): Promise<{ doc: FileDoc; buffer: Buffer }> {
    const doc = await fileRepository.getById(id);
    if (!this.isGuarded(doc)) {
      throw new ForbiddenError();
    }
    if (doc.scanStatus === 'blocked') {
      throw new BusinessRuleError('File is blocked by the virus scanner', ErrorCodes.FILE_BLOCKED);
    }
    await this.assertEntityAccess(ctx, doc, 'read');
    const buffer = await streamToBuffer(await getStorageProvider().getStream(doc.storage.key));
    return { doc, buffer };
  }

  async issueDownloadTicket(ctx: AuthContext, id: string): Promise<DownloadTicketDto> {
    const doc = await fileRepository.getById(id);
    await this.authorizeDownload(ctx, doc);

    const ttl = env.SIGNED_URL_TTL_SECONDS;
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttl;
    // A ticket is what the BROWSER is handed, so it has to be a URL the app's own document is
    // allowed to load. A provider's presigned URL is absolute and on the store's origin; the app's
    // Content-Security-Policy names only `'self'`, so the browser refuses it before any request is
    // made — server-side everything looks perfect. Unless a deployment has explicitly said its
    // store's origin is allowed, the app signs the URL itself and streams the bytes, which is
    // same-origin under every driver.
    // ADR-023 — a provider's presigned URL leaves the application entirely: no subject binding, no
    // re-check, no revocation. For a guarded entity that would hand back exactly the capability
    // this ADR exists to remove, so the flag is IGNORED for those files and the app signs instead.
    const guarded = this.isGuarded(doc);
    const presigned =
      env.STORAGE_PRESIGNED_URLS && !guarded
        ? await getStorageProvider().getSignedUrl(doc.storage.key, ttl, {
            filename: `${doc.displayName}${doc.extension}`,
            contentType: doc.mime,
          })
        : null;
    const url =
      presigned ?? this.appSignedUrl(String(doc._id), expiresAtEpoch, guarded ? ctx.userId : null);

    // Every download is individually audited (Security Architecture §5).
    await auditService.record({ entityRef: entityRefOf(id), action: 'download' });
    return { url, expiresAt: new Date(expiresAtEpoch * 1000).toISOString() };
  }

  /** Streaming behind an app-signed capability URL (local/railway drivers). */
  /**
   * Streaming behind the app-signed capability URL.
   *
   * Two regimes, and which one applies is a property of the FILE, not of the request (ADR-023):
   *
   *   * unguarded — unchanged: an unauthenticated capability URL, which is what lets a branding
   *     logo load in an `<img>` from another origin;
   *   * guarded   — the caller must be authenticated, must be the subject the ticket was minted
   *     for, and the owning module is asked AGAIN here. That last part is what makes a revoked
   *     grant take effect immediately instead of at ticket expiry.
   */
  async openSignedStream(
    fileId: string,
    expiresAtEpoch: number,
    signature: string,
    ctx: AuthContext | null = null,
  ): Promise<{ doc: FileDoc; stream: NodeJS.ReadableStream }> {
    const doc = await fileRepository.findById(fileId);
    if (doc === null) throw new NotFoundError();
    const guarded = this.isGuarded(doc);
    // A guarded file's ticket is only valid for its subject; an unguarded one keeps the bearer
    // signature. Checking the file first is deliberate — the signature shape depends on it.
    const subject = guarded ? (ctx?.userId ?? null) : null;
    if (guarded && ctx === null) {
      throw new AppError(ErrorCodes.FILE_SIGNATURE_INVALID, 403, 'Signed URL requires a session');
    }
    if (!this.verifyAppSignature(fileId, expiresAtEpoch, signature, subject)) {
      throw new AppError(ErrorCodes.FILE_SIGNATURE_INVALID, 403, 'Signed URL invalid or expired');
    }
    if (doc.scanStatus === 'blocked') {
      throw new BusinessRuleError('File is blocked by the virus scanner', ErrorCodes.FILE_BLOCKED);
    }
    if (guarded && ctx !== null) await this.assertEntityAccess(ctx, doc, 'read');
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

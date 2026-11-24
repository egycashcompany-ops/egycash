// A supplier's papers (design §11; OD-11 A) — «مستندات المورد»: the commercial registry, the tax
// card, whatever the company files to know who it buys from. Files owns the bytes; the supplier owns
// the links, a typed list of at most 20 (list B, §11.4). Three pieces live here:
//
//   * the CATEGORY — PDF and images, 10 MB (OD-76 (i)), kept for ever (OD-77 A) — so intake refuses
//     what the documents card cannot preview before a byte is stored. Ensured by the seed, its id
//     cached, and the cache dropped when the category is no longer found (§11.1);
//   * the AUTHORIZER (ADR-023), so the platform's own file paths ask the supplier's keys: reading
//     takes `administrationSupplier.view`, writing `.edit`. Suppliers carry no scope field, so a
//     key at any scope finds any supplier; for a write the key must be held at ORGANIZATION scope,
//     the rule the paper endpoints apply (OD-04 A), or a branch holder's `.edit` would reach every
//     supplier's papers through a side door;
//   * the PAPERS themselves: link one (upload, then a version-held link write), remove one's link,
//     and read one's bytes — through `readEntityOwnedBuffer`, which keeps the scan gate.
//
// No paper is required (OD-76 A names none for a supplier), so no gate reads the scan states; the
// detail shows them (§11.5). A supplier has no draft or submission, so its list is open whatever
// its status.
import {
  ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB,
  ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES,
  MAX_PAGE_SIZE,
  type AddAdministrationSupplierAttachment,
  type CreateFileCategory,
  type ScanStatus,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import {
  fileCategoryService,
  fileService,
  type FileDoc,
  type FileEntityAuthorizer,
  type UploadedBinary,
} from '../../../../platform/files';
import { NotFoundError, StaleDocumentError } from '../../../../shared/errors';
import {
  hasPermission,
  scopeOf,
  type AuthContext,
  type ScopeSelector,
} from '../../../../shared/types';
import { assertCurrentVersion } from '../../shared/master-data';
import { assertAdministrationOrgAuthority } from '../../shared/org-authority';
import { auditSupplierPaperAdded, auditSupplierPaperRemoved } from './supplier-audit';
import { isPaperListFull, paperLimitRefusal } from './supplier-rules';
import {
  type AdministrationSupplierAttachmentSub,
  type AdministrationSupplierDoc,
} from './supplier.model';
import { administrationSupplierRepository as repository } from './supplier.repository';

// ── The category ────────────────────────────────────────────────────────────

const SUPPLIER_DOCUMENTS_CATEGORY: CreateFileCategory = {
  key: ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY,
  name: { ar: 'مستندات الموردين', en: 'Supplier documents' },
  allowedMimeTypes: [...ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES],
  maxSizeMb: ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB,
  // OD-77 A: kept for ever. Rules are fixed when first ensured; a later period is an operator's
  // `PATCH /platform/file-categories/:id`, never a seed change (§11.1).
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time and idempotent, so the category exists before the first upload asks for it. */
export const ensureSupplierDocumentsCategory = async (): Promise<string> => {
  const category = await fileCategoryService.ensure(SUPPLIER_DOCUMENTS_CATEGORY);
  cachedCategoryId = String(category._id);
  return cachedCategoryId;
};

/** The category id an upload writes into, ensured and cached on first use. */
const resolveCategoryId = async (): Promise<string> =>
  cachedCategoryId ?? ensureSupplierDocumentsCategory();

// ── The authorizer (ADR-023, §11.3) ─────────────────────────────────────────

const READ_KEY = 'administrationSupplier.view';
const WRITE_KEY = 'administrationSupplier.edit';

/**
 * May this caller reach a supplier's papers? It does not opt into the separate delete intent, so a
 * removal through the platform is asked as a write and needs the write key — the intent test below
 * stays right. A supplier that does not exist denies rather than throws: the caller learns nothing.
 */
export const supplierFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'supplier',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    const isAllowed =
      intent === 'write'
        ? scopeOf(ctx, WRITE_KEY) === 'organization'
        : hasPermission(ctx, READ_KEY);
    if (!isAllowed) return false;
    return (await repository.findById(entityId)) !== null;
  },
};

// ── The papers ──────────────────────────────────────────────────────────────

/** Files are read whole by entity: the files collection carries no scope of its own. */
const filesUnscoped = (ctx: AuthContext): ScopeSelector => ({
  scope: 'organization',
  userId: ctx.userId,
  branchId: null,
  departmentId: null,
  sectionId: null,
});

/** An id as the database spells it: the route takes A-F too, and ids compare as strings. */
const canonicalId = (id: string): string => String(new Types.ObjectId(id));

/** The supplier's paper `attachmentId` names, or a 404 — never another supplier's (§11.4). */
const paperOf = (
  supplier: AdministrationSupplierDoc,
  attachmentId: string,
): AdministrationSupplierAttachmentSub => {
  const wanted = canonicalId(attachmentId);
  const paper = supplier.attachments.find((entry) => String(entry.attachmentId) === wanted);
  if (paper === undefined) throw new NotFoundError('this supplier has no such paper');
  return paper;
};

/** The bytes and the name a paper's read sends. */
export interface SupplierPaperContent {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

class AdministrationSupplierPapers {
  /**
   * Link one paper: the bytes go to Files under the supplier, then ONE write links them, holding
   * the version the person saw and the list's bound. A write that misses withdraws the upload — no
   * file is left behind that no link names — and says why it missed.
   */
  async add(
    ctx: AuthContext,
    id: string,
    input: AddAdministrationSupplierAttachment,
    binary: UploadedBinary,
  ): Promise<AdministrationSupplierDoc> {
    assertAdministrationOrgAuthority(ctx, WRITE_KEY);
    const supplier = await repository.getById(id);
    assertCurrentVersion(supplier, input.version);
    if (isPaperListFull(supplier.attachments.length)) throw paperLimitRefusal();
    const supplierId = String(supplier._id);

    const file = await this.upload(ctx, supplierId, input.label, binary);
    const paper: AdministrationSupplierAttachmentSub = {
      attachmentId: new Types.ObjectId(),
      fileId: new Types.ObjectId(String(file._id)),
      categoryKey: ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY,
      label: input.label,
      fileName: binary.originalName,
      mime: file.mime,
      size: file.size,
      addedByUserId: new Types.ObjectId(ctx.userId),
      addedAt: new Date(),
    };
    await repository.ensureCollection();
    const linked = await repository.pushAttachment(supplierId, input.version, paper, ctx.userId);
    if (linked === null) {
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw await this.whyAddMissed(supplierId, input.version);
    }
    await auditSupplierPaperAdded(supplierId, paper.label);
    return linked;
  }

  /**
   * Remove one paper's LINK, under the version the person saw. The file itself stays in Files, as
   * history: the record no longer names it, and nothing in the module reads it again.
   */
  async remove(
    ctx: AuthContext,
    id: string,
    attachmentId: string,
    version: number,
  ): Promise<AdministrationSupplierDoc> {
    assertAdministrationOrgAuthority(ctx, WRITE_KEY);
    const supplier = await repository.getById(id);
    assertCurrentVersion(supplier, version);
    const paper = paperOf(supplier, attachmentId);
    const supplierId = String(supplier._id);

    await repository.ensureCollection();
    const unlinked = await repository.pullAttachment(
      supplierId,
      version,
      paper.attachmentId,
      ctx.userId,
    );
    if (unlinked === null) {
      const now = await repository.getById(supplierId);
      if (now.__v !== version) throw new StaleDocumentError();
      paperOf(now, attachmentId);
      throw new StaleDocumentError();
    }
    await auditSupplierPaperRemoved(supplierId, paper.label);
    return unlinked;
  }

  /**
   * One paper's bytes. The paper must be THIS supplier's; the file is read through
   * `readEntityOwnedBuffer`, which refuses a file still being scanned (422 `FILE_SCAN_PENDING`) or
   * found infected (422 `FILE_BLOCKED`) and asks the authorizer again.
   */
  async read(ctx: AuthContext, id: string, attachmentId: string): Promise<SupplierPaperContent> {
    const paper = paperOf(await repository.getById(id), attachmentId);
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(paper.fileId));
    return { buffer, mime: doc.mime, fileName: paper.fileName };
  }

  /**
   * Each paper's scan state, by file id, never stored (§11.5): one listing of the supplier's files
   * in the category, and a read by id for a link the page does not cover (a version replaced
   * through the platform, an archived file). Null for a file that is gone or archived.
   */
  async scanStates(
    ctx: AuthContext,
    supplier: AdministrationSupplierDoc,
  ): Promise<ReadonlyMap<string, ScanStatus | null>> {
    const states = new Map<string, ScanStatus | null>();
    if (supplier.attachments.length === 0) return states;
    const page = await fileService.list(
      {
        moduleId: 'administration',
        entityType: 'supplier',
        entityId: String(supplier._id),
        categoryId: await resolveCategoryId(),
        page: 1,
        pageSize: MAX_PAGE_SIZE,
        sortDir: 'desc',
      },
      filesUnscoped(ctx),
      ctx,
    );
    const listed = new Map(page.items.map((file) => [String(file._id), file.scanStatus]));
    for (const paper of supplier.attachments) {
      const fileId = String(paper.fileId);
      states.set(fileId, listed.get(fileId) ?? (await this.stateById(ctx, fileId)));
    }
    return states;
  }

  /** A link the listing did not cover: its file read by id, or null when it is not available. */
  private async stateById(ctx: AuthContext, fileId: string): Promise<ScanStatus | null> {
    try {
      const file = await fileService.getById(fileId, undefined, ctx);
      return file.status === 'active' ? file.scanStatus : null;
    } catch {
      return null;
    }
  }

  /**
   * The upload, as a literal entity pair (§11.1). A category no longer found — removed by an
   * operator since it was cached — is ensured again, once.
   */
  private async upload(
    ctx: AuthContext,
    supplierId: string,
    label: string,
    binary: UploadedBinary,
  ): Promise<FileDoc> {
    const attempt = async (categoryId: string): Promise<FileDoc> =>
      fileService.upload(
        ctx,
        {
          moduleId: 'administration',
          entityType: 'supplier',
          entityId: supplierId,
          categoryId,
          displayName: label,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    try {
      return await attempt(await resolveCategoryId());
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      cachedCategoryId = null;
      return attempt(await resolveCategoryId());
    }
  }

  /** Why a link write matched nothing, read from the row as it is now. */
  private async whyAddMissed(supplierId: string, version: number): Promise<Error> {
    const now = await repository.findById(supplierId);
    if (now === null) return new NotFoundError();
    if (now.__v !== version) return new StaleDocumentError();
    return isPaperListFull(now.attachments.length) ? paperLimitRefusal() : new StaleDocumentError();
  }
}

export const administrationSupplierPapers = new AdministrationSupplierPapers();

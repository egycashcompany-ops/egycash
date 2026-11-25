// A purchase request's own files (P2 plan §4.3; design §11; OD-76 A, OD-77 A) — «مرفقات طلب
// الشراء»: the spec sheet, the photo or the memo a requester files with a need. Files owns the
// bytes; the request owns the links, a typed list of at most 20 (list B, design §11.4). The
// supplier papers are the module's precedent for the platform's Files (P1b.1), and three pieces
// live here in their shape:
//
//   * the CATEGORY — PDF and images, 10 MB (OD-76 formats (i)), kept for ever (OD-77 A) — so intake
//     refuses what the record cannot preview before a byte is stored. Ensured by the seed, its id
//     cached, and the cache dropped when the category is no longer found (design §11.1);
//   * the AUTHORIZER (ADR-023), so the platform's own file paths ask the request's keys. A read
//     takes `.view` or `.approve` — an approver opens the files of what they decide — and a write
//     `.create` or `.edit`, each key tried with its own scope, never the widest of them (design
//     §11.3). A write is held to the module route's own rule besides: the key covers the request's
//     Unit, the caller is its requester, and the request is a draft. The platform asks the write
//     intent on every path that changes a file — replace, update, archive, restore and delete — so
//     once a request is submitted nobody changes the files its approvers read, here or through
//     `/platform/files`;
//   * the FILES themselves: link one (upload, then a version-held link write), remove one's link,
//     and read one's bytes — through `readEntityOwnedBuffer`, which keeps the scan gate.
//
// No file is required (OD-76 A asks one of a quotation and of a write-off's evidence, not of a
// request), so the submission reads no scan state; the record shows them (design §11.5).
import {
  ADMINISTRATION_MAX_LIST_ATTACHMENTS,
  ADMINISTRATION_REQUEST_ATTACHMENTS_FILE_CATEGORY,
  ADMINISTRATION_REQUEST_ATTACHMENT_MAX_MB,
  ADMINISTRATION_REQUEST_ATTACHMENT_MIMES,
  CONTENT_EDITABLE,
  ErrorCodes,
  MAX_PAGE_SIZE,
  type AddAdministrationPurchaseRequestAttachment,
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
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
} from '../../../../shared/errors';
import {
  hasPermission,
  keyCoversUnit,
  scopeSelector,
  type AuthContext,
  type ScopeSelector,
} from '../../../../shared/types';
import { assertCurrentVersion } from '../../shared/master-data';
import {
  auditPurchaseRequestAttachmentAdded,
  auditPurchaseRequestAttachmentRemoved,
} from './purchase-request-audit';
import { invalidTransition, isRequester } from './purchase-request-rules';
import {
  type AdministrationPurchaseRequestAttachmentSub,
  type AdministrationPurchaseRequestDoc,
} from './purchase-request.model';
import { administrationPurchaseRequestRepository as repository } from './purchase-request.repository';
import { administrationPurchaseRequestService } from './purchase-request.service';

// ── The category ────────────────────────────────────────────────────────────

const REQUEST_ATTACHMENTS_CATEGORY: CreateFileCategory = {
  key: ADMINISTRATION_REQUEST_ATTACHMENTS_FILE_CATEGORY,
  name: { ar: 'مرفقات الطلبات', en: 'Request attachments' },
  allowedMimeTypes: [...ADMINISTRATION_REQUEST_ATTACHMENT_MIMES],
  maxSizeMb: ADMINISTRATION_REQUEST_ATTACHMENT_MAX_MB,
  // OD-77 A: kept for ever. Rules are fixed when first ensured; a later period is an operator's
  // `PATCH /platform/file-categories/:id`, never a seed change (design §11.1).
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time and idempotent, so the category exists before the first upload asks for it. */
export const ensureRequestAttachmentsCategory = async (): Promise<string> => {
  const category = await fileCategoryService.ensure(REQUEST_ATTACHMENTS_CATEGORY);
  cachedCategoryId = String(category._id);
  return cachedCategoryId;
};

/** The category id an upload writes into, ensured and cached on first use. */
const resolveCategoryId = async (): Promise<string> =>
  cachedCategoryId ?? ensureRequestAttachmentsCategory();

// ── Who reaches a request's files (ADR-023; design §11.3) ───────────────────

const CREATE = 'administrationPurchaseRequest.create';
const EDIT = 'administrationPurchaseRequest.edit';

/** The keys of the acts that make the draft the files belong to. */
const WRITE_KEYS = [CREATE, EDIT] as const;

/**
 * The request as its record's read finds it — `.view` first, then `.approve`, each with its own
 * scope, never the widest of the two (design §11.3) — or null where that read answers 404. The
 * record's own read decides, so the files and the record never disagree on who reads a request.
 */
const readable = async (
  ctx: AuthContext,
  id: string,
): Promise<AdministrationPurchaseRequestDoc | null> => {
  try {
    return await administrationPurchaseRequestService.get(id, ctx);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
};

/** Where a file write lands: the request, and the scope of the write key that reaches it. */
interface WriteTarget {
  doc: AdministrationPurchaseRequestDoc;
  scope: ScopeSelector;
}

/**
 * The request under the act's key: the first write key the caller holds whose own scope finds it,
 * which must then cover its Unit (`keyCoversUnit`, P2 plan §4.2, §4.3). `outOfReach` when that key
 * covers no Unit — an `own` grant reads what its holder raised and covers none — even where the
 * other key would: the first finder wins, as on the record's read. `notFound` when no key's scope
 * finds it. At most two lookups, design §11.3's budget.
 */
const writeTarget = async (
  ctx: AuthContext,
  id: string,
): Promise<WriteTarget | 'outOfReach' | 'notFound'> => {
  for (const key of WRITE_KEYS) {
    if (!hasPermission(ctx, key)) continue;
    const scope = scopeSelector(ctx, key);
    const doc = await repository.findById(id, scope);
    if (doc === null) continue;
    return keyCoversUnit(ctx, key, String(doc.branchId), String(doc.departmentId))
      ? { doc, scope }
      : 'outOfReach';
  }
  return 'notFound';
};

/**
 * Why `userId` may not change the request's files now, or null: they are its requester's alone
 * (P2 plan §1.2 item 22), and only while it is a draft (OD-76 after submission (i)). The requester
 * first, a 403, then the status, a 422 — the order every write on a request answers in (§4.2).
 */
export const attachmentWriteRefusal = (
  request: Pick<AdministrationPurchaseRequestDoc, 'requesterUserId' | 'status'>,
  userId: string,
): AppError | null => {
  if (!isRequester(request, userId)) {
    return new ForbiddenError('a purchase request’s files are changed by its requester alone');
  }
  if (!CONTENT_EDITABLE[request.status]) return invalidTransition(request.status);
  return null;
};

/**
 * May this caller reach a request's files? It does not opt into the separate delete intent, so a
 * removal through the platform is asked as a write and meets the write rule. A request the caller
 * cannot find denies rather than throws: they learn nothing.
 */
export const purchaseRequestFileAuthorizer: FileEntityAuthorizer = {
  entityType: 'purchaseRequest',
  async authorize({ ctx, entityId, intent }): Promise<boolean> {
    if (intent !== 'write') return (await readable(ctx, entityId)) !== null;
    const target = await writeTarget(ctx, entityId);
    return typeof target !== 'string' && attachmentWriteRefusal(target.doc, ctx.userId) === null;
  },
};

// ── The files ───────────────────────────────────────────────────────────────

/** Does the list already hold all it may (design §11.4)? Then nothing more is linked. */
const isListFull = (count: number): boolean => count >= ADMINISTRATION_MAX_LIST_ATTACHMENTS;

/** The 422 a full list answers: remove a file before linking another. */
const listFullRefusal = (): AppError => {
  const message = `a purchase request holds at most ${String(ADMINISTRATION_MAX_LIST_ATTACHMENTS)} files`;
  return new AppError(ErrorCodes.ADMINISTRATION_ATTACHMENT_LIMIT, 422, message, {
    details: [{ field: 'attachments', code: 'limit', message }],
  });
};

/**
 * The request a file write lands on, or its refusal in P2 plan §4.2's order: not found under any
 * write key (404), no key that covers its Unit (403), not the requester (403), not a draft (422).
 */
const loadForWrite = async (ctx: AuthContext, id: string): Promise<WriteTarget> => {
  const target = await writeTarget(ctx, id);
  if (target === 'notFound') throw new NotFoundError('purchase request not found');
  if (target === 'outOfReach') {
    throw new ForbiddenError('no write key covers this purchase request’s department');
  }
  const refusal = attachmentWriteRefusal(target.doc, ctx.userId);
  if (refusal !== null) throw refusal;
  return target;
};

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

/** The 404 for a file the request does not list — another request's, or one already removed. */
const noSuchFile = (): NotFoundError => new NotFoundError('this purchase request has no such file');

/** The request's file `attachmentId` names, if it lists one. */
const findAttachment = (
  request: AdministrationPurchaseRequestDoc,
  attachmentId: string,
): AdministrationPurchaseRequestAttachmentSub | undefined => {
  const wanted = canonicalId(attachmentId);
  return request.attachments.find((file) => String(file.attachmentId) === wanted);
};

/** The request's file `attachmentId` names, or a 404 — never another request's. */
const attachmentOf = (
  request: AdministrationPurchaseRequestDoc,
  attachmentId: string,
): AdministrationPurchaseRequestAttachmentSub => {
  const entry = findAttachment(request, attachmentId);
  if (entry === undefined) throw noSuchFile();
  return entry;
};

/** The bytes and the name a file's read sends. */
export interface PurchaseRequestFileContent {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

class AdministrationPurchaseRequestAttachments {
  /**
   * Link one file: the bytes go to Files under the request, then ONE write links them, holding the
   * version the requester saw, the draft status and the list's bound. Every refusal the request
   * itself can give comes before a byte is stored, and the collection is made ready first, so a
   * failed index build stores nothing either. A link write that misses, or throws, withdraws the
   * upload under the same write rule — so if the requester's own submission lands between the two,
   * the withdrawal is refused and the file stays unlinked; nothing lists it, since the record and
   * its scan states read the links (P2 plan §4.3).
   */
  async add(
    ctx: AuthContext,
    id: string,
    input: AddAdministrationPurchaseRequestAttachment,
    binary: UploadedBinary,
  ): Promise<AdministrationPurchaseRequestDoc> {
    const { doc, scope } = await loadForWrite(ctx, id);
    assertCurrentVersion(doc, input.version);
    if (isListFull(doc.attachments.length)) throw listFullRefusal();
    const requestId = String(doc._id);

    await repository.ensureCollection();
    const file = await this.upload(ctx, requestId, input.label, binary);
    const entry: AdministrationPurchaseRequestAttachmentSub = {
      attachmentId: new Types.ObjectId(),
      fileId: new Types.ObjectId(String(file._id)),
      categoryKey: ADMINISTRATION_REQUEST_ATTACHMENTS_FILE_CATEGORY,
      label: input.label,
      fileName: binary.originalName,
      mime: file.mime,
      size: file.size,
      addedByUserId: new Types.ObjectId(ctx.userId),
      addedAt: new Date(),
    };
    let linked: AdministrationPurchaseRequestDoc | null;
    try {
      linked = await repository.pushAttachment(requestId, input.version, entry, ctx.userId, scope);
    } catch (error) {
      // The write failed outright (a stepdown, a timeout): withdrawn, as the supplier papers' is.
      // The write's error is the answer, not the withdrawal's.
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw error;
    }
    if (linked === null) {
      await fileService.softDelete(ctx, String(file._id)).catch(() => undefined);
      throw await this.whyMissed(requestId, input.version, scope, (now) =>
        isListFull(now.attachments.length) ? listFullRefusal() : null,
      );
    }
    await auditPurchaseRequestAttachmentAdded(linked, entry);
    return linked;
  }

  /**
   * Remove one file's LINK, under the version the requester saw, while the request is a draft. The
   * file itself stays in Files, as history: the record no longer names it, and nothing in the
   * module reads it again.
   */
  async remove(
    ctx: AuthContext,
    id: string,
    attachmentId: string,
    version: number,
  ): Promise<AdministrationPurchaseRequestDoc> {
    const { doc, scope } = await loadForWrite(ctx, id);
    assertCurrentVersion(doc, version);
    const entry = attachmentOf(doc, attachmentId);
    const requestId = String(doc._id);

    await repository.ensureCollection();
    const unlinked = await repository.pullAttachment(
      requestId,
      version,
      entry.attachmentId,
      ctx.userId,
      scope,
    );
    if (unlinked === null) {
      throw await this.whyMissed(requestId, version, scope, (now) =>
        findAttachment(now, attachmentId) === undefined ? noSuchFile() : null,
      );
    }
    await auditPurchaseRequestAttachmentRemoved(unlinked, entry);
    return unlinked;
  }

  /**
   * One file's bytes. The request is read as its record is, and the file must be on THIS request;
   * it is read through `readEntityOwnedBuffer`, which refuses a file still being scanned (422
   * `FILE_SCAN_PENDING`) or found infected (422 `FILE_BLOCKED`) and asks the authorizer again. A
   * file archived since its link is a 404, as the record names it unavailable.
   */
  async read(
    ctx: AuthContext,
    id: string,
    attachmentId: string,
  ): Promise<PurchaseRequestFileContent> {
    const request = await readable(ctx, id);
    if (request === null) throw new NotFoundError('purchase request not found');
    const entry = attachmentOf(request, attachmentId);
    const { doc, buffer } = await fileService.readEntityOwnedBuffer(ctx, String(entry.fileId));
    // Files reads an archived file by id all the same, but the record names it unavailable (its
    // scan state null, design §11.4): its bytes are not sent either.
    if (doc.status !== 'active') throw noSuchFile();
    return { buffer, mime: doc.mime, fileName: entry.fileName };
  }

  /**
   * Each file's scan state, by file id, never stored (design §11.5): one listing of the request's
   * files in the category, and a read by id for a link the page does not cover (a version replaced
   * through the platform, an archived file). Null for a file that is gone or archived.
   *
   * A caller the authorizer would not let read the files — a writer whose read keys, if any, do not
   * reach the request — is not sent to Files at all: every state reads null, as the files are to
   * them, and no lookup is refused in their name (each refusal is a `permissionDenied` row).
   */
  async scanStates(
    ctx: AuthContext,
    request: AdministrationPurchaseRequestDoc,
  ): Promise<ReadonlyMap<string, ScanStatus | null>> {
    const states = new Map<string, ScanStatus | null>();
    if (request.attachments.length === 0) return states;
    if ((await readable(ctx, String(request._id))) === null) {
      for (const entry of request.attachments) states.set(String(entry.fileId), null);
      return states;
    }
    const page = await fileService.list(
      {
        moduleId: 'administration',
        entityType: 'purchaseRequest',
        entityId: String(request._id),
        categoryId: await resolveCategoryId(),
        page: 1,
        pageSize: MAX_PAGE_SIZE,
        sortDir: 'desc',
      },
      filesUnscoped(ctx),
      ctx,
    );
    const listed = new Map(page.items.map((file) => [String(file._id), file.scanStatus]));
    for (const entry of request.attachments) {
      const fileId = String(entry.fileId);
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
   * The upload, as a literal entity pair (design §11.1). A category no longer found — removed by an
   * operator since it was cached — is ensured again, once.
   */
  private async upload(
    ctx: AuthContext,
    requestId: string,
    label: string,
    binary: UploadedBinary,
  ): Promise<FileDoc> {
    const attempt = async (categoryId: string): Promise<FileDoc> =>
      fileService.upload(
        ctx,
        {
          moduleId: 'administration',
          entityType: 'purchaseRequest',
          entityId: requestId,
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

  /**
   * Why a link write matched nothing, read from the row as it is now, in P2 plan §4.2's order: the
   * request gone from the scope (404), no longer a draft (422), a moved version (409), then the
   * act's own rule (`still`), else a write that lost a race (409).
   */
  private async whyMissed(
    id: string,
    version: number,
    scope: ScopeSelector,
    still: (now: AdministrationPurchaseRequestDoc) => AppError | null,
  ): Promise<Error> {
    const now = await repository.findById(id, scope);
    if (now === null) return new NotFoundError();
    if (!CONTENT_EDITABLE[now.status]) return invalidTransition(now.status);
    if (now.__v !== version) return new StaleDocumentError();
    return still(now) ?? new StaleDocumentError();
  }
}

export const administrationPurchaseRequestAttachments =
  new AdministrationPurchaseRequestAttachments();

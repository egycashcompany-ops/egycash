// A purchase request's files (P2 plan §4.3, §12.1; design §11.3–§11.5; ADR-023). The authorizer:
// each key tried with its own scope; a read under `.view` or `.approve`; a write under `.create` or
// `.edit` only by the requester, only on a draft — so a write on a submitted request is denied —
// and only through a key that covers the request's Unit; a removal asked as a write. The route's
// own checks, in P2 plan §4.2's order, every one before a byte is stored; a link write that misses
// or throws withdraws its upload and says why. A file read only through the request that lists it.
// The scan states: one listing, a missed link read by id, null when unavailable, and Files not
// asked at all for a caller who may not open the files. Files and the repository mocked: no
// database.
import { type DataScope } from '@ecms/contracts';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  StaleDocumentError,
} from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { type AdministrationPurchaseRequestDoc } from './purchase-request.model';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  ready: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  upload: vi.fn(),
  softDelete: vi.fn(),
  readBuffer: vi.fn(),
  ensure: vi.fn(),
  added: vi.fn(),
  removed: vi.fn(),
}));

vi.mock('./purchase-request.repository', () => ({
  administrationPurchaseRequestRepository: {
    findById: mocks.findById,
    ensureCollection: mocks.ready,
    pushAttachment: mocks.push,
    pullAttachment: mocks.pull,
  },
}));
vi.mock('../../../../platform/files', () => ({
  fileService: {
    list: mocks.list,
    getById: mocks.getById,
    upload: mocks.upload,
    softDelete: mocks.softDelete,
    readEntityOwnedBuffer: mocks.readBuffer,
  },
  fileCategoryService: { ensure: mocks.ensure },
}));
vi.mock('./purchase-request-audit', () => ({
  auditPurchaseRequestAttachmentAdded: mocks.added,
  auditPurchaseRequestAttachmentRemoved: mocks.removed,
}));

const {
  administrationPurchaseRequestAttachments: files,
  attachmentWriteRefusal,
  purchaseRequestFileAuthorizer,
} = await import('./purchase-request-files');

const VIEW = 'administrationPurchaseRequest.view';
const APPROVE = 'administrationPurchaseRequest.approve';
const CREATE = 'administrationPurchaseRequest.create';
const EDIT = 'administrationPurchaseRequest.edit';

const REQUESTER = '64a0000000000000000000aa';
const COLLEAGUE = '64a0000000000000000000ab';
const BRANCH = '64a000000000000000000001';
const COPY = '64a0000000000000000000d1';
const OTHER_COPY = '64a0000000000000000000d2';
const REQUEST = '64a0000000000000000000f1';
const CATEGORY = '64a0000000000000000000c0';
const FILE = '64a0000000000000000000e1';

/** Someone signed in at the request's copy, holding `permissions`. */
const ctx = (
  permissions: Record<string, DataScope>,
  userId = REQUESTER,
  departmentId = COPY,
): AuthContext => ({
  userId,
  sessionId: 's',
  branchId: BRANCH,
  departmentId,
  sectionId: null,
  locale: 'ar',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});

/** The department requester bundle's write keys, as a focal point holds them. */
const focal = (userId = REQUESTER): AuthContext =>
  ctx({ [VIEW]: 'department', [CREATE]: 'department', [EDIT]: 'department' }, userId);

const entry = (fileId: string, attachmentId = new Types.ObjectId()) => ({
  attachmentId,
  fileId: new Types.ObjectId(fileId),
  categoryKey: 'administration-request-attachments',
  label: 'x',
  fileName: 'x.pdf',
  mime: 'application/pdf',
  size: 1,
  addedByUserId: new Types.ObjectId(REQUESTER),
  addedAt: new Date('2026-11-25T08:00:00.000Z'),
});

/** The request carries only what the files read: its place, requester, status, version, list. */
const request = (
  over: Partial<AdministrationPurchaseRequestDoc> = {},
): AdministrationPurchaseRequestDoc =>
  ({
    _id: new Types.ObjectId(REQUEST),
    branchId: new Types.ObjectId(BRANCH),
    departmentId: new Types.ObjectId(COPY),
    requesterUserId: new Types.ObjectId(REQUESTER),
    status: 'draft',
    __v: 3,
    attachments: [],
    ...over,
  }) as unknown as AdministrationPurchaseRequestDoc;

const ask = (who: AuthContext, intent: 'read' | 'write') =>
  purchaseRequestFileAuthorizer.authorize({ ctx: who, entityId: REQUEST, intent });

/** The scope each `findById` was asked under, in order. */
const scopesAsked = () =>
  mocks.findById.mock.calls.map((call) => (call[1] as { scope: DataScope } | undefined)?.scope);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findById.mockResolvedValue(request());
  mocks.ensure.mockResolvedValue({ _id: new Types.ObjectId(CATEGORY) });
});

describe('the authorizer: a read (design §11.3)', () => {
  it.each([VIEW, APPROVE])('reads with %s alone, under that key’s own scope', async (key) => {
    expect(await ask(ctx({ [key]: 'department' }), 'read')).toBe(true);
    expect(scopesAsked()).toEqual(['department']);
  });

  it('tries each key with its own scope: `.view` own misses, `.approve` over the copy finds', async () => {
    mocks.findById.mockResolvedValueOnce(null).mockResolvedValueOnce(request());
    const reader = ctx({ [VIEW]: 'own', [APPROVE]: 'department' }, COLLEAGUE);
    expect(await ask(reader, 'read')).toBe(true);
    expect(scopesAsked(), 'never the widest of the two').toEqual(['own', 'department']);
  });

  it('denies a reader whose keys reach no such request, and asks nothing without a read key', async () => {
    mocks.findById.mockResolvedValue(null);
    expect(await ask(ctx({ [VIEW]: 'department' }), 'read')).toBe(false);
    mocks.findById.mockClear();
    expect(await ask(ctx({ [CREATE]: 'organization', [EDIT]: 'organization' }), 'read')).toBe(
      false,
    );
    expect(mocks.findById, 'the write keys open no file').not.toHaveBeenCalled();
  });
});

describe('the authorizer: a write (P2 plan §4.3)', () => {
  it('lets the requester write their draft through a key that covers its Unit', async () => {
    expect(await ask(focal(), 'write')).toBe(true);
    expect(scopesAsked()).toEqual(['department']);
  });

  it.each(['pendingApproval', 'approved', 'rejected', 'cancelled', 'closed'] as const)(
    'denies a write on a %s request — nobody changes what the approvers read',
    async (status) => {
      mocks.findById.mockResolvedValue(request({ status }));
      expect(await ask(focal(), 'write')).toBe(false);
    },
  );

  it('denies a colleague’s write on another’s draft, with the same keys over the same copy', async () => {
    expect(await ask(focal(COLLEAGUE), 'write')).toBe(false);
  });

  it('denies a read key, and asks nothing, for a write', async () => {
    expect(await ask(ctx({ [VIEW]: 'organization', [APPROVE]: 'organization' }), 'write')).toBe(
      false,
    );
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('the first key whose scope finds the request is the act’s: one that covers no Unit (`own`) writes nothing, beside a key that would too', async () => {
    expect(await ask(ctx({ [CREATE]: 'own' }), 'write')).toBe(false);
    mocks.findById.mockClear();
    expect(await ask(ctx({ [CREATE]: 'own', [EDIT]: 'department' }), 'write')).toBe(false);
    expect(scopesAsked(), 'the first finder wins (P2 plan §4.2): `.edit` is not asked').toEqual([
      'own',
    ]);
  });

  it('a key whose scope misses passes to the next: `.edit` finds and covers what `.create` does not reach', async () => {
    mocks.findById.mockResolvedValueOnce(null).mockResolvedValueOnce(request());
    const moved = ctx({ [CREATE]: 'department', [EDIT]: 'branch' }, REQUESTER, OTHER_COPY);
    expect(await ask(moved, 'write')).toBe(true);
    expect(scopesAsked(), 'each key under its own scope, at most two').toEqual([
      'department',
      'branch',
    ]);
  });

  it('a department key over another copy does not cover the request', async () => {
    const elsewhere = ctx({ [CREATE]: 'department' }, REQUESTER, OTHER_COPY);
    expect(await ask(elsewhere, 'write')).toBe(false);
  });

  it('denies, rather than throws, for a request that does not exist', async () => {
    mocks.findById.mockResolvedValue(null);
    expect(await ask(focal(), 'write')).toBe(false);
    expect(await ask(focal(), 'read')).toBe(false);
  });

  it('does not opt into the delete intent: a removal through the platform is asked as a write', () => {
    expect(purchaseRequestFileAuthorizer.understandsDelete).toBeUndefined();
    expect(purchaseRequestFileAuthorizer.entityType).toBe('purchaseRequest');
  });

  it('the rule itself: the requester first (403), then the draft (422, its status named)', () => {
    expect(attachmentWriteRefusal(request(), REQUESTER)).toBeNull();
    const submitted = request({ status: 'pendingApproval' });
    expect(attachmentWriteRefusal(submitted, COLLEAGUE)).toBeInstanceOf(ForbiddenError);
    const refusal = attachmentWriteRefusal(submitted, REQUESTER);
    expect(refusal).toMatchObject({
      code: 'ADMINISTRATION_INVALID_TRANSITION',
      httpStatus: 422,
      details: [{ field: 'status', code: 'pendingApproval' }],
    });
  });
});

describe('linking a file (P2 plan §4.2, §4.3)', () => {
  const binary = {
    originalName: 'spec.pdf',
    mime: 'application/pdf',
    size: 4,
    buffer: Buffer.from('%PDF'),
  };
  const link = (who = focal(), version = 3) =>
    files.add(who, REQUEST, { label: 'مواصفات', version }, binary);
  const nothingStored = () => {
    expect(mocks.ready, 'nothing readied').not.toHaveBeenCalled();
    expect(mocks.upload, 'nothing stored').not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    mocks.ready.mockResolvedValue(undefined);
    mocks.upload.mockResolvedValue({
      _id: new Types.ObjectId(FILE),
      mime: 'application/pdf',
      size: 4,
    });
    mocks.softDelete.mockResolvedValue(undefined);
    mocks.added.mockResolvedValue(undefined);
  });

  it('a request no write key finds is 404', async () => {
    mocks.findById.mockResolvedValue(null);
    await expect(link()).rejects.toBeInstanceOf(NotFoundError);
    nothingStored();
  });

  it('a key that finds it but covers no Unit is 403, the other key not asked', async () => {
    await expect(link(ctx({ [CREATE]: 'own' }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(link(ctx({ [CREATE]: 'own', [EDIT]: 'department' }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(scopesAsked()).toEqual(['own', 'own']);
    nothingStored();
  });

  it('a colleague’s link on another’s draft is 403', async () => {
    await expect(link(focal(COLLEAGUE))).rejects.toBeInstanceOf(ForbiddenError);
    nothingStored();
  });

  it('a submitted request is 422 INVALID_TRANSITION — before its version, so also when stale', async () => {
    mocks.findById.mockResolvedValue(request({ status: 'pendingApproval', __v: 4 }));
    for (const version of [4, 3]) {
      await expect(link(focal(), version)).rejects.toMatchObject({
        code: 'ADMINISTRATION_INVALID_TRANSITION',
      });
    }
    nothingStored();
  });

  it('a stale version is 409 — before the list’s bound', async () => {
    mocks.findById.mockResolvedValue(
      request({ attachments: Array.from({ length: 20 }, () => entry(FILE)) }),
    );
    await expect(link(focal(), 2)).rejects.toBeInstanceOf(StaleDocumentError);
    nothingStored();
  });

  it('a full list is 422 ADMINISTRATION_ATTACHMENT_LIMIT', async () => {
    mocks.findById.mockResolvedValue(
      request({ attachments: Array.from({ length: 20 }, () => entry(FILE)) }),
    );
    await expect(link()).rejects.toMatchObject({
      code: 'ADMINISTRATION_ATTACHMENT_LIMIT',
      httpStatus: 422,
      details: [{ field: 'attachments', code: 'limit' }],
    });
    nothingStored();
  });

  it('a failed index build refuses the link before a byte is stored', async () => {
    const failedBuild = new Error('index build failed');
    mocks.ready.mockRejectedValue(failedBuild);
    await expect(link()).rejects.toBe(failedBuild);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('a link that lands is filed under the request, linked under the key’s scope, and audited', async () => {
    const linked = request({ __v: 4 });
    mocks.push.mockResolvedValue(linked);
    expect(await link()).toBe(linked);
    const [, fields] = mocks.upload.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(fields).toMatchObject({
      moduleId: 'administration',
      entityType: 'purchaseRequest',
      entityId: REQUEST,
      categoryId: CATEGORY,
      displayName: 'مواصفات',
      visibility: 'private',
    });
    const [id, version, written, by, scope] = mocks.push.mock.calls[0] as [
      string,
      number,
      Record<string, unknown>,
      string,
      { scope: DataScope },
    ];
    expect([id, version, by, scope.scope]).toEqual([REQUEST, 3, REQUESTER, 'department']);
    expect(written).toMatchObject({
      categoryKey: 'administration-request-attachments',
      label: 'مواصفات',
      fileName: 'spec.pdf',
      mime: 'application/pdf',
      size: 4,
    });
    expect(String(written.fileId)).toBe(FILE);
    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.added).toHaveBeenCalledWith(linked, written);
  });

  it('a link write that throws withdraws its upload and answers the write’s own error', async () => {
    const stepdown = new Error('not primary');
    mocks.push.mockRejectedValue(stepdown);
    mocks.softDelete.mockRejectedValue(new Error('the withdrawal failed too'));
    await expect(link()).rejects.toBe(stepdown);
    expect(mocks.softDelete).toHaveBeenCalledWith(focal(), FILE);
    expect(mocks.added, 'nothing linked, nothing audited').not.toHaveBeenCalled();
  });

  it.each([
    [
      'the requester’s own submission landed first',
      { status: 'pendingApproval' as const, __v: 4 },
      'ADMINISTRATION_INVALID_TRANSITION',
    ],
    ['an edit moved the version', { __v: 4 }, 'STALE_DOCUMENT'],
    [
      'a racing link filled the list',
      { attachments: Array.from({ length: 20 }, () => entry(FILE)) },
      'ADMINISTRATION_ATTACHMENT_LIMIT',
    ],
  ])('a link write that misses withdraws its upload and says why: %s', async (_why, now, code) => {
    mocks.push.mockResolvedValue(null);
    mocks.findById.mockResolvedValueOnce(request()).mockResolvedValueOnce(request(now));
    const refusal = await link().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(AppError);
    expect((refusal as AppError).code).toBe(code);
    expect(mocks.softDelete).toHaveBeenCalledWith(focal(), FILE);
    expect(mocks.added).not.toHaveBeenCalled();
  });
});

describe('removing a file’s link', () => {
  const KEPT = new Types.ObjectId('64a0000000000000000000a1');
  const listed = () => request({ attachments: [entry(FILE, KEPT)] });

  beforeEach(() => {
    mocks.ready.mockResolvedValue(undefined);
    mocks.findById.mockResolvedValue(listed());
    mocks.removed.mockResolvedValue(undefined);
  });

  it('unlinks the file the request lists, under the version and the key’s scope, and audits it', async () => {
    const unlinked = request({ __v: 4 });
    mocks.pull.mockResolvedValue(unlinked);
    expect(await files.remove(focal(), REQUEST, String(KEPT), 3)).toBe(unlinked);
    const [id, version, attachmentId, by, scope] = mocks.pull.mock.calls[0] as [
      string,
      number,
      Types.ObjectId,
      string,
      { scope: DataScope },
    ];
    expect([id, version, String(attachmentId), by, scope.scope]).toEqual([
      REQUEST,
      3,
      String(KEPT),
      REQUESTER,
      'department',
    ]);
    expect(mocks.removed).toHaveBeenCalledWith(unlinked, listed().attachments[0]);
    expect(mocks.softDelete, 'the file itself stays in Files').not.toHaveBeenCalled();
  });

  it('a file the request does not list is 404, and nothing is written', async () => {
    await expect(
      files.remove(focal(), REQUEST, String(new Types.ObjectId()), 3),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('a colleague’s removal, a submitted request and a stale version are refused before the write', async () => {
    await expect(files.remove(focal(COLLEAGUE), REQUEST, String(KEPT), 3)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    mocks.findById.mockResolvedValue(
      request({ status: 'pendingApproval', attachments: listed().attachments }),
    );
    await expect(files.remove(focal(), REQUEST, String(KEPT), 3)).rejects.toMatchObject({
      code: 'ADMINISTRATION_INVALID_TRANSITION',
    });
    mocks.findById.mockResolvedValue(listed());
    await expect(files.remove(focal(), REQUEST, String(KEPT), 2)).rejects.toBeInstanceOf(
      StaleDocumentError,
    );
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('a removal that misses says why: the link already gone is 404, a moved version 409', async () => {
    mocks.pull.mockResolvedValue(null);
    mocks.findById.mockResolvedValueOnce(listed()).mockResolvedValueOnce(request({ __v: 4 }));
    await expect(files.remove(focal(), REQUEST, String(KEPT), 3)).rejects.toBeInstanceOf(
      StaleDocumentError,
    );
    mocks.findById.mockResolvedValueOnce(listed()).mockResolvedValueOnce(request());
    await expect(files.remove(focal(), REQUEST, String(KEPT), 3)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.removed).not.toHaveBeenCalled();
  });
});

describe('reading a file’s bytes (design §11.5)', () => {
  const KEPT = new Types.ObjectId('64a0000000000000000000a1');

  beforeEach(() => {
    mocks.findById.mockResolvedValue(request({ attachments: [entry(FILE, KEPT)] }));
    mocks.readBuffer.mockResolvedValue({
      doc: { mime: 'application/pdf', status: 'active' },
      buffer: Buffer.from('%PDF'),
    });
  });

  it('an approver holding `.approve` alone reads it, through the scan-gated read', async () => {
    const approver = ctx({ [APPROVE]: 'department' }, COLLEAGUE);
    const read = await files.read(approver, REQUEST, String(KEPT));
    expect(read).toEqual({
      buffer: Buffer.from('%PDF'),
      mime: 'application/pdf',
      fileName: 'x.pdf',
    });
    expect(mocks.readBuffer).toHaveBeenCalledWith(approver, FILE);
  });

  it('a file archived since its link is 404, as the record names it unavailable', async () => {
    mocks.readBuffer.mockResolvedValue({
      doc: { mime: 'application/pdf', status: 'archived' },
      buffer: Buffer.from('%PDF'),
    });
    await expect(files.read(focal(), REQUEST, String(KEPT))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a file another request lists, or none, is 404 — and no file is read', async () => {
    await expect(files.read(focal(), REQUEST, String(new Types.ObjectId()))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    mocks.findById.mockResolvedValue(null);
    await expect(files.read(focal(), REQUEST, String(KEPT))).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.readBuffer).not.toHaveBeenCalled();
  });
});

describe('the scan states the record reads (design §11.5)', () => {
  const LISTED = '64a0000000000000000000d1';
  const PENDING = '64a0000000000000000000d2';
  const REPLACED = '64a0000000000000000000d3';
  const ARCHIVED = '64a0000000000000000000d4';
  const GONE = '64a0000000000000000000d5';
  const withFiles = request({
    attachments: [LISTED, PENDING, REPLACED, ARCHIVED, GONE].map((id) => entry(id)),
  });

  it('reads nothing for a request without files', async () => {
    expect((await files.scanStates(focal(), request())).size).toBe(0);
    expect(mocks.findById).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('lists the request’s files once, reads a missed link by id, and reads null when unavailable', async () => {
    mocks.list.mockResolvedValue({
      items: [
        { _id: new Types.ObjectId(LISTED), scanStatus: 'clean' },
        { _id: new Types.ObjectId(PENDING), scanStatus: 'pending' },
      ],
    });
    mocks.getById.mockImplementation(async (id: string) => {
      if (id === REPLACED) return { status: 'active', scanStatus: 'blocked' };
      if (id === ARCHIVED) return { status: 'archived', scanStatus: 'clean' };
      throw new NotFoundError();
    });
    const reader = focal();
    const states = await files.scanStates(reader, withFiles);
    expect(Object.fromEntries(states)).toEqual({
      [LISTED]: 'clean',
      [PENDING]: 'pending',
      [REPLACED]: 'blocked',
      [ARCHIVED]: null,
      [GONE]: null,
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    const [query, , asked] = mocks.list.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      unknown,
    ];
    expect(query).toMatchObject({
      moduleId: 'administration',
      entityType: 'purchaseRequest',
      entityId: REQUEST,
      categoryId: CATEGORY,
      pageSize: 100,
    });
    expect(asked, 'the listing asks the authorizer as the caller').toBe(reader);
  });

  it('a caller who may not open the files reads every state null, and Files is not asked in their name', async () => {
    const writerOnly = ctx({ [CREATE]: 'department', [EDIT]: 'department' });
    const states = await files.scanStates(writerOnly, withFiles);
    expect([...states.values()]).toEqual([null, null, null, null, null]);
    expect([...states.keys()]).toEqual([LISTED, PENDING, REPLACED, ARCHIVED, GONE]);
    expect(mocks.list, 'no listing the authorizer would empty').not.toHaveBeenCalled();
    expect(mocks.getById, 'no read refused — and audited — per file').not.toHaveBeenCalled();
  });
});

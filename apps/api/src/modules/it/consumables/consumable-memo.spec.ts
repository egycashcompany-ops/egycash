// A memo after its issue — «واطبعله مذكره» — read back, printed again, and its signed copy filed.
//
// What is pinned: a reprint is the same paper under the same number and writes nothing; the signed
// copy is filed once and versioned after, withdrawn on request, each audited on the memo; and the
// platform's own file endpoints ask the issue's grants — `itAsset.view` to read, `itAsset.assign`
// to write — over a memo the caller can see.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  findMemo: vi.fn(),
  updateMemo: vi.fn(),
  upload: vi.fn(),
  replace: vi.fn(),
  softDelete: vi.fn(),
  ensureCategory: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/files', () => ({
  fileService: { upload: mocks.upload, replace: mocks.replace, softDelete: mocks.softDelete },
  fileCategoryService: { ensure: mocks.ensureCategory },
}));
vi.mock('./consumable-memo.repository', () => ({
  itConsumableMemoRepository: {
    findById: mocks.findMemo,
    updateById: mocks.updateMemo,
    ensureCollection: vi.fn(async () => undefined),
  },
}));

const { itConsumableMemoService } = await import('./consumable-memo.service');
const { consumableMemoFileAuthorizer } = await import('./consumable-memo-files');

const MEMO = String(new Types.ObjectId());
const FILE = new Types.ObjectId();
const scope = { scope: 'branch', userId: 'u', branchId: 'b' } as never;
const ctx = { userId: String(new Types.ObjectId()) } as never;

const memo = (signedCopy: Record<string, unknown> | null = null) => ({
  _id: new Types.ObjectId(MEMO),
  memoNumber: 41,
  signedCopy,
  __v: 2,
});

const binary = {
  originalName: 'signed.pdf',
  mime: 'application/pdf',
  size: 10,
  buffer: Buffer.from('x'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMemo.mockResolvedValue(memo());
  mocks.updateMemo.mockImplementation(async (_id: string, set: Record<string, unknown>) => ({
    ...memo(),
    ...set,
    __v: 3,
  }));
  mocks.ensureCategory.mockResolvedValue({ _id: new Types.ObjectId() });
  mocks.upload.mockResolvedValue({
    _id: FILE,
    originalName: 'signed.pdf',
    mime: 'application/pdf',
    size: 10,
  });
  mocks.replace.mockResolvedValue({
    _id: FILE,
    originalName: 'v2.pdf',
    mime: 'application/pdf',
    size: 12,
  });
  mocks.softDelete.mockResolvedValue(undefined);
});

describe('printing a memo again', () => {
  it('is the same paper under the same number — nothing is written', async () => {
    const paper = await itConsumableMemoService.print(MEMO, scope);
    expect(paper.memoNumber).toBe(41);
    expect(mocks.findMemo).toHaveBeenCalledWith(MEMO, scope);
    expect(mocks.updateMemo).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('answers 404 for a memo the caller cannot see — or one the workforce reset purged', async () => {
    mocks.findMemo.mockResolvedValue(null);
    await expect(itConsumableMemoService.print(MEMO, scope)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the signed copy', () => {
  it('files a first upload against the memo, under its own category, and audits it', async () => {
    const updated = await itConsumableMemoService.setSignedCopy(ctx, MEMO, binary, scope);

    expect(mocks.upload).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ moduleId: 'it', entityType: 'consumableMemo', entityId: MEMO }),
      binary,
    );
    expect(mocks.ensureCategory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'it-consumable-memos' }),
    );
    expect(mocks.updateMemo).toHaveBeenCalledWith(
      MEMO,
      { signedCopy: expect.objectContaining({ fileId: FILE, mime: 'application/pdf' }) },
      expect.objectContaining({ version: 2, scope }),
    );
    expect(updated.signedCopy).not.toBeNull();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'consumableMemo', entityId: MEMO },
        changes: [{ field: 'signedCopy', old: null, new: String(FILE) }],
      }),
    );
  });

  it('adds a version when one is filed already, and withdraws a first upload the memo never took', async () => {
    mocks.findMemo.mockResolvedValue(memo({ fileId: FILE }));
    await itConsumableMemoService.setSignedCopy(ctx, MEMO, binary, scope);
    expect(mocks.replace).toHaveBeenCalledWith(ctx, String(FILE), binary);
    expect(mocks.upload).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.findMemo.mockResolvedValue(memo());
    mocks.ensureCategory.mockResolvedValue({ _id: new Types.ObjectId() });
    mocks.upload.mockResolvedValue({ _id: FILE, originalName: 'a', mime: 'image/png', size: 1 });
    mocks.softDelete.mockResolvedValue(undefined);
    mocks.updateMemo.mockRejectedValue(new ConflictError('stale'));
    await expect(
      itConsumableMemoService.setSignedCopy(ctx, MEMO, binary, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.softDelete).toHaveBeenCalledWith(ctx, String(FILE));
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('withdraws a filed copy, and refuses to withdraw one that is not there', async () => {
    mocks.findMemo.mockResolvedValue(memo({ fileId: FILE }));
    const updated = await itConsumableMemoService.deleteSignedCopy(ctx, MEMO, scope);
    expect(updated.signedCopy).toBeNull();
    expect(mocks.softDelete).toHaveBeenCalledWith(ctx, String(FILE));

    mocks.findMemo.mockResolvedValue(memo());
    await expect(itConsumableMemoService.deleteSignedCopy(ctx, MEMO, scope)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('the platform’s file endpoints ask the issue’s grants', () => {
  const caller = (permissions: Record<string, string>) =>
    ({
      userId: 'u',
      branchId: 'b',
      departmentId: null,
      sectionId: null,
      permissions,
    }) as never;

  it('reads on itAsset.view, writes on itAsset.assign — over a memo the caller can see', async () => {
    expect(consumableMemoFileAuthorizer.entityType).toBe('consumableMemo');
    const viewer = caller({ 'itAsset.view': 'branch' });
    expect(
      await consumableMemoFileAuthorizer.authorize({ ctx: viewer, entityId: MEMO, intent: 'read' }),
    ).toBe(true);
    expect(
      await consumableMemoFileAuthorizer.authorize({
        ctx: viewer,
        entityId: MEMO,
        intent: 'write',
      }),
    ).toBe(false);

    const keeper = caller({ 'itAsset.view': 'branch', 'itAsset.assign': 'branch' });
    expect(
      await consumableMemoFileAuthorizer.authorize({
        ctx: keeper,
        entityId: MEMO,
        intent: 'write',
      }),
    ).toBe(true);
    // Scoped by the READ grant, as every custody read is.
    expect(mocks.findMemo).toHaveBeenLastCalledWith(
      MEMO,
      expect.objectContaining({ scope: 'branch' }),
    );

    mocks.findMemo.mockResolvedValue(null);
    expect(
      await consumableMemoFileAuthorizer.authorize({ ctx: keeper, entityId: MEMO, intent: 'read' }),
    ).toBe(false);
  });
});

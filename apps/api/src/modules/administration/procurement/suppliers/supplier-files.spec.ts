// The papers' authorizer, a paper's link and the scan states the detail reads (design §11.3–§11.5;
// ADR-023): the platform's own file paths ask the supplier's keys — `.view` at any scope reads,
// since suppliers carry no scope field, and `.edit` writes only when held company-wide (OD-04 A),
// the rule the paper endpoints apply; a supplier that does not exist denies. A link waits for its
// collection before a byte is stored, and a link write that misses or throws withdraws its upload.
// Each paper's scan state comes from one listing of the supplier's files, a link the listing missed
// is read by id, a file gone or archived reads null, and a writer who may not read the papers is
// not sent to Files at all. Files and the repository mocked: no database.
import { type DataScope } from '@ecms/contracts';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, StaleDocumentError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { type AdministrationSupplierDoc } from './supplier.model';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  supplierById: vi.fn(),
  ready: vi.fn(),
  push: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  upload: vi.fn(),
  softDelete: vi.fn(),
  ensure: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('./supplier.repository', () => ({
  administrationSupplierRepository: {
    findById: mocks.findById,
    getById: mocks.supplierById,
    ensureCollection: mocks.ready,
    pushAttachment: mocks.push,
  },
}));
vi.mock('../../../../platform/files', () => ({
  fileService: {
    list: mocks.list,
    getById: mocks.getById,
    upload: mocks.upload,
    softDelete: mocks.softDelete,
  },
  fileCategoryService: { ensure: mocks.ensure },
}));
vi.mock('./supplier-audit', () => ({
  auditSupplierPaperAdded: mocks.audit,
  auditSupplierPaperRemoved: mocks.audit,
}));

const { administrationSupplierPapers, supplierFileAuthorizer } = await import('./supplier-files');

const ctx = (permissions: Record<string, DataScope>): AuthContext => ({
  userId: '64a0000000000000000000aa',
  sessionId: 's',
  branchId: '64a000000000000000000001',
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});

const SUPPLIER = '64a0000000000000000000f1';
const ask = (permissions: Record<string, DataScope>, intent: 'read' | 'write') =>
  supplierFileAuthorizer.authorize({ ctx: ctx(permissions), entityId: SUPPLIER, intent });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findById.mockResolvedValue({ _id: new Types.ObjectId(SUPPLIER) });
  mocks.ensure.mockResolvedValue({ _id: new Types.ObjectId('64a0000000000000000000c0') });
});

describe('the papers’ authorizer (§11.3)', () => {
  it.each<DataScope>(['organization', 'branch', 'department', 'own'])(
    'reads with `.view` at %s scope — a supplier has no scope field',
    async (scope) => {
      expect(await ask({ 'administrationSupplier.view': scope }, 'read')).toBe(true);
    },
  );

  it('writes with `.edit` held company-wide', async () => {
    expect(await ask({ 'administrationSupplier.edit': 'organization' }, 'write')).toBe(true);
  });

  it.each<DataScope>(['branch', 'department', 'section', 'own'])(
    'refuses a write with `.edit` at %s scope — no side door past OD-04 A',
    async (scope) => {
      expect(await ask({ 'administrationSupplier.edit': scope }, 'write')).toBe(false);
    },
  );

  it('refuses a read without `.view`, and a write without `.edit`', async () => {
    expect(await ask({ 'administrationSupplier.edit': 'organization' }, 'read')).toBe(false);
    expect(await ask({ 'administrationSupplier.view': 'organization' }, 'write')).toBe(false);
    expect(await ask({}, 'read')).toBe(false);
    expect(mocks.findById, 'no key, no lookup').not.toHaveBeenCalled();
  });

  it('denies, rather than throws, for a supplier that does not exist', async () => {
    mocks.findById.mockResolvedValue(null);
    expect(await ask({ 'administrationSupplier.view': 'organization' }, 'read')).toBe(false);
  });

  it('does not opt into the delete intent: a removal is asked as a write', () => {
    expect(supplierFileAuthorizer.understandsDelete).toBeUndefined();
  });
});

describe('linking a paper (§11.4)', () => {
  const FILE = '64a0000000000000000000e1';
  const writer = ctx({ 'administrationSupplier.edit': 'organization' });
  const binary = {
    originalName: 'tax-card.pdf',
    mime: 'application/pdf',
    size: 4,
    buffer: Buffer.from('%PDF'),
  };
  // The row carries only what `add` reads: its id, its version and its papers.
  const row = { _id: new Types.ObjectId(SUPPLIER), __v: 3, attachments: [] };
  const link = () =>
    administrationSupplierPapers.add(writer, SUPPLIER, { label: 'سجل', version: 3 }, binary);

  beforeEach(() => {
    mocks.supplierById.mockResolvedValue(row);
    mocks.ready.mockResolvedValue(undefined);
    mocks.upload.mockResolvedValue({
      _id: new Types.ObjectId(FILE),
      mime: 'application/pdf',
      size: 4,
    });
    mocks.softDelete.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });

  it('a failed index build refuses the link before a byte is stored', async () => {
    const failedBuild = new Error('index build failed');
    mocks.ready.mockRejectedValue(failedBuild);
    await expect(link()).rejects.toBe(failedBuild);
    expect(mocks.upload, 'nothing stored without the index').not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('a link write that throws withdraws its upload and answers the write’s own error', async () => {
    const stepdown = new Error('not primary');
    mocks.push.mockRejectedValue(stepdown);
    mocks.softDelete.mockRejectedValue(new Error('the withdrawal failed too'));
    await expect(link()).rejects.toBe(stepdown);
    expect(mocks.softDelete).toHaveBeenCalledWith(writer, FILE);
    expect(mocks.audit, 'nothing linked, nothing audited').not.toHaveBeenCalled();
  });

  it('a link write that misses withdraws its upload and says why: the row moved on', async () => {
    mocks.push.mockResolvedValue(null);
    mocks.findById.mockResolvedValue({ ...row, __v: 4 });
    await expect(link()).rejects.toBeInstanceOf(StaleDocumentError);
    expect(mocks.softDelete).toHaveBeenCalledWith(writer, FILE);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('a link that lands is audited and its upload kept', async () => {
    mocks.push.mockResolvedValue({ ...row, __v: 4 });
    expect(await link()).toMatchObject({ __v: 4 });
    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(SUPPLIER, 'سجل');
  });
});

describe('the scan states the detail reads (§11.5)', () => {
  const paper = (fileId: string) => ({
    attachmentId: new Types.ObjectId(),
    fileId: new Types.ObjectId(fileId),
    categoryKey: 'administration-supplier-documents',
    label: 'x',
    fileName: 'x.pdf',
    mime: 'application/pdf',
    size: 1,
    addedByUserId: new Types.ObjectId(),
    addedAt: new Date(),
  });
  const LISTED = '64a0000000000000000000d1';
  const PENDING = '64a0000000000000000000d2';
  const REPLACED = '64a0000000000000000000d3';
  const ARCHIVED = '64a0000000000000000000d4';
  const GONE = '64a0000000000000000000d5';
  // The doc carries only what the reader reads: its id and its papers.
  const supplier = {
    _id: new Types.ObjectId(SUPPLIER),
    attachments: [LISTED, PENDING, REPLACED, ARCHIVED, GONE].map(paper),
  } as unknown as AdministrationSupplierDoc;
  const viewer = ctx({ 'administrationSupplier.view': 'organization' });

  it('reads nothing for a supplier without papers', async () => {
    // The same partial doc, its list emptied: the reader reads nothing else.
    const empty = { ...supplier, attachments: [] } as AdministrationSupplierDoc;
    expect((await administrationSupplierPapers.scanStates(viewer, empty)).size).toBe(0);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('lists the supplier’s files once, reads a missed link by id, and reads null when unavailable', async () => {
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
    const states = await administrationSupplierPapers.scanStates(viewer, supplier);
    expect(Object.fromEntries(states)).toEqual({
      [LISTED]: 'clean',
      [PENDING]: 'pending',
      [REPLACED]: 'blocked',
      [ARCHIVED]: null,
      [GONE]: null,
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    // The mock's call, read as `fileService.list`'s three arguments.
    const [query, , asked] = mocks.list.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      unknown,
    ];
    expect(query).toMatchObject({
      moduleId: 'administration',
      entityType: 'supplier',
      entityId: SUPPLIER,
      categoryId: '64a0000000000000000000c0',
      pageSize: 100,
    });
    expect(asked, 'the listing asks the authorizer as the caller').toBe(viewer);
  });

  it('a writer without `.view` reads every state null, and Files is not asked in their name', async () => {
    const writer = ctx({ 'administrationSupplier.edit': 'organization' });
    const states = await administrationSupplierPapers.scanStates(writer, supplier);
    expect([...states.values()]).toEqual([null, null, null, null, null]);
    expect([...states.keys()]).toEqual([LISTED, PENDING, REPLACED, ARCHIVED, GONE]);
    expect(mocks.list, 'no listing the authorizer would empty').not.toHaveBeenCalled();
    expect(mocks.getById, 'no read refused — and audited — per paper').not.toHaveBeenCalled();
  });
});

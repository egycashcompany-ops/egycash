// The papers' authorizer and the scan states the detail reads (design §11.3, §11.5; ADR-023): the
// platform's own file paths ask the supplier's keys — `.view` at any scope reads, since suppliers
// carry no scope field, and `.edit` writes only when held company-wide (OD-04 A), the rule the
// paper endpoints apply; a supplier that does not exist denies. Each paper's scan state comes from
// one listing of the supplier's files, a link the listing missed is read by id, and a file gone or
// archived reads null. Files and the repository mocked: no database.
import { type DataScope } from '@ecms/contracts';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { type AdministrationSupplierDoc } from './supplier.model';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  ensure: vi.fn(),
}));

vi.mock('./supplier.repository', () => ({
  administrationSupplierRepository: { findById: mocks.findById },
}));
vi.mock('../../../../platform/files', () => ({
  fileService: { list: mocks.list, getById: mocks.getById },
  fileCategoryService: { ensure: mocks.ensure },
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
});

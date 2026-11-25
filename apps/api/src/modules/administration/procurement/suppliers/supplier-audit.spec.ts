// A supplier's trail (design §10.2, §11.4, §19.6): the literal ref the realtime registry scans for;
// a `create` row carrying the generated code; `update` rows that broadcast themselves; `activate`
// and `deactivate` rows, which do not, each followed by one explicit organization-wide `update`
// signal; nothing for an edit that changed nothing; and a paper linked or removed as one `update`
// row naming it under its purpose. The platform's audit and realtime mocked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdministrationSupplierDoc } from './supplier.model';

const mocks = vi.hoisted(() => ({ record: vi.fn(), publish: vi.fn() }));

vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));

const {
  auditSupplierCreated,
  auditSupplierEdited,
  auditSupplierPaperAdded,
  auditSupplierPaperRemoved,
  supplierEntityRef,
} = await import('./supplier-audit');

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = new Date('2026-11-24T09:00:00.000Z');
const CATEGORY = new Types.ObjectId('64a0000000000000000000a1');
const ID = '64a0000000000000000000f1';

const supplier = (over: Partial<AdministrationSupplierDoc> = {}): AdministrationSupplierDoc => ({
  _id: new Types.ObjectId(ID),
  code: 'SUP-00001',
  name: { ar: 'مؤسسة النور', en: 'Al Nour' },
  nameKey: 'مؤسسهالنور',
  phone: null,
  email: null,
  address: null,
  contacts: [],
  categoryIds: [CATEGORY],
  taxNumber: null,
  commercialRegistry: null,
  vatStatus: null,
  paymentTerms: null,
  attachments: [],
  notes: null,
  isActive: true,
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: null,
  updatedBy: null,
  createdAt: AT,
  updatedAt: AT,
  __v: 0,
  ...over,
});

// A mock's calls are untyped; each is read as the audit entry the service hands `record`.
const recorded = () =>
  mocks.record.mock.calls.map(
    ([entry]) =>
      entry as {
        action: string;
        entityRef: { entityId: string };
        changes: { field: string; old: unknown; new: unknown }[];
      },
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.record.mockResolvedValue(undefined);
});

describe('the supplier’s entity ref', () => {
  it('is a literal pair — the realtime registry classifies `administration.supplier`', () => {
    expect(supplierEntityRef('x')).toEqual({
      moduleId: 'administration',
      entityType: 'supplier',
      entityId: 'x',
    });
    const source = readFileSync(join(HERE, 'supplier-audit.ts'), 'utf8');
    expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'supplier'/);
  });

  it('is the pair its papers are filed under too, written as a literal at the upload', () => {
    const source = readFileSync(join(HERE, 'supplier-files.ts'), 'utf8');
    expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'supplier'/);
  });
});

describe('a supplier created', () => {
  it('writes one `create` row of its facts, its code and categories as ids — and no signal', async () => {
    await auditSupplierCreated(
      supplier({
        taxNumber: '123-456-789',
        contacts: [{ name: 'أحمد', role: null, phone: '0100', email: null }],
      }),
    );
    const [row] = recorded();
    expect(row?.action).toBe('create');
    expect(row?.changes).toEqual(
      expect.arrayContaining([
        { field: 'code', old: null, new: 'SUP-00001' },
        { field: 'name.ar', old: null, new: 'مؤسسة النور' },
        { field: 'categoryIds', old: null, new: [String(CATEGORY)] },
        { field: 'taxNumber', old: null, new: '123-456-789' },
        {
          field: 'contacts',
          old: null,
          new: [{ name: 'أحمد', role: null, phone: '0100', email: null }],
        },
        { field: 'isActive', old: null, new: true },
      ]),
    );
    const fields = row?.changes.map((c) => c.field) ?? [];
    expect(fields, 'the folded key is not a fact').not.toContain('nameKey');
    expect(fields, 'papers are their own rows').not.toContain('attachments');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('a supplier edited', () => {
  it('writes one `update` row of what changed, and no signal', async () => {
    await auditSupplierEdited(supplier(), supplier({ paymentTerms: '30 يومًا', __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'update',
        changes: [{ field: 'paymentTerms', old: null, new: '30 يومًا' }],
      }),
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('writes nothing for an edit that changed nothing — a paper’s version bump included', async () => {
    await auditSupplierEdited(supplier(), supplier({ __v: 3 }));
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('a supplier retired or brought back', () => {
  it('a deactivation is one `deactivate` row, followed by one organization-wide `update` signal', async () => {
    await auditSupplierEdited(supplier(), supplier({ isActive: false, notes: 'stopped', __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'deactivate',
        changes: [
          { field: 'notes', old: null, new: 'stopped' },
          { field: 'isActive', old: true, new: false },
        ],
      }),
    ]);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    // The mock's call, read as the one argument `publishAuditedChange` takes.
    const [signal] = mocks.publish.mock.calls[0] as [Record<string, unknown>];
    expect(signal).toMatchObject({
      entityRef: { moduleId: 'administration', entityType: 'supplier', entityId: ID },
      action: 'update',
    });
    expect(signal.branchId).toBeUndefined();
  });

  it('a reactivation is `activate`, with its signal', async () => {
    await auditSupplierEdited(supplier({ isActive: false }), supplier({ isActive: true, __v: 1 }));
    expect(recorded().map((row) => row.action)).toEqual(['activate']);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});

describe('a paper linked or removed (§11.4)', () => {
  it('is one `update` row on the supplier, `attachment` naming the paper under its purpose', async () => {
    await auditSupplierPaperAdded(ID, 'السجل التجاري');
    await auditSupplierPaperRemoved(ID, 'السجل التجاري');
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'update',
        entityRef: expect.objectContaining({ entityId: ID }),
        changes: [
          {
            field: 'attachment',
            old: null,
            new: 'administration-supplier-documents:السجل التجاري',
          },
        ],
      }),
      expect.objectContaining({
        action: 'update',
        changes: [
          {
            field: 'attachment',
            old: 'administration-supplier-documents:السجل التجاري',
            new: null,
          },
        ],
      }),
    ]);
    // `update` is broadcast by the audit itself, to the organization room: no signal of its own.
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

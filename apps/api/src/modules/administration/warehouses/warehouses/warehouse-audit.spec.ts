// A warehouse's trail (design §9.1, §10.2, §19.6): the literal ref the realtime registry scans for;
// a `create` row with its branch and references as ids; `update`, `activate` and `deactivate` rows;
// and after EVERY act one `update` signal carrying the warehouse's branch — so a branch-scoped
// reader's room hears it, which the audit row alone (no branch) never reaches. Nothing at all for
// an edit that changed nothing. The `consumable-history.spec.ts` posture: the platform's audit and
// realtime mocked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdministrationWarehouseDoc } from './warehouse.model';

const mocks = vi.hoisted(() => ({ record: vi.fn(), publish: vi.fn() }));

vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));

const { auditWarehouseCreated, auditWarehouseEdited, warehouseEntityRef } =
  await import('./warehouse-audit');

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = new Date('2026-11-24T09:00:00.000Z');
const BRANCH = new Types.ObjectId('64a0000000000000000000b1');
const DEPARTMENT = new Types.ObjectId('64a0000000000000000000d1');
const KEEPER = new Types.ObjectId('64a0000000000000000000e7');

const warehouse = (over: Partial<AdministrationWarehouseDoc> = {}): AdministrationWarehouseDoc => ({
  _id: new Types.ObjectId('64a0000000000000000000f1'),
  code: 'CAI-01',
  name: { ar: 'مخزن الأدوات', en: 'Tools store' },
  nameKey: 'مخزنالادوات',
  branchId: BRANCH,
  type: 'main',
  departmentId: null,
  responsibleEmployeeId: null,
  location: null,
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

const recorded = () =>
  mocks.record.mock.calls.map(
    // A mock's calls are untyped; each is the one entry `auditService.record` was handed.
    ([entry]) =>
      entry as { action: string; changes: { field: string; old: unknown; new: unknown }[] },
  );

/** Each signal sent, as `publishAuditedChange` received it. */
const signals = () =>
  // A mock's calls are untyped; each is the one change `publishAuditedChange` was handed.
  mocks.publish.mock.calls.map(([signal]) => signal as Record<string, unknown>);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.record.mockResolvedValue(undefined);
});

describe('the warehouse’s entity ref', () => {
  it('is a literal pair — the realtime registry classifies `administration.warehouse`', () => {
    expect(warehouseEntityRef('x')).toEqual({
      moduleId: 'administration',
      entityType: 'warehouse',
      entityId: 'x',
    });
    const source = readFileSync(join(HERE, 'warehouse-audit.ts'), 'utf8');
    expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'warehouse'/);
  });
});

describe('a warehouse created', () => {
  it('writes one `create` row of its facts, its branch and references as ids', async () => {
    await auditWarehouseCreated(
      warehouse({ departmentId: DEPARTMENT, responsibleEmployeeId: KEEPER, location: 'الدور 2' }),
    );
    const [row] = recorded();
    expect(row?.action).toBe('create');
    expect(row?.changes).toEqual(
      expect.arrayContaining([
        { field: 'code', old: null, new: 'CAI-01' },
        { field: 'name.ar', old: null, new: 'مخزن الأدوات' },
        { field: 'branchId', old: null, new: String(BRANCH) },
        { field: 'type', old: null, new: 'main' },
        { field: 'departmentId', old: null, new: String(DEPARTMENT) },
        { field: 'responsibleEmployeeId', old: null, new: String(KEEPER) },
        { field: 'location', old: null, new: 'الدور 2' },
        { field: 'isActive', old: null, new: true },
      ]),
    );
    const fields = row?.changes.map((change) => change.field);
    expect(fields, 'the folded key is not a fact').not.toContain('nameKey');
    expect(fields, 'no name of the keeper is copied anywhere').not.toContain('keeperName');
  });

  it('…followed by one `update` signal WITH its branch', async () => {
    await auditWarehouseCreated(warehouse());
    expect(signals()).toEqual([
      expect.objectContaining({
        entityRef: {
          moduleId: 'administration',
          entityType: 'warehouse',
          entityId: expect.any(String),
        },
        action: 'update',
        branchId: String(BRANCH),
        at: expect.any(String),
      }),
    ]);
  });
});

describe('a warehouse edited', () => {
  it('writes one `update` row of what changed, and signals its branch', async () => {
    await auditWarehouseEdited(warehouse(), warehouse({ responsibleEmployeeId: KEEPER, __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'update',
        changes: [{ field: 'responsibleEmployeeId', old: null, new: String(KEEPER) }],
      }),
    ]);
    expect(signals()).toEqual([
      expect.objectContaining({ action: 'update', branchId: String(BRANCH) }),
    ]);
  });

  it('writes and signals nothing for an edit that changed nothing', async () => {
    await auditWarehouseEdited(warehouse(), warehouse({ __v: 1 }));
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('a warehouse retired or brought back', () => {
  it('a retirement is one `deactivate` row with every field the PATCH changed, and its signal', async () => {
    await auditWarehouseEdited(warehouse(), warehouse({ isActive: false, notes: 'أغلق', __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'deactivate',
        changes: [
          { field: 'notes', old: null, new: 'أغلق' },
          { field: 'isActive', old: true, new: false },
        ],
      }),
    ]);
    expect(signals()).toEqual([
      expect.objectContaining({ action: 'update', branchId: String(BRANCH) }),
    ]);
  });

  it('a reactivation is `activate`, with its branch signal', async () => {
    await auditWarehouseEdited(warehouse({ isActive: false }), warehouse({ __v: 1 }));
    expect(recorded().map((row) => row.action)).toEqual(['activate']);
    expect(signals()).toEqual([
      expect.objectContaining({ action: 'update', branchId: String(BRANCH) }),
    ]);
  });
});

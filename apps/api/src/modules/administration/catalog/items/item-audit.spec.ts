// An item's trail (design §10.2, §19.6): the literal ref the realtime registry scans for; a `create`
// row carrying the generated code; `update` rows that broadcast themselves; `activate` and
// `deactivate` rows, which do not, each followed by one explicit organization-wide `update`
// signal; and nothing for an edit that changed nothing. The `consumable-history.spec.ts` posture:
// the platform's audit and realtime mocked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdministrationItemDoc } from './item.model';

const mocks = vi.hoisted(() => ({ record: vi.fn(), publish: vi.fn() }));

vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));

const { auditItemCreated, auditItemEdited, itemEntityRef } = await import('./item-audit');

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = new Date('2026-11-24T09:00:00.000Z');
const CATEGORY = new Types.ObjectId('64a0000000000000000000a1');
const UNIT = new Types.ObjectId('64a0000000000000000000c1');

const item = (over: Partial<AdministrationItemDoc> = {}): AdministrationItemDoc => ({
  _id: new Types.ObjectId('64a0000000000000000000e1'),
  code: 'ITM-00001',
  barcode: null,
  name: { ar: 'ورق تصوير', en: 'Copy paper' },
  nameKey: 'ورقتصوير',
  categoryId: CATEGORY,
  unitId: UNIT,
  minQty: null,
  reorderPointQty: null,
  maxQty: null,
  description: null,
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
    ([entry]) =>
      entry as { action: string; changes: { field: string; old: unknown; new: unknown }[] },
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.record.mockResolvedValue(undefined);
});

describe('the item’s entity ref', () => {
  it('is a literal pair — the realtime registry classifies `administration.item`', () => {
    expect(itemEntityRef('x')).toEqual({
      moduleId: 'administration',
      entityType: 'item',
      entityId: 'x',
    });
    const source = readFileSync(join(HERE, 'item-audit.ts'), 'utf8');
    expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'item'/);
  });
});

describe('an item created', () => {
  it('writes one `create` row of its facts, its code and references as ids — and no signal', async () => {
    await auditItemCreated(item({ barcode: '6221234567890', minQty: 5 }));
    const [row] = recorded();
    expect(row?.action).toBe('create');
    expect(row?.changes).toEqual(
      expect.arrayContaining([
        { field: 'code', old: null, new: 'ITM-00001' },
        { field: 'barcode', old: null, new: '6221234567890' },
        { field: 'name.ar', old: null, new: 'ورق تصوير' },
        { field: 'categoryId', old: null, new: String(CATEGORY) },
        { field: 'unitId', old: null, new: String(UNIT) },
        { field: 'minQty', old: null, new: 5 },
        { field: 'isActive', old: null, new: true },
      ]),
    );
    expect(
      row?.changes.map((c) => c.field),
      'the folded key is not a fact',
    ).not.toContain('nameKey');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('an item edited', () => {
  it('writes one `update` row of what changed, and no signal', async () => {
    await auditItemEdited(item(), item({ reorderPointQty: 12, __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'update',
        changes: [{ field: 'reorderPointQty', old: null, new: 12 }],
      }),
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('writes nothing for an edit that changed nothing', async () => {
    await auditItemEdited(item(), item({ __v: 1 }));
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('an item retired or brought back', () => {
  it('a deactivation is one `deactivate` row with every field the PATCH changed', async () => {
    await auditItemEdited(item(), item({ isActive: false, notes: 'replaced', __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'deactivate',
        changes: [
          { field: 'notes', old: null, new: 'replaced' },
          { field: 'isActive', old: true, new: false },
        ],
      }),
    ]);
  });

  it('…followed by one explicit `update` signal, organization-wide (no branch)', async () => {
    await auditItemEdited(item(), item({ isActive: false, __v: 1 }));
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [signal] = mocks.publish.mock.calls[0] as [Record<string, unknown>];
    expect(signal).toMatchObject({
      entityRef: { moduleId: 'administration', entityType: 'item' },
      action: 'update',
    });
    expect(signal.branchId).toBeUndefined();
    expect(typeof signal.at).toBe('string');
  });

  it('a reactivation is `activate`, with its signal', async () => {
    await auditItemEdited(item({ isActive: false }), item({ isActive: true, __v: 1 }));
    expect(recorded().map((row) => row.action)).toEqual(['activate']);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});

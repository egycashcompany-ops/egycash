// A unit's trail (design §10.2, §19.6): the literal ref the realtime registry scans for; `create`
// and `update` rows that broadcast themselves; `activate` and `deactivate` rows, which do not, each
// followed by one explicit organization-wide `update` signal; and nothing for an edit that changed
// nothing. The `consumable-history.spec.ts` posture: the platform's audit and realtime mocked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdministrationCatalogItemDoc } from './catalog-item.model';

const mocks = vi.hoisted(() => ({ record: vi.fn(), publish: vi.fn() }));
vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));

const { auditCatalogItemCreated, auditCatalogItemEdited, catalogItemEntityRef } =
  await import('./catalog-item-audit');

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = new Date('2026-11-24T09:00:00.000Z');

const unit = (over: Partial<AdministrationCatalogItemDoc> = {}): AdministrationCatalogItemDoc => ({
  _id: new Types.ObjectId('64a0000000000000000000c1'),
  kind: 'unit',
  code: 'pc',
  name: { ar: 'قطعة', en: 'Piece' },
  nameKey: 'قطعه',
  description: null,
  sortOrder: 0,
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

describe('the unit’s entity ref', () => {
  it('is a literal pair — the realtime registry classifies `administration.catalogItem`', () => {
    expect(catalogItemEntityRef('x')).toEqual({
      moduleId: 'administration',
      entityType: 'catalogItem',
      entityId: 'x',
    });
    const source = readFileSync(join(HERE, 'catalog-item-audit.ts'), 'utf8');
    expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'catalogItem'/);
  });
});

describe('a unit created', () => {
  it('writes one `create` row of its facts — and no signal, the row broadcasts itself', async () => {
    await auditCatalogItemCreated(unit());
    const [row] = recorded();
    expect(row?.action).toBe('create');
    expect(row?.changes).toEqual(
      expect.arrayContaining([
        { field: 'kind', old: null, new: 'unit' },
        { field: 'name.ar', old: null, new: 'قطعة' },
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

describe('a unit edited', () => {
  it('writes one `update` row of what changed, and no signal', async () => {
    await auditCatalogItemEdited(unit(), unit({ name: { ar: 'قطعة', en: 'Item' }, __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'update',
        changes: [{ field: 'name.en', old: 'Piece', new: 'Item' }],
      }),
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('writes nothing for an edit that changed nothing', async () => {
    await auditCatalogItemEdited(unit(), unit({ __v: 1 }));
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('a unit retired or brought back', () => {
  it('a deactivation is one `deactivate` row with every field the PATCH changed', async () => {
    await auditCatalogItemEdited(unit(), unit({ isActive: false, sortOrder: 9, __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'deactivate',
        changes: [
          { field: 'sortOrder', old: 0, new: 9 },
          { field: 'isActive', old: true, new: false },
        ],
      }),
    ]);
  });

  it('…followed by one explicit `update` signal, organization-wide (no branch)', async () => {
    await auditCatalogItemEdited(unit(), unit({ isActive: false, __v: 1 }));
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [signal] = mocks.publish.mock.calls[0] as [Record<string, unknown>];
    expect(signal).toMatchObject({
      entityRef: { moduleId: 'administration', entityType: 'catalogItem' },
      action: 'update',
    });
    expect(signal.branchId).toBeUndefined();
    expect(typeof signal.at).toBe('string');
  });

  it('a reactivation is `activate`, with its signal', async () => {
    await auditCatalogItemEdited(unit({ isActive: false }), unit({ isActive: true, __v: 1 }));
    expect(recorded().map((row) => row.action)).toEqual(['activate']);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});

// A category's trail (design §10.2, §19.6): the literal ref; a `create` row; a move audited as an
// `update` of `parentId`; `activate` and `deactivate` rows, each followed by one explicit
// organization-wide `update` signal; nothing for an edit that changed nothing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdministrationItemCategoryDoc } from './item-category.model';

const mocks = vi.hoisted(() => ({ record: vi.fn(), publish: vi.fn() }));
vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));

const { auditItemCategoryCreated, auditItemCategoryEdited, itemCategoryEntityRef } =
  await import('./item-category-audit');

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = new Date('2026-11-24T09:00:00.000Z');
const TOOLS = new Types.ObjectId('a0000000000000000000000a');
const PAPER = new Types.ObjectId('a0000000000000000000000c');

const category = (
  over: Partial<AdministrationItemCategoryDoc> = {},
): AdministrationItemCategoryDoc => ({
  _id: new Types.ObjectId('a0000000000000000000000b'),
  code: null,
  name: { ar: 'عدد يدوية', en: 'Hand tools' },
  nameKey: 'عدديدويه',
  parentId: TOOLS,
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

it('names the category with a literal pair — `administration.itemCategory`', () => {
  expect(itemCategoryEntityRef('x')).toEqual({
    moduleId: 'administration',
    entityType: 'itemCategory',
    entityId: 'x',
  });
  const source = readFileSync(join(HERE, 'item-category-audit.ts'), 'utf8');
  expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'itemCategory'/);
});

describe('a category written', () => {
  it('a create is one `create` row naming its parent as an id', async () => {
    await auditItemCategoryCreated(category());
    const [row] = recorded();
    expect(row?.action).toBe('create');
    expect(row?.changes).toContainEqual({ field: 'parentId', old: null, new: String(TOOLS) });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('a move is an `update` of its parent, with no explicit signal', async () => {
    await auditItemCategoryEdited(category(), category({ parentId: PAPER, __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'update',
        changes: [{ field: 'parentId', old: String(TOOLS), new: String(PAPER) }],
      }),
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('nothing changed, nothing written', async () => {
    await auditItemCategoryEdited(category(), category({ __v: 1 }));
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe('a category retired or brought back', () => {
  it('`deactivate`, then one organization-wide `update` signal', async () => {
    await auditItemCategoryEdited(category(), category({ isActive: false, __v: 1 }));
    expect(recorded()).toEqual([
      expect.objectContaining({
        action: 'deactivate',
        changes: [{ field: 'isActive', old: true, new: false }],
      }),
    ]);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [signal] = mocks.publish.mock.calls[0] as [Record<string, unknown>];
    expect(signal).toMatchObject({
      entityRef: { moduleId: 'administration', entityType: 'itemCategory' },
      action: 'update',
    });
    expect(signal.branchId).toBeUndefined();
  });

  it('`activate`, with its signal', async () => {
    await auditItemCategoryEdited(category({ isActive: false }), category({ __v: 1 }));
    expect(recorded().map((row) => row.action)).toEqual(['activate']);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});

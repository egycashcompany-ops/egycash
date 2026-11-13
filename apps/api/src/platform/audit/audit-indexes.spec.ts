// The boot step that builds `ix_action_at` and `ix_at` on `audit_logs`, without a database: the
// collection's two calls are stubbed, so each test says exactly what the server holds and reads
// back exactly what was asked of it. What it builds is read from the schema, so a declaration
// removed or changed in audit.model.ts fails here before production meets it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../infrastructure/logging/logger';
import { AuditLogModel } from './audit.model';
import { AUDIT_BOOT_INDEXES, auditBootIndexPlan, ensureAuditIndexes } from './audit-indexes';

const EXISTING = [
  { name: '_id_', key: { _id: 1 } },
  {
    name: 'ix_entityRef_at',
    key: { 'entityRef.entityType': 1, 'entityRef.entityId': 1, at: -1 },
  },
  { name: 'ix_actor_at', key: { 'actor.userId': 1, at: -1 } },
  { name: 'ix_moduleId_at', key: { 'entityRef.moduleId': 1, at: -1 } },
];

let live: Record<string, unknown>[] | Error;
let created: { keys: unknown; options: unknown }[];
let refuse: Map<string, Error>;

beforeEach(() => {
  live = [...EXISTING];
  created = [];
  refuse = new Map();
  vi.spyOn(AuditLogModel.collection, 'listIndexes').mockImplementation(
    () =>
      ({
        toArray: async () => {
          if (live instanceof Error) throw live;
          return live;
        },
      }) as never,
  );
  vi.spyOn(AuditLogModel.collection, 'createIndex').mockImplementation((async (
    keys: unknown,
    options: { name: string },
  ) => {
    const refusal = refuse.get(options.name);
    if (refusal !== undefined) throw refusal;
    created.push({ keys, options });
    return options.name;
  }) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const serverError = (code: number, codeName: string, message: string): Error =>
  Object.assign(new Error(message), { code, codeName });

describe('what the boot step builds', () => {
  it('is the two declarations on the schema, by name, and nothing else', () => {
    const plan = auditBootIndexPlan();
    expect(plan).toEqual([
      // Equality on the action, then the window's range: every detector of the hourly sweep asks
      // `{ action: <one action>, at: { $gte: <window start> } }`.
      { keys: { action: 1, at: -1 }, options: { name: 'ix_action_at' }, unique: false },
      // The audit list's default order, newest first.
      { keys: { at: -1 }, options: { name: 'ix_at' }, unique: false },
    ]);
    expect(plan.map((entry) => entry.options['name'])).toEqual([...AUDIT_BOOT_INDEXES]);
  });

  it('builds both where neither exists', async () => {
    const result = await ensureAuditIndexes();

    expect(created).toEqual([
      { keys: { action: 1, at: -1 }, options: { name: 'ix_action_at' } },
      { keys: { at: -1 }, options: { name: 'ix_at' } },
    ]);
    expect(result.built).toEqual(['ix_action_at', 'ix_at']);
    expect(result.failed).toEqual([]);
  });

  it('builds only the one that is missing', async () => {
    live = [...EXISTING, { name: 'ix_at', key: { at: -1 } }];

    const result = await ensureAuditIndexes();

    expect(created.map((c) => (c.options as { name: string }).name)).toEqual(['ix_action_at']);
    expect(result.alreadyPresent).toEqual(['ix_at']);
  });

  it('asks nothing of the server once both exist — every later boot', async () => {
    live = [
      ...EXISTING,
      { name: 'ix_action_at', key: { action: 1, at: -1 } },
      { name: 'ix_at', key: { at: -1 } },
    ];

    const result = await ensureAuditIndexes();

    expect(created).toEqual([]);
    expect(result).toEqual({
      built: [],
      alreadyPresent: ['ix_action_at', 'ix_at'],
      presentAs: [],
      failed: [],
    });
  });

  it('leaves alone the same keys an operator already built under another name', async () => {
    // An Atlas Performance Advisor index on the same keys serves the same queries, and the server
    // would refuse a second copy of it with IndexOptionsConflict on every boot.
    live = [...EXISTING, { name: 'action_1_at_-1', key: { action: 1, at: -1 } }];

    const result = await ensureAuditIndexes();

    expect(created.map((c) => (c.options as { name: string }).name)).toEqual(['ix_at']);
    expect(result.presentAs).toEqual([{ index: 'ix_action_at', existing: 'action_1_at_-1' }]);
  });

  it('brings a collection that does not exist yet into being with both', async () => {
    live = serverError(26, 'NamespaceNotFound', 'ns does not exist: ecms.audit_logs');

    const result = await ensureAuditIndexes();

    expect(result.built).toEqual(['ix_action_at', 'ix_at']);
  });
});

describe('a boot step that cannot fail the boot', () => {
  it('warns about an index the server refused, and still builds the other', async () => {
    const warn = vi.spyOn(logger, 'warn');
    refuse.set('ix_action_at', serverError(13, 'Unauthorized', 'not authorized on ecms'));

    const result = await ensureAuditIndexes();

    expect(result.built).toEqual(['ix_at']);
    expect(result.failed).toEqual([
      { index: 'ix_action_at', reason: 'Unauthorized (13): not authorized on ecms' },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'audit_logs', index: 'ix_action_at' }),
      'audit: index not built',
    );
  });

  it('attempts nothing when the index list cannot be read, and still resolves', async () => {
    const warn = vi.spyOn(logger, 'warn');
    live = serverError(6, 'HostUnreachable', 'connection closed');

    const result = await ensureAuditIndexes();

    expect(created).toEqual([]);
    expect(result.failed.map((f) => f.index)).toEqual(['ix_action_at', 'ix_at']);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'audit_logs' }),
      'audit: indexes not checked',
    );
  });
});

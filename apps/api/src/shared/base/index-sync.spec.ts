// The parts of the index sync that need no database: which mode a run is in, which models it
// walks, how a live index is compared with its declaration, what a server error is written to the
// log as, and which log line each outcome gets. What it does against a server is
// tests/integration/index-sync.spec.ts.
import mongoose, { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { indexBuildPlan } from './index-plan';
import {
  BLOCKED_BY_DUPLICATES,
  DUPLICATE_KEY_REASON,
  differences,
  failureReason,
  indexSyncModeFrom,
  registeredModels,
  reportLines,
  reportSummary,
  sameIndexUnderAnotherName,
  type IndexSyncReport,
  type LiveIndex,
} from './index-sync';

describe('the mode a run is in', () => {
  it('only reports unless told to build', () => {
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], 'report')).toBe('report');
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], '')).toBe('report');
    // Through the CLI env.ts refuses 'APPLY' before this runs; the function itself never builds
    // on anything but the exact word.
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], 'APPLY')).toBe('report');
  });

  it('builds with --apply, or with INDEX_SYNC_MODE=apply', () => {
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js', '--apply'], 'report')).toBe('apply');
    expect(indexSyncModeFrom(['node', 'sync-indexes.cli.js'], 'apply')).toBe('apply');
  });
});

describe('the models a run walks', () => {
  it('includes every model on a shared collection, not only the first', () => {
    // `notification_preferences` holds two models, each with its own index. Walking one model per
    // collection left the second one's index unbuilt.
    const shared = `index_sync_shared_${process.pid}`;
    const first = mongoose.model(`IndexSyncFirst${process.pid}`, new Schema({ a: String }), shared);
    const second = mongoose.model(
      `IndexSyncSecond${process.pid}`,
      new Schema({ b: String }),
      shared,
    );
    try {
      const walked = registeredModels();
      expect(walked).toContain(first);
      expect(walked).toContain(second);
    } finally {
      mongoose.deleteModel(first.modelName);
      mongoose.deleteModel(second.modelName);
    }
  });
});

/** One declaration, as the sync plans it. */
const planned = (keys: Record<string, unknown>, options: Record<string, unknown> = {}) =>
  indexBuildPlan([[keys, options]])[0]!;

describe('what a server error is written to the deploy log as', () => {
  const duplicate = Object.assign(
    new Error(
      'Index build failed: 4f0c: Collection app.users ( 9a1e ) :: caused by :: E11000 duplicate ' +
        'key error collection: app.users index: ux_email dup key: { email: "person@example.com" }',
    ),
    { code: 11000, codeName: 'DuplicateKey' },
  );

  it('is a fixed reason for a duplicate key — the message quotes the key', () => {
    expect(failureReason(duplicate)).toBe(DUPLICATE_KEY_REASON);
    // Recognised by the message too, when a wrapper carries another code.
    expect(
      failureReason({ code: 276, message: 'E11000 duplicate key error dup key: { a: 1 }' }),
    ).toBe(DUPLICATE_KEY_REASON);
  });

  it('keeps the code and name of any other error, and cuts a quoted key out of its message', () => {
    const wrapped = Object.assign(
      new Error('Index build aborted :: caused by :: dup key: { nationalId: "29801011234567" }'),
      { code: 276, codeName: 'IndexBuildAborted' },
    );
    const reason = failureReason(wrapped);
    expect(reason).toBe(
      'IndexBuildAborted (276): Index build aborted :: caused by :: dup key: { … }',
    );
    expect(reason).not.toContain('29801011234567');
  });

  it('names an error without a server code by its class', () => {
    const conflict = Object.assign(new Error('Index already exists with a different name: a_1'), {
      code: 85,
      codeName: 'IndexOptionsConflict',
    });
    expect(failureReason(conflict)).toBe(
      'IndexOptionsConflict (85): Index already exists with a different name: a_1',
    );
    expect(failureReason(new TypeError('boom'))).toBe('TypeError: boom');
    expect(failureReason('plain text')).toBe('Error: plain text');
  });
});

describe('comparing a live index with its declaration', () => {
  const live = (index: Partial<LiveIndex>): LiveIndex => ({ name: 'ix', key: { a: 1 }, ...index });

  it('finds nothing when they match, whatever order the partial filter is written in', () => {
    const entry = planned(
      { email: 1 },
      { name: 'ux_email', unique: true, partialFilterExpression: { isDeleted: false, x: 1 } },
    );
    const same = live({
      name: 'ux_email',
      key: { email: 1 },
      unique: true,
      partialFilterExpression: { x: 1, isDeleted: false },
    });
    expect(differences(entry, same)).toEqual([]);
  });

  it('names each property that differs, never its value', () => {
    const entry = planned(
      { a: 1, b: -1 },
      { name: 'ix', unique: true, partialFilterExpression: { isDeleted: false } },
    );
    expect(differences(entry, live({ key: { b: -1, a: 1 }, unique: true }))).toEqual([
      'key',
      'partialFilterExpression',
    ]);
    expect(
      differences(planned({ a: 1 }, { name: 'ix', sparse: true }), live({ unique: true })),
    ).toEqual(['unique', 'sparse']);
    expect(
      differences(
        planned({ a: 1 }, { name: 'ix', expireAfterSeconds: 0 }),
        live({ expireAfterSeconds: 3600 }),
      ),
    ).toEqual(['expireAfterSeconds']);
  });

  it('reads a text index the way the server stores it, and compares its fields', () => {
    const entry = planned({ code: 'text', name: 'text' }, { name: 'tx_search' });
    const stored = live({
      name: 'tx_search',
      key: { _fts: 'text', _ftsx: 1 },
      weights: { name: 1, code: 1 },
    });
    expect(differences(entry, stored)).toEqual([]);
    expect(differences(entry, { ...stored, weights: { code: 1 } })).toEqual(['key']);
  });
});

describe('the same keys under another name', () => {
  const ttl = planned({ expiresAt: 1 }, { name: 'ttl_expiresAt', expireAfterSeconds: 0 });

  it('is the same index to the server when only the name and a TTL differ', () => {
    const handmade: LiveIndex = { name: 'expiresAt_1', key: { expiresAt: 1 } };
    expect(sameIndexUnderAnotherName(ttl, [{ name: '_id_', key: { _id: 1 } }, handmade])).toBe(
      handmade,
    );
  });

  it('is not when uniqueness, the partial filter or sparseness tells them apart', () => {
    const entry = planned(
      { email: 1 },
      { name: 'ux_email', unique: true, partialFilterExpression: { isDeleted: false } },
    );
    expect(sameIndexUnderAnotherName(entry, [{ name: 'email_1', key: { email: 1 } }])).toBe(
      undefined,
    );
    expect(
      sameIndexUnderAnotherName(planned({ a: 1 }, { name: 'ix_a', sparse: true }), [
        { name: 'a_1', key: { a: 1 } },
      ]),
    ).toBe(undefined);
  });

  it('is not when the key order differs', () => {
    const entry = planned({ a: 1, b: 1 }, { name: 'ix_ab' });
    expect(sameIndexUnderAnotherName(entry, [{ name: 'b_1_a_1', key: { b: 1, a: 1 } }])).toBe(
      undefined,
    );
  });

  it('includes any other text index — a collection holds only one', () => {
    const entry = planned({ code: 'text' }, { name: 'tx_search' });
    const other: LiveIndex = {
      name: 'title_text',
      key: { _fts: 'text', _ftsx: 1 },
      weights: { title: 1 },
    };
    expect(sameIndexUnderAnotherName(entry, [other])).toBe(other);
  });

  it('leaves out a live index with a collation — the server keeps both, so the declaration is built', () => {
    const entry = planned({ email: 1 }, { name: 'ix_email' });
    const collated: LiveIndex = { name: 'email_1', key: { email: 1 }, collation: { locale: 'ar' } };
    expect(sameIndexUnderAnotherName(entry, [collated])).toBe(undefined);
  });
});

describe('the deploy log lines', () => {
  const report = (overrides: Partial<IndexSyncReport>): IndexSyncReport => ({
    mode: 'apply',
    collections: 2,
    declared: 7,
    alreadyPresent: 1,
    missing: [],
    built: [],
    conflicts: [],
    drifted: [],
    failed: [],
    ...overrides,
  });

  it('separates built, blocked, conflicting, drifted and failed indexes', () => {
    const applied = report({
      missing: [
        { collection: 'c', index: 'ix_built', unique: false },
        {
          collection: 'c',
          index: 'ux_blocked',
          unique: true,
          duplicateGroups: 1,
          duplicateExampleIds: [['id1', 'id2']],
        },
        { collection: 'c', index: 'ux_refused', unique: true },
      ],
      built: ['c.ix_built'],
      conflicts: [{ collection: 'c', index: 'ttl_at', conflictsWith: 'at_1' }],
      drifted: [{ collection: 'c', index: 'ux_email', differs: ['unique'] }],
      failed: [
        { collection: 'c', index: 'ux_refused', reason: DUPLICATE_KEY_REASON },
        { collection: 'd', reason: 'HostUnreachable (6): connection closed' },
      ],
    });

    expect(reportLines(applied).map((line) => [line.level, line.msg])).toEqual([
      ['info', 'index sync: built'],
      ['warn', BLOCKED_BY_DUPLICATES],
      ['warn', 'index sync: index NOT built — its keys are indexed under another name'],
      ['warn', 'index sync: index differs from its declaration — left as it is'],
      ['warn', 'index sync: index not built'],
      ['warn', 'index sync: indexes not read — the collection was skipped'],
    ]);
    expect(reportSummary(applied)).toEqual({
      level: 'info',
      msg: 'index sync: done',
      fields: {
        mode: 'apply',
        collections: 2,
        declared: 7,
        alreadyPresent: 1,
        missing: 3,
        built: 1,
        blockedByDuplicates: 1,
        conflicts: 1,
        drifted: 1,
        failed: 2,
      },
    });
  });

  it('says what a report-only run would build, and that it built nothing', () => {
    const reported = report({
      mode: 'report',
      missing: [
        { collection: 'c', index: 'ix_new', unique: false },
        { collection: 'c', index: 'ux_dup', unique: true, duplicateGroups: 2 },
      ],
    });
    expect(reportLines(reported).map((line) => [line.level, line.msg])).toEqual([
      ['info', 'index sync: would build'],
      ['warn', BLOCKED_BY_DUPLICATES],
    ]);
    expect(reportSummary(reported).msg).toBe(
      'index sync: REPORT ONLY — nothing was built; set INDEX_SYNC_MODE=apply to build',
    );
  });
});

// The deploy step that builds every declared index (`db:sync-indexes`), against a real mongo.
//
// THE TRAP: in the test environment `autoIndex` is ON, so mongoose would build these indexes by
// itself and a test that only checked "the index exists" would be testing mongoose. Every model
// here is declared with `autoIndex: false` — the production setting — so whatever is on the
// server afterwards was put there by the sync, or was already there.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose, { Schema, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from '../../src/infrastructure/database/mongo';
import {
  DUPLICATE_KEY_REASON,
  SCAN_TIME_LIMIT_MS,
  syncDeclaredIndexes,
} from '../../src/shared/base/index-sync';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

beforeAll(async () => {
  await connectMongo(await resolveMongoUri());
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

let counter = 0;
/** A fresh collection and model per test, declared the way production runs: no auto-indexing. */
const declare = (build: (schema: Schema) => void, shared?: string): Model<never> => {
  counter += 1;
  const collection = shared ?? `index_sync_${process.pid}_${counter}`;
  const schema = new Schema(
    {
      email: String,
      userId: String,
      expiresAt: Date,
      status: String,
      isDeleted: Boolean,
      tags: [String],
    },
    { autoIndex: false, autoCreate: false },
  );
  build(schema);
  return mongoose.model(`IndexSync${process.pid}_${counter}`, schema, collection) as never;
};

const indexNames = async (model: Model<never>): Promise<string[]> => {
  try {
    return (await model.collection.listIndexes().toArray())
      .map((index) => String(index['name']))
      .sort();
  } catch {
    return [];
  }
};

interface SentCommand {
  commandName: string;
  command: Record<string, unknown>;
}

/**
 * Every command sent for one collection while `run` runs, as the driver puts it on the wire — so
 * a scan is seen however the code issues it. `connectMongo` turns command monitoring on.
 */
const commandsOn = async (collection: string, run: () => Promise<unknown>) => {
  const sent: SentCommand[] = [];
  const client = mongoose.connection.getClient();
  const listener = (event: SentCommand) => {
    if (event.command[event.commandName] === collection) sent.push(event);
  };
  client.on('commandStarted', listener);
  try {
    await run();
  } finally {
    client.off('commandStarted', listener);
  }
  return sent;
};

const scans = (sent: SentCommand[]) =>
  sent.filter((c) => c.commandName === 'aggregate' || c.commandName === 'find');

describe('report mode', () => {
  it('lists what is missing and builds nothing', async () => {
    const model = declare((schema) => {
      schema.index({ userId: 1 }, { name: 'ix_user' });
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
    });
    await model.collection.insertOne({ email: 'a@example.com', userId: 'u1' } as never);

    const report = await syncDeclaredIndexes('report', [model]);

    expect(report.missing.map((m) => m.index).sort()).toEqual(['ix_user', 'ux_email']);
    expect(report.built).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_']);
  });

  it('says how many documents a new TTL index would remove the moment it exists', async () => {
    const model = declare((schema) => {
      schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });
    });
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    await model.collection.insertMany([
      { expiresAt: past },
      { expiresAt: past },
      { expiresAt: future },
    ] as never);

    const report = await syncDeclaredIndexes('report', [model]);

    expect(report.missing).toEqual([
      expect.objectContaining({ index: 'ttl_expiresAt', ttl: { seconds: 0, wouldRemoveNow: 2 } }),
    ]);
    expect(await indexNames(model)).toEqual(['_id_']);
  });
});

describe('apply mode', () => {
  it('builds every missing index, and a second run finds them all present', async () => {
    const model = declare((schema) => {
      schema.index({ userId: 1 }, { name: 'ix_user' });
      schema.index(
        { email: 1 },
        { unique: true, partialFilterExpression: { isDeleted: false }, name: 'ux_email' },
      );
      schema.index({ status: 1, userId: -1 });
    });

    const first = await syncDeclaredIndexes('apply', [model]);
    expect(first.failed).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_', 'ix_user', 'status_1_userId_-1', 'ux_email']);

    const second = await syncDeclaredIndexes('apply', [model]);
    expect(second.missing).toEqual([]);
    expect(second.built).toEqual([]);
    expect(second.alreadyPresent).toBe(3);
  });

  it('builds the options the schema declares — a unique index that refuses a duplicate', async () => {
    const model = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
    });
    await syncDeclaredIndexes('apply', [model]);

    await model.collection.insertOne({ email: 'once@example.com' } as never);
    await expect(
      model.collection.insertOne({ email: 'once@example.com' } as never),
    ).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('leaves a unique index that existing rows violate unbuilt, names the rows, and never their values', async () => {
    const model = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });
    const inserted = await model.collection.insertMany([
      { email: 'twice@example.com', userId: 'u1' },
      { email: 'twice@example.com', userId: 'u2' },
      { email: 'single@example.com', userId: 'u3' },
    ] as never);

    const report = await syncDeclaredIndexes('apply', [model]);

    // The violated index is not built; the other one is — one bad index costs only itself.
    expect(await indexNames(model)).toEqual(['_id_', 'ix_user']);
    const blocked = report.missing.find((m) => m.index === 'ux_email');
    expect(blocked?.duplicateGroups).toBe(1);
    expect(blocked?.duplicateExampleIds?.[0]?.sort()).toEqual(
      [inserted.insertedIds[0], inserted.insertedIds[1]].map(String).sort(),
    );
    // The report goes to the deploy log; the duplicated value is personal data.
    expect(JSON.stringify(report)).not.toContain('twice@example.com');
  });

  it('never drops an index the schemas do not declare', async () => {
    const model = declare((schema) => {
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });
    await model.collection.createIndex({ status: 1 }, { name: 'ix_someone_elses' });

    await syncDeclaredIndexes('apply', [model]);

    expect(await indexNames(model)).toEqual(['_id_', 'ix_someone_elses', 'ix_user']);
  });

  it('records an index the server refuses and still builds the rest', async () => {
    // `$ne` is not allowed in a partial index — the shape of a real declaration in HR training.
    const model = declare((schema) => {
      schema.index(
        { userId: 1, status: 1 },
        {
          unique: true,
          partialFilterExpression: { status: { $ne: 'cancelled' } },
          name: 'ux_refused',
        },
      );
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });

    const report = await syncDeclaredIndexes('apply', [model]);

    expect(report.failed.map((f) => f.index)).toEqual(['ux_refused']);
    expect(await indexNames(model)).toEqual(['_id_', 'ix_user']);
  });

  it('builds the indexes of every model that shares a collection, counting a shared one once', async () => {
    const collection = `index_sync_shared_${process.pid}`;
    const first = declare((schema) => {
      schema.index({ userId: 1 }, { name: 'ix_user' });
    }, collection);
    const second = declare((schema) => {
      schema.index({ userId: 1 }, { name: 'ix_user' });
      schema.index({ status: 1 }, { name: 'ix_status' });
    }, collection);

    const report = await syncDeclaredIndexes('apply', [first, second]);

    expect(report.collections).toBe(1);
    expect(report.declared).toBe(2);
    expect(report.failed).toEqual([]);
    expect(await indexNames(first)).toEqual(['_id_', 'ix_status', 'ix_user']);
  });
});

describe('the duplicate check', () => {
  it('finds rows a compound unique index refuses when one stores null and another omits the field', async () => {
    // The index treats a missing field as null, so these two rows share a key. A plain group key
    // put them in different groups, and the report promised a build that then failed.
    const model = declare((schema) => {
      schema.index({ userId: 1, status: 1 }, { unique: true, name: 'ux_user_status' });
    });
    const inserted = await model.collection.insertMany([
      { userId: 'compound-secret', status: null },
      { userId: 'compound-secret' },
      { userId: 'compound-secret', status: 'active' },
    ] as never);
    const pair = [inserted.insertedIds[0], inserted.insertedIds[1]].map(String).sort();

    const reported = await syncDeclaredIndexes('report', [model]);
    const predicted = reported.missing.find((m) => m.index === 'ux_user_status');
    expect(predicted?.duplicateGroups).toBe(1);
    expect(predicted?.duplicateExampleIds?.[0]?.sort()).toEqual(pair);

    const applied = await syncDeclaredIndexes('apply', [model]);
    const blocked = applied.missing.find((m) => m.index === 'ux_user_status');
    expect(blocked?.duplicateGroups).toBe(1);
    expect(blocked?.duplicateExampleIds?.[0]?.sort()).toEqual(pair);
    expect(applied.failed).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_']);

    for (const report of [reported, applied]) {
      expect(JSON.stringify(report)).not.toContain('compound-secret');
    }
  });

  it('does not count rows that leave out every key of a sparse unique index as duplicates', async () => {
    // A sparse index skips such rows, so they cannot collide and the build succeeds.
    const model = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, sparse: true, name: 'ux_email_sparse' });
    });
    await model.collection.insertMany([
      { userId: 'a' },
      { userId: 'b' },
      { email: 'x@example.com' },
    ] as never);

    const reported = await syncDeclaredIndexes('report', [model]);
    // The scan ran and found nothing — it did not fail and land the index in `failed`.
    expect(reported.failed).toEqual([]);
    expect(reported.missing.find((m) => m.index === 'ux_email_sparse')?.duplicateGroups).toBe(
      undefined,
    );
    const applied = await syncDeclaredIndexes('apply', [model]);
    expect(applied.failed).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_', 'ux_email_sparse']);
  });

  it('still finds real duplicates of a sparse unique index next to rows that leave its key out', async () => {
    const model = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, sparse: true, name: 'ux_email_sparse' });
    });
    const inserted = await model.collection.insertMany([
      { userId: 'a' },
      { userId: 'b' },
      { email: 'twice@example.com' },
      { email: 'twice@example.com' },
    ] as never);

    const reported = await syncDeclaredIndexes('report', [model]);
    const predicted = reported.missing.find((m) => m.index === 'ux_email_sparse');
    expect(reported.failed).toEqual([]);
    expect(predicted?.duplicateGroups).toBe(1);
    expect(predicted?.duplicateExampleIds?.[0]?.sort()).toEqual(
      [inserted.insertedIds[2], inserted.insertedIds[3]].map(String).sort(),
    );
  });

  it('runs in report mode, with a time limit, counting rows without collecting every id', async () => {
    const model = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
    });
    await model.collection.insertMany([
      { email: 'twice@example.com' },
      { email: 'twice@example.com' },
    ] as never);

    let report: Awaited<ReturnType<typeof syncDeclaredIndexes>> | undefined;
    const sent = await commandsOn(model.collection.collectionName, async () => {
      report = await syncDeclaredIndexes('report', [model]);
    });

    expect(report?.missing[0]?.duplicateGroups).toBe(1);
    const scan = sent.find((c) => c.commandName === 'aggregate');
    expect(scan?.command).toMatchObject({ allowDiskUse: true, maxTimeMS: SCAN_TIME_LIMIT_MS });
    expect(JSON.stringify(scan?.command['pipeline'])).not.toContain('$push');
    // The follow-up finds that fetch the ids carry the same limit.
    const finds = sent.filter((c) => c.commandName === 'find');
    expect(finds.length).toBeGreaterThan(0);
    for (const find of finds) expect(find.command).toMatchObject({ maxTimeMS: SCAN_TIME_LIMIT_MS });
    expect(await indexNames(model)).toEqual(['_id_']);
  });

  it('puts the time limit on the count of rows a TTL index would remove', async () => {
    const model = declare((schema) => {
      schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });
    });
    await model.collection.insertOne({ expiresAt: new Date(Date.now() - 60_000) } as never);
    const sent = await commandsOn(model.collection.collectionName, () =>
      syncDeclaredIndexes('report', [model]),
    );
    // `countDocuments` is an aggregate on the wire.
    const count = sent.find((c) => c.commandName === 'aggregate');
    expect(count?.command).toMatchObject({ maxTimeMS: SCAN_TIME_LIMIT_MS });
  });

  it('builds a TTL index in apply mode even when counting what it would remove fails', async () => {
    const model = declare((schema) => {
      schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });
    });
    await model.collection.insertOne({ expiresAt: new Date(Date.now() - 60_000) } as never);
    const count = vi
      .spyOn(model.collection, 'countDocuments')
      .mockRejectedValue(Object.assign(new Error('operation exceeded time limit'), { code: 50 }));
    try {
      const applied = await syncDeclaredIndexes('apply', [model]);
      expect(applied.failed).toEqual([]);
      expect(applied.missing[0]?.ttl).toEqual({ seconds: 0, wouldRemoveNow: null });
      expect(await indexNames(model)).toEqual(['_id_', 'ttl_expiresAt']);
    } finally {
      count.mockRestore();
    }
  });

  it('does not run in apply mode unless the build is refused for a duplicate key', async () => {
    const clean = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
    });
    await clean.collection.insertMany([
      { email: 'a@example.com' },
      { email: 'b@example.com' },
    ] as never);
    const cleanSent = await commandsOn(clean.collection.collectionName, () =>
      syncDeclaredIndexes('apply', [clean]),
    );
    expect(scans(cleanSent)).toEqual([]);
    expect(await indexNames(clean)).toEqual(['_id_', 'ux_email']);

    const dirty = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
    });
    await dirty.collection.insertMany([
      { email: 'c@example.com' },
      { email: 'c@example.com' },
    ] as never);
    const dirtySent = await commandsOn(dirty.collection.collectionName, () =>
      syncDeclaredIndexes('apply', [dirty]),
    );
    expect(scans(dirtySent).length).toBeGreaterThan(0);
  });

  it('records a refusal it cannot attribute without quoting the key', async () => {
    // A unique index on an array field refuses two rows that share one element; grouping by the
    // whole array cannot see that, and the server's own message quotes the element.
    const model = declare((schema) => {
      schema.index({ tags: 1 }, { unique: true, name: 'ux_tags' });
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });
    await model.collection.insertMany([
      { tags: ['first', 'array-secret'] },
      { tags: ['array-secret', 'second'] },
    ] as never);

    const report = await syncDeclaredIndexes('apply', [model]);

    expect(report.failed).toEqual([
      {
        collection: model.collection.collectionName,
        index: 'ux_tags',
        reason: DUPLICATE_KEY_REASON,
      },
    ]);
    expect(await indexNames(model)).toEqual(['_id_', 'ix_user']);
    expect(JSON.stringify(report)).not.toContain('array-secret');
  });

  it('records a scan that runs out of time against its index, and goes on', async () => {
    const model = declare((schema) => {
      schema.index({ email: 1 }, { unique: true, name: 'ux_email' });
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });
    const timeout = Object.assign(new Error('operation exceeded time limit'), {
      code: 50,
      codeName: 'MaxTimeMSExpired',
    });
    const aggregate = vi
      .spyOn(model.collection, 'aggregate')
      .mockReturnValue({ toArray: () => Promise.reject(timeout) } as never);
    try {
      const report = await syncDeclaredIndexes('report', [model]);
      expect(report.failed).toEqual([
        {
          collection: model.collection.collectionName,
          index: 'ux_email',
          reason: 'MaxTimeMSExpired (50): operation exceeded time limit',
        },
      ]);
      expect(report.missing.map((m) => m.index)).toEqual(['ux_email', 'ix_user']);
    } finally {
      aggregate.mockRestore();
    }
  });
});

describe('indexes that cannot be built as declared', () => {
  it('reports a declaration whose keys are already indexed under another name, and leaves it', async () => {
    // A hand-built `{ expiresAt: 1 }` under MongoDB's default name: the server refuses the TTL
    // under the declared name with IndexOptionsConflict, on every deploy.
    const model = declare((schema) => {
      schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });
    });
    await model.collection.createIndex({ expiresAt: 1 }, { name: 'expiresAt_1' });
    const conflict = {
      collection: model.collection.collectionName,
      index: 'ttl_expiresAt',
      conflictsWith: 'expiresAt_1',
    };

    const reported = await syncDeclaredIndexes('report', [model]);
    expect(reported.conflicts).toEqual([conflict]);
    expect(reported.missing).toEqual([]);

    const applied = await syncDeclaredIndexes('apply', [model]);
    expect(applied.conflicts).toEqual([conflict]);
    expect(applied.failed).toEqual([]);
    expect(applied.built).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_', 'expiresAt_1']);
  });

  it('sees the same index under another name on a collection with a default collation', async () => {
    // Every index of such a collection inherits its collation, the one about to be built too, so
    // the server counts a hand-built twin as the same index and would refuse the declared one.
    const model = declare((schema) => {
      schema.index({ email: 1 }, { name: 'ix_email' });
    });
    await mongoose.connection.db?.createCollection(model.collection.collectionName, {
      collation: { locale: 'ar' },
    });
    await model.collection.createIndex({ email: 1 }, { name: 'email_1' });
    const conflict = {
      collection: model.collection.collectionName,
      index: 'ix_email',
      conflictsWith: 'email_1',
    };

    const reported = await syncDeclaredIndexes('report', [model]);
    expect(reported.conflicts).toEqual([conflict]);
    expect(reported.missing).toEqual([]);
    const applied = await syncDeclaredIndexes('apply', [model]);
    expect(applied.failed).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_', 'email_1']);
  });

  it('records a conflict the server reports at build time as a conflict, not a failure', async () => {
    // The check before the build cannot foresee every equivalence the server applies; when the
    // server says IndexOptionsConflict, the index is a conflict to resolve, not a failed build.
    const model = declare((schema) => {
      schema.index({ email: 1 }, { name: 'ix_email' });
    });
    const build = vi.spyOn(model.collection, 'createIndex').mockRejectedValue(
      Object.assign(new Error('Index already exists with a different name: email_1'), {
        code: 85,
        codeName: 'IndexOptionsConflict',
      }),
    );
    try {
      const applied = await syncDeclaredIndexes('apply', [model]);
      expect(applied.failed).toEqual([]);
      expect(applied.missing).toEqual([]);
      expect(applied.conflicts).toEqual([
        {
          collection: model.collection.collectionName,
          index: 'ix_email',
          conflictsWith: 'email_1',
        },
      ]);
    } finally {
      build.mockRestore();
    }
  });

  it('reports a name match whose definition differs as drifted, and never rebuilds it', async () => {
    const model = declare((schema) => {
      schema.index(
        { email: 1 },
        { unique: true, partialFilterExpression: { isDeleted: false }, name: 'ux_email' },
      );
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });
    await model.collection.createIndex({ email: 1 }, { name: 'ux_email' });
    await model.collection.createIndex({ userId: -1, status: 1 }, { name: 'ix_user' });
    const live = async () =>
      (await model.collection.listIndexes().toArray()).filter((index) => index['name'] !== '_id_');
    const before = await live();

    for (const mode of ['report', 'apply'] as const) {
      const report = await syncDeclaredIndexes(mode, [model]);
      expect(report.drifted).toEqual([
        {
          collection: model.collection.collectionName,
          index: 'ux_email',
          differs: ['unique', 'partialFilterExpression'],
        },
        { collection: model.collection.collectionName, index: 'ix_user', differs: ['key'] },
      ]);
      expect(report.alreadyPresent).toBe(0);
      expect(report.missing).toEqual([]);
      expect(report.failed).toEqual([]);
    }
    expect(await live()).toEqual(before);
  });

  it('skips a collection whose indexes cannot be read instead of taking them all for missing', async () => {
    const model = declare((schema) => {
      schema.index({ userId: 1 }, { name: 'ix_user' });
    });
    await model.collection.insertOne({ userId: 'u1' } as never);
    const refused = Object.assign(new Error('not authorized to execute listIndexes'), {
      code: 13,
      codeName: 'Unauthorized',
    });
    const listIndexes = vi
      .spyOn(model.collection, 'listIndexes')
      .mockReturnValue({ toArray: () => Promise.reject(refused) } as never);
    let report: Awaited<ReturnType<typeof syncDeclaredIndexes>>;
    try {
      report = await syncDeclaredIndexes('apply', [model]);
    } finally {
      listIndexes.mockRestore();
    }

    expect(report.failed).toEqual([
      {
        collection: model.collection.collectionName,
        reason: 'Unauthorized (13): not authorized to execute listIndexes',
      },
    ]);
    expect(report.declared).toBe(1);
    expect(report.missing).toEqual([]);
    expect(report.built).toEqual([]);
    expect(await indexNames(model)).toEqual(['_id_']);
  });
});

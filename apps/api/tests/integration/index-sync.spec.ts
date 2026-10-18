// The deploy step that builds every declared index (`db:sync-indexes`), against a real mongo.
//
// THE TRAP: in the test environment `autoIndex` is ON, so mongoose would build these indexes by
// itself and a test that only checked "the index exists" would be testing mongoose. Every model
// here is declared with `autoIndex: false` — the production setting — so whatever is on the
// server afterwards was put there by the sync, or was already there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Schema, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from '../../src/infrastructure/database/mongo';
import { syncDeclaredIndexes } from '../../src/shared/base/index-sync';

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
    { email: String, userId: String, expiresAt: Date, status: String, isDeleted: Boolean },
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

// The module's counter (design §2.3.1, §2.1 note 10): `administration_counters`, built with the
// shared factory, never copied; its upsert waits for `ux_counter_key`, so a failed build refuses
// the ensure and the next one builds again; and the number is taken inside the caller's session.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ClientSession } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdministrationCounterModel, ensureCounter, nextNumber } from './counter.model';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A query whose `.lean().exec()` (or `.exec()`) resolves to `value`. */
const query = (value: unknown) => {
  const q = { lean: () => q, exec: async () => value };
  return q;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('administration_counters', () => {
  it('is the shared factory’s model, in the module’s own collection', () => {
    expect(AdministrationCounterModel.modelName).toBe('AdministrationCounter');
    expect(AdministrationCounterModel.collection.collectionName).toBe('administration_counters');
    const source = readFileSync(join(HERE, 'counter.model.ts'), 'utf8');
    expect(source).toContain("from '../../../shared/base/counter'");
    expect(source).not.toMatch(/\$inc|\$max/);
  });

  it('ensures only once its unique key exists: a failed build refuses, the next one builds', async () => {
    const failed = new Error('index build failed');
    const build = vi
      .spyOn(AdministrationCounterModel, 'createIndexes')
      .mockRejectedValueOnce(failed)
      .mockResolvedValue(undefined as never);
    const upsert = vi
      .spyOn(AdministrationCounterModel, 'updateOne')
      .mockReturnValue(query({}) as never);

    await expect(ensureCounter('item:global', 7)).rejects.toBe(failed);
    expect(upsert, 'no counter written without its index').not.toHaveBeenCalled();

    await ensureCounter('item:global', 7);
    expect(build).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      { key: 'item:global' },
      { $max: { seq: 7 } },
      { upsert: true },
    );

    await ensureCounter('item:global', 8);
    expect(build, 'built once per process, then remembered').toHaveBeenCalledTimes(2);
  });

  it('takes the next number inside the caller’s session', async () => {
    const session = {} as ClientSession;
    const take = vi
      .spyOn(AdministrationCounterModel, 'findOneAndUpdate')
      .mockReturnValue(query({ key: 'item:global', seq: 12 }) as never);
    expect(await nextNumber('item:global', session)).toBe(12);
    expect(take).toHaveBeenCalledWith(
      { key: 'item:global' },
      { $inc: { seq: 1 } },
      { new: true, session },
    );
  });
});

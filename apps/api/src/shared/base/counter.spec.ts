// The counter factory (counter.ts), at the level that needs no database: the schema and its unique
// index, the floor `ensure` raises to and never below, a racing twin's duplicate key swallowed, the
// counter that is not there yet refused as a retryable conflict, and the preview's arithmetic.
import { type ClientSession } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../errors';
import { defineCounter } from './counter';

const counter = defineCounter('SharedCounterSpec', 'shared_counter_spec');
const session = {} as ClientSession;

/** A query whose `.lean().exec()` (or `.exec()`) resolves to `value`. */
const query = (value: unknown) => {
  const q = { lean: () => q, exec: async () => value };
  return q;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the collection', () => {
  it('is the one named, with a unique key index named ux_counter_key', () => {
    expect(counter.model.collection.collectionName).toBe('shared_counter_spec');
    expect(counter.model.schema.indexes()).toEqual([
      [{ key: 1 }, expect.objectContaining({ name: 'ux_counter_key', unique: true })],
    ]);
  });

  it('refuses a negative seq', () => {
    const doc = new counter.model({ key: 'k', seq: -1 });
    expect(doc.validateSync()?.errors.seq).toBeDefined();
  });
});

describe('ensure', () => {
  it('upserts with $max, so the counter is raised to the floor and never lowered', async () => {
    const updateOne = vi.spyOn(counter.model, 'updateOne').mockReturnValue(query({}) as never);
    await counter.ensure('item:global', 41.7);
    expect(updateOne).toHaveBeenCalledWith(
      { key: 'item:global' },
      { $max: { seq: 41 } },
      { upsert: true },
    );
    await counter.ensure('item:global', -3);
    expect(updateOne).toHaveBeenLastCalledWith(
      { key: 'item:global' },
      { $max: { seq: 0 } },
      { upsert: true },
    );
  });

  it("swallows a racing twin's duplicate key and rethrows anything else", async () => {
    const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
    const dupQuery = { exec: async () => Promise.reject(duplicate) };
    vi.spyOn(counter.model, 'updateOne').mockReturnValue(dupQuery as never);
    await expect(counter.ensure('k')).resolves.toBeUndefined();

    const other = { exec: async () => Promise.reject(new Error('down')) };
    vi.spyOn(counter.model, 'updateOne').mockReturnValue(other as never);
    await expect(counter.ensure('k')).rejects.toThrow('down');
  });
});

describe('next', () => {
  it('increments inside the caller session and answers the new number', async () => {
    const find = vi
      .spyOn(counter.model, 'findOneAndUpdate')
      .mockReturnValue(query({ key: 'k', seq: 8 }) as never);
    expect(await counter.next('k', session)).toBe(8);
    expect(find).toHaveBeenCalledWith({ key: 'k' }, { $inc: { seq: 1 } }, { new: true, session });
  });

  it('refuses with a conflict when the counter does not exist yet', async () => {
    vi.spyOn(counter.model, 'findOneAndUpdate').mockReturnValue(query(null) as never);
    await expect(counter.next('k', session)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('peek', () => {
  it('previews the next number, never below the floor', async () => {
    vi.spyOn(counter.model, 'findOne').mockReturnValue(query({ key: 'k', seq: 5 }) as never);
    expect(await counter.peek('k')).toBe(6);
    expect(await counter.peek('k', 10)).toBe(11);
    vi.spyOn(counter.model, 'findOne').mockReturnValue(query(null) as never);
    expect(await counter.peek('k')).toBe(1);
  });
});

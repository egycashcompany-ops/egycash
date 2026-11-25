// `collectionReady` (design §2.1 note 10, §15.3.2): the first write of a process builds the
// collection's indexes, every later write waits on that one build, and a build that fails refuses
// the write it was guarding and is forgotten, so the next write builds again rather than failing
// forever on an error that has since gone away.
import { describe, expect, it, vi } from 'vitest';
import { collectionReady } from './collection-ready';

/** A model whose index build the test settles by hand. */
const pendingModel = () => {
  const settles: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const createIndexes = vi.fn(
    () =>
      new Promise<unknown>((resolve, reject) => {
        settles.push({ resolve: () => resolve(undefined), reject });
      }),
  );
  return { createIndexes, settles };
};

describe('collectionReady', () => {
  it('builds once, and every caller waits on that one build', async () => {
    const model = pendingModel();
    const ready = collectionReady(model);
    let settled = 0;
    const first = ready().then(() => (settled += 1));
    const second = ready().then(() => (settled += 1));
    await Promise.resolve();
    expect(model.createIndexes).toHaveBeenCalledTimes(1);
    expect(settled, 'nobody writes before the build is done').toBe(0);

    model.settles[0]?.resolve();
    await Promise.all([first, second]);
    expect(settled).toBe(2);

    await ready();
    expect(model.createIndexes, 'a built collection is not built again').toHaveBeenCalledTimes(1);
  });

  it('a failed build throws — which refuses the write — and the next call builds again', async () => {
    const model = pendingModel();
    const ready = collectionReady(model);

    const refused = ready();
    model.settles[0]?.reject(new Error('E11000 while building ux_kind_name_key'));
    await expect(refused).rejects.toThrow('E11000');

    const retried = ready();
    expect(model.createIndexes, 'the failure was forgotten').toHaveBeenCalledTimes(2);
    model.settles[1]?.resolve();
    await expect(retried).resolves.toBeUndefined();
  });

  it('keeps one build per collection — two models never share one', async () => {
    const units = { createIndexes: vi.fn(async () => undefined) };
    const categories = { createIndexes: vi.fn(async () => undefined) };
    await collectionReady(units)();
    await collectionReady(categories)();
    expect(units.createIndexes).toHaveBeenCalledTimes(1);
    expect(categories.createIndexes).toHaveBeenCalledTimes(1);
  });
});

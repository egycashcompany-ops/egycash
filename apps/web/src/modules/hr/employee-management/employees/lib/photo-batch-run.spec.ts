import { describe, expect, it } from 'vitest';
import { runQueue } from './photo-batch-run';
import { fitsAsIs, PHOTO_MAX_BYTES, shrinkSize } from './photo-prepare';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('working through the photos', () => {
  it('never runs more than the lanes at once, and finishes every item', async () => {
    let now = 0;
    let most = 0;
    const done: number[] = [];
    await runQueue([1, 2, 3, 4, 5], async (n) => {
      now += 1;
      most = Math.max(most, now);
      await tick();
      done.push(n);
      now -= 1;
    });
    expect(most).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('one failure stops nothing else', async () => {
    const done: number[] = [];
    await runQueue([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('refused');
      done.push(n);
    });
    expect(done).toEqual([1, 3]);
  });

  it('a stop finishes the ones under way and starts no new one', async () => {
    let stop = false;
    const done: number[] = [];
    await runQueue(
      [1, 2, 3, 4, 5, 6],
      async (n) => {
        await tick();
        done.push(n);
        if (n === 2) stop = true;
      },
      { concurrency: 2, shouldStop: () => stop },
    );
    expect(done.length).toBeLessThan(6);
    expect(done).toContain(1);
    expect(done).toContain(2);
  });
});

describe('fitting a photo to the server', () => {
  it('sends a small JPEG, PNG or WebP as it is', () => {
    expect(fitsAsIs({ size: 1000, type: 'image/jpeg' })).toBe(true);
    expect(fitsAsIs({ size: PHOTO_MAX_BYTES + 1, type: 'image/jpeg' })).toBe(false);
    expect(fitsAsIs({ size: 1000, type: 'image/gif' })).toBe(false);
  });

  it('shrinks in the photo\'s own proportions, never enlarging', () => {
    expect(shrinkSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(shrinkSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(shrinkSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

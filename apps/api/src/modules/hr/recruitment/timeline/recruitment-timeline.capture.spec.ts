// I6 — the envelope's `produced` entries come from the ids reported into this scope. The
// properties that matter are: it collects only what happened INSIDE the scope, it survives awaits,
// concurrent scopes do not leak into each other, and outside a scope it does nothing.
import { describe, expect, it } from 'vitest';
import { captureTimelineEntries, noteTimelineEntry } from './recruitment-timeline.capture';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('recruitment timeline capture', () => {
  it('collects the entries written inside the scope, and returns the action result', async () => {
    const { result, entryIds } = await captureTimelineEntries(async () => {
      noteTimelineEntry('evt-1');
      await tick();
      noteTimelineEntry('evt-2');
      return 'done';
    });
    expect(result).toBe('done');
    expect(entryIds).toEqual(['evt-1', 'evt-2']);
  });

  it('does nothing outside a scope — sweeps and the worker write with nobody listening', () => {
    expect(() => noteTimelineEntry('evt-orphan')).not.toThrow();
  });

  it('never mixes two concurrent actions', async () => {
    // The whole reason for a scope rather than a "written since I started" query: two requests on
    // the same candidate must not claim each other's entries.
    const [a, b] = await Promise.all([
      captureTimelineEntries(async () => {
        noteTimelineEntry('a-1');
        await tick();
        noteTimelineEntry('a-2');
      }),
      captureTimelineEntries(async () => {
        noteTimelineEntry('b-1');
        await tick();
        noteTimelineEntry('b-2');
      }),
    ]);
    expect(a.entryIds).toEqual(['a-1', 'a-2']);
    expect(b.entryIds).toEqual(['b-1', 'b-2']);
  });

  it('bubbles a nested scope up, so a bulk run reports the whole batch', async () => {
    const { entryIds } = await captureTimelineEntries(async () => {
      noteTimelineEntry('outer');
      const inner = await captureTimelineEntries(async () => {
        noteTimelineEntry('item-1');
      });
      expect(inner.entryIds).toEqual(['item-1']);
    });
    expect(entryIds).toEqual(['outer', 'item-1']);
  });

  it('reports nothing for an action that wrote nothing', async () => {
    const { entryIds } = await captureTimelineEntries(async () => undefined);
    expect(entryIds).toEqual([]);
  });
});

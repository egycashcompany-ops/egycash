// I6 — the envelope's `produced` entries come from the ids the engine reports into this scope.
// The properties that matter are: it collects only what happened INSIDE the scope, it survives
// awaits, concurrent scopes do not leak into each other, and outside a scope it does nothing.
import { describe, expect, it } from 'vitest';
import { captureWorkflowEvents, noteWorkflowEvent } from './workflow-capture';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('workflow event capture', () => {
  it('collects the events published inside the scope, and returns the action result', async () => {
    const { result, eventIds } = await captureWorkflowEvents(async () => {
      noteWorkflowEvent('evt-1');
      await tick();
      noteWorkflowEvent('evt-2');
      return 'done';
    });
    expect(result).toBe('done');
    expect(eventIds).toEqual(['evt-1', 'evt-2']);
  });

  it('does nothing outside a scope — sweeps and the worker publish with nobody listening', () => {
    expect(() => noteWorkflowEvent('evt-orphan')).not.toThrow();
  });

  it('never mixes two concurrent actions', async () => {
    // The whole reason for a scope rather than a "written since I started" query: two requests on
    // the same candidate must not claim each other's entries.
    const [a, b] = await Promise.all([
      captureWorkflowEvents(async () => {
        noteWorkflowEvent('a-1');
        await tick();
        noteWorkflowEvent('a-2');
      }),
      captureWorkflowEvents(async () => {
        noteWorkflowEvent('b-1');
        await tick();
        noteWorkflowEvent('b-2');
      }),
    ]);
    expect(a.eventIds).toEqual(['a-1', 'a-2']);
    expect(b.eventIds).toEqual(['b-1', 'b-2']);
  });

  it('bubbles a nested scope up, so a bulk run reports the whole batch', async () => {
    const { eventIds } = await captureWorkflowEvents(async () => {
      noteWorkflowEvent('outer');
      const inner = await captureWorkflowEvents(async () => {
        noteWorkflowEvent('item-1');
      });
      expect(inner.eventIds).toEqual(['item-1']);
    });
    expect(eventIds).toEqual(['outer', 'item-1']);
  });

  it('reports nothing for an action that published nothing', async () => {
    const { eventIds } = await captureWorkflowEvents(async () => undefined);
    expect(eventIds).toEqual([]);
  });
});

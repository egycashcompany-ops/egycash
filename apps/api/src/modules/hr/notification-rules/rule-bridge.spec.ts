// What the bridge does when it CANNOT be served.
//
// This handler is attached to every cataloged event and dispatched un-awaited, so its cost when
// there is nothing to answer with is not a detail — it is multiplied by the platform's entire
// event volume. Mongoose does not fail a query on a disconnected connection: it BUFFERS it, for
// ten seconds, holding a timer that outlives whatever published the event. Attached to every
// event, a database blip becomes a queue of ten-second timers hanging off the bus.
//
// So the property under test is a duration, which is unusual and deliberate: "declines" and
// "declines immediately" are the same observable outcome — no notification — and only the second
// one is safe.
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { type EventEnvelope } from '@ecms/contracts';
import { handleRuleEvent } from './rule-bridge';

const envelope = (name: string): EventEnvelope =>
  ({
    id: 'evt-test',
    name,
    schemaVersion: 1,
    occurredAt: new Date(),
    payload: { employeeId: '0'.repeat(24) },
  }) as EventEnvelope;

describe('an event arriving with no database', () => {
  it('is declined at once, not buffered until Mongoose gives up', async () => {
    // 0 = disconnected. This is the state a test teardown, a restart or an outage produces.
    expect(mongoose.connection.readyState).toBe(0);

    const started = Date.now();
    await handleRuleEvent(envelope('hr.leave.decided'));
    const elapsed = Date.now() - started;

    // Mongoose's default `bufferTimeoutMS` is 10_000. Anything near that means the query was
    // buffered rather than declined — which is the defect, not a slow test.
    expect(elapsed).toBeLessThan(1_000);
  });

  it('never throws, whatever it decides — the event is still owed to its other consumers', async () => {
    // The bus dispatches this un-awaited with a `.catch`, and the reliable tier awaits it. A throw
    // from here travels into an event the rest of the platform is still delivering.
    await expect(handleRuleEvent(envelope('hr.contract.expired'))).resolves.toBeUndefined();
  });

  it('declines without reading the rules at all', async () => {
    // Not just "returns fast" — it must not reach the repository, because reaching it is what
    // creates the buffered query in the first place.
    const spy = vi.spyOn(mongoose.Model, 'find');
    await handleRuleEvent(envelope('hr.leave.requested'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

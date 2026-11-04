// The connection's telemetry, without a database: which collection a slow operation is charged to,
// and the boot's round-trip line — five pings that must never fail the boot or hold it up.
import { describe, expect, it } from 'vitest';
import { commandCollection, measureRoundTrips, roundTripSummary } from './mongo';

describe('the collection a slow operation is charged to', () => {
  it.each([
    ['find', { find: 'atm_replenishments', filter: {} }],
    ['aggregate', { aggregate: 'atm_replenishments', pipeline: [] }],
    ['count', { count: 'atm_replenishments', query: {} }],
    ['distinct', { distinct: 'atm_replenishments', key: 'branchId' }],
    ['insert', { insert: 'atm_replenishments', documents: [] }],
    ['update', { update: 'atm_replenishments', updates: [] }],
    ['delete', { delete: 'atm_replenishments', deletes: [] }],
    ['findAndModify', { findAndModify: 'atm_replenishments', query: {} }],
    ['createIndexes', { createIndexes: 'atm_replenishments', indexes: [] }],
    ['listIndexes', { listIndexes: 'atm_replenishments' }],
    ['dropIndexes', { dropIndexes: 'atm_replenishments', index: 'ix_old' }],
    ['drop', { drop: 'atm_replenishments' }],
  ])('reads %s from its own key', (name, command) => {
    expect(commandCollection(name, command)).toBe('atm_replenishments');
  });

  it("reads a cursor's next batch from its collection field", () => {
    expect(
      commandCollection('getMore', { getMore: 7_231_004_118n, collection: 'audit_logs' }),
    ).toBe('audit_logs');
  });

  it('names nothing for a command that touches no collection', () => {
    expect(commandCollection('ping', { ping: 1 })).toBeNull();
    expect(commandCollection('hello', { hello: 1 })).toBeNull();
    // `db.aggregate([...])` — a database-level pipeline ($currentOp and the like).
    expect(commandCollection('aggregate', { aggregate: 1, pipeline: [] })).toBeNull();
  });

  it('names nothing rather than guessing from a malformed or redacted command', () => {
    expect(commandCollection('find', undefined)).toBeNull();
    // The driver blanks the body of sensitive commands in the started event.
    expect(commandCollection('find', {})).toBeNull();
    expect(commandCollection('find', { find: '' })).toBeNull();
    expect(commandCollection('getMore', { getMore: 1 })).toBeNull();
  });
});

describe('the round trip measured at boot', () => {
  /** A clock that moves only when told — each ping takes exactly the time its caller says. */
  const fakeClock = () => {
    let at = 0;
    return { now: () => at, advance: (ms: number) => void (at += ms) };
  };

  it('takes five sequential samples, each one round trip', async () => {
    const clock = fakeClock();
    const durations = [40, 2, 3, 2, 4];
    let inFlight = 0;
    let maxInFlight = 0;
    const ping = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      clock.advance(durations.shift() ?? 0);
      inFlight -= 1;
    };

    const result = await measureRoundTrips(ping, { now: clock.now });

    expect(result).toEqual({ samplesMs: [40, 2, 3, 2, 4], stopped: null });
    expect(maxInFlight).toBe(1);
  });

  it('stops at the first failed ping and keeps what it had, without throwing', async () => {
    let calls = 0;
    const ping = async (): Promise<void> => {
      calls += 1;
      if (calls === 3) throw new Error('connection reset');
    };

    const result = await measureRoundTrips(ping);

    expect(result.stopped).toBe('failed');
    expect(result.samplesMs).toHaveLength(2);
    expect(calls).toBe(3);
  });

  it('survives a ping that throws before it returns a promise', async () => {
    const ping = (): Promise<void> => {
      throw new Error('no connection');
    };
    await expect(measureRoundTrips(ping)).resolves.toEqual({ samplesMs: [], stopped: 'failed' });
  });

  it('gives up a ping that never answers once the budget is spent — the boot is not held', async () => {
    const started = Date.now();
    const result = await measureRoundTrips(() => new Promise(() => undefined), { budgetMs: 30 });

    expect(result).toEqual({ samplesMs: [], stopped: 'budget' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('starts no further ping once the budget is gone', async () => {
    const clock = fakeClock();
    let calls = 0;
    const ping = async (): Promise<void> => {
      calls += 1;
      clock.advance(600);
    };

    const result = await measureRoundTrips(ping, { now: clock.now, budgetMs: 1_000 });

    expect(result).toEqual({ samplesMs: [600, 600], stopped: 'budget' });
    expect(calls).toBe(2);
  });
});

describe('the round-trip line', () => {
  it('reports the median and the fastest, to a tenth of a millisecond', () => {
    // The first ping opened the connection; the median does not let it speak for the rest.
    expect(roundTripSummary([41.27, 1.84, 2.31, 1.96, 2.12])).toEqual({
      medianMs: 2.1,
      minMs: 1.8,
    });
  });

  it('takes the middle pair of an even count', () => {
    expect(roundTripSummary([4, 1, 3, 2])).toEqual({ medianMs: 2.5, minMs: 1 });
  });

  it('has nothing to say with no samples', () => {
    expect(roundTripSummary([])).toBeNull();
  });
});

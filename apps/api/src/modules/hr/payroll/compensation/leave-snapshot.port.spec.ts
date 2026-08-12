// The port's one judgement call: whose answer is the period's? (PY-5)
//
// A period can carry several runs over its life — a draft that was abandoned, a cancelled one, and
// the frozen one that actually pinned it — and only the last of those has a snapshot worth
// pricing. Everything else must read as "no run has settled this yet", which is a different answer
// from "no leave was taken" and produces an entirely different line.
//
// The models are mocked rather than driven through a database, because what is pinned here is the
// DECISION, not the query.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RunRow {
  _id: string;
  frozenAt: Date | null;
  updatedAt: Date;
}
interface SnapshotRow {
  typeCode: string;
  days: number;
  breakdown: { days: number; payRate: number }[];
}

const findRun = vi.fn<() => Promise<RunRow | null>>();
const findSnapshots = vi.fn<() => Promise<SnapshotRow[]>>();

/** The two `.find()/.findOne()` chains, shortened to the shape the port actually walks. */
const chain = <T>(resolve: () => Promise<T>) => ({
  sort: () => chain(resolve),
  lean: () => chain(resolve),
  exec: resolve,
});

vi.mock('../runs/payroll-run.model', () => ({
  PayrollRunModel: { findOne: () => chain(findRun) },
}));
vi.mock('../runs/payroll-leave-snapshot.model', () => ({
  PayrollLeaveSnapshotModel: { find: () => chain(findSnapshots) },
}));

const { leaveSnapshotPort } = await import('./leave-snapshot.port');

const EMPLOYEE = '000000000000000000000001';
const FROZEN_AT = new Date('2026-04-01T09:00:00.000Z');

beforeEach(() => {
  findRun.mockReset();
  findSnapshots.mockReset();
});

describe('reading a period’s pinned leave', () => {
  it('answers null when no run has frozen the period', async () => {
    findRun.mockResolvedValue(null);
    expect(await leaveSnapshotPort.frozenFor('2026-03', EMPLOYEE)).toBeNull();
    // …and does not go looking for rows it has no run to key by.
    expect(findSnapshots).not.toHaveBeenCalled();
  });

  it('returns an EMPTY slice list for an employee with no leave in a frozen period', async () => {
    findRun.mockResolvedValue({ _id: 'run1', frozenAt: FROZEN_AT, updatedAt: FROZEN_AT });
    findSnapshots.mockResolvedValue([]);
    const result = await leaveSnapshotPort.frozenFor('2026-03', EMPLOYEE);
    // The distinction the whole design rests on: this is a real zero, not an unasked question.
    expect(result).not.toBeNull();
    expect(result?.slices).toEqual([]);
    expect(result?.runId).toBe('run1');
  });

  it('carries each slice’s days and pay split through untouched', async () => {
    findRun.mockResolvedValue({ _id: 'run1', frozenAt: FROZEN_AT, updatedAt: FROZEN_AT });
    findSnapshots.mockResolvedValue([
      { typeCode: 'SICK', days: 10, breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }] },
    ]);
    const result = await leaveSnapshotPort.frozenFor('2026-03', EMPLOYEE);
    expect(result?.slices).toEqual([
      { typeCode: 'SICK', days: 10, breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }] },
    ]);
  });

  it('stamps the answer with the RUN’s freeze time, not each row’s', async () => {
    findRun.mockResolvedValue({ _id: 'run1', frozenAt: FROZEN_AT, updatedAt: new Date('2026-05-01') });
    findSnapshots.mockResolvedValue([]);
    const result = await leaveSnapshotPort.frozenFor('2026-03', EMPLOYEE);
    expect(result?.snapshotAt).toBe('2026-04-01T09:00:00.000Z');
  });

  it('asks only for FROZEN runs — a draft has written no rows and a cancelled one is not the answer', () => {
    // Read from the source rather than the mock: the filter is the decision, and a mock that
    // returns whatever it is given cannot hold anyone to it.
    const text = readFileSync(fileURLToPath(new URL('./leave-snapshot.port.ts', import.meta.url)), 'utf8');
    expect(text).toContain("status: 'frozen'");
  });
});

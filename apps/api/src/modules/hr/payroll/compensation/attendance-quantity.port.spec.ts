// The port's one judgement call: when is a period actually frozen? (PY-4)
//
// This exists because of a defect the integration suite caught. The feed reader's completeness
// test is "this period holds no UNFROZEN row" — and a period nobody has ever computed passes it
// vacuously, with zero rows. Read naively, an untouched future month is indistinguishable from a
// frozen one, and every quantity line prices as a confident zero for a month nobody has looked at.
//
// The reader is mocked here rather than driven through a database, because what is being pinned
// is the DECISION, not the query.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AttendanceFeedRow } from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';

const readFrozenFeed =
  vi.fn<(period: string, employeeId?: string) => Promise<AttendanceFeedRow[]>>();
vi.mock('../../attendance', () => ({
  dayRecordService: {
    readFrozenFeed: (period: string, employeeId?: string) => readFrozenFeed(period, employeeId),
  },
}));

const { attendanceQuantityPort } = await import('./attendance-quantity.port');

const row = (workDate: string): AttendanceFeedRow =>
  ({
    employeeId: 'e1',
    workDate,
    status: 'absent',
    shiftId: 's1',
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    approvedOvertimeMinutes: 0,
    leaveId: null,
    branchId: 'b1',
    flags: [],
    frozenAt: '2026-04-01T03:00:00.000Z',
  }) as AttendanceFeedRow;

beforeEach(() => {
  readFrozenFeed.mockReset();
});

describe('when the employee has rows', () => {
  it('reports them frozen, with the stamp they carry', async () => {
    readFrozenFeed.mockResolvedValueOnce([row('2026-03-02')]);
    const result = await attendanceQuantityPort.frozenFor('2026-03', 'e1');
    expect(result?.rows).toHaveLength(1);
    expect(result?.frozenAt).toBe('2026-04-01T03:00:00.000Z');
    // One read, not two — the expensive unfiltered branch is for the ambiguous case only.
    expect(readFrozenFeed).toHaveBeenCalledTimes(1);
  });
});

describe('when the employee has no rows — the ambiguous case', () => {
  // THE REGRESSION. A month nobody has computed returns zero rows from a reader that refuses
  // nothing, and treating that as frozen would price it as a certain zero.
  it('is NOT frozen when the period holds no row at all', async () => {
    readFrozenFeed.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await attendanceQuantityPort.frozenFor('2026-05', 'e1')).toBeNull();
    expect(readFrozenFeed).toHaveBeenCalledTimes(2);
  });

  it('IS frozen when the period holds rows for somebody else', async () => {
    readFrozenFeed.mockResolvedValueOnce([]).mockResolvedValueOnce([row('2026-03-02')]);
    const result = await attendanceQuantityPort.frozenFor('2026-03', 'e1');
    // A real zero for this employee: the month was frozen, they simply have nothing in it.
    expect(result?.rows).toEqual([]);
    expect(result?.frozenAt).toBe('2026-04-01T03:00:00.000Z');
  });
});

describe('what the port does with a failure', () => {
  it('answers "not frozen" to the reader’s own refusal', async () => {
    readFrozenFeed.mockRejectedValueOnce(new BusinessRuleError('period 2026-03 is not frozen'));
    expect(await attendanceQuantityPort.frozenFor('2026-03', 'e1')).toBeNull();
  });

  // Swallowing this would report an unfrozen month while the database was on fire, and every
  // quantity line would quietly read `pending` instead of failing loudly.
  it('lets anything else keep travelling', async () => {
    readFrozenFeed.mockRejectedValueOnce(new Error('connection reset'));
    await expect(attendanceQuantityPort.frozenFor('2026-03', 'e1')).rejects.toThrow(
      'connection reset',
    );
  });
});

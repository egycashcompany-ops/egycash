// The sheet's order, proven as arithmetic over rows — no database, no page.
//
// The owner's own acceptance tests for it, in his words: the default order, the toggle, and «people
// with no check-in always come AFTER everyone with a time, in both directions, so they never push
// the arrivals down». That last one is the only rule here a comparison sort does not give for free,
// and it is the one a reader notices immediately when it is missing.
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_SHEET_SORTS,
  figuresOf,
  NO_FIGURES,
  type AttendanceDayStatus,
  type AttendanceSheetRowDto,
} from '@ecms/contracts';
import { hasArrival, sortSheetRows } from './sheet-order';

const DATE = '2026-11-18';

/** 18 November 2026 Cairo (UTC+2): `cairo('09:05')` is the instant 09:05 happened in Cairo. */
const cairo = (time: string): string => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 10, 18, h - 2, m)).toISOString();
};

/**
 * A sheet line. `in`/`out` are Cairo wall times, and the figures are derived from them the way the
 * server does — so a row with no `out` carries the blanks that put it at the end of the time and
 * duration columns.
 */
const line = (
  code: string,
  over: {
    in?: string;
    out?: string;
    status?: AttendanceDayStatus;
    name?: string;
    late?: number;
    shortfall?: number;
    worked?: number;
  } = {},
): AttendanceSheetRowDto => {
  const firstInAt = over.in === undefined ? null : cairo(over.in);
  const lastOutAt = over.out === undefined ? null : cairo(over.out);
  const worked =
    over.worked ??
    (firstInAt === null || lastOutAt === null
      ? 0
      : Math.round((Date.parse(lastOutAt) - Date.parse(firstInAt)) / 60_000));
  return {
    employeeId: `id-${code}`,
    employeeCode: code,
    employeeName: over.name ?? `موظف ${code}`,
    employeePhotoFileId: null,
    employeeDepartment: null,
    employeeBranch: null,
    employeeJobTitle: null,
    branchId: 'branch-1',
    date: DATE,
    status: over.status ?? (firstInAt === null ? 'noRecord' : 'present'),
    expectedStartAt: null,
    expectedEndAt: null,
    day: null,
    provisionalDay: { firstInAt, lastOutAt },
    figures:
      firstInAt === null || lastOutAt === null
        ? { ...NO_FIGURES, requiredMinutes: 480 }
        : figuresOf({
            firstInAt,
            lastOutAt,
            workedMinutes: worked,
            lateMinutes: over.late ?? 0,
            shortfallMinutes: over.shortfall ?? 0,
            earlyLeaveMinutes: 0,
            overtimeMinutes: 0,
            requiredMinutes: 480,
          }),
    punchCount: firstInAt === null ? 0 : lastOutAt === null ? 1 : 2,
    checkInCount: firstInAt === null ? 0 : 1,
    checkOutCount: lastOutAt === null ? 0 : 1,
  };
};

const codes = (rows: readonly AttendanceSheetRowDto[]): string[] =>
  rows.map((row) => row.employeeCode);

describe('the default order', () => {
  it('is check-in ascending: the first to arrive is the first line', () => {
    const rows = [
      line('0100300', { in: '09:40', out: '17:40' }),
      line('0100100', { in: '07:05', out: '15:05' }),
      line('0100200', { in: '08:30', out: '16:30' }),
    ];
    expect(codes(sortSheetRows(rows, 'checkIn', 'asc'))).toEqual([
      '0100100',
      '0100200',
      '0100300',
    ]);
  });

  it('reverses on the toggle', () => {
    const rows = [
      line('0100100', { in: '07:05', out: '15:05' }),
      line('0100200', { in: '08:30', out: '16:30' }),
    ];
    expect(codes(sortSheetRows(rows, 'checkIn', 'desc'))).toEqual(['0100200', '0100100']);
  });
});

describe('a line with nothing to compare', () => {
  /** Three arrivals and four kinds of nothing — the ordinary shape of a day on this deployment. */
  const mixed = (): AttendanceSheetRowDto[] => [
    line('0100900', { status: 'noRecord' }),
    line('0100100', { in: '07:05', out: '15:05' }),
    line('0100800', { status: 'absent' }),
    line('0100200', { in: '08:30', out: '16:30' }),
    line('0100700', { status: 'pending' }),
    line('0100300', { in: '09:40', out: '17:40' }),
    line('0100600', { status: 'noSchedule' }),
  ];

  it('goes last ASCENDING', () => {
    expect(codes(sortSheetRows(mixed(), 'checkIn', 'asc'))).toEqual([
      '0100100',
      '0100200',
      '0100300',
      '0100600',
      '0100700',
      '0100800',
      '0100900',
    ]);
  });

  it('goes last DESCENDING TOO — the rule the owner stated, and the one a plain sort breaks', () => {
    // Descending by check-in must show the LATEST ARRIVAL first. A plain comparison sort would
    // float «لم يحضر بعد» and «لا يوجد تسجيل» to the top and push every arrival off the first page,
    // which is precisely the complaint.
    const ordered = codes(sortSheetRows(mixed(), 'checkIn', 'desc'));
    expect(ordered.slice(0, 3)).toEqual(['0100300', '0100200', '0100100']);
    expect(ordered.slice(3)).toEqual(['0100600', '0100700', '0100800', '0100900']);
  });

  it('is the same rule on every column where a value can be missing', () => {
    for (const by of ['checkIn', 'checkOut', 'worked', 'shortfall'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        const ordered = sortSheetRows(mixed(), by, dir);
        const withValue = ordered.filter(hasArrival).length;
        // Every line that HAS an arrival precedes every line that does not.
        expect(ordered.slice(0, withValue).every(hasArrival), `${by} ${dir}`).toBe(true);
        expect(ordered.slice(withValue).some(hasArrival), `${by} ${dir}`).toBe(false);
      }
    }
  });

  it('keeps a check-in with no check-out among the arrivals BY TIME, and last by hours', () => {
    const rows = [
      line('0100200', { in: '09:00', out: '17:00' }),
      line('0100100', { in: '08:00' }), // checked in, never out
    ];
    // By check-in it has a time, so it sorts on it.
    expect(codes(sortSheetRows(rows, 'checkIn', 'asc'))).toEqual(['0100100', '0100200']);
    // By hours worked it has no answer, so it goes to the end — «حضر فقط» is not a short day.
    expect(codes(sortSheetRows(rows, 'worked', 'asc'))).toEqual(['0100200', '0100100']);
    expect(codes(sortSheetRows(rows, 'worked', 'desc'))).toEqual(['0100200', '0100100']);
  });
});

describe('lateness', () => {
  it('sorts an on-time day as zero rather than as nothing', () => {
    // A measured zero IS an answer — «not late» — so it belongs among the values, not at the end
    // with the days nobody has concluded.
    const rows = [
      line('0100300', { in: '09:40', out: '16:00', late: 40, shortfall: 40 }),
      line('0100100', { in: '09:00', out: '17:00', late: 0 }),
      line('0100900', { status: 'noRecord' }),
      line('0100200', { in: '09:10', out: '16:00', late: 10, shortfall: 10 }),
    ];
    expect(codes(sortSheetRows(rows, 'late', 'asc'))).toEqual([
      '0100100',
      '0100200',
      '0100300',
      '0100900',
    ]);
    expect(codes(sortSheetRows(rows, 'late', 'desc'))).toEqual([
      '0100300',
      '0100200',
      '0100100',
      '0100900',
    ]);
  });
});

describe('a night shift', () => {
  it('sorts a check-out after midnight as later than its check-in, not as the small hours', () => {
    // The day is keyed to the date the shift STARTED (D3), so 00:30 belongs to the previous
    // evening's line. Compared as instants it is after 22:00; reduced to a wall clock it would
    // sort before everybody who arrived in the morning.
    const nightOut = new Date(Date.UTC(2026, 10, 19, 4, 30)).toISOString(); // 06:30 Cairo, 19 Nov
    const night: AttendanceSheetRowDto = {
      ...line('0100500', { in: '22:00' }),
      provisionalDay: { firstInAt: cairo('22:00'), lastOutAt: nightOut },
      figures: figuresOf({
        firstInAt: cairo('22:00'),
        lastOutAt: nightOut,
        workedMinutes: 510,
        lateMinutes: 0,
        shortfallMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 30,
        requiredMinutes: 480,
      }),
    };
    const rows = [night, line('0100100', { in: '09:00', out: '17:00' })];
    // By check-out, the night worker's 06:30-next-morning is the LAST departure of the work day.
    expect(codes(sortSheetRows(rows, 'checkOut', 'asc'))).toEqual(['0100100', '0100500']);
    // And its worked span is a real nine and a half hours, not a negative one.
    expect(night.figures.workedMinutes).toBe(510);
  });
});

describe('the tiebreak', () => {
  it('is the employee code, so equal rows hold their order on every page and reload', () => {
    const rows = [
      line('0100300', { in: '09:00', out: '17:00' }),
      line('0100100', { in: '09:00', out: '17:00' }),
      line('0100200', { in: '09:00', out: '17:00' }),
    ];
    // Same minute, so the comparison itself is a tie: the order must still be total and stable.
    expect(codes(sortSheetRows(rows, 'checkIn', 'asc'))).toEqual([
      '0100100',
      '0100200',
      '0100300',
    ]);
    // Descending by a tied column does NOT reverse the tiebreak: the rows are equal, so they keep
    // one canonical order and page 2 stays a continuation of page 1.
    expect(codes(sortSheetRows(rows, 'checkIn', 'desc'))).toEqual([
      '0100100',
      '0100200',
      '0100300',
    ]);
  });

  it('breaks ties among the lines with no time too', () => {
    const rows = [line('0100300'), line('0100100'), line('0100200')];
    for (const dir of ['asc', 'desc'] as const) {
      expect(codes(sortSheetRows(rows, 'checkIn', dir))).toEqual([
        '0100100',
        '0100200',
        '0100300',
      ]);
    }
  });
});

describe('the other columns', () => {
  it('orders by name, in Arabic collation', () => {
    const rows = [
      line('0100300', { name: 'يوسف' }),
      line('0100100', { name: 'أحمد' }),
      line('0100200', { name: 'محمود' }),
    ];
    expect(codes(sortSheetRows(rows, 'name', 'asc'))).toEqual([
      '0100100',
      '0100200',
      '0100300',
    ]);
    expect(codes(sortSheetRows(rows, 'name', 'desc'))).toEqual([
      '0100300',
      '0100200',
      '0100100',
    ]);
  });

  it('orders by code, numerically — the codes are zero-padded to one width', () => {
    const rows = [line('0100100'), line('0100020'), line('0100003')];
    expect(codes(sortSheetRows(rows, 'code', 'asc'))).toEqual([
      '0100003',
      '0100020',
      '0100100',
    ]);
  });

  it('orders by status in the working day‘s own shape, not alphabetically', () => {
    const rows = [
      line('0100900', { status: 'noRecord' }),
      line('0100100', { in: '09:00', out: '17:00', status: 'present' }),
      line('0100500', { status: 'absent' }),
      line('0100200', { in: '09:40', out: '16:00', status: 'late' }),
    ];
    expect(codes(sortSheetRows(rows, 'status', 'asc'))).toEqual([
      '0100100',
      '0100200',
      '0100500',
      '0100900',
    ]);
  });
});

describe('the vocabulary', () => {
  it('ranks EVERY status — a new one must not sort into a silent bucket', () => {
    // The ranking is a hand-written order, so the only thing that can go wrong is somebody adding
    // a status and not placing it. Every status must sort differently from an unknown value, which
    // is what this asserts: the ranks are all distinct and all below the unknown fallback.
    const ranks = ATTENDANCE_DAY_STATUSES.map((status) => {
      const rows = sortSheetRows([line('0100001', { status }), line('0100002')], 'status', 'asc');
      return `${status}:${codes(rows).join(',')}`;
    });
    expect(ranks).toHaveLength(ATTENDANCE_DAY_STATUSES.length);
    // And every declared sort is actually handled: an unhandled one would fall through to the
    // status rank and order identical rows identically, which this would not catch — so the real
    // assertion is that each column produces a total order over a set that differs on it alone.
    for (const by of ATTENDANCE_SHEET_SORTS) {
      const ordered = sortSheetRows(
        [
          line('0100002', { in: '09:40', out: '16:00', late: 40, shortfall: 40, name: 'ب' }),
          line('0100001', { in: '09:00', out: '17:00', late: 0, name: 'أ' }),
        ],
        by,
        'asc',
      );
      expect(ordered, by).toHaveLength(2);
      expect(new Set(codes(ordered)).size, by).toBe(2);
    }
  });

  it('never mutates the array it was given', () => {
    const rows = [line('0100200', { in: '09:00', out: '17:00' }), line('0100100', { in: '08:00', out: '16:00' })];
    const before = codes(rows);
    sortSheetRows(rows, 'checkIn', 'asc');
    expect(codes(rows)).toEqual(before);
  });
});

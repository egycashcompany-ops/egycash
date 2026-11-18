// The report layout, proven without a server — it is a pure function from a resolved day to cells.
//
// These are the owner's own acceptance tests for the file he could not use, in his order: the
// columns and their headers in both languages, the times present and on a twelve-hour clock, the
// durations as h:mm, and the «present but zero worked» case reported as a blank.
//
// The last block is the one that earns its keep over time: it reads the WEB catalogue and asserts
// that the status words in the file are the status words on the screen, character for character.
// That is the guard that stops «the same label the screen shows» from quietly becoming «a label
// somebody once copied from the screen».
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_DISPLAY_LABELS,
  ATTENDANCE_DISPLAY_STATUSES,
  displayStatusOf,
  figuresOf,
  NO_FIGURES,
  type AttendanceDayStatus,
} from '@ecms/contracts';
import {
  ATTENDANCE_REPORT_COLUMNS,
  asClockTime,
  csvCell,
  asHoursMinutes,
  asReadableDate,
  reportCells,
  reportHeaders,
  reportNotes,
  statusLabel,
  type ReportRow,
} from './attendance-report';

/** 18 November 2026, Cairo standard time (UTC+2) — the owner's own export date. */
const cairo = (time: string): string => `2026-11-18T${time}:00.000Z`;

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  employeeCode: '0100052',
  employeeName: 'محمد أحمد علي',
  branch: { ar: 'المهندسين', en: 'Mohandessin' },
  department: { ar: 'الأمن', en: 'Security' },
  jobTitle: { ar: 'فرد أمن', en: 'Security guard' },
  date: '2026-11-18',
  status: 'present',
  firstInAt: cairo('07:05'), // 09:05 Cairo
  lastOutAt: cairo('15:10'), // 17:10 Cairo
  figures: figuresOf({
    firstInAt: cairo('07:05'),
    lastOutAt: cairo('15:10'),
    workedMinutes: 485,
    lateMinutes: 0,
    shortfallMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 5,
    requiredMinutes: 480,
  }),
  approvedOvertimeMinutes: 0,
  punchCount: 2,
  flags: [],
  frozen: false,
  provisional: false,
  ...over,
});

describe('the columns', () => {
  it('are the eighteen the owner asked for, in his order', () => {
    expect(ATTENDANCE_REPORT_COLUMNS.map((column) => column.key)).toEqual([
      'code',
      'name',
      'branch',
      'department',
      'jobTitle',
      'date',
      'status',
      'checkIn',
      'checkOut',
      'worked',
      'required',
      'late',
      'shortfall',
      'earlyLeave',
      'overtime',
      'approvedOvertime',
      'punches',
      'notes',
    ]);
  });

  it('carry headers in the reader‘s language, and a row of cells for every one', () => {
    expect(reportHeaders('ar').slice(0, 7)).toEqual([
      'كود الموظف',
      'الاسم',
      'الفرع',
      'القسم',
      'الوظيفة',
      'التاريخ',
      'الحالة',
    ]);
    expect(reportHeaders('ar')).toHaveLength(ATTENDANCE_REPORT_COLUMNS.length);
    expect(reportHeaders('en')[0]).toBe('Employee code');
    // The row must stay the same width as the header, in both languages — a file whose cells and
    // headers drift apart silently shifts every column after the drift.
    expect(reportCells(row(), 'ar')).toHaveLength(reportHeaders('ar').length);
    expect(reportCells(row(), 'en')).toHaveLength(reportHeaders('en').length);
  });

  it('name the branch, department and job title in the reader‘s language', () => {
    expect(reportCells(row(), 'ar').slice(2, 5)).toEqual(['المهندسين', 'الأمن', 'فرد أمن']);
    expect(reportCells(row(), 'en').slice(2, 5)).toEqual([
      'Mohandessin',
      'Security',
      'Security guard',
    ]);
    // An employee with no placement reads blank, not «null» and not a dash.
    expect(
      reportCells(row({ branch: null, department: null, jobTitle: null }), 'ar').slice(2, 5),
    ).toEqual(['', '', '']);
  });
});

describe('the formats', () => {
  it('writes a duration as h:mm and never as minutes', () => {
    expect(asHoursMinutes(485)).toBe('8:05');
    expect(asHoursMinutes(60)).toBe('1:00');
    expect(asHoursMinutes(5)).toBe('0:05');
    // Over twenty-four hours stays an hour count rather than rolling over — a night shift's span
    // is a duration, not a time of day.
    expect(asHoursMinutes(1_500)).toBe('25:00');
  });

  it('leaves an unmeasured duration blank, and a measured zero blank only where asked', () => {
    expect(asHoursMinutes(null)).toBe('');
    expect(asHoursMinutes(null, true)).toBe('');
    // The measurement columns print a real zero; the exception columns do not.
    expect(asHoursMinutes(0)).toBe('0:00');
    expect(asHoursMinutes(0, true)).toBe('');
  });

  it('writes a time on a twelve-hour Cairo clock, in Western digits', () => {
    expect(asClockTime(cairo('07:05'), 'en')).toBe('9:05 am');
    expect(asClockTime(cairo('15:10'), 'en')).toBe('5:10 pm');
    // Arabic keeps its ص / م marker and loses its Arabic-Indic digits: a spreadsheet column of
    // «٩:٠٥» cannot be read at a glance beside one of «9:05».
    expect(asClockTime(cairo('07:05'), 'ar')).toBe('9:05 ص');
    expect(asClockTime(cairo('15:10'), 'ar')).toBe('5:10 م');
    expect(asClockTime(null, 'ar')).toBe('');
  });

  it('writes the date as dd/mm/yyyy', () => {
    expect(asReadableDate('2026-11-18')).toBe('18/11/2026');
    expect(asReadableDate('2026-01-05')).toBe('05/01/2026');
  });
});

describe('a day with no check-out', () => {
  /** The shape of the owner's five «present, 0 worked» rows, after the rule. */
  const checkedIn = row({
    status: 'checkedIn',
    firstInAt: cairo('07:05'),
    lastOutAt: null,
    figures: { ...NO_FIGURES, requiredMinutes: 480 },
    punchCount: 1,
  });

  it('says «حضر فقط» and leaves every figure empty', () => {
    const cells = reportCells(checkedIn, 'ar');
    expect(cells[6]).toBe('حضر فقط');
    expect(cells[7]).toBe('9:05 ص');
    expect(cells[8]).toBe(''); // no check-out
    expect(cells[9]).toBe(''); // worked — NOT «0:00», which is the whole complaint
    expect(cells[10]).toBe('8:00'); // what the day required is still known
    expect(cells.slice(11, 16)).toEqual(['', '', '', '', '']);
  });

  it('says why in words, in the notes column', () => {
    expect(reportNotes(checkedIn, 'ar')).toBe('لا يوجد انصراف');
    expect(reportNotes(checkedIn, 'en')).toBe('Check-out missing');
  });
});

describe('the notes', () => {
  it('are sentences, not flag codes', () => {
    const noted = row({
      flags: ['manualPunch', 'crossBranchPunch'],
      frozen: true,
    });
    expect(reportNotes(noted, 'ar')).toBe(
      'الشهر مغلق من المرتبات · بصمة يدوية · بصمة من فرع آخر',
    );
    expect(reportNotes(noted, 'en')).toBe(
      'Payroll month closed · Manual punch · Punch at another branch',
    );
  });

  it('marks a day read from its punches alone, so a reader knows the backfill is behind', () => {
    expect(reportNotes(row({ provisional: true }), 'ar')).toBe('قراءة مبدئية من البصمات');
    // …but says nothing on a provisional day with no scans: there is no reading to qualify.
    expect(reportNotes(row({ provisional: true, firstInAt: null, lastOutAt: null }), 'ar')).toBe('');
  });

  it('says nothing at all about an ordinary day', () => {
    expect(reportNotes(row(), 'ar')).toBe('');
  });
});

describe('the status words', () => {
  it('names every stored status, in both languages', () => {
    for (const status of ATTENDANCE_DAY_STATUSES) {
      expect(statusLabel(status, 'ar'), status).not.toBe('');
      expect(statusLabel(status, 'en'), status).not.toBe('');
    }
  });

  it('maps the two statuses the reader is told differently about', () => {
    // A day still being lived is not an absence…
    expect(statusLabel('pending', 'ar')).toBe('لم يحضر بعد');
    // …a check-in with no check-out is «حضر فقط» on every date, by the owner's ruling…
    expect(statusLabel('checkedIn', 'ar')).toBe('حضر فقط');
    // …and the reader does not care which rule made a day a rest day.
    expect(statusLabel('weekend', 'ar')).toBe('يوم راحة');
    expect(statusLabel('dayOff', 'ar')).toBe('يوم راحة');
  });

  it('is exhaustive over the display vocabulary, with no label left unused', () => {
    const reachable = new Set(ATTENDANCE_DAY_STATUSES.map((status) => displayStatusOf(status)));
    // Every display status is produced by some stored status — a label nothing can reach is a
    // word in the catalogue that no reader will ever see, and a sign the mapping has drifted.
    expect([...reachable].sort()).toEqual([...ATTENDANCE_DISPLAY_STATUSES].sort());
  });

  /**
   * THE GUARD THAT MATTERS, and the reason these words live in the contract rather than in two
   * places. The owner asked for «the same label the screen shows»; the screen resolves its copy
   * through the web i18n catalogue, which the server cannot import. So the words are declared once
   * in `@ecms/contracts` and this reads the catalogue's source to prove the two agree.
   *
   * It fails the moment somebody rewords one side, which is exactly when it should.
   */
  it('are character-for-character the words the screens show', () => {
    const catalogue = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../../web/src/platform/localization/i18n.ts',
      ),
      'utf8',
    );
    const seen = new Map<string, string[]>();
    for (const [, key, value] of catalogue.matchAll(
      /'attendanceView\.status\.([a-zA-Z]+)':\s*'([^']*)'/g,
    )) {
      if (key === undefined || value === undefined) continue;
      seen.set(key, [...(seen.get(key) ?? []), value]);
    }
    expect(seen.size, 'the web catalogue still declares attendanceView.status.*').toBeGreaterThan(0);

    for (const status of ATTENDANCE_DISPLAY_STATUSES) {
      const web = seen.get(status);
      expect(web, `the web catalogue names ${status}`).toBeDefined();
      // Both locales declare the key once each, in the order English then Arabic.
      expect(web, status).toHaveLength(2);
      const label = ATTENDANCE_DISPLAY_LABELS[status];
      expect([...(web ?? [])].sort(), status).toEqual([label.ar, label.en].sort());
    }
    // And nothing is left in the catalogue that the vocabulary has dropped: the «في العمل» label
    // the owner's ruling removed must not linger on a screen the file disagrees with.
    const vocabulary = new Set<string>(ATTENDANCE_DISPLAY_STATUSES);
    expect([...seen.keys()].filter((key) => !vocabulary.has(key))).toEqual([]);
  });
});

describe('a cell, written as CSV', () => {
  it('is always quoted — including the employee code, whose leading zero depends on it', () => {
    expect(csvCell('0100052')).toBe('"0100052"');
    expect(csvCell('')).toBe('""');
  });

  it('doubles a quote inside the value rather than ending the cell early', () => {
    expect(csvCell('قرار «المدير"»')).toBe('"قرار «المدير""»"');
  });

  it('defuses a cell a spreadsheet would otherwise run', () => {
    // A name beginning with `=` is unlikely and a note containing one is not; either way the cell
    // must be shown rather than evaluated. The guard is the register export's, reused.
    expect(csvCell('=cmd|calc')).toBe(`"'=cmd|calc"`);
    // …but a plain negative number is a value, not a formula.
    expect(csvCell('-5')).toBe('"-5"');
  });
});

describe('every status produces a complete row', () => {
  it('leaves no cell undefined, whatever the day was', () => {
    for (const status of ATTENDANCE_DAY_STATUSES as readonly AttendanceDayStatus[]) {
      const cells = reportCells(
        row({ status, firstInAt: null, lastOutAt: null, figures: NO_FIGURES, punchCount: 0 }),
        'ar',
      );
      expect(cells, status).toHaveLength(ATTENDANCE_REPORT_COLUMNS.length);
      for (const cell of cells) expect(typeof cell, status).toBe('string');
    }
  });
});

// The daily report's period (2026-11-02, «فى تقرير اليوم بقي عايز كمان تسمح بإنى أختار فترة من إلى ..
// بس الـ Default يكون اليوم»): which days a query asks for — the done pages' ladder, with the
// single `date` of a link from before the period serving when no bound is given.
import { describe, expect, it } from 'vitest';
import { AtmDailyReportQuerySchema } from '@ecms/contracts';
import { reportPeriod } from './report.service';

const TODAY = '2026-11-02';

describe('reportPeriod', () => {
  it('is today with nothing asked', () => {
    expect(reportPeriod({}, TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('takes both bounds as given, the last day included by the caller', () => {
    expect(reportPeriod({ from: '2026-10-20', to: '2026-10-28' }, TODAY)).toEqual({
      from: '2026-10-20',
      to: '2026-10-28',
    });
  });

  it('lets one bound serve as both', () => {
    expect(reportPeriod({ from: '2026-10-20' }, TODAY)).toEqual({
      from: '2026-10-20',
      to: '2026-10-20',
    });
    expect(reportPeriod({ to: '2026-10-20' }, TODAY)).toEqual({
      from: '2026-10-20',
      to: '2026-10-20',
    });
  });

  it('reads a «to» before the «from» as the days between', () => {
    expect(reportPeriod({ from: '2026-10-28', to: '2026-10-20' }, TODAY)).toEqual({
      from: '2026-10-20',
      to: '2026-10-28',
    });
  });

  it('opens a link from before the period on its one day, a bound winning over it', () => {
    expect(reportPeriod({ date: '2026-10-25' }, TODAY)).toEqual({
      from: '2026-10-25',
      to: '2026-10-25',
    });
    expect(reportPeriod({ date: '2026-10-25', from: '2026-10-20' }, TODAY)).toEqual({
      from: '2026-10-20',
      to: '2026-10-20',
    });
  });
});

describe('the query', () => {
  it('takes from, to and the legacy date as Cairo days, and nothing else', () => {
    expect(
      AtmDailyReportQuerySchema.safeParse({ from: '2026-10-20', to: '2026-10-28' }).success,
    ).toBe(true);
    expect(AtmDailyReportQuerySchema.safeParse({ date: '2026-10-20' }).success).toBe(true);
    expect(AtmDailyReportQuerySchema.safeParse({ from: '20-10-2026' }).success).toBe(false);
    expect(AtmDailyReportQuerySchema.safeParse({ day: '2026-10-20' }).success).toBe(false);
  });
});

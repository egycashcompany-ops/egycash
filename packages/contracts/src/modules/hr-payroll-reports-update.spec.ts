// D-B1-5, corrected — an edit states the version it is replacing.
//
// The concurrency GUARANTEE is the database's: `BaseRepository.updateById` matches `__v` inside the
// update. What the contract has to guarantee is that a version can never be omitted, defaulted or
// smuggled past — because a missing version would otherwise reach a repository that requires one,
// and the failure would surface as a type error at build time rather than a 409 at the right moment.
import { describe, expect, it } from 'vitest';
import {
  CreatePayrollReportDefinitionSchema,
  PreviewPayrollReportSchema,
  UpdatePayrollReportDefinitionSchema,
} from './hr-payroll-reports.js';

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: { ar: 'تقرير', en: 'Report' },
  sourceId: 'payrollRunLines',
  measures: ['amountMinor'],
  ...over,
});

describe('an update carries its version', () => {
  it('accepts a whole definition plus the version it read', () => {
    const result = UpdatePayrollReportDefinitionSchema.safeParse(body({ version: 3 }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe(3);
  });

  it('refuses an update with no version — it cannot default to anything safe', () => {
    expect(UpdatePayrollReportDefinitionSchema.safeParse(body()).success).toBe(false);
  });

  it('refuses a version that is not a whole, non-negative number', () => {
    for (const version of [-1, 1.5, '3', null, true]) {
      expect(UpdatePayrollReportDefinitionSchema.safeParse(body({ version })).success, String(version)).toBe(
        false,
      );
    }
  });

  it('accepts version 0 — a document that has never been edited', () => {
    expect(UpdatePayrollReportDefinitionSchema.safeParse(body({ version: 0 })).success).toBe(true);
  });

  it('still enforces every coherence rule an update shares with a create', () => {
    expect(
      UpdatePayrollReportDefinitionSchema.safeParse(body({ version: 1, measures: [] })).success,
    ).toBe(false);
    expect(
      UpdatePayrollReportDefinitionSchema.safeParse(
        body({ version: 1, dimensions: ['branch', 'branch'] }),
      ).success,
    ).toBe(false);
    expect(
      UpdatePayrollReportDefinitionSchema.safeParse(
        body({ version: 1, sort: { key: 'branch', direction: 'asc' } }),
      ).success,
    ).toBe(false);
  });
});

describe('the other operations are unchanged', () => {
  it('create takes no version — there is nothing yet to be stale against', () => {
    expect(CreatePayrollReportDefinitionSchema.safeParse(body()).success).toBe(true);
    expect(CreatePayrollReportDefinitionSchema.safeParse(body({ version: 1 })).success).toBe(false);
  });

  it('preview takes no version either, because it modifies nothing', () => {
    expect(
      PreviewPayrollReportSchema.safeParse({
        runId: '507f1f77bcf86cd799439011',
        definition: body(),
      }).success,
    ).toBe(true);
  });
});

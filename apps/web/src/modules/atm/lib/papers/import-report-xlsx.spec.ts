// The import's differences report as a file (docs/12-planning/atm-settlements-phase1.md §5.3,
// §9.5): row, code, outcome, flags, machine name — no counts, no amounts.
import { type AtmLayoutImportRowDto } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../../platform/localization/i18n';
import {
  buildImportReportXlsx,
  importReportFilename,
  importReportSheet,
  importReportWords,
} from './import-report-xlsx';

const row = (over: Partial<AtmLayoutImportRowDto>): AtmLayoutImportRowDto => ({
  row: 5,
  code: 'BRKN9001',
  outcome: 'new',
  flags: [],
  machineId: null,
  machineName: 'ماكينة اختبار 1',
  bankName: null,
  revision: null,
  before: null,
  after: [{ slot: 1, kind: 'withdrawal', denomination: 200, currency: 'EGP' }],
  typeLabel: { before: null, after: 'BRK (T1)' },
  featuresLabel: { before: null, after: null },
  hubLabel: { before: null, after: null },
  ...over,
});

const words = importReportWords((key, params) => translate('ar', key, params));

describe('the differences report', () => {
  it('one row per file row, in the file’s order, with the outcome and flags in words', () => {
    const sheet = importReportSheet(
      {
        rows: [
          row({
            row: 9,
            code: null,
            outcome: 'invalid',
            flags: ['labelTooLong'],
            machineName: null,
          }),
          row({ row: 5, outcome: 'changed', flags: ['reversedOrder', 'helpOrderOpposite'] }),
        ],
      },
      words,
    );
    expect(sheet.name).toBe('الاختلافات');
    expect(sheet.serialHeader).toBe('م');
    expect(sheet.header).toEqual(['الصف', 'رقم الماكينة', 'النتيجة', 'ملاحظات', 'اسم الماكينة']);
    expect(sheet.rows).toEqual([
      [5, 'BRKN9001', 'مختلفة', 'ترتيب معكوس · HELP بترتيب معاكس', 'ماكينة اختبار 1'],
      [9, '', 'غير صالحة', 'نص طويل', ''],
    ]);
  });

  it('carries no slots, counts or amounts into the file', async () => {
    const { blob, filename } = buildImportReportXlsx(
      { bankCode: 'BRK', rows: [row({})] },
      words,
      '2026-10-27',
    );
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('BRKN9001');
    expect(text).not.toContain('BRK (T1)');
    expect(text).not.toContain('withdrawal');
    expect(filename).toBe('Full list differences BRK 27-10-2026.xlsx');
    expect(importReportFilename('BRK', '2026-03-05')).toBe(
      'Full list differences BRK 05-03-2026.xlsx',
    );
  });
});

// «زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول (وأعتمد الفلتر طبعاً)» — what
// the custody register's files say, line by line, and the filters its printed page names. That the
// files hold every row the filters match, and that the print opens its tab before it gathers them,
// is `register-export.spec.ts`.
import { describe, expect, it } from 'vitest';
import { type ItAssetAssignmentDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { formatDate } from '../../../shared/lib/format';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  custodyRegisterFilters,
  custodyRegisterHeader,
  custodyRegisterLine,
  custodyRegisterReport,
  custodyRegisterSubtitle,
  type CustodyRegisterContext,
} from './custody-register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const context: CustodyRegisterContext = {
  t,
  locale: 'ar',
  branchName: new Map([['b-hq', 'المهندسين']]),
};

const interval = (over: Partial<ItAssetAssignmentDto> = {}): ItAssetAssignmentDto => ({
  id: 'a-1',
  assetId: 'asset-1',
  assignedToEmployeeId: 'e-1',
  assignedToEmployeeCode: '0100052',
  assignedToEmployeeName: 'محمد أحمد علي',
  assetCode: 'AST-00012',
  assetName: 'لاب توب Lenovo',
  assignedByUserId: null,
  assignedAt: '2026-10-07T09:00:00.000Z',
  conditionOnIssue: null,
  expectedReturnAt: null,
  returnedAt: null,
  returnedToUserId: null,
  conditionOnReturn: null,
  notes: null,
  branchId: 'b-hq',
  receiptId: 'r-1',
  receiptSigned: false,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

describe('the register’s columns', () => {
  it('are the table’s, in its order, with the two codes in columns of their own', () => {
    expect(custodyRegisterHeader(t)).toEqual([
      'الصنف',
      'كود الصنف',
      'تاريخ التسليم',
      'المستلِم',
      'كود الموظف',
      'الفرع',
      'موعد الإعادة',
      'الحالة',
      'تاريخ الاسترجاع',
      'إيصال الاستلام',
    ]);
  });

  it('write an open interval as the table shows it, a code kept as text', () => {
    expect(custodyRegisterLine(interval(), context, '')).toEqual([
      'لاب توب Lenovo',
      'AST-00012',
      formatDate('2026-10-07T09:00:00.000Z', 'ar'),
      'محمد أحمد علي',
      '0100052',
      'المهندسين',
      '',
      'مُسلَّم',
      '',
      'بانتظار التوقيع',
    ]);
  });

  it('write a returned interval with its dates and its signed receipt', () => {
    const line = custodyRegisterLine(
      interval({
        expectedReturnAt: '2026-12-01T00:00:00.000Z',
        returnedAt: '2026-11-20T00:00:00.000Z',
        receiptSigned: true,
      }),
      context,
      '—',
    );
    expect(line[2]).toBe(formatDate('2026-10-07T09:00:00.000Z', 'ar'));
    expect(line.slice(6)).toEqual([
      formatDate('2026-12-01T00:00:00.000Z', 'ar'),
      'مُسترجَع',
      formatDate('2026-11-20T00:00:00.000Z', 'ar'),
      'موقّع',
    ]);
  });

  it('fall back as the table does — never a guessed name, and a blank where there is nothing', () => {
    const line = custodyRegisterLine(
      interval({
        assetName: null,
        assetCode: null,
        assignedToEmployeeName: null,
        assignedToEmployeeCode: null,
        branchId: 'b-gone',
        receiptId: null,
        receiptSigned: null,
      }),
      context,
      '—',
    );
    expect(line[0]).toBe('خارج نطاقك');
    expect(line[1]).toBe('—');
    // A holder HR cannot name is shown by the id the row carries.
    expect(line[3]).toBe('e-1');
    expect(line[4]).toBe('—');
    expect(line[5]).toBe('—');
    expect(line[9]).toBe('—');
  });
});

describe('what the printed page says it is a view of', () => {
  it('names the status, the branch, the holder and the day', () => {
    expect(
      custodyRegisterSubtitle(t, {
        open: 'true',
        branch: 'المهندسين',
        holder: 'محمد أحمد علي',
        asOf: '١٨ أكتوبر ٢٠٢٦',
      }),
    ).toBe('المُسلَّم حاليًا · المهندسين · المستلِم: محمد أحمد علي · بتاريخ ١٨ أكتوبر ٢٠٢٦');
  });

  it('says «every branch» when none is set, and leaves out a holder nobody set', () => {
    expect(
      custodyRegisterSubtitle(t, { open: 'all', branch: null, holder: null, asOf: 'اليوم' }),
    ).toBe('الكل · كل الفروع · بتاريخ اليوم');
    expect(
      custodyRegisterSubtitle(t, { open: 'false', branch: null, holder: null, asOf: 'اليوم' }),
    ).toBe('المُسترجَع · كل الفروع · بتاريخ اليوم');
  });

  it('never says «every branch» for a branch that is set but has no name to print', () => {
    expect(
      custodyRegisterSubtitle(t, { open: 'true', branch: '', holder: null, asOf: 'اليوم' }),
    ).toBe('المُسلَّم حاليًا · فرع محدد · بتاريخ اليوم');
  });
});

describe('the filters the printed page names', () => {
  const screen = {
    openParam: 'true',
    branchId: '',
    branchName: context.branchName,
    employeeId: '',
    holderLabel: '',
    rows: [interval()],
  };

  it('are the ones in force, by name', () => {
    expect(custodyRegisterFilters({ ...screen, branchId: 'b-hq', employeeId: 'e-1' })).toEqual({
      open: 'true',
      branch: 'المهندسين',
      holder: 'محمد أحمد علي',
    });
    expect(custodyRegisterFilters(screen)).toEqual({ open: 'true', branch: null, holder: null });
  });

  it('read the status as the request does: anything but «true» or «all» is the returned', () => {
    expect(custodyRegisterFilters({ ...screen, openParam: 'all' }).open).toBe('all');
    expect(custodyRegisterFilters({ ...screen, openParam: 'false' }).open).toBe('false');
    expect(custodyRegisterFilters({ ...screen, openParam: 'nonsense' }).open).toBe('false');
  });

  it('name the holder by the rows before a chip that may be stale after Back', () => {
    // The chip still says the last pick; the URL — and so every row — is somebody else's.
    expect(
      custodyRegisterFilters({ ...screen, employeeId: 'e-1', holderLabel: 'سيد حسن (0100099)' })
        .holder,
    ).toBe('محمد أحمد علي');
  });

  it('keep a holder filter that matched nothing, by the chip or else by the id', () => {
    // Somebody who has returned everything: no row to name them, and the paper must not read as
    // «nobody in the company holds anything».
    expect(
      custodyRegisterFilters({
        ...screen,
        employeeId: 'e-7',
        holderLabel: 'سيد حسن (0100099)',
        rows: [],
      }).holder,
    ).toBe('سيد حسن (0100099)');
    expect(custodyRegisterFilters({ ...screen, employeeId: 'e-7', rows: [] }).holder).toBe('e-7');
    // …and a holder HR cannot name, on rows that are theirs.
    expect(
      custodyRegisterFilters({
        ...screen,
        employeeId: 'e-1',
        rows: [interval({ assignedToEmployeeName: null })],
      }).holder,
    ).toBe('e-1');
  });

  it('keep a branch filter whose name is not among the options', () => {
    expect(custodyRegisterFilters({ ...screen, branchId: 'b-closed' }).branch).toBe('');
  });
});

describe('the printed register', () => {
  const report = custodyRegisterReport([interval()], context, 'المُسلَّم حاليًا');
  const html = buildFleetReportHtml(report);

  it('is the company’s report form, under the IT sector, landscape for ten columns', () => {
    expect(report.title).toBe('عهدة الأصول');
    expect(report.department).toBe('قطاع تكنولوجيا المعلومات');
    expect(report.orientation).toBe('landscape');
    expect(html).toContain('@page { size: A4 landscape; margin: 14mm; }');
    expect(html).toContain('<th>م</th>');
    expect(html).toContain('AST-00012');
    expect(html).toContain('المُسلَّم حاليًا');
  });

  it('is a list, not a form that goes up for signature', () => {
    expect(report.signatories).toBeUndefined();
    expect(html).not.toContain('التوقيع /');
  });

  it('marks a blank box with a dash on paper', () => {
    expect(report.rows[0]?.[6]).toBe('—');
  });

  it('still prints when the filters matched nothing, and says so', () => {
    const empty = buildFleetReportHtml(custodyRegisterReport([], context, ''));
    expect(empty).toContain('لا توجد سجلات مطابقة لعوامل التصفية.');
    expect(empty).not.toContain('<table>');
  });
});

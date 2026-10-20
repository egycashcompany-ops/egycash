// The mobile-line register as a file — what its Excel and PDF say, line by line, and the filters
// its printed page names. What every register shares is `register-export.spec.ts`.
import { describe, expect, it } from 'vitest';
import { type ItMobileLineDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { formatDate } from '../../../shared/lib/format';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  mobileLineHolderLabel,
  mobileLineRegisterFilters,
  mobileLineRegisterHeader,
  mobileLineRegisterLine,
  mobileLineRegisterReport,
  mobileLineRegisterSubtitle,
  type MobileLineRegisterContext,
} from './mobile-line-register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const context: MobileLineRegisterContext = {
  t,
  locale: 'ar',
  branchName: new Map([['b-hq', 'المهندسين']]),
};

const ASSIGNED_AT = '2026-10-08T09:00:00.000Z';

const line = (over: Partial<ItMobileLineDto> = {}): ItMobileLineDto => ({
  id: 'l-1',
  network: 'vodafone',
  phoneNumber: '01012345678',
  accountNumber: '6.293541',
  ratePlan: 'Red Business 500',
  simKind: 'physical',
  simSerial: '89200112345678901234',
  status: 'assigned',
  branchId: 'b-hq',
  notes: null,
  currentAssignmentId: 'a-1',
  holder: {
    assignmentId: 'a-1',
    kind: 'employee',
    employeeId: 'e-1',
    employeeCode: '0100052',
    employeeName: 'محمد أحمد علي',
    vehicleCode: null,
    vehiclePlate: null,
    assignedAt: ASSIGNED_AT,
    receiptId: 'r-1',
    receiptSigned: true,
  },
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

const CAR_HOLDER = {
  assignmentId: 'a-2',
  kind: 'vehicle' as const,
  employeeId: null,
  employeeCode: null,
  employeeName: null,
  vehicleCode: '204',
  vehiclePlate: 'س ص 63',
  assignedAt: ASSIGNED_AT,
  receiptId: null,
  receiptSigned: null,
};

describe('the mobile-line register’s columns', () => {
  it('are the table’s, the holder’s code beside the holder', () => {
    expect(mobileLineRegisterHeader(t)).toEqual([
      'الشبكة',
      'رقم الخط',
      'الباقة',
      'مسلسل الشريحة',
      'رقم الحساب',
      'الحالة',
      'المستلِم',
      'الكود',
      'الفرع',
      'تاريخ التسليم',
    ]);
  });

  it('write a line as the table shows it — the network by name, the numbers as TEXT', () => {
    const cells = mobileLineRegisterLine(line(), context, '');
    expect(cells).toEqual([
      'فودافون',
      '01012345678',
      'Red Business 500',
      '89200112345678901234',
      '6.293541',
      t('it.mobileLines.status.assigned'),
      'محمد أحمد علي',
      '0100052',
      'المهندسين',
      formatDate(ASSIGNED_AT, 'ar'),
    ]);
    // A number in a cell is a number to the workbook: the leading 0 and the ICCID's last digits
    // would go. Every cell is a string.
    for (const cell of cells) expect(typeof cell).toBe('string');
  });

  it('write a car holder as «سيارة» with its plate, its code in the code column', () => {
    const cells = mobileLineRegisterLine(line({ holder: CAR_HOLDER }), context, '');
    expect(cells.slice(6, 8)).toEqual(['سيارة — س ص 63', '204']);
  });

  it('say an eSIM is one, and leave a blank cell in the sheet where the table shows a dash', () => {
    const cells = mobileLineRegisterLine(
      line({
        status: 'inStock',
        simKind: 'esim',
        simSerial: null,
        ratePlan: null,
        accountNumber: null,
        branchId: 'b-gone',
        holder: null,
        currentAssignmentId: null,
      }),
      context,
      '',
    );
    expect(cells).toEqual([
      'فودافون',
      '01012345678',
      '',
      'eSIM',
      '',
      t('it.mobileLines.status.inStock'),
      '',
      '',
      '',
      '',
    ]);
  });
});

describe('the holder’s label', () => {
  it('names an employee with their code, and a car by its code and plate', () => {
    expect(
      mobileLineHolderLabel(t, {
        kind: 'employee',
        employeeId: 'e-1',
        employeeName: 'محمد أحمد علي',
        employeeCode: '0100052',
        vehicleCode: null,
        vehiclePlate: null,
      }),
    ).toBe('محمد أحمد علي (0100052)');
    expect(mobileLineHolderLabel(t, CAR_HOLDER)).toBe('سيارة 204 — س ص 63');
    expect(mobileLineHolderLabel(t, { ...CAR_HOLDER, vehicleCode: null })).toBe('سيارة س ص 63');
  });

  it('falls back to the code, then the id — never a guess', () => {
    const nameless = {
      kind: 'employee' as const,
      employeeId: 'e-9',
      employeeName: null,
      employeeCode: null,
      vehicleCode: null,
      vehiclePlate: null,
    };
    expect(mobileLineHolderLabel(t, nameless)).toBe('e-9');
    expect(mobileLineHolderLabel(t, { ...nameless, employeeCode: '0100099' })).toBe('0100099');
  });
});

describe('the filters the printed page names', () => {
  const screen = {
    networks: [] as const,
    search: '',
    status: '',
    branchId: '',
    branchName: context.branchName,
    holderId: '',
    holderLabel: '',
    kind: '',
    rows: [] as ItMobileLineDto[],
  };

  it('are «every» network, status and branch when none is set', () => {
    expect(
      mobileLineRegisterSubtitle(t, { ...mobileLineRegisterFilters(screen), asOf: 'اليوم' }),
    ).toBe('كل الشبكات · كل الحالات · كل الفروع · بتاريخ اليوم');
  });

  it('name each filter in force — the networks pressed, who holds the lines, the search', () => {
    expect(
      mobileLineRegisterSubtitle(t, {
        ...mobileLineRegisterFilters({
          ...screen,
          networks: ['vodafone', 'orange'],
          search: ' 0101 ',
          status: 'assigned',
          branchId: 'b-hq',
          holderId: 'e-1',
          kind: 'employee',
          rows: [line()],
        }),
        asOf: 'اليوم',
      }),
    ).toBe(
      `فودافون، أورانج · ${t('it.mobileLines.status.assigned')} · المهندسين · لدى موظف · المستلِم: محمد أحمد علي · البحث: 0101 · بتاريخ اليوم`,
    );
  });

  it('never drop a filter in force whose name cannot be had', () => {
    const filters = mobileLineRegisterFilters({ ...screen, branchId: 'b-closed', holderId: 'e-7' });
    expect(filters).toMatchObject({ branch: '', holder: 'e-7' });
    expect(mobileLineRegisterSubtitle(t, { ...filters, asOf: 'اليوم' })).toBe(
      'كل الشبكات · كل الحالات · فرع محدد · المستلِم: e-7 · بتاريخ اليوم',
    );
  });
});

describe('the printed mobile-line register', () => {
  const report = mobileLineRegisterReport(
    [line(), line({ id: 'l-2', holder: null, ratePlan: null })],
    context,
    'كل الشبكات',
  );
  const html = buildFleetReportHtml(report);

  it('is «خطوط المحمول» on the company form, landscape for ten columns', () => {
    expect(report.title).toBe('خطوط المحمول');
    expect(report.orientation).toBe('landscape');
    expect(report.header).toHaveLength(10);
    expect(html).toContain('01012345678');
    expect(html).toContain('فودافون');
    // Text only — the logos are the screen's, not the file's.
    expect(html).not.toContain('it-mobile-lines/');
  });

  it('marks a blank box with a dash on paper', () => {
    expect(report.rows[1]?.[2]).toBe('—');
    expect(report.rows[1]?.[6]).toBe('—');
  });
});

// The consumables ledger as a file (FR-20) — what its Excel and PDF say, movement by movement, the
// way each kind is read, and the filters its printed page names.
import { describe, expect, it } from 'vitest';
import { type ItConsumableMovementDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { formatDate, formatDateTime } from '../../../shared/lib/format';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  MOVEMENT_SIGN,
  consumableMovementRegisterFilters,
  consumableMovementRegisterHeader,
  consumableMovementRegisterLine,
  consumableMovementRegisterReport,
  consumableMovementRegisterSubtitle,
  movementAsset,
  movementEmployee,
  movementReason,
  type ConsumableMovementRegisterContext,
} from './consumable-movement-register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const context: ConsumableMovementRegisterContext = {
  t,
  locale: 'ar',
  typeName: new Map([['ty-mice', 'ماوس']]),
  userName: new Map([['u-it', 'أحمد سالم']]),
};

const AT = '2026-10-21T08:30:00.000Z';

const movement = (over: Partial<ItConsumableMovementDto> = {}): ItConsumableMovementDto => ({
  id: 'm-1',
  consumableId: 'c-1',
  kind: 'issued',
  qty: 2,
  at: AT,
  branchId: 'b-hq',
  consumableCode: 'CON-00004',
  consumableName: 'Mouse',
  typeId: 'ty-mice',
  employeeId: 'e-1',
  employeeCode: '0100052',
  employeeName: 'محمد أحمد علي',
  assetId: 'a-12',
  assetCode: 'AST-00012',
  assetName: 'لاب توب Lenovo',
  reason: 'replacement',
  memoId: 'memo-1',
  memoNumber: 7,
  memoSigned: false,
  byUserId: 'u-it',
  notes: null,
  createdAt: AT,
  ...over,
});

const RECEIVED = movement({
  id: 'm-2',
  kind: 'received',
  qty: 24,
  employeeId: null,
  employeeCode: null,
  employeeName: null,
  assetId: null,
  assetCode: null,
  assetName: null,
  reason: null,
  memoId: null,
  memoNumber: null,
  memoSigned: null,
  byUserId: 'u-unnamed',
  notes: 'جرد أكتوبر',
});

describe('a movement, read by its kind', () => {
  it('moves the store in by a receipt or a return, out by an issue or a scrap', () => {
    expect(MOVEMENT_SIGN).toEqual({ received: 1, issued: -1, scrapped: -1, returned: 1 });
  });

  it('gives an issue’s reason in words, a scrap’s own text, and nothing for the others', () => {
    expect(movementReason(t, movement())).toBe('بدل تالف');
    expect(movementReason(t, movement({ reason: 'new' }))).toBe('جديد');
    expect(movementReason(t, movement({ kind: 'scrapped', reason: ' انكسر الموصل ' }))).toBe(
      'انكسر الموصل',
    );
    expect(movementReason(t, RECEIVED)).toBeNull();
    expect(movementReason(t, movement({ kind: 'returned', reason: 'new' }))).toBeNull();
  });

  it('names the person and the asset as the server labelled them — or by code, then id', () => {
    expect(movementEmployee(movement())).toBe('محمد أحمد علي (0100052)');
    expect(movementEmployee(movement({ employeeName: null }))).toBe('0100052');
    expect(movementEmployee(movement({ employeeName: null, employeeCode: null }))).toBe('e-1');
    expect(movementEmployee(RECEIVED)).toBeNull();
    expect(movementAsset(movement())).toBe('AST-00012 — لاب توب Lenovo');
    // Out of the reader's scope the server names nothing — and nothing is guessed here.
    expect(movementAsset(movement({ assetCode: null, assetName: null }))).toBeNull();
  });
});

describe('the ledger’s columns', () => {
  it('are the table’s, each code right after its name, the memo’s signature beside its number', () => {
    expect(consumableMovementRegisterHeader(t)).toEqual([
      'التاريخ',
      'الحركة',
      'الصنف',
      'كود الصنف',
      'النوع',
      'الكمية',
      'الموظف',
      'كود الموظف',
      'مركّب على',
      'السبب',
      'رقم المذكرة',
      'توقيع المذكرة',
      'بواسطة',
    ]);
  });

  it('write an issue as the table shows it — the quantity signed by its kind, as a NUMBER', () => {
    expect(consumableMovementRegisterLine(movement(), context, '')).toEqual([
      formatDateTime(AT, 'ar'),
      'صرف',
      'Mouse',
      'CON-00004',
      'ماوس',
      -2,
      'محمد أحمد علي',
      '0100052',
      'AST-00012 — لاب توب Lenovo',
      'بدل تالف',
      'EGYCASH-IT-CON-0007',
      'بانتظار التوقيع',
      'أحمد سالم',
    ]);
  });

  it('write a receipt with blanks where the table shows dashes — and a user it may not name blank', () => {
    expect(consumableMovementRegisterLine(RECEIVED, context, '')).toEqual([
      formatDateTime(AT, 'ar'),
      'توريد',
      'Mouse',
      'CON-00004',
      'ماوس',
      24,
      '',
      '',
      '',
      // A receipt has no reason; its notes are what the reason cell shows, on screen and in the file.
      'جرد أكتوبر',
      '',
      '',
      '',
    ]);
  });

  it('write the notes beside the reason, as the table does — an issue’s and a scrap’s alike', () => {
    const cells = consumableMovementRegisterLine(
      movement({ notes: 'للمكتب الأمامي' }),
      context,
      '',
    );
    expect(cells[9]).toBe('بدل تالف — للمكتب الأمامي');
  });

  it('say a signed memo is signed', () => {
    const cells = consumableMovementRegisterLine(movement({ memoSigned: true }), context, '');
    expect(cells[11]).toBe('موقّع');
  });
});

describe('the filters the printed page names', () => {
  const screen = {
    locale: 'ar' as const,
    kind: null,
    typeId: '',
    typeName: context.typeName,
    branchId: '',
    branchName: new Map([['b-hq', 'المهندسين']]),
    employeeId: '',
    employeeLabel: '',
    assetId: '',
    assetLabel: '',
    from: '',
    to: '',
    search: '',
    rows: [] as ItConsumableMovementDto[],
  };

  it('are every movement, type and branch when none is set', () => {
    expect(
      consumableMovementRegisterSubtitle(t, {
        ...consumableMovementRegisterFilters(screen),
        asOf: 'اليوم',
      }),
    ).toBe('كل الحركات · كل الأنواع · كل الفروع · بتاريخ اليوم');
  });

  it('name each filter in force — the kind, the person, the asset, the period, the search', () => {
    expect(
      consumableMovementRegisterSubtitle(t, {
        ...consumableMovementRegisterFilters({
          ...screen,
          kind: 'issued',
          typeId: 'ty-mice',
          branchId: 'b-hq',
          employeeId: 'e-1',
          assetId: 'a-12',
          from: '2026-10-01',
          to: '2026-10-31',
          search: ' mouse ',
          rows: [movement()],
        }),
        asOf: 'اليوم',
      }),
    ).toBe(
      `صرف · ماوس · المهندسين · الموظف: محمد أحمد علي · مركّب على: AST-00012 — لاب توب Lenovo · التاريخ من ${formatDate('2026-10-01T00:00:00', 'ar')} إلى ${formatDate('2026-10-31T00:00:00', 'ar')} · البحث: mouse · بتاريخ اليوم`,
    );
  });

  it('never drop a filter in force whose name cannot be had', () => {
    const filters = consumableMovementRegisterFilters({
      ...screen,
      typeId: 'ty-gone',
      branchId: 'b-closed',
      employeeId: 'e-7',
      assetId: 'a-9',
      assetLabel: 'AST-00009 — طابعة',
      to: '2026-10-31',
    });
    expect(filters).toMatchObject({
      type: '',
      branch: '',
      employee: 'e-7',
      asset: 'AST-00009 — طابعة',
      period: { from: null },
    });
    expect(consumableMovementRegisterSubtitle(t, { ...filters, asOf: 'اليوم' })).toBe(
      `كل الحركات · نوع محدد · فرع محدد · الموظف: e-7 · مركّب على: AST-00009 — طابعة · التاريخ حتى ${formatDate('2026-10-31T00:00:00', 'ar')} · بتاريخ اليوم`,
    );
  });
});

describe('the printed ledger', () => {
  const report = consumableMovementRegisterReport([movement(), RECEIVED], context, 'كل الحركات');
  const html = buildFleetReportHtml(report);

  it('is «حركات المستهلكات» on the company form, landscape for thirteen columns', () => {
    expect(report.title).toBe('حركات المستهلكات');
    expect(report.orientation).toBe('landscape');
    expect(report.header).toHaveLength(13);
    expect(html).toContain('EGYCASH-IT-CON-0007');
  });

  it('writes the signed quantity in the reader’s digits, and a dash for a blank box', () => {
    const issued = report.rows[0]?.[5] ?? '';
    expect(issued).toContain('٢');
    expect(issued).toMatch(/[-−؜]/u);
    expect(report.rows[1]?.[5]).toBe('٢٤');
    expect(report.rows[1]?.[6]).toBe('—');
    expect(report.rows[1]?.[12]).toBe('—');
  });
});

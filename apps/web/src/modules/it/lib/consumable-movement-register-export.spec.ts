// The consumables ledger as a file (FR-20) — what its Excel and PDF say, movement by movement, the
// way each kind is read, and the filters its printed page names. A transfer between two stores
// («ممكن أنقل 5 لفرع تاني») is read as its two halves: out of one store, into the other, each naming
// the other side.
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
  movementCounterpart,
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
  branchName: new Map([
    ['b-hq', 'المهندسين'],
    ['b-oct', 'أكتوبر'],
  ]),
  userName: new Map([['u-it', 'أحمد سالم']]),
};
const { branchName } = context;

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
  transferId: null,
  counterpartBranchId: null,
  counterpartConsumableId: null,
  counterpartConsumableCode: null,
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

/** «10 ماوس … أنقل 5»: the half that left the head office's store for October's. */
const SENT = movement({
  id: 'm-3',
  kind: 'transferredOut',
  qty: 5,
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
  transferId: 't-1',
  counterpartBranchId: 'b-oct',
  counterpartConsumableId: 'c-9',
  counterpartConsumableCode: 'CON-00031',
});
/** …and the half that reached October's store. */
const ARRIVED = movement({
  ...SENT,
  id: 'm-4',
  consumableId: 'c-9',
  consumableCode: 'CON-00031',
  kind: 'transferredIn',
  branchId: 'b-oct',
  counterpartBranchId: 'b-hq',
  counterpartConsumableId: 'c-1',
  counterpartConsumableCode: 'CON-00004',
});

describe('a movement, read by its kind', () => {
  it('moves the store in by a receipt, a return or a transfer in; out by an issue, a scrap or a transfer out', () => {
    expect(MOVEMENT_SIGN).toEqual({
      received: 1,
      issued: -1,
      scrapped: -1,
      returned: 1,
      transferredOut: -1,
      transferredIn: 1,
    });
  });

  it('gives an issue’s reason in words, a scrap’s own text, and nothing for the others', () => {
    expect(movementReason(t, movement(), branchName)).toBe('بدل تالف');
    expect(movementReason(t, movement({ reason: 'new' }), branchName)).toBe('جديد');
    expect(
      movementReason(t, movement({ kind: 'scrapped', reason: ' انكسر الموصل ' }), branchName),
    ).toBe('انكسر الموصل');
    expect(movementReason(t, RECEIVED, branchName)).toBeNull();
    expect(movementReason(t, movement({ kind: 'returned', reason: 'new' }), branchName)).toBeNull();
  });

  it('names a transfer’s other side: the branch it went to or came from, and that store’s item', () => {
    expect(movementCounterpart(t, SENT, branchName)).toEqual({
      place: 'إلى فرع أكتوبر',
      code: 'CON-00031',
    });
    expect(movementCounterpart(t, ARRIVED, branchName)).toEqual({
      place: 'من فرع المهندسين',
      code: 'CON-00004',
    });
    expect(movementReason(t, SENT, branchName)).toBe('إلى فرع أكتوبر (CON-00031)');
    expect(movementReason(t, ARRIVED, branchName)).toBe('من فرع المهندسين (CON-00004)');
    // Every other kind has no other side.
    expect(movementCounterpart(t, movement(), branchName)).toBeNull();
  });

  it('never prints an id for a branch it cannot name, nor a code the server could not give', () => {
    const unnamed = movement({
      ...SENT,
      counterpartBranchId: 'b-closed',
      counterpartConsumableCode: null,
    });
    expect(movementReason(t, unnamed, branchName)).toBe('إلى فرع آخر');
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

  it('write a transfer’s two halves signed by their kind — out of one store, into the other', () => {
    const out = consumableMovementRegisterLine(SENT, context, '');
    expect(out[1]).toBe('تحويل إلى فرع');
    expect(out[5]).toBe(-5);
    expect(out[9]).toBe('إلى فرع أكتوبر (CON-00031)');
    // No person, no asset, no memo: the ledger is the record.
    expect([out[6], out[8], out[10], out[11]]).toEqual(['', '', '', '']);
    const into = consumableMovementRegisterLine(ARRIVED, context, '');
    expect(into[1]).toBe('تحويل من فرع');
    expect(into[3]).toBe('CON-00031');
    expect(into[5]).toBe(5);
    expect(into[9]).toBe('من فرع المهندسين (CON-00004)');
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

// «طباعة» on a van of «تسليم المحصنات» — the van's load on the company's report form. PROVISIONAL
// («اللى هيطبع هقولك عليه بعدين ايه هو»): what is pinned here is that it says what the screen shows of
// the van and invents nothing, on the app's one report form.
import { describe, expect, it } from 'vitest';
import { type OperationsSecuredDistributionRowDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import { vanLoadSheet, type VanLoadSheetInput } from './van-load-sheet';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const CURRENCIES = new Map([
  ['egp', { code: 'EGP', name: 'مصري', sortOrder: 0, legacyAliases: [] }],
  ['usd', { code: 'USD', name: 'دولار', sortOrder: 1, legacyAliases: [] }],
  ['sar', { code: 'SAR', name: 'ريال سعودي', sortOrder: 2, legacyAliases: [] }],
]);

const shipment = (
  id: string,
  lines: [string, number][],
  over: Partial<OperationsSecuredDistributionRowDto> = {},
): OperationsSecuredDistributionRowDto =>
  ({
    id,
    mainBankId: 'b-ahly',
    areaName: 'مدينة نصر',
    securedStage: 'inVault',
    origin: { id: 'o', name: 'الدقي', code: 'O', bankId: 'b-ahly', bankName: 'الأهلي' },
    destination: { id: 'd', name: 'عباس العقاد', code: 'D', bankId: 'b-ahly', bankName: 'الأهلي' },
    lines: lines.map(([currencyId, amount]) => ({ currencyId, amount })),
    ...over,
  }) as OperationsSecuredDistributionRowDto;

const VAN: VanLoadSheetInput['van'] = {
  vehicleCode: '104',
  captains: [
    { employeeId: 'c2', code: null, fullNameAr: 'شادي محمد أحمد' },
    { employeeId: 'c3', code: null, fullNameAr: 'كريم سمير علي' },
  ],
  specialist1: [{ employeeId: 's1', code: null, fullNameAr: 'ياسر عبد الحميد' }],
  specialist2: [],
  direction: 'مدينة نصر',
  plannedTime: '09:00',
};

const input = (over: Partial<VanLoadSheetInput> = {}): VanLoadSheetInput => ({
  t: ar,
  day: '2026-11-12',
  van: VAN,
  crewPlanVisible: true,
  rows: [
    shipment('a', [['egp', 5_600_000], ['usd', 40_000]]),
    shipment('b', [['egp', 9_200_000], ['sar', 80_000]], { securedStage: 'withCaptain', areaName: null }),
  ],
  bankNameOf: (id) => (id === 'b-ahly' ? 'الأهلي' : ''),
  currencyOf: (id) => CURRENCIES.get(id),
  packagingOf: (id) => (id === 'a' ? { bags: 3, cartons: 0, boxes: 1 } : undefined),
  amount: (value) => value.toLocaleString('en-US'),
  count: (value) => String(value),
  ...over,
});

describe('the van’s load sheet (provisional)', () => {
  const sheet = vanLoadSheet(input());

  it('is titled by the van, under Operations — the vault', () => {
    expect(sheet.title).toBe(ar('operations.handover.sheet.title', { code: '104' }));
    expect(sheet.department).toBe(ar('operations.handover.sheet.department'));
    expect(sheet.orientation).toBe('landscape');
    expect(sheet.signatories).toBeUndefined();
  });

  it('says the day, the captains, the specialists the van has, its direction and time', () => {
    expect(sheet.subtitle).toContain('2026-11-12');
    expect(sheet.subtitle).toContain('شادي محمد أحمد، كريم سمير علي');
    expect(sheet.subtitle).toContain(`${ar('operations.crew.slot.specialist1')}: ياسر عبد الحميد`);
    // No second specialist on this van: no line for one.
    expect(sheet.subtitle).not.toContain(ar('operations.crew.slot.specialist2'));
    expect(sheet.subtitle).toContain(`${ar('operations.crew.direction')}: مدينة نصر`);
    expect(sheet.subtitle).toContain('09:00');
  });

  it('leaves the specialists out for a reader the crew plan is hidden from (rather than «—»)', () => {
    const hidden = vanLoadSheet(input({ crewPlanVisible: false }));
    expect(hidden.subtitle).not.toContain(ar('operations.crew.slot.specialist1'));
  });

  it('prints each shipment: bank, branches, area, stage, the money, the packages', () => {
    expect(sheet.header).toEqual([
      ar('operations.board.bank'),
      ar('operations.shipment.origin'),
      ar('operations.shipment.destination'),
      ar('operations.shipment.area'),
      ar('operations.common.status'),
      ar('operations.reportBoard.pound'),
      ar('operations.reportBoard.dollar'),
      ar('operations.board.figures.otherCurrencies'),
      ar('operations.handover.sheet.packages'),
    ]);
    expect(sheet.rows).toEqual([
      ['الأهلي', 'الدقي', 'عباس العقاد', 'مدينة نصر', ar('operations.board.stage.inVault'), '5,600,000', '40,000', '0', '3 / 0 / 1'],
      ['الأهلي', 'الدقي', 'عباس العقاد', '—', ar('operations.board.stage.withCaptain'), '9,200,000', '0', '80,000', '—'],
    ]);
  });

  it('totals the load under the table — the packages only where the vault counted some', () => {
    expect(sheet.totals).toEqual([
      { label: ar('operations.handover.sheet.count'), value: '2' },
      { label: ar('operations.reportBoard.pound'), value: '14,800,000' },
      { label: ar('operations.reportBoard.dollar'), value: '40,000' },
      { label: ar('operations.board.figures.otherCurrencies'), value: '80,000' },
      { label: ar('operations.distribution.bags'), value: '3' },
      { label: ar('operations.distribution.cartons'), value: '0' },
      { label: ar('operations.distribution.boxes'), value: '1' },
    ]);
    const uncounted = vanLoadSheet(input({ packagingOf: () => undefined }));
    expect(uncounted.totals.map((total) => total.label)).not.toContain(ar('operations.distribution.bags'));
  });

  it('an empty van still prints — the page says it carries nothing', () => {
    const empty = vanLoadSheet(input({ rows: [] }));
    expect(empty.rows).toEqual([]);
    expect(buildFleetReportHtml(empty)).toContain(ar('operations.handover.sheet.empty'));
  });

  it('goes out on the company’s report form — no script of its own', () => {
    const html = buildFleetReportHtml(sheet);
    expect(html).toContain(ar('operations.handover.sheet.title', { code: '104' }));
    expect(html).toContain('عباس العقاد');
    expect(html).not.toContain('<script');
    expect(html).toContain('size: A4 landscape');
  });
});

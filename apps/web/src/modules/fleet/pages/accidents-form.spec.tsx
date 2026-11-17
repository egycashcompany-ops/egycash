// «تسجيل حادث» / «تعديل الحادث» — the form in the Fleet forms' design, and its transfer from other
// cars' remaining (owner-approved 2026-11-09). The rules themselves — which cars, how much each,
// the 20-car stop — are `lib/accident-transfer-plan.spec.ts`; this file holds what the FORM does
// with them: the sections, the read-only remaining, «تغطية السالب كله تلقائياً» only while it is
// offered, the plan's table and its tags, the amber note (`role="status"`, never a refusal), the
// refused banner, the server's two refusals worded with their figures, and the body a save sends.
//
// No DOM: the form is drawn as it opens (nothing picked, nothing typed), and the plan's part of it
// is drawn from `planTransfer` directly. Clicks are the browser's to prove.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ErrorCodes,
  type FleetAccidentCarBalanceDto,
  type FleetAccidentDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoney } from '../../../shared/lib/format';
import { translate } from '../../../platform/localization/i18n';
import {
  AccidentFormDialog,
  RefusedBanner,
  TransferPlanView,
  transferRefusalOf,
} from '../components/AccidentFormDialog';
import { planTransfer, transferBody, type TakeSource } from '../lib/accident-transfer-plan';

// The dialog draws through a portal onto `document.body`; this suite has no document. The portal's
// children are rendered in place, and `document.body` only has to exist to be named.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = readFileSync(join(HERE, '../components/AccidentFormDialog.tsx'), 'utf8');
/** Comments name the bug they replaced, so a rule about the code reads the code alone. */
const CODE = FORM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const QUERIES = readFileSync(join(HERE, '../api/fleet-queries.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const I18N = readFileSync(join(HERE, '../../../platform/localization/i18n.ts'), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '');

// ── The approved sample's data: five cars, accident A (−2,300) and B (−9,000) on car 120 ───────
const ID = {
  '118': '6ac100000000000000000002',
  '120': '6ac100000000000000000003',
  '214': '6ac100000000000000000006',
  '305': '6ac100000000000000000008',
  '410': '6ac100000000000000000010',
  '522': '6ac100000000000000000012',
} as const;
type Code = keyof typeof ID;
const BALANCES: FleetAccidentCarBalanceDto[] = (
  [
    ['118', 150],
    ['214', 300],
    ['305', 1000],
    ['410', 2500],
    ['522', 4200],
  ] as const
).map(([code, remaining]) => ({ vehicleId: ID[code], vehicleCode: code, remaining }));
const CARS: TakeSource[] = BALANCES.map((b) => ({
  vehicleId: b.vehicleId,
  code: b.vehicleCode,
  available: b.remaining,
}));
const ids = (...codes: Code[]): string[] => codes.map((code) => ID[code]);

const accident = (over: Partial<FleetAccidentDto> = {}): FleetAccidentDto => ({
  id: '6acc00000000000000000001',
  vehicleId: ID['120'],
  vehicleCode: '120',
  occurredAt: '2026-10-27T00:00:00.000Z',
  culpritEmployeeId: null,
  culpritEmployeeIds: [],
  culprit: 'سامر عادل منصور',
  statement: 'اصطدام بعمود إنارة أثناء الرجوع للخلف',
  companyCost: 2000,
  amountCollected: 1700,
  paidAmount: 6000,
  transferredIn: 0,
  transferredOut: 0,
  carHasTransfers: false,
  status: 'open',
  notes: null,
  version: 3,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
  ...over,
});

const me = (): MeDto => ({
  id: 'u-1',
  email: 'user@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'ar',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: { 'fleetAccident.view': 'organization', 'fleetAccident.edit': 'organization' },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
});

const store = (locale: Locale = 'ar') =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const BALANCES_KEY = listKey('fleet', 'accidents', { carBalances: true });

const form = (
  row: FleetAccidentDto | null,
  seed: (qc: QueryClient) => void = (qc) => qc.setQueryData(BALANCES_KEY, BALANCES),
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <AccidentFormDialog open onClose={() => undefined} accident={row} />
      </QueryClientProvider>
    </Provider>,
  );
};

const planView = (plan: ReturnType<typeof planTransfer>): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <TransferPlanView plan={plan} />
    </Provider>,
  );
const plan = (picked: Code[], typed: number | null, remaining = -2300, refused: Code[] = []) =>
  planTransfer({
    cars: CARS,
    picked: ids(...picked),
    typed,
    remaining,
    ownVehicleId: ID['120'],
    refused: ids(...refused),
  });

describe('the form in the Fleet forms’ design', () => {
  it('opens as the design dialog, an edit as an edit', () => {
    const edit = form(accident());
    expect(edit).toContain('data-accident-form="edit"');
    expect(edit).toContain(ar('fleet.accidents.edit'));
    expect(form(null)).toContain('data-accident-form="new"');
    expect(form(null)).toContain(ar('fleet.accidents.record'));
    expect(CODE).toContain('<DesignDialog');
    expect(CODE).not.toContain('<Dialog');
  });

  it('runs «بيانات الحادث» → «المبالغ» → «أخذ مبلغ…(اختياري)» → «ملاحظات»', () => {
    const html = form(accident());
    const order = [
      ar('fleet.accidents.form.sections.incident'),
      ar('fleet.accidents.form.sections.amounts'),
      ar('fleet.accidents.transfer.title'),
      ar('fleet.attendance.fields.notes'),
    ];
    let at = -1;
    for (const words of order) {
      const next = html.indexOf(words, at + 1);
      expect(next, `${words} comes next`).toBeGreaterThan(at);
      at = next;
    }
    expect(ar('fleet.accidents.form.sections.incident')).toBe('بيانات الحادث');
    expect(ar('fleet.accidents.form.sections.amounts')).toBe('المبالغ');
  });

  it('says what it is for in the approved words — the remaining is worked out', () => {
    expect(form(accident())).toContain(ar('fleet.accidents.formHint'));
    expect(ar('fleet.accidents.formHint')).toBe(
      'سجّل بيانات الحادث ومبالغه كما وقعت، ويُحسب المتبقي تلقائياً.',
    );
  });

  it('shows «المتبقي على هذا الحادث» under the amounts — read-only, red while it owes', () => {
    const html = form(accident());
    const box = html.slice(html.indexOf('data-accident-remaining='));
    expect(box.startsWith('data-accident-remaining="-2300"')).toBe(true);
    expect(box).toContain('aria-readonly="true"');
    expect(text(box)).toContain('−2,300.00');
    expect(box.slice(0, box.indexOf('>'))).toContain('border-red-300');
    expect(text(box)).toContain(ar('fleet.accidents.form.remaining'));
  });

  it('counts what the file already took and gave in that remaining', () => {
    const html = form(accident({ transferredIn: 500, transferredOut: 200 }));
    expect(html).toContain('data-accident-remaining="-2000"');
  });

  it('saves through the guard, inline on the design’s Save', () => {
    expect(CODE).toContain(
      '<DesignSave data-accident-save="true" busy={pending} onClick={required.guard(submit)} />',
    );
  });
});

describe('the transfer section as it opens — nothing picked, nothing typed', () => {
  it('offers «تغطية السالب كله تلقائياً · 2,300.00» while the accident is negative', () => {
    const html = form(accident());
    const button = html.slice(html.indexOf('data-transfer-cover-all="true"'));
    expect(button.length).toBeGreaterThan(0);
    expect(text(button.slice(0, button.indexOf('</button>')))).toContain(
      ar('fleet.accidents.transfer.coverAll'),
    );
    expect(text(button.slice(0, button.indexOf('</button>')))).toContain('2,300.00');
  });

  it('offers it ONLY while there is a negative to cover', () => {
    expect(form(accident({ paidAmount: 3700 }))).not.toContain('data-transfer-cover-all');
    expect(form(accident({ paidAmount: 0 }))).not.toContain('data-transfer-cover-all');
    // A new file opens with empty amounts: nothing owed yet.
    expect(form(null)).not.toContain('data-transfer-cover-all');
    expect(CODE).toContain('plan.offerCoverAll && planProblem === null && (');
  });

  it('draws no plan until a car is picked or an amount typed — the section is optional', () => {
    const html = form(accident());
    expect(html).not.toContain('data-transfer-plan=');
    expect(html).toContain('data-transfer-ok="true"');
  });

  it('says what an empty amount box does BEFORE a car is picked', () => {
    const html = form(accident());
    expect(html).toContain(ar('fleet.accidents.transfer.amountHintNoPick'));
    expect(html).not.toContain(ar('fleet.accidents.transfer.amountHint'));
    expect(html).toContain(ar('fleet.accidents.transfer.pickOrder'));
    expect(ar('fleet.accidents.transfer.pickOrder')).toBe(
      'يُؤخذ أولاً من السيارات التي تختارها بترتيب اختيارها، ثم يُكمل النظام من غيرها',
    );
  });

  it('names a failed read of the cars in the picker’s hint — never as an error on an untouched section', () => {
    const html = form(accident(), (qc) => {
      qc.setQueryDefaults(BALANCES_KEY, { retryOnMount: false });
      qc.getQueryCache()
        .build(qc, { queryKey: BALANCES_KEY })
        .setState({ status: 'error', error: new Error('down'), fetchStatus: 'idle' });
    });
    expect(html).toContain(ar('fleet.accidents.transfer.loadFailed'));
    expect(html).toContain('data-transfer-ok="true"');
    expect(html).not.toContain('role="alert"');
  });

  it('the amount may be typed now — a money box, beside the picker', () => {
    expect(CODE).toMatch(/<MoneyInput\s+value=\{typed\}\s+onChange=\{edited\(setTyped\)\}/u);
    expect(CODE).toContain('data-transfer-amount="true"');
  });
});

describe('the picker — «يكتب جنب العربية انه هو الاختارها او الاختيار كان تلقائى»', () => {
  const picker = CODE.slice(CODE.indexOf('data-transfer-picker="true"'));
  const props = picker.slice(0, picker.indexOf('</DesignField>'));

  it('offers every live car with something left, never this accident’s own', () => {
    expect(CODE).toContain('useAccidentCarBalances(open)');
    expect(CODE).toContain('(balances.data ?? []).filter((car) => car.vehicleId !== vehicleId)');
  });

  it('shows his cars then the system’s ticked, each tagged in the open list', () => {
    expect(props).toContain('value={ticked}');
    expect(CODE).toContain('const ticked = [...mine, ...plan.autoIds];');
    expect(props).toContain('tag: <SourceTag source={source} />');
    expect(props).toContain('onChange={pick}');
  });

  it('names every pick in the box, in pick order, and is as wide as the box', () => {
    expect(props).toContain('summaryMax={Math.max(offered.length, 1)}');
    expect(props).toContain('panelWidth="w-full"');
  });

  it('«مسح الكل» and the ✕ start the section over — the amount with the cars', () => {
    expect(props).toContain('onClear={clearAll}');
    const clear = CODE.slice(CODE.indexOf('const clearAll'), CODE.indexOf('const pick = '));
    expect(clear).toContain('setPicked([])');
    expect(clear).toContain('setRefused([])');
    expect(clear).toContain("setTyped('')");
  });

  it('remembers the cars he unticked, so the system never adds them back', () => {
    expect(CODE).toContain('repick({ ticked, mine, refused, next })');
    expect(CODE).toMatch(/planTransfer\(\{[\s\S]*?refused,\s*\}\)/u);
  });

  it('leaves the file being moved off a source car out of what that car can give', () => {
    expect(CODE).toContain('accident.vehicleId === carId ? fleetAccidentRemaining(accident) : 0');
    expect(CODE).toContain('paidAmount: leavingFrom(car.vehicleId)');
  });
});

describe('the plan on screen — every figure the plan’s', () => {
  it('N1: his two cars, then the system’s two, each tagged; the accident reaches 0.00', () => {
    const html = planView(plan(['214', '305'], null));
    const rows = html.split('<tr').filter((row) => row.includes('data-transfer-car='));
    expect(rows.map((row) => /data-transfer-car="(\d+)"/u.exec(row)?.[1])).toEqual([
      '214',
      '305',
      '118',
      '410',
    ]);
    expect(rows.map((row) => /data-transfer-source="(\w+)"/u.exec(row)?.[1])).toEqual([
      'manual',
      'manual',
      'auto',
      'auto',
    ]);
    expect(text(rows[0] ?? '')).toContain(ar('fleet.accidents.transfer.manual'));
    expect(text(rows[2] ?? '')).toContain(ar('fleet.accidents.transfer.auto'));
    expect(rows[2]).toContain('data-transfer-tag="auto"');
    expect(text(rows[3] ?? '')).toContain('850.00');
    expect(text(rows[3] ?? '')).toContain('1,650.00');
    expect(html).toContain('data-transfer-total="true"');
    expect(html).toContain(ar('fleet.accidents.transfer.planNote'));
    expect(html).toContain('data-transfer-after-tone="settled"');
    expect(html, 'not short').not.toContain('data-transfer-short');
  });

  it('N4: his pick that was not needed stays listed, 0.00, «لم يُحتج إليها»', () => {
    const html = planView(plan(['410', '214'], null));
    const unneeded = html.split('<tr').find((row) => row.includes('data-transfer-unneeded'));
    expect(unneeded).toContain('data-transfer-car="214"');
    expect(text(unneeded ?? '')).toContain(ar('fleet.accidents.transfer.unneeded'));
    expect(ar('fleet.accidents.transfer.unneeded')).toBe('لم يُحتج إليها');
    // Every car his: the note says only that he may untick.
    expect(html).toContain(ar('fleet.accidents.transfer.planNoteManual'));
    expect(html).not.toContain(ar('fleet.accidents.transfer.planNote'));
  });

  it('N6: every car short — an AMBER note with role="status", not a refusal', () => {
    const html = planView(plan(['118', '214', '305', '410', '522'], null, -9000));
    const note = html.slice(html.indexOf('data-transfer-short='));
    expect(note.startsWith('data-transfer-short="all"')).toBe(true);
    const tag = html.slice(html.lastIndexOf('<p', html.indexOf('data-transfer-short=')));
    expect(tag.slice(0, tag.indexOf('>'))).toContain('role="status"');
    expect(tag.slice(0, tag.indexOf('>'))).toContain('bg-amber-50');
    const words = text(note.slice(0, note.indexOf('</p>')));
    expect(words).toContain('يُؤخذ كل المتاح في السيارات (');
    expect(words).toContain('8,150.00');
    expect(words).toContain('ويبقى على هذا الحادث');
    expect(words).toContain('−850.00');
    expect(html).toContain('data-transfer-after-tone="owing"');
    expect(html, 'never a refusal').not.toContain('role="alert"');
  });

  it('says «في السيارات المحددة» when the shortfall is his — a car he unticked holds money', () => {
    const html = planView(plan([], 2300, -2300, ['410', '522']));
    expect(html).toContain('data-transfer-short="selected"');
    expect(text(html)).toContain('يُؤخذ كل المتاح في السيارات المحددة (');
  });

  it('says so when the twenty-car limit stopped it — and greys a pick past the limit', () => {
    const many: TakeSource[] = Array.from({ length: 22 }, (_, i) => ({
      vehicleId: `c${i + 1}`,
      code: String(i + 1),
      available: 100,
    }));
    const limited = planTransfer({
      cars: many,
      picked: many.map((car) => car.vehicleId),
      typed: null,
      remaining: -2500,
    });
    const html = planView(limited);
    expect(html).toContain('data-transfer-short="limit"');
    expect(text(html)).toContain('يُؤخذ من 20 سيارة على الأكثر في المرة الواحدة');
    const over = html.split('<tr').filter((row) => row.includes('data-transfer-over-limit'));
    expect(over).toHaveLength(2);
    expect(text(over[0] ?? '')).toContain(ar('fleet.accidents.transfer.overLimit', { max: 20 }));
  });

  it('a box holding no number (a lone «.») is refused as a 0 — never «NaN» rows or an empty save', () => {
    // The form reads the box with `Number(typed)`; `MoneyInput` keeps a lone «.», which is NaN.
    expect(CODE).toContain("const typedAmount = typed === '' ? null : Number(typed);");
    const refused = plan(['214'], Number('.'));
    expect([refused.mode, refused.problem, refused.rows]).toEqual(['typed', { kind: 'zero' }, []]);
    expect(planView(refused)).not.toContain('NaN');
    expect(transferBody(refused), 'Save is refused, not sent as an empty transfer').toBeUndefined();
    // …so the guard holds the save and names the amount box with the plan's own words.
    expect(CODE).toContain("const transferOk = plan.mode === 'none' || transfer !== undefined;");
  });
});

describe('a save refused — under the field, and in the banner', () => {
  const t = (key: string, params?: Record<string, string | number>): string => ar(key, params);
  const money = (value: number): string => formatMoney(value, 'EGP', 'ar');

  it('the banner gives the REASON for a value that is entered, not «أدخل»', () => {
    const html = renderToStaticMarkup(
      <Provider store={store()}>
        <RefusedBanner
          missing={[]}
          refused={ar('fleet.accidents.refusedLine', {
            field: ar('fleet.accidents.transfer.amount'),
            reason: ar('fleet.accidents.transfer.overDeficit', { max: money(2300) }),
          })}
          attempt={1}
        />
      </Provider>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-refused="true"');
    expect(text(html)).toContain(ar('common.validation.notSaved'));
    expect(text(html)).toContain('المبلغ المأخوذ: لا يمكن أخذ أكثر من سالب هذا الحادث (');
    expect(text(html)).not.toContain('أدخل البيانات المطلوبة');
  });

  it('…and still names what is missing beside it', () => {
    const html = renderToStaticMarkup(
      <Provider store={store()}>
        <RefusedBanner
          missing={[{ key: 'culprit', label: ar('fleet.accidents.fields.culprit'), ok: false }]}
          refused="x"
          attempt={1}
        />
      </Provider>,
    );
    expect(text(html)).toContain('أدخل البيانات المطلوبة: المتسبب.');
  });

  it('is the one banner a form keeps: a refused transfer, or the missing values', () => {
    expect(CODE).toContain('refusedSave && transferProblem !== null ? (');
    expect(CODE.match(/<MissingFieldsBanner\b/gu)).toHaveLength(1);
    // A refusal sits under what caused it: the amount when one is typed, the cars otherwise.
    expect(CODE).toContain(
      "const underAmount = plan.mode === 'typed' && transferProblem !== null;",
    );
    expect(CODE).toContain("const underCars = plan.mode !== 'typed' && transferProblem !== null;");
  });

  it('the plan’s own refusals are worded as the owner approved', () => {
    expect(ar('fleet.accidents.transfer.zero')).toBe('اكتب مبلغاً أكبر من صفر، أو اتركه فارغاً');
    expect(ar('fleet.accidents.transfer.overDeficit', { max: 'x' })).toBe(
      'لا يمكن أخذ أكثر من سالب هذا الحادث (x)',
    );
    expect(ar('fleet.accidents.transfer.noDeficit')).toBe(
      'لا يوجد سالب على هذا الحادث لتغطيته من سيارة أخرى',
    );
  });

  it('words the server’s «cars short» refusal with its figures', () => {
    const error = new ApiError(ErrorCodes.FLEET_ACCIDENT_TRANSFER_SHORT, 'short', 422, [
      { field: 'available', code: 'AVAILABLE', message: '1200.50' },
      { field: 'amount', code: 'AMOUNT', message: '1500.00' },
    ]);
    const words = transferRefusalOf(error, t, money, 'ar') ?? '';
    expect(words).toContain('1,200.50');
    expect(words).toContain('1,500.00');
    expect(words).toContain('لم يعد في السيارات المحددة ما يكفي');
  });

  it('words the server’s «over this file’s negative» refusal with the negative', () => {
    const over = new ApiError(ErrorCodes.FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT, 'over', 422, [
      { field: 'deficit', code: 'DEFICIT', message: '2300.00' },
      { field: 'amount', code: 'AMOUNT', message: '2500.00' },
    ]);
    expect(transferRefusalOf(over, t, money, 'ar')).toBe(
      ar('fleet.accidents.transfer.overDeficit', { max: money(2300) }),
    );
    const none = new ApiError(ErrorCodes.FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT, 'over', 422, [
      { field: 'deficit', code: 'DEFICIT', message: '0.00' },
      { field: 'amount', code: 'AMOUNT', message: '100.00' },
    ]);
    expect(transferRefusalOf(none, t, money, 'ar')).toBe(ar('fleet.accidents.transfer.noDeficit'));
  });

  it('falls back to the code’s own Arabic sentence without figures, and leaves others alone', () => {
    const bare = new ApiError(ErrorCodes.FLEET_ACCIDENT_TRANSFER_SHORT, 'short', 422);
    expect(transferRefusalOf(bare, t, money, 'ar')).toBe(errorMessage(bare, 'ar'));
    expect(errorMessage(bare, 'ar')).not.toBe('short');
    expect(
      transferRefusalOf(new ApiError('NOT_FOUND', 'gone', 404), t, money, 'ar'),
      'a 404 keeps the usual toast',
    ).toBeNull();
    expect(transferRefusalOf(new Error('x'), t, money, 'ar')).toBeNull();
  });

  it('both refusals have Arabic and English sentences of their own', () => {
    for (const code of [
      ErrorCodes.FLEET_ACCIDENT_TRANSFER_SHORT,
      ErrorCodes.FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT,
    ]) {
      const error = new ApiError(code, 'English server sentence', 422);
      expect(errorMessage(error, 'ar')).not.toBe('English server sentence');
      expect(errorMessage(error, 'ar')).toMatch(/[؀-ۿ]/u);
      expect(errorMessage(error, 'en')).not.toBe('English server sentence');
    }
  });
});

describe('the save and its failure', () => {
  it('sends only the cars that give, in the plan’s order, with the amount they give', () => {
    expect(CODE).toContain('const transfer = balances.isError ? undefined : transferBody(plan);');
    expect(CODE).toContain('...(transfer === undefined ? {} : { transfer }),');
    expect(CODE).toContain('if (transfer !== undefined) body.transfer = transfer;');
    // Short of the target is allowed: the save goes with what the cars give.
    expect(CODE).toContain("const transferOk = plan.mode === 'none' || transfer !== undefined;");
  });

  it('record and edit have their own onError: the accidents read again, the form words its two', () => {
    expect(CODE).toContain('useCreateAccident(isTransferRefusal)');
    expect(CODE).toContain('useUpdateAccident(isTransferRefusal)');
    const save = QUERIES.slice(QUERIES.indexOf('const useAccidentSave'));
    const body = save.slice(0, save.indexOf('export const useCreateAccident'));
    expect(body).toContain('onError: (error: unknown) => {');
    expect(body).toContain('void qc.invalidateQueries({ queryKey: fleetKeys.accidents });');
    expect(body).toContain('toastUnlessSaid(said)(error);');
    // Close, reopen, delete and void keep the shared hook — and its global toast.
    const shared = QUERIES.slice(
      QUERIES.indexOf('const useAccidentMutation'),
      QUERIES.indexOf('const useAccidentSave'),
    );
    expect(shared).not.toContain('onError');
    for (const hook of ['useSetAccidentStatus', 'useDeleteAccident', 'useVoidAccidentTransfer']) {
      const at = QUERIES.indexOf(`export const ${hook}`);
      expect(QUERIES.slice(at, at + 200), hook).toContain('useAccidentMutation(');
    }
  });

  it('keeps the form open with what was typed when the save fails, and says why', () => {
    const submit = CODE.slice(CODE.indexOf('const submit'), CODE.indexOf('const remainingTone'));
    expect(submit).toContain('const refusal = transferRefusalOf(error, t, money, locale);');
    expect(submit).toContain('setServerRefusal(refusal);');
    expect(submit.indexOf('onClose();')).toBeGreaterThan(submit.indexOf('catch (error)'));
  });
});

// ── the culprit's NAME, which once made the form unsubmittable ─────────────────────────────────
//
// «المتسبب» is the drivers picker, which also writes the culprit NAME the contract requires and
// Save refuses to go without. The name used to be read from a map keyed on the id ALREADY in
// state; inside the picker's `onChange` the chosen id is by construction NOT that id, so the
// lookup missed and the name was written as ''. The pick is now a REQUEST for a name.
describe('the culprit’s name outlives the moment it was picked', () => {
  it('never writes an empty name just because the record has not arrived', () => {
    expect(CODE).not.toContain("(drivers.get(picked) ?? '')");
  });

  it('records the pick as a REQUEST and fills the name in when the directory answers', () => {
    expect(CODE).toContain('setAwaitingNameFor');
    expect(CODE).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,200}awaitingNameFor[\s\S]{0,200}setCulprit\(resolvedName\)/,
    );
  });

  it('clearing the drivers still clears the name', () => {
    expect(CODE).toMatch(/if \(next\.length === 0\) \{[\s\S]{0,120}setCulprit\(''\)/);
  });

  it('says why Save waits while the name is on its way, in both languages', () => {
    expect(FORM).toContain('fleet.accidents.culpritNameLoading');
    expect(I18N.match(/'fleet\.accidents\.culpritNameLoading':/g)?.length).toBe(2);
  });

  it('leaves an already-filed name alone — it is the historical fact', () => {
    expect(CODE).toContain("setCulprit(accident?.culprit ?? '')");
    expect(CODE).toMatch(
      /setCulprit\(accident\?\.culprit \?\? ''\)[\s\S]{0,400}setAwaitingNameFor\(''\)/,
    );
  });

  it('lets the clerk pick more than one driver, and files all of them', () => {
    expect(CODE).toMatch(/<RegistryDriverPicker\s+value=\{culpritEmployeeIds\}\s+multiple/);
    expect(CODE).toContain('body.culpritEmployeeIds = culpritEmployeeIds;');
    expect(CODE).toContain("names.join('، ')");
  });
});

// «يجيلوا مسدج انه فى كذا وكذا وكذا المفروض يدخلهم» — Save stays pressable; a press with something
// missing sends nothing, lists what is missing and turns those boxes red.
describe('Save names what is missing instead of sitting disabled', () => {
  const RULES = CODE.slice(CODE.indexOf('useRequiredFields('), CODE.indexOf('const submit'));

  it('still refuses every value the old gate refused, each on its own field', () => {
    expect(RULES).toContain("ok: vehicleId !== ''");
    expect(RULES).toContain("ok: occurredAt !== ''");
    expect(RULES).toContain("ok: culprit.trim() !== ''");
    expect(RULES).toContain("ok: statement.trim() !== ''");
    expect(CODE).toContain("v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;");
    for (const key of [
      'vehicle',
      'occurredAt',
      'culprit',
      'statement',
      'companyCost',
      'amountCollected',
      'paidAmount',
    ]) {
      expect(RULES, `${key} is a rule`).toContain(`key: '${key}'`);
      expect(CODE, `${key} turns red when it is missing`).toContain(
        `missing={required.isMissing('${key}')}`,
      );
    }
    // The transfer: a refused one marks the field that caused it.
    expect(RULES).toContain("key: 'transfer'");
    expect(RULES).toContain('ok: transferOk');
    expect(CODE).toContain("required.isMissing('transfer') && plan.mode !== 'typed'");
    expect(CODE).toContain("required.isMissing('transfer') && plan.mode === 'typed'");
  });

  it('starts clean every time the form is opened', () => {
    expect(RULES).toMatch(/\],\s*open,\s*\);/u);
  });
});

describe('«كود السيارة» on the accident form — typed, and every car', () => {
  it('is a box the clerk can type the code into, offering the whole registry', () => {
    expect(CODE).toMatch(/<VehicleCodeCombobox(?:(?!\/>)[\s\S])*?\banyStatus\b/u);
    expect(CODE).not.toContain('<VehicleSelect');
    expect(ar('fleet.accidents.vehiclePlaceholder')).toBe('اكتب الكود أو اختر…');
  });

  it('never carries the car card — a form is not a register', () => {
    expect(CODE).not.toContain('VehicleHoverCode');
    expect(CODE).not.toContain('useVehicleHoverCard');
  });
});

describe('every new word is in both languages', () => {
  it.each([
    'fleet.accidents.transferLine.in',
    'fleet.accidents.transferLine.out',
    'fleet.accidents.form.sections.incident',
    'fleet.accidents.form.sections.amounts',
    'fleet.accidents.form.remaining',
    'fleet.accidents.transfer.amountHint',
    'fleet.accidents.transfer.amountHintNoPick',
    'fleet.accidents.transfer.amountWorkedOut',
    'fleet.accidents.transfer.coverAll',
    'fleet.accidents.transfer.manual',
    'fleet.accidents.transfer.auto',
    'fleet.accidents.transfer.unneeded',
    'fleet.accidents.transfer.overLimit',
    'fleet.accidents.transfer.planNote',
    'fleet.accidents.transfer.planNoteManual',
    'fleet.accidents.transfer.shortAll',
    'fleet.accidents.transfer.shortSelected',
    'fleet.accidents.transfer.shortLimit',
    'fleet.accidents.transfer.overDeficit',
    'fleet.accidents.transfer.zero',
    'fleet.accidents.transfer.nothingToTake',
    'fleet.accidents.transfer.refusedShort',
    'fleet.accidents.refusedLine',
  ])('%s', (key) => {
    expect(I18N.split(`'${key}':`).length - 1, 'in the ar block and the en block').toBe(2);
    expect(translate('en', key)).not.toBe(key);
    expect(translate('ar', key)).not.toBe(key);
  });
});

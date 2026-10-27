// /atm/preparation «الشوالات والسيلزات», rendered from a pre-filled query cache
// (docs/12-planning/atm-settlements-phase1.md §9.6, §10.4):
//
//   · a cancelled line opens read only — its values shown, nothing to save or mark;
//   · «تم التجهيز» stays disabled while a required seal or QR is missing, and says what;
//   · the fields are the wedge's: left-to-right, no autocomplete, no spell check, in the scan order
//     (bag 1's cassettes, bag 1's QR, bag 2's cassettes, bag 2's QR);
//   · a 0-note cassette and an all-zero bag's QR are optional;
//   · «المسلسل أو رقم الماكينة» finds a line by its serial, a voided serial, or its code.
//
// Every code, seal and count below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  type AtmPreparationContextDto,
  type AtmPreparationLineDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { PreparationPage, findLine, linesOfCode } from './pages/PreparationPage';
import { preparationContextKey, preparationLinesKey } from './api/settlements-queries';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const BRANCH = '66a000000000000000000021';
const PLAN = '66c000000000000000000021';

const line = (n: number, over: Partial<AtmPreparationLineDto> = {}): AtmPreparationLineDto => ({
  lineId: `66d0000000000000000001${String(n).padStart(2, '0')}`,
  planId: PLAN,
  serial: 200 + n,
  voidedSerials: [],
  lineStatus: 'issued',
  kind: 'machine',
  machineCode: `BRKN91${String(n).padStart(2, '0')}`,
  machineName: `ماكينة اختبار ${String(n)}`,
  area: 'منطقة تجريبية',
  hubLabel: null,
  typeLabel: 'SYN (S2)',
  spareCode: null,
  run: 1,
  scheduleTime: '09:00',
  egpTotalMinor: 30_000_000,
  slots: [
    { slot: 1, kind: 'withdrawal', denomination: 200, currency: 'EGP', notes: 1000, bag: 1 },
    { slot: 2, kind: 'withdrawal', denomination: 100, currency: 'EGP', notes: 1000, bag: 1 },
    { slot: 3, kind: 'withdrawal', denomination: 20, currency: 'EGP', notes: 0, bag: 1 },
  ],
  preparation: {
    id: `66f0000000000000000001${String(n).padStart(2, '0')}`,
    version: 0,
    status: 'open',
    bags: [{ bag: 1, slots: [1, 2, 3], qr: null, required: true }],
    seals: [
      { slot: 1, value: null, required: true },
      { slot: 2, value: null, required: true },
      { slot: 3, value: null, required: false },
    ],
    lastCapturedByName: null,
    lastCapturedAt: null,
    preparedByName: null,
    preparedAt: null,
  },
  progress: { captured: 0, required: 3 },
  warnings: [],
  duplicates: [],
  ...over,
});

const CONTEXT: AtmPreparationContextDto = {
  branch: { id: BRANCH, name: { ar: 'فرع تجريبي', en: 'SYN branch' } },
  date: '2026-10-28',
  canCapture: true,
  plans: [
    { planId: PLAN, bankCode: 'BRK', lines: 3, prepared: 0, complete: 0, partial: 1, none: 1 },
  ],
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'atmPreparation.view': 'branch', 'atmPreparation.capture': 'branch' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (lines: AtmPreparationLineDto[], open: string | null): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(preparationContextKey(null), CONTEXT);
  qc.setQueryData(preparationLinesKey(PLAN), lines);
  const url = open === null ? '/atm/preparation' : `/atm/preparation?line=${open}`;
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <PreparationPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const CANCELLED = line(1, {
  lineStatus: 'cancelled',
  preparation: {
    ...line(1).preparation,
    bags: [{ bag: 1, slots: [1, 2, 3], qr: 'QR-T-0001', required: true }],
    seals: [
      { slot: 1, value: 'SEAL-T-0001', required: true },
      { slot: 2, value: null, required: true },
      { slot: 3, value: null, required: false },
    ],
  },
});
const OPEN = line(2);

describe('a cancelled line', () => {
  const html = render([CANCELLED, OPEN], CANCELLED.lineId);
  const panel = html.slice(html.indexOf('data-capture-panel'));

  it('opens with its values, every field read only', () => {
    expect(panel).toContain('value="SEAL-T-0001"');
    expect(panel).toContain('value="QR-T-0001"');
    const inputs = [...panel.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    expect(inputs.length).toBe(4);
    for (const input of inputs) expect(input).toContain('disabled=""');
  });

  it('offers no save, no «تم التجهيز» and no reopen, and says it is cancelled', () => {
    expect(panel).not.toContain(`>${t('atm.prep.save')}<`);
    expect(panel).not.toContain('data-capture-prepared');
    expect(panel).not.toContain(t('atm.prep.reopen'));
    expect(panel).toContain(t('atm.settlement.status.cancelled'));
  });

  it('lists as «ملغاة» in the day’s lines', () => {
    const list = html.slice(html.indexOf('data-prep-lines'), html.indexOf('data-capture-panel'));
    expect(list).toContain(t('atm.settlement.status.cancelled'));
  });
});

describe('«تم التجهيز» on an open line', () => {
  const html = render([CANCELLED, OPEN], OPEN.lineId);
  const panel = html.slice(html.indexOf('data-capture-panel'));
  const button = /<button[^>]*data-capture-prepared="true"[^>]*>/.exec(panel)?.[0] ?? '';

  it('is disabled while required values are missing, and names them', () => {
    expect(button).toContain('disabled=""');
    const missing = [
      t('atm.prep.sealLabel', { slot: 1 }),
      t('atm.prep.sealLabel', { slot: 2 }),
      t('atm.prep.qrLabel.1'),
    ].join('، ');
    expect(button).toContain(`title="${t('atm.prep.error.incomplete', { list: missing })}"`);
    expect(panel).toContain('data-capture-missing');
  });

  it('never waits for the 0-note cassette: its seal is optional', () => {
    expect(button).not.toContain(t('atm.prep.sealLabel', { slot: 3 }));
    expect(panel).toContain(t('atm.prep.optional'));
  });

  it('offers «حفظ», which never waits for anything', () => {
    expect(panel).toMatch(new RegExp(`<button[^>]*id="capture-save"[^>]*>${t('atm.prep.save')}<`));
    const save = /<button[^>]*id="capture-save"[^>]*>/.exec(panel)?.[0] ?? '';
    expect(save).not.toContain('disabled=""');
  });

  it('is enabled once every required value is in', () => {
    const ready = line(2, {
      preparation: {
        ...OPEN.preparation,
        bags: [{ bag: 1, slots: [1, 2, 3], qr: 'QR-T-0002', required: true }],
        seals: [
          { slot: 1, value: 'SEAL-T-0021', required: true },
          { slot: 2, value: 'SEAL-T-0022', required: true },
          { slot: 3, value: null, required: false },
        ],
      },
      progress: { captured: 3, required: 3 },
    });
    const done = render([ready], ready.lineId);
    const enabled = /<button[^>]*data-capture-prepared="true"[^>]*>/.exec(done)?.[0] ?? '';
    expect(enabled).not.toContain('disabled=""');
    expect(enabled).not.toContain('title=');
  });
});

describe('the wedge fields', () => {
  const html = render([OPEN], OPEN.lineId);
  const inputs = [...html.slice(html.indexOf('data-capture-panel')).matchAll(/<input[^>]*>/g)].map(
    (m) => m[0],
  );

  it('are codes: left to right, no autocomplete, no spell check', () => {
    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      expect(input).toContain('dir="ltr"');
      expect(input).toContain('autoComplete="off"');
      expect(input).toContain('spellcheck="false"');
    }
  });

  it('come in the scan order: the bag’s cassettes, then its QR', () => {
    expect(inputs.map((i) => /id="([^"]+)"/.exec(i)?.[1])).toEqual([
      'capture-seal-1',
      'capture-seal-2',
      'capture-seal-3',
      'capture-qr-1',
    ]);
  });

  it('carry their labels (§9.10)', () => {
    expect(html).toContain(`for="capture-seal-1"`);
    expect(html).toContain(t('atm.prep.sealLabel', { slot: 1 }));
    expect(html).toContain(t('atm.prep.qrLabel.1'));
  });
});

describe('«المسلسل أو رقم الماكينة»', () => {
  const second = line(3, { run: 2, scheduleTime: '21:00', serial: 210, machineCode: 'BRKN9101' });
  const first = line(1, { voidedSerials: [150] });

  it('finds a line by its serial', () => {
    expect(findLine([first, OPEN], '202')?.line.lineId).toBe(OPEN.lineId);
  });

  it('resolves a voided serial to its line, and says so', () => {
    expect(findLine([first, OPEN], '150')).toEqual({ line: first, voided: true });
  });

  it('reads Arabic-Indic digits and a scanner’s trailing CR', () => {
    expect(findLine([first, OPEN], '٢٠٢\r')?.line.lineId).toBe(OPEN.lineId);
  });

  it('opens the first line of a code not yet prepared when it has two runs', () => {
    const prepared = { ...first, lineStatus: 'prepared' as const };
    expect(findLine([prepared, second], 'BRKN9101')?.line.lineId).toBe(second.lineId);
  });

  it('finds nothing for an unknown value', () => {
    expect(findLine([first], 'NOPE')).toBeNull();
  });

  it('lists every line of a code in run order — the page names them all (§9.6)', () => {
    expect(linesOfCode([second, first, OPEN], 'BRKN9101\r').map((l) => l.lineId)).toEqual([
      first.lineId,
      second.lineId,
    ]);
    expect(linesOfCode([first], '')).toEqual([]);
  });
});

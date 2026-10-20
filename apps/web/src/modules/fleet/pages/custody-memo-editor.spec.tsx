// «مذكرة جديدة» / «تعديل المذكرة» — the editor's rules, proved on the pure helpers, and the page
// rendered to markup against a seeded cache at each of its addresses: a new memo of each kind, an
// edit, and a memo the fund has replenished.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  FLEET_CUSTODY_MEMO_MAX_LINES,
  type FleetCustodyMemoCandidateDto,
  type FleetCustodyMemoCandidatesDto,
  type FleetCustodyMemoDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySource,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { custodyQueryKeys } from '../api/fleet-queries';
import { today } from '../components/LicenseExpensePaidGroup';
import { CustodyMemoEditorPage } from './CustodyMemoEditorPage';
import {
  MEMO_MAX_LINES,
  NO_TYPING,
  codeOptions,
  defaultMemoKind,
  editPeriodOf,
  headTick,
  initialTicks,
  memoBody,
  memoKindOf,
  memoRefusalOf,
  memoUpdateBody,
  monthOfDay,
  paperLinesOf,
  periodOf,
  pickedLines,
  pickedTotal,
  tickNewcomers,
  toggleAllShown,
  toggleOne,
  typedOf,
  visibleRows,
  type PickedLine,
} from '../lib/custody-memo-editor';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();

const id = (n: number): string => `67000000000000000000${String(n).padStart(4, '0')}`;
const receipt = (
  n: number,
  over: Partial<FleetCustodyMemoCandidateDto> = {},
): FleetCustodyMemoCandidateDto => ({
  id: id(n),
  date: '2026-10-06',
  vehicleId: `68000000000000000000${String(n).padStart(4, '0')}`,
  vehicleCode: '248',
  driverEmployeeId: null,
  driverName: null,
  amount: 100,
  fuelType: null,
  litres: null,
  company: null,
  suggestedMission: null,
  inThisMemo: false,
  ...over,
});

// ── The rules ─────────────────────────────────────────────────────────────────────────────────

describe('which kind «مذكرة جديدة» opens on', () => {
  it('reads a kind out of the address, and nothing else', () => {
    expect(memoKindOf('tyres')).toBe('tyres');
    expect(memoKindOf('dealership')).toBeNull();
    expect(memoKindOf(undefined)).toBeNull();
  });

  it('opens on the first kind, in the custody screen’s order, with receipts waiting — else صيانة', () => {
    const outside = (counts: Record<FleetCustodySource, number>): FleetCustodyOutsideKindDto[] =>
      (['maintenance', 'fuel', 'tyres', 'wash'] as const).map((kind) => ({
        kind,
        count: counts[kind],
        total: counts[kind] * 10,
        oldest: counts[kind] > 0 ? '2026-10-06' : null,
        stale: { count: 0, total: 0 },
      }));
    expect(defaultMemoKind(outside({ maintenance: 0, fuel: 0, tyres: 18, wash: 4 }))).toBe('tyres');
    expect(defaultMemoKind(outside({ maintenance: 0, fuel: 8, tyres: 18, wash: 0 }))).toBe('fuel');
    expect(defaultMemoKind(outside({ maintenance: 0, fuel: 0, tyres: 0, wash: 0 }))).toBe(
      'maintenance',
    );
    expect(defaultMemoKind(undefined)).toBe('maintenance');
  });
});

describe('the period', () => {
  it('runs from the first waiting receipt’s day to the last — today when none waits', () => {
    expect(
      periodOf(
        [{ date: '2026-10-18' }, { date: '2026-10-06' }, { date: '2026-10-07' }],
        '2026-10-19',
      ),
    ).toEqual({ from: '2026-10-06', to: '2026-10-18' });
    expect(periodOf([], '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-19' });
  });

  it('opens an edit on the memo’s own period, widened to every receipt it holds', () => {
    expect(
      editPeriodOf({
        from: '2026-09-05',
        to: '2026-09-20',
        lines: [{ date: '2026-09-03' }, { date: '2026-09-25' }] as FleetCustodyMemoDto['lines'],
      }),
    ).toEqual({ from: '2026-09-03', to: '2026-09-25' });
    expect(editPeriodOf({ from: '2026-09-01', to: '2026-09-30', lines: [] })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});

describe('what is on show, and what the memo is', () => {
  const rows = [
    receipt(1, { date: '2026-10-05', vehicleCode: '177' }),
    receipt(2, { date: '2026-10-06', vehicleCode: '248' }),
    receipt(3, { date: '2026-10-18', vehicleCode: '177' }),
    receipt(4, { date: '2026-10-19', vehicleCode: null }),
  ];

  it('lets through the period’s days, both ends included, an emptied end left open', () => {
    const ids = (r: FleetCustodyMemoCandidateDto[]): string[] => r.map((x) => x.id);
    expect(ids(visibleRows(rows, { from: '2026-10-06', to: '2026-10-18' }, []))).toEqual([
      id(2),
      id(3),
    ]);
    expect(ids(visibleRows(rows, { from: '', to: '2026-10-06' }, []))).toEqual([id(1), id(2)]);
    expect(ids(visibleRows(rows, { from: '2026-10-18', to: '' }, []))).toEqual([id(3), id(4)]);
  });

  it('keeps only the chosen cars while codes are chosen — a receipt with no code is then hidden', () => {
    expect(visibleRows(rows, { from: '', to: '' }, ['177']).map((r) => r.id)).toEqual([
      id(1),
      id(3),
    ]);
  });

  it('is the ticked rows ON SHOW — a tick the filter hides is kept, but not in the memo', () => {
    const ticked = new Set([id(1), id(2), id(3)]);
    const shown = visibleRows(rows, { from: '', to: '' }, ['177']);
    const picked = pickedLines(shown, ticked, { [id(3)]: { ...NO_TYPING, note: 'x' } });
    expect(picked.map((line) => line.receipt.id)).toEqual([id(1), id(3)]);
    expect(picked[1]?.typed.note).toBe('x');
    expect(picked[0]?.typed).toEqual(NO_TYPING);
    // The hidden tick (row 2) is still there for when the filter is cleared.
    expect(ticked.has(id(2))).toBe(true);
  });

  it('offers the codes the list holds, once each, in the fleet’s order', () => {
    expect(codeOptions(rows).map((o) => o.value)).toEqual(['177', '248']);
  });

  it('adds the memo up in whole piastres', () => {
    const lines = [0.1, 0.2, 1037.1].map((amount, i): PickedLine => ({
      receipt: receipt(i, { amount }),
      typed: NO_TYPING,
    }));
    expect(pickedTotal(lines)).toBe(1037.4);
  });
});

describe('the ticks', () => {
  const rows = [1, 2, 3].map((n) => receipt(n, { inThisMemo: n === 2 }));

  it('a new memo opens with every receipt ticked; an edit with its own lines only', () => {
    expect([...initialTicks(rows, false)]).toEqual([id(1), id(2), id(3)]);
    expect([...initialTicks(rows, true)]).toEqual([id(2)]);
  });

  it('a receipt seen later is ticked on a new memo and left alone on an edit — the others keep what the reader made of them', () => {
    const before = { seen: new Set([id(1), id(2)]), ticked: new Set([id(2)]) };
    const later = [...rows, receipt(4, { inThisMemo: false })];
    const fresh = tickNewcomers(later, before.seen, before.ticked, false);
    expect([...fresh.ticked].sort()).toEqual([id(2), id(3), id(4)]);
    const edit = tickNewcomers(later, before.seen, before.ticked, true);
    expect([...edit.ticked]).toEqual([id(2)]);
    expect(edit.seen.size).toBe(4);
  });

  it('never ticks past what one memo holds', () => {
    expect(initialTicks(rows, false, 2).size).toBe(2);
    expect(MEMO_MAX_LINES).toBe(FLEET_CUSTODY_MEMO_MAX_LINES);
  });

  it('the head’s tick speaks for the rows on show: on, a dash, or off', () => {
    expect(headTick(rows, new Set([id(1), id(2), id(3)]))).toEqual({ on: true, partly: false });
    expect(headTick(rows, new Set([id(1)]))).toEqual({ on: false, partly: true });
    expect(headTick(rows, new Set())).toEqual({ on: false, partly: false });
    expect(headTick([], new Set())).toEqual({ on: false, partly: false });
    // A memo as full as it can be reads as all of it.
    expect(headTick(rows, new Set([id(1), id(2)]), 2)).toEqual({ on: true, partly: false });
  });

  it('the head ticks the rows on show up to the cap, and unticks only them', () => {
    const hidden = id(9);
    const all = toggleAllShown(rows, new Set([hidden]));
    expect([...all.ticked].sort()).toEqual([id(1), id(2), id(3), hidden].sort());
    expect(all.capped).toBe(false);
    const none = toggleAllShown(rows, all.ticked);
    expect([...none.ticked]).toEqual([hidden]);
    const capped = toggleAllShown(rows, new Set(), 2);
    expect(capped).toEqual({ ticked: new Set([id(1), id(2)]), capped: true });
  });

  it('one tick on, one off — refused past the cap', () => {
    expect(toggleOne(id(1), rows, new Set()).ticked.has(id(1))).toBe(true);
    expect(toggleOne(id(1), rows, new Set([id(1)])).ticked.has(id(1))).toBe(false);
    const full = toggleOne(id(3), rows, new Set([id(1), id(2)]), 2);
    expect(full.capped).toBe(true);
    expect(full.ticked.has(id(3))).toBe(false);
  });

  it('caps the head’s «تحديد الكل» on the page through the same rule', () => {
    const page = source('CustodyMemoEditorPage.tsx');
    expect(page).toContain('toggleAllShown(shown, ticked)');
    expect(page).toContain('toggleOne(id, shown, ticked)');
  });
});

describe('what a line types first', () => {
  it('proposes a fuel receipt’s mission, and keeps an edit’s saved cells', () => {
    expect(typedOf({ suggestedMission: 'نقل اموال' })).toEqual({
      mission: 'نقل اموال',
      statement: '',
      note: '',
    });
    expect(typedOf({ suggestedMission: null })).toEqual(NO_TYPING);
    expect(
      typedOf({ suggestedMission: 'نقل اموال' }, { mission: 'سفر', statement: '', note: 'ن' }),
    ).toEqual({ mission: 'سفر', statement: '', note: 'ن' });
  });
});

describe('the request body', () => {
  const typed = { mission: ' سفر ', statement: ' إطار ', note: ' ملاحظة ' };
  const picked: PickedLine[] = [{ receipt: receipt(1), typed }];
  const draft = (kind: FleetCustodySource, over: Partial<Parameters<typeof memoBody>[0]> = {}) => ({
    kind,
    name: '  كاوتش   أكتوبر 2026 ',
    date: '2026-10-19',
    period: { from: '2026-10-06', to: '2026-10-18' },
    picked,
    ...over,
  });

  it('carries each line’s typed cells only where his paper of the kind has a column', () => {
    expect(memoBody(draft('fuel')).lines).toEqual([
      { receiptId: id(1), mission: 'سفر', statement: '', note: 'ملاحظة' },
    ]);
    expect(memoBody(draft('maintenance')).lines).toEqual([
      { receiptId: id(1), mission: '', statement: 'إطار', note: 'ملاحظة' },
    ]);
    for (const kind of ['tyres', 'wash'] as const) {
      expect(memoBody(draft(kind)).lines).toEqual([
        { receiptId: id(1), mission: '', statement: '', note: '' },
      ]);
    }
  });

  it('sends the name with its spaces made one, and the three days as dates', () => {
    const body = memoBody(draft('tyres'));
    expect(body.kind).toBe('tyres');
    expect(body.name).toBe('كاوتش أكتوبر 2026');
    expect(body.date?.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(body.from?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(body.to?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('leaves an emptied date box OUT — never an empty string the server would refuse', () => {
    const body = memoBody(draft('tyres', { date: '', period: { from: '', to: '' } }));
    expect('date' in body).toBe(false);
    expect('from' in body).toBe(false);
    expect('to' in body).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/"(?:date|from|to)":/u);
    const named = memoBody(draft('tyres', { name: '   ' }));
    expect(named.name).toBe('');
  });

  it('sends an edit whole, with the version it was read at', () => {
    const body = memoUpdateBody(draft('tyres', { date: '' }), 3);
    expect(body.version).toBe(3);
    expect('date' in body).toBe(false);
    expect(body.lines).toHaveLength(1);
  });

  it('gives the paper the lines picked, by code and day — never the memo’s name', () => {
    expect(paperLinesOf(picked)).toEqual([
      {
        code: '248',
        date: '2026-10-06',
        amount: 100,
        mission: ' سفر ',
        statement: ' إطار ',
        note: ' ملاحظة ',
      },
    ]);
  });
});

describe('a refused save, named', () => {
  it('tells each refusal apart, and leaves anything else to its usual words', () => {
    expect(
      memoRefusalOf(new ApiError('DUPLICATE', 'receipt x is already on custody memo 3', 409)),
    ).toBe('taken');
    expect(memoRefusalOf(new ApiError('STALE_DOCUMENT', 'refetch', 409))).toBe('stale');
    expect(memoRefusalOf(new ApiError('BUSINESS_RULE_VIOLATION', 'replenished', 422))).toBe(
      'locked',
    );
    expect(memoRefusalOf(new ApiError('NOT_FOUND', 'gone', 404))).toBe('gone');
    expect(
      memoRefusalOf(
        new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
          {
            field: 'body.lines.2.receiptId',
            code: 'INVALID',
            message: 'unknown or deleted receipt',
          },
        ]),
      ),
    ).toBe('changed');
    expect(
      memoRefusalOf(
        new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
          { field: 'body.name', code: 'too_big', message: 'too long' },
        ]),
      ),
    ).toBeNull();
    expect(memoRefusalOf(new ApiError('INTERNAL', 'boom', 500))).toBeNull();
    expect(memoRefusalOf(new TypeError('Failed to fetch'))).toBeNull();
  });

  it('says each in its own words and reads again what changed', () => {
    const page = source('CustodyMemoEditorPage.tsx');
    expect(page).toContain('t(`fleet.custody.memoEditor.refused.${refusal}`)');
    expect(page).toContain('void candidates.refetch();');
    expect(page).toContain('const fresh = await saved.refetch();');
  });
});

describe('the name the box suggests', () => {
  it('is the month the period ends in, the year in Latin digits', () => {
    expect(monthOfDay('2026-10-18', 'ar')).toBe('أكتوبر 2026');
    expect(monthOfDay('2026-10-18', 'en')).toBe('October 2026');
    expect(monthOfDay('', 'ar')).toBe('');
  });
});

// ── The page ──────────────────────────────────────────────────────────────────────────────────

const GRANTS = ['fleetCustody.view', 'fleetReceipt.create', 'fleetReceipt.edit'];
const me = (): MeDto =>
  ({
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
    permissions: Object.fromEntries(GRANTS.map((grant) => [grant, 'organization'])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const OUTSIDE: FleetCustodyOutsideKindDto[] = [
  { kind: 'maintenance', count: 3, total: 5720, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
  { kind: 'fuel', count: 8, total: 7876, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
  { kind: 'tyres', count: 18, total: 1690, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
  { kind: 'wash', count: 0, total: 0, oldest: null, stale: { count: 0, total: 0 } },
];
const TYRES = [
  receipt(1, { date: '2026-10-06', vehicleCode: '248', amount: 150 }),
  receipt(2, { date: '2026-10-07', vehicleCode: '177', amount: 80 }),
  receipt(3, { date: '2026-10-18', vehicleCode: '182', amount: 100 }),
];
const candidatesOf = (
  receipts: FleetCustodyMemoCandidateDto[],
  over: Partial<FleetCustodyMemoCandidatesDto> = {},
): FleetCustodyMemoCandidatesDto => ({
  nextNo: 7,
  receipts,
  missionOptions: ['نقل اموال', 'سفر'],
  truncated: false,
  ...over,
});

const memoOf = (over: Partial<FleetCustodyMemoDto> = {}): FleetCustodyMemoDto => ({
  id: '650000000000000000000007',
  no: 7,
  kind: 'tyres',
  name: 'كاوتش أكتوبر 2026',
  date: '2026-10-19',
  from: '2026-10-06',
  to: '2026-10-07',
  receipts: 2,
  total: 230,
  replenishment: null,
  version: 4,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  lines: TYRES.slice(0, 2).map((r) => ({
    receiptId: r.id,
    date: r.date,
    vehicleId: r.vehicleId,
    vehicleCode: r.vehicleCode,
    driverEmployeeId: null,
    driverName: null,
    amount: r.amount,
    fuelType: null,
    litres: null,
    mission: '',
    statement: '',
    note: '',
  })),
  signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.tyres,
  ...over,
});

const draw = (
  path: string,
  seed: {
    candidates?: { kind: FleetCustodySource; memoId?: string; data: FleetCustodyMemoCandidatesDto };
    memo?: FleetCustodyMemoDto;
  },
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(custodyQueryKeys.memosOutside(), OUTSIDE);
  qc.setQueryData(custodyQueryKeys.paperSettings(), {
    papers: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
    version: null,
  });
  if (seed.candidates !== undefined) {
    const { kind, memoId, data } = seed.candidates;
    qc.setQueryData(
      custodyQueryKeys.memoCandidates(memoId === undefined ? { kind } : { kind, memoId }),
      data,
    );
  }
  if (seed.memo !== undefined) qc.setQueryData(custodyQueryKeys.memo(seed.memo.id), seed.memo);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody/memos/new" element={<CustodyMemoEditorPage />} />
            <Route path="/fleet/custody/memos/new/:kind" element={<CustodyMemoEditorPage />} />
            <Route path="/fleet/custody/memos/:id" element={<CustodyMemoEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};
const newMemo = (
  kind: FleetCustodySource,
  receipts: FleetCustodyMemoCandidateDto[],
  over: Partial<FleetCustodyMemoCandidatesDto> = {},
): string =>
  draw(`/fleet/custody/memos/new/${kind}`, {
    candidates: { kind, data: candidatesOf(receipts, over) },
  });
const editMemo = (memo: FleetCustodyMemoDto, receipts: FleetCustodyMemoCandidateDto[]): string =>
  draw(`/fleet/custody/memos/${memo.id}`, {
    memo,
    candidates: { kind: memo.kind, memoId: memo.id, data: candidatesOf(receipts) },
  });

/** The opening tag carrying `mark`. */
const tag = (html: string, mark: string): string => {
  const at = html.indexOf(mark);
  expect(at, mark).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};
const footer = (html: string): string => {
  const at = html.indexOf('data-memo-footer="true"');
  return html.slice(at, html.indexOf('</footer>', at));
};
const preview = (html: string): string => html.slice(html.indexOf('data-memo-preview="true"'));
const subtitle = (html: string): string => {
  const at = html.indexOf('</h1>');
  return text(html.slice(at, html.indexOf('</p>', at)));
};

describe('«مذكرة جديدة» — a tyres memo', () => {
  const html = newMemo('tyres', TYRES);

  it('is the tyres editor, with its kind pressed and each kind’s waiting count', () => {
    expect(html).toContain('data-memo-editor="tyres"');
    expect(tag(html, 'data-memo-kind="tyres"')).toContain('aria-checked="true"');
    expect(tag(html, 'data-memo-kind="fuel"')).toContain('aria-checked="false"');
    expect(text(html.slice(html.indexOf('data-memo-kind-count="tyres"')))).toMatch(
      /^[^>]*>?\s*18/u,
    );
    expect(html).toContain('data-memo-kind-count="wash"');
  });

  it('shows «رقم N» — the number the next memo takes', () => {
    expect(html).toContain('data-memo-no="7"');
    expect(text(html)).toContain(ar('fleet.custody.memoEditor.noChip', { no: 7 }));
  });

  it('heads the page «مذكرة كاوتش رقم 7 — عن الفترة …» while no name is typed', () => {
    expect(subtitle(html)).toBe(
      `${ar('fleet.custody.parts.memoFallback', { kind: ar('fleet.custody.source.tyres'), no: 7 })} — ${ar(
        'fleet.custody.memoEditor.period',
        { from: '2026/10/06', to: '2026/10/18' },
      )}`,
    );
  });

  it('offers an optional name with an example, and the period and the memo’s date in our date boxes', () => {
    const name = tag(html, 'data-memo-name="true"');
    expect(name).toContain('maxLength="120"');
    expect(name).toContain('value=""');
    expect(name).not.toContain('required');
    expect(tag(html, 'data-memo-from="true"')).toContain('value="2026-10-06"');
    expect(tag(html, 'data-memo-to="true"')).toContain('value="2026-10-18"');
    expect(tag(html, 'data-memo-date="true"')).toContain(`value="${today()}"`);
    expect(tag(html, 'data-memo-from="true"')).toContain('type="date"');
  });

  it('filters by the app’s own «كود السيارة», offering the list’s cars', () => {
    expect(html).toContain('data-memo-code-filter="true"');
    expect(html).not.toContain('data-memo-filter-note');
    expect(source('CustodyMemoEditorPage.tsx')).toContain('<VehicleCodeFilter');
    expect(source('CustodyMemoEditorPage.tsx')).toMatch(/options=\{options\}/u);
  });

  it('opens with every waiting receipt ticked, the head’s tick on', () => {
    for (const r of TYRES)
      expect(tag(html, `data-memo-tick="${r.id}"`)).toContain('aria-checked="true"');
    expect(tag(html, 'data-memo-tick-all="true"')).toContain('aria-checked="true"');
    expect(html.match(/data-memo-line="/gu)).toHaveLength(3);
  });

  it('keeps its figure and its two saves in view: what is picked, the total, «حفظ المذكرة» and «حفظ وطباعة»', () => {
    const foot = footer(html);
    expect(foot).toContain('data-memo-selected="3"');
    expect(text(foot)).toContain(ar('fleet.custody.count.picked.lead'));
    expect(text(foot)).toContain(ar('fleet.custody.count.picked.few', { count: '3' }));
    expect(text(foot)).toContain('330.00');
    expect(tag(foot, 'data-memo-save="true"')).not.toContain('disabled=""');
    expect(tag(foot, 'data-memo-save-print="true"')).not.toContain('disabled=""');
    // Nothing is marked missing before a press.
    expect(html).not.toContain('data-missing-fields');
  });

  it('draws his tyres paper beside the form, from the lines picked', () => {
    const paper = preview(html);
    expect(paper).toContain('data-paper-page="memo-tyres:1"');
    expect(paper).toContain('data-paper-sheet="true"');
    for (const code of ['248', '177', '182']) expect(paper).toContain(code);
    expect(text(paper)).toContain(ar('fleet.custody.memoEditor.preview'));
  });

  it('has no «المأمورية», «البيان» or «ملاحظات» box — his tyres paper has none', () => {
    expect(html).not.toContain('data-memo-mission=');
    expect(html).not.toContain('data-memo-statement=');
    expect(html).not.toContain('data-memo-note=');
  });
});

describe('«مذكرة جديدة» — the footer counts as Arabic counts', () => {
  it.each([
    [1, 'one'],
    [2, 'two'],
    [11, 'many'],
    [100, 'other'],
  ] as const)('%i picked → the «%s» form', (n, form) => {
    const receipts = Array.from({ length: n }, (_, i) =>
      receipt(i + 1, { date: '2026-10-06', amount: 10 }),
    );
    const foot = footer(newMemo('wash', receipts));
    expect(foot).toContain(`data-memo-selected="${n}"`);
    expect(text(foot)).toContain(
      ar(`fleet.custody.count.picked.${form}`, { count: new Intl.NumberFormat('en-US').format(n) }),
    );
  });

  it('none waiting: nothing picked, said so, and the list says why it is empty', () => {
    const html = newMemo('wash', []);
    expect(footer(html)).toContain('data-memo-selected="0"');
    expect(text(footer(html))).toContain(ar('fleet.custody.count.picked.none'));
    expect(html).toContain('data-memo-empty="period"');
    expect(text(html)).toContain(
      ar('fleet.custody.memoEditor.emptyPeriod', { kind: ar('fleet.custody.source.wash') }),
    );
    // The period opens on today when nothing waits.
    expect(tag(html, 'data-memo-from="true"')).toContain(`value="${today()}"`);
  });

  it('says when the oldest receipts only were listed', () => {
    const html = newMemo('tyres', TYRES, { truncated: true });
    expect(html).toContain('data-memo-truncated="true"');
  });
});

describe('«مذكرة جديدة» — fuel and maintenance lines', () => {
  it('a fuel line takes «المأمورية» (proposed, with the roster’s list) and «ملاحظات»; its litres and type under the amount', () => {
    const html = newMemo('fuel', [
      receipt(1, {
        date: '2026-10-06',
        amount: 875,
        litres: 50,
        fuelType: 'diesel',
        suggestedMission: 'نقل اموال',
      }),
    ]);
    const mission = tag(html, `data-memo-mission="${id(1)}"`);
    expect(mission).toContain('value="نقل اموال"');
    expect(mission).toContain('list="custody-memo-missions"');
    expect(html).toContain('<datalist id="custody-memo-missions">');
    expect(html).toContain('<option value="سفر">');
    expect(tag(html, `data-memo-note="${id(1)}"`)).toContain('value=""');
    expect(text(html.slice(html.indexOf(`data-memo-litres="${id(1)}"`)))).toContain(
      ar('fleet.custody.memoEditor.litres', { litres: '50.00' }),
    );
    expect(html).not.toContain('data-memo-statement=');
  });

  it('a maintenance line takes «البيان» and «ملاحظات» on a row of their own', () => {
    const html = newMemo('maintenance', [receipt(1, { date: '2026-10-06', amount: 5720 })]);
    expect(tag(html, `data-memo-statement="${id(1)}"`)).toContain('maxLength="500"');
    expect(html).toContain(`data-memo-note="${id(1)}"`);
    expect(html).not.toContain('data-memo-mission=');
  });
});

describe('«تعديل المذكرة»', () => {
  const memo = memoOf();
  const receipts = [
    { ...TYRES[0]!, inThisMemo: true },
    { ...TYRES[1]!, inThisMemo: true },
    TYRES[2]!,
  ];
  const html = editMemo(memo, receipts);

  it('opens on the memo as saved: its kind (the only one that may be chosen), name and date', () => {
    expect(html).toContain('data-memo-editor="tyres"');
    expect(text(html)).toContain(ar('fleet.custody.memoEditor.editTitle'));
    expect(tag(html, 'data-memo-kind="tyres"')).not.toContain('disabled=""');
    for (const other of ['maintenance', 'fuel', 'wash']) {
      expect(tag(html, `data-memo-kind="${other}"`)).toContain('disabled=""');
    }
    expect(tag(html, 'data-memo-name="true"')).toContain('value="كاوتش أكتوبر 2026"');
    expect(tag(html, 'data-memo-date="true"')).toContain('value="2026-10-19"');
    expect(html).toContain('data-memo-no="7"');
  });

  it('heads the page «<name> — مذكرة كاوتش رقم 7 — عن الفترة …»', () => {
    expect(subtitle(html)).toBe(
      `كاوتش أكتوبر 2026 — ${ar('fleet.custody.parts.memoFallback', {
        kind: ar('fleet.custody.source.tyres'),
        no: 7,
      })} — ${ar('fleet.custody.memoEditor.period', { from: '2026/10/06', to: '2026/10/07' })}`,
    );
  });

  it('ticks its own receipts only — a waiting one is offered, unticked', () => {
    expect(tag(html, `data-memo-tick="${id(1)}"`)).toContain('aria-checked="true"');
    expect(tag(html, `data-memo-tick="${id(2)}"`)).toContain('aria-checked="true"');
    // The memo's period holds its own lines; the third receipt (18/10) is outside it.
    expect(html).not.toContain(`data-memo-tick="${id(3)}"`);
    expect(footer(html)).toContain('data-memo-selected="2"');
  });

  it('never prints the name it was given', () => {
    expect(preview(html)).not.toContain('كاوتش أكتوبر 2026');
    expect(preview(html)).toContain('data-paper-sheet="true"');
  });

  it('fills a fuel memo’s cells from what was saved, not from the proposals', () => {
    const fuel = memoOf({
      kind: 'fuel',
      name: '',
      lines: [
        {
          ...memo.lines[0]!,
          mission: 'سفر',
          note: 'بدل',
        },
      ],
    });
    const out = editMemo(fuel, [{ ...TYRES[0]!, inThisMemo: true, suggestedMission: 'نقل اموال' }]);
    expect(tag(out, `data-memo-mission="${id(1)}"`)).toContain('value="سفر"');
    expect(tag(out, `data-memo-note="${id(1)}"`)).toContain('value="بدل"');
  });

  it('a replenished memo is read, not written: the notice, no Save at all, its paper still printable', () => {
    const done = editMemo(
      memoOf({ replenishment: { id: '660000000000000000000001', date: '2026-10-20' } }),
      receipts,
    );
    expect(done).toContain('data-memo-locked="660000000000000000000001"');
    expect(text(done)).toContain(ar('fleet.custody.memoEditor.locked', { date: '2026/10/20' }));
    expect(done).toContain('href="/fleet/custody/log?open=660000000000000000000001"');
    expect(done).not.toContain('data-memo-save=');
    expect(done).not.toContain('data-memo-save-print=');
    expect(done).toContain('data-memo-print-saved="true"');
    expect(done).toContain('<fieldset disabled=""');
    expect(preview(done)).toContain('data-paper-sheet="true"');
  });
});

describe('«حفظ المذكرة» / «حفظ وطباعة», at the source', () => {
  const page = source('CustodyMemoEditorPage.tsx');

  it('names what is missing instead of a silent disabled Save — one rule list, two guarded saves, one banner', () => {
    expect(page.match(/\buseRequiredFields\(/gu)).toHaveLength(1);
    expect(page.match(/\.guard\(/gu)).toHaveLength(2);
    expect(page.match(/<MissingFieldsBanner\b/gu)).toHaveLength(1);
    expect(page).toContain("key: 'receipts'");
    expect(page).toContain("isMissing('receipts')");
    expect(page).toContain('onClick={required.guard(() => submit())}');
    expect(page).toContain('onClick={required.guard(() => submitAndPrint())}');
  });

  it('shows both saves busy while one is on its way, never pressable twice', () => {
    expect(page.match(/busy=\{pending\}/gu)).toHaveLength(2);
    expect(page).toContain('if (busy.current) return;');
  });

  it('opens the print tab FIRST, inside the press, then saves, then prints the SAVED memo', () => {
    const at = page.indexOf('const submitAndPrint = ');
    const body = page.slice(at, page.indexOf('const printSaved = ', at));
    expect(body).toContain('printPaperAfter(');
    expect(body.indexOf('printPaperAfter(')).toBeLessThan(body.indexOf('await save()'));
    expect(body).toContain('memoSheets(memoPaperOf(stored))');
    expect(body).toContain('memoFileName(stored)');
    const save = page.slice(page.indexOf('const save = '), page.indexOf('const done = '));
    expect(save).toContain('mutateAsync(');
    expect(page).toContain("t('fleet.custody.papers.printing')");
  });

  it('redraws the paper once its faces can measure', () => {
    expect(page).toContain('const fonts = usePaperFonts();');
    expect(page).toMatch(/\[kind, paperLines, signatures, replenished, memo, fonts\]/u);
  });
});

const merged = translate('ar', 'fleet.custody.memoEditor.save') !== 'fleet.custody.memoEditor.save';

describe.skipIf(!merged)('every word the editor shows is in the dictionary', () => {
  it('has an Arabic and an English entry for each key it asks for', () => {
    const page = source('CustodyMemoEditorPage.tsx');
    const keys = [
      ...new Set([...page.matchAll(/'(fleet\.[a-zA-Z.]+)'/gu)].map((m) => m[1] ?? '')),
      ...['taken', 'changed', 'locked', 'stale', 'gone'].map(
        (r) => `fleet.custody.memoEditor.refused.${r}`,
      ),
    ];
    expect(keys.length).toBeGreaterThan(40);
    const missing = keys.flatMap((key) =>
      (['ar', 'en'] as const)
        .filter((lang) => translate(lang, key) === key)
        .map((lang) => `${lang}:${key}`),
    );
    expect(missing).toEqual([]);
  });
});

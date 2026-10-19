// «إعداد المذكرات», proven against what it renders and what it writes: the seven papers in their
// two trays, each paper's signers with the boxes his paper prints, the ticks a memo cannot clear,
// ONE save carrying all seven papers exactly as typed, and the preview — the latest saved paper of
// that kind with the names being typed, or the empty paper dated today, never invented rows. No
// DOM here: what the page does between keystrokes is held in the pure steps it is built from.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES as DEFAULTS,
  FLEET_CUSTODY_PAPERS,
  FLEET_CUSTODY_SIGN_ROLES,
  SaveFleetCustodyPaperSettingsSchema,
  type FleetCustodyMemoDto,
  type FleetCustodyOperationDto,
  type FleetCustodyPaperSettingsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { custodyQueryKeys } from '../api/fleet-queries';
import {
  CustodyPapersSetupPage,
  isReviewEndorser,
  savedElsewhere,
  setupBody,
  setupPaperOf,
  setupPathOf,
  setupPreviewSheets,
  tickLocked,
  withBlock,
  withNote,
} from './CustodyPapersSetupPage';

const ar = (key: string, params?: Record<string, string>): string => translate('ar', key, params);
const HERE = dirname(fileURLToPath(import.meta.url));

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
    permissions: { 'fleetCustody.view': 'organization', 'fleetReceipt.edit': 'organization' },
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

/** His defaults, as the server sends them before anybody saved. */
const HIS: FleetCustodyPaperSettingsDto = { papers: structuredClone(DEFAULTS), version: null };

type Queries = NonNullable<NonNullable<QueryClientConfig['defaultOptions']>['queries']>;

const renderSetup = (
  path = '/fleet/custody/memos/setup/tyres',
  options: {
    settings?: FleetCustodyPaperSettingsDto;
    queries?: Queries;
    seed?: (qc: QueryClient) => void;
  } = {},
): string => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, ...options.queries },
    },
  });
  qc.setQueryData(custodyQueryKeys.paperSettings(), options.settings ?? HIS);
  options.seed?.(qc);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody/memos/setup/:paper?" element={<CustodyPapersSetupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup from one marker to the next. */
const between = (html: string, from: string, to?: string): string => {
  const start = html.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = to === undefined ? html.length : html.indexOf(to, start + from.length);
  return html.slice(start, end === -1 ? html.length : end);
};

const memoDto = (patch: Partial<FleetCustodyMemoDto> = {}): FleetCustodyMemoDto => ({
  id: 'm-9',
  no: 9,
  kind: 'tyres',
  name: '',
  date: '2026-10-01',
  from: '2026-09-01',
  to: '2026-09-30',
  receipts: 1,
  total: 150,
  replenishment: null,
  version: 0,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  lines: [
    {
      receiptId: 'r-1',
      date: '2026-09-07',
      vehicleId: 'v-1',
      vehicleCode: '919',
      driverEmployeeId: null,
      driverName: null,
      amount: 150,
      fuelType: null,
      litres: null,
      mission: '',
      statement: '',
      note: '',
    },
  ],
  signatures: DEFAULTS.tyres,
  ...patch,
});

const chargeDto: FleetCustodyOperationDto = {
  id: 'o-3',
  kind: 'charge',
  date: '2026-10-05',
  from: null,
  to: null,
  amount: 75000,
  reason: '',
  memos: [],
  parts: [],
  fundBefore: 0,
  chargedTotal: 0,
  letterFigure: null,
  signatures: DEFAULTS.charge,
  ledger: null,
  version: 0,
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-05T10:00:00.000Z',
};

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 1, totalItems: items.length, totalPages: 1 },
});

describe('«إعداد المذكرات» — the page', () => {
  it('opens on the tyres memo when the address names no paper, its seven papers in two trays', () => {
    const html = renderSetup('/fleet/custody/memos/setup');
    expect(html).toContain('data-memos-setup="tyres"');
    expect(html.match(/data-memos-setup-paper="/gu)).toHaveLength(7);
    const memos = between(html, 'data-memos-setup-tray="memos"', 'data-memos-setup-tray="letters"');
    const letters = between(html, 'data-memos-setup-tray="letters"', 'data-memos-setup-blocks');
    expect([...memos.matchAll(/data-memos-setup-paper="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'tyres',
      'fuel',
      'maintenance',
      'wash',
    ]);
    expect([...letters.matchAll(/data-memos-setup-paper="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'replenish',
      'settle',
      'charge',
    ]);
    // The picked one pressed, in the site's purple, ticked.
    expect(html).toMatch(
      /aria-pressed="true" data-memos-setup-paper="tyres" class="[^"]*bg-brand-600/u,
    );
    expect(html).toContain(`>✓ ${ar('fleet.custody.papers.short.tyres')}</button>`);
  });

  it('opens on the paper in the address, and an unknown paper reads as the tyres memo', () => {
    expect(renderSetup('/fleet/custody/memos/setup/settle')).toContain('data-memos-setup="settle"');
    expect(setupPaperOf('settle')).toBe('settle');
    expect(setupPaperOf('nonsense')).toBe('tyres');
    expect(setupPaperOf(undefined)).toBe('tyres');
    expect(setupPathOf('fuel')).toBe('/fleet/custody/memos/setup/fuel');
  });

  it('wears the forms’ design: its header with Save, the way back to the custody, as the sample', () => {
    const html = renderSetup();
    expect(html).toContain('<header');
    expect(html).toContain(ar('fleet.custody.papers.setup.title'));
    expect(html).toContain(ar('fleet.custody.papers.setup.subtitle'));
    expect(html).toMatch(/data-memos-setup-save="true"[^>]*aria-busy="false"/u);
    // The sample's link: «رجوع إلى العهدة» → the custody board.
    expect(html).toMatch(
      new RegExp(
        `<a [^>]*href="/fleet/custody"[^>]*>${ar('fleet.custody.papers.setup.back')}</a>`,
        'u',
      ),
    );
    expect(html, 'nothing on the set-up is required').not.toContain('text-rose-500">*');
  });

  it('a memo: preparer, director, endorser — the first two always printed, the endorser’s review line', () => {
    const html = renderSetup('/fleet/custody/memos/setup/tyres');
    const blocks = [...html.matchAll(/data-memos-setup-block="(\w+)"/gu)].map((m) => m[1]);
    expect(blocks).toEqual(['preparer', 'director', 'endorser']);
    expect(html).toMatch(/disabled=""[^>]*data-memos-setup-printed="preparer"/u);
    expect(html).toMatch(/disabled=""[^>]*data-memos-setup-printed="director"/u);
    expect(html).not.toMatch(/disabled=""[^>]*data-memos-setup-printed="endorser"/u);
    // His names, his double spaces kept in the boxes.
    expect(html).toContain('value="مدير إدارة  الحركة"');
    expect(html).toContain('value="لواء أ ح / جمال أحمد أبواسماعيل  -  المدير العام"');
    expect(html).toContain('data-memos-setup-field="note"');
    expect(html).toContain('value="يرجى المراجعة والتصديق على اجمالى المصروفات"');
  });

  it('the review line belongs to the tyres, maintenance and washing memos only', () => {
    for (const paper of FLEET_CUSTODY_PAPERS) {
      const html = renderSetup(`/fleet/custody/memos/setup/${paper}`);
      const review = ['tyres', 'maintenance', 'wash'].includes(paper);
      expect(html.includes('data-memos-setup-field="note"'), paper).toBe(review);
      expect(html.includes('data-memos-setup-field="endorser:office"'), paper).toBe(!review);
    }
  });

  it('a letter: director, finance, endorser — every tick free, the settle letter’s endorser off', () => {
    const html = renderSetup('/fleet/custody/memos/setup/settle');
    const blocks = [...html.matchAll(/data-memos-setup-block="(\w+)"/gu)].map((m) => m[1]);
    expect(blocks).toEqual(['director', 'finance', 'endorser']);
    expect(html).not.toMatch(/disabled=""[^>]*data-memos-setup-printed=/u);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-memos-setup-printed="endorser"/u);
    expect(html).toContain('value="الاستاذ : مصطفى حسب الله"');
  });

  it('starts from the set-up the server sends — a saved one, not his defaults', () => {
    const saved: FleetCustodyPaperSettingsDto = {
      papers: withBlock(structuredClone(DEFAULTS), 'tyres', 0, { name: 'النقيب / اسم محفوظ' }),
      version: 4,
    };
    const html = renderSetup('/fleet/custody/memos/setup/tyres', { settings: saved });
    expect(html).toContain('value="النقيب / اسم محفوظ"');
    expect(between(html, 'data-memos-setup-preview="tyres"')).toContain('النقيب / اسم محفوظ');
  });

  it('waits for a fresh read when the cached set-up is old — it never starts from one', () => {
    const html = renderSetup('/fleet/custody/memos/setup/tyres', { queries: { staleTime: 0 } });
    expect(html).not.toContain('data-memos-setup=');
    expect(html).toContain(ar('common.loading'));
  });
});

describe('the preview: the latest saved paper of the kind, with these names — or the empty paper', () => {
  it('with no memo of the kind saved yet: the empty paper, said so', () => {
    const html = renderSetup('/fleet/custody/memos/setup/tyres');
    const preview = between(html, 'data-memos-setup-preview="tyres"');
    expect(preview).toContain('data-memos-setup-preview-of="empty"');
    expect(preview).toContain(ar('fleet.custody.papers.setup.previewEmpty'));
    expect(preview).toContain('data-paper-sheet="true"');
    expect(preview).toContain('>مذكرة بمصروفات الكاوتش  </div>');
    expect(preview).toContain('النقيب / صلاح صبري علي');
  });

  it('with one saved: its lines, under the names on the form (not the ones it was saved with)', () => {
    const memo = memoDto({
      signatures: withBlock(structuredClone(DEFAULTS), 'tyres', 0, { name: 'اسم قديم' }).tyres,
    });
    const html = renderSetup('/fleet/custody/memos/setup/tyres', {
      seed: (qc) => {
        qc.setQueryData(
          custodyQueryKeys.memos({ kind: 'tyres', page: 1, pageSize: 1, sort: 'no:desc' }),
          page([memo]),
        );
        qc.setQueryData(custodyQueryKeys.memo('m-9'), memo);
      },
    });
    const preview = between(html, 'data-memos-setup-preview="tyres"');
    expect(preview).toContain('data-memos-setup-preview-of="latest"');
    expect(preview).toContain('>919</div>');
    expect(preview).toContain('النقيب / صلاح صبري علي');
    expect(preview).not.toContain('اسم قديم');
  });

  it('a letter: the latest one recorded, else the empty letter dated today', () => {
    const recorded = renderSetup('/fleet/custody/memos/setup/charge', {
      seed: (qc) => {
        qc.setQueryData(
          custodyQueryKeys.ledger({ op: 'charge', page: 1, pageSize: 1, sort: 'date:desc' }),
          page([{ id: 'o-3', op: 'charge' }]),
        );
        qc.setQueryData(custodyQueryKeys.operation('o-3'), chargeDto);
      },
    });
    expect(between(recorded, 'data-memos-setup-preview="charge"')).toContain('٧٥,٠٠٠');
    const empty = renderSetup('/fleet/custody/memos/setup/charge');
    expect(between(empty, 'data-memos-setup-preview="charge"')).toContain(
      'data-memos-setup-preview-of="empty"',
    );
  });

  it('never draws another kind’s memo — the list’s previous answer — under this paper', () => {
    const sheets = setupPreviewSheets(
      'wash',
      DEFAULTS.wash,
      { memo: memoDto({ kind: 'tyres' }) },
      '2026-10-19',
    ).join('');
    expect(sheets).not.toContain('>919</div>');
    expect(sheets).toContain('>مذكرة بمصروفات الغسيل  </div>');
  });

  it('an empty letter is dated the day given, and prints the names given', () => {
    const sheets = setupPreviewSheets(
      'replenish',
      withBlock(structuredClone(DEFAULTS), 'replenish', 1, { name: 'الاستاذ : اسم جديد' })
        .replenish,
      {},
      '2026-10-19',
    ).join('');
    expect(sheets).toContain('التاريخ١٩/ ١٠ / ٢٠٢٦');
    expect(sheets).toContain('الاستاذ : اسم جديد');
  });
});

describe('the steps the page is built from', () => {
  it('a memo’s preparer and director cannot be switched off; everything else can', () => {
    for (const paper of FLEET_CUSTODY_PAPERS) {
      for (const role of FLEET_CUSTODY_SIGN_ROLES) {
        const memo = ['tyres', 'fuel', 'maintenance', 'wash'].includes(paper);
        expect(tickLocked(paper, role), `${paper}:${role}`).toBe(
          memo && (role === 'preparer' || role === 'director'),
        );
      }
    }
    expect(isReviewEndorser('tyres', 'endorser')).toBe(true);
    expect(isReviewEndorser('fuel', 'endorser')).toBe(false);
    expect(isReviewEndorser('charge', 'endorser')).toBe(false);
    expect(isReviewEndorser('wash', 'director')).toBe(false);
  });

  it('a change to one paper leaves the six others exactly as they were — typed and unsaved', () => {
    const all = structuredClone(DEFAULTS);
    const next = withNote(withBlock(all, 'fuel', 1, { office: 'مدير  إدارة' }), 'tyres', '');
    expect(next.fuel.blocks[1]!.office).toBe('مدير  إدارة');
    expect(next.fuel.blocks[0]).toBe(all.fuel.blocks[0]);
    expect(next.tyres.note).toBe('');
    expect(next.maintenance).toBe(all.maintenance);
    expect(all.fuel.blocks[1]!.office, 'never in place').toBe('مدير إدارة الحركة');
  });

  it('saves all seven papers in one write, exactly as typed, at the version read', () => {
    const typed = withBlock(structuredClone(DEFAULTS), 'tyres', 0, { name: 'النقيب  /  صلاح ' });
    const body = setupBody(typed, 3);
    expect(Object.keys(body.papers)).toEqual([...FLEET_CUSTODY_PAPERS]);
    expect(body.papers.tyres.blocks[0]!.name).toBe('النقيب  /  صلاح ');
    expect(body.version).toBe(3);
    expect('version' in setupBody(typed, null), 'the first save carries no version').toBe(false);
    // What the server reads: the ends trimmed, the inner double spaces his.
    const parsed = SaveFleetCustodyPaperSettingsSchema.parse(body);
    expect(parsed.papers.tyres.blocks[0]!.name).toBe('النقيب  /  صلاح');
    expect(parsed.papers.tyres.blocks[1]!.office).toBe('مدير إدارة  الحركة');
  });

  it('sees a set-up saved elsewhere meanwhile, and never saves over it', () => {
    expect(savedElsewhere(null, undefined)).toBe(false);
    expect(savedElsewhere(null, HIS)).toBe(false);
    expect(savedElsewhere(null, { ...HIS, version: 0 })).toBe(true);
    expect(savedElsewhere(2, { ...HIS, version: 2 })).toBe(false);
    expect(savedElsewhere(2, { ...HIS, version: 3 })).toBe(true);
  });
});

describe('every word the page shows is in the dictionary, in both languages', () => {
  it('has an Arabic and an English entry for each key it asks for', () => {
    const source = readFileSync(join(HERE, 'CustodyPapersSetupPage.tsx'), 'utf8');
    const literal = [...source.matchAll(/'(fleet\.custody\.papers\.[a-zA-Z.]+)'/gu)].map(
      (m) => m[1]!,
    );
    const templated = [
      ...FLEET_CUSTODY_PAPERS.map((paper) => `fleet.custody.papers.name.${paper}`),
      ...FLEET_CUSTODY_PAPERS.map((paper) => `fleet.custody.papers.short.${paper}`),
      ...FLEET_CUSTODY_SIGN_ROLES.map((role) => `fleet.custody.papers.roles.${role}`),
    ];
    const keys = [...new Set([...literal, ...templated])];
    expect(keys.length).toBeGreaterThan(25);
    const missing = keys.flatMap((key) =>
      (['ar', 'en'] as const)
        .filter((lang) => translate(lang, key) === key)
        .map((lang) => `${lang}:${key}`),
    );
    expect(missing).toEqual([]);
  });
});

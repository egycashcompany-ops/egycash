// /atm/settlements/layouts «فئات الكاسيتات» and its import page, rendered from a pre-filled query
// cache (docs/12-planning/atm-settlements-phase1.md §9.5), with the pure pieces behind them: the
// history line's diff, an apply's estimate, a slot's kind change, the duplicate sentences.
//
// Every code, name and count below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  type AtmCassetteLayoutDetailDto,
  type AtmCassetteLayoutRowDto,
  type AtmCassetteLayoutsDto,
  type AtmCassetteSlot,
  type AtmLayoutImportRunSummaryDto,
  type AtmSettlementContextDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { CassetteLayoutsPage } from './pages/CassetteLayoutsPage';
import { LayoutImportPage, applyEstimate } from './pages/LayoutImportPage';
import { versionDiff } from './components/settlements/LayoutEditor';
import { withKind } from './components/settlements/SlotEditor';
import { duplicateTexts } from './components/settlements/DuplicateNote';
import {
  cassetteLayoutKey,
  cassetteLayoutsKey,
  layoutImportRunsKey,
  settlementContextKey,
  standardLoadsKey,
} from './api/settlements-queries';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const BRANCH = '66a000000000000000000041';

const context = (
  page: AtmSettlementContextDto['page'],
  over: Partial<AtmSettlementContextDto> = {},
): AtmSettlementContextDto => ({
  page,
  banks: ['BRK'],
  branch: { id: BRANCH, name: { ar: 'فرع تجريبي', en: 'SYN branch' } },
  blocked: null,
  can: {
    viewLayouts: true,
    manageLayouts: true,
    importLayouts: true,
    viewPlans: true,
    managePlans: true,
    printPlans: true,
    exportPlans: true,
  },
  ...over,
});

const w = (slot: number, denomination: number): AtmCassetteSlot => ({
  slot,
  kind: 'withdrawal',
  denomination,
  currency: 'EGP',
});

const row = (n: number, over: Partial<AtmCassetteLayoutRowDto> = {}): AtmCassetteLayoutRowDto => ({
  machineId: `66e0000000000000000004${String(n).padStart(2, '0')}`,
  machineCode: `BRKN94${String(n).padStart(2, '0')}`,
  machineName: `ماكينة اختبار ${String(n)}`,
  area: 'منطقة تجريبية',
  active: true,
  layout: {
    version: 2,
    revision: 2,
    slots: [w(1, 200), w(2, 100), w(3, 50), { slot: 4, kind: 'recycle', denomination: 20, currency: 'EGP' }],
    typeLabel: 'SYN (S2)',
    featuresLabel: 'Withdrawall',
    hubLabel: 'HUB-T',
    standardLoadId: null,
    source: 'manual',
    changedByName: 'مستخدم تجريبي',
    changedAt: '2026-10-26T18:00:00.000Z',
  },
  flags: [],
  ...over,
});

const LIST: AtmCassetteLayoutsDto = {
  bankCode: 'BRK',
  branchId: BRANCH,
  rows: [row(1), row(2, { layout: null, flags: ['noLayout'] })],
  figures: { machines: 2, withLayout: 1, withoutLayout: 1 },
  lastImport: {
    at: '2026-10-26T17:00:00.000Z',
    actorName: 'مستخدم تجريبي',
    state: 'done',
    counts: { new: 1, same: 0, changed: 0, changedManual: 0, notFound: 2, invalid: 1 },
  },
  can: { manage: true, import: true },
};

const DETAIL: AtmCassetteLayoutDetailDto = {
  ...row(1),
  versions: [
    {
      revision: 2,
      slots: row(1).layout?.slots ?? [],
      typeLabel: 'SYN (S2)',
      featuresLabel: null,
      hubLabel: null,
      standardLoadId: null,
      source: 'manual',
      reason: null,
      changedByName: 'مستخدم تجريبي',
      changedAt: '2026-10-26T18:00:00.000Z',
    },
    {
      revision: 1,
      slots: [w(1, 200), w(2, 100), w(3, 100), w(4, 20)],
      typeLabel: 'SYN (S2)',
      featuresLabel: null,
      hubLabel: null,
      standardLoadId: null,
      source: 'import',
      reason: null,
      changedByName: 'مستخدم تجريبي',
      changedAt: '2026-10-25T18:00:00.000Z',
    },
  ],
  affectedLines: [],
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'atmCassetteLayout.view': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const renderAt = (url: string, node: JSX.Element, fill: (qc: QueryClient) => void): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fill(qc);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const layouts = (ctx: AtmSettlementContextDto, list: AtmCassetteLayoutsDto, url = '/atm/settlements/layouts'): string =>
  renderAt(url, <CassetteLayoutsPage />, (qc) => {
    qc.setQueryData(settlementContextKey('layouts'), ctx);
    qc.setQueryData(cassetteLayoutsKey({ bankCode: 'BRK', branchId: BRANCH }), list);
    qc.setQueryData(standardLoadsKey({ bankCode: 'BRK', branchId: BRANCH }), []);
    qc.setQueryData(cassetteLayoutKey(DETAIL.machineId), DETAIL);
  });

describe('the layouts page', () => {
  it('says to choose a branch when none resolves', () => {
    const html = layouts(context('layouts', { branch: null, blocked: 'chooseBranch' }), LIST);
    expect(html).toContain(t('atm.settlement.chooseBranch'));
    expect(html).not.toContain('data-layouts-filters');
  });

  it('lists each machine with its cassettes: ↻ on a recycle slot, the flag on one without', () => {
    const html = layouts(context('layouts'), LIST);
    expect(html).toContain('BRKN9401');
    expect(html).toContain('↻20');
    expect(html).toContain(t('atm.layouts.flag.noLayout'));
    expect(html).toContain(t('atm.layouts.source.manual'));
  });

  it('counts the machines, with and without denominations, in the header', () => {
    const html = layouts(context('layouts'), LIST);
    expect(html).toContain('data-settlement-figure="withLayout"');
    expect(html).toContain('data-settlement-figure="withoutLayout"');
  });

  it('links the import only for an import holder, and shows the last import’s counts', () => {
    const html = layouts(context('layouts'), LIST);
    expect(html).toContain('data-layouts-action="import"');
    expect(html).toContain('data-last-import');
    expect(html).toContain(
      t('atm.layouts.lastImport', { date: '26/10/2026', rows: '٤', matched: '١', notFound: '٢', flags: '١' }),
    );
    const noImport = layouts(context('layouts'), { ...LIST, can: { manage: true, import: false } });
    expect(noImport).not.toContain('data-layouts-action="import"');
  });

  it('opens a machine’s editor from `?machine=`, with its slots and its history', () => {
    const html = layouts(context('layouts'), LIST, `/atm/settlements/layouts?machine=${DETAIL.machineId}`);
    expect(html).toContain(`data-layout-editor="${DETAIL.machineId}"`);
    expect([...html.matchAll(/data-slot-editor="/g)]).toHaveLength(4);
    expect(html).toContain('data-layout-history');
    expect(html).toContain(t('atm.layouts.editor.historyDiff', { slot: 3, before: '100', after: '50' }));
    expect(html).toContain(t('atm.layouts.editor.save'));
  });
});

describe('the import page', () => {
  const RUN: AtmLayoutImportRunSummaryDto = {
    at: '2026-10-26T17:00:00.000Z',
    actorName: 'مستخدم تجريبي',
    state: 'done',
    counts: { new: 3, same: 1, notFound: 2 },
  };
  const page = (ctx: AtmSettlementContextDto): string =>
    renderAt('/atm/settlements/layouts/import', <LayoutImportPage />, (qc) => {
      qc.setQueryData(settlementContextKey('import'), ctx);
      qc.setQueryData(layoutImportRunsKey({ bankCode: 'BRK', branchId: BRANCH }), [RUN]);
    });

  it('offers the bank, the work branch’s name and the file, and the preview', () => {
    const html = page(context('import'));
    expect(html).toContain('data-import-upload');
    expect(html).toContain('فرع تجريبي');
    expect(html).toContain(t('atm.layoutImport.preview'));
  });

  it('shows the last run’s counts while there is no preview', () => {
    const html = page(context('import'));
    expect(html).toContain('data-import-last-run');
    expect(html).toContain(t('atm.layoutImport.outcome.notFound'));
  });

  it('says to choose a branch when none resolves', () => {
    const html = page(context('import', { branch: null, blocked: 'noBranch' }));
    expect(html).toContain(t('atm.settlement.noBranch'));
    expect(html).not.toContain('data-import-upload');
  });
});

describe('the pure pieces', () => {
  it('versionDiff names each cassette that changed, «—» where one was added or removed', () => {
    const older = { slots: [w(1, 200), w(2, 100), w(3, 50), w(4, 20)] };
    const newer = { slots: [w(1, 200), w(2, 100), w(3, 100), w(4, 20), w(5, 50)] };
    expect(versionDiff(newer, older, t)).toBe(
      [
        t('atm.layouts.editor.historyDiff', { slot: 3, before: '50', after: '100' }),
        t('atm.layouts.editor.historyDiff', { slot: 5, before: '—', after: '50' }),
      ].join(' · '),
    );
    expect(versionDiff(newer, undefined, t)).toBe('');
  });

  it('applyEstimate follows the mode (DS-7)', () => {
    const counts = {
      new: 4,
      same: 10,
      changed: 3,
      changedManual: 2,
      notFound: 1,
      archived: 0,
      noRegisterBank: 0,
      otherBank: 0,
      duplicateInFile: 0,
      invalid: 0,
    };
    expect(applyEstimate(counts, 'newOnly')).toEqual({ created: 4, updated: 0 });
    expect(applyEstimate(counts, 'newAndChanged')).toEqual({ created: 4, updated: 3 });
    expect(applyEstimate(counts, 'overwriteManual')).toEqual({ created: 4, updated: 5 });
  });

  it('withKind clears what the new kind cannot hold', () => {
    expect(withKind(w(1, 200), 'empty')).toEqual({ slot: 1, kind: 'empty', denomination: null, currency: null });
    expect(withKind(w(1, 200), 'deposit')).toEqual({ slot: 1, kind: 'deposit', denomination: null, currency: 'EGP' });
    expect(withKind({ slot: 2, kind: 'empty', denomination: null, currency: null }, 'recycle')).toEqual({
      slot: 2,
      kind: 'recycle',
      denomination: null,
      currency: 'EGP',
    });
  });

  it('duplicateTexts: the local sentence, then where else the server found it', () => {
    const texts = duplicateTexts(
      { field: 'seal:1', code: 'SEAL_REPEATED', others: ['seal:2'] },
      {
        field: 'seal',
        slot: 1,
        matches: [
          { sameLine: true, otherField: { field: 'seal', slot: 2 } },
          {
            replenishDate: '2026-10-20',
            bankCode: 'BRK',
            serial: 12,
            machineCode: 'BRKN9001',
            spareCode: null,
            lineStatus: 'cancelled',
            matchedField: 'bag',
          },
          { outsideReach: true },
        ],
        crossKind: true,
      },
      t,
    );
    expect(texts).toEqual([
      t('atm.prep.duplicate.seal'),
      t('atm.prep.duplicate.server', {
        where: [
          `${t('atm.prep.duplicate.where', { serial: 12, code: 'BRKN9001', date: '20/10/2026' })} ${t('atm.prep.duplicate.asQr')}`,
          t('atm.prep.duplicate.outsideReach'),
        ].join('، '),
      }),
    ]);
  });
});

// The import page's pure decisions (spec §8.6, §10.2): when Apply is offered, what the `apply`
// field carries, and how the 57 report cells are named.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  ATM_DATA_REPORT_CELLS,
  type AtmRegisterImportCategory,
  type AtmRegisterImportCategoryDto,
  type AtmRegisterImportResultDto,
  type AtmRegisterMetaDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { ApiError } from '../../shared/lib/api-client';
import { listKey } from '../../shared/lib/query-keys';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { RegisterImportPage } from './pages/RegisterImportPage';
import { ImportPreviewPanel } from './components/register-import/ImportPreviewPanel';
import { ImportRunsCard } from './components/register-import/ImportRunsCard';
import {
  applyField,
  approvedCategories,
  blockerHintKey,
  canApply,
  canPreview,
  importErrorDetails,
  importErrorText,
  orderedCategories,
  outcomeEntries,
  pageOf,
  reportCellLabel,
  standingBlockers,
} from './lib/register-import-view';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const result = (blockers: AtmRegisterImportResultDto['blockers']) => ({ blockers });
const t = (key: string): string => key;

const cat = (
  key: AtmRegisterImportCategoryDto['key'],
  approvable: boolean,
  count: number,
): AtmRegisterImportCategoryDto => ({ key, approvable, count, items: [], pairs: [] });

describe('apply-enabled logic', () => {
  it('needs at least one approved category', () => {
    expect(canApply(result([]), [], false)).toBe(false);
    expect(canApply(result([]), ['entries'], false)).toBe(true);
  });

  it('a report mismatch blocks until the owner overrides it', () => {
    expect(canApply(result(['reportMismatch']), ['entries'], false)).toBe(false);
    expect(canApply(result(['reportMismatch']), ['entries'], true)).toBe(true);
    expect(standingBlockers(result(['reportMismatch']), true)).toEqual([]);
  });

  it('no other blocker can be overridden', () => {
    for (const blocker of [
      'branchUnmapped',
      'secretsOutOfReach',
      'dateUnreadable',
      'openInRegister',
      'changedSinceImport',
      'runInProgress',
    ] as const) {
      expect(canApply(result([blocker, 'reportMismatch']), ['entries'], true)).toBe(false);
    }
  });
});

describe('the apply field', () => {
  it('lists the approved categories in the catalogue order, unknown names dropped', () => {
    expect(approvedCategories(new Set(['create', 'entries', 'everything', 'nbeForex']))).toEqual([
      'entries',
      'create',
      'nbeForex',
    ]);
    expect(applyField(['link', 'entries'])).toBe('entries,link');
    expect(applyField([])).toBe('');
  });
});

describe('category order', () => {
  it('blocker-backed reports first (only when they have items), then approvable, then reports', () => {
    const { blocking, rest } = orderedCategories([
      cat('entries', true, 3),
      cat('link', true, 1),
      cat('cannotCouple', false, 2),
      cat('openInRegister', false, 1),
      cat('changedSinceImport', false, 0),
      cat('activeElsewhere', false, 0),
    ]);
    expect(blocking.map((c) => c.key)).toEqual(['openInRegister']);
    expect(rest.map((c) => c.key)).toEqual(['entries', 'link', 'cannotCouple', 'activeElsewhere']);
  });

  it('only four blockers carry a remedy line', () => {
    expect(blockerHintKey('dateUnreadable')).toBe('atm.registerImport.blockerHint.dateUnreadable');
    expect(blockerHintKey('reportMismatch')).toBeNull();
  });
});

describe('the 57 cells, named as the Data Report names them', () => {
  it('section 1 banks, section 2 branches, section 3 branch · bank, totals', () => {
    const labels = ATM_DATA_REPORT_CELLS.map((cell) => reportCellLabel(cell, t, 'en'));
    expect(labels).toHaveLength(57);
    expect(labels[0]).toBe('NXT BANK');
    expect(labels[6]).toBe('atm.registerReport.total');
    expect(labels[7]).toBe('atm.registerReport.branch2.EGYCASH-7');
    expect(labels[15]).toBe('atm.registerReport.branch3.EGYCASH-1 · National Bank of Egypt');
    const nbe = ATM_DATA_REPORT_CELLS.find((cell) => cell.key === 's1.NBE');
    expect(nbe === undefined ? null : reportCellLabel(nbe, t, 'ar')).toBe('البنك الأهلي المصري');
  });
});

describe('small helpers', () => {
  it('outcomes in catalogue order, zeros dropped', () => {
    expect(outcomeEntries({ created: 2, imported: 5, notApproved: 0, other: 9 })).toEqual([
      ['imported', 5],
      ['created', 2],
    ]);
  });

  it('pages items in the browser', () => {
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
  });

  it('error text: register codes by name, blockers and missing headers listed', () => {
    const blocked = new ApiError('ATM_REGISTER_IMPORT_BLOCKED', 'x', 422, [
      { field: 'blockers', code: 'openInRegister', message: 'openInRegister' },
    ]);
    expect(importErrorText(blocked, t, 'en')).toBe(
      'atm.register.error.ATM_REGISTER_IMPORT_BLOCKED',
    );
    expect(importErrorDetails(blocked, t)).toEqual(['atm.registerImport.blocker.openInRegister']);
    const layout = new ApiError('ATM_REGISTER_IMPORT_LAYOUT', 'x', 422, [
      { field: 'AN', code: 'MISSING_HEADER', message: 'Notes Received' },
    ]);
    expect(importErrorDetails(layout, t)).toEqual(['AN: Notes Received']);
  });
});

// Review finding LIVE-2: the file-level reasons say what is wrong with the FILE.
describe('a refused upload names the file’s own problem', () => {
  const ar = (key: string): string => translate('ar', key);
  it('no ATMs sheet, not a workbook, too large — each in its own words, before the code', () => {
    const noSheet = new ApiError('ATM_REGISTER_IMPORT_LAYOUT', 'x', 422, [
      { field: 'file', code: 'MISSING_SHEET', message: 'ATMs' },
    ]);
    expect(importErrorText(noSheet, ar, 'ar')).toBe(ar('atm.registerImport.error.missingSheet'));
    expect(importErrorDetails(noSheet, ar), 'the text already names the sheet').toEqual([]);
    const unreadable = new ApiError('VALIDATION_FAILED', 'x', 422, [
      { field: 'file', code: 'UNREADABLE', message: 'not a readable .xlsx workbook' },
    ]);
    expect(importErrorText(unreadable, ar, 'ar')).toBe(ar('atm.registerImport.error.unreadable'));
    const tooLarge = new ApiError('ATM_REGISTER_IMPORT_LAYOUT', 'x', 422, [
      { field: 'file', code: 'TOO_LARGE', message: 'time' },
    ]);
    expect(importErrorText(tooLarge, ar, 'ar')).toBe(ar('atm.registerImport.error.tooLarge'));
    // A renamed header is still "the expected columns", with the column named.
    const header = new ApiError('ATM_REGISTER_IMPORT_LAYOUT', 'x', 422, [
      { field: 'E', code: 'MISSING_HEADER', message: 'Name' },
    ]);
    expect(importErrorText(header, ar, 'ar')).toBe(
      ar('atm.register.error.ATM_REGISTER_IMPORT_LAYOUT'),
    );
    for (const key of ['missingSheet', 'unreadable', 'tooLarge']) {
      expect(translate('en', `atm.registerImport.error.${key}`)).not.toBe(
        `atm.registerImport.error.${key}`,
      );
    }
  });
});

// Review finding WEB-3: one mutation runs both; a preview pressed mid-apply took its callbacks.
describe('preview is offered only with a file and nothing in flight', () => {
  it('needs a file, and no run in progress — an apply included', () => {
    expect(canPreview(true, false)).toBe(true);
    expect(canPreview(false, false)).toBe(false);
    expect(canPreview(true, true)).toBe(false);
  });
});

// Review finding WEB-4: the Arabic strings keep their reading order in an RTL line.
describe('bidi marks in the Arabic import strings', () => {
  it('an RLM keeps the FX → NBE FOREX arrow pointing forward; the extension is isolated', () => {
    expect(translate('ar', 'atm.registerImport.category.nbeForex.title')).toContain('FX\u200F ←');
    expect(translate('ar', 'atm.registerImport.upload')).toContain('\u2066(.xlsx)\u2069');
  });
});

// Review finding WEB-6: a failed first load is an error, not "no import has run yet".
describe('the runs card', () => {
  it('shows an error with a retry when the runs request fails, never the empty text', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    const query = qc.getQueryCache().build(qc, { queryKey: listKey('atm', 'registerImportRuns') });
    query.setState({
      status: 'error',
      error: new ApiError('INTERNAL', 'boom', 500),
      fetchStatus: 'idle',
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
    });
    const html = renderToStaticMarkup(
      createElement(Provider, {
        store: store(),
        children: createElement(QueryClientProvider, { client: qc }, createElement(ImportRunsCard)),
      }),
    );
    expect(html).not.toContain(translate('en', 'atm.registerImport.runs.empty'));
    expect(html).toContain(translate('en', 'common.error.title'));
  });
});

// ── Rendered once, statically: the page shell and the preview panel ──────────────────────────────
// No DOM: the markup is read as text, the fleet-dashboard way. The DTO below is what the server
// sends — it carries no key value and no combination, so the page has nothing secret to show.

const META: AtmRegisterMetaDto = {
  banks: [],
  branches: [
    {
      code: 'EGYCASH-4',
      name: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchId: '650000000000000000000104',
      branchName: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchActive: true,
      canView: true,
      canCreate: true,
    },
  ],
};

const PREVIEW: AtmRegisterImportResultDto = {
  mode: 'preview',
  fileName: 'register.xlsx',
  fileSha256: 'abc',
  sheet: { firstDataRow: 3, lastDataRow: 5, sentinelRow: 6 },
  counts: { rows: 3, open: 2, ended: 1, pending: 0, alreadyImported: 0 },
  blockers: ['reportMismatch', 'dateUnreadable'],
  report: {
    cells: ATM_DATA_REPORT_CELLS.map((ref) => ({
      ...ref,
      expected: 1,
      recomputed: 0,
      matches: false,
    })),
    allMatch: false,
  },
  issues: {
    byCode: [{ code: 'dateInvalid', count: 1 }],
    rows: [{ importRow: 4, issues: [{ code: 'dateInvalid', column: 'AR', detail: 'soon' }] }],
  },
  branches: [
    {
      code: 'EGYCASH-4',
      branchId: '650000000000000000000104',
      branchName: { ar: 'الإسكندرية', en: 'Alexandria' },
      active: true,
      inReach: true,
      rows: 3,
      openRows: 2,
    },
  ],
  categories: [
    cat('entries', true, 3),
    {
      key: 'create',
      approvable: true,
      count: 1,
      items: [
        {
          importRow: 3,
          branchCode: 'EGYCASH-4',
          machineCode: '99990001',
          name: 'Synthetic ATM',
          area: 'Smouha',
          bankCode: 'NBE',
          machineId: null,
          masterBankLabel: null,
          reason: null,
          differences: [],
          otherBranchCode: null,
          otherBranchName: null,
          entryId: null,
          columns: [],
        },
      ],
      pairs: [],
    },
    cat('cannotCouple', false, 0),
  ],
  applied: null,
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'en' as Locale, dir: 'ltr' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'atmRegister.import': 'organization', 'setting.edit': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const renderWith = (node: ReactElement): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('atm', 'registerMeta'), META);
  qc.setQueryData(listKey('atm', 'registerImportRuns'), []);
  return renderToStaticMarkup(
    createElement(Provider, {
      store: store(),
      children: createElement(QueryClientProvider, { client: qc }, node),
    }),
  );
};

describe('rendered', () => {
  it('the page is a shell: title, settings card, upload card, runs card', () => {
    const html = renderWith(createElement(RegisterImportPage));
    expect(html).toContain(translate('en', 'atm.registerImport.title'));
    expect(html).toContain(translate('en', 'atm.registerSettings.title'));
    expect(html).toContain(translate('en', 'atm.registerImport.intro'));
    expect(html).toContain(translate('en', 'atm.registerImport.runs.empty'));
  });

  // Review finding LIVE-4: `dir="auto"` on a <td> turns a cell that starts with a Latin letter
  // into a left-aligned LTR block inside the RTL table, beside the next column's value. The
  // direction belongs on the text, not on the cell.
  it('no table cell takes its own direction from its text — the text does, inside it', () => {
    const page = renderWith(createElement(RegisterImportPage));
    const panel = renderWith(
      createElement(ImportPreviewPanel, {
        result: PREVIEW,
        approved: new Set<AtmRegisterImportCategory>(),
        onToggle: () => undefined,
        reportOverride: false,
        onOverride: () => undefined,
        onApply: () => undefined,
        applying: false,
      }),
    );
    for (const html of [page, panel]) {
      expect(html).not.toMatch(/<td[^>]*dir="auto"/);
      expect(html).toMatch(/<td[^>]*><span dir="auto">/);
    }
  });

  it('the preview panel lists blockers first, the 57 cells, the categories, and keeps Apply off', () => {
    const html = renderWith(
      createElement(ImportPreviewPanel, {
        result: PREVIEW,
        approved: new Set<AtmRegisterImportCategory>(),
        onToggle: () => undefined,
        reportOverride: false,
        onOverride: () => undefined,
        onApply: () => undefined,
        applying: false,
      }),
    );
    const blockerAt = html.indexOf(translate('en', 'atm.registerImport.blocker.dateUnreadable'));
    expect(blockerAt).toBeGreaterThan(-1);
    expect(blockerAt).toBeLessThan(
      html.indexOf(translate('en', 'atm.registerImport.reportCheck.title')),
    );
    expect(html).toContain(translate('en', 'atm.registerImport.blockerHint.dateUnreadable'));
    expect(html.match(/AE3|AF3|AG3|AH3|AI3|AD3/g)?.length).toBe(6);
    expect(html).toContain(translate('en', 'atm.registerImport.category.create.title'));
    expect(html).toContain('99990001');
    expect(html).toContain(translate('en', 'atm.registerImport.reportOverride'));
    // Nothing approved → Apply is disabled.
    const apply = html.slice(
      html.lastIndexOf('<button', html.lastIndexOf(translate('en', 'atm.registerImport.apply'))),
    );
    expect(apply.slice(0, apply.indexOf('>'))).toContain('disabled');
  });
});

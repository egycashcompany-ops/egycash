// The import page's pure decisions (spec §8.6, §10.2): when Apply is offered, what the `apply`
// field carries, and how the 57 report cells are named — and, since the branch alignment
// (2026-10-28), how a branch is named on the page: its code beside the ECMS name the top bar gives
// it, and «يعمل باسم …» where a code's branch is linked to work as another.
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
import { REGISTER_MAPPING_STALES } from './components/register-import/RegisterSettingsCard';
import { registerKeys } from './api/register-queries';
import {
  applyField,
  approvedCategories,
  blockerHintKey,
  canApply,
  canPreview,
  codeAndName,
  importBranchText,
  importErrorDetails,
  importErrorText,
  orderedCategories,
  outcomeEntries,
  pageOf,
  reportCellLabel,
  standingBlockers,
  worksAsTarget,
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

  it('names a seed as the bank catalog names it now, when the caller has the catalog', () => {
    const nbe = ATM_DATA_REPORT_CELLS.find((cell) => cell.key === 's3.EGYCASH-1.NBE');
    const curated = [{ code: 'NBE', name: { ar: 'الأهلي', en: 'NBE (curated)' } }];
    expect(nbe === undefined ? null : reportCellLabel(nbe, t, 'en', curated)).toBe(
      'atm.registerReport.branch3.EGYCASH-1 · NBE (curated)',
    );
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
  banks: [
    {
      code: 'NBE',
      name: { ar: 'البنك الأهلي المصري', en: 'National Bank of Egypt' },
      opsLabel: 'NBE',
      color: '#385723',
      isActive: true,
      sortOrder: 10,
      isSeed: true,
    },
    {
      code: 'QNB',
      name: { ar: 'بنك تجريبي', en: 'Synthetic Bank' },
      opsLabel: 'QNB OPS',
      color: '#7030A0',
      isActive: false,
      sortOrder: 70,
      isSeed: false,
    },
  ],
  branches: [
    {
      code: 'EGYCASH-4',
      name: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchId: '650000000000000000000104',
      branchName: { ar: 'الإسكندرية', en: 'Alexandria' },
      branchActive: true,
      canView: true,
      canCreate: true,
      resolvedBranchId: '650000000000000000000104',
      resolvedBranchName: { ar: 'الإسكندرية', en: 'Alexandria' },
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
      resolvedBranchId: '650000000000000000000104',
      resolvedBranchName: { ar: 'الإسكندرية', en: 'Alexandria' },
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

const store = (extra: readonly string[] = []) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'en' as Locale, dir: 'ltr' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(
            ['atmRegister.import', 'setting.edit', ...extra].map((key) => [key, 'organization']),
          ),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const renderWith = (
  node: ReactElement,
  extra: readonly string[] = [],
  meta: AtmRegisterMetaDto = META,
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('atm', 'registerMeta'), meta);
  qc.setQueryData(listKey('atm', 'registerImportRuns'), []);
  return renderToStaticMarkup(
    createElement(Provider, {
      store: store(extra),
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

// The bank labels the card used to edit are the bank CATALOG's now (DEC-35): the retired setting is
// read once, by the seed, so an editor here would save values nothing reads.
describe('the settings card’s banks', () => {
  it('lists the catalog read-only — archived banks too — and edits only the branch codes', () => {
    const html = renderWith(createElement(RegisterImportPage));
    expect(html).toContain('data-register-settings-bank="NBE"');
    expect(html).toContain('data-register-settings-bank="QNB"');
    expect(html).toContain('QNB OPS');
    expect(html).toContain(translate('en', 'atm.dataEdit.archived'));
    // As React writes it: the hint's quotation marks are escaped in the markup.
    expect(html).toContain(
      translate('en', 'atm.registerSettings.bankLabelsHint').replace(/"/g, '&quot;'),
    );
    // No box to type a bank label into, for anyone.
    expect(html).not.toMatch(/<input[^>]*aria-label="[^"]*Name in the Operations list/);
  });

  it('opens the catalog only for whoever keeps it', () => {
    const plain = renderWith(createElement(RegisterImportPage));
    expect(plain).not.toContain('data-register-settings-action="banks"');
    const keeper = renderWith(createElement(RegisterImportPage), ['atmBank.edit']);
    expect(keeper).toContain('data-register-settings-action="banks"');
    expect(keeper).toContain(translate('en', 'atm.registerSettings.manageBanks'));
  });
});

// ── A branch on the import page (2026-10-28) ──────────────────────────────────────────────────────
// The page is about the workbook, so it keeps the codes — beside the ECMS name the top bar gives
// the branch, never the workbook's name alone. Below, أكتوبر works as المهندسين (`atm.branchLinks`):
// EGYCASH-5 is mapped to أكتوبر, and its rows are filed under المهندسين.

const MOH = '650000000000000000000101';
const OCT = '650000000000000000000105';
const MOH_NAME = { ar: 'المهندسين', en: 'Mohandessin' };
const OCT_NAME = { ar: 'أكتوبر', en: 'October' };
const CODELESS = { ar: 'فرع بلا كود', en: 'A branch without a code' };

const LINKED_BRANCHES: AtmRegisterImportResultDto['branches'] = [
  {
    code: 'EGYCASH-1',
    branchId: MOH,
    branchName: MOH_NAME,
    active: true,
    inReach: true,
    rows: 5,
    openRows: 4,
    resolvedBranchId: MOH,
    resolvedBranchName: MOH_NAME,
  },
  {
    code: 'EGYCASH-5',
    branchId: OCT,
    branchName: OCT_NAME,
    active: true,
    inReach: true,
    rows: 2,
    openRows: 2,
    resolvedBranchId: MOH,
    resolvedBranchName: MOH_NAME,
  },
  {
    code: 'EGYCASH-3',
    branchId: null,
    branchName: null,
    active: false,
    inReach: false,
    rows: 1,
    openRows: 0,
    resolvedBranchId: null,
    resolvedBranchName: null,
  },
];

describe('a branch on the import page', () => {
  const tr = (key: string, params?: Record<string, string | number>): string =>
    translate('ar', key, params);
  const [moh, oct, unmapped] = LINKED_BRANCHES as [
    AtmRegisterImportResultDto['branches'][number],
    AtmRegisterImportResultDto['branches'][number],
    AtmRegisterImportResultDto['branches'][number],
  ];

  it('names a code by itself and the ECMS branch its rows are filed under', () => {
    expect(importBranchText('EGYCASH-1', LINKED_BRANCHES, 'ar')).toBe('EGYCASH-1 · المهندسين');
    // Mapped to a linked source: its rows go to the branch it works as.
    expect(importBranchText('EGYCASH-5', LINKED_BRANCHES, 'en')).toBe('EGYCASH-5 · Mohandessin');
    expect(importBranchText('EGYCASH-3', LINKED_BRANCHES, 'ar'), 'mapped to nothing').toBe(
      'EGYCASH-3',
    );
    expect(codeAndName(null, CODELESS, 'ar'), 'a branch in reach with no code').toBe('فرع بلا كود');
    expect(codeAndName('EGYCASH-2', null, 'ar')).toBe('EGYCASH-2');
    expect(codeAndName(null, null, 'ar')).toBe('—');
  });

  it('says where a linked code’s rows go — and nothing where a code files as it is mapped', () => {
    expect(worksAsTarget(oct, 'ar', tr)).toBe('المهندسين');
    expect(worksAsTarget(moh, 'ar', tr)).toBeNull();
    expect(worksAsTarget(unmapped, 'ar', tr)).toBeNull();
    expect(worksAsTarget({ branchId: OCT }, 'ar', tr), 'an older server says nothing').toBeNull();
    expect(
      worksAsTarget({ branchId: OCT, resolvedBranchId: MOH, resolvedBranchName: null }, 'ar', tr),
      'a target ECMS no longer holds',
    ).toBe(tr('atm.settings.unknownBranch'));
  });

  it('draws «code · ECMS name» on the cards and «يعمل باسم …» in the branch table', () => {
    const preview: AtmRegisterImportResultDto = {
      ...PREVIEW,
      branches: LINKED_BRANCHES,
      categories: [
        {
          key: 'activeElsewhere',
          approvable: false,
          count: 1,
          items: [
            {
              importRow: 9,
              branchCode: 'EGYCASH-5',
              machineCode: '99990002',
              name: 'Synthetic ATM 2',
              area: 'Dokki',
              bankCode: 'NBE',
              machineId: null,
              masterBankLabel: null,
              reason: 'activeElsewhere',
              differences: [],
              otherBranchCode: null,
              otherBranchName: CODELESS,
              entryId: null,
              columns: [],
            },
          ],
          pairs: [
            { fromBranchCode: null, fromBranchName: CODELESS, toBranchCode: 'EGYCASH-5', count: 1 },
          ],
        },
      ],
    };
    const html = renderWith(
      createElement(ImportPreviewPanel, {
        result: preview,
        approved: new Set<AtmRegisterImportCategory>(),
        onToggle: () => undefined,
        reportOverride: false,
        onOverride: () => undefined,
        onApply: () => undefined,
        applying: false,
      }),
    );
    // The row's own branch, the pair's two ends, and the other branch.
    expect(html.match(/EGYCASH-5 · Mohandessin/g)?.length).toBe(2);
    expect(html.match(/A branch without a code/g)?.length).toBe(2);
    expect(html).toContain('data-import-works-as="EGYCASH-5"');
    expect(html).toContain(
      translate('en', 'atm.registerImport.branches.worksAs', { target: 'Mohandessin' }),
    );
    expect(html).not.toContain('data-import-works-as="EGYCASH-1"');
    expect(html).not.toContain('data-import-works-as="EGYCASH-3"');
  });

  // The server lists one pair per other BRANCH (review finding: keyed by code, two code-less
  // branches merged under the first one's name); the card draws each, a shared code or none.
  it('draws one pairs row per other branch, two without a code each with its own name and count', () => {
    const ASWAN = { ar: 'أسوان', en: 'Aswan' };
    const pairs: AtmRegisterImportResultDto['categories'][number]['pairs'] = [
      { fromBranchCode: null, fromBranchName: CODELESS, toBranchCode: 'EGYCASH-5', count: 1 },
      { fromBranchCode: null, fromBranchName: ASWAN, toBranchCode: 'EGYCASH-5', count: 2 },
    ];
    const html = renderWith(
      createElement(ImportPreviewPanel, {
        result: {
          ...PREVIEW,
          branches: LINKED_BRANCHES,
          categories: [{ key: 'activeElsewhere', approvable: false, count: 3, items: [], pairs }],
        },
        approved: new Set<AtmRegisterImportCategory>(),
        onToggle: () => undefined,
        reportOverride: false,
        onOverride: () => undefined,
        onApply: () => undefined,
        applying: false,
      }),
    );
    const rows = [...html.matchAll(/<tr><td[^>]*><span dir="auto">([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );
    expect(rows).toEqual(['A branch without a code', 'Aswan']);
  });
});

// The settings card is where the codes are configured, so it keeps them — with the workbook's
// name, the ECMS branch picked, and «يعمل باسم …» for a picked branch that works as another.
describe('the settings card’s codes', () => {
  const linked: AtmRegisterMetaDto = {
    ...META,
    branches: [
      ...META.branches,
      {
        code: 'EGYCASH-5',
        name: { ar: 'أكتوبر', en: 'October' },
        branchId: OCT,
        branchName: OCT_NAME,
        branchActive: true,
        canView: true,
        canCreate: true,
        resolvedBranchId: MOH,
        resolvedBranchName: MOH_NAME,
      },
    ],
  };

  it('marks a code whose branch works as another, with the reason in its tooltip', () => {
    for (const extra of [[], ['setting.edit']] as const) {
      const html = renderWith(createElement(RegisterImportPage), extra, linked);
      expect(html).toContain('data-register-settings-works-as="EGYCASH-5"');
      expect(html).toContain(
        translate('en', 'atm.registerSettings.worksAs', { target: 'Mohandessin' }),
      );
      expect(html).toContain(
        `title="${translate('en', 'atm.registerSettings.worksAsHint', { target: 'Mohandessin' })}"`,
      );
      expect(html).not.toContain('data-register-settings-works-as="EGYCASH-4"');
      // The codes and the workbook's names stay on this card.
      expect(html).toContain('>EGYCASH-5<');
      expect(html).toContain('>أكتوبر<');
    }
  });

  it('refreshes the entries and the Data Report with the meta when the mapping is saved', () => {
    expect(REGISTER_MAPPING_STALES).toEqual([
      registerKeys.meta,
      registerKeys.entries,
      registerKeys.report,
    ]);
  });
});

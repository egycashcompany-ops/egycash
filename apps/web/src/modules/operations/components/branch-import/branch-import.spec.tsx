// «استيراد فروع من شيت» (Round 29) — the screen's half: the button beside «إضافة فرع» (for a manager
// of the reference data only, on the branches tab only), the two steps, the comparison drawn — the
// counts, the new areas, «كود معدَّل», old → new, the problems and why — the filters and the
// search, «تأكيد الاستيراد» when there is something to write, the refusals' words, and the keys
// in both catalogs. Node-only: rendered with `renderToStaticMarkup`, the rules called directly.
// Synthetic branches only.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ErrorCodes,
  OPERATIONS_BRANCH_IMPORT_AREA_NOTES,
  OPERATIONS_BRANCH_IMPORT_PROBLEMS,
  OPERATIONS_BRANCH_IMPORT_ROLES,
  type Locale,
  type MeDto,
  type OperationsBankDto,
  type OperationsBranchImportCompareDto,
  type OperationsBranchImportRowDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { uiSlice } from '../../../../store/uiSlice';
import { translate } from '../../../../platform/localization/i18n';
import { ApiError } from '../../../../shared/lib/api-client';
import { PLURAL_FORMS } from '../../../../shared/lib/plural';
import { __operationsKeys } from '../../api/operations-queries';
import { branchImportStales } from '../../api/branch-import';
import {
  BRANCH_IMPORT_FILTERS,
  filterCounts,
  importedToast,
  isOutOfDate,
  refusalKeyOf,
  suffixedWrites,
  visibleRows,
  writesAnything,
} from '../../lib/branch-import';
import { CatalogsPage } from '../../pages/CatalogsPage';
import { BranchImportConfirmDialog } from './BranchImportConfirmDialog';
import { BranchImportResult } from './BranchImportResult';
import { BranchImportUpload } from './BranchImportUpload';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const W = 'operations.catalogs.branchImport.';

const me = (permissions: string[]): MeDto =>
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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const render = (
  node: JSX.Element,
  {
    locale = 'ar',
    permissions = ['operationsCatalog.manage'],
    url = '/operations/catalogs',
  }: {
    locale?: Locale;
    permissions?: string[];
    url?: string;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/operations/catalogs" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const values = (code: string | null, area: string | null, address: string | null = null) => ({
  code,
  opsAreaName: area,
  financeAreaName: area,
  address,
});

const row = (over: Partial<OperationsBranchImportRowDto>): OperationsBranchImportRowDto => ({
  row: 2,
  name: 'فرع النخلة',
  sheetCode: '116',
  sheetArea: { ar: 'منطقة الأفق', en: 'Horizon' },
  sheetAddress: null,
  outcome: 'new',
  problem: null,
  branchId: null,
  inactive: false,
  before: null,
  after: values('116', 'منطقة الأفق'),
  changes: [],
  codeSuffixed: false,
  areaLatinOnly: false,
  areaIsNew: true,
  areaNote: null,
  similarTo: null,
  ...over,
});

const ROWS: OperationsBranchImportRowDto[] = [
  row({}),
  row({ row: 3, name: 'فرع السنديان', after: values('116-2', 'منطقة الأفق'), codeSuffixed: true }),
  row({
    row: 4,
    name: 'فرع قائم',
    sheetCode: '084',
    outcome: 'update',
    branchId: 'b1',
    before: values('500', 'منطقة قديمة'),
    after: values('084', 'منطقة الأفق'),
    changes: ['code', 'opsAreaName', 'financeAreaName'],
    areaIsNew: false,
  }),
  row({
    row: 5,
    name: 'Garden Branch',
    sheetCode: '7',
    sheetArea: { ar: 'Riverside', en: null },
    outcome: 'unchanged',
    branchId: 'b2',
    before: values('7', 'Riverside'),
    after: values('7', 'Riverside'),
    areaLatinOnly: true,
    areaIsNew: false,
  }),
  row({
    row: 6,
    name: null,
    sheetCode: '9',
    outcome: 'problem',
    problem: 'noName',
    after: null,
    areaIsNew: false,
  }),
];

const DTO: OperationsBranchImportCompareDto = {
  bankId: 'bank-1',
  bankName: 'البنك التجريبي',
  fileName: 'فروع البنك التجريبي.xlsx',
  fileSha256: 'a'.repeat(64),
  planDigest: 'b'.repeat(64),
  sheetName: 'الفروع',
  headerRow: 1,
  layout: [
    { role: 'name', column: 'A', header: 'اسم الفرع' },
    { role: 'code', column: 'B', header: 'رقم الفرع' },
    { role: 'areaAr', column: 'C', header: 'المنطقة' },
  ],
  counts: {
    rows: 5,
    new: 2,
    update: 1,
    unchanged: 1,
    problem: 1,
    suffixed: 1,
    areasNew: 1,
    areasFilled: 1,
    similar: 0,
    areaNotes: 0,
  },
  rows: ROWS,
  newAreas: [{ name: 'منطقة الأفق', nameEn: 'Horizon', rows: 3, latinOnly: false }],
  filledAreas: [{ id: 'a1', name: 'منطقة النجمة', nameEn: 'Star' }],
};

/** The opening tag of the element carrying `attribute`. */
const tagOf = (html: string, attribute: string): string => {
  const at = html.indexOf(attribute);
  expect(at, attribute).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

const BANKS = [
  { id: 'bank-1', opsName: 'البنك التجريبي', isActive: true },
  { id: 'bank-2', opsName: 'بنك آخر', isActive: true },
] as unknown as OperationsBankDto[];

describe('the rules of the comparison screen', () => {
  it('filters by outcome, «كود معدَّل» across them, and searches name, code and area', () => {
    expect(visibleRows(ROWS, 'all', '').map((r) => r.row)).toEqual([2, 3, 4, 5, 6]);
    expect(visibleRows(ROWS, 'new', '').map((r) => r.row)).toEqual([2, 3]);
    expect(visibleRows(ROWS, 'suffixed', '').map((r) => r.row)).toEqual([3]);
    expect(visibleRows(ROWS, 'problem', '').map((r) => r.row)).toEqual([6]);
    expect(visibleRows(ROWS, 'all', 'السنديان').map((r) => r.row)).toEqual([3]);
    expect(visibleRows(ROWS, 'all', '116-2').map((r) => r.row)).toEqual([3]);
    // The old code finds the row too, and Latin without case.
    expect(visibleRows(ROWS, 'all', '500').map((r) => r.row)).toEqual([4]);
    expect(visibleRows(ROWS, 'all', 'garden').map((r) => r.row)).toEqual([5]);
    // «ة» and «ه», «أ» and «ا» alike.
    expect(visibleRows(ROWS, 'update', 'منطقه الافق').map((r) => r.row)).toEqual([4]);
  });

  it('counts each filter from the comparison', () => {
    expect(filterCounts(DTO)).toEqual({
      all: 5,
      new: 2,
      update: 1,
      unchanged: 1,
      suffixed: 1,
      review: 0,
      problem: 1,
    });
    expect([...BRANCH_IMPORT_FILTERS]).toEqual(Object.keys(filterCounts(DTO)));
  });

  it('counts in «أكواد معدَّلة (ضمنها)» only the suffixed codes this import writes', () => {
    // A sheet imported before and read again: its held «116-2» is «كود معدَّل» but unchanged, so
    // the confirmation of the one new row must not say 2 codes are adjusted among 1 write.
    const again: OperationsBranchImportCompareDto = {
      ...DTO,
      rows: [
        row({ row: 2, outcome: 'unchanged', branchId: 'b1', before: values('116', null) }),
        row({
          row: 3,
          outcome: 'unchanged',
          branchId: 'b2',
          before: values('116-2', null),
          after: values('116-2', null),
          codeSuffixed: true,
        }),
        row({
          row: 4,
          outcome: 'update',
          branchId: 'b3',
          before: values('116-3', 'منطقة قديمة'),
          after: values('116-3', 'منطقة الأفق'),
          changes: ['opsAreaName', 'financeAreaName'],
          codeSuffixed: true,
        }),
        row({ row: 5, name: 'فرع جديد', after: values('116-4', null), codeSuffixed: true }),
        row({
          row: 6,
          outcome: 'update',
          branchId: 'b4',
          sheetCode: '200',
          before: values('900', null),
          after: values('200-2', null),
          changes: ['code'],
          codeSuffixed: true,
        }),
      ],
      counts: { ...DTO.counts, new: 1, update: 2, unchanged: 2, suffixed: 4 },
    };
    expect(suffixedWrites(again)).toBe(2);
    // Round 29 critic: the «كود معدَّل» tile and filter say the same — the two codes written.
    expect(filterCounts(again).suffixed).toBe(2);
    expect(visibleRows(again.rows, 'suffixed', '').map((r) => r.row)).toEqual([5, 6]);
    const drawn = render(
      <BranchImportResult
        result={again}
        outOfDate={false}
        refusal={null}
        busy={false}
        onAnother={() => undefined}
        onCompareAgain={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const rowOf = (n: number): string => {
      const at = drawn.indexOf(`data-branch-import-row="${String(n)}"`);
      const next = drawn.indexOf('data-branch-import-row=', at + 1);
      return drawn.slice(at, next === -1 ? undefined : next);
    };
    // The held «116-2», written nothing: its code and the sheet's, no «كود معدَّل» chip, no arrow.
    expect(rowOf(3)).toContain('data-branch-import-held-suffix="true"');
    expect(rowOf(3)).not.toContain('data-branch-import-suffixed');
    expect(rowOf(3)).not.toContain('data-branch-import-change');
    expect(rowOf(5)).toContain('data-branch-import-suffixed="true"');
    const html = renderToStaticMarkup(
      <Provider
        store={configureStore({
          reducer: { locale: localeSlice.reducer },
          preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
        })}
      >
        <BranchImportConfirmDialog
          result={again}
          open
          busy={false}
          onClose={() => undefined}
          onConfirm={() => undefined}
        />
      </Provider>,
    );
    const line = html.slice(html.indexOf(translate('ar', `${W}dialog.suffixed`)));
    expect(line.slice(0, line.indexOf('</li>'))).toMatch(/>2<\/span>$/u);
  });

  it('has something to write only with a new or updated branch, or an area', () => {
    expect(writesAnything(DTO)).toBe(true);
    const nothing = {
      ...DTO,
      counts: { ...DTO.counts, new: 0, update: 0, areasNew: 0, areasFilled: 0 },
    };
    expect(writesAnything(nothing)).toBe(false);
  });

  it('words each refusal, and knows the comparison went out of date', () => {
    const err = (code: string, status: number, detail?: string) =>
      new ApiError(
        code,
        'x',
        status,
        detail === undefined ? undefined : [{ field: 'file', code: detail, message: 'x' }],
      );
    expect(
      refusalKeyOf(err(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT, 422, 'MISSING_HEADER')),
    ).toBe(`${W}refusal.noHeader`);
    expect(refusalKeyOf(err(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT, 422, 'TOO_LARGE'))).toBe(
      `${W}refusal.tooLarge`,
    );
    expect(
      refusalKeyOf(err(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT, 422, 'MISSING_SHEET')),
    ).toBe(`${W}refusal.noSheet`);
    expect(refusalKeyOf(err(ErrorCodes.FILE_TOO_LARGE, 422))).toBe(`${W}refusal.fileTooLarge`);
    expect(refusalKeyOf(err(ErrorCodes.VALIDATION_FAILED, 422, 'UNREADABLE'))).toBe(
      `${W}refusal.unreadable`,
    );
    expect(refusalKeyOf(err(ErrorCodes.OPERATIONS_UNKNOWN_BANK, 422))).toBe(
      `${W}refusal.unknownBank`,
    );
    for (const code of [
      ErrorCodes.OPERATIONS_BRANCH_IMPORT_CHANGED,
      ErrorCodes.STALE_DOCUMENT,
      ErrorCodes.DUPLICATE,
    ]) {
      expect(refusalKeyOf(err(code, 409))).toBe(`${W}refusal.changed`);
      expect(isOutOfDate(err(code, 409))).toBe(true);
    }
    expect(refusalKeyOf(err(ErrorCodes.FORBIDDEN, 403))).toBeNull();
    expect(isOutOfDate(new Error('offline'))).toBe(false);
  });

  it('stales the branches and the areas after an import — the catalog dialogs’ own subtrees', () => {
    expect([...branchImportStales]).toEqual([__operationsKeys.branches, __operationsKeys.areas]);
  });
});

describe('the button beside «إضافة فرع»', () => {
  const page = (permissions: string[], kind = 'branches') =>
    render(<CatalogsPage />, { permissions, url: `/operations/catalogs?kind=${kind}` });

  it('is offered to a manager of the reference data on the branches tab', () => {
    const html = page(['operationsCatalog.manage', 'operationsShipment.view']);
    expect(html).toContain('data-branch-import-open="true"');
    expect(html).toContain(translate('ar', `${W}open`));
    expect(html).toContain(translate('ar', 'operations.catalogs.branch.add'));
  });

  it('is not offered on another tab, nor to a reader who cannot write the catalog', () => {
    expect(page(['operationsCatalog.manage'], 'banks')).not.toContain('data-branch-import-open');
    expect(page(['operationsShipment.view'])).not.toContain('data-branch-import-open');
  });
});

describe('the two steps', () => {
  it('asks for the bank first, lists the columns it reads, and compares only with both', () => {
    const html = render(
      <BranchImportUpload
        banks={BANKS}
        bankId=""
        file={null}
        reading={false}
        onBank={() => undefined}
        onFile={() => undefined}
        onCompare={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(html).toContain(translate('ar', `${W}stepBank`));
    expect(html).toContain(translate('ar', `${W}stepSheet`));
    expect(html).toContain('بنك آخر');
    for (const role of OPERATIONS_BRANCH_IMPORT_ROLES) {
      expect(html).toContain(translate('ar', `${W}col.${role}`));
    }
    expect(html).toContain(translate('ar', `${W}needsBank`));
    expect(tagOf(html, 'data-branch-import-compare="true"')).toContain('disabled=""');
    expect(html).not.toContain(W);
  });
});

describe('the comparison, drawn', () => {
  const result = (
    over: Partial<Parameters<typeof BranchImportResult>[0]> = {},
    locale: Locale = 'ar',
  ) =>
    render(
      <BranchImportResult
        result={DTO}
        outOfDate={false}
        refusal={null}
        busy={false}
        onAnother={() => undefined}
        onCompareAgain={() => undefined}
        onConfirm={() => undefined}
        {...over}
      />,
      { locale },
    );

  it('shows the sheet, the counts, the new areas and every row with its outcome', () => {
    const html = result();
    expect(html).toContain(translate('ar', `${W}resultTitle`, { bank: 'البنك التجريبي' }));
    expect(html).toContain(translate('ar', `${W}rowsCount.few`, { count: 5 }));
    for (const kpi of ['new', 'update', 'unchanged', 'suffixed', 'problem']) {
      expect(html).toContain(`data-branch-import-kpi="${kpi}"`);
    }
    expect(html).toContain('data-branch-import-area="منطقة الأفق"');
    expect(html).toContain('Horizon');
    expect(html).toContain('Star');
    expect(html).toContain('data-branch-import-rows="5"');
    expect(html).toContain('data-branch-import-outcome="update"');
    expect(html).toContain('data-branch-import-suffixed="true"');
    expect(html).toContain(translate('ar', `${W}filter.suffixed`));
    // old → new on the update.
    expect(html).toContain('500');
    expect(html).toContain('منطقة قديمة');
    expect(html).toContain(translate('ar', `${W}problem.noName`));
    expect(html).toContain('data-branch-import-latin="true"');
    expect(tagOf(html, 'data-branch-import-confirm="true"')).not.toContain('disabled=""');
    expect(html).not.toContain(W);
  });

  it('says nothing is to be written, and holds back the confirm, when that is so', () => {
    const nothing = {
      ...DTO,
      counts: { ...DTO.counts, new: 0, update: 0, areasNew: 0, areasFilled: 0 },
      newAreas: [],
      filledAreas: [],
    };
    const html = result({ result: nothing });
    expect(html).toContain(translate('ar', `${W}confirmNothing`));
    expect(tagOf(html, 'data-branch-import-confirm="true"')).toContain('disabled=""');
  });

  it('offers «مقارنة من جديد» when the comparison went out of date', () => {
    const html = result({ outOfDate: true, refusal: translate('ar', `${W}refusal.changed`) });
    expect(html).toContain('data-branch-import-refusal="changed"');
    expect(html).toContain('data-branch-import-compare-again="true"');
    expect(html).toContain(translate('ar', `${W}refusal.changed`));
  });

  it('draws in English too, with no raw key', () => {
    expect(result({}, 'en')).not.toContain(W);
  });

  it('draws each column letter without ligatures — «(C)» never turns into «©»', () => {
    // The digits' font joins «(C)» into one copyright glyph in a left-to-right line.
    const html = result({}, 'en');
    for (const column of ['A', 'B', 'C']) {
      expect(tagOf(html, `data-branch-import-column="${column}"`)).toContain(
        '[font-variant-ligatures:none]',
      );
    }
  });
});

describe('the rows to review before confirming (Round 29 critic)', () => {
  const REVIEW: OperationsBranchImportCompareDto = {
    ...DTO,
    rows: [
      ...ROWS,
      row({
        row: 7,
        name: 'فرع النرجسي',
        sheetCode: '2',
        after: values('2-2', null),
        codeSuffixed: true,
        areaIsNew: false,
        similarTo: { branchId: 'b9', name: 'فرع النرجسى', code: '2' },
      }),
      row({
        row: 8,
        name: 'فرع الكروم',
        sheetCode: '10',
        sheetArea: { ar: 'منطقة الكروم', en: 'Orchard' },
        after: values('10', 'منطقة البستان'),
        areaIsNew: false,
        areaNote: 'byEnglish',
      }),
    ],
    counts: { ...DTO.counts, rows: 7, new: 4, suffixed: 2, similar: 1, areaNotes: 1 },
  };
  const result = (dto: OperationsBranchImportCompareDto) =>
    render(
      <BranchImportResult
        result={dto}
        outOfDate={false}
        refusal={null}
        busy={false}
        onAnother={() => undefined}
        onCompareAgain={() => undefined}
        onConfirm={() => undefined}
      />,
    );

  it('filters them, says so above the counts, and marks each row with its reason', () => {
    expect(filterCounts(REVIEW).review).toBe(2);
    expect(visibleRows(REVIEW.rows, 'review', '').map((r) => r.row)).toEqual([7, 8]);
    const html = result(REVIEW);
    expect(html).toContain('data-branch-import-review="true"');
    expect(html).toContain(translate('ar', `${W}reviewShow`, { count: 2 }));
    expect(html).toContain('data-branch-import-filter="review"');
    expect(html).toContain('data-branch-import-similar="true"');
    expect(html).toContain(translate('ar', `${W}similarTo`, { name: 'فرع النرجسى', code: '2' }));
    expect(html).toContain('data-branch-import-area-note="byEnglish"');
    expect(html).toContain(
      translate('ar', `${W}areaNote.byEnglish`, { area: 'منطقة الكروم | Orchard', en: 'Orchard' }),
    );
    expect(html).not.toContain(W);
  });

  it('shows no «للمراجعة» when no row needs it', () => {
    const html = result(DTO);
    expect(html).not.toContain('data-branch-import-review=');
    expect(html).not.toContain('data-branch-import-filter="review"');
  });

  it('counts them in the confirmation, and only when there are some', () => {
    const dialog = (dto: OperationsBranchImportCompareDto) =>
      render(
        <BranchImportConfirmDialog
          result={dto}
          open
          busy={false}
          onClose={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    const html = dialog(REVIEW);
    expect(html).toContain(translate('ar', `${W}dialog.similar`));
    expect(html).toContain(translate('ar', `${W}dialog.areaNotes`));
    const none = dialog(DTO);
    expect(none).not.toContain(translate('ar', `${W}dialog.similar`));
    expect(none).not.toContain(translate('ar', `${W}dialog.areaNotes`));
  });
});

describe('what a screen reader and a toast are given (Round 29 critic)', () => {
  const html = render(
    <BranchImportResult
      result={DTO}
      outOfDate={false}
      refusal={null}
      busy={false}
      onAnother={() => undefined}
      onCompareAgain={() => undefined}
      onConfirm={() => undefined}
    />,
  );

  it('makes the filters toggle buttons — one Tab stop each, the one on pressed', () => {
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('role="radiogroup"');
    expect(tagOf(html, 'data-branch-import-filter="all"')).toContain('aria-pressed="true"');
    expect(tagOf(html, 'data-branch-import-filter="new"')).toContain('aria-pressed="false"');
  });

  it('says «كان» and «أصبح» on an old → new value, not only by a strike-through', () => {
    const at = html.indexOf('data-branch-import-row="4"');
    const update = html.slice(at, html.indexOf('data-branch-import-row="5"'));
    expect(update).toContain(`<span class="sr-only">${translate('ar', `${W}change.was`)} </span>`);
    expect(update).toContain(`<span class="sr-only">${translate('ar', `${W}change.now`)} </span>`);
  });

  it('keeps the toast’s title short and gives every count in its description', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      translate('ar', key, params);
    const words = importedToast(t, {
      bankId: 'bank-1',
      branchesCreated: 200,
      branchesUpdated: 1,
      unchanged: 0,
      problems: 0,
      areasCreated: 37,
      areasFilled: 4,
    });
    expect(words.title).toBe(translate('ar', `${W}done`));
    expect(words.title).not.toMatch(/\d/u);
    for (const n of ['200', '1', '37', '4']) expect(words.description).toContain(n);
  });
});

describe('the words', () => {
  const KEYS = [
    'open',
    'title',
    'nothingWritten',
    'back',
    'stepBank',
    'bankPlaceholder',
    'bankHint',
    'stepSheet',
    'columnsNote',
    'othersIgnored',
    'areaNote',
    'removeFile',
    'compare',
    'comparing',
    'needsBank',
    'needsFile',
    'resultTitle',
    'another',
    'layout',
    'latinNote',
    'areas.title',
    'areas.noEnglish',
    'areas.filled',
    'filterLabel',
    'search',
    'col.row',
    'col.branch',
    'col.codeHead',
    'col.areaHead',
    'col.addressHead',
    'col.outcome',
    'badge.newArea',
    'badge.latin',
    'badge.inactive',
    'financeWas',
    'empty',
    'confirm',
    'confirmHint',
    'confirmNothing',
    'applying',
    'compareAgain',
    'dialog.title',
    'dialog.lead',
    'dialog.new',
    'dialog.update',
    'dialog.suffixed',
    'dialog.areas',
    'dialog.filled',
    'dialog.problems',
    'dialog.note',
    'dialog.cancel',
    'done',
    'doneDetail',
    'reviewNote',
    'reviewShow',
    'badge.similar',
    'similarTo',
    'sheetCode',
    'change.was',
    'change.now',
    'dialog.similar',
    'dialog.areaNotes',
    ...OPERATIONS_BRANCH_IMPORT_AREA_NOTES.map((note) => `areaNote.${note}`),
    ...OPERATIONS_BRANCH_IMPORT_ROLES.map((role) => `col.${role}`),
    ...BRANCH_IMPORT_FILTERS.map((filter) => `filter.${filter}`),
    ...(['new', 'update', 'unchanged', 'problem'] as const).map((o) => `outcome.${o}`),
    ...(['new', 'update', 'unchanged', 'suffixed', 'problem'] as const).flatMap((k) => [
      `kpi.${k}`,
      `kpi.${k}Note`,
    ]),
    ...OPERATIONS_BRANCH_IMPORT_PROBLEMS.map((problem) => `problem.${problem}`),
    ...[
      'noHeader',
      'tooLarge',
      'noSheet',
      'fileTooLarge',
      'unreadable',
      'unknownBank',
      'changed',
    ].map((r) => `refusal.${r}`),
    ...PLURAL_FORMS.map((form) => `rowsCount.${form}`),
  ];

  it('holds every key in both catalogs', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const key of KEYS)
        expect(translate(locale, `${W}${key}`), `${locale} ${key}`).not.toBe(`${W}${key}`);
    }
  });
});

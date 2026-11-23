// «رفع جماعي» — `/it/assets/import`, proved against what it renders (no DOM here: static markup).
//
// «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو
// فى تكرار أو تضارب مع بيانات موجوده وهكذا» (the owner, 2026-11-16): step 1 offers the template, the
// file, the branch («الفرع بيتختار من الشاشة» — or the sheet's name suggests it) and «معاينة»; the
// preview words every line's decision, ticks only what may be written, counts the decisions as
// chips, files each kind under a category, and confirms the lines kept; the result links what was
// written. The register's toolbar offers the page to whoever may register assets, and nobody else.
// Fixture serials and codes are invented.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  IT_ASSET_IMPORT_DECISIONS,
  type ItAssetImportDecision,
  type ItAssetImportPreviewDto,
  type ItAssetImportResultDto,
  type ItAssetImportRowDto,
  type ItMoveTargetsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { formatNumber } from '../../../shared/lib/format';
import { translate } from '../../../platform/localization/i18n';
import { AssetImportPreview } from '../components/AssetImportPreview';
import { AssetImportResult } from '../components/AssetImportResult';
import { defaultSelection } from '../lib/asset-import';
import { AssetsImportPage } from './AssetsImportPage';
import { AssetsListPage } from './AssetsListPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const n = (value: number): string => formatNumber(value, 'ar');

const ZAYED = '64b000000000000000000001';
const MOHANDESSIN = '64b000000000000000000002';
const DESKTOPS = '64c000000000000000000001';
const PRINTERS = '64c000000000000000000002';

const me = (permissions: Record<string, string>): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'سامح', en: 'Sameh' }, lastName: { ar: 'نبيل', en: 'Nabil' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions,
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const category = (id: string, name: string) => ({
  id,
  kind: 'assetCategory' as const,
  code: null,
  name: { ar: name, en: name },
  description: null,
  sortOrder: 0,
  isActive: true,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
});

const branch = (id: string, name: string) => ({ id, name: { ar: name, en: name }, code: null });

const render = (
  node: JSX.Element,
  {
    path = '/it/assets/import',
    permissions = { 'itAsset.view': 'organization', 'itAsset.create': 'organization' },
    importBranches = [ZAYED, MOHANDESSIN],
  }: {
    path?: string;
    permissions?: Record<string, string>;
    /** What `GET /it/assets/import/branches` answered — null: not yet. */
    importBranches?: string[] | null;
  } = {},
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    branch(ZAYED, 'الشيخ زايد'),
    branch(MOHANDESSIN, 'المهندسين'),
  ]);
  if (importBranches !== null) {
    qc.setQueryData<ItMoveTargetsDto>(listKey('it', 'assetImportBranches'), {
      branchIds: importBranches,
    });
  }
  qc.setQueryData(listKey('it', 'catalogs', { kind: 'assetCategory', select: true }), {
    items: [category(DESKTOPS, 'كمبيوتر مكتبي'), category(PRINTERS, 'طابعات')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  const page = { items: [], meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } };
  qc.setQueryData(
    listKey('it', 'assets', { page: 1, pageSize: 25, sortBy: 'assetCode', sortDir: 'asc' }),
    page,
  );
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '').trim();

/** The cells of the row whose tick names `row`, as markup. */
const rowOf = (html: string, row: number): string[] => {
  const found = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].find((m) =>
    (m[1] ?? '').includes(`data-import-tick="${String(row)}"`),
  );
  expect(found, `row ${String(row)}`).toBeDefined();
  return [...(found?.[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => m[1] ?? '');
};

/** The tick's own tag for one row. */
const tickOf = (html: string, row: number): string =>
  /<input[^>]*data-import-tick="\d+"[^>]*>/u.exec(rowOf(html, row)[0] ?? '')?.[0] ?? '';

describe('the register’s toolbar', () => {
  it('offers «رفع جماعي» to whoever may register assets', () => {
    const html = render(<AssetsListPage />, { path: '/it/assets' });
    const button = /<button[^>]*data-asset-import="true"[^>]*>([\s\S]*?)<\/button>/u.exec(html);
    expect(button).not.toBeNull();
    expect(text(button?.[1] ?? '')).toBe('رفع جماعي');
  });

  it('and to nobody who may only read the register', () => {
    const html = render(<AssetsListPage />, {
      path: '/it/assets',
      permissions: { 'itAsset.view': 'organization' },
    });
    expect(html).not.toContain('data-asset-import');
  });
});

describe('step 1 — the template, the file, the branch and «معاينة»', () => {
  const html = render(<AssetsImportPage />);

  it('offers «تحميل النموذج», and says what the file may hold', () => {
    expect(
      text(/<button[^>]*data-import-template[^>]*>([\s\S]*?)<\/button>/u.exec(html)?.[1] ?? ''),
    ).toBe('تحميل النموذج');
    expect(html).toContain(ar('it.assets.import.limits', { rows: n(500), mb: n(5) }));
  });

  it('takes one .xlsx file', () => {
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.xlsx,[^"]*"/u);
    expect(html).not.toMatch(/<input[^>]*type="file"[^>]*multiple/u);
  });

  it('lets the sheet’s name suggest the branch, or a branch be chosen', () => {
    const select =
      /<select[^>]*data-import-branch[^>]*>([\s\S]*?)<\/select>/u.exec(html)?.[1] ?? '';
    expect(select).toMatch(/^<option value="" selected="">من اسم الورقة<\/option>/u);
    expect(select).toContain(`<option value="${ZAYED}">الشيخ زايد</option>`);
    expect(select).toContain(`<option value="${MOHANDESSIN}">المهندسين</option>`);
  });

  it('holds «معاينة» until a file is chosen — and shows no preview yet', () => {
    const preview = /<button[^>]*data-import-preview[^>]*>/u.exec(html)?.[0] ?? '';
    expect(preview).toContain('disabled=""');
    expect(html).not.toContain('data-import-confirm');
  });
});

describe('step 1 — the branches the select offers', () => {
  const selectOf = (markup: string): { tag: string; options: string } => {
    const found = /(<select[^>]*data-import-branch[^>]*>)([\s\S]*?)<\/select>/u.exec(markup);
    return { tag: found?.[1] ?? '', options: found?.[2] ?? '' };
  };

  it('only those the server says the create grant reaches — as the move dialogs do', () => {
    const { tag, options } = selectOf(render(<AssetsImportPage />, { importBranches: [ZAYED] }));
    expect(options).toContain(`<option value="${ZAYED}">الشيخ زايد</option>`);
    expect(options).not.toContain(MOHANDESSIN);
    expect(tag).not.toContain('disabled=""');
  });

  it('waits while the list is on its way — the select and «معاينة» both', () => {
    const html = render(<AssetsImportPage />, { importBranches: null });
    const { tag, options } = selectOf(html);
    expect(tag).toContain('disabled=""');
    expect(options).toBe(`<option value="" selected="">${ar('common.loading')}</option>`);
    expect(html).not.toContain(ar('it.assets.import.noBranch'));
    expect(/<button[^>]*data-import-preview[^>]*>/u.exec(html)?.[0]).toContain('disabled=""');
  });

  it('says so when there is no branch to register in', () => {
    const html = render(<AssetsImportPage />, { importBranches: [] });
    const { tag, options } = selectOf(html);
    expect(tag).toContain('disabled=""');
    expect(options).not.toContain(ZAYED);
    expect(html).toContain(ar('it.assets.import.noBranch'));
  });
});

// ── The preview ─────────────────────────────────────────────────────────────────────────────────

const line = (over: Partial<ItAssetImportRowDto>): ItAssetImportRowDto => ({
  row: 2,
  kind: 'كمبيوتر مكتبي',
  name: 'Dell OptiPlex 7090',
  serial: null,
  tag: null,
  manufacturer: 'Dell',
  model: 'OptiPlex 7090',
  decision: 'new',
  warnings: [],
  asset: null,
  serialNumber: null,
  externalTag: null,
  categoryId: DESKTOPS,
  fills: [],
  kept: [],
  fromBranchId: null,
  firstRow: null,
  near: null,
  message: null,
  selectable: true,
  selected: true,
  ...over,
});

const ROWS: ItAssetImportRowDto[] = [
  // The Dell service tag is the serial number; the sheet's «سيريال» becomes the printed tag.
  line({
    row: 2,
    tag: 'HQ4ZL72',
    serial: 'CN0Y7Q2',
    serialNumber: 'HQ4ZL72',
    externalTag: 'CN0Y7Q2',
  }),
  line({
    row: 3,
    serial: 'ZQ7K2M1',
    serialNumber: 'ZQ7K2M1',
    warnings: ['nearSerial'],
    near: { assetCode: 'AST-00031', serialNumber: 'ZQ7K2N1' },
    selected: false,
  }),
  line({
    row: 4,
    decision: 'fill',
    serial: 'PF3BX0Q',
    asset: { id: 'a-fill', assetCode: 'AST-00040', branchId: ZAYED, status: 'assigned' },
    fills: ['specs.processor', 'accessories'],
    kept: [{ field: 'model', register: 'OptiPlex 7080', sheet: 'OptiPlex 7090' }],
  }),
  line({
    row: 5,
    decision: 'move',
    serial: 'PF3BX0R',
    asset: { id: 'a-move', assetCode: 'AST-00041', branchId: MOHANDESSIN, status: 'inStock' },
    fromBranchId: MOHANDESSIN,
  }),
  line({
    row: 6,
    decision: 'heldElsewhere',
    serial: 'PF3BX0S',
    asset: { id: 'a-held', assetCode: 'AST-00042', branchId: MOHANDESSIN, status: 'assigned' },
    fromBranchId: MOHANDESSIN,
    fills: ['manufacturer'],
  }),
  line({
    row: 7,
    decision: 'complete',
    serial: 'PF3BX0T',
    asset: { id: 'a-done', assetCode: 'AST-00043', branchId: ZAYED, status: 'inStock' },
    selectable: false,
    selected: false,
  }),
  line({
    row: 8,
    decision: 'outOfScope',
    serial: 'PF3BX0U',
    // The plan found what the device lacks before the scope was judged — nothing is written here.
    fills: ['manufacturer'],
    message: 'itAsset.edit does not reach this asset',
    selectable: false,
    selected: false,
  }),
  line({
    row: 9,
    decision: 'duplicateInFile',
    serial: 'PF3BX0Q',
    firstRow: 4,
    selectable: false,
    selected: false,
  }),
  line({ row: 10, decision: 'noIdentifier', selectable: false, selected: false }),
  line({
    row: 11,
    kind: 'ماسح ضوئي',
    decision: 'unknownKind',
    tag: 'TR8M2KD',
    serialNumber: 'TR8M2KD',
    categoryId: null,
    selectable: false,
    selected: false,
  }),
  line({
    row: 12,
    decision: 'new',
    tag: '7KX45AV',
    serialNumber: '7KX45AV',
    warnings: ['productNumber'],
    selected: false,
  }),
];

const counts = (): Record<ItAssetImportDecision, number> => {
  const out = Object.fromEntries(IT_ASSET_IMPORT_DECISIONS.map((d) => [d, 0])) as Record<
    ItAssetImportDecision,
    number
  >;
  for (const row of ROWS) out[row.decision] += 1;
  return out;
};

const PREVIEW: ItAssetImportPreviewDto = {
  fileSha256: 'a'.repeat(64),
  planHash: 'b'.repeat(64),
  sheetName: 'عهدة فرع الشيخ زايد',
  branchId: ZAYED,
  suggestedBranchId: ZAYED,
  kinds: [
    { kind: 'كمبيوتر مكتبي', categoryId: DESKTOPS, rows: 10 },
    { kind: 'ماسح ضوئي', categoryId: null, rows: 1 },
  ],
  rows: ROWS,
  counts: counts(),
};

const names: Record<string, string> = { [ZAYED]: 'الشيخ زايد', [MOHANDESSIN]: 'المهندسين' };

const renderPreview = (
  filter: ItAssetImportDecision | null = null,
  preview: ItAssetImportPreviewDto = PREVIEW,
): string =>
  render(
    <AssetImportPreview
      preview={preview}
      selection={defaultSelection(ROWS)}
      onSelectionChange={() => undefined}
      filter={filter}
      onFilterChange={() => undefined}
      categoryOf={(kind) => kind.categoryId ?? ''}
      onCategoryChange={() => undefined}
      branchName={(id) => names[id]}
      busy={false}
      confirming={false}
      onConfirm={() => undefined}
    />,
  );

describe('step 2 — the preview', () => {
  const html = renderPreview();

  it('says first that nothing has been written, and which sheet suggested the branch', () => {
    expect(html.indexOf(ar('it.assets.import.previewNotice'))).toBeGreaterThan(-1);
    expect(html.indexOf(ar('it.assets.import.previewNotice'))).toBeLessThan(
      html.indexOf('data-import-chip'),
    );
    expect(html).toContain('الورقة: عهدة فرع الشيخ زايد');
    expect(html).toContain(ar('it.assets.import.suggested'));
  });

  // «تأكيد» writes to the branch the plan is for — said in words, whatever the select shows.
  it('names the branch the plan is for', () => {
    expect(html).toContain(
      `<p class="font-semibold" data-import-plan-branch="${ZAYED}">المعاينة لفرع الشيخ زايد</p>`,
    );
    const other = renderPreview(null, { ...PREVIEW, branchId: MOHANDESSIN });
    expect(other).toContain(
      `<p class="font-semibold" data-import-plan-branch="${MOHANDESSIN}">المعاينة لفرع المهندسين</p>`,
    );
    expect(other).toContain('اسم الورقة يشير إلى فرع الشيخ زايد.');
    expect(other).not.toContain('المعاينة لفرع الشيخ زايد');
  });

  it('counts each decision the file holds as a chip, in the catalogue’s order', () => {
    const chips = [...html.matchAll(/data-import-chip="([a-zA-Z]+)"/gu)].map((m) => m[1]);
    expect(chips).toEqual([
      'new',
      'fill',
      'move',
      'complete',
      'heldElsewhere',
      'outOfScope',
      'duplicateInFile',
      'noIdentifier',
      'unknownKind',
    ]);
    const chip = /<button[^>]*data-import-chip="new"[^>]*>([\s\S]*?)<\/button>/u.exec(html)?.[1];
    expect(text(chip ?? '')).toBe(`جديد${n(3)}`);
  });

  it('a pressed chip shows its decision’s lines only', () => {
    const moves = renderPreview('move');
    expect(moves).toContain('data-import-tick="5"');
    expect(moves).not.toContain('data-import-tick="2"');
    expect(moves).toContain('aria-pressed="true" data-import-chip="move"');
    expect(moves).toContain('aria-pressed="false" data-import-chip="new"');
  });

  it('words every decision on its line', () => {
    const decision = (row: number): string => {
      const cell = rowOf(html, row).find((c) => c.includes('data-import-decision')) ?? '';
      return text(cell);
    };
    expect(decision(2)).toBe('جديد');
    expect(decision(4)).toBe('تكملة بيانات');
    expect(decision(5)).toBe('نقل من فرع المهندسين');
    expect(decision(6)).toBe('متسلَّم في فرع المهندسين — لا يُنقل');
    expect(decision(7)).toBe('موجود ومكتمل');
    expect(decision(8)).toBe('خارج صلاحيتك');
    expect(decision(9)).toBe('مكرر — الصف 4');
    expect(decision(10)).toBe('بلا سيريال ولا ملصق');
    expect(decision(11)).toBe('نوع بلا فئة');
  });

  // The API says 'an open maintenance order holds it — it is not moved': nobody holds it.
  it('a device kept in another branch by maintenance is not called «held»', () => {
    const kept = renderPreview(null, {
      ...PREVIEW,
      rows: ROWS.map((row) =>
        row.row === 6 && row.asset !== null
          ? {
              ...row,
              asset: { ...row.asset, status: 'inStock' as const },
              message: 'an open maintenance order holds it — it is not moved',
            }
          : row,
      ),
    });
    const cell = rowOf(kept, 6).find((c) => c.includes('data-import-decision')) ?? '';
    expect(text(cell)).toBe('في الصيانة في فرع المهندسين — لا يُنقل');
    expect(kept).not.toContain('متسلَّم في فرع المهندسين');
    // Nor by its chip, which counts it among the devices left where they are.
    expect(kept).not.toContain('متسل');
  });

  // The chip counts held, maintained and disposed devices alike: it says only what they share.
  it('the chip of the devices left in another branch claims no holder', () => {
    const chip = /<button[^>]*data-import-chip="heldElsewhere"[^>]*>([\s\S]*?)<\/button>/u.exec(
      html,
    )?.[1];
    expect(text(chip ?? '')).toBe(`في فرع آخر — لا يُنقل${n(1)}`);
  });

  it('ticks what the server ticked, leaves a doubt off, and never lets an unwritable line be ticked', () => {
    expect(tickOf(html, 2)).toContain('checked=""');
    expect(tickOf(html, 2)).not.toContain('disabled=""');
    // A doubt — selectable, unticked.
    expect(tickOf(html, 3)).not.toContain('checked=""');
    expect(tickOf(html, 3)).not.toContain('disabled=""');
    for (const row of [7, 8, 9, 10, 11]) {
      expect(tickOf(html, row), `row ${String(row)}`).toContain('disabled=""');
      expect(tickOf(html, row), `row ${String(row)}`).not.toContain('checked=""');
    }
  });

  it('names the doubts in words', () => {
    expect(text(rowOf(html, 3).join(''))).toContain('قريب من جهاز مسجَّل: AST-00031 — راجع الملصق');
    expect(text(rowOf(html, 12).join(''))).toContain('الملصق رقم منتج وليس سيريالًا');
  });

  it('shows what a match fills and keeps, in the asset screen’s words, and links the device', () => {
    const fill = rowOf(html, 4).join('');
    expect(fill).toContain('href="/it/assets/a-fill"');
    expect(text(fill)).toContain('AST-00040');
    expect(text(fill)).toContain(`يُكمَّل: ${ar('it.assets.specs.processor')}، المشتملات`);
    expect(text(fill)).toContain(
      'يبقى كما في السجل — الموديل: «OptiPlex 7080»، وفي الملف «OptiPlex 7090»',
    );
    expect(rowOf(html, 5).join('')).toContain('href="/it/assets/a-move"');
  });

  it('shows a new line’s labels as they will be registered', () => {
    const fresh = text(rowOf(html, 2).join(''));
    expect(fresh).toContain('الرقم التسلسلي: HQ4ZL72');
    expect(fresh).toContain('الملصق المطبوع: CN0Y7Q2');
  });

  it('names no device, code or branch the reader may not see', () => {
    const outside = rowOf(html, 8).join('');
    expect(outside).not.toContain('href="/it/assets/');
    expect(outside).not.toContain('AST-');
  });

  it('says «يُكمَّل» only where a tick writes it — not on a line out of reach', () => {
    expect(text(rowOf(html, 8).join(''))).not.toContain('يُكمَّل');
    // A device held elsewhere is not moved, but still filled.
    expect(text(rowOf(html, 6).join(''))).toContain(
      `يُكمَّل: ${ar('it.assets.fields.manufacturer')}`,
    );
  });

  it('files each kind under a category — the one the server could not file asks for one', () => {
    const desktops = new RegExp(
      `<select[^>]*aria-label="${ar('it.assets.import.kinds.categoryOf', { kind: 'كمبيوتر مكتبي' })}"[^>]*>([\\s\\S]*?)</select>`,
      'u',
    ).exec(html)?.[1];
    expect(desktops).toContain(`<option value="${DESKTOPS}" selected="">كمبيوتر مكتبي</option>`);
    const scanners = new RegExp(
      `<select[^>]*aria-label="${ar('it.assets.import.kinds.categoryOf', { kind: 'ماسح ضوئي' })}"[^>]*>([\\s\\S]*?)</select>`,
      'u',
    ).exec(html)?.[1];
    expect(scanners).toMatch(/^<option value="" selected="">اختر فئة<\/option>/u);
  });

  it('confirms the lines kept — «تأكيد (n)» — and offers «تحديد الكل»', () => {
    const confirm = /<button[^>]*data-import-confirm[^>]*>([\s\S]*?)<\/button>/u.exec(html);
    expect(text(confirm?.[1] ?? '')).toBe(`تأكيد (${n(4)})`);
    expect(confirm?.[0]).not.toContain('disabled=""');
    expect(html).toContain('>تحديد الكل</button>');
  });

  it('keeps the wide table inside its own scroll on a phone', () => {
    expect(html).toMatch(/<div class="relative overflow-x-auto[^"]*"><table/u);
  });
});

describe('step 3 — what was written', () => {
  const result: ItAssetImportResultDto = {
    created: 2,
    filled: 1,
    moved: 1,
    unchanged: 0,
    assets: [
      { row: 2, assetId: 'a-new', assetCode: 'AST-00090', action: 'created' },
      { row: 4, assetId: 'a-fill', assetCode: 'AST-00040', action: 'filled' },
      { row: 5, assetId: 'a-move', assetCode: 'AST-00041', action: 'moved' },
    ],
  };
  const html = render(<AssetImportResult result={result} onAgain={() => undefined} />);

  it('counts what was done, without the zeros', () => {
    const counted = [...html.matchAll(/data-import-result="([a-z]+)"/gu)].map((m) => m[1]);
    expect(counted).toEqual(['created', 'filled', 'moved']);
    expect(html).toContain(
      `سُجِّل جديدًا: <span class="font-semibold tabular-nums">${n(2)}</span>`,
    );
  });

  it('links every asset written', () => {
    for (const id of ['a-new', 'a-fill', 'a-move'])
      expect(html).toContain(`href="/it/assets/${id}"`);
    expect(html).toContain('>نُقل</span>');
    expect(html).toContain('>رفع ملف آخر</button>');
  });
});

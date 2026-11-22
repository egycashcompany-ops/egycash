// «لما حد فى فرع بيسلم جهاز لحد فى فرع تاني مش بيعرف يشوف اسمه سواء فى الأصول أو المستهلكات .. أسمح
// إنه يعرف يسلم لحد فى فرع تاني» (owner, 2026-11-18).
//
// The hand-over's person box, as it renders: with `handOver` it asks `/it/people/recipients` — in
// every branch, under its own key — opens for a reader holding ANY of the three registers' «تسليم»
// (the owner's «صاحب صلاحية التسليم») and says «no access» to anyone else, and each row also names
// the branch HR places the person in. Without the prop — every filter box — it is exactly the box
// it was: the same request, the same key, the same rows. And the asset transfer's «الفرع الجديد»
// offers only what the server's `itAsset.assign` reaches whole («نقل إلى فرع»'s own list), since
// the transfer now refuses any other.
//
// The web suite has no DOM to type into (`vitest.config.ts`), so the request is proven through the
// query the render registers (fetched, it makes the call the browser would), and the row by the
// row component itself; the few lines that wire them are pinned in the source.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItMoveTargetsDto,
  type ItPersonDto,
  type ItRecipientDto,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import * as api from '../api/it-api';
import {
  EmployeePicker,
  EmployeePickerRow,
  employeePickerRows,
  pickerLabel,
  recipientBranchName,
} from './EmployeePicker';
import { TransferAssetDialog } from './CustodyDialogs';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

vi.mock('../api/it-api', async (actual) => ({
  ...(await actual<typeof api>()),
  searchPeople: vi.fn(),
  searchRecipients: vi.fn(),
  moveTargets: vi.fn(),
}));
const searchPeople = vi.mocked(api.searchPeople);
const searchRecipients = vi.mocked(api.searchRecipients);
const moveTargets = vi.mocked(api.moveTargets);

afterEach(() => {
  searchPeople.mockReset();
  searchRecipients.mockReset();
  moveTargets.mockReset();
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: 'b-hq',
    branchIds: ['b-hq'],
    employeeId: null,
    // A keeper of ONE branch — the one the owner's complaint is about.
    permissions: Object.fromEntries(permissions.map((key) => [key, 'branch' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

/** The three registers' read grants — what opens `/it/people`, and NOT the hand-over's box. */
const READERS = ['itAsset.view', 'itMobileLine.view', 'itConsumable.view'];
const HAND_OVER_GRANTS = ['itAsset.assign', 'itMobileLine.assign', 'itConsumable.assign'];
const KEEPER = [...READERS, ...HAND_OVER_GRANTS];

const BRANCHES: OrgUnitOptionDto[] = [
  { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null, catalogId: null },
  {
    id: 'b-oct',
    code: '02',
    name: { ar: 'أكتوبر', en: 'October' },
    parentId: null,
    catalogId: null,
  },
  { id: 'b-asy', code: '03', name: { ar: 'أسيوط', en: 'Assiut' }, parentId: null, catalogId: null },
];

/**
 * `retryOnMount: false` keeps a FAILED request failed on the next render — otherwise a render reads
 * it as being asked again, which is what a browser mounting the dialog anew would do.
 */
const client = ({
  branches = true,
  retryOnMount = true,
}: { branches?: boolean; retryOnMount?: boolean } = {}): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, retryOnMount },
    },
  });
  if (branches) qc.setQueryData(listKey('it', 'branchOptions'), BRANCHES);
  return qc;
};

const render = (qc: QueryClient, element: JSX.Element, permissions = KEEPER): string => {
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
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Every query the render registered under IT — what the browser would ask, and nothing else. */
const itQueries = (qc: QueryClient): readonly unknown[][] =>
  qc
    .getQueryCache()
    .findAll({ queryKey: ['it'] })
    .map((query) => [...query.queryKey]);

/** The box's search field — there when the box is open, absent behind «no access». */
const SEARCH_BOX = '<input type="search"';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped and whitespace collapsed: a wiring pinned, not its line breaks. */
const flat = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\s+/gu, ' ');

const SHERIF: ItRecipientDto = {
  employeeId: '64b000000000000000000002',
  code: '0100077',
  fullNameAr: 'شريف ممدوح فاروق',
  branchId: 'b-oct',
};
const WALEED: ItPersonDto = {
  employeeId: '64b000000000000000000001',
  code: '0100052',
  fullNameAr: 'وليد صفوت جلال',
  status: 'active',
  branchId: 'b-hq',
  departmentId: null,
  jobTitleId: null,
  hiredAt: '2020-01-01',
  exitedAt: null,
  userId: null,
  openCustodyCount: 1,
};

describe('a hand-over’s box asks every branch, under its own key', () => {
  it('asks the recipients, under their own key — never the scoped people search', async () => {
    searchRecipients.mockResolvedValue([SHERIF]);
    const qc = client();
    const html = render(
      qc,
      <EmployeePicker value="" valueLabel="" onChange={() => {}} ariaLabel="المستلم" handOver />,
    );
    // The box is open: the search is there, not the «no access» line.
    expect(html).toContain(SEARCH_BOX);
    expect(html).not.toContain(ar('it.custody.pickerNoAccessHandOver'));
    // One request, under the recipients' key — never the people search's.
    expect(itQueries(qc)).toEqual([
      [...listKey('it', 'branchOptions')],
      [...listKey('it', 'recipientSearch', { search: '' })],
    ]);
    // Nothing is asked before something is typed.
    expect(searchRecipients).not.toHaveBeenCalled();
    await qc
      .getQueryCache()
      .find({ queryKey: listKey('it', 'recipientSearch', { search: '' }), exact: true })
      ?.fetch();
    expect(searchRecipients.mock.calls).toEqual([['']]);
    expect(searchPeople).not.toHaveBeenCalled();
  });

  it('opens on ANY register’s hand-over grant alone — the act’s, not a read', () => {
    for (const grant of HAND_OVER_GRANTS) {
      const html = render(
        client(),
        <EmployeePicker value="" valueLabel="" onChange={() => {}} ariaLabel="المستلم" handOver />,
        [grant],
      );
      expect(html, grant).toContain(SEARCH_BOX);
      expect(html, grant).not.toContain(ar('it.custody.pickerNoAccessHandOver'));
    }
  });

  it('says «no access» without any of them — even to a reader of all three registers', () => {
    const html = render(
      client(),
      <EmployeePicker value="" valueLabel="" onChange={() => {}} ariaLabel="المستلم" handOver />,
      READERS,
    );
    expect(html).toContain(ar('it.custody.pickerNoAccessHandOver'));
    expect(html).not.toContain(SEARCH_BOX);
    expect(searchRecipients).not.toHaveBeenCalled();
  });

  it('a row names the branch beside the name and the code — «—» when it is not known', () => {
    const qc = client();
    const row = (employee: ItRecipientDto): string =>
      render(
        qc,
        <EmployeePickerRow employee={employee} handOver pressed={false} onPick={() => {}} />,
      );
    const oct = row(SHERIF);
    expect(oct).toContain('شريف ممدوح فاروق');
    expect(oct).toContain('0100077');
    expect(oct).toContain(`data-picker-branch="b-oct"`);
    expect(oct).toContain(ar('it.custody.pickerBranch', { name: 'أكتوبر' }));
    expect(ar('it.custody.pickerBranch', { name: 'أكتوبر' })).toBe('الفرع: أكتوبر');
    // A branch the list does not hold, or none at all.
    expect(row({ ...SHERIF, branchId: 'b-gone' })).toContain(
      ar('it.custody.pickerBranch', { name: '—' }),
    );
    expect(row({ ...SHERIF, branchId: null })).toContain(
      ar('it.custody.pickerBranch', { name: '—' }),
    );
    // A recipient works here today: no «left» mark on any row of the box.
    expect(oct).not.toContain(ar('it.custody.pickerExited'));
  });

  it('the branch is named from the session’s list, in the reader’s language', () => {
    expect(recipientBranchName('b-asy', BRANCHES, 'ar')).toBe('أسيوط');
    expect(recipientBranchName('b-asy', BRANCHES, 'en')).toBe('Assiut');
    expect(recipientBranchName('b-asy', undefined, 'ar')).toBe('—');
    expect(recipientBranchName(null, BRANCHES, 'ar')).toBe('—');
  });

  it('the pick carries the label it always did — the name and the code, not the branch', () => {
    expect(pickerLabel(SHERIF)).toBe('شريف ممدوح فاروق (0100077)');
    expect(pickerLabel(WALEED)).toBe('وليد صفوت جلال (0100052)');
  });

  it('lists the recipients’ answer itself, and the people search’s page', () => {
    expect(employeePickerRows(undefined)).toEqual([]);
    expect(employeePickerRows([SHERIF])).toEqual([SHERIF]);
    const page: Paginated<ItPersonDto> = {
      items: [WALEED],
      meta: { page: 1, pageSize: 8, totalItems: 1, totalPages: 1 },
    };
    expect(employeePickerRows(page)).toEqual([WALEED]);
  });

  it('the box wires them: each row is told it is a hand-over’s, and a pick carries its label', () => {
    const picker = flat('EmployeePicker.tsx');
    expect(picker).toContain(
      'const request = employeePickerRequest({ search, includeExited, handOver });',
    );
    expect(picker).toContain('queryKey: request.queryKey, queryFn: request.queryFn,');
    expect(picker).toContain('const rows = employeePickerRows(results.data);');
    expect(picker).toMatch(
      /<EmployeePickerRow employee=\{employee\} handOver=\{handOver\} pressed=\{employee\.employeeId === value\} onPick=\{\(\) => \{ onChange\(employee\.employeeId, pickerLabel\(employee\)\); setSearch\(''\); \}\} \/>/u,
    );
    expect(picker).toContain(
      "t(handOver ? 'it.custody.pickerNoAccessHandOver' : 'it.custody.pickerNoAccess')",
    );
  });
});

describe('every other box — exactly as built', () => {
  it('a filter asks today’s request under today’s key, and nothing else — not even the branches', async () => {
    searchPeople.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 8, totalItems: 0, totalPages: 0 },
    });
    const qc = client({ branches: false });
    const html = render(
      qc,
      <EmployeePicker
        value=""
        valueLabel=""
        onChange={() => {}}
        ariaLabel="الموظف"
        includeExited
      />,
      ['itAsset.view'],
    );
    expect(html).toContain(SEARCH_BOX);
    expect(itQueries(qc)).toEqual([
      [...listKey('it', 'employeeSearch', { search: '', includeExited: true })],
    ]);
    await qc
      .getQueryCache()
      .find({
        queryKey: listKey('it', 'employeeSearch', { search: '', includeExited: true }),
        exact: true,
      })
      ?.fetch();
    expect(searchPeople.mock.calls).toEqual([['', { includeExited: true }]]);
    expect(searchRecipients).not.toHaveBeenCalled();
  });

  it('a box that does not choose asks the employed, by the people search, as before', () => {
    const qc = client({ branches: false });
    render(qc, <EmployeePicker value="" valueLabel="" onChange={() => {}} />, [
      'itMobileLine.view',
    ]);
    expect(itQueries(qc)).toEqual([
      [...listKey('it', 'employeeSearch', { search: '', includeExited: false })],
    ]);
  });

  it('opens on the reads, as before — a hand-over grant alone does not open it', () => {
    const closed = render(client(), <EmployeePicker value="" valueLabel="" onChange={() => {}} />, [
      'itAsset.assign',
    ]);
    expect(closed).toContain(ar('it.custody.pickerNoAccess'));
    expect(closed).not.toContain(ar('it.custody.pickerNoAccessHandOver'));
  });

  it('renders today’s row: the name, a leaver marked, and the code — no branch', () => {
    const qc = client();
    const row = render(
      qc,
      <EmployeePickerRow employee={WALEED} pressed={false} onPick={() => {}} />,
    );
    expect(row).toBe(
      '<button type="button" aria-pressed="false" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200">' +
        '<span class="flex items-center gap-2"><span>وليد صفوت جلال</span></span>' +
        '<span class="font-mono text-xs text-slate-500" dir="ltr">0100052</span>' +
        '</button>',
    );
    const left = render(
      qc,
      <EmployeePickerRow
        employee={{ ...WALEED, status: 'exited' }}
        pressed={false}
        onPick={() => {}}
      />,
    );
    expect(left).toContain(ar('it.custody.pickerExited'));
    expect(left).not.toContain('data-picker-branch');
  });
});

describe('the asset transfer’s «الفرع الجديد» — only where the custody grant reaches', () => {
  const HELD = {
    id: 'a-2',
    assetCode: 'AST-00002',
    name: 'HP ProBook 450 G8',
    status: 'assigned',
    branchId: 'b-hq',
    location: null,
    holder: {
      employeeId: WALEED.employeeId,
      employeeCode: WALEED.code,
      employeeName: WALEED.fullNameAr,
      assignedAt: '2026-10-01T09:00:00.000Z',
    },
    hasActiveMaintenance: false,
  } as unknown as ItAssetDto;
  const CURRENT = { assignedToEmployeeId: WALEED.employeeId } as unknown as ItAssetAssignmentDto;

  const dialog = (
    <TransferAssetDialog
      open
      onClose={() => {}}
      asset={HELD}
      current={CURRENT}
      holderLabel={pickerLabel(WALEED)}
    />
  );
  /** The «الفرع الجديد» select, opening tag to closing tag. */
  const branchSelect = (html: string): string => {
    const at = html.indexOf(`>${ar('it.custody.newBranch')}`);
    expect(at, 'the field is rendered').toBeGreaterThan(-1);
    const from = html.indexOf('<select', at);
    return html.slice(from, html.indexOf('</select>', from));
  };
  const options = (select: string): string[] =>
    [...select.matchAll(/<option value="([^"]*)"/gu)].map((m) => m[1] ?? '');

  it('offers the asset’s own branch and the branches the server names — no other', () => {
    const qc = client();
    // `me` is a keeper of one branch; the server says the custody grant reaches two.
    qc.setQueryData<ItMoveTargetsDto>(listKey('it', 'moveTargets'), {
      branchIds: ['b-hq', 'b-oct'],
    });
    const select = branchSelect(render(qc, dialog));
    expect(options(select)).toEqual(['', 'b-oct']);
    expect(select).toContain(ar('it.custody.sameBranch'));
    expect(select).not.toContain('disabled=""');
  });

  it('waits for the server’s answer instead of offering what may be refused', () => {
    const qc = client();
    const select = branchSelect(render(qc, dialog));
    expect(options(select)).toEqual(['']);
    expect(select).toContain('disabled=""');
    expect(select).toContain(ar('common.loading'));
    // It asked where `itAsset.assign` reaches — «نقل إلى فرع»'s own question, under its key.
    expect(itQueries(qc)).toContainEqual([...listKey('it', 'moveTargets')]);
  });

  it('with nowhere else to go, keeps the current branch and offers nothing more', () => {
    const qc = client();
    qc.setQueryData<ItMoveTargetsDto>(listKey('it', 'moveTargets'), { branchIds: ['b-hq'] });
    const select = branchSelect(render(qc, dialog));
    expect(options(select)).toEqual(['']);
    expect(select).toContain(ar('it.custody.sameBranch'));
    expect(select).toContain('disabled=""');
  });

  it('a list that failed says so under the field — and offers no branch', async () => {
    moveTargets.mockRejectedValue(new Error('تعذر تحميل الفروع'));
    const qc = client({ retryOnMount: false });
    render(qc, dialog);
    await qc
      .getQueryCache()
      .find({ queryKey: listKey('it', 'moveTargets'), exact: true })
      ?.fetch()
      .catch(() => undefined);
    const html = render(qc, dialog);
    const select = branchSelect(html);
    expect(options(select)).toEqual(['']);
    expect(select).toContain('disabled=""');
    expect(select).toContain(ar('it.custody.sameBranch'));
    expect(html).toContain('تعذر تحميل الفروع');
  });

  it('the person box in the same dialog is a hand-over’s', () => {
    const qc = client();
    qc.setQueryData<ItMoveTargetsDto>(listKey('it', 'moveTargets'), { branchIds: ['b-hq'] });
    render(qc, dialog);
    expect(itQueries(qc)).toContainEqual([...listKey('it', 'recipientSearch', { search: '' })]);
    expect(itQueries(qc)).not.toContainEqual([
      ...listKey('it', 'employeeSearch', { search: '', includeExited: false }),
    ]);
  });

  // What a static render cannot show: the list is asked while the dialog is OPEN (the route
  // answers 403 to whoever lacks `itAsset.assign`, and the dialog stays mounted on the asset's
  // page), and a branch chosen before the list changed is not sent.
  it('asks while open, and sends only a branch still offered', () => {
    const custody = flat('CustodyDialogs.tsx');
    const transfer =
      /export const TransferAssetDialog = [\s\S]*?export const DisposeAssetDialog/u.exec(
        custody,
      )?.[0] ?? '';
    expect(transfer).toContain('const reach = useItMoveTargets(open);');
    expect(transfer).toContain(
      'branchMoveTargets(branches.data, reach.data?.branchIds, asset.branchId)',
    );
    expect(transfer).toContain("const movesBranch = chosen !== '' && chosen !== asset.branchId;");
    expect(transfer).toContain('...(movesBranch ? { toBranchId: chosen } : {}),');
  });
});

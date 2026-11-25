// The module's reference picker (P2 re-detail §9.4; design §13.6 D), proven against what it renders:
// no access said in a sentence, and nothing asked; nothing asked until something is typed; a
// spinner while the search answers, a sentence when nothing matches, and the rows as buttons the
// caller fills, the picked one pressed; the pick on a chip, red when its field carries a refusal;
// every sentence the caller's key, in the reader's language. Then the keeper box drawn on it, as it
// was drawn before (P2.W0 moves it with no change of behaviour).
//
// The suite runs in node with no DOM, so nothing can be typed. What was typed is seeded instead:
// React's `useState` is replaced by one that starts an empty string as `state.typed` (the picker's
// one state is its search; `useDocumentTitle.spec.ts` replaces `useEffect` the same way). A click
// is read as source.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactModule from 'react';
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type AdministrationPersonDto, type Locale, type Paginated } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { peopleSearchKey } from '../api/administration-keys';
import { ar, meWith, pageOf } from '../screen-fixtures';
import { EmployeePicker } from './EmployeePicker';
import { ReferencePicker } from './ReferencePicker';

const state = vi.hoisted(() => ({ typed: '' }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(initial === '' ? state.typed : initial),
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = resolve(HERE, '..');

/** Source with comments stripped: a rule about the code must not be satisfied by prose. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const PICKER = code(join(HERE, 'ReferencePicker.tsx'));
const KEEPER = code(join(HERE, 'EmployeePicker.tsx'));

/** The markup for a reader holding `keys`, in `locale`, with the people searches in `people`. */
const markup = (
  node: ReactElement,
  {
    keys = ['administrationWarehouse.create'],
    locale = 'ar',
    people = [],
  }: {
    keys?: readonly string[];
    locale?: Locale;
    people?: readonly (readonly [string, Paginated<AdministrationPersonDto>])[];
  } = {},
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  for (const [search, page] of people) qc.setQueryData(peopleSearchKey(search), page);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: meWith(keys), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

// ── The picker, over a record of its own ────────────────────────────────────

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: 'r-1', name: 'الأول' },
  { id: 'r-2', name: 'الثاني' },
];
/** The keeper box's words: the picker has none of its own, so any caller's keys will do. */
const TEXTS = {
  placeholder: 'administration.people.placeholder',
  noResults: 'administration.people.noResults',
  noAccess: 'administration.people.noAccess',
  clearPick: 'administration.people.clearPick',
};

/** What the picker asked its search, call by call. */
const asked: [string, boolean][] = [];

const picker = ({
  allowed = true,
  value = '',
  error = false,
  answer = { isPending: true },
}: {
  allowed?: boolean;
  value?: string;
  error?: boolean;
  answer?: { isPending: boolean; data?: { items: Row[] } };
} = {}): ReactElement => (
  <ReferencePicker
    value={value}
    valueLabel={value === '' ? '' : 'الأول (R-1)'}
    onChange={() => undefined}
    error={error}
    allowed={allowed}
    useSearch={(search: string, enabled: boolean) => {
      asked.push([search, enabled]);
      return answer;
    }}
    rowId={(row) => row.id}
    rowLabel={(row) => `${row.name} (${row.id.toUpperCase()})`}
    renderRow={(row) => <span data-row={row.id}>{row.name}</span>}
    texts={TEXTS}
  />
);

const RESULTS_BOX = 'max-h-56 overflow-y-auto rounded-lg border';
const buttons = (html: string): string[] =>
  [...html.matchAll(/<button type="button" aria-pressed="[^"]*"[^>]*>[\s\S]*?<\/button>/gu)].map(
    (m) => m[0],
  );

describe('the reference picker', () => {
  beforeEach(() => {
    state.typed = '';
    asked.length = 0;
  });

  it('says no access in a sentence in place of the box, and asks nothing', () => {
    state.typed = 'الأ';
    expect(markup(picker({ allowed: false }))).toBe(
      `<p class="text-sm text-slate-500 dark:text-slate-400">${ar(TEXTS.noAccess)}</p>`,
    );
    expect(asked).toEqual([['الأ', false]]);
  });

  it('asks nothing until something is typed, and shows no results box', () => {
    const html = markup(picker());
    expect(html).toContain(`placeholder="${ar(TEXTS.placeholder)}"`);
    expect(html).not.toContain(RESULTS_BOX);
    expect(asked).toEqual([['', false]]);
    // Spaces alone are nothing typed.
    state.typed = '   ';
    expect(markup(picker())).not.toContain(RESULTS_BOX);
    expect(asked.at(-1)).toEqual(['   ', false]);
  });

  it('asks for what was typed, and turns while the answer comes', () => {
    state.typed = 'الأ';
    const html = markup(picker());
    expect(asked).toEqual([['الأ', true]]);
    expect(html).toContain(RESULTS_BOX);
    expect(html).toContain('<div class="grid place-items-center p-4"><svg class="animate-spin');
    expect(html).not.toContain('<ul');
  });

  it('says so when nothing matches', () => {
    state.typed = 'لا أحد';
    const html = markup(picker({ answer: { isPending: false, data: { items: [] } } }));
    expect(html).toContain(
      `<p class="p-4 text-sm text-slate-500 dark:text-slate-400">${ar(TEXTS.noResults)}</p>`,
    );
    expect(html).not.toContain('<ul');
  });

  it('lists each row as a button the caller fills, the picked one pressed', () => {
    state.typed = 'ال';
    const html = markup(
      picker({ value: 'r-1', answer: { isPending: false, data: { items: ROWS } } }),
    );
    const rows = buttons(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('aria-pressed="true"');
    expect(rows[0]).toContain('bg-brand-50 font-medium text-brand-700');
    expect(rows[0]).toContain('<span data-row="r-1">الأول</span>');
    expect(rows[1]).toContain('aria-pressed="false"');
    expect(rows[1]).toContain('text-slate-700 dark:text-slate-200');
    expect(rows[1]).toContain('<span data-row="r-2">الثاني</span>');
    for (const row of rows) expect(row).toContain('text-start');
  });

  it('shows the pick on a chip, its clear button worded by the caller; red while its field is refused', () => {
    expect(markup(picker())).not.toContain(ar(TEXTS.clearPick));
    const chip = markup(picker({ value: 'r-1' }));
    expect(chip).toContain('<span class="text-brand-800 dark:text-brand-200">الأول (R-1)</span>');
    expect(chip).toContain(`aria-label="${ar(TEXTS.clearPick)}" title="${ar(TEXTS.clearPick)}"`);
    expect(chip).toContain('border-brand-200 bg-brand-50');
    expect(chip).not.toContain('border-red-300');
    const refused = markup(picker({ value: 'r-1', error: true }));
    expect(refused).toContain('border-red-300 bg-red-50');
    expect(refused).toContain('<span class="text-red-800 dark:text-red-200">الأول (R-1)</span>');
  });

  it('says every sentence in the reader’s language', () => {
    const en = (key: string): string => translate('en', key);
    expect(markup(picker(), { locale: 'en' })).toContain(`placeholder="${en(TEXTS.placeholder)}"`);
    expect(markup(picker({ allowed: false }), { locale: 'en' })).toContain(en(TEXTS.noAccess));
    state.typed = 'x';
    expect(
      markup(picker({ answer: { isPending: false, data: { items: [] } } }), { locale: 'en' }),
    ).toContain(en(TEXTS.noResults));
  });

  it('hands the caller the row’s id and label on a pick, then empties the search; the chip’s button hands back none', () => {
    expect(PICKER).toMatch(/onChange\(id, rowLabel\(row\)\);\s*setSearch\(''\);/u);
    expect(PICKER).toContain("onClick={() => onChange('', '')}");
  });

  it('names no word of its own: each sentence is the caller’s key', () => {
    expect(PICKER).not.toMatch(/'administration\./u);
    expect(PICKER).not.toContain("t('");
    for (const text of ['placeholder', 'noResults', 'noAccess', 'clearPick']) {
      expect(PICKER).toContain(`t(texts.${text})`);
    }
  });
});

// ── The keeper box, drawn on it ─────────────────────────────────────────────

const person = (over: Partial<AdministrationPersonDto>): AdministrationPersonDto => ({
  employeeId: 'e-1',
  code: '0100052',
  fullNameAr: 'سامح عادل منير',
  status: 'active',
  branchId: 'b-cai',
  departmentId: null,
  jobTitleId: null,
  ...over,
});
const keeper = (value = '', error = false): ReactElement => (
  <EmployeePicker
    value={value}
    valueLabel={value === '' ? '' : 'سامح عادل منير (0100052)'}
    onChange={() => undefined}
    error={error}
  />
);

describe('the keeper box on it — drawn as before', () => {
  beforeEach(() => {
    state.typed = '';
  });

  it('draws a person as before: the name, the mark of one who has left, the code left to right', () => {
    state.typed = 'سا';
    const html = markup(keeper('e-1'), {
      people: [
        [
          'سا',
          pageOf([
            person({}),
            person({
              employeeId: 'e-2',
              code: '0100077',
              fullNameAr: 'هالة فوزي رشدي',
              status: 'exited',
            }),
          ]),
        ],
      ],
    });
    const [kept, left] = buttons(html);
    expect(kept).toContain('aria-pressed="true"');
    expect(kept).toContain(
      '<span class="flex items-center gap-2"><span>سامح عادل منير</span></span>' +
        '<span class="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">0100052</span>',
    );
    expect(left).toContain('aria-pressed="false"');
    expect(left).toContain('<span>هالة فوزي رشدي</span><span class="inline-flex');
    expect(left).toContain(`${ar('administration.people.exited')}</span></span>`);
    expect(html.split(ar('administration.people.exited'))).toHaveLength(2);
  });

  it('turns the keeper chip red while the form refuses the keeper', () => {
    const refused = markup(keeper('e-1', true));
    expect(refused).toContain('border-red-300 bg-red-50');
    expect(refused).toContain(
      '<span class="text-red-800 dark:text-red-200">سامح عادل منير (0100052)</span>',
    );
    expect(markup(keeper('e-1'))).not.toContain('border-red-300');
  });

  it('hands a pick to the caller labelled as the chip names it', () => {
    // A click is read as source (see the header): the picker calls `onChange(id, rowLabel(row))`,
    // so the keeper box must hand it the form's own `onChange` and `pickerLabel`, or a fresh pick
    // would do nothing, or reach the chip without its code.
    expect(KEEPER).toContain('onChange={onChange}');
    expect(KEEPER).toContain('rowLabel={pickerLabel}');
  });

  it('says the keeper box’s own words', () => {
    expect(markup(keeper())).toContain(`placeholder="${ar('administration.people.placeholder')}"`);
    expect(markup(keeper('e-1'))).toContain(`title="${ar('administration.people.clearPick')}"`);
    state.typed = 'لا أحد';
    expect(markup(keeper(), { people: [['لا أحد', pageOf([])]] })).toContain(
      ar('administration.people.noResults'),
    );
    expect(markup(keeper(), { keys: ['administrationWarehouse.view'] })).toBe(
      `<p class="text-sm text-slate-500 dark:text-slate-400">${ar('administration.people.noAccess')}</p>`,
    );
  });

  it('keeps no box of its own: the module’s one results box is the reference picker’s', () => {
    for (const piece of ['useState', '<SearchInput', '<Spinner', 'CloseIcon', 'aria-pressed']) {
      expect(KEEPER, piece).not.toContain(piece);
    }
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return /\.tsx$/u.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
      });
    const boxes = sources(MODULE)
      .filter((file) => {
        const source = code(file);
        return source.includes('<SearchInput') && source.includes('aria-pressed');
      })
      .map((file) => relative(MODULE, file));
    expect(boxes).toEqual(['components/ReferencePicker.tsx']);
  });
});

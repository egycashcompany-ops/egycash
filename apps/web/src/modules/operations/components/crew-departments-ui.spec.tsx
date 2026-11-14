// The surfaces that turn an invisible setting into a visible one, rendered for real.
//
// `crew-departments.spec.ts` proves the rules; `operations-i18n.spec.ts` proves the catalogs hold
// the keys. Neither proves the components ASK for the keys that exist, that the card is OPEN on its
// own screen, that its controls are wired to what they say, that the picker is withheld from a
// caller who cannot write the setting, or that the roster's notices point at the screen only for a
// reader who may open it — and every one of those failures is silent.
//
// Round 14, the owner: «انا عاوز افصل ان احدد اداره معايا ولا لا عن تجهيز الطاقم» … «شاشة لوحدها في
// القائمة». The card left «كشف الأطقم» for «إدارات العمليات», where it IS the page — so the fold
// round 15 gave it there («عاوز أخليها تبقى الديفولت بتاعها إن هي مخفية») is gone with the move. The
// suite is node-only (no DOM to click in), so the panel is rendered inside a capturing component and
// its handlers are called the way a click would call them.
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  OperationsSettingKeys,
  type Locale,
  type MeDto,
  type OrgUnitOptionDto,
  type ResolvedSettingDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { CrewDepartmentsCard, CrewDepartmentsPanel } from './CrewDepartmentsCard';
import { ChooseCrewDepartments, CrewRosterNotice } from './CrewRosterNotice';
import { crewDepartmentChoices, type CrewDepartmentChoice } from '../lib/crew-departments';

const MOH = '507f1f77bcf86cd7994390a1';
const TAN = '507f1f77bcf86cd7994390a2';
const dept = (
  id: string,
  code: string,
  ar: string,
  en: string,
  parentId: string,
  catalogId: string | null = null,
): OrgUnitOptionDto => ({ id, code, name: { ar, en }, parentId, catalogId });

// «نقل الأموال» in two branches — ONE choice — and «الموارد البشرية» in one.
const CASH = dept('507f1f77bcf86cd799439011', 'DEP-0004', 'نقل الأموال', 'Cash transfer', MOH, '6f0000000000000000000001');
const CASH_TANTA = dept('507f1f77bcf86cd799439013', 'DEP-0005', 'نقل الأموال', 'Cash transfer', TAN, '6f0000000000000000000001');
const HR = dept('507f1f77bcf86cd799439012', 'DEP-0002', 'الموارد البشرية', 'Human resources', MOH);
const BRANCHES: OrgUnitOptionDto[] = [
  { id: MOH, code: '01', name: { ar: 'المهندسين', en: 'Mohandessin' }, parentId: null, catalogId: null },
  { id: TAN, code: '02', name: { ar: 'طنطا', en: 'Tanta' }, parentId: null, catalogId: null },
];

const me = (permissions: string[]): MeDto => ({
  id: 'u-1',
  email: 'user@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  external: null,
  flags: {},
  totpEnabled: true,
});

const setting = (value: unknown): ResolvedSettingDto => ({
  key: OperationsSettingKeys.CrewDepartmentIds,
  value,
  resolvedFrom: value === undefined ? 'default' : 'organization',
});

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    permissions = ['setting.edit'],
    options = [CASH, CASH_TANTA, HR],
    configured = [] as string[],
    failed = null,
  }: {
    locale?: Locale;
    permissions?: string[];
    options?: OrgUnitOptionDto[] | null;
    configured?: string[];
    /** A read that answered with an error instead of data. */
    failed?: 'settings' | 'options' | null;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    // `retryOnMount: false` so a query left in error is READ as an error, not re-tried as pending.
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
  const fail = (queryKey: unknown[]): void =>
    qc
      .getQueryCache()
      .build(qc, { queryKey })
      .setState({ status: 'error', error: new Error('offline'), fetchStatus: 'idle' });
  if (failed === 'settings') fail(['platform', 'settings', 'me']);
  else qc.setQueryData(['platform', 'settings', 'me'], [setting(configured)]);
  if (failed === 'options') fail(['organization', 'departments', 'reference-options']);
  else if (options !== null) {
    qc.setQueryData(['organization', 'departments', 'reference-options'], options);
  }
  if (options !== null) {
    qc.setQueryData(['organization', 'departments', 'reference-options', 'withInactive'], options);
    qc.setQueryData(['organization', 'branches', 'options', 'withInactive'], BRANCHES);
  }
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/requirements']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const card = (over: Parameters<typeof render>[1] = {}): string =>
  render(<CrewDepartmentsCard />, over);

const en = (key: string, params?: Record<string, string | number>): string =>
  translate('en', key, params);

/** Every element in a rendered tree, components included — what a click would reach. */
const elements = (node: ReactNode): ReactElement[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
};

/**
 * Call a component's function inside the providers (its hooks become the capturing component's)
 * and keep the element tree it returned, so a test can reach the handlers a click would.
 */
const capture = (make: () => JSX.Element, over: Parameters<typeof render>[1] = {}) => {
  let tree: JSX.Element | null = null;
  const Capture = (): JSX.Element => {
    tree = make();
    return tree;
  };
  const html = render(<Capture />, over);
  return { html, tree: elements(tree) };
};

const CHOICES: CrewDepartmentChoice[] = crewDepartmentChoices({
  active: [CASH, CASH_TANTA, HR],
  all: [CASH, CASH_TANTA, HR],
  branchNames: new Map(BRANCHES.map((b) => [b.id, b.name])),
  storedIds: [CASH.id],
  locale: 'en',
});
const CASH_KEY = 'catalog:6f0000000000000000000001';

const panelProps = (over: Partial<Parameters<typeof CrewDepartmentsPanel>[0]> = {}) => ({
  label: 'Operations departments',
  state: 'ready' as const,
  choices: CHOICES,
  draft: [CASH_KEY],
  savedKeys: [CASH_KEY],
  search: '',
  onSearch: vi.fn(),
  onToggleChoice: vi.fn(),
  onDiscard: vi.fn(),
  onSave: vi.fn(),
  saving: false,
  ...over,
});

describe('CrewDepartmentsCard — open on its own screen, no fold', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`shows every department at once in ${locale}: the tiles, ticked as saved, no arrow`, () => {
      const html = card({ locale, configured: [CASH.id] });
      // The panel is there from the first paint — nothing to open.
      expect(html).toContain('data-crew-departments="true"');
      expect(html).not.toContain('aria-expanded');
      expect(html).not.toContain('rotate-180');
      const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      expect(boxes).toHaveLength(2); // «نقل الأموال» once for its two branches, «الموارد البشرية»
      expect(boxes.filter((box) => box.includes('checked'))).toHaveLength(1);
      expect(html).toContain(locale === 'ar' ? CASH.name.ar : CASH.name.en);
      expect(html).toContain(locale === 'ar' ? HR.name.ar : HR.name.en);
      // Named by the page's title, for a screen reader landing on the region.
      expect(html).toContain(`aria-label="${translate(locale, 'operations.crew.departments.title')}"`);
    });
  }

  it('names a department chosen in one branch ONCE, never by unit code', () => {
    const html = card({ configured: [CASH.id, CASH_TANTA.id] });
    expect(html.match(/data-crew-department="catalog:/g)).toHaveLength(1);
    expect(html).not.toContain('DEP-0004');
  });

  it('warns when nothing is chosen yet', () => {
    expect(card()).toContain(en('operations.crew.departments.emptyWarning'));
    expect(card({ configured: [CASH.id] })).not.toContain(
      en('operations.crew.departments.emptyWarning'),
    );
  });

  // A configured id that no department answers to is still configured. Dropping it from the list
  // would hide a live part of the configuration — the exact failure this card ends.
  it('shows a configured id nothing answers to, so it can be unticked', () => {
    const html = card({ configured: [CASH.id, '507f1f77bcf86cd7994390ff'] });
    expect(html).toContain(en('operations.crew.departments.unknownDepartment'));
    expect(html).toContain(en('operations.crew.departments.stale'));
  });

  // `setting.edit` is what the server demands of the write. Offering the control to anyone else
  // would be an invitation to a 403 (the route is guarded by it too; this is the second wall).
  it('renders nothing at all without setting.edit', () => {
    expect(card({ permissions: ['operationsCrew.plan'] })).toBe('');
  });

  it('says it is still loading rather than claiming there are no departments', () => {
    const html = card({ options: null });
    expect(html).toContain(en('common.loading'));
    expect(html).not.toContain(en('operations.crew.departments.none'));
    expect(html).not.toContain('type="checkbox"');
  });

  // An unread setting is not "nothing chosen", and an unread department list is not "every saved
  // department has gone": the card says it could not load, and offers nothing to save.
  it('says it could not load when the setting cannot be read, and offers nothing to tick', () => {
    const html = card({ failed: 'settings' });
    expect(html).toContain(en('operations.crew.departments.optionsFailed'));
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('data-crew-departments-save');
  });

  it('says it could not load when the departments cannot be read, not that they are gone', () => {
    const html = card({ failed: 'options', configured: [CASH.id] });
    expect(html).toContain(en('operations.crew.departments.optionsFailed'));
    expect(html).not.toContain(en('operations.crew.departments.unknownDepartment'));
  });
});

describe('CrewDepartmentsPanel — the open card', () => {
  const panel = (over: Partial<Parameters<typeof CrewDepartmentsPanel>[0]> = {}) => {
    const props = panelProps(over);
    return { props, ...capture(() => CrewDepartmentsPanel(props)) };
  };

  it('offers each company department once, with its branches by name and their count', () => {
    const { html } = panel();
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('Mohandessin · Tanta');
    expect(html).toContain(en('operations.crew.departments.branches', { count: 2 }));
    expect(html).not.toContain('DEP-0005');
  });

  it('ticks the chosen department and only that one', () => {
    const boxes = panel().html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes.filter((box) => box.includes('checked'))).toHaveLength(1);
  });

  it('ticking a tile toggles that department', () => {
    const { tree, props } = panel();
    const tile = tree.find(
      (el) => (el.props as { choice?: CrewDepartmentChoice }).choice?.key === CASH_KEY,
    );
    (tile?.props as { onToggle: () => void }).onToggle();
    expect(props.onToggleChoice).toHaveBeenCalledWith(CASH_KEY);
  });

  it('says «تغييرات غير محفوظة» by «حفظ» once a tick differs from what is saved, and not before', () => {
    expect(panel().html).not.toContain('data-crew-departments-unsaved');
    const html = panel({ draft: [] }).html;
    expect(html).toContain('data-crew-departments-unsaved="true"');
    expect(html).toContain(en('operations.crew.departments.unsaved'));
  });

  it('«حفظ» and «تراجع» wait for a change, then do what they say', () => {
    const buttonOf = (tree: ReactElement[], attr: string) =>
      tree.find((el) => (el.props as Record<string, unknown>)[attr] === 'true')?.props as {
        disabled: boolean;
        onClick: () => void;
      };

    const unchanged = panel().tree;
    expect(buttonOf(unchanged, 'data-crew-departments-save').disabled).toBe(true);
    expect(buttonOf(unchanged, 'data-crew-departments-discard').disabled).toBe(true);

    const { tree, props } = panel({ draft: [] });
    const save = buttonOf(tree, 'data-crew-departments-save');
    const discard = buttonOf(tree, 'data-crew-departments-discard');
    expect(save.disabled).toBe(false);
    expect(discard.disabled).toBe(false);
    save.onClick();
    discard.onClick();
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
  });

  // The whole reason this card exists: an unset setting is a working screen showing a stale list.
  it('warns when nothing is chosen, and not otherwise', () => {
    expect(panel({ draft: [] }).html).toContain(en('operations.crew.departments.emptyWarning'));
    expect(panel().html).not.toContain(en('operations.crew.departments.emptyWarning'));
  });

  it('narrows to the search, by department or by branch, and says when nothing matches', () => {
    expect(panel({ search: 'human' }).html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(panel({ search: 'tanta' }).html).toContain(CASH.name.en);
    expect(panel({ search: 'tanta' }).html).not.toContain(HR.name.en);
    expect(panel({ search: 'zzz' }).html).toContain(en('operations.crew.departments.noMatch'));
  });

  it('marks a saved id nothing answers to, so it can be unticked', () => {
    const stale = crewDepartmentChoices({
      active: [CASH],
      all: [CASH],
      branchNames: new Map(),
      storedIds: ['507f1f77bcf86cd7994390ff'],
      locale: 'en',
    });
    const html = panel({ choices: stale, draft: ['unknown:507f1f77bcf86cd7994390ff'] }).html;
    expect(html).toContain(en('operations.crew.departments.stale'));
    expect(html).toContain(en('operations.crew.departments.unknownDepartment'));
  });

  it('says so when there is genuinely nothing to choose, rather than showing an empty grid', () => {
    expect(panel({ choices: [] }).html).toContain(en('operations.crew.departments.none'));
  });

  it('says it is still loading rather than claiming there are no departments', () => {
    const html = panel({ state: 'loading' }).html;
    expect(html).toContain(en('common.loading'));
    expect(html).not.toContain(en('operations.crew.departments.none'));
  });

  it('says the list could not be read rather than offering an empty one', () => {
    expect(panel({ state: 'failed' }).html).toContain(en('operations.crew.departments.optionsFailed'));
  });
});

describe('CrewRosterNotice — the pool explains its own short list', () => {
  it('is silent while the roster is still loading', () => {
    expect(render(<CrewRosterNotice rosterIsDerived={undefined} />)).toBe('');
  });

  it('is silent when the roster comes from the org chart', () => {
    expect(render(<CrewRosterNotice rosterIsDerived />)).toBe('');
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`explains the fallback in ${locale} and links to «إدارات العمليات», which fixes it`, () => {
      const html = render(<CrewRosterNotice rosterIsDerived={false} />, { locale });
      const body = translate(locale, 'operations.crew.rosterFallback');
      expect(body).not.toBe('operations.crew.rosterFallback');
      expect(html).toContain(body);
      expect(html).toContain(translate(locale, 'operations.crew.rosterFallbackLink'));
      // Round 14 — the screen of its own, no longer the roster the card used to sit on.
      expect(html).toContain('href="/operations/crew-departments"');
      expect(html).not.toContain('/operations/requirements');
    });
  }
});

describe('ChooseCrewDepartments — a link only for a reader who may open the screen', () => {
  it('links to «إدارات العمليات» for a holder of setting.edit', () => {
    const html = render(<ChooseCrewDepartments />, { permissions: ['setting.edit'] });
    expect(html).toContain('href="/operations/crew-departments"');
    expect(html).toContain('data-crew-departments-link="true"');
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`says who chooses it instead, in ${locale}, to a planner who cannot open it`, () => {
      const html = render(<ChooseCrewDepartments />, {
        locale,
        permissions: ['operationsCrew.view', 'operationsCrew.plan'],
      });
      expect(html).not.toContain('<a');
      const words = translate(locale, 'operations.crew.departmentsElsewhere');
      expect(words).not.toBe('operations.crew.departmentsElsewhere');
      expect(html).toContain(words.replace(/"/g, '&quot;'));
    });
  }
});

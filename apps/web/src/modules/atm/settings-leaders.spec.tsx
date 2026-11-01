// The leader list on screen (2026-11-01): «تظهر أسماء الموظفين اللى فى ATM في Drop Down القائد في
// الصيانة والتغذية .. وخصوصاً عند تقفيل ماكينات الصيانة». Rendered from a pre-filled query cache, as
// the settings page is pinned (settings-page.spec.tsx). It pins:
//   · the /atm/settings card: every active department to tick, what the list is drawn from now —
//     the ATM department found by name while none is ticked, or the ticked ones — the people
//     counted, a department retired since still shown, and «استخدام إدارة الصراف الآلي باسمها»
//     offered once something is ticked; a save stales the pickers' names;
//   · the maintenance close picks from the ATM employees in a searchable box, each person with
//     their HR code, and says where the list is set while it is empty.
//
// Every id and name below is synthetic.
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AtmLeaderDepartmentDto,
  type AtmLeaderDepartmentsDto,
  type AtmLeaderOptionDto,
  type AtmMaintenanceDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import {
  LeaderDepartmentsCard,
  sameIds,
  selectedDepartmentIds,
  toggleId,
} from './components/settings/LeaderDepartmentsCard';
import {
  CloseMaintenanceDialog,
  leaderOptionLabel,
  sharedLeader,
} from './components/MaintenanceDialogs';
import { exactOption } from '../../shared/ui/Combobox';
import { leaderNames } from './components/ReplenishmentDialogs';
import { atmLeaderDepartmentsKey, useSaveAtmLeaderDepartments } from './api/settings-queries';
import { atmLeaderOptionsKey } from './api/atm-queries';
import type * as SettingsApiModule from './api/settings-api';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const ATM_DEPT = '650000000000000000000301';
const CASH_DEPT = '650000000000000000000302';
const GONE_DEPT = '650000000000000000000303';

const atm: AtmLeaderDepartmentDto = {
  id: ATM_DEPT,
  name: { ar: 'الصراف الآلي', en: 'ATM' },
  branchName: { ar: 'المهندسين', en: 'Mohandessin' },
  selected: true,
  matchesName: true,
  employees: 2,
};
const cash: AtmLeaderDepartmentDto = {
  id: CASH_DEPT,
  name: { ar: 'نقل الأموال', en: 'Cash Transfer' },
  branchName: { ar: 'المهندسين', en: 'Mohandessin' },
  selected: false,
  matchesName: false,
  employees: 5,
};

const BY_NAME: AtmLeaderDepartmentsDto = {
  configuredIds: [],
  source: 'byName',
  departments: [atm, cash],
  employees: 2,
};

const SAVED: AtmLeaderDepartmentsDto = {
  configuredIds: [CASH_DEPT, GONE_DEPT],
  source: 'configured',
  departments: [
    { ...cash, selected: true },
    {
      id: GONE_DEPT,
      name: null,
      branchName: null,
      selected: true,
      matchesName: false,
      employees: 0,
    },
    { ...atm, selected: false },
  ],
  employees: 5,
};

const PEOPLE: AtmLeaderOptionDto[] = [
  { employeeId: 'e1', name: 'أحمد سعيد محمد', code: '0101' },
  { employeeId: 'e2', name: 'أحمد سعيد محمد', code: '0102' },
  { employeeId: 'e3', name: 'محمود علي حسن', code: '0103' },
];

// The close dialog renders through a portal; the static renderer has no DOM to portal into, so
// the portal hands its children back in place (the IT screens' specs do the same).
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

vi.mock('./api/settings-api', async () => {
  const actual = await vi.importActual<typeof SettingsApiModule>('./api/settings-api');
  return {
    ...actual,
    saveLeaderDepartments: (): Promise<AtmLeaderDepartmentsDto> => Promise.resolve(SAVED),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'atmSettings.manage': 'organization' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (node: ReactNode, qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/settings']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const cardWith = (dto: AtmLeaderDepartmentsDto): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmLeaderDepartmentsKey(), dto);
  return render(<LeaderDepartmentsCard />, qc);
};

/** The checkbox inside the row of one department. */
const rowOf = (markup: string, id: string): string =>
  new RegExp(`<div[^>]*data-leader-department="${id}"[^>]*>([\\s\\S]*?)</div>`).exec(markup)?.[0] ??
  '';

describe('the card’s pure rules', () => {
  it('reads what is in the list, toggles one id, and compares sets whatever their order', () => {
    expect(selectedDepartmentIds(SAVED.departments)).toEqual([CASH_DEPT, GONE_DEPT]);
    expect(toggleId([ATM_DEPT], CASH_DEPT)).toEqual([ATM_DEPT, CASH_DEPT]);
    expect(toggleId([ATM_DEPT, CASH_DEPT], ATM_DEPT)).toEqual([CASH_DEPT]);
    expect(sameIds([ATM_DEPT, CASH_DEPT], [CASH_DEPT, ATM_DEPT])).toBe(true);
    expect(sameIds([ATM_DEPT], [ATM_DEPT, CASH_DEPT])).toBe(false);
  });
});

describe('«موظفو الصراف الآلي — قائمة القائد» on /atm/settings', () => {
  it('with nothing ticked, ticks the ATM department found by name and says so', () => {
    const html = cardWith(BY_NAME);
    expect(html).toContain(t('atm.settings.leaders.title'));
    expect(html).toContain(t('atm.settings.leaders.byName'));
    expect(rowOf(html, ATM_DEPT)).toContain('checked=""');
    expect(rowOf(html, ATM_DEPT)).toContain('الصراف الآلي — المهندسين');
    expect(rowOf(html, ATM_DEPT)).toContain(t('atm.settings.leaders.matchesName'));
    expect(rowOf(html, ATM_DEPT)).toContain(t('atm.settings.leaders.employees', { count: 2 }));
    expect(rowOf(html, CASH_DEPT)).not.toContain('checked=""');
    expect(html).toContain(t('atm.settings.leaders.count', { count: 2 }));
    // Nothing to return to while the name rule already applies; nothing changed to save.
    expect(html).not.toContain(t('atm.settings.leaders.reset'));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*حفظ/u);
  });

  it('with departments ticked, ticks them, shows a retired one, and offers the name rule back', () => {
    const html = cardWith(SAVED);
    expect(html).not.toContain(t('atm.settings.leaders.byName'));
    expect(rowOf(html, CASH_DEPT)).toContain('checked=""');
    expect(rowOf(html, ATM_DEPT)).not.toContain('checked=""');
    expect(rowOf(html, GONE_DEPT)).toContain(t('atm.settings.leaders.unknown'));
    expect(rowOf(html, GONE_DEPT)).toContain(t('atm.settings.leaders.stale'));
    expect(html).toContain(t('atm.settings.leaders.reset'));
  });

  it('warns, while nothing is ticked, that saving returns to the name rule — not to «nobody»', () => {
    const html = cardWith({ configuredIds: [], source: 'none', departments: [cash], employees: 0 });
    expect(html).toContain(t('atm.settings.leaders.emptyWarning'));
    expect(cardWith(BY_NAME)).not.toContain(t('atm.settings.leaders.emptyWarning'));
  });

  it('says the list is empty when nothing is ticked and nothing is named for ATM', () => {
    const html = cardWith({
      configuredIds: [],
      source: 'none',
      departments: [cash],
      employees: 0,
    });
    expect(html).toContain(t('atm.settings.leaders.noneFound'));
    expect(html).toContain(t('atm.settings.leaders.count', { count: 0 }));
  });

  it('a save stales the pickers’ names', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    let save: ReturnType<typeof useSaveAtmLeaderDepartments> | undefined;
    const Probe = (): null => {
      save = useSaveAtmLeaderDepartments();
      return null;
    };
    renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
    await save?.mutateAsync({ departmentIds: [CASH_DEPT] });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['atm', 'leaders'],
    ]);
    expect(qc.getQueryData(atmLeaderDepartmentsKey())).toEqual(SAVED);
    // The pickers' names live under the same feature, so the save reaches them.
    expect(atmLeaderOptionsKey().slice(0, 2)).toEqual(['atm', 'leaders']);
  });
});

describe('the leader pickers', () => {
  const ROW = {
    id: 'm1',
    machineCode: '27720226',
    machineName: 'SYN',
  } as unknown as AtmMaintenanceDto;

  const closeWith = (people: AtmLeaderOptionDto[]): string => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(atmLeaderOptionsKey(), people);
    return render(<CloseMaintenanceDialog open rows={[ROW]} onClose={() => undefined} />, qc);
  };

  it('the close picks an ATM employee in a searchable box', () => {
    const html = closeWith(PEOPLE);
    expect(html).toContain('role="combobox"');
    expect(html).toContain(`placeholder="${t('atm.maintenance.pickEmployee')}"`);
    expect(html).not.toContain(t('atm.maintenance.noEmployeesHint'));
    // The label points at the box, and the field is required.
    const id = /<input[^>]*id="([^"]+)"[^>]*role="combobox"/u.exec(html)?.[1] ?? 'missing';
    expect(html).toContain(`for="${id}"`);
  });

  it('says where the list is set while it is empty', () => {
    expect(closeWith([])).toContain(t('atm.maintenance.noEmployeesHint'));
  });

  it('shows each person with their HR code, so two of one name are told apart', () => {
    expect(PEOPLE.map(leaderOptionLabel)).toEqual([
      'أحمد سعيد محمد (0101)',
      'أحمد سعيد محمد (0102)',
      'محمود علي حسن (0103)',
    ]);
  });

  it('the close searches what the reader sees — the labels — never the employee id behind them', () => {
    const html = closeWith(PEOPLE);
    expect(html).not.toContain('value="e1"');
    // A typed HR code finds its person by the label; an id fragment finds nobody.
    const labels = PEOPLE.map(leaderOptionLabel);
    expect(exactOption(labels, 'محمود علي حسن (0103)')).toBe('محمود علي حسن (0103)');
    expect(exactOption(labels, 'e1')).toBeUndefined();
  });

  it('leaving a box on a whole name picks it — a part or a blank picks nothing', () => {
    const names = leaderNames(PEOPLE);
    // Folded the way an Arabic typist writes it: hamza and spacing do not matter.
    expect(exactOption(names, '  احمد سعيد محمد ')).toBe('أحمد سعيد محمد');
    expect(exactOption(names, 'أحمد')).toBeUndefined();
    expect(exactOption(names, '')).toBeUndefined();
    // Shown differently from what it commits: either text is a whole match.
    expect(exactOption(['MOHNDESSEN'], 'المهندسين', () => 'المهندسين')).toBe('MOHNDESSEN');
  });

  it('a checked set opens on the leader its rows share — blank when they differ', () => {
    expect(sharedLeader([{ leaderName: 'أ' }, { leaderName: 'أ' }])).toBe('أ');
    expect(sharedLeader([{ leaderName: 'أ' }, { leaderName: 'ب' }])).toBe('');
    expect(sharedLeader([{ leaderName: 'أ' }, { leaderName: null }])).toBe('');
    expect(sharedLeader([{ leaderName: null }, { leaderName: null }])).toBe('');
  });

  it('says the list could not be loaded, rather than offering nobody in silence', async () => {
    // A first load that failed, with nothing cached — kept failed on mount for the static render.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    await qc.prefetchQuery({
      queryKey: atmLeaderOptionsKey(),
      queryFn: () => Promise.reject(new Error('down')),
    });
    const html = render(<CloseMaintenanceDialog open rows={[ROW]} onClose={() => undefined} />, qc);
    expect(html).toContain(t('atm.common.leadersLoadFailed'));
    expect(html).not.toContain(t('atm.maintenance.noEmployeesHint'));
  });

  it('the edit dialogs offer each name once — two people of one name write the same leader', () => {
    expect(leaderNames(PEOPLE)).toEqual(['أحمد سعيد محمد', 'محمود علي حسن']);
  });

  it('in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const key of [
        'atm.settings.leaders.title',
        'atm.settings.leaders.hint',
        'atm.settings.leaders.byName',
        'atm.settings.leaders.noneFound',
        'atm.settings.leaders.count',
        'atm.settings.leaders.employees',
        'atm.settings.leaders.matchesName',
        'atm.settings.leaders.stale',
        'atm.settings.leaders.unknown',
        'atm.settings.leaders.none',
        'atm.settings.leaders.saved',
        'atm.settings.leaders.reset',
        'atm.maintenance.noEmployeesHint',
        'atm.settings.leaders.emptyWarning',
        'atm.common.leadersLoadFailed',
      ]) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});

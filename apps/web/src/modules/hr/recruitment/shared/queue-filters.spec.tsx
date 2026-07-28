// Renders every recruitment queue filter bar against the REAL locale catalogs, in both locales,
// and pins the two behaviours that are invisible until they are wrong.
//
// 1. LABELS. The bars are the feature's whole user-facing surface and their failure mode is silent:
//    a label whose key is missing renders the key itself and the bar still "works", so typecheck,
//    lint and build all stay green while the user reads `screening.filters.ageFrom`.
//
// 2. PERMISSIONS. The branch and interviewer controls read catalogs behind their own permissions
//    (`branch.view`, `user.view`), separate from the permission that opens the queue. A user with
//    the queue but not the catalog must get no control at all — not an empty dropdown that filters
//    nothing. Adding a filter must not change who can read what.
//
// Employees Ready is included even though its page lives under the Employees app — it is a
// recruitment queue (A6/RW15), and its bar was written in the same slice as the others.
//
// `renderToStaticMarkup` keeps this dependency-free: no jsdom, no testing-library. The pickers read
// through TanStack Query, so a client is supplied; nothing fetches, because a static render never
// gets past the first paint.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto } from '@ecms/contracts';
import { authSlice } from '../../../../store/authSlice';
import { localeSlice } from '../../../../store/localeSlice';
import {
  EmployeesReadyFilters,
  EMPTY_EMPLOYEES_READY_FILTERS,
} from '../../employee-management/employees/components/EmployeesReadyFilters';
import { EvaluationFilters, EMPTY_EVALUATION_FILTERS } from '../evaluations/components/EvaluationFilters';
import { InterviewFilters, EMPTY_INTERVIEW_FILTERS } from '../interviews/components/InterviewFilters';
import { ScreeningFilters, EMPTY_SCREENING_FILTERS } from '../screening/components/ScreeningFilters';

/** Only `permissions` is read by `useCan`; the rest satisfies the DTO. */
const me = (permissions: string[]): MeDto =>
  ({
    id: 'u1',
    email: 'admin@ecms.local',
    username: 'admin',
    mustChangePassword: false,
    name: { firstName: { en: 'A', ar: 'أ' }, lastName: { en: 'B', ar: 'ب' } },
    locale: 'en',
    branchId: null,
    employeeId: null,
    isPrivileged: true,
    flags: {},
    totpEnabled: false,
    permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
  }) as unknown as MeDto;

/** Everything the bars can ask for, so the default render exercises every control. */
const ALL_PERMISSIONS = ['branch.view', 'user.view'];

const render = (node: JSX.Element, locale: Locale, permissions = ALL_PERMISSIONS): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </Provider>,
  );
};

const noop = (): void => undefined;

/** Every namespace the bars draw labels from. A leaked key always starts with one of these. */
const KEY_PREFIXES = [
  'common.',
  'screening.filters.',
  'screening.status.',
  'applicants.education.',
  'interviews.filters.',
  'interviews.outcome.',
  'evaluations.filters.',
  'employeesReady.filters.',
  'recruitment.filters.',
  'offers.form.',
];

const screeningBar = <ScreeningFilters value={EMPTY_SCREENING_FILTERS} onChange={noop} />;
const evaluationBar = <EvaluationFilters value={EMPTY_EVALUATION_FILTERS} onChange={noop} />;
const readyBar = <EmployeesReadyFilters value={EMPTY_EMPLOYEES_READY_FILTERS} onChange={noop} />;
const interviewBar = <InterviewFilters value={EMPTY_INTERVIEW_FILTERS} onChange={noop} />;
// The stage page omits the two controls it owns itself (route + tab strip).
const stageBar = (
  <InterviewFilters value={EMPTY_INTERVIEW_FILTERS} onChange={noop} omit={['status', 'stage']} />
);

const bars: [name: string, node: JSX.Element][] = [
  ['screening', screeningBar],
  ['interviews', interviewBar],
  ['interviews (stage page)', stageBar],
  ['evaluations', evaluationBar],
  ['employees ready', readyBar],
];

describe('recruitment queue filter bars render localized labels', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const [name, node] of bars) {
      it(`${locale}: ${name} leaks no raw translation key`, () => {
        const markup = render(node, locale);
        const leaked = KEY_PREFIXES.filter((prefix) => markup.includes(prefix));
        expect(leaked, `${name} rendered these key prefixes verbatim in ${locale}`).toEqual([]);
      });
    }
  }

  it('the new prescreening controls render their real labels', () => {
    const en = render(screeningBar, 'en');
    expect(en).toContain('Age from');
    expect(en).toContain('Age to');
    expect(en).toContain('All education levels');

    const ar = render(screeningBar, 'ar');
    expect(ar).toContain('السن من');
    expect(ar).toContain('السن إلى');
  });

  it('the stage bar drops the controls its page owns', () => {
    const full = render(interviewBar, 'en');
    const stage = render(stageBar, 'en');
    expect(full).toContain('All statuses');
    expect(stage).not.toContain('All statuses');
    // What remains is still a working bar, not an empty shell.
    expect(stage).toContain('All outcomes');
    expect(stage).toContain('All branches');
  });
});

describe('recruitment queue filter bars offer the standard controls', () => {
  const hasSearch = (markup: string, placeholder: string): boolean =>
    markup.includes(`placeholder="${placeholder}"`);

  it('every queue that was asked for one has a free-text search box', () => {
    expect(hasSearch(render(interviewBar, 'en'), 'Applicant code or name')).toBe(true);
    expect(hasSearch(render(stageBar, 'en'), 'Applicant code or name')).toBe(true);
    expect(hasSearch(render(evaluationBar, 'en'), 'Applicant code or name')).toBe(true);
    expect(hasSearch(render(readyBar, 'en'), 'Offer number or applicant')).toBe(true);
  });

  it('every queue whose records carry a branch offers the branch filter', () => {
    for (const [name, node] of [
      ['interviews', interviewBar],
      ['interviews (stage page)', stageBar],
      ['evaluations', evaluationBar],
      ['employees ready', readyBar],
    ] as [string, JSX.Element][]) {
      expect(render(node, 'en'), `${name} is missing the branch filter`).toContain('All branches');
      expect(render(node, 'ar'), `${name} is missing the branch filter in ar`).toContain('كل الفروع');
    }
  });

  it('the interview queue offers the assigned-user (interviewer) filter', () => {
    expect(render(interviewBar, 'en')).toContain('placeholder="Interviewer"');
    expect(render(stageBar, 'ar')).toContain('placeholder="المُقابِل"');
  });
});

describe('catalog-backed filters respect their own permissions', () => {
  it('no branch.view → no branch control at all, rather than an empty dropdown', () => {
    for (const [name, node] of [
      ['interviews', interviewBar],
      ['evaluations', evaluationBar],
      ['employees ready', readyBar],
    ] as [string, JSX.Element][]) {
      const markup = render(node, 'en', ['user.view']);
      expect(markup, `${name} still rendered a branch control`).not.toContain('All branches');
    }
  });

  it('no user.view → the interviewer picker degrades to a hint, never a raw-id box', () => {
    const markup = render(interviewBar, 'en', ['branch.view']);
    expect(markup).not.toContain('placeholder="Interviewer"');
    // The bar still works; only the directory-backed control steps aside.
    expect(markup).toContain('All branches');
  });

  it('with neither permission the bar still renders its own controls', () => {
    const markup = render(interviewBar, 'en', []);
    expect(markup).toContain('All statuses');
    expect(markup).toContain('All outcomes');
    expect(markup).not.toContain('All branches');
  });
});

// Renders every recruitment queue filter bar against the REAL locale catalogs, in both locales.
//
// The bars are the whole feature's user-facing surface, and their failure mode is silent: a label
// whose key is missing renders the key itself and the bar still "works", so a typecheck, a lint and
// a build all stay green while the user reads `screening.filters.ageFrom`. This asserts the thing
// those checks cannot: that every control resolves to a real label in ar AND en.
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
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import {
  EmployeesReadyFilters,
  EMPTY_EMPLOYEES_READY_FILTERS,
} from '../../employee-management/employees/components/EmployeesReadyFilters';
import { EvaluationFilters, EMPTY_EVALUATION_FILTERS } from '../evaluations/components/EvaluationFilters';
import { InterviewFilters, EMPTY_INTERVIEW_FILTERS } from '../interviews/components/InterviewFilters';
import { ScreeningFilters, EMPTY_SCREENING_FILTERS } from '../screening/components/ScreeningFilters';

const render = (node: JSX.Element, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
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
];

const bars: [name: string, node: JSX.Element][] = [
  ['screening', <ScreeningFilters value={EMPTY_SCREENING_FILTERS} onChange={noop} />],
  [
    // The stage page omits the two controls it owns itself (route + tab strip).
    'interviews (stage page)',
    <InterviewFilters value={EMPTY_INTERVIEW_FILTERS} onChange={noop} omit={['status', 'stage']} />,
  ],
  ['evaluations', <EvaluationFilters value={EMPTY_EVALUATION_FILTERS} onChange={noop} />],
  ['employees ready', <EmployeesReadyFilters value={EMPTY_EMPLOYEES_READY_FILTERS} onChange={noop} />],
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
    const en = render(<ScreeningFilters value={EMPTY_SCREENING_FILTERS} onChange={noop} />, 'en');
    expect(en).toContain('Age from');
    expect(en).toContain('Age to');
    expect(en).toContain('All education levels');

    const ar = render(<ScreeningFilters value={EMPTY_SCREENING_FILTERS} onChange={noop} />, 'ar');
    expect(ar).toContain('السن من');
    expect(ar).toContain('السن إلى');
  });

  it('the stage bar drops the controls its page owns', () => {
    const full = render(<InterviewFilters value={EMPTY_INTERVIEW_FILTERS} onChange={noop} />, 'en');
    const stage = render(
      <InterviewFilters value={EMPTY_INTERVIEW_FILTERS} onChange={noop} omit={['status', 'stage']} />,
      'en',
    );
    expect(full).toContain('All statuses');
    expect(stage).not.toContain('All statuses');
    // What remains is still a working bar, not an empty shell.
    expect(stage).toContain('All outcomes');
  });
});

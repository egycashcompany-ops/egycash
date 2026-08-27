// Who the offer is for survives a reload — which is a claim about WHERE that answer is kept.
//
// It used to be kept in router state: `navigate('/job-offers/new', { state: { applicant } })`.
// Router state lives in the history entry and is discarded on reload, so a recruiter who
// refreshed — or opened the form in a second tab, or returned through a restored session — was
// handed an empty picker with nothing to say that a candidate had ever been chosen. Every other
// piece of state on this screen's sibling list is already synchronized with the query string.
//
// So the test renders the page at a URL and reads what it produces. A URL is the whole of the
// input, which is exactly the property being asserted: nothing was carried in from a previous
// navigation, because in these tests there was none.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup comes from
// `renderToStaticMarkup`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { detailKey } from '../../../../shared/lib/query-keys';
import { JobOfferFormPage } from './pages/JobOfferFormPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLICANT_ID = 'a1';
const NAME = 'سعاد عبد الرحمن';

const client = (seeded = true): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seeded) {
    qc.setQueryData(detailKey('hr', 'applicants', APPLICANT_ID), {
      id: APPLICANT_ID,
      code: 'APP-2026-000123',
      fullNameAr: NAME,
      version: 0,
    });
  }
  return qc;
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'jobOffer.create': 'organization', 'applicant.view': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

/** The page at a URL and nothing else — no router state, because a reload has none. */
const render = (route: string, qc = client()): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/job-offers/new" element={<JobOfferFormPage mode="create" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

describe('the chosen applicant is read from the URL', () => {
  /** THE REGRESSION. Before the fix this rendered the search box, whatever the URL said. */
  it('names the candidate the URL names, with no navigation to carry them in', () => {
    const markup = render(`/job-offers/new?applicantId=${APPLICANT_ID}&from=queue`);
    expect(markup).toContain(NAME);
    expect(markup).not.toContain(t('offers.form.applicantSearch'));
  });

  it('offers the search when the URL names nobody', () => {
    const markup = render('/job-offers/new');
    expect(markup).toContain(t('offers.form.applicantSearch'));
    expect(markup).not.toContain(NAME);
  });

  /**
   * `from=queue` means the candidate has ALREADY been moved to the offer stage — an audited,
   * explicit act (I11). Swapping to somebody else here would leave one person moved and a
   * different person offered, so that arrival is fixed and says so by having no «change».
   */
  it('fixes the choice that arrived from the queue', () => {
    const fromQueue = render(`/job-offers/new?applicantId=${APPLICANT_ID}&from=queue`);
    expect(fromQueue).not.toContain(t('offers.form.change'));
  });

  /** A standalone offer chose its own candidate and may choose again. */
  it('lets a standalone offer change its mind', () => {
    const standalone = render(`/job-offers/new?applicantId=${APPLICANT_ID}`);
    expect(standalone).toContain(NAME);
    expect(standalone).toContain(t('offers.form.change'));
  });

  /**
   * The name comes from the SERVER. A name carried in the query string would be unverified text
   * rendering as though the system had confirmed it — so an unresolved id shows nothing yet
   * rather than something borrowed from the URL.
   */
  it('shows no name it has not been told by the server', () => {
    const markup = render(`/job-offers/new?applicantId=${APPLICANT_ID}`, client(false));
    expect(markup).not.toContain(NAME);
  });
});

describe('neither screen keeps the answer where a reload cannot reach it', () => {
  const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');
  /** CODE ONLY — both files explain the old mechanism in prose, and must be allowed to. */
  const code = (file: string): string =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');

  it('the form does not read router state', () => {
    const source = code('pages/JobOfferFormPage.tsx');
    expect(source).not.toContain('useLocation');
    expect(source).not.toContain('location.state');
  });

  it('the queue does not write it', () => {
    const source = code('components/AwaitingOfferQueue.tsx');
    expect(source).not.toMatch(/navigate\([^)]*\{\s*state:/);
    expect(source).toContain('applicantId=');
  });
});

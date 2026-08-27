// The queue that replaced the «+ new offer» button, and the three things it must get right.
//
//   • IT SHOWS ITSELF TO NOBODY WHO HAS NOTHING TO DO HERE. The section returns null for a reader
//     holding neither `jobOffer.create` nor `applicant.moveToOffer` — an empty panel captioned
//     «nobody is waiting» would state something false about the data to somebody simply not
//     entitled to read it.
//   • THE BUTTON HAS TWO STATES AND THEY ARE NOT INTERCHANGEABLE. Somebody not yet moved is
//     offered «انقل واكتب», which is HR's explicit act (I11) and is confirmed first; somebody
//     already moved is offered «اكتب عرضًا» and goes straight to the form. Showing the second to
//     the first would open the offer stage without the decision that opens it.
//   • THE ROW SAYS WHO IT IS ABOUT. The whole reason the button moved here from the page header
//     was that the header asked somebody to remember who was ready.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup comes from
// `renderToStaticMarkup`, and every claim below is about the FIRST paint.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type AwaitingOfferCandidateDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { listKey } from '../../../../shared/lib/query-keys';
import { AwaitingOfferQueue } from './components/AwaitingOfferQueue';

const PARAMS = { page: 1, pageSize: 10 };

const row = (over: Partial<AwaitingOfferCandidateDto> = {}): AwaitingOfferCandidateDto => ({
  applicantId: 'a1',
  applicantCode: 'APP-2026-000123',
  fullNameAr: 'سعاد عبد الرحمن',
  position: 'سائق',
  movedToOffer: false,
  clearedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const client = (rows: AwaitingOfferCandidateDto[]): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('hr', 'jobOffersAwaiting', PARAMS), {
    items: rows,
    meta: { page: 1, pageSize: 10, totalItems: rows.length, totalPages: 1 },
  });
  return qc;
};

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  rows: AwaitingOfferCandidateDto[],
  permissions: string[] = ['jobOffer.create', 'applicant.moveToOffer', 'applicant.view'],
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={client(rows)}>
        <MemoryRouter initialEntries={['/job-offers']}>
          <AwaitingOfferQueue search="" page={1} onPageChange={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

/**
 * The WHOLE label on each button, not a substring of the markup.
 *
 * Substring matching was the obvious way and it is wrong in Arabic: «اكتب العرض» (write) sits
 * inside «انقله واكتب العرض» (move and write), so a row offering only the second reads as though
 * it offered both. Comparing complete labels makes «this state and not that one» exact.
 */
const buttonLabels = (markup: string): string[] =>
  [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => (m[1] ?? '').trim());

describe('who the queue shows itself to', () => {
  it('renders nothing at all for a reader who can neither move nor write', () => {
    expect(render([row()], ['jobOffer.view'])).toBe('');
  });

  it.each([['jobOffer.create'], ['applicant.moveToOffer']])(
    'renders for a reader holding %s',
    (permission) => {
      expect(render([row()], [permission, 'applicant.view'])).toContain(t('offers.awaiting.title'));
    },
  );
});

describe('the row and its button', () => {
  it('names the candidate, their code and the seat they applied to', () => {
    const markup = render([row()]);
    expect(markup).toContain('سعاد عبد الرحمن');
    expect(markup).toContain('APP-2026-000123');
    expect(markup).toContain('سائق');
  });

  /** Nobody has placed them yet — a normal state, and the code stands alone rather than «· null». */
  it('shows the code alone when no seat has been named', () => {
    const markup = render([row({ position: null })]);
    expect(markup).toContain('APP-2026-000123');
    expect(markup).not.toContain('·');
  });

  /**
   * I11. The move is HR's explicit act, so the candidate who has not had it made offers the
   * button that makes it — and NOT the one that skips straight to writing.
   */
  it('offers «move and write» to somebody not yet moved, and only that', () => {
    expect(buttonLabels(render([row({ movedToOffer: false })]))).toEqual([
      t('offers.awaiting.moveAndWrite'),
    ]);
  });

  it('offers «write» to somebody already moved, and only that', () => {
    expect(buttonLabels(render([row({ movedToOffer: true })]))).toEqual([
      t('offers.awaiting.write'),
    ]);
  });

  /**
   * Each button is gated by the permission for the act it performs, not by one permission for
   * the panel: somebody who may move but not write is still offered the move.
   */
  it('gates each state by its own permission', () => {
    const mayOnlyWrite = render([row({ movedToOffer: false })], ['jobOffer.create', 'applicant.view']);
    expect(mayOnlyWrite).toContain(t('offers.awaiting.title'));
    expect(buttonLabels(mayOnlyWrite)).toEqual([]);

    const mayOnlyMove = render([row({ movedToOffer: true })], ['applicant.moveToOffer', 'applicant.view']);
    expect(mayOnlyMove).toContain(t('offers.awaiting.title'));
    expect(buttonLabels(mayOnlyMove)).toEqual([]);
  });
});

describe('an empty queue', () => {
  /** Says so in words. A blank panel reads as a screen that failed to load. */
  it('says nobody is waiting', () => {
    expect(render([])).toContain(t('offers.awaiting.empty'));
  });
});

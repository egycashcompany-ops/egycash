// Renders the REAL badge against the REAL locale catalogs, for every interview status.
//
// The translation-key guard in `platform/localization/status-labels.spec.ts` proves the catalogs
// are complete. This proves the other half: that this component asks for the key the catalogs
// actually hold. Those are different failure modes — the regression that prompted these tests was
// a missing key, but a badge passing a mistyped prefix would render the same raw string to users
// and the catalog test alone would stay green.
//
// `renderToStaticMarkup` keeps this dependency-free: no jsdom, no testing-library, just React and
// the store the component really reads its locale from.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { INTERVIEW_STATUSES, type InterviewStatus, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../../../store/localeSlice';
import { InterviewStatusBadge } from './InterviewStatusBadge';

const render = (status: InterviewStatus, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      {/* `pending` is the outcome every non-completed round carries. */}
      <InterviewStatusBadge status={status} outcome="pending" />
    </Provider>,
  );
};

describe('InterviewStatusBadge renders localized labels', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`${locale}: no status renders a raw translation key`, () => {
      const leaked = INTERVIEW_STATUSES.filter((status) =>
        render(status, locale).includes('interviews.status.'),
      );
      expect(leaked, `these statuses leaked their key in ${locale}`).toEqual([]);
    });
  }

  it('renders the labels the regression report named', () => {
    expect(render('waiting', 'en')).toContain('Waiting');
    expect(render('waiting', 'ar')).toContain('في الانتظار');
    expect(render('inProgress', 'en')).toContain('In progress');
    expect(render('inProgress', 'ar')).toContain('جارية');
  });

  it('a completed round shows its outcome, not its status', () => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer },
      preloadedState: { locale: { locale: 'en' as Locale, dir: 'ltr' as const } },
    });
    const passed = renderToStaticMarkup(
      <Provider store={store}>
        <InterviewStatusBadge status="completed" outcome="passed" />
      </Provider>,
    );
    expect(passed).toContain('Passed');
    expect(passed).not.toContain('Completed');
  });
});

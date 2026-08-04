// The whole point of this control is a code that is reachable without being on display, so the
// two halves are asserted separately: it must NOT appear as text on the page, and it MUST be there
// for the person who actually needs it. Getting only the first half right would be data loss
// dressed up as a design improvement.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { CopyIdButton } from './CopyIdButton';

const CODE = 'APP-2026-000078';

const render = (locale: Locale = 'en', label?: string): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <CopyIdButton code={CODE} {...(label === undefined ? {} : { label })} />
    </Provider>,
  );
};

/** Attributes live inside the angle brackets, so stripping tags leaves only what a reader sees. */
const visibleText = (markup: string): string => markup.replace(/<[^>]*>/g, '');

describe('CopyIdButton', () => {
  it('never puts the code on the page as text', () => {
    expect(visibleText(render())).not.toContain(CODE);
    expect(visibleText(render('ar'))).not.toContain(CODE);
  });

  it('keeps the code reachable — in the tooltip and to a screen reader', () => {
    const markup = render();
    expect(markup).toContain(`title="Copy reference number: ${CODE}"`);
    expect(markup).toContain(`aria-label="Copy reference number: ${CODE}"`);
  });

  it('lets the caller name what the code belongs to', () => {
    expect(render('en', 'Applicant reference number')).toContain(
      `title="Applicant reference number: ${CODE}"`,
    );
  });

  it('is labelled in Arabic too, and leaks no raw key', () => {
    const markup = render('ar');
    expect(markup).toContain(`نسخ الرقم المرجعي: ${CODE}`);
    expect(markup).not.toContain('common.copyId');
  });
});

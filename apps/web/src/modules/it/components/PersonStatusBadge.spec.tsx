// Renders the REAL badge against the REAL locale catalogs, for every employment status and both
// locales — the AssetStatusBadge precedent. `it-i18n.spec.ts` proves the catalogs hold the keys;
// this proves the component asks for the ones they hold.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { EMPLOYEE_STATUSES, type EmployeeStatus, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { PersonStatusBadge } from './PersonStatusBadge';

const render = (status: EmployeeStatus, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <PersonStatusBadge status={status} />
    </Provider>,
  );
};

describe('PersonStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of EMPLOYEE_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `it.employees.status.${status}`;
        const label = translate(locale, key);
        expect(label).not.toBe(key);
        expect(render(status, locale)).toContain(label);
      });
    }
  }

  it('tells a leaver apart from everybody who still works here', () => {
    const tone = (status: EmployeeStatus): string =>
      /class="([^"]*)"/.exec(render(status, 'en'))?.[1] ?? '';
    for (const status of EMPLOYEE_STATUSES.filter((s) => s !== 'exited')) {
      expect(tone(status), status).not.toBe(tone('exited'));
    }
  });
});

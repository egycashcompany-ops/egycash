// The line an open form keeps when its run stopped part-way (`OpenStopNotice`): how many lines
// went back to the boxes, and — apart — the lines of a request that got no answer, named so they
// are checked on the board before being opened again, with the button that puts them back.
//
// Every code below is synthetic.
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import { OpenStopNotice } from './components/OpenStopNotice';

const render = (locale: Locale, node: ReactNode): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer },
        preloadedState: {
          locale: { locale, dir: (locale === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr' },
        },
      })}
    >
      {node}
    </Provider>,
  );

describe('the stopped run, on the page', () => {
  it.each(['ar', 'en'] as const)(
    'in %s: the lines back in the boxes, and the uncertain ones apart',
    (locale) => {
      const markup = render(
        locale,
        <OpenStopNotice
          unsent={100}
          uncertainCodes={['99990400', '99990401']}
          onRestore={() => {}}
        />,
      );
      expect(markup).toContain('data-open-stop="unsent"');
      expect(markup).toContain(translate(locale, 'atm.common.openStopped', { count: 100 }));
      expect(markup).toContain(translate(locale, 'atm.common.openStoppedHint'));
      expect(markup).toContain('data-open-stop="uncertain"');
      expect(markup).toContain(translate(locale, 'atm.common.openUncertain', { count: 2 }));
      expect(markup).toContain(
        translate(locale, 'atm.common.openUncertainHint', {
          codes: locale === 'ar' ? '99990400، 99990401' : '99990400, 99990401',
        }),
      );
      expect(markup).toContain(translate(locale, 'atm.common.openUncertainRestore'));
      expect(markup).toContain('text-red-600');
    },
  );

  it('the Arabic reads as the catalog writes it', () => {
    expect(translate('ar', 'atm.common.openStopped', { count: 100 })).toBe(
      'توقف الإرسال قبل آخر 100 سطر',
    );
    expect(translate('ar', 'atm.common.openUncertain', { count: 200 })).toBe(
      'لم يصل رد على 200 سطر، وقد يكون بعضها فُتح',
    );
  });

  it('only what happened is said', () => {
    const unsentOnly = render(
      'ar',
      <OpenStopNotice unsent={5} uncertainCodes={[]} onRestore={() => {}} />,
    );
    expect(unsentOnly).toContain('data-open-stop="unsent"');
    expect(unsentOnly).not.toContain('data-open-stop="uncertain"');
    const uncertainOnly = render(
      'ar',
      <OpenStopNotice unsent={0} uncertainCodes={['99990001']} onRestore={() => {}} />,
    );
    expect(uncertainOnly).toContain('data-open-stop="uncertain"');
    expect(uncertainOnly).not.toContain('data-open-stop="unsent"');
    expect(
      render('ar', <OpenStopNotice unsent={0} uncertainCodes={[]} onRestore={() => {}} />),
    ).toBe('');
  });
});

// The line an open form keeps when its run stopped part-way (`OpenStopNotice`): how many lines
// went back to the boxes, and — apart — the lines of a request whose result is unknown, named so
// they are checked in the table before being opened again, with the buttons that put them back or
// hide the list. Those uncertain lines outlive later presses (`openPressStarted`/`openPressEnded`)
// — the unsent line itself asks for one.
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
import { BranchChangedError } from './lib/paste-batches';
import {
  OpenStopNotice,
  emptyOpenStop,
  openPressEnded,
  openPressStarted,
  withoutRows,
} from './components/OpenStopNotice';

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
          action="فتح التغذيات"
          busy={false}
          onRestore={() => {}}
          onDismiss={() => {}}
        />,
      );
      expect(markup).toContain('data-open-stop="unsent"');
      expect(markup).toContain(translate(locale, 'atm.common.openStopped', { count: 100 }));
      expect(markup).toContain(
        translate(locale, 'atm.common.openStoppedHint', { action: 'فتح التغذيات' }),
      );
      expect(markup).toContain('«فتح التغذيات»');
      expect(markup).toContain('data-open-stop="uncertain"');
      expect(markup).toContain(translate(locale, 'atm.common.openUncertain', { count: 2 }));
      expect(markup).toContain(
        translate(locale, 'atm.common.openUncertainHint', {
          codes: locale === 'ar' ? '99990400، 99990401' : '99990400, 99990401',
        }),
      );
      expect(markup).toContain(translate(locale, 'atm.common.openUncertainRisk'));
      expect(markup).toContain(translate(locale, 'atm.common.openUncertainRestore'));
      expect(markup).toContain(translate(locale, 'atm.common.openUncertainDismiss'));
      expect(markup).toContain('text-red-600');
    },
  );

  it('the Arabic reads as the catalog writes it', () => {
    expect(translate('ar', 'atm.common.openStopped', { count: 100 })).toBe(
      'توقف الإرسال قبل آخر 100 سطر',
    );
    expect(translate('ar', 'atm.common.openUncertain', { count: 200 })).toBe(
      'لم تتأكد نتيجة 200 سطر',
    );
    expect(translate('ar', 'atm.common.openStoppedHint', { action: 'فتح الصيانات' })).toBe(
      'لم تُرسل وأُعيدت إلى الخانات، فاضغط «فتح الصيانات» مرة أخرى لإرسالها.',
    );
  });

  it('only what happened is said', () => {
    const unsentOnly = render(
      'ar',
      <OpenStopNotice
        unsent={5}
        uncertainCodes={[]}
        action="فتح"
        busy={false}
        onRestore={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(unsentOnly).toContain('data-open-stop="unsent"');
    expect(unsentOnly).not.toContain('data-open-stop="uncertain"');
    const uncertainOnly = render(
      'ar',
      <OpenStopNotice
        unsent={0}
        uncertainCodes={['99990001']}
        action="فتح"
        busy={false}
        onRestore={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(uncertainOnly).toContain('data-open-stop="uncertain"');
    expect(uncertainOnly).not.toContain('data-open-stop="unsent"');
    expect(
      render(
        'ar',
        <OpenStopNotice
          unsent={0}
          uncertainCodes={[]}
          action="فتح"
          busy={false}
          onRestore={() => {}}
          onDismiss={() => {}}
        />,
      ),
    ).toBe('');
  });
});

describe('the uncertain lines stay until the reader puts them back or hides them', () => {
  type Row = { machineCode: string };
  const row = (machineCode: string): Row => ({ machineCode });

  it('a second press — the one the unsent line asks for — keeps them; only the unsent count goes', () => {
    // 1st press: request 3 of 4 got no answer.
    let state = openPressEnded(emptyOpenStop<Row>(), {
      unsent: [row('99990600')],
      uncertain: [row('99990400'), row('99990401')],
    });
    expect(state).toEqual({
      unsent: 1,
      uncertain: [row('99990400'), row('99990401')],
      pressAgain: true,
    });
    // 2nd press starts…
    state = openPressStarted(state);
    expect(state).toEqual({
      unsent: 0,
      uncertain: [row('99990400'), row('99990401')],
      pressAgain: true,
    });
    // …and every line goes.
    state = openPressEnded(state, { unsent: [], uncertain: [] });
    expect(state.uncertain).toEqual([row('99990400'), row('99990401')]);
    expect(state.unsent).toBe(0);
  });

  it('a later stop adds its uncertain lines after the ones still held', () => {
    const held = { unsent: 0, uncertain: [row('99990400')], pressAgain: true };
    expect(openPressEnded(held, { unsent: [], uncertain: [row('99990900')] }).uncertain).toEqual([
      row('99990400'),
      row('99990900'),
    ]);
  });

  it('a button clears exactly the rows it showed — never one a press added since', () => {
    const a = row('99990400');
    const b = row('99990401');
    const late = row('99990900'); // appended by a press the reader had not seen yet
    expect(withoutRows([a, b, late], [a, b])).toEqual([late]);
    // By identity: an equal-looking row from another stop is a different line.
    expect(withoutRows([a, row('99990400')], [a])).toEqual([row('99990400')]);
  });
});

describe('the buttons are held while a press runs', () => {
  it('both disabled when busy, both live when not', () => {
    const notice = (busy: boolean) =>
      render(
        'ar',
        <OpenStopNotice
          unsent={0}
          uncertainCodes={['99990001']}
          action="فتح"
          busy={busy}
          onRestore={() => {}}
          onDismiss={() => {}}
        />,
      );
    expect(notice(true).match(/<button[^>]*\sdisabled=""/g)).toHaveLength(2);
    expect(notice(false).match(/<button[^>]*\sdisabled=""/g)).toBeNull();
  });
});

describe('after the branch changed under a run (the backstop pin)', () => {
  it('the unsent line does not say «اضغط … مرة أخرى» — a new press would go to the other branch', () => {
    const state = openPressEnded(emptyOpenStop<{ machineCode: string }>(), {
      unsent: [{ machineCode: '99990001' }],
      uncertain: [],
      failure: new BranchChangedError(),
    });
    expect(state.pressAgain).toBe(false);
    const markup = render(
      'ar',
      <OpenStopNotice
        unsent={state.unsent}
        uncertainCodes={[]}
        action="فتح التغذيات"
        busy={false}
        pressAgain={state.pressAgain}
        onRestore={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(markup).toContain(translate('ar', 'atm.common.pasteLeftOnly'));
    expect(markup).not.toContain('مرة أخرى');
    // The next press starts afresh.
    expect(openPressStarted(state).pressAgain).toBe(true);
  });
});

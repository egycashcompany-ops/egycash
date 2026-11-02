// The owner's rule on screen (2026-10-13, port doc OD-1): «مينفعش أضيف ماكينة مرتين سواء فى عملية
// التغذية أو الصيانة» — lifted for replenishments 2026-11-01 (OD-1b): «عايزك تسمح فى التغذيات بإنى
// افتح تغذيه أكتر من واحده لنفس الماكينة عادى», and for maintenance 2026-11-02 (OD-1c): «في الصيانة
// عايزك تسمح إنه يضيف أكتر من صيانة عادي». The server refuses neither any more; these pin that no
// screen still speaks of a refusal:
//   · both open forms print the unknown codes only — every line of a known code opens — and the
//     refusal lines are gone from the catalog;
//   · a reopen or an edit that fails is the global toast's, once, on both kinds — no hook keeps a
//     failure to itself for the rule's code any more;
//   · the mail page prints no refusal line; the accept call still reads `meta.refused` (always
//     empty now) beside `data`, the accepted tickets — and its confirm still counts the selected
//     mails painted «مكررة», saying that accepting them opens another maintenance;
//   · a list of codes is joined in the reader's language (the Arabic comma only in Arabic).
//
// Every code below is synthetic.
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import { ApiError } from '../../shared/lib/api-client';
import { queryClient } from '../../shared/lib/query-client';
import { toast } from '../../shared/ui/toast/toast-store';
import { acceptConfirmBody, joinCodes } from './lib/operation-view';
import { OpenRefusalNotice } from './components/OpenRefusalNotice';
import { useReopenAtmMaintenance, useReopenAtmReplenishment } from './api/atm-queries';
import type * as AtmApiModule from './api/atm-api';

/** The 409 an OLDER server answered under the rule — a client must treat it like any failure now. */
const refusal = (): ApiError =>
  new ApiError(
    ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
    'machine 99990001 already has an open maintenance that day',
    409,
    undefined,
    'req-spec',
  );

/** What the mocked reopen calls throw, per test. */
let reopenFailure: () => ApiError = refusal;

vi.mock('./api/atm-api', async () => {
  const actual = await vi.importActual<typeof AtmApiModule>('./api/atm-api');
  return {
    ...actual,
    reopenReplenishment: (): Promise<never> => Promise.reject(reopenFailure()),
    reopenMaintenance: (): Promise<never> => Promise.reject(reopenFailure()),
  };
});

const storeIn = (locale: Locale) =>
  configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: (locale === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr' },
    },
  });

const render = (locale: Locale, node: ReactNode): string =>
  renderToStaticMarkup(<Provider store={storeIn(locale)}>{node}</Provider>);

/** Render once to get a hook's mutation, the way a page holds it. */
const held = <T,>(hook: () => T): T => {
  let result: T | undefined;
  const Probe = (): null => {
    result = hook();
    return null;
  };
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
  );
  if (result === undefined) throw new Error('the hook did not run');
  return result;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  reopenFailure = refusal;
});

describe('codes are joined in the reader’s language', () => {
  it('the Arabic comma only in Arabic', () => {
    expect(joinCodes(['99990001', '99990002'], 'ar')).toBe('99990001، 99990002');
    expect(joinCodes(['99990001', '99990002'], 'en')).toBe('99990001, 99990002');
  });
});

/** A key the catalog no longer holds resolves to itself, in both languages. */
const gone = (key: string): void => {
  for (const locale of ['ar', 'en'] as const) {
    expect(translate(locale, key, { codes: '1', code: '1', count: 1 }), `${locale}: ${key}`).toBe(
      key,
    );
  }
};

describe('the open forms name only the codes the master does not know', () => {
  it.each(['ar', 'en'] as const)('in %s: the unknown codes, in red — nothing else', (locale) => {
    const markup = render(locale, <OpenRefusalNotice unknownCodes={['99990009', '99990008']} />);
    expect(markup).toContain(
      translate(locale, 'atm.common.unknownCodes', {
        codes: joinCodes(['99990009', '99990008'], locale),
      }),
    );
    expect(markup).toContain('text-red-600');
    expect(markup).not.toContain('data-refusal');
  });

  it('the refusal lines of both forms are gone from the catalog (OD-1b, OD-1c)', () => {
    gone('atm.maintenance.alreadyOpenCodes');
    gone('atm.replenishments.alreadyOpenCodes');
  });

  it('prints nothing when every line opened', () => {
    expect(render('ar', <OpenRefusalNotice unknownCodes={[]} />)).toBe('');
  });
});

describe('a reopen or an edit that fails is the global toast’s, once — on both kinds', () => {
  it('the done pages’ and the edit dialog’s refusal wordings are gone', () => {
    gone('atm.done.reopenAlreadyOpenMaint');
    gone('atm.done.reopenAlreadyOpenRep');
    gone('atm.common.moveAlreadyOpen');
  });

  it.each([
    ['replenishment', 'the old rule’s 409', refusal],
    ['replenishment', 'a stale write', () => new ApiError('STALE_DOCUMENT', 'stale', 409)],
    ['maintenance', 'the old rule’s 409', refusal],
    ['maintenance', 'a stale write', () => new ApiError('STALE_DOCUMENT', 'stale', 409)],
  ] as const)('%s, %s: toasted once by the global handler', async (kind, _what, failure) => {
    reopenFailure = failure;
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    const run =
      kind === 'replenishment'
        ? held(useReopenAtmReplenishment).mutateAsync({ id: 'r1', version: 1 })
        : held(useReopenAtmMaintenance).mutateAsync({ id: 'm1', version: 1 });
    await expect(run).rejects.toBeInstanceOf(ApiError);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe('the mail page refuses nothing — a flagged mail is accepted (OD-1c)', () => {
  it('the refusal line is gone from the catalog', () => {
    gone('atm.mail.refusedOpenMaintenance');
  });

  it('the accept call reads the accepted tickets from `data`, and `meta.refused` — empty now — as before', async () => {
    const { acceptMailTickets } = await vi.importActual<typeof AtmApiModule>('./api/atm-api');
    const answer = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        answer({ success: true, data: [{ id: 't1' }, { id: 't9' }], meta: { refused: [] } }),
      ),
    );
    const result = await acceptMailTickets(['t1', 't9']);
    expect(result.accepted.map((ticket) => ticket.id)).toEqual(['t1', 't9']);
    expect(result.refused).toEqual([]);

    // A server that sends no meta reads the same.
    vi.stubGlobal('fetch', () => Promise.resolve(answer({ success: true, data: [] })));
    expect(await acceptMailTickets(['t1'])).toEqual({ accepted: [], refused: [] });
  });

  it('the page no longer has a refusal notice to render', async () => {
    const page = await import('./pages/MailTicketsPage');
    expect(Object.keys(page)).not.toContain('AcceptRefusalNotice');
  });
});

describe('the accept confirm counts the flagged mails among the selected — they open another maintenance', () => {
  const rows = [
    { id: 't1', duplication: true },
    { id: 't2', duplication: false },
    { id: 't3', duplication: true },
    { id: 't4', duplication: true },
  ];

  it.each(['ar', 'en'] as const)(
    'in %s: the flagged mails among the selected are counted',
    (locale) => {
      const t = (key: string, params?: Record<string, string | number>): string =>
        translate(locale, key, params);
      const body = acceptConfirmBody(t, rows, ['t1', 't2', 't3']);
      expect(body).toBe(
        `${translate(locale, 'atm.mail.acceptBody', { count: 3 })} ${translate(
          locale,
          'atm.mail.acceptBodyFlagged',
          { count: 2 },
        )}`,
      );
      expect(translate(locale, 'atm.mail.acceptBodyFlagged', { count: 2 })).not.toBe(
        'atm.mail.acceptBodyFlagged',
      );
    },
  );

  it('says nothing more when no selected mail is flagged (t4 is flagged but not selected)', () => {
    const t = (key: string, params?: Record<string, string | number>): string =>
      translate('ar', key, params);
    expect(acceptConfirmBody(t, rows, ['t2'])).toBe(
      translate('ar', 'atm.mail.acceptBody', { count: 1 }),
    );
  });

  it('prints the Arabic in the formal register, and promises no refusal', () => {
    expect(translate('ar', 'atm.mail.acceptBodyFlagged', { count: 2 })).toBe(
      'تنبيه: 2 منها لماكينات لها صيانة مفتوحة بالفعل في نفس اليوم (الصفوف المميزة)، وسيفتح قبولها صيانة أخرى.',
    );
    expect(translate('ar', 'atm.mail.subtitle')).toBe(
      'الرسائل المعلقة. الصف المميز لماكينة لها صيانة مفتوحة بالفعل في نفس اليوم، وقبول رسالته يفتح صيانة أخرى.',
    );
    for (const key of ['atm.mail.acceptBodyFlagged', 'atm.mail.subtitle']) {
      expect(translate('ar', key, { count: 2 })).not.toContain('لن تُقبل');
      expect(translate('ar', key, { count: 2 })).not.toContain('لا يمكن قبول');
      expect(translate('en', key, { count: 2 })).toContain('opens another');
      expect(translate('en', key, { count: 2 })).not.toContain('not be accepted');
      expect(translate('en', key, { count: 2 })).not.toContain('cannot be accepted');
    }
  });
});

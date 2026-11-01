// The owner's rule on screen (2026-10-13, port doc OD-1): «مينفعش أضيف ماكينة مرتين سواء فى عملية
// التغذية أو الصيانة». The server refuses a second open operation; these pin that every refusal
// reaches the reader in their language, once:
//   · the open forms name the codes they did not open, in red, beside the unknown codes;
//   · a done page words a refused reopen itself — and the global toast stays silent for THAT
//     refusal only, every other failure still raising it exactly as before;
//   · the mail page names the tickets accept refused, and the accept call reads them from `meta`
//     while `data` stays the accepted tickets — and its confirm says BEFORE the accept which of the
//     selected mails will be refused;
//   · a list of codes is joined in the reader's language (the Arabic comma only in Arabic).
//
// Every code below is synthetic.
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes, type AtmMailAcceptRefusalDto, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import { ApiError } from '../../shared/lib/api-client';
import { queryClient } from '../../shared/lib/query-client';
import { toast } from '../../shared/ui/toast/toast-store';
import {
  acceptConfirmBody,
  alreadyOpenCodesKey,
  isAlreadyOpenRefusal,
  joinCodes,
  refusedMachineCodes,
  reopenRefusalKey,
} from './lib/operation-view';
import { OpenRefusalNotice } from './components/OpenRefusalNotice';
import { repeatsAnOpenMachine } from './components/ReplenishmentDialogs';
import { AcceptRefusalNotice } from './pages/MailTicketsPage';
import { useReopenAtmMaintenance, useReopenAtmReplenishment } from './api/atm-queries';
import type * as AtmApiModule from './api/atm-api';

const refusal = (): ApiError =>
  new ApiError(
    ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
    'machine 99990001 already has an open replenishment',
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

describe('the refusal is recognized by its code, never by its words', () => {
  it('is the rule’s 409 code and nothing else', () => {
    expect(isAlreadyOpenRefusal(refusal())).toBe(true);
    expect(isAlreadyOpenRefusal(new ApiError('STALE_DOCUMENT', 'x', 409))).toBe(false);
    expect(isAlreadyOpenRefusal(new ApiError('DUPLICATE', 'x', 409))).toBe(false);
    expect(isAlreadyOpenRefusal(new Error(ErrorCodes.ATM_OPERATION_ALREADY_OPEN))).toBe(false);
    expect(isAlreadyOpenRefusal(null)).toBe(false);
  });

  it('names each refused machine once, in the order the server gave', () => {
    expect(
      refusedMachineCodes([
        { machineCode: '99990002' },
        { machineCode: '99990001' },
        { machineCode: '99990002' },
      ]),
    ).toEqual(['99990002', '99990001']);
  });

  it('joins the codes in the reader’s language — the Arabic comma only in Arabic', () => {
    expect(joinCodes(['99990001', '99990002'], 'ar')).toBe('99990001، 99990002');
    expect(joinCodes(['99990001', '99990002'], 'en')).toBe('99990001, 99990002');
  });
});

/** The separator a refusal line uses in this locale, spelled out rather than recomputed. */
const sep = (locale: Locale): string => (locale === 'ar' ? '، ' : ', ');

describe('the open forms name the codes they did not open', () => {
  it.each([
    ['replenishment', 'ar'],
    ['replenishment', 'en'],
    ['maintenance', 'ar'],
    ['maintenance', 'en'],
  ] as const)('%s, in %s, beside the unknown codes', (kind, locale) => {
    const markup = render(
      locale,
      <OpenRefusalNotice
        kind={kind}
        unknownCodes={['99990009']}
        alreadyOpenCodes={['99990001', '99990001']}
      />,
    );
    const line = translate(locale, alreadyOpenCodesKey(kind), {
      codes: `99990001${sep(locale)}99990001`,
    });
    expect(line).not.toBe(alreadyOpenCodesKey(kind));
    expect(markup).toContain(line);
    expect(markup).toContain('data-refusal="already-open"');
    expect(markup).toContain('text-red-600');
    // The unknown-code line is the one the form always printed.
    expect(markup).toContain(translate(locale, 'atm.common.unknownCodes', { codes: '99990009' }));
  });

  it('prints the Arabic in the formal register the catalog is held to', () => {
    expect(translate('ar', 'atm.replenishments.alreadyOpenCodes', { codes: '99990001' })).toBe(
      'لم تُفتح لأن للماكينة تغذية مفتوحة في نفس اليوم أو لأن الكود مُدخل مرتين: 99990001',
    );
    expect(translate('ar', 'atm.maintenance.alreadyOpenCodes', { codes: '99990001' })).toBe(
      'لم تُفتح لأن للماكينة صيانة مفتوحة في نفس اليوم أو لأن الكود مُدخل مرتين: 99990001',
    );
  });

  it('prints nothing when every line opened', () => {
    expect(
      render(
        'ar',
        <OpenRefusalNotice kind="replenishment" unknownCodes={[]} alreadyOpenCodes={[]} />,
      ),
    ).toBe('');
  });
});

describe('a done page words a refused reopen itself', () => {
  it.each(['replenishment', 'maintenance'] as const)(
    '%s: the message names the machine',
    (kind) => {
      for (const locale of ['ar', 'en'] as const) {
        const text = translate(locale, reopenRefusalKey(kind), { code: '99990001' });
        expect(text).not.toBe(reopenRefusalKey(kind));
        expect(text).toContain('99990001');
      }
      expect(translate('ar', reopenRefusalKey(kind), { code: '99990001' })).toBe(
        kind === 'replenishment'
          ? 'لا يمكن إعادة فتح هذه العملية لأن للماكينة 99990001 تغذية مفتوحة أخرى في نفس اليوم.'
          : 'لا يمكن إعادة فتح هذه العملية لأن للماكينة 99990001 صيانة مفتوحة أخرى في نفس اليوم.',
      );
    },
  );

  it.each([
    ['replenishment', () => held(useReopenAtmReplenishment).mutateAsync({ id: 'r1', version: 1 })],
    ['maintenance', () => held(useReopenAtmMaintenance).mutateAsync({ id: 'm1', version: 1 })],
  ])('%s: the rule’s refusal raises no global toast', async (_kind, run) => {
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([
    ['replenishment', () => held(useReopenAtmReplenishment).mutateAsync({ id: 'r1', version: 1 })],
    ['maintenance', () => held(useReopenAtmMaintenance).mutateAsync({ id: 'm1', version: 1 })],
  ])('%s: any OTHER failure is still toasted once, as before', async (_kind, run) => {
    reopenFailure = () => new ApiError('STALE_DOCUMENT', 'stale', 409);
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe('the mail page names the tickets accept refused', () => {
  const refused: AtmMailAcceptRefusalDto[] = [
    { ticketId: 't1', machineCode: '99990001', reason: 'maintenanceAlreadyOpen' },
    { ticketId: 't2', machineCode: '99990001', reason: 'maintenanceAlreadyOpen' },
    { ticketId: 't3', machineCode: '99990002', reason: 'maintenanceAlreadyOpen' },
  ];

  it.each(['ar', 'en'] as const)('in %s: how many, and which machines', (locale) => {
    const markup = render(locale, <AcceptRefusalNotice refused={refused} />);
    expect(markup).toContain('data-refusal="maintenance-open"');
    expect(markup).toContain(
      translate(locale, 'atm.mail.refusedOpenMaintenance', {
        count: 3,
        codes: `99990001${sep(locale)}99990002`,
      }),
    );
    if (locale === 'en') expect(markup).not.toContain('،');
  });

  it('prints nothing when nothing was refused', () => {
    expect(render('ar', <AcceptRefusalNotice refused={[]} />)).toBe('');
  });

  it('reads the refusals from `meta`, and the accepted tickets from `data` as before', async () => {
    const { acceptMailTickets } = await vi.importActual<typeof AtmApiModule>('./api/atm-api');
    const answer = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(answer({ success: true, data: [{ id: 't9' }], meta: { refused } })),
    );
    const result = await acceptMailTickets(['t1', 't9']);
    expect(result.accepted.map((ticket) => ticket.id)).toEqual(['t9']);
    expect(result.refused).toEqual(refused);

    // A server that sends no meta (nothing refused) reads as an empty refusal list.
    vi.stubGlobal('fetch', () => Promise.resolve(answer({ success: true, data: [] })));
    expect(await acceptMailTickets(['t1'])).toEqual({ accepted: [], refused: [] });
  });
});

describe('the accept confirm says which selected mails will be refused, before the accept', () => {
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

  it('prints the Arabic in the formal register', () => {
    expect(translate('ar', 'atm.mail.acceptBodyFlagged', { count: 2 })).toBe(
      'باستثناء 2 منها، إذ إن لماكيناتها صيانة مفتوحة بالفعل (الصفوف المميزة)، فلن تُقبل وستبقى معلقة.',
    );
  });
});

describe('a bulk move of the open time is refused before it is sent when it would double a machine', () => {
  it('is two OPEN rows of one machine — they would share the day the rule allows once', () => {
    const open = (machineCode: string) => ({ machineCode, closedAt: null });
    expect(repeatsAnOpenMachine([open('99990001'), open('99990002')])).toBe(false);
    expect(repeatsAnOpenMachine([open('99990001'), open('99990002'), open('99990001')])).toBe(true);
  });

  it('a closed row does not count — the rule holds open rows only', () => {
    expect(
      repeatsAnOpenMachine([
        { machineCode: '99990001', closedAt: null },
        { machineCode: '99990001', closedAt: '2026-10-27T10:00:00.000Z' },
      ]),
    ).toBe(false);
  });
});

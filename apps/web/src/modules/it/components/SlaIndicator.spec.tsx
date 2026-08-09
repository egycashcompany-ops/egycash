// The one piece of IT-3 presentation logic that could be WRONG rather than merely ugly.
//
// The indicator has to keep three things apart, and getting any of them backwards misreports the
// help desk's own performance:
//
//   * **breached** is a STAMP the server's sweep wrote. It must be READ, never recomputed — a
//     ticket resolved after its deadline stays breached (FR-6). A component that derived "breached"
//     from `now > dueAt` would quietly un-breach every late ticket the moment it was resolved,
//     which is exactly the number a manager would be reading.
//   * **at risk** is genuinely derived, from elapsed-versus-window. It is deliberately not stored.
//   * a STOPPED clock (first response given, ticket resolved/closed/cancelled) is neither at risk
//     nor breaching, because the promise it measured is already kept.
//
// Rendered against the real locale catalogs, so a mistyped key fails here too.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type ItTicketDto, type ItTicketStatus, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { SlaIndicator } from './SlaIndicator';

const iso = (offsetMinutes: number): string =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();

/** A ticket whose clocks are positioned relative to NOW, so the test never depends on a fixture date. */
const ticket = (overrides: {
  status?: ItTicketStatus;
  responseDueIn?: number;
  resolutionDueIn?: number;
  responseMinutes?: number;
  resolutionMinutes?: number;
  firstResponseAt?: string | null;
  responseBreachedAt?: string | null;
  resolutionBreachedAt?: string | null;
  resolved?: boolean;
}): ItTicketDto => ({
  id: '000000000000000000000001',
  ticketCode: 'TKT-2026-000001',
  title: 'Printer is jammed',
  description: 'It jams on every second page.',
  requesterUserId: '000000000000000000000002',
  branchId: null,
  categoryId: '000000000000000000000003',
  priorityId: '000000000000000000000004',
  assetId: null,
  assignedTechnicianUserId: null,
  status: overrides.status ?? 'inProgress',
  sla: {
    policy: {
      responseMinutes: overrides.responseMinutes ?? 60,
      resolutionMinutes: overrides.resolutionMinutes ?? 480,
    },
    responseDueAt: iso(overrides.responseDueIn ?? 30),
    resolutionDueAt: iso(overrides.resolutionDueIn ?? 240),
    firstResponseAt: overrides.firstResponseAt ?? null,
    responseBreachedAt: overrides.responseBreachedAt ?? null,
    resolutionBreachedAt: overrides.resolutionBreachedAt ?? null,
    pausedMs: 0,
    holdStartedAt: null,
  },
  resolution:
    overrides.resolved === true
      ? {
          summary: 'Cleared the jam and replaced the roller.',
          resolvedByUserId: '000000000000000000000005',
          resolvedAt: iso(-5),
        }
      : null,
  closedAt: null,
  reopenCount: 0,
  version: 0,
  createdAt: iso(-60),
  updatedAt: iso(-1),
});

const render = (
  dto: ItTicketDto,
  phase: 'response' | 'resolution',
  locale: Locale = 'en',
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <SlaIndicator ticket={dto} phase={phase} />
    </Provider>,
  );
};

const label = (state: string, locale: Locale = 'en'): string =>
  translate(locale, `it.tickets.sla.${state}`);

describe('SlaIndicator', () => {
  it('reads the breach STAMP rather than comparing to the clock', () => {
    // Due far in the FUTURE, so any derived check would say "on track" — but the stamp exists.
    const dto = ticket({ resolutionDueIn: 600, resolutionBreachedAt: iso(-30) });
    expect(render(dto, 'resolution')).toContain(label('breached'));
  });

  it('a late resolution does not un-breach the ticket (FR-6)', () => {
    const dto = ticket({
      status: 'resolved',
      resolved: true,
      resolutionDueIn: -120,
      resolutionBreachedAt: iso(-60),
    });
    const html = render(dto, 'resolution');
    expect(html).toContain(label('breached'));
    expect(html).not.toContain(label('done'));
  });

  it('never invents a breach from an overdue clock the server has not stamped', () => {
    // Past due but UNSTAMPED — the sweep has not run yet. Reporting "breached" here would put the
    // screen ahead of the record the reports are built from.
    const dto = ticket({ resolutionDueIn: -10, resolutionBreachedAt: null });
    expect(render(dto, 'resolution')).not.toContain(label('breached'));
  });

  it('derives at-risk from how much of the window is spent', () => {
    // A 100-minute window with 5 minutes left is 95% spent — past the 80% threshold.
    const atRisk = ticket({ resolutionMinutes: 100, resolutionDueIn: 5 });
    expect(render(atRisk, 'resolution')).toContain(label('atRisk'));
    // The same window with 90 minutes left is 10% spent.
    const onTrack = ticket({ resolutionMinutes: 100, resolutionDueIn: 90 });
    expect(render(onTrack, 'resolution')).toContain(label('onTrack'));
  });

  it('stops the response clock once a first response is given', () => {
    // Past due on the response phase, but the response HAPPENED — the promise is kept, not broken.
    const dto = ticket({ responseDueIn: -30, firstResponseAt: iso(-45) });
    const html = render(dto, 'response');
    expect(html).toContain(label('done'));
    expect(html).not.toContain(label('atRisk'));
  });

  it('stops the resolution clock on every terminal outcome', () => {
    for (const status of ['resolved', 'closed', 'cancelled'] as ItTicketStatus[]) {
      const dto = ticket({
        status,
        resolved: status === 'resolved',
        resolutionMinutes: 100,
        resolutionDueIn: 1,
      });
      expect(render(dto, 'resolution'), `${status} must stop the clock`).toContain(label('done'));
    }
  });

  it('the two phases are read independently', () => {
    // Response breached, resolution still fine: one panel must not colour the other.
    const dto = ticket({ responseBreachedAt: iso(-10), resolutionMinutes: 100, resolutionDueIn: 90 });
    expect(render(dto, 'response')).toContain(label('breached'));
    expect(render(dto, 'resolution')).toContain(label('onTrack'));
  });

  it('speaks both locales', () => {
    const dto = ticket({ resolutionBreachedAt: iso(-1) });
    for (const locale of ['en', 'ar'] as Locale[]) {
      const text = label('breached', locale);
      expect(text).not.toBe('it.tickets.sla.breached');
      expect(render(dto, 'resolution', locale)).toContain(text);
    }
  });
});

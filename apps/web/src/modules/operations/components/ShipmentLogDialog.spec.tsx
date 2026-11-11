// «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» — the log as the reader sees it, rendered against the
// real Arabic catalog: a realistic story (booked, edited, crewed, carried by the captain, confirmed
// by the desk, photographed), each entry's sentence, tile, leg, who and when; an edit's fields
// old → new under their Arabic labels («اللى يتعدل يظهر ف السجل»); and the lines that stand in the
// timeline's place while it loads, when it failed, and when there is nothing to tell.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES,
  type Locale,
  type OperationsShipmentLogDto,
  type OperationsShipmentLogEntryDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { __shipmentLogKey } from '../api/operations-queries';
import { ShipmentLogDialog, ShipmentLogTimeline } from './ShipmentLogDialog';

// The dialog is portalled to the body; on the server the portal is the node itself.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const render = (node: JSX.Element, qc = new QueryClient()): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as Locale, dir: 'rtl' as const } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

const entry = (
  id: string,
  over: Partial<OperationsShipmentLogEntryDto> & Pick<OperationsShipmentLogEntryDto, 'kind'>,
): OperationsShipmentLogEntryDto => ({
  id,
  at: '2026-11-11T07:30:00.000Z',
  actorName: 'منى عبد الرحمن',
  leg: null,
  changes: [],
  ...over,
});

/** A daily shipment's morning, oldest first, as the server sends it. */
const STORY: OperationsShipmentLogDto = {
  shipmentId: 's-1',
  truncated: false,
  entries: [
    entry('a1', {
      kind: 'created',
      at: '2026-11-11T06:05:00.000Z',
      changes: [
        { field: 'mainBank', old: null, new: 'الأهلي' },
        { field: 'originBranch', old: null, new: 'المعادي (BA-3)' },
        { field: 'lines', old: null, new: 'مصري 1,200,000' },
        { field: 'serialTracked', old: null, new: 'false' },
      ],
    }),
    entry('a2', {
      kind: 'edited',
      at: '2026-11-11T07:10:00.000Z',
      changes: [
        { field: 'destinationBranch', old: 'الدقي (BM-9)', new: 'الزمالك (BM-12)' },
        { field: 'lines', old: 'مصري 1,200,000', new: 'مصري 1,200,000، دولار 50,000' },
        { field: 'notes', old: null, new: 'تسليم قبل الظهر' },
        // A field a newer server added: shown under its own key, never dropped.
        { field: 'fuelLevel' as never, old: '1', new: '2' },
      ],
    }),
    entry('a3', {
      kind: 'crewAssigned',
      leg: 'pickup',
      changes: [
        { field: 'captain', old: null, new: 'محمود حسن عبد الله' },
        { field: 'vehicle', old: null, new: '207' },
      ],
    }),
    entry('a4', {
      kind: 'executionDelivered',
      leg: 'pickup',
      actorName: 'محمود حسن عبد الله',
      at: '2026-11-11T10:15:00.000Z',
    }),
    entry('a5', { kind: 'received', at: '2026-11-11T10:40:00.000Z' }),
    entry('a6', { kind: 'receiptImageAdded', actorName: null, at: '2026-11-11T22:20:00.000Z' }),
  ],
};

const timeline = (log: OperationsShipmentLogDto): string =>
  render(
    <ShipmentLogTimeline log={log} loading={false} failed={false} onRetry={() => undefined} />,
  );

/** One entry's markup, from its `<li>` to the next. */
const entryOf = (html: string, kind: string): string => {
  const start = html.indexOf(`data-log-entry="${kind}"`);
  const next = html.indexOf('data-log-entry=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

describe('the log — a story told oldest first', () => {
  const html = timeline(STORY);

  it('lists every entry in the server’s order, each in its own sentence', () => {
    const order = [...html.matchAll(/data-log-entry="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      'created',
      'edited',
      'crewAssigned',
      'executionDelivered',
      'received',
      'receiptImageAdded',
    ]);
    expect(entryOf(html, 'created')).toContain('أُنشئت الشحنة');
    expect(entryOf(html, 'edited')).toContain('عُدّلت الشحنة');
    expect(entryOf(html, 'crewAssigned')).toContain('عُيّن الطاقم');
    expect(entryOf(html, 'executionDelivered')).toContain('سلّمها قائد الطاقم');
    expect(entryOf(html, 'received')).toContain('أكّد المكتب التسليم');
    expect(entryOf(html, 'receiptImageAdded')).toContain('رُفعت صورة الإيصال');
  });

  it('draws each kind’s tile in its colour — the captain’s yellow, the desk’s green', () => {
    expect(entryOf(html, 'executionDelivered')).toContain('bg-amber-500/15');
    expect(entryOf(html, 'received')).toContain('bg-emerald-500/15');
    expect(entryOf(html, 'edited')).toContain('bg-blue-500/15');
  });

  it('says who — the name the audit kept, or «غير مسجَّل» when it kept none', () => {
    expect(entryOf(html, 'edited')).toContain('منى عبد الرحمن');
    expect(entryOf(html, 'executionDelivered')).toContain('محمود حسن عبد الله');
    // A null name is a row with no actor snapshot (a lookup that found nobody, a row with no
    // actor) — the platform's audit screen words it «غير مسجَّل», and so does the log. Never
    // «النظام»: that would credit the system with an act a person may have done.
    expect(entryOf(html, 'receiptImageAdded')).toMatch(/data-log-actor="true"[^>]*>.*غير مسجَّل/);
    expect(entryOf(html, 'receiptImageAdded')).not.toContain('النظام');
    expect(ar('operations.shipment.log.actorUnknown')).toBe(ar('systemAdmin.audit.actorUnknown'));
  });

  it('says when on the desk’s clock — the Cairo day and hour, Latin digits', () => {
    expect(entryOf(html, 'created')).toMatch(
      /<time[^>]*dir="ltr"[^>]*>2026-11-11 <span[^>]*>08:05</,
    );
    // 22:20Z is past midnight in Cairo: the next day.
    expect(entryOf(html, 'receiptImageAdded')).toContain('2026-11-12 <span');
    expect(entryOf(html, 'receiptImageAdded')).toContain('>00:20<');
  });

  it('names the run a crew or a captain entry is about', () => {
    expect(entryOf(html, 'crewAssigned')).toContain(`data-log-leg="pickup"`);
    expect(entryOf(html, 'crewAssigned')).toContain(ar('operations.shipment.log.leg.pickup'));
    expect(entryOf(html, 'received')).not.toContain('data-log-leg');
  });
});

describe('«اللى يتعدل يظهر ف السجل» — what an edit changed, field by field', () => {
  const html = timeline(STORY);
  const edit = entryOf(html, 'edited');

  it('puts each field under its Arabic label, the old value struck, then the new one', () => {
    expect(edit).toMatch(
      new RegExp(`<dt class="[^"]*">${ar('operations.shipment.log.field.destinationBranch')}</dt>`),
    );
    const destination = edit.slice(edit.indexOf('data-log-field="destinationBranch"'));
    expect(destination).toMatch(
      /data-log-old="true" class="[^"]*line-through[^"]*">الدقي \(BM-9\)</,
    );
    expect(destination).toMatch(/data-log-new="true"[^>]*>الزمالك \(BM-12\)</);
    // Old before new, an arrow between them that a screen reader reads as a word.
    expect(destination.indexOf('data-log-old')).toBeLessThan(destination.indexOf('data-log-new'));
    expect(destination).toContain(
      `<span class="sr-only">${ar('operations.shipment.log.becomes')}</span>`,
    );
    expect(edit).toContain(ar('operations.shipment.log.field.lines'));
    expect(edit).toContain('مصري 1,200,000، دولار 50,000');
  });

  it('says a field that was empty as the dash', () => {
    const notes = edit.slice(edit.indexOf('data-log-field="notes"'));
    expect(notes).toMatch(/data-log-old="true"[^>]*>—</);
    expect(notes).toMatch(/data-log-new="true"[^>]*>تسليم قبل الظهر</);
  });

  it('shows a field it does not know under its own key, rather than dropping it', () => {
    expect(edit).toContain('>fuelLevel</dt>');
  });

  it('lists a booking’s first values plainly — no «— ←» on every line', () => {
    const created = entryOf(html, 'created');
    expect(created).toContain(ar('operations.shipment.log.field.mainBank'));
    expect(created).toMatch(/data-log-new="true"[^>]*>الأهلي</);
    expect(created).not.toContain('data-log-old');
    // …and so does a first crew: nobody was there before.
    expect(entryOf(html, 'crewAssigned')).not.toContain('data-log-old');
    expect(entryOf(html, 'crewAssigned')).toMatch(/data-log-new="true"[^>]*>207</);
    // A flag reads yes / no.
    expect(created).toMatch(/data-log-field="serialTracked"[\s\S]*?data-log-new="true"[^>]*>لا</);
  });

  it('leaves an entry with nothing to list without an empty list', () => {
    expect(entryOf(html, 'received')).not.toContain('data-log-changes');
  });
});

describe('the lines in the timeline’s place', () => {
  it('says the oldest were left out, at the top where they would be', () => {
    const html = timeline({ ...STORY, truncated: true });
    expect(html).toContain('data-shipment-log-truncated="true"');
    expect(html).toContain(
      ar('operations.shipment.log.truncated', {
        max: formatNumber(OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES, 'ar'),
      }),
    );
    expect(html.indexOf('data-shipment-log-truncated')).toBeLessThan(
      html.indexOf('data-log-entry'),
    );
    expect(timeline(STORY)).not.toContain('data-shipment-log-truncated');
  });

  it('says there is nothing yet, rather than an empty frame', () => {
    const html = timeline({ ...STORY, entries: [] });
    expect(html).toContain(ar('operations.shipment.log.empty'));
    expect(html).not.toContain('data-shipment-log="true"');
  });

  it('says it is loading', () => {
    const html = render(
      <ShipmentLogTimeline log={undefined} loading failed={false} onRetry={() => undefined} />,
    );
    expect(html).toContain(ar('common.loading'));
    expect(html).toContain('animate-spin');
  });

  it('says a failed read failed — never «nothing recorded», which would be a claim — and offers a retry', () => {
    const html = render(
      <ShipmentLogTimeline log={undefined} loading={false} failed onRetry={() => undefined} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(ar('operations.shipment.log.loadFailed'));
    expect(html).toContain(ar('common.retry'));
    expect(html).not.toContain(ar('operations.shipment.log.empty'));
  });
});

describe('the dialog', () => {
  it('is titled «سجل الشحنة», names the shipment under it, and shows its log', () => {
    const qc = new QueryClient();
    qc.setQueryData(__shipmentLogKey('s-1'), STORY);
    const html = render(
      <ShipmentLogDialog
        target={{ id: 's-1', caption: 'الأهلي · المعادي ← الزمالك · 2026-11-11' }}
        onClose={() => undefined}
      />,
      qc,
    );
    expect(html).toContain('data-shipment-log-dialog="s-1"');
    expect(html).toContain(`aria-label="${ar('operations.shipment.log.title')}"`);
    expect(html).toContain('الأهلي · المعادي ← الزمالك · 2026-11-11');
    expect(html).toContain('data-log-entry="received"');
  });

  it('renders nothing while closed', () => {
    expect(render(<ShipmentLogDialog target={null} onClose={() => undefined} />)).toBe('');
  });
});

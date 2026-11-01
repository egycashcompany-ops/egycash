// «لوحة تحكم الحركة» — freshness with no server cache (plan §5.6, D15): the Cairo-midnight timer, the
// liveness segment of R2's key, the «آخر تحديث قبل N ثانية» words, and the address bar's filter state.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import {
  NOW_INTERVAL_MS,
  NOW_STALE_MS,
  PERIOD_STALE_MS,
  freshness,
  msUntilCairoMidnight,
  periodLiveness,
} from './lib/fleet-dashboard-refresh';
import {
  customRangeValid,
  periodFiltersPatch,
  readPeriodFilters,
  readTab,
  toPeriodQuery,
} from './lib/fleet-dashboard-url';
import { RefreshTools } from './components/fleet-dashboard/dash-shell';
import { ar } from './fleet-dashboard-fixtures';

const HOUR = 60 * 60 * 1000;

describe('R1 turns over at the next Cairo midnight, on the server’s clock', () => {
  it('waits until Cairo’s next day begins (EET, UTC+2, after the October change)', () => {
    // 2026-11-01 08:00Z is 10:00 in Cairo: midnight is 22:00Z, 14 hours away.
    const asOf = '2026-11-01T08:00:00.000Z';
    expect(msUntilCairoMidnight(asOf, 1_000, 1_000)).toBe(14 * HOUR);
  });

  it('counts the time the answer has already spent in the browser', () => {
    const asOf = '2026-11-01T08:00:00.000Z';
    expect(msUntilCairoMidnight(asOf, 1_000, 1_000 + 2 * HOUR)).toBe(12 * HOUR);
  });

  it('is the next Cairo day at 2026-10-31T23:30Z — already 1 November in Cairo', () => {
    // 23:30Z is 01:30 in Cairo on 1 November: the next midnight is 1 November 22:00Z.
    expect(msUntilCairoMidnight('2026-10-31T23:30:00.000Z', 0, 0)).toBe(22.5 * HOUR);
  });

  it('follows summer time (EEST, UTC+3) before the change', () => {
    // 2026-10-20 12:00Z is 15:00 in Cairo; midnight is 21:00Z, 9 hours away.
    expect(msUntilCairoMidnight('2026-10-20T12:00:00.000Z', 0, 0)).toBe(9 * HOUR);
  });

  it('never fires at once, even when the browser held the answer past midnight', () => {
    expect(msUntilCairoMidnight('2026-11-01T08:00:00.000Z', 0, 20 * HOUR)).toBe(1_000);
    expect(msUntilCairoMidnight('not a date', 0, 0)).toBe(1_000);
  });

  it('keeps R1 fresh for a minute and re-reads it every five; R2 five minutes', () => {
    expect([NOW_STALE_MS, NOW_INTERVAL_MS, PERIOD_STALE_MS]).toEqual([60_000, 300_000, 300_000]);
  });
});

describe('R2’s liveness segment', () => {
  it('is `past` for last month and for a custom range ended before today; `live` otherwise', () => {
    expect(periodLiveness({ preset: 'lastMonth' }, '2026-11-01')).toBe('past');
    expect(
      periodLiveness({ preset: 'custom', from: '2026-09-01', to: '2026-10-31' }, '2026-11-01'),
    ).toBe('past');
    expect(
      periodLiveness({ preset: 'custom', from: '2026-10-01', to: '2026-11-01' }, '2026-11-01'),
    ).toBe('live');
    expect(periodLiveness({ preset: 'thisMonth' }, '2026-11-01')).toBe('live');
    // Before R1 has echoed today, a range that might include it is never treated as closed.
    expect(
      periodLiveness({ preset: 'custom', from: '2026-09-01', to: '2026-10-31' }, undefined),
    ).toBe('live');
  });
});

describe('«آخر تحديث قبل N ثانية»', () => {
  const store = (locale: Locale = 'ar') =>
    configureStore({
      reducer: { locale: localeSlice.reducer },
      preloadedState: { locale: { locale, dir: 'rtl' as const } },
    });
  const render = (updatedAt: number, clock: number): string =>
    renderToStaticMarkup(
      createElement(Provider, {
        store: store(),
        children: createElement(RefreshTools, { updatedAt, onRefresh: () => undefined, clock }),
      }),
    );

  it('says how long ago the answer came, in seconds, then minutes', () => {
    expect(freshness(0, 5_000)).toBeNull();
    expect(freshness(1_000, 3_000)).toEqual({ unit: 'now' });
    expect(freshness(1_000, 13_000)).toEqual({ unit: 'seconds', n: 12 });
    expect(freshness(1_000, 1_000 + 3 * 60_000 + 5_000)).toEqual({ unit: 'minutes', n: 3 });
  });

  it('writes it in words, beside the «تحديث» button', () => {
    const html = render(1_000, 13_000);
    expect(html.replace(/<[^>]+>/gu, '')).toContain('آخر تحديث قبل 12 ثانية');
    expect(html).toContain('data-dash-refresh="true"');
    expect(html).toContain(ar('fleet.dash.shell.refresh'));
    expect(render(1_000, 2_000)).toContain(ar('fleet.dash.shell.updatedNow'));
    expect(render(0, 2_000)).not.toContain('data-dash-updated');
  });
});

describe('the address bar is the filter state (D14)', () => {
  const sp = (query: string): URLSearchParams => new URLSearchParams(query);

  it('reads the default period and empty lists from a clean address', () => {
    expect(readPeriodFilters(sp(''))).toEqual({
      preset: 'thisMonth',
      from: '',
      to: '',
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
    });
  });

  it('reads every filter, and the dates only with `custom`', () => {
    expect(
      readPeriodFilters(
        sp('period=custom&from=2026-10-01&to=2026-10-15&type=a,b&operation=o&vehicleCodes=133,207'),
      ),
    ).toEqual({
      preset: 'custom',
      from: '2026-10-01',
      to: '2026-10-15',
      typeIds: ['a', 'b'],
      operationIds: ['o'],
      vehicleCodes: ['133', '207'],
    });
    expect(readPeriodFilters(sp('period=lastMonth&from=2026-10-01')).from).toBe('');
    expect(readPeriodFilters(sp('period=nonsense')).preset).toBe('thisMonth');
  });

  it('writes a patch that names every filter, so a cleared one leaves the address', () => {
    expect(
      periodFiltersPatch({
        preset: 'thisMonth',
        from: '',
        to: '',
        typeIds: [],
        operationIds: [],
        vehicleCodes: [],
      }),
    ).toEqual({
      period: null,
      from: null,
      to: null,
      type: null,
      operation: null,
      vehicleCodes: null,
    });
    expect(
      periodFiltersPatch({
        preset: 'custom',
        from: '2026-10-01',
        to: '2026-10-15',
        typeIds: ['a'],
        operationIds: [],
        vehicleCodes: ['133'],
      }),
    ).toEqual({
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-15',
      type: 'a',
      operation: null,
      vehicleCodes: '133',
    });
    expect(Object.keys(periodFiltersPatch(readPeriodFilters(sp(''))))).not.toContain('tab');
  });

  it('asks R2 for the default period rather than an error when a custom range is not one', () => {
    const base = { typeIds: [], operationIds: [], vehicleCodes: [] };
    expect(
      toPeriodQuery({ ...base, preset: 'custom', from: '2026-10-01', to: '2026-10-15' }),
    ).toEqual({
      preset: 'custom',
      from: '2026-10-01',
      to: '2026-10-15',
    });
    expect(
      toPeriodQuery({ ...base, preset: 'custom', from: '2026-10-15', to: '2026-10-01' }),
    ).toEqual({ preset: 'thisMonth' });
    expect(toPeriodQuery({ ...base, preset: 'custom', from: '2026-10-01', to: '' })).toEqual({
      preset: 'thisMonth',
    });
    expect(customRangeValid('2025-11-01', '2026-11-01')).toBe(true); // 366 days
    expect(customRangeValid('2025-10-31', '2026-11-01')).toBe(false); // 367 days
    expect(
      toPeriodQuery({ ...base, preset: 'lastMonth', from: 'x', to: 'y', typeIds: ['t'] }),
    ).toEqual({
      preset: 'lastMonth',
      typeIds: ['t'],
    });
  });

  it('falls back to the first visible tab for a hidden or an unknown one', () => {
    expect(readTab('km', ['alerts', 'now', 'km'])).toBe('km');
    expect(readTab('km', ['alerts', 'now'])).toBe('alerts');
    expect(readTab('nonsense', ['now', 'licences'])).toBe('now');
    expect(readTab(null, ['distribution'])).toBe('distribution');
  });
});

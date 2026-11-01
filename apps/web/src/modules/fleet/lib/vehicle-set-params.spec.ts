// The dashboard's target-screen parameters, as one helper turns them into a request (plan §5.7,
// D10, R-02). Pure: what each page sends is proved by rendering it, in
// `fleet-dashboard-target-params.spec.tsx`.
import { describe, expect, it } from 'vitest';
import { calendarDayBounds, licenceWindows } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  CLEAR_VEHICLE_SET,
  expiryWindowLabel,
  expiryWindowQuery,
  hasVehicleSet,
  vehicleSetQuery,
} from './vehicle-set-params';

const NONE = { typeIds: [], operationIds: [], branchIds: [] };
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

describe('the vehicle set — type, operation and branch', () => {
  it('sends only the lists that hold something', () => {
    expect(vehicleSetQuery(NONE)).toEqual({});
    expect(Object.keys(vehicleSetQuery(NONE)), 'no key at all, not an undefined one').toEqual([]);
    expect(vehicleSetQuery({ ...NONE, typeIds: ['t1', 't2'] })).toEqual({ typeIds: ['t1', 't2'] });
    expect(vehicleSetQuery({ typeIds: ['t1'], operationIds: ['o1'], branchIds: ['b1'] })).toEqual({
      typeIds: ['t1'],
      operationIds: ['o1'],
      branchIds: ['b1'],
    });
  });

  it('names the fields the list and summary schemas take (D10)', () => {
    const query = vehicleSetQuery({ typeIds: ['t'], operationIds: ['o'], branchIds: ['b'] });
    expect(Object.keys(query).sort()).toEqual(['branchIds', 'operationIds', 'typeIds']);
  });

  it('hands the request copies, so nothing downstream can change the page’s lists', () => {
    const typeIds = ['t1'];
    const query = vehicleSetQuery({ ...NONE, typeIds });
    expect(query.typeIds).toEqual(typeIds);
    expect(query.typeIds).not.toBe(typeIds);
  });

  it('counts as a filter when any one of the three narrows', () => {
    expect(hasVehicleSet(NONE)).toBe(false);
    expect(hasVehicleSet({ ...NONE, typeIds: ['t'] })).toBe(true);
    expect(hasVehicleSet({ ...NONE, operationIds: ['o'] })).toBe(true);
    expect(hasVehicleSet({ ...NONE, branchIds: ['b'] })).toBe(true);
  });

  it('clears all three in one write, under the address bar’s names', () => {
    expect(CLEAR_VEHICLE_SET).toEqual({ type: null, operation: null, branch: null });
  });
});

describe('an expiry window named in days (R-02)', () => {
  it('asks for the FIRST instant of the first day and the LAST instant of the last', () => {
    expect(expiryWindowQuery('2026-11-02', '2026-12-01')).toEqual({
      from: '2026-11-02T00:00:00.000Z',
      before: '2026-12-01T23:59:59.999Z',
    });
  });

  it('is the contracts’ one rule — the bounds the dashboard counts with', () => {
    const bounds = calendarDayBounds('2026-11-02', '2026-12-01');
    expect(expiryWindowQuery('2026-11-02', '2026-12-01')).toEqual({
      from: bounds.from.toISOString(),
      before: bounds.before.toISOString(),
    });
  });

  it('keeps a document that expires TODAY in «expired», whatever time it was stamped at', () => {
    // Expired ON the expiry day (Q-02): `licExpBefore=<today>` must reach the end of today, or an
    // expiry imported at 10:00 would be in no bucket at all.
    const before = expiryWindowQuery('', '2026-11-01').before;
    expect(before).toBe('2026-11-01T23:59:59.999Z');
    expect(Date.parse('2026-11-01T10:00:00.000Z')).toBeLessThanOrEqual(Date.parse(before ?? ''));
    expect(Date.parse('2026-11-02T00:00:00.000Z')).toBeGreaterThan(Date.parse(before ?? ''));
  });

  it('leaves the windows the dashboard links to disjoint and gapless', () => {
    // Whatever instant a licence is stamped at, it falls in exactly one of them.
    const w = licenceWindows('2026-11-01', 30);
    const expired = expiryWindowQuery('', w.expired.to);
    const expiring = expiryWindowQuery(w.expiring.from, w.expiring.to);
    const soon = expiryWindowQuery(w.soon?.from ?? '', w.soon?.to ?? '');
    expect(Date.parse(expiring.from ?? '') - Date.parse(expired.before ?? '')).toBe(1);
    expect(Date.parse(soon.from ?? '') - Date.parse(expiring.before ?? '')).toBe(1);
  });

  it('leaves an open side open', () => {
    expect(expiryWindowQuery('', '')).toEqual({ from: undefined, before: undefined });
    expect(expiryWindowQuery('2026-11-02', '').before).toBeUndefined();
    expect(expiryWindowQuery('', '2026-11-02').from).toBeUndefined();
  });

  it('sends a value that is no real day as written, for the server to refuse', () => {
    // Dropping it would show an unfiltered list under an address bar that still names a window.
    expect(expiryWindowQuery('2026-02-30', 'soon')).toEqual({ from: '2026-02-30', before: 'soon' });
  });
});

describe('the window in words', () => {
  it('names both sides, either side, or nothing', () => {
    expect(expiryWindowLabel('2026-11-02', '2026-12-01', ar)).toBe('من 2026/11/02 إلى 2026/12/01');
    expect(expiryWindowLabel('', '2026-11-01', ar)).toBe('حتى 2026/11/01');
    expect(expiryWindowLabel('2026-11-02', '', ar)).toBe('من 2026/11/02');
    expect(expiryWindowLabel('', '', ar)).toBeNull();
  });

  it('has its words in both languages', () => {
    for (const key of ['between', 'until', 'from']) {
      for (const locale of ['ar', 'en'] as const) {
        const full = `fleet.filters.expiryWindow.${key}`;
        expect(translate(locale, full), `${locale} ${full}`).not.toBe(full);
      }
    }
  });
});

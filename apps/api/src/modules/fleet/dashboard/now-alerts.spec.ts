// Tab 1's lines are DERIVED from the section values (plan §5.2) — no line has a query of its own.
//
// Pinned: the display order is `FLEET_DASHBOARD_ALERTS` (red before orange); a line fires only above
// zero; a section the reader may not see (null) has no line; each line's count is exactly one field
// its section already carries — T1.10 the union (never the two parts added), T1.12 the stale cars
// (never the never-read ones mixed in), T1.6 the absence gaps only.
import { FLEET_DASHBOARD_ALERTS } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { deriveNowAlerts, type AlertSources } from './now-alerts';

const NONE: AlertSources = {
  maintenanceAlarm: null,
  licenceVehicles: null,
  licenceDrivers: null,
  fuelCards: null,
  roster: null,
  fuelCharging: null,
  dealershipPending: null,
  notices: null,
  noReading: null,
};

const FULL: AlertSources = {
  maintenanceAlarm: { red: 3, overdue: 1, yellow: 6, codes: null },
  licenceVehicles: {
    warnDays: 30,
    expired: 2,
    expiring: 4,
    soon: 1,
    outOfServiceExpired: 1,
    list: [],
    more: 0,
  },
  licenceDrivers: {
    warnDays: 30,
    expired: 1,
    expiring: 0,
    soon: 0,
    notRecorded: 2,
    unregistered: 1,
  },
  fuelCards: { warnDays: 30, expired: 1, expiring: 3 },
  roster: {
    date: '2026-11-01',
    licenceRule: 'flag',
    rows: 10,
    ready: 8,
    inWorkshop: 1,
    licenceExpired: 1,
    readyManned: 6,
    unmanned: 2,
    unmannedCrewGap: 1,
    unmannedStalePlan: 0,
    unmannedNoCrew: 1,
    crewGap: { vehicles: 2, otherReasons: 5, covered: 4, stalePlan: 3 },
    registry: 0,
    available: 0,
    availableWithoutVehicle: 0,
    availableLicenceNotRecorded: 0,
    availableNoProfile: 0,
    absent: { attendance: 0, leave: 0 },
    profileInactive: 0,
    notEmployed: 0,
    licenceExpiredDrivers: 0,
  },
  fuelCharging: {
    wataniya: 0,
    chillout: 0,
    requested: { count: 4, amount: 900 },
    low: { belowYellow: 3, belowRed: 1, yellowAt: 300, redAt: 100 },
    charged24h: 0,
  },
  dealershipPending: { rows: 3 },
  notices: { open: 9, missingAny: 3, missingLicences: 2, missingCheckImage: 2 },
  noReading: {
    days: 3,
    stale: [
      { vehicleId: 'a', code: '304', lastDate: '2026-10-28' },
      { vehicleId: 'b', code: '112', lastDate: '2026-10-22' },
    ],
    neverRead: [{ vehicleId: 'c', code: '318' }],
  },
};

describe('deriveNowAlerts', () => {
  it('every line, in the contracts order, red first, each from its one section field', () => {
    expect(deriveNowAlerts(FULL)).toEqual([
      { id: 'maintenanceRed', level: 'red', count: 3 },
      { id: 'vehicleLicenceExpired', level: 'red', count: 2 },
      { id: 'driverLicenceExpired', level: 'red', count: 1 },
      { id: 'fuelCardExpired', level: 'red', count: 1 },
      { id: 'crewAbsent', level: 'orange', count: 2 },
      { id: 'fuelRequests', level: 'orange', count: 4 },
      { id: 'fuelLow', level: 'orange', count: 3 },
      { id: 'dealershipPending', level: 'orange', count: 3 },
      { id: 'noticesMissing', level: 'orange', count: 3 },
      { id: 'noReading', level: 'orange', count: 2 },
    ]);
    expect(deriveNowAlerts(FULL).map((a) => a.id)).toEqual(FLEET_DASHBOARD_ALERTS.map((a) => a.id));
  });

  it('no section, no line — and never a zero line', () => {
    expect(deriveNowAlerts(NONE)).toEqual([]);
    const quiet: AlertSources = {
      ...FULL,
      maintenanceAlarm: { red: 0, overdue: 0, yellow: 6, codes: null },
      notices: { open: 9, missingAny: 0, missingLicences: 0, missingCheckImage: 0 },
      noReading: { days: 3, stale: [], neverRead: [{ vehicleId: 'c', code: '318' }] },
    };
    const ids = deriveNowAlerts(quiet).map((a) => a.id);
    expect(ids).not.toContain('maintenanceRed');
    expect(ids).not.toContain('noticesMissing');
    expect(ids).not.toContain('noReading');
  });

  it('T1.10 is the union, not the two parts added; T1.6 is the absence gaps only', () => {
    const lines = deriveNowAlerts(FULL);
    expect(lines.find((a) => a.id === 'noticesMissing')?.count).toBe(3);
    expect(lines.find((a) => a.id === 'crewAbsent')?.count).toBe(2);
  });

  it('a hidden section takes only its own lines with it (fuelCharging carries two)', () => {
    const ids = deriveNowAlerts({ ...FULL, fuelCharging: null }).map((a) => a.id);
    expect(ids).not.toContain('fuelRequests');
    expect(ids).not.toContain('fuelLow');
    expect(ids).toContain('fuelCardExpired');
  });
});

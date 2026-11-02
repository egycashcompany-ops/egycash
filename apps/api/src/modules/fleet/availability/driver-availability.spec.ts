// The availability seam's licence check (R-04, Q-01): a flag while the organisation's rule is off,
// a refusal once it is on, and never ahead of the seam's own reasons.
//
// Driven through the seam's real code with its data seams stubbed — the org chart, the profiles,
// the التمامات overlay, HR and the settings. What is under test is the RULE: which answer a driver
// gets, in which order, and that the single-driver seam and the board's batched pass give the same
// answer for the same person on the same day.
import { FleetSettingKeys } from '@ecms/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DAY = new Date('2026-11-20T00:00:00.000Z');

/** The cast: each id names what makes them interesting. */
const VALID = '64b1f0abcdefabcdefab0001';
const EXPIRED = '64b1f0abcdefabcdefab0002';
const EXPIRES_TODAY = '64b1f0abcdefabcdefab0003';
const STAMPED_LATER_TODAY = '64b1f0abcdefabcdefab0004';
const NO_DATE = '64b1f0abcdefabcdefab0005';
const NO_PROFILE = '64b1f0abcdefabcdefab0006';
const ABSENT_AND_EXPIRED = '64b1f0abcdefabcdefab0007';
const ON_LEAVE_AND_EXPIRED = '64b1f0abcdefabcdefab0008';
const SWITCHED_OFF_AND_EXPIRED = '64b1f0abcdefabcdefab0009';
const SUSPENDED_AND_EXPIRED = '64b1f0abcdefabcdefab000a';
const OFFICE_CLERK = '64b1f0abcdefabcdefab000b';
const EXPIRES_TOMORROW = '64b1f0abcdefabcdefab000c';

const profile = (employeeId: string, licenseExpiresAt: string | null, isActive = true) => ({
  employeeId: { toString: () => employeeId },
  licenseExpiresAt: licenseExpiresAt === null ? null : new Date(licenseExpiresAt),
  isActive,
});

const PROFILES = new Map(
  [
    profile(VALID, '2027-06-30T00:00:00.000Z'),
    profile(EXPIRED, '2026-10-01T00:00:00.000Z'),
    profile(EXPIRES_TODAY, '2026-11-20T00:00:00.000Z'),
    // An import that kept the clock: still the 20th, so still expired on the 20th (R-02).
    profile(STAMPED_LATER_TODAY, '2026-11-20T10:00:00.000Z'),
    profile(EXPIRES_TOMORROW, '2026-11-21T00:00:00.000Z'),
    profile(NO_DATE, null),
    profile(ABSENT_AND_EXPIRED, '2026-10-01T00:00:00.000Z'),
    profile(ON_LEAVE_AND_EXPIRED, '2026-10-01T00:00:00.000Z'),
    profile(SWITCHED_OFF_AND_EXPIRED, '2026-10-01T00:00:00.000Z', false),
    profile(SUSPENDED_AND_EXPIRED, '2026-10-01T00:00:00.000Z'),
  ].map((doc) => [doc.employeeId.toString(), doc]),
);

const SEATED = [
  VALID,
  EXPIRED,
  EXPIRES_TODAY,
  STAMPED_LATER_TODAY,
  EXPIRES_TOMORROW,
  NO_DATE,
  NO_PROFILE,
  ABSENT_AND_EXPIRED,
  ON_LEAVE_AND_EXPIRED,
  SWITCHED_OFF_AND_EXPIRED,
  SUSPENDED_AND_EXPIRED,
];
const statusOf = (id: string): string => (id === SUSPENDED_AND_EXPIRED ? 'suspended' : 'active');
const COVERED = new Set([ABSENT_AND_EXPIRED]);
const ON_LEAVE = new Set([ON_LEAVE_AND_EXPIRED]);

const settings = new Map<string, unknown>();
const resolve = vi.fn(async (key: string) => settings.get(key));

vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: (key: string) => resolve(key) },
}));
vi.mock('../../../platform/directory', () => ({
  getDirectoryEmployee: vi.fn(async (id: string) => ({ id, status: statusOf(id) })),
  isOnApprovedLeave: vi.fn(async (id: string) => ON_LEAVE.has(id)),
  approvedLeaveEmployeeIds: vi.fn(
    async (ids: readonly string[]) => new Set(ids.filter((id) => ON_LEAVE.has(id))),
  ),
}));
vi.mock('../driver-profiles/driver-profile.repository', () => ({
  fleetDriverProfileRepository: {
    findDriverByEmployeeId: vi.fn(async (id: string) => PROFILES.get(id) ?? null),
    findForEmployeesSystem: vi.fn(async (ids: readonly string[]) =>
      ids.flatMap((id) => (PROFILES.has(id) ? [PROFILES.get(id)] : [])),
    ),
  },
}));
vi.mock('../driver-profiles/driving-seat-roster', () => ({
  drivingSeatEmployeeIds: vi.fn(async () => SEATED),
}));
vi.mock('./unavailability.repository', () => ({
  fleetUnavailabilityRepository: {
    existsCovering: vi.fn(async (id: string) => COVERED.has(id)),
    coveredOn: vi.fn(
      async (ids: readonly string[]) => new Set(ids.filter((id) => COVERED.has(id))),
    ),
  },
}));

const { driverAvailabilityForRoster, driverAvailabilityOn, rosterLicenceRule } =
  await import('./driver-availability');

const refuse = (on: boolean): void => {
  settings.set(FleetSettingKeys.RosterRefuseExpiredLicence, on);
};

const roster = SEATED.map((employeeId) => ({ employeeId, status: statusOf(employeeId) }));

beforeEach(() => {
  resolve.mockClear();
  settings.clear();
  settings.set(FleetSettingKeys.UseHrLeave, true);
  refuse(false);
});

describe('the rule itself — fleet.roster.refuseExpiredLicence', () => {
  it('is «flag» while the setting is off (its default) and «refuse» once it is on', async () => {
    expect(await rosterLicenceRule()).toBe('flag');
    refuse(true);
    expect(await rosterLicenceRule()).toBe('refuse');
  });
});

describe('setting OFF — an expired licence is a FLAG, nothing more', () => {
  it('keeps the driver available, with the licence flagged', async () => {
    expect(await driverAvailabilityOn(EXPIRED, DAY)).toEqual({
      available: true,
      reason: null,
      licence: 'expired',
    });
  });

  it('reports a valid licence as valid', async () => {
    expect(await driverAvailabilityOn(VALID, DAY)).toEqual({
      available: true,
      reason: null,
      licence: 'valid',
    });
  });
});

describe('setting ON — an expired licence REFUSES, with the reason named', () => {
  it('answers licenceExpired', async () => {
    refuse(true);
    expect(await driverAvailabilityOn(EXPIRED, DAY)).toEqual({
      available: false,
      reason: 'licenceExpired',
      licence: 'expired',
    });
  });

  it('counts the expiry DAY as expired (Q-02), and the day before as not', async () => {
    refuse(true);
    expect((await driverAvailabilityOn(EXPIRES_TODAY, DAY)).reason).toBe('licenceExpired');
    expect(
      await driverAvailabilityOn(EXPIRES_TODAY, new Date('2026-11-19T00:00:00.000Z')),
      'the day before its expiry the licence is still good',
    ).toEqual({ available: true, reason: null, licence: 'valid' });
    expect((await driverAvailabilityOn(EXPIRES_TOMORROW, DAY)).licence).toBe('valid');
  });

  it('reads the expiry as a DATE — an instant later on the expiry day is that day', async () => {
    refuse(true);
    expect((await driverAvailabilityOn(STAMPED_LATER_TODAY, DAY)).reason).toBe('licenceExpired');
  });

  it('never blocks on a missing date, or on nobody having recorded a profile', async () => {
    refuse(true);
    expect(await driverAvailabilityOn(NO_DATE, DAY)).toEqual({
      available: true,
      reason: null,
      licence: 'notRecorded',
    });
    expect(await driverAvailabilityOn(NO_PROFILE, DAY)).toEqual({
      available: true,
      reason: null,
      licence: 'noProfile',
    });
  });
});

describe('precedence — the licence is checked LAST, so every driver has one reason', () => {
  it.each([
    [ABSENT_AND_EXPIRED, 'fleetUnavailability'],
    [ON_LEAVE_AND_EXPIRED, 'hrLeave'],
    [SWITCHED_OFF_AND_EXPIRED, 'profileInactive'],
    [SUSPENDED_AND_EXPIRED, 'notEmployed'],
  ])('%s keeps its earlier reason %s, with the licence still reported', async (id, reason) => {
    refuse(true);
    expect(await driverAvailabilityOn(id, DAY)).toEqual({
      available: false,
      reason,
      licence: 'expired',
    });
  });

  it('a non-driver is refused by the seat first, whatever their licence', async () => {
    refuse(true);
    expect(await driverAvailabilityOn(OFFICE_CLERK, DAY)).toEqual({
      available: false,
      reason: 'notADriver',
      licence: 'noProfile',
    });
  });
});

describe('the setting is read only when it can change an answer', () => {
  const ruleReads = (): number =>
    resolve.mock.calls.filter(([key]) => key === FleetSettingKeys.RosterRefuseExpiredLicence)
      .length;

  it('is not consulted for a driver whose licence is fine, or who is unavailable anyway', async () => {
    await driverAvailabilityOn(VALID, DAY);
    await driverAvailabilityOn(NO_DATE, DAY);
    await driverAvailabilityOn(ABSENT_AND_EXPIRED, DAY);
    expect(ruleReads()).toBe(0);
  });

  it('is taken from the caller when the caller has read it already', async () => {
    refuse(false);
    expect((await driverAvailabilityOn(EXPIRED, DAY, undefined, 'refuse')).reason).toBe(
      'licenceExpired',
    );
    expect(ruleReads()).toBe(0);
  });

  it('is read ONCE by the board’s batched pass, however many drivers it judges', async () => {
    await driverAvailabilityForRoster(roster, DAY);
    expect(ruleReads()).toBe(1);
    resolve.mockClear();
    await driverAvailabilityForRoster(roster, DAY, 'flag');
    expect(ruleReads(), 'and not at all when the board hands it in').toBe(0);
  });
});

describe('the board’s batched pass agrees with the seam, driver for driver', () => {
  it.each([false, true])('with the setting %s', async (on) => {
    refuse(on);
    const batch = await driverAvailabilityForRoster(roster, DAY);
    for (const employeeId of SEATED) {
      expect(batch.get(employeeId), employeeId).toEqual(
        await driverAvailabilityOn(employeeId, DAY),
      );
    }
  });

  it('flags while off and refuses while on — the same drivers either way', async () => {
    const flagged = await driverAvailabilityForRoster(roster, DAY, 'flag');
    const refused = await driverAvailabilityForRoster(roster, DAY, 'refuse');
    const expiredAvailable = [...flagged]
      .filter(([, v]) => v.available && v.licence === 'expired')
      .map(([id]) => id)
      .sort();
    const licenceRefused = [...refused]
      .filter(([, v]) => v.reason === 'licenceExpired')
      .map(([id]) => id)
      .sort();
    expect(expiredAvailable).toEqual([EXPIRED, EXPIRES_TODAY, STAMPED_LATER_TODAY].sort());
    expect(licenceRefused).toEqual(expiredAvailable);
  });
});

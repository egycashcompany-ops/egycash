// THE DEFAULTS THE OWNER RULED ON, pinned as defaults rather than left as values in a file.
//
// Every number here is a business decision he made on 18 November, and each one is a default value
// precisely because it must apply with nothing configured — this deployment has no per-branch
// overrides, so the shipped default IS the company rule. A change to one of these is a change to
// how 1,755 people's attendance is judged, and it should not be possible to make it by editing a
// literal without a test saying so out loud.
import { beforeEach, describe, expect, it } from 'vitest';
import { HrAttendanceSettingKeys, HrLeaveSettingKeys } from '@ecms/contracts';
import { clearSettingRegistry, listSettingDeclarations } from '../../../platform/settings/settings.registry';
import { registerHrAttendanceSettings } from './attendance.settings';
import { registerHrWorkCalendarSettings } from '../work-calendar/work-calendar.settings';

const defaults = (): Map<string, unknown> => {
  clearSettingRegistry();
  registerHrAttendanceSettings();
  registerHrWorkCalendarSettings();
  return new Map(listSettingDeclarations().map((d) => [d.key, d.defaultValue]));
};

describe('the company working day', () => {
  let shipped: Map<string, unknown>;
  beforeEach(() => {
    shipped = defaults();
  });

  it('is ON, nine to five, eight hours', () => {
    // «Set the company default working day to START at 09:00». It shipped inert for a day while
    // the owner weighed whether one company-wide hour was fair; the flexible rule is his answer,
    // and this is the switch that answer turns on.
    expect(shipped.get(HrAttendanceSettingKeys.DefaultPatternEnabled)).toBe(true);
    expect(shipped.get(HrAttendanceSettingKeys.DefaultPatternStartTime)).toBe('09:00');
    expect(shipped.get(HrAttendanceSettingKeys.DefaultPatternEndTime)).toBe('17:00');
  });

  it('has NO grace and NO break', () => {
    // «with no grace. Check-in at 09:00 or earlier = on time. 09:01 or later = late.» The fifteen
    // minutes this replaced were a guess made before anybody had ruled.
    expect(shipped.get(HrAttendanceSettingKeys.DefaultPatternGraceInMinutes)).toBe(0);
    expect(shipped.get(HrAttendanceSettingKeys.DefaultPatternGraceOutMinutes)).toBe(0);
    // No break, which is what makes the required day a flat 480 minutes against a flat worked
    // figure. A break here would silently lower the bar the eight-hour rule measures against.
    expect(shipped.get(HrAttendanceSettingKeys.DefaultPatternBreakMinutes)).toBe(0);
  });
});

describe('the two rulings that ship OFF', () => {
  it('does not call a working day with no scan an absence', () => {
    // «lateness only for now» — so such a day reads «لا يوجد تسجيل», nothing new reaches payroll's
    // absent-day count, and two years of history cannot mint absences for days whose scans may
    // still be in quarantine or behind a reader that was down.
    expect(defaults().get(HrAttendanceSettingKeys.CountAbsence)).toBe(false);
  });
});

describe('the re-tap threshold', () => {
  it('is ten minutes — above any re-tap and below any worked day', () => {
    // A finger that read poorly is presented again within seconds; no real working day is ten
    // minutes long. Both ends of the number matter, and this is the fix for the owner's five
    // «حاضر with zero worked minutes» rows.
    expect(defaults().get(HrAttendanceSettingKeys.MinPunchGapMinutes)).toBe(10);
  });
});

describe('the weekly rest', () => {
  it('is Friday and Saturday, in ISO weekday numbers', () => {
    // His answer to the question, and already the shipped default — nothing had to change, which
    // is worth a test rather than a shrug: the engine reads this to decide «يوم راحة», and without
    // it every Friday of the backfilled history would have become a day somebody failed to attend.
    expect(defaults().get(HrLeaveSettingKeys.WeekendDays)).toEqual([5, 6]);
  });
});

// A license's state is DERIVED, never stored (design §6: "no stored state").
//
// No database, no request — just a date, a clock and a warn window. That is the whole reason this
// file exists separately: the rule that decides whether a company is out of compliance is
// checkable in milliseconds, and a future edit that quietly moves the boundary fails here.
import { type ItLicenseState } from '@ecms/contracts';

export const DAY_MS = 86_400_000;

/**
 * `perpetual` when there is no end date · `expired` once the date has passed · `expiringSoon`
 * inside the warn window · `active` otherwise.
 *
 * `warnDays: 0` collapses the warn window to nothing, so a license goes straight from `active` to
 * `expired`. That is the honest way to express "we do not want warnings" — the same convention
 * `it.ticket.autoCloseDays: 0` already uses for "we do not auto-close".
 */
export const licenseState = (
  expiresAt: Date | null,
  warnDays: number,
  now: Date = new Date(),
): ItLicenseState => {
  if (expiresAt === null) return 'perpetual';
  if (expiresAt.getTime() <= now.getTime()) return 'expired';
  if (warnDays > 0 && expiresAt.getTime() <= now.getTime() + warnDays * DAY_MS) {
    return 'expiringSoon';
  }
  return 'active';
};

/**
 * Has this license issued more seats than it licenses?
 *
 * `seats: null` is unlimited and can never be exceeded. This is a REPORT, not a gate: FR-10 and
 * §13-Q5 both say a seat overrun warns and never blocks — a technician mid-install is the wrong
 * person to stop, and the compliance question belongs to whoever reads the licence screen.
 */
export const isOverSeats = (seats: number | null, seatsUsed: number): boolean =>
  seats !== null && seatsUsed > seats;

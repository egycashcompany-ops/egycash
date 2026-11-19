// «الطقم الثابت» — a refused «حفظ», said in the reader's words.
//
// The save is refused by the server, and its message is English and names an internal id («driver
// 65… already belongs to the fixed crew of vehicle 214»). That message is for the logs. What the
// reader is shown is built HERE from the refusal's DETAILS — plain facts the server adds beside its
// message: the employee id of the driver concerned, the car's CODE (only when the caller may read
// that car), the mission type id. The driver's NAME comes from the people list the screen already
// holds (`nameOf`), under the grant that gates every name on the screen; with no name in reach the
// sentence says «أحد السائقين» instead. So the line is Arabic, it names the driver and the holding
// car, and it never carries an id or the server's English.
//
// The detail codes are string literals, the SAME ones the server writes
// (`apps/api/src/modules/fleet/fixed-roster/fixed-roster.service.ts`, `FIXED_CREW_REFUSAL`), and
// both sides pin them in their specs: no contract field carries them.
//
// Order: a recognised detail → its own sentence; else a refusal of the payload (400 / 409, the
// stale-document 409 aside) → the generic «تعديلاتك باقية — راجع السيارات المعدَّلة…»; else the
// app's friendly line for the failure (`errorMessage`: stale, forbidden, network …) — and when that
// line is only the server's own message (a code the app has no words for), the generic one instead.
//
// The line is the REASON: the model toasts it as the description under the title «تعذّر حفظ الطقم
// الثابت» (`fleet.fixedRoster.refusal.title`). The toast draws its title on one line and cuts what
// does not fit, while the description wraps — so the holding car's code is never cut off.
import { type Locale } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';

/** The server's detail codes — literally the server's (`FIXED_CREW_REFUSAL`). */
export const FIXED_REFUSAL = {
  held: 'FIXED_CREW_DRIVER_HELD',
  holder: 'FIXED_CREW_HOLDER',
  vehicleNotActive: 'FIXED_CREW_VEHICLE_NOT_ACTIVE',
  profileInactive: 'FIXED_CREW_PROFILE_INACTIVE',
  notADriver: 'FIXED_CREW_NOT_A_DRIVER',
  missionInactive: 'FIXED_CREW_MISSION_INACTIVE',
  needsFirst: 'DRIVER2_WITHOUT_DRIVER1',
} as const;

export interface RefusalWords {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: Locale;
  /** The driver's name from the screen's own people list, or null when it is out of reach. */
  nameOf: (employeeId: string) => string | null;
}

/** An internal id (24 hex) is never a word on screen — a detail carrying one says nothing here. */
const INTERNAL_ID = /^[0-9a-f]{24}$/iu;

/** A detail's value as something the line may print: a car's code, never an id, never blank. */
const printable = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || INTERNAL_ID.test(trimmed) ? null : trimmed;
};

/** The refusal's details (an `ApiError` carries them; nothing else does). */
const detailsOf = (error: unknown): { code: string; message: string }[] =>
  error instanceof ApiError ? (error.details ?? []) : [];

/** A refusal of the PAYLOAD — what the server answers a save it will not store. */
const refusesPayload = (error: ApiError): boolean =>
  error.code === 'VALIDATION_FAILED' ||
  error.code === 'DUPLICATE' ||
  ((error.status === 400 || error.status === 409) && error.code !== 'STALE_DOCUMENT');

export const fixedSaveRefusal = (error: unknown, words: RefusalWords): string => {
  const { t, locale, nameOf } = words;
  const details = detailsOf(error);
  const find = (code: string): { code: string; message: string } | undefined =>
    details.find((detail) => detail.code === code);
  /** The driver a detail names, by name — null when the screen has no name for him. */
  const driver = (detail: { message: string }): string | null => {
    const id = detail.message.trim();
    const name = id === '' ? null : nameOf(id);
    return name === null || name.trim() === '' ? null : name;
  };
  const generic = t('fleet.fixedRoster.refusal.generic');

  const held = find(FIXED_REFUSAL.held);
  if (held !== undefined) {
    const name = driver(held);
    const code = printable(find(FIXED_REFUSAL.holder)?.message);
    if (code !== null) {
      return name === null
        ? t('fleet.fixedRoster.refusal.heldUnnamed', { code })
        : t('fleet.fixedRoster.refusal.held', { name, code });
    }
    return name === null
      ? t('fleet.fixedRoster.refusal.heldElsewhereUnnamed')
      : t('fleet.fixedRoster.refusal.heldElsewhere', { name });
  }

  const inactiveCar = find(FIXED_REFUSAL.vehicleNotActive);
  if (inactiveCar !== undefined) {
    const code = printable(inactiveCar.message);
    return code === null ? generic : t('fleet.fixedRoster.refusal.vehicleNotActive', { code });
  }

  const switchedOff = find(FIXED_REFUSAL.profileInactive);
  if (switchedOff !== undefined) {
    const name = driver(switchedOff);
    return name === null
      ? t('fleet.fixedRoster.refusal.profileInactiveUnnamed')
      : t('fleet.fixedRoster.refusal.profileInactive', { name });
  }

  const notADriver = find(FIXED_REFUSAL.notADriver);
  if (notADriver !== undefined) {
    const name = driver(notADriver);
    return name === null
      ? t('fleet.fixedRoster.refusal.notADriverUnnamed')
      : t('fleet.fixedRoster.refusal.notADriver', { name });
  }

  if (find(FIXED_REFUSAL.missionInactive) !== undefined)
    return t('fleet.fixedRoster.refusal.missionInactive');
  if (find(FIXED_REFUSAL.needsFirst) !== undefined)
    return t('fleet.fixedRoster.refusal.needsFirst');

  if (error instanceof ApiError) {
    if (refusesPayload(error)) return generic;
    const friendly = errorMessage(error, locale);
    // The server's own message is English — the app had no words for this code.
    return friendly === error.message ? generic : friendly;
  }
  // A dropped connection says so; anything else thrown on the way is not the reader's to read.
  return error instanceof TypeError ? errorMessage(error, locale) : generic;
};

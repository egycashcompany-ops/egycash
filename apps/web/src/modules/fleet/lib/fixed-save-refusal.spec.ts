// «الطقم الثابت» — a refused «حفظ» in the reader's words (told item 16, as built).
//
// The server's message is English and names an internal id; the line on screen is built from the
// refusal's DETAILS: the driver by NAME (from the screen's own people list), the holding car by
// CODE — or «سيارة أخرى ليست في هذه الشاشة» when the car is not one the reader may see. Every case
// of the server's refusal is walked here, and every answer is checked for what it must never hold:
// the employee id, the vehicle id, the server's English.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { translate } from '../../../platform/localization/i18n';
import { FIXED_REFUSAL, fixedSaveRefusal, type RefusalWords } from './fixed-save-refusal';

const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const V_HOLDER = '650000000000000000000031';
const MT = '650000000000000000000021';

/** The key the line chose, with its values — the catalog is the HUB's to fill. */
const keyed = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const words = (over: Partial<RefusalWords> = {}): RefusalWords => ({
  t: keyed,
  locale: 'ar',
  nameOf: (id) => (id === E1 ? 'أحمد محمد' : null),
  ...over,
});

const K = 'fleet.fixedRoster.refusal';

/** The two 409s and the 400s, shaped as the server sends them (`fixed-roster.service.ts`). */
const HELD_MESSAGE = `driver ${E1} already belongs to the fixed crew of vehicle 214; include that vehicle's row to release them`;
const held = (holder: string | null, employeeId = E1): ApiError =>
  new ApiError('DUPLICATE', HELD_MESSAGE, 409, [
    { field: 'driverEmployeeId', code: 'FIXED_CREW_DRIVER_HELD', message: employeeId },
    ...(holder === null
      ? []
      : [{ field: 'vehicleCode', code: 'FIXED_CREW_HOLDER', message: holder }]),
  ]);
const notActive = new ApiError(
  'DUPLICATE',
  'vehicle 214 is retired and cannot be crewed (§4.1)',
  409,
  [{ field: 'vehicleCode', code: 'FIXED_CREW_VEHICLE_NOT_ACTIVE', message: '214' }],
);
const validation = (first: string, code: string, message: string): ApiError =>
  new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
    { field: 'body.rows.driverEmployeeId', code: 'UNKNOWN', message: first },
    { field: 'driverEmployeeId', code, message },
  ]);

/** What a refusal line must never hold. */
const clean = (line: string): void => {
  expect(line, 'no employee id').not.toContain(E1);
  expect(line, 'no employee id').not.toContain(E2);
  expect(line, 'no vehicle id').not.toContain(V_HOLDER);
  expect(line, 'no mission id').not.toContain(MT);
  expect(line, 'not the server’s English').not.toMatch(
    /already belongs|cannot be crewed|Validation/u,
  );
};

describe('a driver another car still holds (409)', () => {
  it('names the driver and the holding car', () => {
    const line = fixedSaveRefusal(held('214'), words());
    expect(line).toBe(keyed(`${K}.held`, { name: 'أحمد محمد', code: '214' }));
    clean(line);
  });

  it('says «أحد السائقين» when the screen has no name for him', () => {
    const line = fixedSaveRefusal(held('214', E2), words());
    expect(line).toBe(keyed(`${K}.heldUnnamed`, { code: '214' }));
    clean(line);
  });

  it('says «سيارة أخرى ليست في هذه الشاشة» when the holding car is not the reader’s to see', () => {
    // The server adds the holder's code only when that car reads in the caller's scope.
    expect(fixedSaveRefusal(held(null), words())).toBe(
      keyed(`${K}.heldElsewhere`, { name: 'أحمد محمد' }),
    );
    expect(fixedSaveRefusal(held(null, E2), words())).toBe(`${K}.heldElsewhereUnnamed`);
  });

  it('never prints a holder that is an id, nor a blank one — the car is then «another car»', () => {
    for (const holder of [V_HOLDER, '', '   ']) {
      const line = fixedSaveRefusal(held(holder), words());
      expect(line).toBe(keyed(`${K}.heldElsewhere`, { name: 'أحمد محمد' }));
      clean(line);
    }
  });

  it('treats a blank name as no name', () => {
    expect(fixedSaveRefusal(held('214'), words({ nameOf: () => '  ' }))).toBe(
      keyed(`${K}.heldUnnamed`, { code: '214' }),
    );
  });
});

describe('the other refusals the server words', () => {
  it('a crewed car that is no longer in service — by its code', () => {
    const line = fixedSaveRefusal(notActive, words());
    expect(line).toBe(keyed(`${K}.vehicleNotActive`, { code: '214' }));
    clean(line);
  });

  it('a switched-off fleet profile — named, and unnamed', () => {
    const named = fixedSaveRefusal(
      validation('this driver’s fleet profile is inactive', 'FIXED_CREW_PROFILE_INACTIVE', E1),
      words(),
    );
    expect(named).toBe(keyed(`${K}.profileInactive`, { name: 'أحمد محمد' }));
    clean(named);
    expect(
      fixedSaveRefusal(
        validation('this driver’s fleet profile is inactive', 'FIXED_CREW_PROFILE_INACTIVE', E2),
        words(),
      ),
    ).toBe(`${K}.profileInactiveUnnamed`);
  });

  it('somebody who holds no driving seat — named, and unnamed', () => {
    const named = fixedSaveRefusal(
      validation('this employee does not hold a driving seat', 'FIXED_CREW_NOT_A_DRIVER', E1),
      words(),
    );
    expect(named).toBe(keyed(`${K}.notADriver`, { name: 'أحمد محمد' }));
    clean(named);
    expect(
      fixedSaveRefusal(
        validation('this employee does not hold a driving seat', 'FIXED_CREW_NOT_A_DRIVER', E2),
        words(),
      ),
    ).toBe(`${K}.notADriverUnnamed`);
  });

  it('a mission type archived since it was picked', () => {
    const error = new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
      {
        field: 'body.rows.missionTypeId',
        code: 'UNKNOWN',
        message: 'mission type not found or inactive',
      },
      { field: 'missionTypeId', code: 'FIXED_CREW_MISSION_INACTIVE', message: MT },
    ]);
    const line = fixedSaveRefusal(error, words());
    expect(line).toBe(`${K}.missionInactive`);
    clean(line);
  });

  it('a second driver with no first', () => {
    const error = new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
      {
        field: 'body.rows.driver2EmployeeId',
        code: 'DRIVER2_WITHOUT_DRIVER1',
        message: 'a second driver needs a first — assign driver 1 before driver 2',
      },
    ]);
    expect(fixedSaveRefusal(error, words())).toBe(`${K}.needsFirst`);
  });
});

describe('a refusal the line has no sentence for', () => {
  it('a contract 400 with no detail it knows — the generic line, draft kept', () => {
    const error = new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
      {
        field: 'body.rows.0.notes',
        code: 'too_big',
        message: 'String must contain at most 500 character(s)',
      },
    ]);
    const line = fixedSaveRefusal(error, words());
    expect(line).toBe(`${K}.generic`);
    clean(line);
  });

  it('a 409 from a server that sends no details (an older one) — generic, never its English', () => {
    const line = fixedSaveRefusal(new ApiError('DUPLICATE', HELD_MESSAGE, 409), words());
    expect(line).toBe(`${K}.generic`);
    clean(line);
  });

  it('a 400 / 409 under another code is still a refusal of the payload', () => {
    expect(fixedSaveRefusal(new ApiError('CONFLICT', 'conflict', 409), words())).toBe(
      `${K}.generic`,
    );
    expect(fixedSaveRefusal(new ApiError('BAD_REQUEST', 'bad', 400), words())).toBe(`${K}.generic`);
  });

  it('a stale board says what the app says about a stale record', () => {
    const stale = new ApiError('STALE_DOCUMENT', 'Document was modified by someone else', 409);
    expect(fixedSaveRefusal(stale, words())).toBe(errorMessage(stale, 'ar'));
    expect(fixedSaveRefusal(stale, words())).not.toBe(stale.message);
  });

  it('a dropped connection and a missing grant say what the app says', () => {
    const network = new TypeError('Failed to fetch');
    expect(fixedSaveRefusal(network, words())).toBe(errorMessage(network, 'ar'));
    const forbidden = new ApiError('FORBIDDEN', 'Forbidden', 403);
    expect(fixedSaveRefusal(forbidden, words())).toBe(errorMessage(forbidden, 'ar'));
  });

  it('a code the app has no words for falls back to the generic line, not the server’s English', () => {
    const odd = new ApiError('SOMETHING_NEW', 'Something new went wrong', 422);
    expect(errorMessage(odd, 'ar'), 'the app alone would show the English').toBe(odd.message);
    expect(fixedSaveRefusal(odd, words())).toBe(`${K}.generic`);
  });

  it('anything else thrown on the way is the generic line', () => {
    expect(fixedSaveRefusal(new Error('boom'), words())).toBe(`${K}.generic`);
    expect(fixedSaveRefusal('nope', words())).toBe(`${K}.generic`);
    expect(fixedSaveRefusal(undefined, words())).toBe(`${K}.generic`);
  });
});

describe('the detail codes are the server’s own (D12)', () => {
  it('pins the seven literals', () => {
    expect(FIXED_REFUSAL).toEqual({
      held: 'FIXED_CREW_DRIVER_HELD',
      holder: 'FIXED_CREW_HOLDER',
      vehicleNotActive: 'FIXED_CREW_VEHICLE_NOT_ACTIVE',
      profileInactive: 'FIXED_CREW_PROFILE_INACTIVE',
      notADriver: 'FIXED_CREW_NOT_A_DRIVER',
      missionInactive: 'FIXED_CREW_MISSION_INACTIVE',
      needsFirst: 'DRIVER2_WITHOUT_DRIVER1',
    });
  });

  it('spells each one exactly as the server writes it', () => {
    const service = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../api/src/modules/fleet/fixed-roster/fixed-roster.service.ts',
      ),
      'utf8',
    );
    for (const code of Object.values(FIXED_REFUSAL)) expect(service, code).toContain(`'${code}'`);
  });
});

describe('the real words (green once the HUB has merged the catalog)', () => {
  const real = (locale: Locale): RefusalWords => ({
    t: (key, params) => translate(locale, key, params),
    locale,
    nameOf: (id) => (id === E1 ? 'أحمد محمد' : null),
  });

  it('is Arabic for an Arabic reader — not one Latin letter, every case', () => {
    const cases: unknown[] = [
      held('214'),
      held('214', E2),
      held(null),
      held(null, E2),
      notActive,
      validation('x', 'FIXED_CREW_PROFILE_INACTIVE', E1),
      validation('x', 'FIXED_CREW_PROFILE_INACTIVE', E2),
      validation('x', 'FIXED_CREW_NOT_A_DRIVER', E1),
      validation('x', 'FIXED_CREW_NOT_A_DRIVER', E2),
      new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
        { code: 'FIXED_CREW_MISSION_INACTIVE', message: MT },
      ]),
      new ApiError('VALIDATION_FAILED', 'Validation failed', 400, [
        { code: 'DRIVER2_WITHOUT_DRIVER1', message: 'a second driver needs a first' },
      ]),
      new ApiError('DUPLICATE', HELD_MESSAGE, 409),
      new ApiError('SOMETHING_NEW', 'Something new went wrong', 422),
    ];
    for (const error of cases) {
      const line = fixedSaveRefusal(error, real('ar'));
      expect(line, line).not.toMatch(/[A-Za-z]/u);
      expect(line.length).toBeGreaterThan(0);
    }
    expect(fixedSaveRefusal(held('214'), real('ar'))).toContain('أحمد محمد');
    expect(fixedSaveRefusal(held('214'), real('ar'))).toContain('214');
  });

  it('fills every placeholder in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      const line = fixedSaveRefusal(held('214'), real(locale));
      expect(line, locale).not.toContain('{{');
      expect(line).toContain('214');
    }
  });
});

// The shipment form's rules, without a screen: how the three banks follow each other, where the
// area comes from, and which words a refused save shows.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import {
  BRANCH_DUPLICATE_KEY,
  SHIPMENT_DATE_PROBLEM_KEY,
  SHIPMENT_SAVE_ERROR_KEYS,
  branchSaveErrorKey,
  areaOfDestination,
  defaultDeliveryDate,
  deliveryDateMin,
  deliveryDateProblem,
  deliveryDateRequired,
  followCollectionDate,
  nextDay,
  shipmentDateProblem,
  earliestShipmentDate,
  followMainBank,
  secondaryBankFor,
  shipmentSaveErrorKey,
} from './shipment-form';

describe('followMainBank — the from/to banks after the main bank changes', () => {
  it('an empty side takes the new main bank (legacy defaulted both sides to it)', () => {
    expect(followMainBank('', '', 'misr')).toBe('misr');
  });

  it('a side that was following the main bank keeps following it', () => {
    expect(followMainBank('ahly', 'ahly', 'misr')).toBe('misr');
  });

  // Legacy reset both sides on every main-bank change, throwing away a deliberate pick.
  it('a side deliberately set to another bank survives', () => {
    expect(followMainBank('cairo', 'ahly', 'misr')).toBe('cairo');
  });
});

describe('secondaryBankFor — what secondaryBankId carries', () => {
  it('is null when the to-bank IS the main bank — how every existing shipment reads', () => {
    expect(secondaryBankFor('ahly', 'ahly')).toBeNull();
    expect(secondaryBankFor('ahly', '')).toBeNull();
  });

  it('is the to-bank when the money goes to another bank', () => {
    expect(secondaryBankFor('ahly', 'misr')).toBe('misr');
  });
});

describe('areaOfDestination — المنطقة from the TO branch, not typed', () => {
  it('takes the branch’s operations area', () => {
    expect(areaOfDestination({ opsAreaName: 'المعادي' })).toBe('المعادي');
    expect(areaOfDestination({ opsAreaName: '  المعادي ' })).toBe('المعادي');
  });

  // The box cannot be typed into, so nothing may linger from the branch picked before.
  it('is empty for a branch with no area, and for no branch', () => {
    expect(areaOfDestination({ opsAreaName: null })).toBe('');
    expect(areaOfDestination({ opsAreaName: '  ' })).toBe('');
    expect(areaOfDestination(null)).toBe('');
  });
});

describe('a shipment date’s floor — «مينفعش لما يجى يضيف شحنه يختار تاريخ فات»', () => {
  const TODAY = '2026-11-11';

  describe('a NEW shipment — not before today', () => {
    it('opens its calendar on today as the earliest day', () => {
      expect(earliestShipmentDate(null, TODAY)).toBe(TODAY);
    });

    it('takes today or any later day', () => {
      expect(shipmentDateProblem(TODAY, null, TODAY)).toBeNull();
      expect(shipmentDateProblem('2026-11-12', null, TODAY)).toBeNull();
      expect(shipmentDateProblem('2027-01-01', null, TODAY)).toBeNull();
    });

    it('refuses any day before today — yesterday as much as last year', () => {
      expect(shipmentDateProblem('2026-11-10', null, TODAY)).toBe('inPast');
      expect(shipmentDateProblem('2025-11-11', null, TODAY)).toBe('inPast');
    });

    it('compares whole days across a month and a year', () => {
      expect(shipmentDateProblem('2026-10-31', null, '2026-11-01')).toBe('inPast');
      expect(shipmentDateProblem('2026-12-31', null, '2027-01-01')).toBe('inPast');
      expect(shipmentDateProblem('2027-01-01', null, '2026-12-31')).toBeNull();
    });
  });

  // «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة».
  describe('an EDIT — not before the day the shipment was on', () => {
    it('floors the calendar at the shipment’s own day, not at today', () => {
      expect(earliestShipmentDate('2026-11-03', TODAY)).toBe('2026-11-03');
      // A shipment already dated ahead cannot be pulled back to today either.
      expect(earliestShipmentDate('2026-11-20', TODAY)).toBe('2026-11-20');
    });

    it('keeps a past shipment editable on its own day — the floor is its day, not today', () => {
      expect(shipmentDateProblem('2026-11-03', '2026-11-03', TODAY)).toBeNull();
    });

    it('may move the shipment later — past today, too', () => {
      expect(shipmentDateProblem('2026-11-05', '2026-11-03', TODAY)).toBeNull();
      expect(shipmentDateProblem('2026-11-15', '2026-11-03', TODAY)).toBeNull();
    });

    it('refuses moving it earlier than it was', () => {
      expect(shipmentDateProblem('2026-11-02', '2026-11-03', TODAY)).toBe('beforeOriginal');
      expect(shipmentDateProblem('2026-11-19', '2026-11-20', TODAY)).toBe('beforeOriginal');
    });
  });

  // A secured shipment's delivery date is held to the same floor; one never set before is a NEW
  // date, so it is floored at today — however old the shipment.
  it('treats a delivery date set for the first time on an edit as a new date', () => {
    expect(earliestShipmentDate(null, TODAY)).toBe(TODAY);
    expect(shipmentDateProblem('2026-11-10', null, TODAY)).toBe('inPast');
    expect(shipmentDateProblem(TODAY, null, TODAY)).toBeNull();
  });

  it('leaves an empty or half-typed date to the required check — nothing to compare yet', () => {
    for (const value of ['', '2026-11', '2026-02-30', 'not a date']) {
      expect(shipmentDateProblem(value, null, TODAY), value).toBeNull();
      expect(shipmentDateProblem(value, '2026-11-03', TODAY), value).toBeNull();
    }
  });

  it('says the server’s refusal of the same two in the same words', () => {
    const failed = (code: string): ApiError => new ApiError(code, 'english server sentence', 422);
    // Typed as plain strings: the codes are the server's, named here as it sends them.
    expect(shipmentSaveErrorKey(failed('OPERATIONS_SHIPMENT_DATE_IN_PAST'))).toBe(
      SHIPMENT_DATE_PROBLEM_KEY.inPast,
    );
    expect(shipmentSaveErrorKey(failed('OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL'))).toBe(
      SHIPMENT_DATE_PROBLEM_KEY.beforeOriginal,
    );
    expect(
      shipmentSaveErrorKey(failed(ErrorCodes.OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION)),
    ).toBe(SHIPMENT_DATE_PROBLEM_KEY.beforeCollection);
  });

  it('has its words in both catalogs', () => {
    for (const key of Object.values(SHIPMENT_DATE_PROBLEM_KEY)) {
      for (const locale of ['ar', 'en'] as const) expect(translate(locale, key)).not.toBe(key);
    }
  });
});

describe('shipmentSaveErrorKey — a refused save, in the reader’s language', () => {
  const failed = (code: string): ApiError => new ApiError(code, 'english server sentence', 422);

  it('names the reason for each code the form can cause', () => {
    expect(shipmentSaveErrorKey(failed(ErrorCodes.OPERATIONS_BRANCH_BANK_MISMATCH))).toBe(
      'operations.shipment.errors.branchBank',
    );
    expect(shipmentSaveErrorKey(failed(ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH))).toBe(
      'operations.shipment.errors.crewDay',
    );
    expect(shipmentSaveErrorKey(failed(ErrorCodes.STALE_DOCUMENT))).toBe(
      'operations.shipment.errors.stale',
    );
  });

  it('falls back to the generic message for a refusal about the values', () => {
    expect(shipmentSaveErrorKey(failed('SOMETHING_ELSE'))).toBe('operations.shipment.saveFailed');
    expect(shipmentSaveErrorKey(failed(ErrorCodes.VALIDATION_FAILED))).toBe(
      'operations.shipment.saveFailed',
    );
  });

  // «راجع القيم» for a dropped connection sends the operator to re-check values that were fine.
  it('leaves the reason to the shared wording when it is not about the values', () => {
    expect(shipmentSaveErrorKey(new TypeError('Failed to fetch'))).toBeNull();
    expect(shipmentSaveErrorKey(failed('FORBIDDEN'))).toBeNull();
    expect(shipmentSaveErrorKey(failed('AUTH_SESSION_REVOKED'))).toBeNull();
    expect(shipmentSaveErrorKey(failed('INTERNAL'))).toBeNull();
  });

  // A key missing from a catalog renders as the key itself — on an Arabic screen, in English.
  it('every key it can return exists in both catalogs', () => {
    for (const key of [...SHIPMENT_SAVE_ERROR_KEYS, 'operations.shipment.saveFailed']) {
      for (const locale of ['ar', 'en'] as const) expect(translate(locale, key)).not.toBe(key);
    }
  });
});

describe('branchSaveErrorKey — the branch form, also opened from the shipment form', () => {
  const failed = (code: string): ApiError => new ApiError(code, 'english server sentence', 409);

  // The shipment form searches ACTIVE branches; a "new" name may be a deactivated branch's.
  it('names a duplicate name or code — a deactivated branch may hold it', () => {
    expect(branchSaveErrorKey(failed(ErrorCodes.DUPLICATE))).toBe(BRANCH_DUPLICATE_KEY);
  });

  it('falls back to the catalogs’ generic message, or the shared wording', () => {
    expect(branchSaveErrorKey(failed(ErrorCodes.VALIDATION_FAILED))).toBe(
      'operations.catalogs.saveFailed',
    );
    expect(branchSaveErrorKey(new TypeError('Failed to fetch'))).toBeNull();
  });

  it('every key it can return exists in both catalogs', () => {
    for (const key of [BRANCH_DUPLICATE_KEY, 'operations.catalogs.saveFailed']) {
      for (const locale of ['ar', 'en'] as const) expect(translate(locale, key)).not.toBe(key);
    }
  });
});

// «تاريخ المحصنة اجبارى … وتاريخ التسليم تانى يوم الاستلام افتراضى وممكن يغير».
describe('a محصنة’s delivery date — the day after collection, unless changed', () => {
  const TODAY = '2026-11-11';

  it('nextDay is the calendar’s next day — across a month, a year and a leap day', () => {
    expect(nextDay('2026-11-11')).toBe('2026-11-12');
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(nextDay('2027-02-28')).toBe('2027-03-01');
  });

  it('nextDay has nothing to say of a date that is not a whole day', () => {
    for (const value of ['', '2026-11', '2026-02-30', 'tomorrow']) expect(nextDay(value)).toBe('');
  });

  it('opens a new محصنة on the day after its collection', () => {
    expect(defaultDeliveryDate(TODAY)).toBe('2026-11-12');
    expect(defaultDeliveryDate('')).toBe('');
  });

  it('follows the collection date while the person has not picked a delivery date', () => {
    expect(followCollectionDate('2026-11-12', '2026-11-11', '2026-11-15')).toBe('2026-11-16');
    // The collection box half-typed, then whole again: the default comes back with it.
    expect(followCollectionDate('2026-11-12', '2026-11-11', '')).toBe('');
    expect(followCollectionDate('', '', '2026-11-20')).toBe('2026-11-21');
  });

  it('keeps a delivery date the person picked — «وممكن يغير»', () => {
    expect(followCollectionDate('2026-11-14', '2026-11-11', '2026-11-12')).toBe('2026-11-14');
    // Even one the new collection date now passes: the box says so, rather than moving it.
    expect(followCollectionDate('2026-11-14', '2026-11-11', '2026-11-20')).toBe('2026-11-14');
  });

  it('offers no delivery day before the collection day, nor before its own floor', () => {
    expect(deliveryDateMin(TODAY, '2026-11-15')).toBe('2026-11-15');
    expect(deliveryDateMin('2026-11-20', '2026-11-15')).toBe('2026-11-20');
    // A collection date not whole yet leaves the floor alone.
    expect(deliveryDateMin(TODAY, '')).toBe(TODAY);
  });

  describe('deliveryDateProblem', () => {
    it('takes the collection day itself, or any day after it', () => {
      expect(deliveryDateProblem('2026-11-12', '2026-11-12', null, TODAY)).toBeNull();
      expect(deliveryDateProblem('2026-11-13', '2026-11-12', null, TODAY)).toBeNull();
    });

    it('refuses a delivery day before the collection day', () => {
      expect(deliveryDateProblem('2026-11-12', '2026-11-14', null, TODAY)).toBe('beforeCollection');
    });

    // The server checks the past-day rules first; so does the form, so both say the same thing.
    it('names the floor first — a past day is «a day that has passed», whatever the order', () => {
      expect(deliveryDateProblem('2026-11-10', '2026-11-11', null, TODAY)).toBe('inPast');
      expect(
        deliveryDateProblem(
          '2026-11-12',
          '2026-11-11',
          { delivery: '2026-11-13', collection: '2026-11-11' },
          TODAY,
        ),
      ).toBe('beforeOriginal');
    });

    it('lets an edit that moves neither date through — a row stored the wrong way round still takes a notes fix', () => {
      const held = { delivery: '2026-11-12', collection: '2026-11-14' };
      expect(deliveryDateProblem('2026-11-12', '2026-11-14', held, TODAY)).toBeNull();
      // Moving either one is judged on the two dates the shipment would then have.
      expect(deliveryDateProblem('2026-11-13', '2026-11-14', held, TODAY)).toBe('beforeCollection');
      expect(deliveryDateProblem('2026-11-12', '2026-11-15', held, TODAY)).toBe('beforeCollection');
      expect(deliveryDateProblem('2026-11-16', '2026-11-15', held, TODAY)).toBeNull();
    });

    it('leaves an empty or half-typed date to the required check', () => {
      expect(deliveryDateProblem('', '2026-11-12', null, TODAY)).toBeNull();
      expect(deliveryDateProblem('2026-11-12', '', null, TODAY)).toBeNull();
    });
  });

  it('is required of a new محصنة, and of one that already has a delivery date', () => {
    expect(deliveryDateRequired('secured', null, true)).toBe(true);
    expect(deliveryDateRequired('secured', '2026-11-12', false)).toBe(true);
  });

  // Legacy never required it; a date invented to pass the form would book a dispatch day.
  it('is not required of an old محصنة stored without one, nor of a daily shipment', () => {
    expect(deliveryDateRequired('secured', null, false)).toBe(false);
    expect(deliveryDateRequired('daily', null, true)).toBe(false);
  });

  it('says the refusal in both catalogs, as the server’s code is said', () => {
    for (const locale of ['ar', 'en'] as const) {
      const key = SHIPMENT_DATE_PROBLEM_KEY.beforeCollection;
      expect(translate(locale, key)).not.toBe(key);
    }
  });
});

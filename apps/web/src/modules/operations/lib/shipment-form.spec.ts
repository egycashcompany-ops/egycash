// The shipment form's rules, without a screen: how the three banks follow each other, where the
// area comes from, and which words a refused save shows.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import {
  BRANCH_DUPLICATE_KEY,
  SHIPMENT_SAVE_ERROR_KEYS,
  branchSaveErrorKey,
  areaAfterDestination,
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

describe('areaAfterDestination — المنطقة from the TO branch', () => {
  it('takes the branch’s operations area', () => {
    expect(areaAfterDestination({ opsAreaName: 'المعادي' }, '')).toBe('المعادي');
    expect(areaAfterDestination({ opsAreaName: 'المعادي' }, 'وسط البلد')).toBe('المعادي');
  });

  it('keeps what the box held when the branch has no area, as legacy did', () => {
    expect(areaAfterDestination({ opsAreaName: null }, 'وسط البلد')).toBe('وسط البلد');
    expect(areaAfterDestination({ opsAreaName: '  ' }, 'وسط البلد')).toBe('وسط البلد');
  });

  it('keeps it when the branch was cleared', () => {
    expect(areaAfterDestination(null, 'وسط البلد')).toBe('وسط البلد');
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

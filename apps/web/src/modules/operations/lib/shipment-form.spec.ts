// The shipment form's rules, without a screen: how the three banks follow each other, where the
// area comes from, and which words a refused save shows.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import {
  SHIPMENT_SAVE_ERROR_KEYS,
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

  it('falls back to the generic message for anything else', () => {
    expect(shipmentSaveErrorKey(failed('SOMETHING_ELSE'))).toBe('operations.shipment.saveFailed');
    expect(shipmentSaveErrorKey(new Error('network'))).toBe('operations.shipment.saveFailed');
  });

  // A key missing from a catalog renders as the key itself — on an Arabic screen, in English.
  it('every key it can return exists in both catalogs', () => {
    for (const key of [...SHIPMENT_SAVE_ERROR_KEYS, 'operations.shipment.saveFailed']) {
      for (const locale of ['ar', 'en'] as const) expect(translate(locale, key)).not.toBe(key);
    }
  });
});

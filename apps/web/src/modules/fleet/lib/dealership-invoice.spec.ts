import { describe, expect, it } from 'vitest';
import {
  DEALERSHIP_PHOTO_MAX_BYTES,
  dealershipCarInsurer,
  dealershipInsurerOptions,
  dealershipPhotoProblem,
} from './dealership-invoice';

const MISR = { ar: 'مصر للتأمين', en: 'Misr Insurance' };
const bill = {
  insuranceCompanyId: null,
  insuranceCompanyName: null,
  vehicleInsuranceCompanyId: 'i-1',
  vehicleInsuranceCompanyName: MISR,
  vehicleInsuranceCompanyActive: true,
};
const noCarInsurer = {
  vehicleInsuranceCompanyId: null,
  vehicleInsuranceCompanyName: null,
  vehicleInsuranceCompanyActive: false,
};
const archived = { ...bill, vehicleInsuranceCompanyActive: false };

describe('what the bill’s arrow offers beside «لا يوجد»', () => {
  it('the car’s own insurer, as the vehicles screen records it', () => {
    expect(dealershipInsurerOptions(bill, 'ar')).toEqual([{ id: 'i-1', name: 'مصر للتأمين' }]);
  });

  it('names it in the reader’s language — English on the English screen', () => {
    expect(dealershipInsurerOptions(bill, 'en')).toEqual([{ id: 'i-1', name: 'Misr Insurance' }]);
  });

  it('nothing for a car with no insurer — «لا يوجد» stands alone', () => {
    expect(dealershipInsurerOptions({ ...bill, ...noCarInsurer }, 'ar')).toEqual([]);
  });

  it('nothing for an insurer archived in قوائم الحركة — the bill could not be saved with it', () => {
    expect(dealershipInsurerOptions(archived, 'ar')).toEqual([]);
    // Saved with it before it was archived: still there, still picked, in the reader's language.
    expect(
      dealershipInsurerOptions(
        { ...archived, insuranceCompanyId: 'i-1', insuranceCompanyName: 'مصر للتأمين' },
        'en',
      ),
    ).toEqual([{ id: 'i-1', name: 'Misr Insurance' }]);
  });

  it('the insurer a bill was saved with, once, beside the car’s — so an edit still shows it', () => {
    expect(
      dealershipInsurerOptions(
        { ...bill, insuranceCompanyId: 'i-9', insuranceCompanyName: 'شركة سابقة' },
        'ar',
      ),
    ).toEqual([
      { id: 'i-1', name: 'مصر للتأمين' },
      { id: 'i-9', name: 'شركة سابقة' },
    ]);
    // Saved with the car's own: listed once.
    expect(
      dealershipInsurerOptions(
        { ...bill, insuranceCompanyId: 'i-1', insuranceCompanyName: 'مصر للتأمين' },
        'ar',
      ),
    ).toEqual([{ id: 'i-1', name: 'مصر للتأمين' }]);
    // Saved on a car that has none any more: still there to stay picked.
    expect(
      dealershipInsurerOptions(
        { insuranceCompanyId: 'i-9', insuranceCompanyName: 'شركة سابقة', ...noCarInsurer },
        'ar',
      ),
    ).toEqual([{ id: 'i-9', name: 'شركة سابقة' }]);
  });
});

describe('what the hint says about the car’s insurer', () => {
  it('none on شاشة السيارات, one archived in قوائم الحركة — named — or one the arrow offers', () => {
    expect(dealershipCarInsurer(noCarInsurer, 'ar')).toEqual({ kind: 'none' });
    // Not «the car has no insurer»: it has one, which may not be picked.
    expect(dealershipCarInsurer(archived, 'ar')).toEqual({ kind: 'archived', name: 'مصر للتأمين' });
    expect(dealershipCarInsurer(archived, 'en')).toEqual({
      kind: 'archived',
      name: 'Misr Insurance',
    });
    expect(dealershipCarInsurer(bill, 'ar')).toEqual({ kind: 'offered' });
  });
});

describe('a picked photo of the bill — the dealership endpoint’s own limits', () => {
  it('takes a JPEG, PNG or WEBP up to 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(dealershipPhotoProblem({ size: 1024, type })).toBeNull();
    }
    expect(dealershipPhotoProblem({ size: DEALERSHIP_PHOTO_MAX_BYTES, type: 'image/jpeg' })).toBe(
      null,
    );
  });

  it('refuses a larger one, or another kind of file, at the pick', () => {
    expect(
      dealershipPhotoProblem({ size: DEALERSHIP_PHOTO_MAX_BYTES + 1, type: 'image/jpeg' }),
    ).toBe('tooBig');
    expect(dealershipPhotoProblem({ size: 1024, type: 'application/pdf' })).toBe('badType');
    expect(dealershipPhotoProblem({ size: 1024, type: 'image/heic' })).toBe('badType');
  });

  it('leaves a file the browser could not type to the server, which reads its bytes', () => {
    expect(dealershipPhotoProblem({ size: 1024, type: '' })).toBeNull();
  });
});

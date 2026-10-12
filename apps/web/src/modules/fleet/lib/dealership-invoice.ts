// The two choices «تسجيل الفاتورة» makes beside its numbers: which insurer the bill names, and the
// photo of the bill.
//
// «الافتراضى بتاع الربي فى التامين لا يوجد حتى لو العربيه فيها تامين بس لو فيها تامين اقدر ادوس على
// السهم واختار»; «دلوقتى اخترت عربيه وعليها تامين يكون لا يوجد بس التامين بتعها لما ادوس على السهم
// اقدر اختار التامين اللى فى شاشه السيارات». The box opens on «لا يوجد» for every bill; the arrow
// offers the car's own insurer as شاشة السيارات records it — no typed names any more.
import { type FleetDealershipInvoiceDto, type Locale } from '@ecms/contracts';
import { localized } from '../../../shared/lib/format';

/** An insurer under the arrow, beside «لا يوجد». */
export interface DealershipInsurerOption {
  id: string;
  name: string;
}

type InsurerFields = Pick<
  FleetDealershipInvoiceDto,
  | 'insuranceCompanyId'
  | 'insuranceCompanyName'
  | 'vehicleInsuranceCompanyId'
  | 'vehicleInsuranceCompanyName'
  | 'vehicleInsuranceCompanyActive'
>;

/**
 * What the arrow offers besides «لا يوجد»: the car's insurer in the reader's language — while
 * قوائم الحركة holds it active, since the bill could not be saved with any other — and, on a bill
 * saved earlier with another one, that stored insurer too, so editing the bill shows it still
 * picked rather than silently dropping it.
 */
export const dealershipInsurerOptions = (
  row: InsurerFields,
  locale: Locale,
): DealershipInsurerOption[] => {
  const carName =
    row.vehicleInsuranceCompanyName === null
      ? null
      : localized(row.vehicleInsuranceCompanyName, locale);
  const options: DealershipInsurerOption[] = [];
  if (
    row.vehicleInsuranceCompanyId !== null &&
    carName !== null &&
    row.vehicleInsuranceCompanyActive
  ) {
    options.push({ id: row.vehicleInsuranceCompanyId, name: carName });
  }
  if (row.insuranceCompanyId !== null && !options.some((o) => o.id === row.insuranceCompanyId)) {
    // The car's own, archived since the bill was saved, is still named in the reader's language.
    const name =
      row.insuranceCompanyId === row.vehicleInsuranceCompanyId && carName !== null
        ? carName
        : (row.insuranceCompanyName ?? '—');
    options.push({ id: row.insuranceCompanyId, name });
  }
  return options;
};

/**
 * What the hint under the box says about the car's insurer: it has none on شاشة السيارات, it has
 * one archived in قوائم الحركة (named, but not offered), or it has one the arrow offers.
 */
export type DealershipCarInsurer =
  { kind: 'none' } | { kind: 'archived'; name: string } | { kind: 'offered' };

export const dealershipCarInsurer = (
  row: Pick<
    FleetDealershipInvoiceDto,
    'vehicleInsuranceCompanyId' | 'vehicleInsuranceCompanyName' | 'vehicleInsuranceCompanyActive'
  >,
  locale: Locale,
): DealershipCarInsurer => {
  if (row.vehicleInsuranceCompanyId === null || row.vehicleInsuranceCompanyName === null) {
    return { kind: 'none' };
  }
  return row.vehicleInsuranceCompanyActive
    ? { kind: 'offered' }
    : { kind: 'archived', name: localized(row.vehicleInsuranceCompanyName, locale) };
};

/**
 * The bill's photo goes up through the table's own endpoint, so it takes that endpoint's limits —
 * the dealership file category (`dealership-files.ts`): one image, JPEG / PNG / WEBP, 10 MB.
 */
export const DEALERSHIP_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DEALERSHIP_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Why a picked photo would be refused — said at the pick, not after the invoice is already saved.
 * A file the browser could not type (`''`) is left to the server, which reads the bytes.
 */
export const dealershipPhotoProblem = (file: {
  size: number;
  type: string;
}): 'tooBig' | 'badType' | null => {
  if (file.size > DEALERSHIP_PHOTO_MAX_BYTES) return 'tooBig';
  if (file.type !== '' && !(DEALERSHIP_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'badType';
  }
  return null;
};

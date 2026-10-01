// What the dealership screen writes in «نوع العمل», from the work type a visit was closed with.
//
// «لو صيانه هتتكتب صيانة، لو اصلاح هتتكتب اصلاح، لو اى حاجه غير صيانه واصلاح هتتكتب اصلاح بين
// قوسين الحاجه اللى حصلت، لو صيانه واصلاح افصل كل واحده عشان رقم الفاتوره مختلف». One visit
// becomes one row — or two, when its work type names both halves, because each half has its own
// invoice at the dealership.
import { type FleetDealershipWorkKind } from '@ecms/contracts';

export interface DealershipWorkRow {
  workKind: FleetDealershipWorkKind;
  workTypeLabel: string;
}

export const MAINTENANCE_LABEL = 'صيانة';
export const REPAIR_LABEL = 'إصلاح';

/** Hamza forms and the final ta/ha folded, so «صيانه» and «اصلاح» read as the two words. */
const fold = (value: string): string =>
  value
    .trim()
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ة/gu, 'ه')
    .replace(/\s+/gu, ' ');

const isMaintenance = (word: string): boolean => fold(word) === 'صيانه';
const isRepair = (word: string): boolean => fold(word) === 'اصلاح';

/**
 * The rows one closed visit opens on the dealership screen.
 *
 * A name that is only «صيانة» or only «إصلاح» is written as that word. A name holding BOTH words
 * («صيانة + إصلاح», «صيانة و اصلاح») opens one row of each. Anything else is a repair of the kind
 * named: «إصلاح (كهرباء)».
 */
export const splitWorkType = (workTypeName: string): DealershipWorkRow[] => {
  const name = workTypeName.trim();
  if (isMaintenance(name)) return [{ workKind: 'maintenance', workTypeLabel: MAINTENANCE_LABEL }];
  if (isRepair(name)) return [{ workKind: 'repair', workTypeLabel: REPAIR_LABEL }];
  const words = fold(name)
    .split(/[\s+&،,/و-]+/u)
    .filter((word) => word !== '');
  const hasBoth = words.some(isMaintenance) && words.some(isRepair);
  // Only the two words and the glue between them — «صيانة + إصلاح كهرباء» is not a plain split.
  if (hasBoth && words.every((word) => isMaintenance(word) || isRepair(word))) {
    return [
      { workKind: 'maintenance', workTypeLabel: MAINTENANCE_LABEL },
      { workKind: 'repair', workTypeLabel: REPAIR_LABEL },
    ];
  }
  return [{ workKind: 'repair', workTypeLabel: `${REPAIR_LABEL} (${name})` }];
};

/** «ملاكي» — is this operation name the private-car one? Hamza and final-ya forms both count. */
export const isPrivateOperation = (operationName: string | null | undefined): boolean =>
  operationName !== null &&
  operationName !== undefined &&
  /ملاك[يى]/u.test(fold(operationName).replace(/ى/gu, 'ي'));

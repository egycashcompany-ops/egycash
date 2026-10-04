// «لو غير فئة الترخيص من ت ل م او م ل ت يجيب انذار انه لازم يعدل تاريخ انتهاء الترخيص ولو عدل
// التاريخ تلقائى لو م تبقى ت ولو ت تبقى م».
//
// A licence class is a traffic unit and a letter — «برقاش م», «العجوزة ت». The letter and the
// expiry date move together: a renewal is a new date AND the other letter. So the vehicle form
// refuses a flipped letter with the old date, and flips the letter itself when only the date moved.

import { fleetLicenseLetter } from '@ecms/contracts';

export type LicenseLetter = 'م' | 'ت';

export interface LicenseClassItem {
  id: string;
  name: string;
}

/** The class's letter — its last word, «م» or «ت» — or `null` for a class without one. */
export const licenseLetter = fleetLicenseLetter;

const base = (name: string): string => name.trim().split(/\s+/u).slice(0, -1).join(' ');

/** The same unit with the other letter — «برقاش م» ↔ «برقاش ت» — or `null` when there is none. */
export const counterpartClass = (
  items: readonly LicenseClassItem[],
  id: string,
): LicenseClassItem | null => {
  const from = items.find((item) => item.id === id);
  const letter = from === undefined ? null : licenseLetter(from.name);
  if (from === undefined || letter === null) return null;
  const want: LicenseLetter = letter === 'م' ? 'ت' : 'م';
  return (
    items.find(
      (item) => licenseLetter(item.name) === want && base(item.name) === base(from.name),
    ) ?? null
  );
};

/** Did the class move from one letter to the other? */
export const letterFlipped = (
  items: readonly LicenseClassItem[],
  fromId: string,
  toId: string,
): boolean => {
  const name = (id: string): string => items.find((item) => item.id === id)?.name ?? '';
  const a = licenseLetter(name(fromId));
  const b = licenseLetter(name(toId));
  return a !== null && b !== null && a !== b;
};

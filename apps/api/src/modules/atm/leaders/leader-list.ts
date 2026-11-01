// Who the leader pickers offer — the PURE half of `leaders.service.ts`.
//
// The legacy list was every working employee of the department NAMED «الصراف الالى»
// (contad_app.js:1110-1112). ECMS's org chart owns department names, so the constant became the
// `atm.maintenanceLeaderDepartmentIds` setting — which shipped empty, and an empty list offered
// nobody: the owner's «تظهر أسماء الموظفين اللى فى ATM في Drop Down القائد … وخصوصاً عند تقفيل
// ماكينات الصيانة» (2026-11-01). While nothing is ticked on /atm/settings, the list is drawn from
// every active department whose name IS the ATM department's — the legacy rule itself, read the way
// an Arabic typist writes it: «الصراف الآلي», «الصراف الالى», «الصرافات الآلية», «إدارة الصراف
// الآلي», or ATM in English.
import { type AtmLeaderOptionDto, type LocalizedString } from '@ecms/contracts';
import { type DirectoryEmployee } from '../../../platform/directory';

/** Diacritics and tatweel dropped, the hamza forms, final ya and ta marbuta folded. */
const foldArabic = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();

/** «صراف آلي», «الصراف الآلي», «الصرافات الآلية» — folded. */
const ARABIC_ATM = /صراف(?:ات)?\s+(?:ال)?الي/;
/** «ATM», «ATMs», «Automated Teller …» — a whole word, so «Treatment» is not one. */
const ENGLISH_ATM = /\bATMs?\b|\bautomated\s+teller/i;

/** Is this department the ATM department, by its name — in either language? */
export const isAtmDepartmentName = (name: LocalizedString): boolean =>
  ARABIC_ATM.test(foldArabic(name.ar)) ||
  ARABIC_ATM.test(foldArabic(name.en)) ||
  ENGLISH_ATM.test(name.en) ||
  ENGLISH_ATM.test(name.ar);

/**
 * The pickers' names: working employees only (an exited one is excluded the way operations
 * excludes them), each person once, in Arabic alphabetical order — the code breaks a tie, so two
 * people of one name keep one order.
 */
export const toLeaderOptions = (employees: readonly DirectoryEmployee[]): AtmLeaderOptionDto[] => {
  const byId = new Map<string, AtmLeaderOptionDto>();
  for (const employee of employees) {
    if (employee.status === 'exited' || byId.has(employee.employeeId)) continue;
    byId.set(employee.employeeId, {
      employeeId: employee.employeeId,
      name: employee.fullNameAr,
      code: employee.code,
    });
  }
  return [...byId.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'ar') || a.code.localeCompare(b.code),
  );
};

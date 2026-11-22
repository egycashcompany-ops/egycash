// Who holds an asset — an employee, or a DEPARTMENT at a place (2026-11-19) — named the one way
// every IT screen, file and paper names it.
//
// «عند تسليم الأصول والمستهلكات يكون فى إمكانية إنى مأسلمش لموظف ولكن أعينها فى مكان بس تبقى على
// عهده الإدارة .. زى السيرفرات والكاميرات والسويتشات». A server is held by a department («في عهدة
// إدارة تكنولوجيا المعلومات»), kept at one of its branch's places («— غرفة السيرفرات») and signed for
// by the department's responsible person. The holder is the DEPARTMENT, never the signer: a screen
// that wrote the signer's name in the holder column would turn department custody into his own.
//
// Every holder the server answers is flat — the asset row's `holder`, an interval, a ledger row —
// with the other kind's fields null. `holderOfAssignment` / `holderOfMovement` read those into one
// shape, and every reader goes through `holderName` and its parts rather than reading
// `employeeId` / `assignedToEmployeeId` itself: those are null on a department's row, and a
// template literal or a `??` chain would print «null» or the wrong person without a compile error.
import {
  type ItAssetAssignmentDto,
  type ItAssetHolderDto,
  type ItAssetHolderKind,
  type ItConsumableMovementDto,
  type Locale,
} from '@ecms/contracts';
import { type Translate } from './register-export';

type Name = { ar: string; en: string } | null;

/** One holder, whichever row named it: an employee, or a department at a place. */
export interface CustodyHolderFacts {
  kind: ItAssetHolderKind;
  /** The employee holder — null for a department. */
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  /** The department holder and its place — null for an employee. */
  departmentId: string | null;
  departmentName: Name;
  locationId: string | null;
  locationName: Name;
  /** Who signed for the department — null for an employee. */
  responsibleEmployeeId: string | null;
  responsibleEmployeeCode: string | null;
  responsibleEmployeeName: string | null;
}

/**
 * The asset row's holder. Read defensively: an interval written before department custody — and a
 * response from a server that predates it — has no `kind`, and is an employee's.
 */
export const holderOfAsset = (holder: ItAssetHolderDto): CustodyHolderFacts => ({
  kind: holder.kind ?? 'employee',
  employeeId: holder.employeeId ?? null,
  employeeCode: holder.employeeCode ?? null,
  employeeName: holder.employeeName ?? null,
  departmentId: holder.departmentId ?? null,
  departmentName: holder.departmentName ?? null,
  locationId: holder.locationId ?? null,
  locationName: holder.locationName ?? null,
  responsibleEmployeeId: holder.responsibleEmployeeId ?? null,
  responsibleEmployeeCode: holder.responsibleEmployeeCode ?? null,
  responsibleEmployeeName: holder.responsibleEmployeeName ?? null,
});

/** The custody register's interval, as the holder it names. */
export const holderOfAssignment = (row: ItAssetAssignmentDto): CustodyHolderFacts => ({
  kind: row.holderKind ?? 'employee',
  employeeId: row.assignedToEmployeeId ?? null,
  employeeCode: row.assignedToEmployeeCode ?? null,
  employeeName: row.assignedToEmployeeName ?? null,
  departmentId: row.departmentId ?? null,
  departmentName: row.departmentName ?? null,
  locationId: row.locationId ?? null,
  locationName: row.locationName ?? null,
  responsibleEmployeeId: row.responsibleEmployeeId ?? null,
  responsibleEmployeeCode: row.responsibleEmployeeCode ?? null,
  responsibleEmployeeName: row.responsibleEmployeeName ?? null,
});

/**
 * Who a ledger row's issue went to (or a return came from): an employee, a department at a place
 * (an issue to a department), or nobody (a receipt, a write-off, a transfer).
 */
export const holderOfMovement = (row: ItConsumableMovementDto): CustodyHolderFacts | null => {
  const departmentId = row.departmentId ?? null;
  if (departmentId !== null) {
    return {
      kind: 'department',
      employeeId: null,
      employeeCode: null,
      employeeName: null,
      departmentId,
      departmentName: row.departmentName ?? null,
      locationId: row.locationId ?? null,
      locationName: row.locationName ?? null,
      responsibleEmployeeId: row.responsibleEmployeeId ?? null,
      responsibleEmployeeCode: row.responsibleEmployeeCode ?? null,
      responsibleEmployeeName: row.responsibleEmployeeName ?? null,
    };
  }
  if (row.employeeId === null) return null;
  return {
    kind: 'employee',
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    departmentId: null,
    departmentName: null,
    locationId: null,
    locationName: null,
    responsibleEmployeeId: null,
    responsibleEmployeeCode: null,
    responsibleEmployeeName: null,
  };
};

export const isDepartmentHolder = (holder: CustodyHolderFacts | null): boolean =>
  holder?.kind === 'department';

/**
 * A department's name without a leading «إدارة»: the screens write «إدارة {{department}}», and a
 * department named «إدارة الحسابات» in HR's own list would otherwise read «إدارة إدارة الحسابات».
 */
export const bareDepartmentName = (name: string): string =>
  name.replace(/^\s*إدارة\s+/u, '').trim() || name.trim();

/** A name in the reader's language, or the id when it could not be read — never a guess. */
const nameOr = (name: Name, id: string | null, locale: Locale): string =>
  name === null ? (id ?? '') : name[locale] || name.ar;

/** The department, as the screens write it after «إدارة» — the id when it could not be read. */
export const departmentText = (holder: CustodyHolderFacts, locale: Locale): string => {
  const name = nameOr(holder.departmentName, holder.departmentId, locale);
  return holder.departmentName === null ? name : bareDepartmentName(name);
};

/** The place — the id when it could not be read. */
export const locationText = (holder: CustodyHolderFacts, locale: Locale): string =>
  nameOr(holder.locationName, holder.locationId, locale);

/** A person as every IT screen names one: the name, else the code, else the id. */
export const personText = (name: string | null, code: string | null, id: string | null): string =>
  name ?? code ?? id ?? '';

/** The same person with the code beside the name — «وليد صفوت جلال (E1001)». */
export const personWithCode = (
  name: string | null,
  code: string | null,
  id: string | null,
): string => (name !== null && code !== null ? `${name} (${code})` : personText(name, code, id));

/** Who signed for the department, with the code beside the name. '' for an employee holder. */
export const responsibleText = (holder: CustodyHolderFacts): string =>
  holder.kind === 'department'
    ? personWithCode(
        holder.responsibleEmployeeName,
        holder.responsibleEmployeeCode,
        holder.responsibleEmployeeId,
      )
    : '';

/**
 * The holder in one line — the employee's name (else code, else id), or «إدارة … — …» for a
 * department and its place. What a cell, a hint, a dialog's description and a file write.
 */
export const holderName = (holder: CustodyHolderFacts, locale: Locale, t: Translate): string =>
  holder.kind === 'department'
    ? t('it.custody.department.heldAt', {
        department: departmentText(holder, locale),
        location: locationText(holder, locale),
      })
    : personText(holder.employeeName, holder.employeeCode, holder.employeeId);

/**
 * The holder alone — the employee's name, or «إدارة …» without its place: what a holder column
 * writes where the place and the responsible person have columns of their own.
 */
export const holderMain = (holder: CustodyHolderFacts, locale: Locale, t: Translate): string =>
  holder.kind === 'department'
    ? t('it.custody.department.name', { department: departmentText(holder, locale) })
    : personText(holder.employeeName, holder.employeeCode, holder.employeeId);

/**
 * The holder's code column in a file: the employee's code — none for a department, whose signer
 * has the «المسؤول» column, code and all.
 */
export const holderCode = (holder: CustodyHolderFacts): string | null =>
  holder.kind === 'department' ? null : holder.employeeCode;

/**
 * Where the holder's cell links: the employee's page, or — «إيه اللي في غرفة السيرفرات» — every
 * asset held at the department's place. Null when the id is not there to link with.
 */
export const holderLink = (holder: CustodyHolderFacts): string | null =>
  holder.kind === 'department'
    ? holder.locationId === null
      ? null
      : `/it/assets?location=${holder.locationId}`
    : holder.employeeId === null
      ? null
      : `/it/employees/${holder.employeeId}`;

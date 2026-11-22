// Test fixtures for department custody (2026-11-19): the holder fields every flat custody DTO now
// carries — the asset row's `holder`, an interval, a ledger row, a dashboard movement. An employee's
// row has the department's fields null; a department's has the employee's null. Imported by specs
// only. The names are invented («وليد صفوت جلال», «شريف ممدوح فاروق»): the repository is public.
import {
  type ItAssetAssignmentDto,
  type ItAssetHolderDto,
  type ItDashboardActivityItemDto,
} from '@ecms/contracts';

/** The department fields of a holder that is an employee — all null. */
export const NO_DEPARTMENT = {
  departmentId: null,
  departmentName: null,
  locationId: null,
  locationName: null,
  responsibleEmployeeId: null,
  responsibleEmployeeCode: null,
  responsibleEmployeeName: null,
} as const;

/** An interval held by an employee: the kind, and no department. */
export const EMPLOYEE_INTERVAL = {
  holderKind: 'employee',
  ...NO_DEPARTMENT,
} as const satisfies Partial<ItAssetAssignmentDto>;

/** A dashboard movement that names no department. */
export const NO_DEPARTMENT_ACTIVITY = {
  departmentId: null,
  departmentName: null,
  locationName: null,
} as const satisfies Partial<ItDashboardActivityItemDto>;

/** An asset row's holder that is an employee. */
export const employeeHolder = (
  over: Partial<ItAssetHolderDto> & Pick<ItAssetHolderDto, 'employeeId'>,
): ItAssetHolderDto => ({
  kind: 'employee',
  employeeCode: null,
  employeeName: null,
  assignedAt: '2026-10-01T09:00:00.000Z',
  ...NO_DEPARTMENT,
  ...over,
});

/** The IT department, its server room in Assiut, and who signed for it. */
export const IT_DEPARTMENT = {
  departmentId: 'd-it',
  departmentName: { ar: 'تقنية المعلومات', en: 'Information Technology' },
  locationId: 'l-servers',
  locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
  responsibleEmployeeId: 'e-sherif',
  responsibleEmployeeCode: '0100077',
  responsibleEmployeeName: 'شريف ممدوح فاروق',
} as const;

/** An asset row's holder that is a department at a place. */
export const departmentHolder = (over: Partial<ItAssetHolderDto> = {}): ItAssetHolderDto => ({
  kind: 'department',
  employeeId: null,
  employeeCode: null,
  employeeName: null,
  ...IT_DEPARTMENT,
  departmentName: { ...IT_DEPARTMENT.departmentName },
  locationName: { ...IT_DEPARTMENT.locationName },
  assignedAt: '2026-11-19T09:00:00.000Z',
  ...over,
});

// The warehouse form's state (design §2.3.5, OD-10 A), mirroring the contracts: what the dialog
// holds, which values are missing or wrong, the body a create sends, and the fields an edit
// changes. Pure, so a spec proves each payload and each mark without a browser.
//
// The branch is chosen once: a warehouse never changes branch (the update schema has no
// `branchId`), so an edit sends none. The code is typed, in the org units' pattern. The department
// is optional and reference-only, one of the branch's own copies; the keeper is optional and is
// somebody who works here today — the picker offers no one else, and the server refuses a leaver.
import {
  AdministrationWarehouseCodeSchema,
  ADMINISTRATION_WAREHOUSE_TYPES,
  type AdministrationWarehouseDto,
  type AdministrationWarehouseType,
  type CreateAdministrationWarehouse,
  type OrgUnitOptionDto,
  type UpdateAdministrationWarehouse,
} from '@ecms/contracts';

/** The contracts' bounds, so a long value stops at the box rather than at a 400. */
export const WAREHOUSE_CODE_MAX = 20;
export const LOCATION_MAX = 200;
export const WAREHOUSE_NOTES_MAX = 2000;

export interface WarehouseForm {
  code: string;
  nameAr: string;
  nameEn: string;
  branchId: string;
  /** '' until one is chosen: no kind of store is assumed. */
  type: AdministrationWarehouseType | '';
  departmentId: string;
  /** The keeper's employee id, '' for none. */
  keeperId: string;
  location: string;
  notes: string;
  isActive: boolean;
}

export const warehouseFormFrom = (warehouse: AdministrationWarehouseDto | null): WarehouseForm => ({
  code: warehouse?.code ?? '',
  nameAr: warehouse?.name.ar ?? '',
  nameEn: warehouse?.name.en ?? '',
  branchId: warehouse?.branchId ?? '',
  type: warehouse?.type ?? '',
  departmentId: warehouse?.departmentId ?? '',
  keeperId: warehouse?.responsibleEmployeeId ?? '',
  location: warehouse?.location ?? '',
  notes: warehouse?.notes ?? '',
  isActive: warehouse?.isActive ?? true,
});

export const isWarehouseType = (value: string): value is AdministrationWarehouseType =>
  (ADMINISTRATION_WAREHOUSE_TYPES as readonly string[]).includes(value);

/** The code as the contract takes it: upper-case letters and digits, a dash inside, up to 20. */
export const warehouseCodeOk = (code: string): boolean =>
  AdministrationWarehouseCodeSchema.safeParse(code).success;

/** The values a warehouse cannot be saved without (`CreateAdministrationWarehouseSchema`). */
export const warehouseRequired = (
  form: WarehouseForm,
): Record<'code' | 'nameAr' | 'nameEn' | 'branchId' | 'type', boolean> => ({
  code: form.code.trim() !== '',
  nameAr: form.nameAr.trim() !== '',
  nameEn: form.nameEn.trim() !== '',
  branchId: form.branchId !== '',
  type: form.type !== '',
});

/**
 * The departments a warehouse may name: the copies in its own branch (the server refuses any
 * other), and the one it already names whatever it has become, so an edit never drops it.
 */
export const branchDepartments = (
  departments: readonly OrgUnitOptionDto[],
  branchId: string,
  current: string,
): OrgUnitOptionDto[] =>
  departments.filter(
    (department) =>
      (branchId !== '' && department.parentId === branchId) || department.id === current,
  );

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * The create's body. Called once every required value is in (`warehouseRequired`): no kind of store
 * is ever assumed, so a form without one is a bug of the caller's, not a store of some kind.
 */
export const warehouseCreateBody = (form: WarehouseForm): CreateAdministrationWarehouse => {
  if (!isWarehouseType(form.type)) throw new Error('a warehouse is created with its type chosen');
  const body: CreateAdministrationWarehouse = {
    code: form.code.trim(),
    name: { ar: form.nameAr.trim(), en: form.nameEn.trim() },
    branchId: form.branchId,
    type: form.type,
  };
  if (form.departmentId !== '') body.departmentId = form.departmentId;
  if (form.keeperId !== '') body.responsibleEmployeeId = form.keeperId;
  const location = orNull(form.location);
  if (location !== null) body.location = location;
  const notes = orNull(form.notes);
  if (notes !== null) body.notes = notes;
  return body;
};

/** What an edit changes — only the facts that moved; never the branch. */
export const warehouseChanges = (
  form: WarehouseForm,
  warehouse: AdministrationWarehouseDto,
): Omit<UpdateAdministrationWarehouse, 'version'> => {
  const changes: Omit<UpdateAdministrationWarehouse, 'version'> = {};
  const code = form.code.trim();
  if (code !== warehouse.code) changes.code = code;
  const name = { ar: form.nameAr.trim(), en: form.nameEn.trim() };
  if (name.ar !== warehouse.name.ar || name.en !== warehouse.name.en) changes.name = name;
  if (isWarehouseType(form.type) && form.type !== warehouse.type) changes.type = form.type;
  const departmentId = form.departmentId === '' ? null : form.departmentId;
  if (departmentId !== warehouse.departmentId) changes.departmentId = departmentId;
  const keeperId = form.keeperId === '' ? null : form.keeperId;
  if (keeperId !== warehouse.responsibleEmployeeId) changes.responsibleEmployeeId = keeperId;
  const location = orNull(form.location);
  if (location !== warehouse.location) changes.location = location;
  const notes = orNull(form.notes);
  if (notes !== warehouse.notes) changes.notes = notes;
  if (form.isActive !== warehouse.isActive) changes.isActive = form.isActive;
  return changes;
};

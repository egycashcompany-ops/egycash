// A warehouse (design §2.3.5, OD-10 A): open a store in a branch, or correct one — opened from the
// register, never a route. Written after IT's `ConsumableFormDialog`, with the module's frame.
//
// THE BRANCH is chosen once and never changes: from P5 the ledger copies it onto every row, so a
// store that moves branch is a new warehouse, and an edit shows it without letting it change. The
// branches offered are those the server says the reader may open a store in (`canCreate` of
// `/administration/warehouses/branch-options`) — the web cannot work out a key's reach per branch,
// and the top bar's choice decides where a new store is filed (ADR-028).
//
// THE DEPARTMENT is optional and reference-only — it grants nothing — and is one of the branch's
// own copies; the one a store already names stays offered, marked when it has since been retired.
// THE KEEPER («أمين المخزن») is optional and is somebody who works here today, found
// through the module's own picker; a keeper who has since left is still shown, as one, until a new
// keeper is named, and a keeper HR no longer knows is flagged the same way (OD-64 keeper (i)).
//
// A save refused because someone saved the store meanwhile (`STALE_DOCUMENT`) rebases the form on
// the store as it now is: the refusal stays in the alert box, the boxes show what was saved, and
// the next Save is judged against that version rather than refused again.
import { useEffect, useMemo, useState } from 'react';
import {
  ADMINISTRATION_WAREHOUSE_TYPES,
  type AdministrationWarehouseDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateWarehouse,
  useDepartmentNames,
  useDepartmentOptions,
  useRereadWarehouse,
  useUpdateWarehouse,
  useWarehouseBranchOptions,
} from '../api/warehouses-queries';
import { NAME_MAX } from '../lib/catalog-form';
import {
  carryEdits,
  fieldRefusal,
  isStaleRefusal,
  refusalFieldKeys,
  type RefusalField,
} from '../lib/refusals';
import {
  LOCATION_MAX,
  WAREHOUSE_CODE_MAX,
  WAREHOUSE_NOTES_MAX,
  branchDepartments,
  isWarehouseType,
  storedDepartmentRetired,
  warehouseChanges,
  warehouseCodeOk,
  warehouseCreateBody,
  warehouseFormFrom,
  warehouseRequired,
  type WarehouseForm,
} from '../lib/warehouse-form';
import { AdministrationDialogFrame } from './AdministrationDialogFrame';
import { EmployeePicker, pickerLabel } from './EmployeePicker';

/** The chip a stored keeper wears: their name and code, or the flag for a keeper HR cannot name. */
export const storedKeeperLabel = (
  warehouse: AdministrationWarehouseDto | null,
  t: (key: string) => string,
): string => {
  if (warehouse === null || warehouse.responsibleEmployeeId === null) return '';
  if (warehouse.keeper === null) return t('administration.warehouses.keeperUnknown');
  const label = pickerLabel(warehouse.keeper);
  return warehouse.keeper.status === 'exited'
    ? `${label} — ${t('administration.people.exited')}`
    : label;
};

export const WarehouseFormDialog = ({
  open,
  onClose,
  warehouse,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new warehouse. */
  warehouse: AdministrationWarehouseDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The store as a stale save re-read it, kept only while the form edits that same store; else the
  // one the form opened with.
  const [rebased, setRebased] = useState<AdministrationWarehouseDto | null>(null);
  const base = warehouse !== null && rebased?.id === warehouse.id ? rebased : warehouse;
  const [form, setForm] = useState<WarehouseForm>(warehouseFormFrom(warehouse));
  const [keeperLabel, setKeeperLabel] = useState(storedKeeperLabel(warehouse, t));
  const [failure, setFailure] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRebased(null);
    setForm(warehouseFormFrom(warehouse));
    setKeeperLabel(storedKeeperLabel(warehouse, t));
    setFailure(null);
    setTried(false);
  }, [open, warehouse]);
  const set = <K extends keyof WarehouseForm>(key: K, value: WarehouseForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const branches = useWarehouseBranchOptions(open && base === null);
  const departments = useDepartmentOptions(open);
  const storedDepartment = base?.departmentId ?? '';
  // Asked only when the stored department is missing from the active list — retired since.
  const departmentNames = useDepartmentNames(
    open && storedDepartmentRetired(departments.data, storedDepartment),
  );
  const creatable = (branches.data ?? []).filter((branch) => branch.canCreate);
  const departmentChoices = useMemo(
    () =>
      branchDepartments(
        departments.data ?? [],
        departmentNames.data ?? [],
        form.branchId,
        storedDepartment,
      ),
    [departments.data, departmentNames.data, form.branchId, storedDepartment],
  );
  // A stored department no read names (gone, or not answered yet) still holds its value, so the
  // box never shows another option as the store's department.
  const departmentUnnamed =
    form.departmentId !== '' &&
    !departmentChoices.some((choice) => choice.department.id === form.departmentId);
  const rereadWarehouse = useRereadWarehouse();

  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();
  const filled = warehouseRequired(form);
  const required = useRequiredFields(
    [
      { key: 'code', label: t('administration.warehouses.fields.code'), ok: filled.code },
      { key: 'nameAr', label: t('administration.warehouses.fields.nameAr'), ok: filled.nameAr },
      { key: 'nameEn', label: t('administration.warehouses.fields.nameEn'), ok: filled.nameEn },
      { key: 'branchId', label: t('administration.warehouses.fields.branch'), ok: filled.branchId },
      { key: 'type', label: t('administration.warehouses.fields.type'), ok: filled.type },
    ],
    open,
  );
  // Said once Save has been pressed — also while other values are missing, so one press names
  // everything that stops the save.
  const codeWrong =
    (tried || required.attempt > 0) && filled.code && !warehouseCodeOk(form.code.trim());
  const refused = refusalFieldKeys(failure);
  const refusedWord = (field: RefusalField): string | undefined => fieldRefusal(refused, field, t);

  const save = async (): Promise<void> => {
    setTried(true);
    if (!warehouseCodeOk(form.code.trim())) return;
    setFailure(null);
    try {
      if (base === null) {
        await create.mutateAsync(warehouseCreateBody(form));
        toast.success(t('administration.warehouses.created'));
      } else {
        await update.mutateAsync({
          id: base.id,
          body: { ...warehouseChanges(form, base), version: base.version },
        });
        toast.success(t('administration.warehouses.updated'));
      }
      onClose();
    } catch (error) {
      setFailure(error);
      if (base !== null && isStaleRefusal(error)) {
        const fresh = await rereadWarehouse(base.id).catch(() => null);
        if (fresh !== null) {
          const opened = warehouseFormFrom(base);
          setRebased(fresh);
          setForm(carryEdits(opened, form, warehouseFormFrom(fresh)));
          // The keeper box names the keeper it holds: the reader's pick if they changed it, else
          // the one the record now names.
          if (form.keeperId === opened.keeperId) setKeeperLabel(storedKeeperLabel(fresh, t));
        }
      }
    }
  };

  return (
    <AdministrationDialogFrame
      open={open}
      onClose={onClose}
      size="lg"
      tall
      title={
        base === null ? t('administration.warehouses.create') : t('administration.warehouses.edit')
      }
      {...(base === null ? {} : { description: `${localized(base.name, locale)} — ${base.code}` })}
      required={required}
      onSave={save}
      busy={create.isPending || update.isPending}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('administration.warehouses.fields.code')}
          required
          missing={required.isMissing('code')}
          hint={t('administration.warehouses.fields.codeHint')}
          error={codeWrong ? t('administration.warehouses.errors.code') : refusedWord('code')}
        >
          <Input
            dir="ltr"
            value={form.code}
            maxLength={WAREHOUSE_CODE_MAX}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            error={codeWrong || refused.code !== undefined}
          />
        </Field>
        <Field
          label={t('administration.warehouses.fields.type')}
          required
          missing={required.isMissing('type')}
        >
          <Select
            value={form.type}
            onChange={(e) => set('type', isWarehouseType(e.target.value) ? e.target.value : '')}
          >
            <option value="">{t('common.select')}</option>
            {ADMINISTRATION_WAREHOUSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`administration.warehouses.type.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('administration.warehouses.fields.nameAr')}
          required
          missing={required.isMissing('nameAr')}
          error={refusedWord('nameAr')}
        >
          <Input
            dir="rtl"
            value={form.nameAr}
            maxLength={NAME_MAX}
            onChange={(e) => set('nameAr', e.target.value)}
          />
        </Field>
        <Field
          label={t('administration.warehouses.fields.nameEn')}
          required
          missing={required.isMissing('nameEn')}
        >
          <Input
            dir="ltr"
            value={form.nameEn}
            maxLength={NAME_MAX}
            onChange={(e) => set('nameEn', e.target.value)}
          />
        </Field>
        <Field
          label={t('administration.warehouses.fields.branch')}
          required
          missing={required.isMissing('branchId')}
          hint={
            base === null
              ? t('administration.warehouses.fields.branchHint')
              : t('administration.warehouses.fields.branchFixed')
          }
          error={refusedWord('branchId')}
        >
          {base === null ? (
            <Select
              value={form.branchId}
              onChange={(e) => {
                const branchId = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  branchId,
                  // A department belongs to its branch: another branch's copy cannot stay.
                  departmentId: (departments.data ?? []).some(
                    (d) => d.id === prev.departmentId && d.parentId === branchId,
                  )
                    ? prev.departmentId
                    : '',
                }));
              }}
            >
              <option value="">{t('common.select')}</option>
              {creatable.map((branch) => (
                <option key={branch.branchId} value={branch.branchId}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          ) : (
            <Select value={base.branchId} disabled>
              <option value={base.branchId}>
                {base.branchName === null ? '—' : localized(base.branchName, locale)}
              </option>
            </Select>
          )}
        </Field>
        <Field
          label={t('administration.warehouses.fields.department')}
          hint={t('administration.warehouses.fields.departmentHint')}
        >
          <Select
            value={form.departmentId}
            disabled={form.branchId === ''}
            onChange={(e) => set('departmentId', e.target.value)}
          >
            <option value="">{t('administration.warehouses.noDepartment')}</option>
            {departmentUnnamed && <option value={form.departmentId}>—</option>}
            {departmentChoices.map(({ department, retired }) => (
              <option key={department.id} value={department.id}>
                {retired
                  ? `${localized(department.name, locale)} — ${t('administration.status.inactive')}`
                  : localized(department.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label={t('administration.warehouses.fields.keeper')}
        hint={t('administration.warehouses.fields.keeperHint')}
        error={refusedWord('responsibleEmployeeId')}
      >
        <EmployeePicker
          value={form.keeperId}
          valueLabel={keeperLabel}
          onChange={(employeeId, label) => {
            set('keeperId', employeeId);
            setKeeperLabel(label);
          }}
          error={refused.responsibleEmployeeId !== undefined}
        />
      </Field>
      <Field label={t('administration.warehouses.fields.location')}>
        <Input
          value={form.location}
          maxLength={LOCATION_MAX}
          onChange={(e) => set('location', e.target.value)}
        />
      </Field>
      <Field label={t('administration.warehouses.fields.notes')}>
        <Textarea
          rows={2}
          value={form.notes}
          maxLength={WAREHOUSE_NOTES_MAX}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>
      {base !== null && (
        <Field error={refusedWord('isActive')}>
          <Checkbox
            label={t('administration.warehouses.fields.isActive')}
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
        </Field>
      )}
    </AdministrationDialogFrame>
  );
};

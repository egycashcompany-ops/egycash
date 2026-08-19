// Create/edit vehicle dialog (FR-1 identity + license + placement + radio). One controlled form
// for both modes; the server owns every rule — uniqueness (FR-1), reference validity, lifecycle,
// scoping — so this form only shapes the payload and surfaces the API's verdicts. Optional fields
// submit as null when cleared: an emptied field is an erased fact, not an untouched one.
//
// Three of its selects read LIVE fleet catalogs (license class, operation, insurer): no option is
// written here, and an admin adding a value in /fleet/catalogs sees it in this form immediately.
import { useEffect, useState } from 'react';
import { type FleetVehicleDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import {
  useCreateVehicle,
  useDefaultVehicleBranch,
  useUpdateVehicle,
  useUploadVehicleLicenseImage,
  useVehicleTypes,
} from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { LICENSE_IMAGE_ACCEPT, LicenseImagePreviewDialog } from './VehicleLicenseImage';

interface FormState {
  code: string;
  typeId: string;
  plateNumber: string;
  chassisNumber: string;
  motorNumber: string;
  joinedAt: string;
  licenseExpiresAt: string;
  licenseClassId: string;
  operationId: string;
  insuranceCompanyId: string;
  branchId: string;
  issi: string;
  motorolaSn: string;
}

const day = (iso: string): string => iso.slice(0, 10);

const fromVehicle = (vehicle: FleetVehicleDto | null): FormState => ({
  code: vehicle?.code ?? '',
  typeId: vehicle?.typeId ?? '',
  plateNumber: vehicle?.plateNumber ?? '',
  chassisNumber: vehicle?.chassisNumber ?? '',
  motorNumber: vehicle?.motorNumber ?? '',
  joinedAt: vehicle === null ? '' : day(vehicle.joinedAt),
  licenseExpiresAt: vehicle === null ? '' : day(vehicle.licenseExpiresAt),
  licenseClassId: vehicle?.licenseClassId ?? '',
  operationId: vehicle?.operationId ?? '',
  insuranceCompanyId: vehicle?.insuranceCompanyId ?? '',
  branchId: vehicle?.branchId ?? '',
  issi: vehicle?.radio.issi ?? '',
  motorolaSn: vehicle?.radio.motorolaSn ?? '',
});

export const VehicleFormDialog = ({
  open,
  onClose,
  vehicle,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  vehicle: FleetVehicleDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [form, setForm] = useState<FormState>(fromVehicle(vehicle));
  // Create mode only: the picked scan is uploaded AFTER the vehicle exists, because a file is
  // attached to an entity and there is no entity to attach it to until the create succeeds.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const types = useVehicleTypes();
  const { data: branches = [] } = useBranches(can('branch.view'));
  const defaultBranch = useDefaultVehicleBranch(open && vehicle === null);
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const uploadImage = useUploadVehicleLicenseImage();
  const busy = create.isPending || update.isPending || uploadImage.isPending;

  useEffect(() => {
    if (open) {
      setForm(fromVehicle(vehicle));
      setPendingImage(null);
    }
  }, [open, vehicle]);

  // Preselect the configured default branch (§2.1) once the server answers, and only while the
  // user has not chosen one — a resolved default must never overwrite a deliberate pick, nor
  // touch an existing vehicle's branch.
  const defaultBranchId = defaultBranch.data?.branchId ?? null;
  useEffect(() => {
    if (!open || vehicle !== null || defaultBranchId === null) return;
    setForm((prev) => (prev.branchId === '' ? { ...prev, branchId: defaultBranchId } : prev));
  }, [open, vehicle, defaultBranchId]);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Branch joins the required set: the API refuses a branchless vehicle, so the form does too
  // rather than letting the user submit into a 422.
  const complete =
    form.code.trim() !== '' &&
    form.typeId !== '' &&
    form.plateNumber.trim() !== '' &&
    form.chassisNumber.trim() !== '' &&
    form.motorNumber.trim() !== '' &&
    form.joinedAt !== '' &&
    form.licenseExpiresAt !== '' &&
    form.branchId !== '';

  const submit = async (): Promise<void> => {
    const opt = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    const ref = (value: string): string | null => (value === '' ? null : value);
    const core = {
      code: form.code.trim(),
      typeId: form.typeId,
      plateNumber: form.plateNumber.trim(),
      chassisNumber: form.chassisNumber.trim(),
      motorNumber: form.motorNumber.trim(),
      joinedAt: new Date(form.joinedAt),
      licenseExpiresAt: new Date(form.licenseExpiresAt),
      licenseClassId: ref(form.licenseClassId),
      operationId: ref(form.operationId),
      insuranceCompanyId: ref(form.insuranceCompanyId),
      branchId: form.branchId,
      radio: { issi: opt(form.issi), motorolaSn: opt(form.motorolaSn) },
    };
    if (vehicle === null) {
      const created = await create.mutateAsync(core);
      toast.success(t('fleet.vehicles.created'));
      if (pendingImage !== null) {
        // A failed image upload must not read as a failed create — the vehicle exists either way,
        // and the registry offers the upload action again on its row.
        try {
          await uploadImage.mutateAsync({ id: created.id, file: pendingImage });
          toast.success(t('fleet.vehicles.licenseImage.uploaded'));
        } catch {
          toast.error(t('fleet.vehicles.licenseImage.uploadFailedAfterCreate'));
        }
      }
    } else {
      await update.mutateAsync({ id: vehicle.id, body: { ...core, version: vehicle.version } });
      toast.success(t('fleet.vehicles.updated'));
    }
    onClose();
  };

  const replaceImage = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    if (vehicle === null) {
      setPendingImage(file);
      return;
    }
    await uploadImage.mutateAsync({ id: vehicle.id, file });
    toast.success(t('fleet.vehicles.licenseImage.uploaded'));
  };

  const hasImage = vehicle?.licenseImage != null;
  const typeName =
    (types.data?.items ?? []).find((type) => type.id === form.typeId)?.name ?? null;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={vehicle === null ? t('fleet.vehicles.create') : t('fleet.vehicles.edit')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={!complete} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.vehicles.fields.code')} required>
            <Input value={form.code} onChange={(e) => set('code')(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('fleet.vehicles.fields.type')} required>
            <Select value={form.typeId} onChange={(e) => set('typeId')(e.target.value)}>
              <option value="">{t('common.select')}</option>
              {(types.data?.items ?? [])
                .filter((type) => type.isActive || type.id === vehicle?.typeId)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {localized(type.name, locale)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('fleet.vehicles.fields.plate')} required>
            <Input value={form.plateNumber} onChange={(e) => set('plateNumber')(e.target.value)} />
          </Field>
          <Field label={t('fleet.vehicles.fields.chassis')} required>
            <Input
              value={form.chassisNumber}
              onChange={(e) => set('chassisNumber')(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.vehicles.fields.motor')} required>
            <Input
              value={form.motorNumber}
              onChange={(e) => set('motorNumber')(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.vehicles.fields.joinedAt')} required>
            <Input
              type="date"
              value={form.joinedAt}
              onChange={(e) => set('joinedAt')(e.target.value)}
            />
          </Field>
          <Field label={t('fleet.vehicles.fields.licenseExpiresAt')} required>
            <Input
              type="date"
              value={form.licenseExpiresAt}
              onChange={(e) => set('licenseExpiresAt')(e.target.value)}
            />
          </Field>
          <Field
            label={t('fleet.vehicles.fields.licenseClass')}
            hint={t('fleet.vehicles.fields.catalogHint')}
          >
            <CatalogSelect
              kind="licenseClass"
              value={form.licenseClassId}
              onChange={set('licenseClassId')}
              ariaLabel={t('fleet.vehicles.fields.licenseClass')}
            />
          </Field>
          <Field
            label={t('fleet.vehicles.fields.operation')}
            hint={t('fleet.vehicles.fields.catalogHint')}
          >
            <CatalogSelect
              kind="operation"
              value={form.operationId}
              onChange={set('operationId')}
              ariaLabel={t('fleet.vehicles.fields.operation')}
            />
          </Field>
          <Field
            label={t('fleet.vehicles.fields.insuranceCompany')}
            hint={t('fleet.vehicles.fields.catalogHint')}
          >
            <CatalogSelect
              kind="insuranceCompany"
              value={form.insuranceCompanyId}
              onChange={set('insuranceCompanyId')}
              ariaLabel={t('fleet.vehicles.fields.insuranceCompany')}
            />
          </Field>
          {/*
            The branch select renders for EVERY user, unlike the optional org fields elsewhere:
            the field is required, so hiding it behind `branch.view` would leave a user unable to
            complete the form at all. Without that permission the branch list is empty and the
            hint says who to ask — which is honest about why, instead of silently failing.
          */}
          <Field
            label={t('fleet.vehicles.fields.branch')}
            required
            hint={
              can('branch.view')
                ? (defaultBranch.data?.branchId == null && vehicle === null
                    ? t('fleet.vehicles.fields.defaultBranchMissing', {
                        name: defaultBranch.data?.configuredName ?? '',
                      })
                    : undefined)
                : t('fleet.vehicles.fields.branchNoPermission')
            }
          >
            <Select value={form.branchId} onChange={(e) => set('branchId')(e.target.value)}>
              <option value="">{t('common.select')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fleet.vehicles.fields.issi')}>
            <Input value={form.issi} onChange={(e) => set('issi')(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('fleet.vehicles.fields.motorolaSn')}>
            <Input
              value={form.motorolaSn}
              onChange={(e) => set('motorolaSn')(e.target.value)}
              dir="ltr"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label={t('fleet.vehicles.licenseImage.label')}
              hint={t('fleet.vehicles.licenseImage.hint')}
            >
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  {hasImage
                    ? t('fleet.vehicles.licenseImage.replace')
                    : t('fleet.vehicles.licenseImage.upload')}
                  <input
                    type="file"
                    accept={LICENSE_IMAGE_ACCEPT}
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => void replaceImage(e.target.files?.[0])}
                  />
                </label>
                {hasImage && (
                  <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(true)}>
                    {t('fleet.vehicles.licenseImage.view')}
                  </Button>
                )}
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {pendingImage !== null
                    ? t('fleet.vehicles.licenseImage.pending', { name: pendingImage.name })
                    : hasImage
                      ? (vehicle?.licenseImage?.fileName ?? '')
                      : t('fleet.vehicles.licenseImage.none')}
                </span>
              </div>
            </Field>
          </div>
        </div>
      </Dialog>

      <LicenseImagePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        vehicle={vehicle}
        typeName={typeName === null ? '' : localized(typeName, locale)}
      />
    </>
  );
};

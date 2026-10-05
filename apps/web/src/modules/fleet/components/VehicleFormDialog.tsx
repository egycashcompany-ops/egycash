// Create/edit vehicle dialog (FR-1 identity + license + placement + radio). One controlled form
// for both modes; the server owns every rule — uniqueness (FR-1), reference validity, lifecycle,
// scoping — so this form only shapes the payload and surfaces the API's verdicts. Optional fields
// submit as null when cleared: an emptied field is an erased fact, not an untouched one.
//
// Three of its selects read LIVE fleet catalogs (license class, operation, insurer): no option is
// written here, and an admin adding a value in /fleet/catalogs sees it in this form immediately.
import { useEffect, useMemo, useState } from 'react';
import { type FleetVehicleDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { createPortal } from 'react-dom';
import { Input, Select } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { cn } from '../../../shared/lib/cn';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import {
  useCreateVehicle,
  useDefaultVehicleBranch,
  useFleetCatalog,
  useUpdateVehicle,
  useUploadVehicleLicenseImage,
  useVehicleTypes,
} from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { counterpartClass, letterFlipped } from '../lib/license-class-flip';
import { LICENSE_IMAGE_ACCEPT, LicenseImagePreviewDialog } from './VehicleLicenseImage';
import {
  CLOSE_PATH,
  DATE_ICON,
  DesignField,
  LOOK,
  MONO,
  SANS,
  Stroke,
  boxTone,
} from './FuelCardDialog';
import { PATH } from './FuelCardBoard';

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

  // THE LICENCE LETTER AND ITS DATE MOVE TOGETHER (`license-class-flip.ts`) — on an existing car
  // only: a new one has no «before» to compare with.
  const licenseClasses = useFleetCatalog('licenseClass');
  const classItems = useMemo(
    () => (licenseClasses.data?.items ?? []).map((item) => ({ id: item.id, name: item.name.ar })),
    [licenseClasses.data],
  );
  const [classTouched, setClassTouched] = useState(false);
  useEffect(() => {
    if (open) setClassTouched(false);
  }, [open, vehicle]);
  const initialClassId = vehicle?.licenseClassId ?? '';
  const initialExpiry = vehicle === null ? '' : day(vehicle.licenseExpiresAt);
  const dateMoved = form.licenseExpiresAt !== initialExpiry;
  // «يجيب انذار انه لازم يعدل تاريخ انتهاء الترخيص» — and refuses the save until it is.
  const classFlippedOnOldDate =
    vehicle !== null &&
    !dateMoved &&
    letterFlipped(classItems, initialClassId, form.licenseClassId);
  const pickClass = (id: string): void => {
    setClassTouched(true);
    set('licenseClassId')(id);
  };
  // «ولو عدل التاريخ تلقائى لو م تبقى ت ولو ت تبقى م» — while the class was not picked by hand.
  const pickExpiry = (value: string): void => {
    setForm((prev) => {
      if (vehicle === null || classTouched) return { ...prev, licenseExpiresAt: value };
      const flipped = counterpartClass(classItems, initialClassId);
      const licenseClassId =
        value !== initialExpiry && flipped !== null ? flipped.id : initialClassId;
      return { ...prev, licenseExpiresAt: value, licenseClassId };
    });
  };

  // Branch joins the required set: the API refuses a branchless vehicle, so the form does too
  // rather than letting the user submit into a 422. Save stays pressable: pressing it with any of
  // these empty names them and turns their boxes red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'code', label: t('fleet.vehicles.fields.code'), ok: form.code.trim() !== '' },
      { key: 'type', label: t('fleet.vehicles.fields.type'), ok: form.typeId !== '' },
      { key: 'plate', label: t('fleet.vehicles.fields.plate'), ok: form.plateNumber.trim() !== '' },
      {
        key: 'chassis',
        label: t('fleet.vehicles.fields.chassis'),
        ok: form.chassisNumber.trim() !== '',
      },
      { key: 'motor', label: t('fleet.vehicles.fields.motor'), ok: form.motorNumber.trim() !== '' },
      { key: 'joinedAt', label: t('fleet.vehicles.fields.joinedAt'), ok: form.joinedAt !== '' },
      {
        key: 'licenseExpiresAt',
        label: t('fleet.vehicles.fields.licenseExpiresAt'),
        ok: form.licenseExpiresAt !== '' && !classFlippedOnOldDate,
      },
      { key: 'branch', label: t('fleet.vehicles.fields.branch'), ok: form.branchId !== '' },
    ],
    open,
  );

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

  const branchHint = can('branch.view')
    ? defaultBranch.data?.branchId == null && vehicle === null
      ? t('fleet.vehicles.fields.defaultBranchMissing', {
          name: defaultBranch.data?.configuredName ?? '',
        })
      : undefined
    : t('fleet.vehicles.fields.branchNoPermission');

  const hasImage = vehicle?.licenseImage != null;
  const typeName = (types.data?.items ?? []).find((type) => type.id === form.typeId)?.name ?? null;

  // «فورم إضافة سياره اعملها بقى زى شاشة الشحن»: the add/edit card dialog's design — its panel,
  // header, sections and boxes — around the same fields, rules and required marks as before.
  useEffect(() => {
    if (!open) return undefined;
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, onClose]);

  const look = LOOK.add;
  const box = boxTone(look);
  // A `<select>` takes no tone of its own — the same box, forced over the control's base; red
  // with the design's glow while a required one is empty.
  const selectBox = (missing = false): string =>
    cn(
      '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
      missing
        ? '!border-rose-500/70 !bg-slate-50 shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)] dark:!bg-[#0a1233]'
        : '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
    );
  // A date's text starts at the box's left, where a refused box draws its «!».
  const dateBox = cn(box, MONO, DATE_ICON.add, 'cursor-pointer !pl-10');
  const heading = (text: string, icon: readonly string[]): JSX.Element => (
    <h3 className="flex items-center gap-2 border-b border-slate-200 pb-2 text-[15px] font-bold text-slate-900 dark:border-[#2b3b6b]/60 dark:text-white">
      <Stroke d={[...icon]} className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
      {text}
    </h3>
  );
  const title = vehicle === null ? t('fleet.vehicles.create') : t('fleet.vehicles.edit');

  return (
    <>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-3 sm:p-4">
            <div
              className="fixed inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-md dark:bg-[#03060c]/80"
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              data-vehicle-form="true"
              className={cn(
                SANS,
                'relative my-auto w-full animate-pop-in overflow-hidden rounded-2xl border text-slate-900 antialiased dark:text-slate-100',
                look.panel,
                '!max-w-3xl',
              )}
            >
              <header
                className={cn('flex items-center justify-between border-b px-6', look.header)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn('flex items-center justify-center rounded-xl border', look.icon)}
                  >
                    <Stroke d={[...PATH.truck]} className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-wide text-slate-900 dark:text-white">
                      {title}
                    </h2>
                    <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                      {vehicle === null
                        ? t('fleet.vehicles.form.subtitleCreate')
                        : t('fleet.vehicles.form.subtitleEdit', { code: vehicle.code })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  className={cn(
                    'flex items-center text-slate-400 transition-all hover:text-slate-900 focus:outline-none dark:hover:text-white',
                    look.close,
                  )}
                >
                  <Stroke d={CLOSE_PATH} className="h-5 w-5" />
                </button>
              </header>

              <div className={cn('max-h-[calc(100vh-9rem)] space-y-7 overflow-y-auto', look.body)}>
                <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />

                <section className="space-y-4">
                  {heading(t('fleet.vehicles.form.sections.car'), PATH.truck)}
                  <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                    <DesignField
                      label={t('fleet.vehicles.fields.code')}
                      required
                      missing={required.isMissing('code')}
                    >
                      <Input
                        value={form.code}
                        onChange={(e) => set('code')(e.target.value)}
                        dir="ltr"
                        tone={cn(box, MONO, 'text-right')}
                      />
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.type')}
                      required
                      missing={required.isMissing('type')}
                    >
                      <Select
                        value={form.typeId}
                        onChange={(e) => set('typeId')(e.target.value)}
                        className={selectBox(required.isMissing('type'))}
                      >
                        <option value="">{t('common.select')}</option>
                        {(types.data?.items ?? [])
                          .filter((type) => type.isActive || type.id === vehicle?.typeId)
                          .map((type) => (
                            <option key={type.id} value={type.id}>
                              {localized(type.name, locale)}
                            </option>
                          ))}
                      </Select>
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.plate')}
                      required
                      missing={required.isMissing('plate')}
                    >
                      <Input
                        value={form.plateNumber}
                        onChange={(e) => set('plateNumber')(e.target.value)}
                        rule="plate"
                        tone={box}
                      />
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.chassis')}
                      required
                      missing={required.isMissing('chassis')}
                    >
                      <Input
                        value={form.chassisNumber}
                        onChange={(e) => set('chassisNumber')(e.target.value)}
                        rule="english"
                        tone={cn(box, MONO)}
                      />
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.motor')}
                      required
                      missing={required.isMissing('motor')}
                    >
                      <Input
                        value={form.motorNumber}
                        onChange={(e) => set('motorNumber')(e.target.value)}
                        rule="english"
                        tone={cn(box, MONO)}
                      />
                    </DesignField>
                  </div>
                </section>

                <section className="space-y-4">
                  {heading(t('fleet.vehicles.form.sections.licence'), PATH.calendar)}
                  <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                    <DesignField
                      label={t('fleet.vehicles.fields.joinedAt')}
                      required
                      missing={required.isMissing('joinedAt')}
                    >
                      <Input
                        type="date"
                        value={form.joinedAt}
                        onChange={(e) => set('joinedAt')(e.target.value)}
                        tone={dateBox}
                      />
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.licenseExpiresAt')}
                      required
                      missing={required.isMissing('licenseExpiresAt')}
                      error={
                        classFlippedOnOldDate
                          ? t('fleet.vehicles.licenseClassNeedsDate')
                          : undefined
                      }
                    >
                      <Input
                        type="date"
                        value={form.licenseExpiresAt}
                        onChange={(e) => pickExpiry(e.target.value)}
                        tone={dateBox}
                      />
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.licenseClass')}
                      hint={t('fleet.vehicles.fields.catalogHint')}
                    >
                      <CatalogSelect
                        kind="licenseClass"
                        value={form.licenseClassId}
                        onChange={pickClass}
                        ariaLabel={t('fleet.vehicles.fields.licenseClass')}
                        className={selectBox()}
                      />
                    </DesignField>
                  </div>
                </section>

                <section className="space-y-4">
                  {heading(t('fleet.vehicles.form.sections.assignment'), PATH.box)}
                  <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                    <DesignField
                      label={t('fleet.vehicles.fields.operation')}
                      hint={t('fleet.vehicles.fields.catalogHint')}
                    >
                      <CatalogSelect
                        kind="operation"
                        value={form.operationId}
                        onChange={set('operationId')}
                        ariaLabel={t('fleet.vehicles.fields.operation')}
                        className={selectBox()}
                      />
                    </DesignField>
                    <DesignField
                      label={t('fleet.vehicles.fields.insuranceCompany')}
                      hint={t('fleet.vehicles.fields.catalogHint')}
                    >
                      <CatalogSelect
                        kind="insuranceCompany"
                        value={form.insuranceCompanyId}
                        onChange={set('insuranceCompanyId')}
                        ariaLabel={t('fleet.vehicles.fields.insuranceCompany')}
                        className={selectBox()}
                      />
                    </DesignField>
                    {/*
                      The branch select renders for EVERY user, unlike the optional org fields
                      elsewhere: the field is required, so hiding it behind `branch.view` would
                      leave a user unable to complete the form at all. Without that permission the
                      branch list is empty and the hint says who to ask.
                    */}
                    <DesignField
                      label={t('fleet.vehicles.fields.branch')}
                      required
                      missing={required.isMissing('branch')}
                      hint={branchHint}
                      // Missing, the line under the box says WHY it is empty — no permission to
                      // list the branches, or no default to preselect — rather than «حقل مطلوب».
                      error={
                        required.isMissing('branch') && branchHint !== undefined
                          ? branchHint
                          : undefined
                      }
                    >
                      <Select
                        value={form.branchId}
                        onChange={(e) => set('branchId')(e.target.value)}
                        className={selectBox(required.isMissing('branch'))}
                      >
                        <option value="">{t('common.select')}</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {localized(branch.name, locale)}
                          </option>
                        ))}
                      </Select>
                    </DesignField>
                  </div>
                </section>

                <section className="space-y-4">
                  {heading(t('fleet.vehicles.form.sections.radio'), PATH.link)}
                  <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                    <DesignField label={t('fleet.vehicles.fields.issi')}>
                      <Input
                        value={form.issi}
                        onChange={(e) => set('issi')(e.target.value)}
                        rule="integer"
                        tone={cn(box, MONO)}
                      />
                    </DesignField>
                    <DesignField label={t('fleet.vehicles.fields.motorolaSn')}>
                      <Input
                        value={form.motorolaSn}
                        onChange={(e) => set('motorolaSn')(e.target.value)}
                        rule="english"
                        tone={cn(box, MONO)}
                      />
                    </DesignField>
                  </div>
                </section>

                <section className="space-y-3">
                  {heading(t('fleet.vehicles.licenseImage.label'), PATH.image)}
                  <div className="flex flex-col items-start justify-between gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                        <Stroke d={[...PATH.image]} className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          {pendingImage !== null
                            ? t('fleet.vehicles.licenseImage.pending', { name: pendingImage.name })
                            : hasImage
                              ? (vehicle?.licenseImage?.fileName ?? '')
                              : t('fleet.vehicles.licenseImage.none')}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t('fleet.vehicles.licenseImage.hint')}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <PhotoPickButton
                        accept={LICENSE_IMAGE_ACCEPT}
                        disabled={busy}
                        label={
                          hasImage
                            ? t('fleet.vehicles.licenseImage.replace')
                            : t('fleet.vehicles.licenseImage.upload')
                        }
                        onFile={(file) => void replaceImage(file)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-500/20 dark:text-indigo-300"
                      >
                        {hasImage
                          ? t('fleet.vehicles.licenseImage.replace')
                          : t('fleet.vehicles.licenseImage.upload')}
                      </PhotoPickButton>
                      {hasImage && (
                        <button
                          type="button"
                          onClick={() => setPreviewOpen(true)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-[#2b3b6b] dark:text-slate-200 dark:hover:bg-slate-800/60"
                        >
                          {t('fleet.vehicles.licenseImage.view')}
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                <div
                  className={cn('mt-2 flex items-center justify-start gap-3 border-t', look.footer)}
                >
                  <button
                    type="button"
                    data-vehicle-save="true"
                    aria-busy={busy}
                    onClick={required.guard(submit)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98]',
                      look.save,
                    )}
                  >
                    {busy && <Spinner className="h-4 w-4" />}
                    <span>{t('common.save')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                      'rounded-xl border bg-white py-2.5 text-[15px] font-bold text-slate-900 transition-all hover:bg-slate-100 active:scale-[0.98] dark:bg-[#1a2550] dark:text-slate-100 dark:hover:bg-slate-700/80',
                      look.cancel,
                    )}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <LicenseImagePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        vehicle={vehicle}
        typeName={typeName === null ? '' : localized(typeName, locale)}
      />
    </>
  );
};

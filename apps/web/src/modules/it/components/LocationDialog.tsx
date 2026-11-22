// Create/edit a place of «المواقع» (2026-11-19) — where a department keeps what it holds: «غرفة
// السيرفرات», «غرفة الكاميرات». Each branch has its own list, so a new place names its branch — one
// of the branches the caller's `itCatalog.manage` reaches, as the SERVER says
// (`/it/locations/branch-targets`), since it answers 403 for any other. A place never changes
// branch (a new one is made), so the edit shows it and does not offer it. A place is RETIRED, never
// deleted (FR-11): the edit offers «نشط», and the server refuses retiring one while assets are held
// there — its answer is said here as it was given.
import { useEffect, useMemo, useState } from 'react';
import { type ItLocationDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import {
  useCreateItLocation,
  useItBranchOptions,
  useItLocationBranchTargets,
  useUpdateItLocation,
} from '../api/it-queries';

interface FormState {
  branchId: string;
  nameAr: string;
  nameEn: string;
  code: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
}

const fromPlace = (place: ItLocationDto | null, branchId: string): FormState => ({
  branchId: place?.branchId ?? branchId,
  nameAr: place?.name.ar ?? '',
  nameEn: place?.name.en ?? '',
  code: place?.code ?? '',
  description: place?.description ?? '',
  sortOrder: String(place?.sortOrder ?? 0),
  isActive: place?.isActive ?? true,
});

export const LocationDialog = ({
  open,
  onClose,
  place,
  branchId = '',
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new place. */
  place: ItLocationDto | null;
  /** A new place starts in this branch — the tab's branch filter — when the caller may file there. */
  branchId?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const creating = place === null;
  const targets = useItLocationBranchTargets(open && creating);
  const [form, setForm] = useState<FormState>(fromPlace(place, branchId));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(fromPlace(place, branchId));
      setError(null);
    }
  }, [open, place, branchId]);

  const create = useCreateItLocation();
  const update = useUpdateItLocation();
  const busy = create.isPending || update.isPending;

  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);
  // Only the branches the server says the grant reaches, named; a filter's branch outside them is
  // no choice.
  const offered = (targets.data?.branchIds ?? []).filter((id) => branchName.has(id));
  const chosenBranch = creating
    ? offered.includes(form.branchId)
      ? form.branchId
      : ''
    : form.branchId;

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const complete = chosenBranch !== '' && form.nameAr.trim() !== '' && form.nameEn.trim() !== '';

  const submit = async (): Promise<void> => {
    setError(null);
    const sortOrder = Number(form.sortOrder);
    const order = Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 0;
    const name = { ar: form.nameAr.trim(), en: form.nameEn.trim() };
    try {
      if (place === null) {
        await create.mutateAsync({
          branchId: chosenBranch,
          name,
          sortOrder: order,
          ...(form.code.trim() === '' ? {} : { code: form.code.trim() }),
          ...(form.description.trim() === '' ? {} : { description: form.description.trim() }),
        });
        toast.success(t('it.locations.created'));
      } else {
        await update.mutateAsync({
          id: place.id,
          body: {
            name,
            code: form.code.trim() === '' ? null : form.code.trim(),
            description: form.description.trim() === '' ? null : form.description.trim(),
            sortOrder: order,
            isActive: form.isActive,
            version: place.version,
          },
        });
        toast.success(t('it.locations.updated'));
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err, locale));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={creating ? t('it.locations.add') : t('it.locations.edit')}
      description={t('it.locations.dialogHint')}
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
      {error !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label={t('it.assets.columns.branch')}
            required
            hint={creating ? t('it.locations.branchHint') : t('it.locations.branchFixed')}
            error={creating && targets.isError ? errorMessage(targets.error, locale) : undefined}
          >
            {creating ? (
              <Select
                value={chosenBranch}
                data-location-branch
                disabled={targets.data === undefined}
                onChange={(e) => set('branchId')(e.target.value)}
              >
                <option value="">
                  {targets.data === undefined ? t('common.loading') : t('common.select')}
                </option>
                {offered.map((id) => (
                  <option key={id} value={id}>
                    {branchName.get(id)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={branchName.get(form.branchId) ?? '—'} disabled readOnly />
            )}
          </Field>
        </div>
        <Field label={t('it.catalogs.fields.nameAr')} required>
          <Input value={form.nameAr} onChange={(e) => set('nameAr')(e.target.value)} dir="rtl" />
        </Field>
        <Field label={t('it.catalogs.fields.nameEn')} required>
          <Input value={form.nameEn} onChange={(e) => set('nameEn')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.catalogs.fields.code')}>
          <Input value={form.code} onChange={(e) => set('code')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.catalogs.fields.sortOrder')}>
          <Input
            type="number"
            min="0"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('it.catalogs.fields.description')}>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          </Field>
        </div>
        {!creating && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set('isActive')(e.target.checked)}
              label={t('it.catalogs.activeLabel')}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.locations.retireHint')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
};

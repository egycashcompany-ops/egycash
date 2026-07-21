// Dedicated National-ID OCR review screen (modal). Shows EVERY extracted field for the user to
// verify and edit; the number-derived fields (birth date / gender / governorate) recompute live
// and stay read-only. Only on Confirm is the reviewed data handed back to the caller — nothing is
// saved here. Module-agnostic (uses the generic `nationalIdOcr.*` catalog), so it is reusable.
import { useEffect, useState } from 'react';
import { MARITAL_STATUSES } from '@ecms/contracts';
import { useT } from '../../platform/localization/useT';
import { useAppSelector } from '../../store';
import { formatDate } from '../lib/format';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/form';
import { deriveFromNationalId } from './mapping';
import { type NationalIdReviewData } from './types';

export const NationalIdReviewDialog = ({
  open,
  initial,
  notice,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initial: NationalIdReviewData;
  /** Optional inline notice (e.g. "OCR unavailable — enter the values manually"). */
  notice?: string | undefined;
  onCancel: () => void;
  onConfirm: (data: NationalIdReviewData) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [d, setD] = useState<NationalIdReviewData>(initial);

  // Re-seed whenever a fresh extraction opens the dialog.
  useEffect(() => {
    if (open) setD(initial);
  }, [open, initial]);

  const set = (patch: Partial<NationalIdReviewData>): void => setD((prev) => ({ ...prev, ...patch }));
  const derived = deriveFromNationalId(d.nationalId);

  const confirm = (): void => onConfirm({ ...d, ...derived });

  const twoCol = 'grid grid-cols-1 gap-4 sm:grid-cols-2';

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t('nationalIdOcr.review.title')}
      description={t('nationalIdOcr.review.subtitle')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>{t('nationalIdOcr.review.cancel')}</Button>
          <Button onClick={confirm}>{t('nationalIdOcr.review.confirm')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {notice !== undefined && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {notice}
          </p>
        )}
        <div className={twoCol}>
          <Field label={t('nationalIdOcr.field.fullNameAr')}>
            <Input value={d.fullNameAr} onChange={(e) => set({ fullNameAr: e.target.value })} />
          </Field>
          <Field label={t('nationalIdOcr.field.fullNameEn')} hint={t('nationalIdOcr.field.fullNameEnHint')}>
            <Input value={d.fullNameEn} onChange={(e) => set({ fullNameEn: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('nationalIdOcr.field.nationalId')}>
            <Input value={d.nationalId} onChange={(e) => set({ nationalId: e.target.value })} dir="ltr" inputMode="numeric" />
          </Field>
          <Field label={t('nationalIdOcr.field.nationalIdExpiry')}>
            <Input type="date" value={d.nationalIdExpiry} onChange={(e) => set({ nationalIdExpiry: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('nationalIdOcr.field.maritalStatus')}>
            <Select value={d.maritalStatus} onChange={(e) => set({ maritalStatus: e.target.value as NationalIdReviewData['maritalStatus'] })}>
              <option value="">{t('nationalIdOcr.field.unspecified')}</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>{t(`nationalIdOcr.marital.${m}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('nationalIdOcr.field.religion')}>
            <Input value={d.religion} onChange={(e) => set({ religion: e.target.value })} />
          </Field>
          <Field label={t('nationalIdOcr.field.address')}>
            <Input value={d.addressLine} onChange={(e) => set({ addressLine: e.target.value })} />
          </Field>
          <Field label={t('nationalIdOcr.field.city')}>
            <Input value={d.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('nationalIdOcr.review.derived')}
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-500 dark:text-slate-400">{t('nationalIdOcr.field.birthDate')}</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-200">
                {derived.birthDate === '' ? '—' : formatDate(derived.birthDate, locale)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-500 dark:text-slate-400">{t('nationalIdOcr.field.gender')}</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-200">
                {derived.gender === '' ? '—' : t(`nationalIdOcr.gender.${derived.gender}`)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-500 dark:text-slate-400">{t('nationalIdOcr.field.governorate')}</dt>
              <dd className="font-medium text-slate-700 dark:text-slate-200">
                {derived.governorate === '' ? '—' : derived.governorate}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </Dialog>
  );
};

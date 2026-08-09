// Create/edit a help-desk priority — which IS the SLA policy (design §2.6).
//
// The one thing this screen must SAY OUT LOUD is that editing a target changes what FUTURE tickets
// promise and nothing else: every open ticket snapshotted its targets when it was opened, and the
// server never recomputes them. An admin who believes an edit "fixes" a running breach would be
// wrong, so the dialog tells them plainly rather than letting them find out from a report.
//
// Priorities ARCHIVE (`isActive: false`) rather than delete — tickets point at them forever.
import { useEffect, useState } from 'react';
import { type ItTicketPriorityDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateItTicketPriority, useUpdateItTicketPriority } from '../api/it-queries';

interface FormState {
  nameAr: string;
  nameEn: string;
  rank: string;
  responseMinutes: string;
  resolutionMinutes: string;
  isActive: boolean;
}

const fromPriority = (p: ItTicketPriorityDto | null): FormState => ({
  nameAr: p?.name.ar ?? '',
  nameEn: p?.name.en ?? '',
  rank: String(p?.rank ?? 0),
  responseMinutes: String(p?.responseMinutes ?? 60),
  resolutionMinutes: String(p?.resolutionMinutes ?? 480),
  isActive: p?.isActive ?? true,
});

const asInt = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
};

export const TicketPriorityDialog = ({
  open,
  onClose,
  priority,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  priority: ItTicketPriorityDto | null;
}): JSX.Element => {
  const t = useT();
  const [form, setForm] = useState<FormState>(fromPriority(priority));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(fromPriority(priority));
      setError(null);
    }
  }, [open, priority]);

  const create = useCreateItTicketPriority();
  const update = useUpdateItTicketPriority();
  const busy = create.isPending || update.isPending;

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const response = asInt(form.responseMinutes);
  const resolution = asInt(form.resolutionMinutes);
  const rank = asInt(form.rank);
  // Mirrors the schema's cross-field rule so the reader sees it before the server says it — the
  // server still decides, this only saves a round trip.
  const inverted = Number.isFinite(response) && Number.isFinite(resolution) && resolution < response;
  const complete =
    form.nameAr.trim() !== '' &&
    form.nameEn.trim() !== '' &&
    Number.isFinite(rank) &&
    rank >= 0 &&
    response >= 1 &&
    resolution >= 1 &&
    !inverted;

  const submit = async (): Promise<void> => {
    setError(null);
    const name = { ar: form.nameAr.trim(), en: form.nameEn.trim() };
    try {
      if (priority === null) {
        await create.mutateAsync({
          name,
          rank,
          responseMinutes: response,
          resolutionMinutes: resolution,
        });
        toast.success(t('it.priorities.created'));
      } else {
        await update.mutateAsync({
          id: priority.id,
          body: {
            name,
            rank,
            responseMinutes: response,
            resolutionMinutes: resolution,
            isActive: form.isActive,
            version: priority.version,
          },
        });
        toast.success(t('it.priorities.updated'));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={priority === null ? t('it.priorities.add') : t('it.priorities.edit')}
      description={t('it.priorities.dialogHint')}
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
        <Field label={t('it.catalogs.fields.nameAr')} required>
          <Input value={form.nameAr} onChange={(e) => set('nameAr')(e.target.value)} dir="rtl" />
        </Field>
        <Field label={t('it.catalogs.fields.nameEn')} required>
          <Input value={form.nameEn} onChange={(e) => set('nameEn')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.priorities.fields.rank')} required hint={t('it.priorities.rankHint')}>
          <Input
            type="number"
            min="0"
            max="1000"
            value={form.rank}
            onChange={(e) => set('rank')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div />
        <Field
          label={t('it.priorities.fields.responseMinutes')}
          required
          hint={t('it.priorities.responseHint')}
        >
          <Input
            type="number"
            min="1"
            value={form.responseMinutes}
            onChange={(e) => set('responseMinutes')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field
          label={t('it.priorities.fields.resolutionMinutes')}
          required
          hint={t('it.priorities.resolutionHint')}
          {...(inverted ? { error: t('it.priorities.inverted') } : {})}
        >
          <Input
            type="number"
            min="1"
            value={form.resolutionMinutes}
            onChange={(e) => set('resolutionMinutes')(e.target.value)}
            dir="ltr"
          />
        </Field>
        {priority !== null && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => set('isActive')(e.target.checked)}
              label={t('it.priorities.activeLabel')}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.priorities.archiveHint')}
            </p>
          </div>
        )}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2 dark:bg-slate-800/60 dark:text-slate-300">
          {t('it.priorities.snapshotWarning')}
        </p>
      </div>
    </Dialog>
  );
};

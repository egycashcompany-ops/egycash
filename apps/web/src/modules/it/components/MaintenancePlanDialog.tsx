// Create/edit a preventive maintenance plan (design §2.7, §4.6).
//
// The one thing this screen must SAY OUT LOUD is what `nextDueAt` means: it is the schedule's only
// clock, it advances from the COMPLETION date of the order the plan generates, and changing the
// interval does not move a due date that is already set. A planner who believed a shortened
// interval pulls the next service forward would be wrong, so the dialog says so rather than letting
// them find out a quarter later.
//
// `active` and `lastCompletedAt` are not on this form: the first moves through the named
// activate/deactivate actions and the second is stamped by a completing order.
import { useEffect, useState } from 'react';
import { type ItMaintenancePlanDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateItMaintenancePlan, useUpdateItMaintenancePlan } from '../api/it-queries';
import { AssetPicker } from './AssetPicker';

const asInt = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
};

/** `2026-08-09T04:25:00.000Z` → `2026-08-09`, the value a date input takes. */
const asDateInput = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

export const MaintenancePlanDialog = ({
  open,
  onClose,
  plan,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  plan: ItMaintenancePlanDto | null;
}): JSX.Element => {
  const t = useT();
  const [assetId, setAssetId] = useState('');
  const [name, setName] = useState('');
  const [intervalDays, setIntervalDays] = useState('90');
  const [checklist, setChecklist] = useState('');
  const [nextDueAt, setNextDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAssetId(plan?.assetId ?? '');
    setName(plan?.name ?? '');
    setIntervalDays(String(plan?.intervalDays ?? 90));
    setChecklist(plan?.checklist ?? '');
    setNextDueAt(asDateInput(plan?.nextDueAt ?? null));
    setError(null);
  }, [open, plan]);

  const create = useCreateItMaintenancePlan();
  const update = useUpdateItMaintenancePlan();
  const busy = create.isPending || update.isPending;

  const interval = asInt(intervalDays);
  const valid =
    name.trim() !== '' && interval >= 1 && (plan !== null || assetId !== '');

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (plan === null) {
        await create.mutateAsync({
          assetId,
          name: name.trim(),
          intervalDays: interval,
          ...(checklist.trim() === '' ? {} : { checklist: checklist.trim() }),
          ...(nextDueAt === '' ? {} : { nextDueAt: new Date(nextDueAt) }),
        });
        toast.success(t('it.plans.created'));
      } else {
        await update.mutateAsync({
          id: plan.id,
          body: {
            name: name.trim(),
            intervalDays: interval,
            checklist: checklist.trim() === '' ? null : checklist.trim(),
            ...(nextDueAt === '' ? {} : { nextDueAt: new Date(nextDueAt) }),
            version: plan.version,
          },
        });
        toast.success(t('it.plans.updated'));
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
      title={plan === null ? t('it.plans.add') : t('it.plans.edit')}
      description={t('it.plans.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void submit()}>
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
      <div className="space-y-4">
        {/* The asset is fixed at creation: re-parenting a schedule would rewrite another asset's
            maintenance history, so edit mode shows it and does not offer to change it. */}
        {plan === null ? (
          <Field label={t('it.plans.fields.asset')} required>
            <AssetPicker value={assetId} onChange={setAssetId} />
          </Field>
        ) : null}
        <Field label={t('it.plans.fields.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label={t('it.plans.fields.intervalDays')}
          required
          hint={t('it.plans.intervalHint')}
        >
          <Input
            type="number"
            min="1"
            max="3650"
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.plans.fields.nextDueAt')} hint={t('it.plans.nextDueHint')}>
          <Input
            type="date"
            value={nextDueAt}
            onChange={(e) => setNextDueAt(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.plans.fields.checklist')} hint={t('it.plans.checklistHint')}>
          <Textarea rows={4} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {t('it.plans.clockWarning')}
        </p>
      </div>
    </Dialog>
  );
};

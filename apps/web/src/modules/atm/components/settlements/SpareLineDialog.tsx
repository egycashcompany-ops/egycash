// «+ سطر سبير» (S-9, DS-27, §9.4): a spare set is its own line, with a type and no machine. Its
// cassettes are typed here — 1 to 8, every one planned (withdrawal or recycle, in Egyptian pounds;
// §3.1 `layoutIssues(…, { spare: true })`) — its counts come from the chosen standard load and stay
// editable on the draft afterwards, like any line.
//
// «النوع» suggests the bank's types already in use (the machines' `typeLabel`s), and takes any.
import { useEffect, useMemo, useState } from 'react';
import {
  ATM_LAYOUT_SLOTS_MAX,
  ATM_PLAN_RUNS,
  ATM_SPARE_SLOTS_MIN,
  layoutIssues,
  type AddAtmSpareLine,
  type AtmCassetteSlot,
  type AtmLayoutIssueCode,
  type AtmPlanRun,
  type AtmStandardLoadDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { SettlementDialog } from './SettlementDialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { CloseIcon } from '../../../../shared/ui/icons';
import { runLabel } from '../../lib/settlement-view';
import { standardLoadLabel } from './PlanLinePanel';
import { SlotEditor } from './SlotEditor';

const FILLABLE = ['withdrawal', 'recycle'] as const;

const freshSlot = (n: number): AtmCassetteSlot => ({
  slot: n,
  kind: 'withdrawal',
  denomination: null,
  currency: 'EGP',
});

const renumber = (slots: readonly AtmCassetteSlot[]): AtmCassetteSlot[] =>
  slots.map((s, i) => ({ ...s, slot: i + 1 }));

export const SpareLineDialog = ({
  open,
  locale,
  busy,
  error,
  typeLabels,
  standardLoads,
  onSubmit,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  busy: boolean;
  error: string | null;
  /** The bank's types in use, for the datalist. */
  typeLabels: readonly string[];
  standardLoads: readonly AtmStandardLoadDto[];
  onSubmit: (body: AddAtmSpareLine) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const fallback = standardLoads.find((l) => l.isDefault)?.id ?? '';
  const [spareCode, setSpareCode] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [slots, setSlots] = useState<AtmCassetteSlot[]>(() => [1, 2, 3, 4].map(freshSlot));
  const [load, setLoad] = useState(fallback);
  const [run, setRun] = useState<AtmPlanRun>(1);
  const [time, setTime] = useState('');

  useEffect(() => {
    if (!open) return;
    setSpareCode('');
    setTypeLabel('');
    setSlots([1, 2, 3, 4].map(freshSlot));
    setLoad(fallback);
    setRun(1);
    setTime('');
  }, [open]);

  const issues = useMemo(() => layoutIssues(slots, { spare: true }), [slots]);
  const issuesOf = (n: number): AtmLayoutIssueCode[] =>
    issues.filter((i) => i.slot === n).map((i) => i.code);
  const canSubmit = typeLabel.trim() !== '' && issues.length === 0;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      run,
      scheduleTime: time === '' ? null : time,
      spareCode: spareCode.trim() === '' ? null : spareCode.trim(),
      typeLabel: typeLabel.trim(),
      slots,
      standardLoadId: load === '' ? null : load,
    });
  };

  return (
    <SettlementDialog
      open={open}
      onClose={onClose}
      title={t('atm.plan.spare.title')}
      size="lg"
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!canSubmit} onClick={submit}>
            {t('atm.plan.spare.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('atm.plan.spare.code')} htmlFor="spare-code">
            <Input
              id="spare-code"
              dir="ltr"
              maxLength={20}
              value={spareCode}
              onChange={(e) => setSpareCode(e.target.value)}
            />
          </Field>
          <Field label={t('atm.plan.spare.type')} htmlFor="spare-type" required>
            <Input
              id="spare-type"
              list="spare-type-labels"
              maxLength={60}
              value={typeLabel}
              onChange={(e) => setTypeLabel(e.target.value)}
            />
            <datalist id="spare-type-labels">
              {typeLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('atm.plan.spare.slots')}
          </legend>
          {slots.map((slot, i) => (
            <div key={slot.slot} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <SlotEditor
                  slot={slot}
                  label={t('atm.settlement.slot', { slot: slot.slot })}
                  kinds={FILLABLE}
                  egpOnly
                  issues={issuesOf(slot.slot)}
                  onChange={(next) => setSlots((all) => all.map((s, k) => (k === i ? next : s)))}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t('common.remove')} — ${t('atm.settlement.slot', { slot: slot.slot })}`}
                disabled={slots.length <= ATM_SPARE_SLOTS_MIN}
                onClick={() => setSlots((all) => renumber(all.filter((_, k) => k !== i)))}
              >
                <CloseIcon className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost-brand"
            size="sm"
            disabled={slots.length >= ATM_LAYOUT_SLOTS_MAX}
            onClick={() => setSlots((all) => [...all, freshSlot(all.length + 1)])}
          >
            {t('atm.plan.spare.addSlot')}
          </Button>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('atm.plan.panel.standardLoad')} htmlFor="spare-load">
            <Select id="spare-load" value={load} onChange={(e) => setLoad(e.target.value)}>
              <option value="">—</option>
              {standardLoads.map((l) => (
                <option key={l.id} value={l.id}>
                  {standardLoadLabel(l, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('atm.settlement.run')} htmlFor="spare-run">
            <Select
              id="spare-run"
              value={String(run)}
              onChange={(e) => setRun(Number(e.target.value) as AtmPlanRun)}
            >
              {ATM_PLAN_RUNS.map((n) => (
                <option key={n} value={String(n)}>
                  {runLabel(n, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('atm.plan.add.times')} htmlFor="spare-time">
            <Input
              id="spare-time"
              type="time"
              dir="ltr"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </SettlementDialog>
  );
};

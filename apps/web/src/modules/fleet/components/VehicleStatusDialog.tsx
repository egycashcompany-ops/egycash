// Change vehicle status (§4.1): the dialog offers only the transitions the lifecycle allows,
// requires a reason whenever the vehicle leaves active service, and says what disposal does. The
// server enforces the same rules; this mirrors them for honest UX.
//
// A DISPOSED CAR IS A SOURCE NOW. Disposal was terminal until the owner asked for it to be
// reversible — «مكهنة لازم ترجع نشطة تاني» — and the one transition out is back into service. The
// table below is the same table as `apps/api/.../vehicle-status.ts`; if they ever disagree the
// server wins and this dialog offers a button that answers 409.
import { useEffect, useState } from 'react';
import { type FleetVehicleDto, type FleetVehicleStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Textarea } from '../../../shared/ui/form';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, PATH } from './FuelCardBoard';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useChangeVehicleStatus } from '../api/fleet-queries';

const TARGETS: Record<FleetVehicleStatus, FleetVehicleStatus[]> = {
  active: ['outOfService', 'disposed'],
  outOfService: ['active', 'disposed'],
  // Back into service only — see the server's note on why not `outOfService` as well.
  disposed: ['active'],
};

/** Each status's own colour — state only; the pressed card is framed in the site's purple. */
const STATUS_TONE: Record<FleetVehicleStatus, { dot: string; icon: string; text: string }> = {
  active: {
    dot: 'bg-emerald-400',
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  outOfService: {
    dot: 'bg-amber-400',
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    text: 'text-amber-700 dark:text-amber-300',
  },
  disposed: {
    dot: 'bg-red-500',
    icon: 'bg-red-500/15 text-red-600 dark:text-red-400',
    text: 'text-red-700 dark:text-red-300',
  },
};
const STATUS_ICON: Record<FleetVehicleStatus, string> = {
  active: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  outOfService: 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z',
  disposed:
    'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
};

export const VehicleStatusDialog = ({
  open,
  onClose,
  vehicle,
}: {
  open: boolean;
  onClose: () => void;
  vehicle: FleetVehicleDto | null;
}): JSX.Element => {
  const t = useT();
  const [status, setStatus] = useState<FleetVehicleStatus | ''>('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setStatus('');
      setReason('');
    }
  }, [open]);

  const change = useChangeVehicleStatus();
  const needsReason = status !== '' && status !== 'active';
  // Save stays pressable: pressing it without a status, or without the reason leaving service
  // needs, names them and turns their boxes red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'status', label: t('fleet.vehicles.fields.newStatus'), ok: status !== '' },
      {
        key: 'reason',
        label: t('fleet.vehicles.fields.reason'),
        ok: !needsReason || reason.trim() !== '',
      },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    if (vehicle === null || status === '') return;
    await change.mutateAsync({
      id: vehicle.id,
      body: {
        status,
        ...(needsReason ? { reason: reason.trim() } : {}),
        version: vehicle.version,
      },
    });
    toast.success(t('fleet.vehicles.statusChanged'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={t('fleet.vehicles.changeStatus')}
      description={vehicle?.code ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={status === 'disposed' ? 'danger' : 'primary'}
            loading={change.isPending}
            onClick={required.guard(submit)}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        {vehicle !== null && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-[#0b1220]">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <BoardIcon d={PATH.truck} className="h-4 w-4 text-slate-400" />
              {t('fleet.vehicles.statusDialog.car', { code: vehicle.code })}
            </span>
            <span
              data-vehicle-current-status={vehicle.status}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400"
            >
              {t('fleet.vehicles.statusDialog.current')}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700',
                  STATUS_TONE[vehicle.status].text,
                )}
              >
                <i className={cn('h-1.5 w-1.5 rounded-full', STATUS_TONE[vehicle.status].dot)} />
                {t(`fleet.vehicles.status.${vehicle.status}`)}
              </span>
            </span>
          </div>
        )}
        <Field
          label={t('fleet.vehicles.fields.newStatus')}
          required
          missing={required.isMissing('status')}
        >
          {/* The transitions the lifecycle allows, as cards: what each one means, in a word. */}
          <div role="radiogroup" className="grid gap-2">
            {(vehicle === null ? [] : TARGETS[vehicle.status]).map((target) => {
              const chosen = status === target;
              return (
                <button
                  key={target}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  data-vehicle-status-option={target}
                  onClick={() => setStatus(target)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-start transition',
                    chosen
                      ? 'border-brand-500 bg-brand-500/10 shadow-md shadow-brand-700/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-[#111827] dark:hover:border-slate-600',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      STATUS_TONE[target].icon,
                    )}
                  >
                    <BoardIcon d={[STATUS_ICON[target]]} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm font-black', STATUS_TONE[target].text)}>
                      {t(`fleet.vehicles.status.${target}`)}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {t(`fleet.vehicles.statusDialog.hint.${target}`)}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                      chosen
                        ? 'border-brand-500 bg-brand-500'
                        : 'border-slate-300 dark:border-slate-600',
                    )}
                  >
                    {chosen && <i className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
        {needsReason && (
          <Field
            label={t('fleet.vehicles.fields.reason')}
            required
            missing={required.isMissing('reason')}
          >
            <Textarea
              rows={3}
              value={reason}
              placeholder={t('fleet.vehicles.statusDialog.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        {status === 'disposed' && (
          <p
            data-vehicle-disposed-warning="true"
            className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300"
          >
            <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
            {t('fleet.vehicles.disposedWarning')}
          </p>
        )}
      </div>
    </Dialog>
  );
};

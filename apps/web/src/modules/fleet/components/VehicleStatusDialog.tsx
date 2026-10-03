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
import { Field, Select, Textarea } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useChangeVehicleStatus } from '../api/fleet-queries';

const TARGETS: Record<FleetVehicleStatus, FleetVehicleStatus[]> = {
  active: ['outOfService', 'disposed'],
  outOfService: ['active', 'disposed'],
  // Back into service only — see the server's note on why not `outOfService` as well.
  disposed: ['active'],
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
        <Field
          label={t('fleet.vehicles.fields.newStatus')}
          required
          missing={required.isMissing('status')}
        >
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as FleetVehicleStatus | '')}
          >
            <option value="">{t('common.select')}</option>
            {(vehicle === null ? [] : TARGETS[vehicle.status]).map((target) => (
              <option key={target} value={target}>
                {t(`fleet.vehicles.status.${target}`)}
              </option>
            ))}
          </Select>
        </Field>
        {needsReason && (
          <Field
            label={t('fleet.vehicles.fields.reason')}
            required
            missing={required.isMissing('reason')}
            hint={status === 'disposed' ? t('fleet.vehicles.disposedWarning') : undefined}
          >
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
};

// Change vehicle status (§4.1): the dialog offers only the transitions the lifecycle allows
// (disposed is terminal and never offered as a source — the button is hidden for it upstream),
// requires a reason whenever the vehicle leaves active service, and spells out that disposal
// cannot be undone. The server enforces the same rules; this mirrors them for honest UX.
import { useEffect, useState } from 'react';
import { type FleetVehicleDto, type FleetVehicleStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useChangeVehicleStatus } from '../api/fleet-queries';

const TARGETS: Record<FleetVehicleStatus, FleetVehicleStatus[]> = {
  active: ['outOfService', 'disposed'],
  outOfService: ['active', 'disposed'],
  disposed: [],
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
  const ready = status !== '' && (!needsReason || reason.trim() !== '');

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
            disabled={!ready}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.vehicles.fields.newStatus')} required>
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
            hint={status === 'disposed' ? t('fleet.vehicles.disposedWarning') : undefined}
          >
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
};

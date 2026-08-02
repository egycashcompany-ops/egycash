// Create/edit an accident file (§4.6). The three amounts are the ENTERED facts — the server
// stores them typed and derives no money from them until §13-Q9 defines the formula, so this
// form asks for exactly what happened and computes nothing. The vehicle select offers the
// WHOLE registry: an accident is historical paperwork about the day it happened, so a disposed
// vehicle is a legal reference (deliberate contrast with the odometer's refusal). Edits send
// only the changed fields + the document version.
import { useEffect, useState } from 'react';
import { type FleetAccidentDto, type UpdateFleetAccident } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateAccident, useUpdateAccident } from '../api/fleet-queries';
import { VehicleSelect } from './VehicleSelect';

const MoneyInput = ({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}): JSX.Element => (
  <Input
    id={id}
    type="number"
    min={0}
    step="0.01"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    dir="ltr"
  />
);

export const AccidentFormDialog = ({
  open,
  onClose,
  accident,
  initialVehicleId = '',
}: {
  open: boolean;
  onClose: () => void;
  /** null = create; a document = version-aware edit of the freshly loaded row. */
  accident: FleetAccidentDto | null;
  /** Pre-selected vehicle (e.g. arriving filtered from the vehicle profile). */
  initialVehicleId?: string;
}): JSX.Element => {
  const t = useT();
  const [vehicleId, setVehicleId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [culprit, setCulprit] = useState('');
  const [statement, setStatement] = useState('');
  const [companyCost, setCompanyCost] = useState('');
  const [amountCollected, setAmountCollected] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!open) return;
    setVehicleId(accident?.vehicleId ?? initialVehicleId);
    setOccurredAt(accident === null ? '' : accident.occurredAt.slice(0, 10));
    setCulprit(accident?.culprit ?? '');
    setStatement(accident?.statement ?? '');
    setCompanyCost(accident === null ? '' : String(accident.companyCost));
    setAmountCollected(accident === null ? '' : String(accident.amountCollected));
    setPaidAmount(accident === null ? '' : String(accident.paidAmount));
    setNotes(accident?.notes ?? '');
  }, [open, accident, initialVehicleId]);

  const create = useCreateAccident();
  const update = useUpdateAccident();
  const pending = create.isPending || update.isPending;

  const amounts = {
    companyCost: Number(companyCost),
    amountCollected: Number(amountCollected),
    paidAmount: Number(paidAmount),
  };
  const complete =
    vehicleId !== '' &&
    occurredAt !== '' &&
    culprit.trim() !== '' &&
    statement.trim() !== '' &&
    [companyCost, amountCollected, paidAmount].every(
      (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0,
    );

  const submit = async (): Promise<void> => {
    if (accident === null) {
      await create.mutateAsync({
        vehicleId,
        occurredAt: new Date(occurredAt),
        culprit: culprit.trim(),
        statement: statement.trim(),
        ...amounts,
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      toast.success(t('fleet.accidents.created'));
    } else {
      // Send only what changed, plus the version the edit was made against.
      const body: UpdateFleetAccident = { version: accident.version };
      if (vehicleId !== accident.vehicleId) body.vehicleId = vehicleId;
      if (occurredAt !== accident.occurredAt.slice(0, 10)) body.occurredAt = new Date(occurredAt);
      if (culprit.trim() !== accident.culprit) body.culprit = culprit.trim();
      if (statement.trim() !== accident.statement) body.statement = statement.trim();
      if (amounts.companyCost !== accident.companyCost) body.companyCost = amounts.companyCost;
      if (amounts.amountCollected !== accident.amountCollected)
        body.amountCollected = amounts.amountCollected;
      if (amounts.paidAmount !== accident.paidAmount) body.paidAmount = amounts.paidAmount;
      const nextNotes = notes.trim() === '' ? null : notes.trim();
      if (nextNotes !== accident.notes) body.notes = nextNotes;
      await update.mutateAsync({ id: accident.id, body });
      toast.success(t('fleet.accidents.updated'));
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={accident === null ? t('fleet.accidents.record') : t('fleet.accidents.edit')}
      description={t('fleet.accidents.formHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.odometer.columns.vehicle')} required>
            <VehicleSelect value={vehicleId} onChange={setVehicleId} anyStatus />
          </Field>
          <Field label={t('fleet.accidents.fields.occurredAt')} required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>
        <Field label={t('fleet.accidents.fields.culprit')} required>
          <Input value={culprit} onChange={(e) => setCulprit(e.target.value)} />
        </Field>
        <Field label={t('fleet.accidents.fields.statement')} required>
          <Textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('fleet.accidents.fields.companyCost')} required>
            <MoneyInput value={companyCost} onChange={setCompanyCost} />
          </Field>
          <Field label={t('fleet.accidents.fields.amountCollected')} required>
            <MoneyInput value={amountCollected} onChange={setAmountCollected} />
          </Field>
          <Field label={t('fleet.accidents.fields.paidAmount')} required>
            <MoneyInput value={paidAmount} onChange={setPaidAmount} />
          </Field>
        </div>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

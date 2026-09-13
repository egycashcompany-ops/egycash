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
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateAccident, useUpdateAccident } from '../api/fleet-queries';
import { VehicleSelect } from './VehicleSelect';
import { RegistryDriverPicker } from './RegistryDriverPicker';
import { useEmployeeRecords } from './EmployeeName';

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
  // WHICH driver, when it was one of ours. Kept beside the NAME rather than replacing it: an
  // accident is often a third party's, and a form that could only name an employee could not
  // record the commonest kind there is.
  const [culpritEmployeeId, setCulpritEmployeeId] = useState('');
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
    setCulpritEmployeeId(accident?.culpritEmployeeId ?? '');
    setStatement(accident?.statement ?? '');
    setCompanyCost(accident === null ? '' : String(accident.companyCost));
    setAmountCollected(accident === null ? '' : String(accident.amountCollected));
    setPaidAmount(accident === null ? '' : String(accident.paidAmount));
    setNotes(accident?.notes ?? '');
    setAwaitingNameFor('');
  }, [open, accident, initialVehicleId]);

  // The picked driver's NAME, from the same cached records every other fleet screen reads.
  const records = useEmployeeRecords(culpritEmployeeId === '' ? [] : [culpritEmployeeId]);
  const drivers = new Map(
    [...records.entries()].map(([id, employee]) => [id, employee.personal.fullNameAr]),
  );

  /**
   * WHOSE NAME IS STILL BEING LOOKED UP — and the reason this form could not be submitted at all.
   *
   * `drivers` is keyed on the id ALREADY in state, because that is what `useEmployeeRecords` was
   * asked for. Inside the picker's `onChange` the chosen id is by construction NOT that id (and on
   * a create it is the first id there has ever been, so the map is empty), so reading the name out
   * of `drivers` at pick time always missed — and the culprit name, which `complete` requires and
   * the contract enforces, was written as ''. Save then stayed disabled with nothing on screen
   * saying why: no accident could be recorded, and on an edit, changing the driver wiped the name
   * it had.
   *
   * So the pick is recorded as a REQUEST for a name, and the effect below fills it in when the
   * record arrives. It is deliberately not "always sync the name to the employee's current name":
   * the stored name is the historical fact — a driver renamed next year did not change who caused
   * this accident — so an existing row's name is left exactly as filed until somebody picks again.
   */
  const [awaitingNameFor, setAwaitingNameFor] = useState('');
  const resolvedName = awaitingNameFor === '' ? undefined : drivers.get(awaitingNameFor);
  useEffect(() => {
    if (awaitingNameFor === '' || resolvedName === undefined) return;
    setCulprit(resolvedName);
    setAwaitingNameFor('');
  }, [awaitingNameFor, resolvedName]);

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
        culpritEmployeeId: culpritEmployeeId === '' ? null : culpritEmployeeId,
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
      // `null` when it was cleared or typed over — «it turned out to be a third party» has to be
      // an edit somebody can make, so untouched and cleared are kept apart.
      const nextCulpritId = culpritEmployeeId === '' ? null : culpritEmployeeId;
      if (nextCulpritId !== accident.culpritEmployeeId) body.culpritEmployeeId = nextCulpritId;
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
        {/* ONE field: «المتسبب», and it is the drivers list. Picking somebody writes their NAME
            into the record as well as their id — the name is what the board, the export and the
            print-out show, and it is the historical fact: a driver renamed next year did not
            change who caused this accident. The id is what makes «every accident سائق X caused» an
            exact question instead of a substring search that matches two people sharing a first
            name. */}
        <Field
          label={t('fleet.accidents.fields.culprit')}
          required
          // Save is disabled until the NAME is in hand, so while it is on its way the form says so
          // rather than presenting a dead button with no reason. It is the state that used to be
          // permanent and silent.
          {...(awaitingNameFor === '' ? {} : { warning: t('fleet.accidents.culpritNameLoading') })}
        >
          <RegistryDriverPicker
            value={culpritEmployeeId === '' ? [] : [culpritEmployeeId]}
            onChange={(next) => {
              const picked = next[0] ?? '';
              setCulpritEmployeeId(picked);
              // Clearing the driver clears the name with it; picking one asks for the name and the
              // effect above writes it the moment the directory answers.
              if (picked === '') {
                setCulprit('');
                setAwaitingNameFor('');
                return;
              }
              const known = drivers.get(picked);
              if (known === undefined) setAwaitingNameFor(picked);
              else {
                setCulprit(known);
                setAwaitingNameFor('');
              }
            }}
            fullWidth
            className="w-full"
          />
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

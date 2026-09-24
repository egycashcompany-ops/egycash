// Create/edit an accident file (§4.6). The three amounts are the ENTERED facts, stored as typed.
// The vehicle select offers the WHOLE registry: an accident is historical paperwork about the day
// it happened, so a disposed vehicle is a legal reference (deliberate contrast with the odometer's
// refusal). Edits send only the changed fields + the document version.
//
// «اختار عربيه و جمبها مبلغ» — optionally, an amount taken from ANOTHER car's remaining and added
// to this file. The form shows what that car has and what it will have left, and refuses more than
// it has; the server checks the same figure again inside the transaction that writes it.
import { useEffect, useState } from 'react';
import {
  fleetAccidentRemaining,
  type FleetAccidentDto,
  type Locale,
  type UpdateFleetAccident,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatMoney } from '../../../shared/lib/format';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAccidentCarTransfers,
  useCreateAccident,
  useUpdateAccident,
} from '../api/fleet-queries';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
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
  // «اختار عربيه و جمبها مبلغ» — the car the amount is TAKEN FROM, and how much. Both optional:
  // most accidents are recorded without one.
  const [fromVehicleId, setFromVehicleId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  useEffect(() => {
    if (!open) return;
    setVehicleId(accident?.vehicleId ?? initialVehicleId);
    setOccurredAt(accident?.occurredAt?.slice(0, 10) ?? '');
    setCulprit(accident?.culprit ?? '');
    setCulpritEmployeeId(accident?.culpritEmployeeId ?? '');
    setStatement(accident?.statement ?? '');
    setCompanyCost(accident === null ? '' : String(accident.companyCost));
    setAmountCollected(accident === null ? '' : String(accident.amountCollected));
    setPaidAmount(accident === null ? '' : String(accident.paidAmount));
    setNotes(accident?.notes ?? '');
    setAwaitingNameFor('');
    // A transfer is one act per save: every open starts with none picked.
    setFromVehicleId('');
    setTransferAmount('');
  }, [open, accident, initialVehicleId]);

  // The picked driver's NAME, from the same cached records every other fleet screen reads.
  const records = useEmployeeRecords(culpritEmployeeId === '' ? [] : [culpritEmployeeId]);
  const drivers = new Map([...records.entries()].map(([id, person]) => [id, person.fullNameAr]));

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

  const locale = useAppSelector((state): Locale => state.locale.locale);
  const money = (value: number): string => formatMoney(value, 'EGP', locale);

  // WHAT THE SOURCE CAR HAS — its «إجمالي المتبقي» over every one of its files, from the same
  // server code that caps the save. Asked only once a car is picked.
  const source = useAccidentCarTransfers(fromVehicleId, open);
  const sourceCode = source.data?.vehicleCode ?? '';
  const available = Math.max(0, source.data?.remaining ?? 0);
  const taking = transferAmount === '' ? 0 : Number(transferAmount);
  const transferring = fromVehicleId !== '';
  const transferProblem = !transferring
    ? null
    : fromVehicleId === vehicleId
      ? t('fleet.accidents.transfer.sameCar')
      : source.data === undefined
        ? null
        : available <= 0
          ? t('fleet.accidents.transfer.nothing', { code: sourceCode })
          : // Compared in piastres, as the server compares them.
            Math.round(taking * 100) > Math.round(available * 100)
            ? t('fleet.accidents.transfer.tooMuch', {
                available: money(available),
                code: sourceCode,
              })
            : taking <= 0
              ? t('fleet.accidents.transfer.needsAmount')
              : null;
  // This file's remaining as the form now reads — its own figures, plus what it already took and
  // gave — and what the new transfer would make it.
  const targetBefore = fleetAccidentRemaining({
    companyCost: Number(companyCost) || 0,
    amountCollected: Number(amountCollected) || 0,
    paidAmount: Number(paidAmount) || 0,
    transferredIn: accident?.transferredIn ?? 0,
    transferredOut: accident?.transferredOut ?? 0,
  });
  const transfer =
    transferring && transferProblem === null && source.data !== undefined
      ? { fromVehicleId, amount: taking }
      : undefined;

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
    ) &&
    // A car picked to take from must be a DIFFERENT car with enough on it, and an amount.
    (!transferring || transfer !== undefined);

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
        ...(transfer === undefined ? {} : { transfer }),
      });
      toast.success(t('fleet.accidents.created'));
    } else {
      // Send only what changed, plus the version the edit was made against.
      const body: UpdateFleetAccident = { version: accident.version };
      if (vehicleId !== accident.vehicleId) body.vehicleId = vehicleId;
      if (occurredAt !== (accident.occurredAt?.slice(0, 10) ?? ''))
        body.occurredAt = new Date(occurredAt);
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
      // ONE MORE transfer onto this file; the ones it already has stay.
      if (transfer !== undefined) body.transfer = transfer;
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
        {/* «اختار كود عربيه وقدمها مكان اكتب فيه المبلغ اللى عاوز اخده من العربيه» — the car and
            the amount side by side, and under them what it means: what the car has, what it will
            have left, and what this accident's remaining becomes. */}
        <fieldset
          data-accident-transfer="true"
          className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          <legend className="px-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('fleet.accidents.transfer.title')}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('fleet.accidents.transfer.fromVehicle')}>
              <VehicleCodeCombobox
                value={fromVehicleId}
                onChange={setFromVehicleId}
                anyStatus
                ariaLabel={t('fleet.accidents.transfer.fromVehicle')}
              />
            </Field>
            <Field label={t('fleet.accidents.transfer.amount')}>
              <MoneyInput
                value={transferAmount}
                onChange={setTransferAmount}
                disabled={!transferring}
                aria-invalid={transferProblem !== null}
              />
            </Field>
          </div>
          {transferring && source.data !== undefined && fromVehicleId !== vehicleId && (
            <div
              data-transfer-balance="true"
              className="space-y-1 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
            >
              <p className="font-medium">
                {t('fleet.accidents.transfer.balance', {
                  code: sourceCode,
                  available: money(available),
                })}
              </p>
              {transferProblem === null && taking > 0 && (
                <>
                  <p>
                    {t('fleet.accidents.transfer.after', {
                      amount: money(taking),
                      left: money(
                        fleetAccidentRemaining({
                          amountCollected: available,
                          companyCost: 0,
                          paidAmount: taking,
                        }),
                      ),
                    })}
                  </p>
                  <p className="text-sky-700 dark:text-sky-300">
                    {t('fleet.accidents.transfer.target', {
                      before: money(targetBefore),
                      after: money(
                        fleetAccidentRemaining({
                          amountCollected: targetBefore,
                          companyCost: 0,
                          paidAmount: 0,
                          transferredIn: taking,
                        }),
                      ),
                    })}
                  </p>
                </>
              )}
            </div>
          )}
          {transferProblem !== null && (
            <p
              data-transfer-error="true"
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-200"
            >
              {transferProblem}
            </p>
          )}
        </fieldset>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};

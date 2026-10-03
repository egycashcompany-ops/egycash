// Create/edit an accident file (§4.6). The three amounts are the ENTERED facts, stored as typed.
// The vehicle select offers the WHOLE registry: an accident is historical paperwork about the day
// it happened, so a disposed vehicle is a legal reference (deliberate contrast with the odometer's
// refusal). Edits send only the changed fields + the document version.
//
// «اختار عربيه و جمبها مبلغ» — optionally, an amount taken from ANOTHER car's remaining and added
// to this file. The amount is worked out, not typed: the picked cars cover this file's negative
// remaining, each down to zero in the order picked. The form shows what each car has, gives and
// keeps; the server checks the same figures again inside the transaction that writes it.
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
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { cn } from '../../../shared/lib/cn';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAccidentCarBalances, useCreateAccident, useUpdateAccident } from '../api/fleet-queries';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { coverDeficit } from '../lib/accident-transfer-plan';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { RegistryDriverPicker } from './RegistryDriverPicker';
import { useFleetPeopleMap } from './EmployeeName';

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
  // WHICH drivers, when they were ours — «يقدر يختار اكتر من سواق فى المره الواحده». Kept beside
  // the NAME rather than replacing it: an accident is often a third party's, and a form that could
  // only name employees could not record the commonest kind there is.
  const [culpritEmployeeIds, setCulpritEmployeeIds] = useState<string[]>([]);
  const [statement, setStatement] = useState('');
  const [companyCost, setCompanyCost] = useState('');
  const [amountCollected, setAmountCollected] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  // «اختار عربيه و جمبها مبلغ» — the cars the amount is TAKEN FROM. Optional: most accidents are
  // recorded without one. How much is not typed; it is worked out below.
  // The cars to take from, IN THE ORDER PICKED — the first gives all it has before the next.
  const [fromVehicleIds, setFromVehicleIds] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setVehicleId(accident?.vehicleId ?? initialVehicleId);
    setOccurredAt(accident?.occurredAt?.slice(0, 10) ?? '');
    setCulprit(accident?.culprit ?? '');
    setCulpritEmployeeIds(accident?.culpritEmployeeIds ?? []);
    setStatement(accident?.statement ?? '');
    setCompanyCost(accident === null ? '' : String(accident.companyCost));
    setAmountCollected(accident === null ? '' : String(accident.amountCollected));
    setPaidAmount(accident === null ? '' : String(accident.paidAmount));
    setNotes(accident?.notes ?? '');
    setAwaitingNameFor('');
    // A transfer is one act per save: every open starts with none picked.
    setFromVehicleIds([]);
  }, [open, accident, initialVehicleId]);

  // The picked drivers' NAMES, from the same roster every other fleet screen reads — the WHOLE
  // roster, so a driver picked a moment ago is already in it.
  const roster = useFleetPeopleMap();
  const drivers = new Map([...roster.entries()].map(([id, person]) => [id, person.fullNameAr]));
  /** Several drivers read as one name line, in the order they were picked. */
  const namesOf = (ids: readonly string[]): string | undefined => {
    const names = ids.map((id) => drivers.get(id));
    return names.every((name): name is string => name !== undefined) ? names.join('، ') : undefined;
  };

  /**
   * WHOSE NAME IS STILL BEING LOOKED UP — and the reason this form could not be submitted at all.
   *
   * `drivers` is keyed on the id ALREADY in state, because that is what `useEmployeeRecords` was
   * asked for. Inside the picker's `onChange` the chosen id is by construction NOT that id (and on
   * a create it is the first id there has ever been, so the map is empty), so reading the name out
   * of `drivers` at pick time always missed — and the culprit name, which Save requires and the
   * contract enforces, was written as ''. Save then stayed disabled with nothing on screen
   * saying why: no accident could be recorded, and on an edit, changing the driver wiped the name
   * it had.
   *
   * So the pick is recorded as a REQUEST for a name, and the effect below fills it in when the
   * record arrives. It is deliberately not "always sync the name to the employee's current name":
   * the stored name is the historical fact — a driver renamed next year did not change who caused
   * this accident — so an existing row's name is left exactly as filed until somebody picks again.
   */
  const [awaitingNameFor, setAwaitingNameFor] = useState('');
  // The ids still waiting, comma-joined in state so the effect below compares a string.
  const resolvedName = awaitingNameFor === '' ? undefined : namesOf(awaitingNameFor.split(','));
  useEffect(() => {
    if (awaitingNameFor === '' || resolvedName === undefined) return;
    setCulprit(resolvedName);
    setAwaitingNameFor('');
  }, [awaitingNameFor, resolvedName]);

  const locale = useAppSelector((state): Locale => state.locale.locale);
  const money = (value: number): string => formatMoney(value, 'EGP', locale);

  // «يجب كود السيارة المأخوذ منها السيارات اللى المبلغ المتبقى بالموجب بس» — every car with
  // something left, from the same server figures that cap the save. This accident's own car is not
  // offered: a car cannot pay itself.
  const balances = useAccidentCarBalances(open);
  const offered = (balances.data ?? []).filter((car) => car.vehicleId !== vehicleId);
  const balanceOf = new Map((balances.data ?? []).map((car) => [car.vehicleId, car]));
  // A file that sits on a source car and leaves it in this same save is not that car's to give:
  // the server leaves it out of the cap, and so does the figure the clerk is shown.
  const leavingFrom = (carId: string): number =>
    accident !== null && accident.vehicleId === carId ? fleetAccidentRemaining(accident) : 0;
  // This file's remaining as the form now reads — its own figures, plus what it already took and
  // gave. Its NEGATIVE part is what the picked cars cover.
  const targetBefore = fleetAccidentRemaining({
    companyCost: Number(companyCost) || 0,
    amountCollected: Number(amountCollected) || 0,
    paidAmount: Number(paidAmount) || 0,
    transferredIn: accident?.transferredIn ?? 0,
    transferredOut: accident?.transferredOut ?? 0,
  });
  const picked = fromVehicleIds.filter((id) => id !== vehicleId && balanceOf.has(id));
  // «مش انا اللى هكتب المبلغ الماخوذ» — the amount is worked out: the cars, in the order picked,
  // each down to zero, until this accident reaches zero or they have nothing left.
  const plan = coverDeficit(
    picked.map((id) => ({
      vehicleId: id,
      code: balanceOf.get(id)?.vehicleCode ?? '',
      available: Math.max(
        0,
        fleetAccidentRemaining({
          amountCollected: balanceOf.get(id)?.remaining ?? 0,
          companyCost: 0,
          paidAmount: leavingFrom(id),
        }),
      ),
    })),
    targetBefore,
  );
  const taking = plan.amount;
  const transferring = picked.length > 0;
  const transferProblem = !transferring
    ? null
    : balances.isError
      ? // Said, not left as a Save button that is silently off.
        t('fleet.accidents.transfer.loadFailed')
      : taking <= 0
        ? t('fleet.accidents.transfer.noDeficit')
        : null;
  const transfer =
    transferring && transferProblem === null
      ? {
          // Only the cars that actually give something, still in the order picked.
          fromVehicleIds: plan.rows.filter((row) => row.take > 0).map((row) => row.vehicleId),
          amount: taking,
        }
      : undefined;

  const create = useCreateAccident();
  const update = useUpdateAccident();
  const pending = create.isPending || update.isPending;

  const amounts = {
    companyCost: Number(companyCost),
    amountCollected: Number(amountCollected),
    paidAmount: Number(paidAmount),
  };
  const isAmount = (v: string): boolean => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  // Save stays pressable: pressing it with any of these empty — or an amount below zero, or a
  // transfer that cannot be made — names them and turns their boxes red (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'vehicle', label: t('fleet.odometer.columns.vehicle'), ok: vehicleId !== '' },
      { key: 'occurredAt', label: t('fleet.accidents.fields.occurredAt'), ok: occurredAt !== '' },
      { key: 'culprit', label: t('fleet.accidents.fields.culprit'), ok: culprit.trim() !== '' },
      {
        key: 'statement',
        label: t('fleet.accidents.fields.statement'),
        ok: statement.trim() !== '',
      },
      {
        key: 'companyCost',
        label: t('fleet.accidents.fields.companyCost'),
        ok: isAmount(companyCost),
      },
      {
        key: 'amountCollected',
        label: t('fleet.accidents.fields.amountCollected'),
        ok: isAmount(amountCollected),
      },
      {
        key: 'paidAmount',
        label: t('fleet.accidents.fields.paidAmount'),
        ok: isAmount(paidAmount),
      },
      // A car picked to take from must be a DIFFERENT car with enough on it, and an amount.
      {
        key: 'transfer',
        label: t('fleet.accidents.transfer.fromVehicle'),
        ok: !transferring || transfer !== undefined,
      },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    if (accident === null) {
      await create.mutateAsync({
        vehicleId,
        occurredAt: new Date(occurredAt),
        culprit: culprit.trim(),
        culpritEmployeeId: culpritEmployeeIds[0] ?? null,
        culpritEmployeeIds,
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
      // The whole list when it changed — cleared to none, one, or several.
      if (culpritEmployeeIds.join(',') !== accident.culpritEmployeeIds.join(',')) {
        body.culpritEmployeeIds = culpritEmployeeIds;
      }
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
      dismissOnOutsideClick={false}
      size="xl"
      tall
      title={accident === null ? t('fleet.accidents.record') : t('fleet.accidents.edit')}
      description={t('fleet.accidents.formHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <div className="grid gap-4 sm:grid-cols-2">
          {/* «عاوز اكتب» and «كل العربيات تظهر لما ادوس على كود السياره» — typed or picked, from
              every car in the registry, disposed ones included: an accident is a historical fact. */}
          <Field
            label={t('fleet.odometer.columns.vehicle')}
            required
            missing={required.isMissing('vehicle')}
            hint={t('fleet.accidents.vehicleHint')}
          >
            <VehicleCodeCombobox
              value={vehicleId}
              onChange={setVehicleId}
              anyStatus
              ariaLabel={t('fleet.odometer.columns.vehicle')}
              placeholder={t('fleet.accidents.vehiclePlaceholder')}
              testId="accident-vehicle"
            />
          </Field>
          <Field
            label={t('fleet.accidents.fields.occurredAt')}
            required
            missing={required.isMissing('occurredAt')}
          >
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
          missing={required.isMissing('culprit')}
          // Save refuses until the NAME is in hand, so while it is on its way the form says so
          // rather than leaving a refused press with no reason. It is the state that used to be
          // permanent and silent.
          {...(awaitingNameFor === '' ? {} : { warning: t('fleet.accidents.culpritNameLoading') })}
        >
          <RegistryDriverPicker
            value={culpritEmployeeIds}
            multiple
            onChange={(next) => {
              setCulpritEmployeeIds(next);
              // Clearing every driver clears the name with them; picking asks for the names and
              // the effect above writes them the moment the roster answers.
              if (next.length === 0) {
                setCulprit('');
                setAwaitingNameFor('');
                return;
              }
              const known = namesOf(next);
              if (known === undefined) setAwaitingNameFor(next.join(','));
              else {
                setCulprit(known);
                setAwaitingNameFor('');
              }
            }}
            fullWidth
            className="w-full"
          />
        </Field>
        <Field
          label={t('fleet.accidents.fields.statement')}
          required
          missing={required.isMissing('statement')}
        >
          <Textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t('fleet.accidents.fields.companyCost')}
            required
            missing={required.isMissing('companyCost')}
          >
            <MoneyInput value={companyCost} onChange={setCompanyCost} />
          </Field>
          <Field
            label={t('fleet.accidents.fields.amountCollected')}
            required
            missing={required.isMissing('amountCollected')}
          >
            <MoneyInput value={amountCollected} onChange={setAmountCollected} />
          </Field>
          <Field
            label={t('fleet.accidents.fields.paidAmount')}
            required
            missing={required.isMissing('paidAmount')}
          >
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
            <Field
              label={t('fleet.accidents.transfer.fromVehicle')}
              missing={required.isMissing('transfer')}
              hint={t('fleet.accidents.transfer.pickOrder')}
              // Cars picked that cannot be taken from: the reason, not «required».
              {...(required.isMissing('transfer') && transferProblem !== null
                ? { error: transferProblem }
                : {})}
            >
              <MultiSelect
                clearable
                label={t('fleet.accidents.transfer.fromVehicle')}
                placeholder={t('common.select')}
                options={offered.map((car) => ({
                  value: car.vehicleId,
                  label: `${car.vehicleCode} — ${money(car.remaining)}`,
                  shortLabel: car.vehicleCode,
                }))}
                value={picked}
                onChange={setFromVehicleIds}
                fullWidth
                className="w-full"
              />
            </Field>
            <Field
              label={t('fleet.accidents.transfer.amount')}
              hint={t('fleet.accidents.transfer.amountAuto')}
            >
              {/* Shown, never typed — «مش انا اللى هكتب المبلغ الماخوذ». */}
              <div
                data-transfer-amount="true"
                aria-readonly="true"
                className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-sm font-bold text-brand-700 dark:border-slate-700 dark:bg-slate-800 dark:text-brand-300"
              >
                {money(taking)}
              </div>
            </Field>
          </div>
          {transferring && (
            <div
              data-transfer-balance="true"
              className="space-y-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
            >
              <p>
                {t('fleet.accidents.transfer.before')}{' '}
                <span
                  className={cn('font-bold', targetBefore < 0 && 'text-red-600 dark:text-red-300')}
                >
                  {money(targetBefore)}
                </span>
              </p>
              {/* One row per car, in the order it gives: what it has, what it gives, what is left. */}
              <table className="w-full text-center tabular-nums">
                <thead className="text-xs text-sky-700 dark:text-sky-300">
                  <tr>
                    <th className="py-1 font-medium">#</th>
                    <th className="py-1 font-medium">
                      {t('fleet.accidents.transfer.columns.car')}
                    </th>
                    <th className="py-1 font-medium">
                      {t('fleet.accidents.transfer.columns.available')}
                    </th>
                    <th className="py-1 font-medium">
                      {t('fleet.accidents.transfer.columns.take')}
                    </th>
                    <th className="py-1 font-medium">
                      {t('fleet.accidents.transfer.columns.left')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row, i) => (
                    <tr
                      key={row.vehicleId}
                      data-transfer-car={row.code}
                      className="border-t border-sky-200/70 dark:border-sky-900"
                    >
                      <td className="py-1 text-sky-600 dark:text-sky-400">{i + 1}</td>
                      <td className="py-1 font-medium">{row.code}</td>
                      <td className="py-1">{money(row.available)}</td>
                      <td className="py-1">{money(row.take)}</td>
                      <td
                        className={cn(
                          'py-1',
                          row.left === 0 && 'font-bold text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {money(row.left)}
                      </td>
                    </tr>
                  ))}
                  {plan.rows.length > 1 && (
                    <tr className="border-t border-sky-200/70 font-bold dark:border-sky-900">
                      <td />
                      <td className="py-1">{t('fleet.accidents.transfer.columns.total')}</td>
                      <td className="py-1">{money(plan.total)}</td>
                      <td className="py-1">{money(taking)}</td>
                      <td className="py-1">{money(plan.total - taking)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {transfer !== undefined && (
            <p
              data-transfer-after="true"
              className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              {t('fleet.accidents.transfer.after')}{' '}
              <span>
                {money(
                  fleetAccidentRemaining({
                    amountCollected: targetBefore,
                    companyCost: 0,
                    paidAmount: 0,
                    transferredIn: taking,
                  }),
                )}
              </span>
            </p>
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

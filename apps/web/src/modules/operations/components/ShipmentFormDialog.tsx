// Create / edit a cash shipment — the legacy `/main_ops` add and edit forms, in the Fleet forms'
// design («عدل الـ ui بتاع الفورم … زى الحركة»: `DesignDialog`, the shape every Fleet entry form
// takes).
//
// The shipment's data — the three banks, the branches, the area, the money lines, the dates and
// their floors — is held and boxed by `ShipmentDraftFields` (`useShipmentDraft`), which Round 18's
// receive form («إستلام محصنة») shares, so the two forms keep ONE set of rules. What is this form's
// own: its three-column layout, the required-field banner, the collection crew of a new shipment,
// and the save.
//
// «تتبّع أرقام الأوراق النقدية» is gone from the form — «ومحتاج اشيل دا». The API keeps the field:
// a new shipment is sent `false` (its default), and an edit leaves whatever is stored untouched.
//
// «اسم القائد وكود العربيه»: two boxes over ONE choice — a crew row of the collection date's plan.
// Picking a vehicle names the captain on it; picking a captain names his vehicle. Only on CREATE:
// re-crewing a saved shipment moves a stop between captains' ordered days, which is not an edit.
//
import { useEffect, useId, useMemo, useState } from 'react';
import {
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsShipmentDto,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Combobox } from '../../../shared/ui/Combobox';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { useAppSelector } from '../../../store';
import {
  DesignCancel,
  DesignDialog,
  DesignSave,
  DesignSection,
} from '../../fleet/components/DesignDialog';
import { DesignField, carBoxClass } from '../../fleet/components/FuelCardDialog';
import {
  useCreateOperationsShipment,
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useUpdateOperationsShipment,
} from '../api/operations-queries';
import {
  chooseVehicle,
  dispatchCrewOptions,
  findDispatchOption,
  vehiclesOf,
} from '../lib/dispatch-crew';
import {
  SHIPMENT_DATE_PROBLEM_KEY,
  secondaryBankFor,
  isLockedRefusal,
  shipmentSaveErrorKey,
} from '../lib/shipment-form';
import { cairoToday } from '../lib/shipment-history';
import {
  AddLineButton,
  AreaBox,
  CollectionDateField,
  DeliveryDateField,
  DraftBranchCreate,
  DraftBranchSide,
  MainBankField,
  MoneyLines,
  NotesField,
  deliveryDateFor,
  hasUsableLine,
  toShipmentLines,
  useShipmentDraft,
} from './ShipmentDraftFields';
import { SHIPMENT_PATH } from './shipment-icons';

// The line helpers live with the shared draft; the shipment form's specs (and any caller) still
// find them here, where they were first written.
export {
  EMPTY_LINE,
  MAX_SHIPMENT_LINES,
  defaultCurrencyId,
  deliveryDateFor,
  hasUsableLine,
  toShipmentLines,
  type DraftLine,
} from './ShipmentDraftFields';

export const ShipmentFormDialog = ({
  open,
  shipment,
  banks,
  currencies,
  createType,
  onClose,
}: {
  open: boolean;
  /**
   * The kind a NEW shipment is — decided by the screen, not chosen in the form. «عاوز اضافة شحنة
   * اشيل النوع ويكون يومى بس»: the day board adds daily shipments; the secured backlog (legacy
   * `/mohsana`, where secured shipments were always created) adds secured ones. An edit keeps the
   * shipment's own type — it never changes (legacy had no path between the two).
   */
  createType: OperationsShipmentType;
  /**
   * A board row (with its branches resolved) or a plain shipment; null creates one — dated today
   * (Cairo), the earliest day a new shipment may have, whichever screen it is added from.
   */
  shipment: OperationsShipmentDto | OperationsDayBoardShipmentDto | null;
  banks: OperationsBankDto[];
  currencies: OperationsCurrencyDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const can = useCan();
  const create = useCreateOperationsShipment();
  const update = useUpdateOperationsShipment();
  const draft = useShipmentDraft({ open, shipment, createType, banks, currencies });
  const {
    editing,
    row,
    shipmentType,
    mainBankId,
    toBankId,
    originBranchId,
    destinationBranchId,
    areaName,
    collectionDate,
    deliveryDate,
    notes,
    lines,
    adding,
    dateProblems,
    needsDeliveryDate,
    collectionLabel,
  } = draft;
  const [crewKey, setCrewKey] = useState('');
  useEffect(() => {
    if (open) setCrewKey('');
  }, [open, shipment]);

  // ── The collection crew (legacy leader1 + car_num1, written at creation) ──────────────────────
  //
  // Read from the collection date's crew plan; both boxes edit the SAME choice (`crewKey`, one
  // crew row and one of its captains), so they cannot disagree. Only on CREATE: re-crewing a saved
  // shipment moves a stop between captains' ordered days, which is not an edit.
  const canSeeCrew = can('operationsCrew.view');
  const crewHintId = useId();
  const crewOn = open && !editing && canSeeCrew && collectionDate !== '';
  const crewBoard = useOperationsCrewBoard(crewOn ? collectionDate : null, crewOn);
  const crewDirectory = useOperationsCrewDirectory(crewOn ? collectionDate : null, crewOn);
  const crewOptions = useMemo(
    () => dispatchCrewOptions(crewBoard.data?.rows ?? []),
    [crewBoard.data],
  );
  const chosenCrew = findDispatchOption(crewOptions, crewKey);
  // The day changed under the choice — a crew belongs to a date, so a stale pick would be refused
  // (OPERATIONS_CREW_DAY_MISMATCH).
  useEffect(() => setCrewKey(''), [collectionDate]);

  const captainName = (employeeId: string): string =>
    crewDirectory.data?.members.find((m) => m.employeeId === employeeId)?.fullNameAr ?? '…';
  // A captain named twice (two vans — the plan forbids it, but a stale plan could) says which van.
  const captainLabel = (key: string): string => {
    const option = findDispatchOption(crewOptions, key);
    if (option === undefined) return key;
    const twice =
      crewOptions.filter((o) => o.captainEmployeeId === option.captainEmployeeId).length > 1;
    const name = captainName(option.captainEmployeeId);
    return twice ? `${name} — ${option.vehicleCode}` : name;
  };
  const vehicles = vehiclesOf(crewOptions);

  // ── Required fields ────────────────────────────────────────────────────────────────────────────
  const required = useRequiredFields(
    [
      { key: 'mainBank', label: t('operations.shipment.form.mainBank'), ok: mainBankId !== '' },
      { key: 'origin', label: t('operations.shipment.origin'), ok: originBranchId !== '' },
      {
        key: 'destination',
        label: t('operations.shipment.destination'),
        ok: destinationBranchId !== '',
      },
      {
        key: 'collectionDate',
        label: collectionLabel,
        ok: collectionDate !== '',
      },
      // A new محصنة's delivery date — it opens filled in (the day after collection), so this only
      // ever names one the person emptied. Not an old محصنة stored without one (legacy never
      // required it, receive_mohsana.ejs:644): a date invented to get past the form would put it
      // on that day's dispatch list (`deliveryDateRequired`).
      {
        key: 'deliveryDate',
        label: t('operations.shipment.deliveryDate'),
        ok: !needsDeliveryDate || deliveryDate !== '',
      },
      { key: 'amount', label: t('operations.shipment.form.amount'), ok: hasUsableLine(lines) },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    // Refused here first, in words, rather than sent to be refused by the server. Today is read
    // again: the save may come after a midnight the last render did not see.
    const problems = dateProblems(cairoToday());
    const problem = problems.collection ?? problems.delivery;
    if (problem !== null) {
      toast.error(t(SHIPMENT_DATE_PROBLEM_KEY[problem]));
      return;
    }
    const core = {
      mainBankId,
      secondaryBankId: secondaryBankFor(mainBankId, toBankId),
      originBranchId,
      destinationBranchId,
      areaName: areaName.trim() === '' ? null : areaName.trim(),
      lines: toShipmentLines(lines),
      // The contract types dates post-coercion, and JSON.stringify serialises a Date to ISO —
      // which is exactly what the server coerces back.
      collectionDate: new Date(collectionDate),
      deliveryDate: deliveryDateFor(shipmentType, deliveryDate),
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      if (shipment === null) {
        await create.mutateAsync({
          ...core,
          shipmentType,
          // «تتبّع أرقام الأوراق النقدية» is no longer asked: a new shipment takes the field's
          // default. An edit sends nothing for it, so whatever is stored stays.
          serialTracked: false,
          // The VEHICLE IS NOT SENT. `crewAssignmentId` is a (day, vehicle) row, so the vehicle is
          // a fact the server reads off it — a client that named its own could claim a captain was
          // on a van he was never planned onto.
          pickup:
            chosenCrew === undefined
              ? null
              : {
                  crewAssignmentId: chosenCrew.crewAssignmentId,
                  captainEmployeeId: chosenCrew.captainEmployeeId,
                },
        });
      }
      // `shipmentType` is immutable — legacy has no path that converts one type into the other.
      else
        await update.mutateAsync({ id: shipment.id, body: { ...core, version: shipment.version } });
      toast.success(t('operations.shipment.saved'));
      onClose();
    } catch (error) {
      // The mutations leave their errors to this form (operations-queries.ts), so this is the one
      // message — in the reader's language, naming the reason where the server gave one, and the
      // shared wording when the reason is not the values at all (a dropped connection, no rights).
      const key = shipmentSaveErrorKey(error);
      toast.error(key === null ? errorMessage(error, locale) : t(key));
      // Round 10: the vault received this محصنة after the form was opened from a row read before
      // its ✓ («ميقدر حد … يعدل عليها»). Nothing typed can be saved past that, so the form closes on
      // its message — over a board the refusal re-reads (`useUpdateOperationsShipment`), where the
      // row is now green and offers no edit.
      if (isLockedRefusal(error)) onClose();
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <>
      <DesignDialog
        open={open}
        // Escape inside the branch form closes THAT form; this one must not close with it. Both are
        // DesignDialogs listening on the window, in whatever order React last registered them:
        // only the dialog on top of the `[data-dialog-root]` stack answers, and it marks the key
        // handled for a listener that runs after it. `adding` alone is not enough — a real key
        // press lets React commit `adding = null` and re-register this listener before the event
        // reaches it. The check stays for the × and «إلغاء» while the branch form is up.
        onClose={() => {
          if (adding === null) onClose();
        }}
        // A new محصنة says so — «إضافة محصنة», as the secured screen's button does.
        title={t(
          editing
            ? 'operations.shipment.edit'
            : shipmentType === 'secured'
              ? 'operations.secured.backlog.add'
              : 'operations.shipment.add',
        )}
        subtitle={t('operations.shipment.form.subtitle')}
        icon={SHIPMENT_PATH.shipment}
        width="6xl"
        dense
        panelProps={{ 'data-shipment-form': editing ? 'edit' : 'new' }}
        footer={
          <>
            <DesignSave
              data-shipment-save="true"
              busy={busy}
              onClick={required.guard(() => void submit())}
            />
            <DesignCancel onClick={onClose} />
          </>
        }
      >
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />

        {/* «الفورم … كبيرة انها متهكنش فيها اسكرول»: ONE band of three columns on a wide panel —
            the shipment, its two branches, then the money and the crew — so the form is as tall as
            its tallest column rather than the sum of its rows, and fits a laptop screen. One
            column on a narrow screen. */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
          <DesignSection
            title={t('operations.shipment.form.sections.shipment')}
            icon={SHIPMENT_PATH.calendar}
          >
            {/* What «الرئيسي» means is the form's subtitle («البنك المُحاسب…»); a hint here too
                would cost the line that keeps the form on a laptop screen without a scroll. */}
            <MainBankField draft={draft} missing={required.isMissing('mainBank')} />
            <CollectionDateField draft={draft} missing={required.isMissing('collectionDate')} />
            {shipmentType === 'secured' && (
              <DeliveryDateField draft={draft} missing={required.isMissing('deliveryDate')} />
            )}
            <NotesField draft={draft} />
          </DesignSection>

          <DesignSection
            title={t('operations.shipment.form.sections.route')}
            icon={SHIPMENT_PATH.route}
          >
            <div className="space-y-4">
              <DraftBranchSide draft={draft} side="origin" missing={required.isMissing('origin')} />
              <DraftBranchSide
                draft={draft}
                side="destination"
                missing={required.isMissing('destination')}
              >
                {/* «المنطقة … تحت الفرع اللى الى»: under the TO branch, read only. */}
                <AreaBox areaName={areaName} />
              </DraftBranchSide>
            </div>
          </DesignSection>

          <div className="space-y-5">
            {/* «+ إضافة عملة» sits on the section's own title line, and only the first line
                carries the boxes' names: a shipment of several currencies (the owner's own
                example has four) grows by a box's height a currency, not a labelled field's. */}
            <div className="relative">
              <DesignSection
                title={t('operations.shipment.form.sections.money')}
                icon={SHIPMENT_PATH.money}
              >
                <MoneyLines draft={draft} missing={required.isMissing('amount')} />
              </DesignSection>
              <AddLineButton draft={draft} className="absolute end-0 top-0" />
            </div>

            <DesignSection
              title={t('operations.shipment.form.sections.crew')}
              icon={SHIPMENT_PATH.crew}
            >
              {editing ? (
                // Re-crewing a saved shipment is not an edit — it moves a stop between captains'
                // ordered days. What it rides with now is shown, read only.
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200">
                  {row?.crew != null
                    ? t('operations.shipment.form.crewHeld', {
                        captain: row.crew.captainName ?? '—',
                        vehicle: row.crew.vehicleCode ?? '—',
                      })
                    : // «No crew yet» is said plainly only of a daily row, whose one leg the row
                      // reports. A secured row reports the leg it is ON — the pickup on its way to the
                      // vault, the delivery from the vault on — and its crews are named on the
                      // vault's screens; a plain shipment carries no legs at all. For those, say
                      // where the crew is set.
                      t(
                        row !== null && row.shipmentType === 'daily'
                          ? 'operations.shipment.form.crewNotOnEdit'
                          : 'operations.shipment.form.crewElsewhere',
                      )}
                </p>
              ) : !canSeeCrew ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('operations.shipment.form.crewNoAccess')}
                </p>
              ) : (
                <>
                  {/* How the two boxes pick each other, said to a screen reader on both of them — a
                    visible line would cost the height that keeps the form without a scroll. */}
                  <span id={crewHintId} className="sr-only">
                    {t('operations.shipment.form.crewHint')}
                  </span>
                  <div
                    className="grid grid-cols-1 items-start gap-4"
                    title={t('operations.shipment.form.crewHint')}
                  >
                    <DesignField label={t('operations.shipment.form.captain')}>
                      <div className={carBoxClass(false)}>
                        <Combobox
                          value={crewKey}
                          options={crewOptions.map((option) => option.key)}
                          optionLabel={captainLabel}
                          onChange={setCrewKey}
                          placeholder={t('operations.shipment.noCrew')}
                          emptyText={t(crewBoard.isLoading ? 'common.loading' : 'common.noResults')}
                          clearLabel={t('common.clear')}
                          ariaLabel={t('operations.shipment.form.captain')}
                          testId="shipment-captain"
                          ariaDescribedBy={crewHintId}
                        />
                      </div>
                    </DesignField>
                    <DesignField label={t('operations.shipment.form.vehicle')}>
                      <div className={carBoxClass(false)}>
                        <Combobox
                          value={chosenCrew?.vehicleId ?? ''}
                          options={vehicles.map((vehicle) => vehicle.vehicleId)}
                          optionLabel={(id) =>
                            vehicles.find((vehicle) => vehicle.vehicleId === id)?.vehicleCode ?? id
                          }
                          onChange={(vehicleId) =>
                            setCrewKey(
                              vehicleId === ''
                                ? ''
                                : (chooseVehicle(
                                    crewOptions,
                                    vehicleId,
                                    chosenCrew?.captainEmployeeId ?? '',
                                  )?.key ?? ''),
                            )
                          }
                          placeholder={t('operations.shipment.noCrew')}
                          emptyText={t(crewBoard.isLoading ? 'common.loading' : 'common.noResults')}
                          clearLabel={t('common.clear')}
                          ariaLabel={t('operations.shipment.form.vehicle')}
                          testId="shipment-vehicle"
                          ariaDescribedBy={crewHintId}
                        />
                      </div>
                    </DesignField>
                  </div>
                  {/* Only the warning keeps a line of its own; how the two boxes pick each other is said
                    by the boxes' title, so the form fits a laptop screen with no scroll. */}
                  {crewOptions.length === 0 && !crewBoard.isLoading && (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      {t('operations.shipment.noCrewForDay')}
                    </p>
                  )}
                </>
              )}
            </DesignSection>
          </div>
        </div>
      </DesignDialog>

      {/* «يظهر موديل كدا انه يضيف باقى البيانات»: the catalogs screen's own branch form. */}
      <DraftBranchCreate draft={draft} />
    </>
  );
};

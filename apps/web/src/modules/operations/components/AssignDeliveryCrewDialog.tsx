// «تعيين طاقم التسليم» — «صرف الخزينة»'s first act on a row: which captain, on which vehicle, takes
// this محصنة out of the vault. The legacy `/tash4ela_mohasana` step, which wrote exactly `leader2` +
// `car_num2` and nothing else — still so: assigning moves no status (`POST
// /operations/secured/:id/assign-delivery`, `operationsShipment.edit`).
//
// THE CREW OF THE ROW'S OWN DELIVERY DAY. The board lists every محصنة in the vault, whatever its day
// («كله يبقى موجود فى تاريخ يتفلتر»), and the screen's date filter may be empty or another day — but
// a delivery crew is planned on the day it delivers, and the server refuses any other day's
// (`OPERATIONS_CREW_DAY_MISMATCH`). So the choices are read from the crew board of the SHIPMENT's
// delivery day, said above them, never from the filter.
//
// THE CHOICE: the captain, with the vehicle he is on that day following, the vehicle still
// changeable — the shipment form's two boxes' rule («أعين الشحنة لقائد وتلقائي يختار السيارة … وممكن
// أغير العربية عادي»), over one (crew row, captain) pair (`dispatchCrewOptions`) so they cannot
// disagree. A two-captain vehicle offers both of its captains; the dialog never picks one for the
// reader. It opens on the crew already assigned, when there is one — a change, not a first one.
// Two plain lists, not the form's typeahead boxes: a day's crew is a handful of names, and a
// typeahead's open list was cut off by this short panel (the panel clips what overflows it) —
// a native list opens over everything, and as the phone's own picker on a phone.
//
// The `version` sent is the delivery LEG's (`deliveryAssignVersion`), never the shipment's: the leg
// is what this writes. A refusal is said in the reader's words; one saying the row is out of date
// (409) closes the dialog over the board the refusal re-read (`useAssignSecuredDelivery`).
//
// THE CREW BOARD is `operationsCrew.view`'s. A reader without it is told so instead of being shown
// two empty lists (the receive form's rule), and the board is not asked for.
import { useId, useMemo, useRef, useState } from 'react';
import { type Locale, type OperationsSecuredDispatchRowDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { DesignField } from '../../fleet/components/FuelCardDialog';
import { BoardIcon } from '../../fleet/components/FuelCardBoard';
import {
  useAssignSecuredDelivery,
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
} from '../api/operations-queries';
import {
  chooseVehicle,
  dispatchCrewOptions,
  findDispatchOption,
  vehiclesOf,
} from '../lib/dispatch-crew';
import { deliveryAssignVersion, deliveryDayOf, heldCrewKey } from '../lib/secured-dispatch';
import { ltrIsolate } from '../lib/shipment-log';
import { SHIPMENT_PATH } from './shipment-icons';

/** What the dialog is about: the row, and the line under the title that names it. */
export interface AssignDeliveryTarget {
  row: OperationsSecuredDispatchRowDto;
  /** «الأهلي · المعادي ← الدقي · 2026-11-12» (`shipmentCaption`), as «السجل» names it. */
  caption: string;
}

/** A refusal saying the row on screen is out of date — asking again from it cannot succeed. */
const isStaleRow = (error: unknown): boolean => error instanceof ApiError && error.status === 409;

/** The design's box, on a native list — the shipment form's currency box. */
const SELECT_BOX = cn(
  '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
  '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
);

/** A plain information line of the design — the day the crew is read from, the crew there now. */
const INFO_LINE =
  'flex items-start gap-3 rounded-xl border px-4 py-3 text-[15px] font-semibold leading-7';

/** `target` null = closed. Mounted once per page. */
export const AssignDeliveryCrewDialog = ({
  target,
  onClose,
}: {
  target: AssignDeliveryTarget | null;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const assign = useAssignSecuredDelivery();
  const hintId = useId();

  const row = target?.row ?? null;
  // The crew of the SHIPMENT's delivery day — never the screen's filter.
  const day = row === null ? null : deliveryDayOf(row);
  const canSeeCrew = can('operationsCrew.view');
  const crewOn = day !== null && canSeeCrew;
  const crewBoard = useOperationsCrewBoard(day, crewOn);
  const directory = useOperationsCrewDirectory(day, crewOn);
  const options = useMemo(() => dispatchCrewOptions(crewBoard.data?.rows ?? []), [crewBoard.data]);

  // Opens on the crew already assigned, when it is one of that day's (a change of crew). Reset per
  // row opened — not per render of the same row: a refetch behind the open dialog keeps the pick.
  const [crewKey, setCrewKey] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const id = row?.id ?? null;
  if (openFor !== id) {
    setOpenFor(id);
    setCrewKey(row === null ? '' : heldCrewKey(row));
  }
  const chosen = findDispatchOption(options, crewKey);
  const vehicles = vehiclesOf(options);

  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);

  if (target === null || row === null || day === null) return null;

  const captainName = (employeeId: string): string =>
    directory.data?.members.find((m) => m.employeeId === employeeId)?.fullNameAr ?? '…';
  // A captain named twice (on two vans — the plan forbids it, a stale plan could) says which van.
  const captainLabel = (key: string): string => {
    const option = findDispatchOption(options, key);
    if (option === undefined) return key;
    const twice =
      options.filter((o) => o.captainEmployeeId === option.captainEmployeeId).length > 1;
    const name = captainName(option.captainEmployeeId);
    return twice ? `${name} — ${option.vehicleCode}` : name;
  };

  const busy = waiting || assign.isPending;
  // The crew already there, chosen again, is not a change worth a request.
  const unchanged = chosen !== undefined && chosen.key === heldCrewKey(row);

  const save = (): void => {
    if (sending.current || chosen === undefined || unchanged) return;
    sending.current = true;
    setWaiting(true);
    assign
      .mutateAsync({
        id: row.id,
        body: {
          // The crew ROW is the legacy tashghela row; the captain is one of ITS captains.
          crewAssignmentId: chosen.crewAssignmentId,
          captainEmployeeId: chosen.captainEmployeeId,
          version: deliveryAssignVersion(row),
        },
      })
      .then(
        () => {
          toast.success(t('operations.secured.dispatch.assigned'));
          onClose();
        },
        (error: unknown) => {
          toast.error(errorMessage(error, locale));
          if (isStaleRow(error)) onClose();
        },
      )
      .finally(() => {
        sending.current = false;
        setWaiting(false);
      });
  };

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t(
        row.crew === null
          ? 'operations.secured.dispatch.assignAction'
          : 'operations.secured.dispatch.reassignAction',
      )}
      subtitle={target.caption}
      icon={SHIPMENT_PATH.crew}
      width="xl"
      wrapTitle
      panelProps={{ 'data-assign-delivery': row.id }}
      footer={
        <>
          <DesignSave
            onClick={save}
            busy={busy}
            disabled={!canSeeCrew || chosen === undefined || unchanged}
            label={t('common.save')}
            data-assign-delivery-save="true"
          />
          <DesignCancel onClick={onClose} label={t('operations.secured.dispatch.back')} />
        </>
      }
    >
      {/* The day the crew is read from — the shipment's own, whatever the screen is filtered on. */}
      <div
        data-assign-delivery-day={day}
        className={cn(
          INFO_LINE,
          'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-500/40 dark:bg-indigo-500/[0.08] dark:text-indigo-100',
        )}
      >
        <BoardIcon
          d={SHIPMENT_PATH.calendar}
          className="mt-1.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300"
        />
        <span>
          {/* Kept in its own order inside the Arabic sentence, year first. */}
          {t('operations.secured.dispatch.assignDay', { date: ltrIsolate(day) })}
        </span>
      </div>

      {/* The crew it rides now, when it has one: what a save would change. */}
      {row.crew !== null && (
        <p
          data-assign-delivery-held="true"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200"
        >
          {t('operations.secured.dispatch.assignHeld', {
            captain: row.crew.captainName ?? '—',
            vehicle: row.crew.vehicleCode ?? '—',
          })}
        </p>
      )}

      {!canSeeCrew ? (
        <p
          data-assign-delivery-no-access="true"
          className="text-sm font-medium text-amber-700 dark:text-amber-400"
        >
          {t('operations.secured.dispatch.assignNoAccess')}
        </p>
      ) : (
        <>
          {/* How the two boxes pick each other, read with both — as on the shipment form. */}
          <span id={hintId} className="sr-only">
            {t('operations.shipment.form.crewHint')}
          </span>
          <div
            className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2"
            title={t('operations.shipment.form.crewHint')}
          >
            <DesignField label={t('operations.shipment.form.captain')} required>
              <Select
                value={crewKey}
                onChange={(e) => setCrewKey(e.target.value)}
                className={SELECT_BOX}
                aria-label={t('operations.shipment.form.captain')}
                aria-describedby={hintId}
                data-assign-delivery-captain="true"
              >
                <option value="">
                  {t(crewBoard.isLoading ? 'common.loading' : 'common.select')}
                </option>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {captainLabel(option.key)}
                  </option>
                ))}
              </Select>
            </DesignField>
            <DesignField label={t('operations.shipment.form.vehicle')} required>
              <Select
                value={chosen?.vehicleId ?? ''}
                onChange={(e) =>
                  setCrewKey(
                    e.target.value === ''
                      ? ''
                      : (chooseVehicle(options, e.target.value, chosen?.captainEmployeeId ?? '')
                          ?.key ?? ''),
                  )
                }
                className={SELECT_BOX}
                aria-label={t('operations.shipment.form.vehicle')}
                aria-describedby={hintId}
                data-assign-delivery-vehicle="true"
              >
                <option value="">
                  {t(crewBoard.isLoading ? 'common.loading' : 'common.select')}
                </option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                    {vehicle.vehicleCode}
                  </option>
                ))}
              </Select>
            </DesignField>
          </div>
          {/* Nobody planned with a captain on that day: say so, rather than two empty lists. */}
          {options.length === 0 && !crewBoard.isLoading && (
            <p
              data-assign-delivery-no-crew="true"
              className="text-sm font-medium text-amber-700 dark:text-amber-400"
            >
              {t('operations.secured.dispatch.noCrew')}
            </p>
          )}
        </>
      )}
    </DesignDialog>
  );
};

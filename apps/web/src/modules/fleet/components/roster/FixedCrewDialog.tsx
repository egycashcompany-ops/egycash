// «تعديل · 214» — one car's four standing facts edited together on a computer: the mission type,
// the two drivers and the note. The pen in «إجراءات» opens it on every row, the workshop's too (a
// car in the workshop still has a standing crew).
//
// THE RULES ARE TODAY'S, moved out of the page as they were:
//   · the dialog holds its OWN copy of the four facts and hands them back only on «حفظ», so
//     «إلغاء» means cancel: nothing outside it changes until then — not the draft, not the server;
//   · it re-implements no driver rule: it offers the drivers the draft seats nowhere plus this
//     car's own crew (`m.dialogCandidates`), and the board writes the values through `applyEdit`,
//     which routes each driver through `assignDriver` — one rule, reached from the seat, the drop
//     and here;
//   · the second driver waits for the first («عيّن السائق الأول أولاً»), and clearing the first
//     with a second chosen PROMOTES the second — the board's `clearSlot`, so the dialog shows the
//     crew the save will write;
//   · one person cannot hold both seats: each seat's list leaves out the other seat's pick, and
//     the pair is refused anyway if it is ever reached («حفظ» disabled);
//   · '' is not a note — the contract refuses it; nothing is spelled null. At most 500 letters.
//
// THE SEATS LOOK LIKE THE DAILY DIALOG'S (`RosterAssignDialog`'s DriverSlot) — «شباك تعديل ...
// زي التعيين اليومي»: a chosen driver is a bordered row, name and code with ✕ beside; an empty seat
// is «اختيار سائق», which opens the list in place. The move off another car is promised under the
// seat («سيُنقل من السيارة 214 عند الحفظ»). A driver the server holds on a car that is not on this
// board carries the blue «سيارة أخرى»; a free one carries nothing (answer 1 ب: no flag either).
//
// The name and the code keep a gap between them here: `EmployeeName`'s `ms-2` sits on a
// left-to-right code, which in Arabic is the side away from the name — so this dialog draws its
// own face rather than change the daily dialog's.
import { useState } from 'react';
import { type FleetFixedCrewRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Select, Textarea } from '../../../../shared/ui/form';
import { CloseIcon } from '../../../../shared/ui/icons';
import { useFleetCatalog } from '../../api/fleet-queries';
import { type FixedEditValues, type FixedRosterBoardModel } from '../../lib/fixed-roster-model';

/** What a seat needs of the board: who a person is, who is held off the board, the move. */
type SeatModel = Pick<FixedRosterBoardModel, 'person' | 'heldOff' | 'transferFrom'>;

/** A driver's name and code with a real gap between them, whatever the direction. */
const NameAndCode = ({
  employeeId,
  person,
}: {
  employeeId: string;
  person: SeatModel['person'];
}): JSX.Element => {
  const record = person(employeeId);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
      {/* The id's tail when the name is out of reach — a taken seat must not read as empty. */}
      <span className="font-medium text-slate-900 dark:text-slate-50">
        {record?.fullNameAr ?? employeeId.slice(-8)}
      </span>
      {record !== undefined && (
        <bdi dir="ltr" className="font-figures text-xs text-slate-500 dark:text-slate-400">
          {record.code}
        </bdi>
      )}
    </span>
  );
};

/**
 * One seat, in the daily dialog's look: picked → the person + ✕ (and the move, when there is
 * one); empty → «اختيار سائق», then the list in place. Module level, so a native control keeps
 * its element across the dialog's keystrokes.
 */
const CrewSeat = ({
  model,
  vehicleId,
  value,
  onChange,
  exclude,
  candidates,
  disabled = false,
}: {
  model: SeatModel;
  vehicleId: string;
  value: string | null;
  onChange: (employeeId: string | null) => void;
  /** The other seat's pick — one person cannot hold both seats. */
  exclude: string | null;
  candidates: readonly string[];
  /** The second seat while the first is empty: a pair the record may not hold. */
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const [picking, setPicking] = useState(false);

  if (value !== null) {
    const movedFrom = model.transferFrom(value, vehicleId);
    return (
      <div className="space-y-1" data-crew-seat="filled">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
          <NameAndCode employeeId={value} person={model.person} />
          <button
            type="button"
            data-clear-seat="true"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800"
            aria-label={t('common.clear')}
            title={t('common.clear')}
            onClick={() => onChange(null)}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {movedFrom !== null && (
          <p data-transfer-hint={movedFrom} className="text-xs text-amber-600 dark:text-amber-400">
            {t('fleet.roster.transferHint', { code: movedFrom })}
          </p>
        )}
      </div>
    );
  }

  if (!picking || disabled) {
    return (
      <Button
        size="sm"
        variant="secondary"
        data-crew-seat="empty"
        disabled={disabled}
        onClick={() => setPicking(true)}
      >
        {t('fleet.roster.pickDriver')}
      </Button>
    );
  }

  return (
    <CrewCandidates
      model={model}
      candidates={candidates}
      exclude={exclude}
      onPick={(id) => {
        onChange(id);
        setPicking(false);
      }}
    />
  );
};

/**
 * An empty seat's list, opened in place: the candidates minus the other seat's pick — the illegal
 * pair cannot be chosen in the first place. Exported for the specs, which cannot click it open.
 */
export const CrewCandidates = ({
  model,
  candidates,
  exclude,
  onPick,
}: {
  model: Pick<SeatModel, 'person' | 'heldOff'>;
  candidates: readonly string[];
  exclude: string | null;
  onPick: (employeeId: string) => void;
}): JSX.Element => {
  const t = useT();
  const heldOff = new Set(model.heldOff.map((driver) => driver.employeeId));
  const offered = candidates.filter((id) => id !== exclude);
  return (
    <div
      data-crew-seat="list"
      className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800"
    >
      {offered.length === 0 ? (
        <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
          {t('fleet.fixedRoster.poolEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {offered.map((id) => (
            <li key={id}>
              <button
                type="button"
                data-crew-candidate={id}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60"
                onClick={() => onPick(id)}
              >
                <NameAndCode employeeId={id} person={model.person} />
                {/* Held on a car off this board: the daily list's blue «سيارة أخرى». A free
                    driver is simply a driver with no seat — no word beside him. */}
                {heldOff.has(id) && (
                  <Badge tone="info" className="shrink-0">
                    {t('fleet.roster.otherVehicle')}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const FixedCrewDialog = ({
  row,
  m,
  onClose,
  onSave,
}: {
  /** The car as the DRAFT holds it — the dialog opens on its current values. */
  row: FleetFixedCrewRowDto;
  m: Pick<FixedRosterBoardModel, 'person' | 'heldOff' | 'transferFrom' | 'dialogCandidates'>;
  onClose: () => void;
  /** Hands the four facts back. Nothing is written here. */
  onSave: (edit: FixedEditValues) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The SAME `missionType` catalog the cell and the daily roster read (one cached request).
  const missionTypes = useFleetCatalog('missionType');
  const [missionTypeId, setMissionTypeId] = useState<string | null>(row.missionTypeId);
  const [driver1, setDriver1] = useState<string | null>(row.driver1EmployeeId);
  const [driver2, setDriver2] = useState<string | null>(row.driver2EmployeeId);
  const [notes, setNotes] = useState<string>(row.notes ?? '');

  // Everyone the draft seats nowhere (free, and held off the board), PLUS this car's own crew —
  // missing from the pool precisely because they sit here.
  const candidates = m.dialogCandidates(row.vehicleId);

  // The one rule a two-seat form can break that a drag cannot: the same person in both seats.
  // `applyEdit` would silently displace the first with the second, so it is refused here.
  const sameTwice = driver1 !== null && driver1 === driver2;

  // A live mission, or the one already on the car (kept legible, as the cell keeps it).
  const missions = (missionTypes.data?.items ?? []).filter(
    (item) => item.isActive || item.id === row.missionTypeId,
  );

  return (
    <Dialog
      open
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={`${t('common.edit')} · ${row.code}`}
      description={t('fleet.fixedRoster.editHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            data-crew-save="true"
            disabled={sameTwice}
            onClick={() =>
              onSave({
                missionTypeId,
                driver1EmployeeId: driver1,
                driver2EmployeeId: driver2,
                // '' is not a note. The contract refuses an empty string, and `null` is how
                // this module spells "nothing" everywhere else.
                notes: notes.trim() === '' ? null : notes.trim(),
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-fixed-crew-dialog={row.code}>
        <Field label={t('fleet.roster.fields.mission')}>
          {missionTypes.isError ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {t('fleet.fixedRoster.missionTypesFailed')}
            </p>
          ) : (
            <Select
              value={missionTypeId ?? ''}
              disabled={missionTypes.isPending}
              onChange={(e) => setMissionTypeId(e.target.value || null)}
            >
              <option value="">{t('fleet.fixedRoster.noMissionType')}</option>
              {missions.map((item) => (
                <option key={item.id} value={item.id}>
                  {localized(item.name, locale)}
                </option>
              ))}
            </Select>
          )}
          {!missionTypes.isPending &&
            !missionTypes.isError &&
            (missionTypes.data?.items.length ?? 0) === 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.fixedRoster.noMissionTypesYet')}
              </p>
            )}
        </Field>

        <Field label={t('fleet.odometer.fields.driver1')}>
          <CrewSeat
            model={m}
            vehicleId={row.vehicleId}
            value={driver1}
            // Clearing the first seat does not leave the second stranded: the second is PROMOTED,
            // as `clearSlot` does on the board — the dialog shows the crew the save will write.
            onChange={(id) => {
              if (id === null && driver2 !== null) {
                setDriver1(driver2);
                setDriver2(null);
                return;
              }
              setDriver1(id);
            }}
            exclude={driver2}
            candidates={candidates}
          />
        </Field>
        <Field label={t('fleet.odometer.fields.driver2')}>
          <CrewSeat
            model={m}
            vehicleId={row.vehicleId}
            value={driver2}
            onChange={setDriver2}
            exclude={driver1}
            candidates={candidates}
            disabled={driver1 === null}
          />
          {driver1 === null && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.fixedRoster.needsFirstDriver')}
            </p>
          )}
        </Field>
        {sameTwice && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {t('fleet.fixedRoster.sameDriverTwice')}
          </p>
        )}

        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
};

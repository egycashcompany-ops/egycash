// Record/edit التمامات (§2.4 — the fleet's daily operational overlay; official leave stays in
// HR). Recording FOR a known driver (the profile page) skips the picker; the attendance screen
// picks through the directory. Editing adjusts dates/reason/notes only — a record never moves
// to another person. Version-aware; cancellation lives on the list as its own confirm.
//
// «بالفورم بتاعت التسجيل والتعديل»: drawn in the vehicle form's design — its header, its sections
// and its boxes — through the shared `DesignDialog` shell.
//
// «تحسين اختيار السواقيين فى … التمامات»: the driver is picked with `DriverPicker` — the whole
// roster the moment it opens, each driver drawn with the badge, the name and the code under it,
// searched by either — and a driver already decided is drawn the same way in its fixed box.
import { useEffect, useState } from 'react';
import { type FleetDriverUnavailabilityDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { Input, Textarea } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useRecordUnavailability, useUpdateUnavailability } from '../api/fleet-queries';
import { DriverIdentity, DriverPicker } from './DriverPerson';
import { DRIVER_BOX } from './OptionalDriverField';
import { useEmployeeRecord } from './EmployeeName';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { DATE_ICON, DesignField, LOOK, MONO, boxTone } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { FILTER_ICON } from './FilterWithIcon';

/** The design's text box, and a date in it — the vehicle form's. */
const BOX = boxTone(LOOK.add);
// A date's text starts at the box's left, where a refused box draws its «!».
const DATE_BOX = cn(BOX, MONO, DATE_ICON.add, 'cursor-pointer !pl-10');

/** A `Textarea` in the design's box — it takes no `tone`, so the box is laid over its base. */
const NOTE_BOX = cn(
  '!rounded-xl !px-4 !py-3 !text-[15px] !font-medium shadow-inner transition-all',
  '!border-slate-200 !bg-slate-50 !text-slate-900 dark:!border-[#2b3b6b] dark:!bg-[#0a1233] dark:!text-white',
  'placeholder:!text-slate-500 dark:placeholder:!text-slate-400',
  'focus:!border-indigo-500 focus:!outline-none focus:!ring-1 focus:!ring-indigo-500',
);

/**
 * A driver already decided (the profile page, or an edit): drawn as the picker draws its pick —
 * badge, name, code — in a box of the picker's height that cannot be typed in.
 */
const FIXED_BOX =
  'flex min-h-[3rem] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[15px] text-slate-900 shadow-inner dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:text-white';

/** The decided driver: the person the roster knows, or — not (yet) in it — the id's tail. */
const FixedDriver = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const person = useEmployeeRecord(employeeId);
  return person === undefined ? (
    <span className="font-mono text-xs text-slate-400" dir="ltr">
      {employeeId.slice(-8)}
    </span>
  ) : (
    <DriverIdentity name={person.fullNameAr} code={person.code} />
  );
};

/** Two boxes to a row on a computer, one on a phone — the vehicle form's grid. */
const GRID = 'grid grid-cols-1 items-start gap-5 md:grid-cols-2';

interface FormState {
  employeeId: string;
  from: string;
  to: string;
  reason: string;
  notes: string;
}

const fromRecord = (
  record: FleetDriverUnavailabilityDto | null,
  fixedEmployeeId: string | null,
): FormState => ({
  employeeId: record?.employeeId ?? fixedEmployeeId ?? '',
  from: record === null ? '' : record.from.slice(0, 10),
  to: record === null ? '' : record.to.slice(0, 10),
  reason: record?.reason ?? '',
  notes: record?.notes ?? '',
});

export const UnavailabilityDialog = ({
  open,
  onClose,
  record,
  fixedEmployeeId = null,
}: {
  open: boolean;
  onClose: () => void;
  /** null → record mode. */
  record: FleetDriverUnavailabilityDto | null;
  /** Pre-selected driver (profile page) — the picker is skipped. */
  fixedEmployeeId?: string | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [form, setForm] = useState<FormState>(fromRecord(record, fixedEmployeeId));
  useEffect(() => {
    if (open) setForm(fromRecord(record, fixedEmployeeId));
  }, [open, record, fixedEmployeeId]);

  const create = useRecordUnavailability();
  const update = useUpdateUnavailability();
  const busy = create.isPending || update.isPending;

  // Save stays pressable: pressing it with any of these empty names them and turns their boxes red
  // (`useRequiredFields`). An end before the start is one the server refuses, so «to» reads as
  // missing until it is on or after «from» rather than sending a save that can only fail.
  const required = useRequiredFields(
    [
      { key: 'driver', label: t('fleet.attendance.fields.driver'), ok: form.employeeId !== '' },
      { key: 'from', label: t('fleet.attendance.fields.from'), ok: form.from !== '' },
      {
        key: 'to',
        label: t('fleet.attendance.fields.to'),
        ok: form.to !== '' && (form.from === '' || form.to >= form.from),
      },
      { key: 'reason', label: t('fleet.attendance.fields.reason'), ok: form.reason.trim() !== '' },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    const notes = form.notes.trim() === '' ? null : form.notes.trim();
    if (record === null) {
      await create.mutateAsync({
        employeeId: form.employeeId,
        from: new Date(form.from),
        to: new Date(form.to),
        reason: form.reason.trim(),
        notes,
      });
      toast.success(t('fleet.attendance.recorded'));
    } else {
      await update.mutateAsync({
        id: record.id,
        body: {
          from: new Date(form.from),
          to: new Date(form.to),
          reason: form.reason.trim(),
          notes,
          version: record.version,
        },
      });
      toast.success(t('fleet.attendance.updated'));
    }
    onClose();
  };

  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={record === null ? t('fleet.attendance.record') : t('fleet.attendance.edit')}
      subtitle={t('fleet.attendance.subtitle')}
      icon={PATH.calendar}
      panelProps={{ 'data-attendance-form': record === null ? 'record' : 'edit' }}
      footer={
        <>
          <DesignSave data-attendance-save="true" busy={busy} onClick={required.guard(submit)} />
          <DesignCancel onClick={onClose} />
        </>
      }
    >
      <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
      <DesignSection
        title={t('fleet.attendance.form.sections.driverPeriod')}
        icon={FILTER_ICON.person}
      >
        {record === null && fixedEmployeeId === null ? (
          <DesignField
            label={t('fleet.attendance.fields.driver')}
            required
            missing={required.isMissing('driver')}
          >
            {/* Fleet's roster is read under the drivers' view grant: without it the picker says so
                rather than opening an empty list that silently finds nobody. */}
            {can('fleetDriver.view') ? (
              <DriverPicker
                value={form.employeeId}
                onChange={(employeeId) => setForm((prev) => ({ ...prev, employeeId }))}
                className={DRIVER_BOX}
                testId="attendance-driver"
              />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('fleet.drivers.pickerNeedsDirectory')}
              </p>
            )}
          </DesignField>
        ) : (
          <DesignField
            label={t('fleet.attendance.fields.driver')}
            missing={required.isMissing('driver')}
          >
            <div className={FIXED_BOX} data-attendance-driver="fixed">
              <FixedDriver employeeId={form.employeeId} />
            </div>
          </DesignField>
        )}
        <div className={GRID}>
          <DesignField
            label={t('fleet.attendance.fields.from')}
            required
            missing={required.isMissing('from')}
          >
            <Input
              type="date"
              value={form.from}
              onChange={(e) => setForm((prev) => ({ ...prev, from: e.target.value }))}
              tone={DATE_BOX}
            />
          </DesignField>
          <DesignField
            label={t('fleet.attendance.fields.to')}
            required
            missing={required.isMissing('to')}
            // Given, but before the start: say so rather than «required».
            error={
              required.isMissing('to') && form.to !== ''
                ? t('fleet.attendance.toBeforeFrom')
                : undefined
            }
          >
            <Input
              type="date"
              value={form.to}
              onChange={(e) => setForm((prev) => ({ ...prev, to: e.target.value }))}
              tone={DATE_BOX}
            />
          </DesignField>
        </div>
      </DesignSection>
      <DesignSection title={t('fleet.attendance.form.sections.details')} icon={PATH.edit}>
        <DesignField
          label={t('fleet.attendance.fields.reason')}
          required
          missing={required.isMissing('reason')}
          hint={t('fleet.attendance.reasonHint')}
        >
          <Input
            value={form.reason}
            onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
            rule="arabic"
            tone={BOX}
          />
        </DesignField>
        <DesignField label={t('fleet.attendance.fields.notes')}>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            className={NOTE_BOX}
          />
        </DesignField>
      </DesignSection>
    </DesignDialog>
  );
};

// Record/edit التمامات (§2.4 — the fleet's daily operational overlay; official leave stays in
// HR). Recording FOR a known driver (the profile page) skips the picker; the attendance screen
// picks through the directory. Editing adjusts dates/reason/notes only — a record never moves
// to another person. Version-aware; cancellation lives on the list as its own confirm.
import { useEffect, useState } from 'react';
import { type FleetDriverUnavailabilityDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useRecordUnavailability, useUpdateUnavailability } from '../api/fleet-queries';
import { EmployeeSearchPicker } from './EmployeeSearchPicker';
import { EmployeeName } from './EmployeeName';

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
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={record === null ? t('fleet.attendance.record') : t('fleet.attendance.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        {record === null && fixedEmployeeId === null ? (
          <Field
            label={t('fleet.attendance.fields.driver')}
            required
            missing={required.isMissing('driver')}
          >
            <EmployeeSearchPicker
              value={form.employeeId}
              onPick={(employeeId) => setForm((prev) => ({ ...prev, employeeId }))}
            />
          </Field>
        ) : (
          <Field label={t('fleet.attendance.fields.driver')} missing={required.isMissing('driver')}>
            <p className="text-sm">
              <EmployeeName employeeId={form.employeeId} />
            </p>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fleet.attendance.fields.from')}
            required
            missing={required.isMissing('from')}
          >
            <Input
              type="date"
              value={form.from}
              onChange={(e) => setForm((prev) => ({ ...prev, from: e.target.value }))}
            />
          </Field>
          <Field
            label={t('fleet.attendance.fields.to')}
            required
            missing={required.isMissing('to')}
            // Given, but before the start: say so rather than «required».
            {...(required.isMissing('to') && form.to !== ''
              ? { error: t('fleet.attendance.toBeforeFrom') }
              : {})}
          >
            <Input
              type="date"
              value={form.to}
              onChange={(e) => setForm((prev) => ({ ...prev, to: e.target.value }))}
            />
          </Field>
        </div>
        <Field
          label={t('fleet.attendance.fields.reason')}
          required
          missing={required.isMissing('reason')}
          hint={t('fleet.attendance.reasonHint')}
        >
          <Input
            value={form.reason}
            onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
            rule="arabic"
          />
        </Field>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </Field>
      </div>
    </Dialog>
  );
};

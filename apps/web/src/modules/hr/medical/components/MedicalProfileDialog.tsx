// One person's health record — read, and corrected (P-HR-MED D6, D12, D14).
//
// OPENING THIS IS AN AUDITED ACT (D14). The server writes a row saying who looked at whom, whether
// or not a record exists, and it does so BEFORE anything renders. That is why the query behind it
// does not cache: a cached record shown on a second open would be a read the log never saw.
//
// CONDITIONS AND ALLERGIES ARE FREE TEXT (D12), one line each. No dropdown, no code list, no
// autocomplete against a vocabulary — a coded diagnosis is a medical record proper, and holding one
// makes the company a custodian of clinical data under a duty nobody here has scoped. Text is what
// an HR department can honestly hold.
import { useEffect, useState } from 'react';
import { type BloodType, BLOOD_TYPES, type MedicalProfileDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea, Checkbox } from '../../../../shared/ui/form';
import { Spinner } from '../../../../shared/ui/Spinner';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useMedicalProfile, useUpsertMedicalProfile } from '../api/medical-queries';
import { MedicalHistoryPanel } from './MedicalHistoryPanel';

/** One per line — the honest editor for a list of sentences (D12). */
const toLines = (values: readonly string[]): string => values.join('\n');
const fromLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export const MedicalProfileDialog = ({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const { data, isLoading } = useMedicalProfile(employeeId);
  const save = useUpsertMedicalProfile();

  const [bloodType, setBloodType] = useState<BloodType | ''>('');
  const [conditions, setConditions] = useState('');
  const [allergies, setAllergies] = useState('');
  const [hasDisability, setHasDisability] = useState(false);
  const [disabilityNote, setDisabilityNote] = useState('');
  const [note, setNote] = useState('');

  // Seeded once the record arrives. `data` is `null` for somebody nobody has recorded anything
  // about, which is the ordinary case and leaves every field empty rather than showing an error.
  useEffect(() => {
    if (data === undefined || data === null) return;
    setBloodType(data.bloodType ?? '');
    setConditions(toLines(data.chronicConditions));
    setAllergies(toLines(data.allergies));
    setHasDisability(data.hasDisability);
    setDisabilityNote(data.disabilityNote ?? '');
    setNote(data.note ?? '');
  }, [data]);

  const submit = async (): Promise<void> => {
    try {
      await save.mutateAsync({
        employeeId,
        body: {
          bloodType: bloodType === '' ? null : bloodType,
          chronicConditions: fromLines(conditions),
          allergies: fromLines(allergies),
          hasDisability,
          // Cleared with the flag, so a note cannot outlive the fact it explains — the contract
          // refuses the pair, and agreeing with it here keeps the refusal out of the UI.
          disabilityNote: hasDisability
            ? disabilityNote.trim() === ''
              ? null
              : disabilityNote.trim()
            : null,
          note: note.trim() === '' ? null : note.trim(),
          version: (data as MedicalProfileDto | null)?.version ?? 0,
        },
      });
      toast.success(t('medical.profile.saved'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('medical.profile.record')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Can permission="medicalRecord.manage">
            <Button loading={save.isPending} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          </Can>
        </>
      }
    >
      {isLoading ? (
        <div className="grid place-items-center py-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={t('medical.profile.bloodType')}>
            <Select
              value={bloodType}
              onChange={(e) => setBloodType(e.target.value as BloodType | '')}
            >
              <option value="">{t('medical.profile.notRecorded')}</option>
              {BLOOD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>

          {/* Free text, one per line. The hint says so rather than letting somebody discover it. */}
          <Field label={t('medical.profile.conditions')} hint={t('medical.profile.onePerLine')}>
            <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} rows={3} />
          </Field>
          <Field label={t('medical.profile.allergies')} hint={t('medical.profile.onePerLine')}>
            <Textarea value={allergies} onChange={(e) => setAllergies(e.target.value)} rows={2} />
          </Field>

          <Checkbox
            checked={hasDisability}
            onChange={(e) => setHasDisability(e.target.checked)}
            label={t('medical.profile.hasDisability')}
          />
          {hasDisability && (
            <Field label={t('medical.profile.disabilityNote')}>
              <Input
                value={disabilityNote}
                onChange={(e) => setDisabilityNote(e.target.value)}
                maxLength={1000}
              />
            </Field>
          )}

          <Field label={t('medical.profile.note')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>

          {/*
            The history sits UNDER the profile in the same dialog, because the two answer one
            question between them: what is true of this person, and what happened to them. Opening
            the record already cost an audit row (D14); making the history a second click would
            either cost a second one or tempt somebody to skip auditing it.
          */}
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('medical.event.history')}
            </p>
            <MedicalHistoryPanel employeeId={employeeId} />
          </div>
        </div>
      )}
    </Dialog>
  );
};

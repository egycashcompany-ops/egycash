// The form of one of the candidate's papers (A28) — «فالمساحه اللي انت عامل فيها ال المستندات دي
// دلوقت … تبقي علي اساس انها form ساعت ميدوس علي اي نموزج فيهم كتعديل». The paper chosen by its
// «تعديل» opens here: every value it prints, each changeable for THIS candidate. A change is saved
// as the box is left, kept with the candidate's papers and used by every paper that prints the same
// value; the template never changes. Clearing a box gives the record's own value back.
import { useEffect, useState } from 'react';
import { type CandidatePaperDto, type CandidateValueDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Field, Input } from '../../../../shared/ui/form';
import { localized } from '../../../../shared/lib/format';

/**
 * Values the papers print but nobody types: the employee code is the one kept for the candidate at
 * the first print, and the hire gives exactly that code — a different one on paper would be wrong.
 */
export const READ_ONLY_VALUES = new Set(['employee.employeeCode']);

export const PaperValuesForm = ({
  paper,
  values,
  disabled,
  onSave,
}: {
  paper: CandidatePaperDto;
  values: CandidateValueDto[];
  disabled: boolean;
  /** One value changed — '' gives the record's own value back. */
  onSave: (change: { key: string; value: string }) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fields = values.filter((v) => paper.placeholders.includes(v.key));
  const serverKey = fields.map((v) => `${v.key}=${v.value}`).join('|');
  const [draft, setDraft] = useState<Record<string, string>>({});

  // What the server holds, each time another paper is opened or a save comes back.
  useEffect(() => {
    setDraft(Object.fromEntries(fields.map((v) => [v.key, v.value])));
  }, [paper.key, serverKey]);

  if (fields.length === 0) {
    return <p className="text-sm text-slate-500">{t('contracts.candidate.editNothing')}</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-paper-form={paper.key}>
      {fields.map((v) => (
        <Field
          key={v.key}
          label={localized(v.label, locale)}
          hint={
            READ_ONLY_VALUES.has(v.key)
              ? t('contracts.candidate.codeAtPrint')
              : v.overridden
                ? t('contracts.candidate.overridden')
                : undefined
          }
        >
          <Input
            value={draft[v.key] ?? ''}
            disabled={disabled || READ_ONLY_VALUES.has(v.key)}
            onChange={(e) => setDraft((d) => ({ ...d, [v.key]: e.target.value }))}
            onBlur={() => {
              const value = draft[v.key] ?? '';
              if (value !== v.value) onSave({ key: v.key, value });
            }}
            data-value-key={v.key}
          />
        </Field>
      ))}
    </div>
  );
};

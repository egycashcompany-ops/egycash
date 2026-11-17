// The form of one of the candidate's papers (A28) — «فالمساحه اللي انت عامل فيها ال المستندات دي
// دلوقت … تبقي علي اساس انها form ساعت ميدوس علي اي نموزج فيهم كتعديل». The paper chosen by its
// «تعديل» opens here: every value it prints, each changeable for THIS candidate. A change is saved
// as the box is left, kept with the candidate's papers and used by every paper that prints the same
// value; the template never changes. Clearing a box gives the record's own value back.
//
// The same form serves the EMPLOYEE's tab («نخلي في امكانيه للتعديل زي معملنا قبل كدا»). The start
// date «نموذج رقم (1)» writes in three rows of boxes is one date here, «تاريخ بدء الاشتراك» — «نسبها by
// default التاريخ مع امكانيه التعديل»: the record's date unless another is chosen.
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

/** The start date's three parts, as «نموذج رقم (1)» boxes them — one date in the form. */
export const START_PARTS = ['employment.startDay', 'employment.startMonth', 'employment.startYear'] as const;

/** The ISO date the three parts make, '' when they make none. */
export const isoOfParts = (day: string, month: string, year: string): string =>
  /^\d{1,2}$/.test(day) && /^\d{1,2}$/.test(month) && /^\d{4}$/.test(year)
    ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    : '';

/** The three parts of an ISO date — or three blanks, which give the record's own date back. */
export const partsOfIso = (iso: string): { key: string; value: string }[] => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const [day, month, year] = match === null ? ['', '', ''] : [match[3] ?? '', match[2] ?? '', match[1] ?? ''];
  return [
    { key: 'employment.startDay', value: day },
    { key: 'employment.startMonth', value: month },
    { key: 'employment.startYear', value: year },
  ];
};

export const PaperValuesForm = ({
  paper,
  values,
  disabled,
  onSave,
  readOnly = READ_ONLY_VALUES,
  readOnlyHint,
  overriddenHint,
}: {
  paper: Pick<CandidatePaperDto, 'key' | 'placeholders'>;
  values: CandidateValueDto[];
  disabled: boolean;
  /** Values changed — '' gives the record's own value back. The start date changes its three parts at once. */
  onSave: (changes: { key: string; value: string }[]) => void;
  /** Values shown but never typed in here — the candidate's employee code; on the employee's tab, the contract's own. */
  readOnly?: ReadonlySet<string>;
  readOnlyHint?: string;
  /** Under a value typed in — «مُدخلة لهذا المرشح», or for the employee. */
  overriddenHint?: string;
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
  const valueOf = (key: string): CandidateValueDto | undefined => fields.find((v) => v.key === key);
  const startParts = START_PARTS.map(valueOf);
  const startAsOne = startParts.every((v) => v !== undefined);
  const startIso = isoOfParts(draft[START_PARTS[0]] ?? '', draft[START_PARTS[1]] ?? '', draft[START_PARTS[2]] ?? '');
  const startTyped = startParts.some((v) => v?.overridden === true);

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-paper-form={paper.key}>
      {fields.map((v) => {
        if (startAsOne && (v.key === START_PARTS[1] || v.key === START_PARTS[2])) return null;
        if (startAsOne && v.key === START_PARTS[0]) {
          return (
            <Field
              key="startDate"
              label={t('contracts.candidate.startDate')}
              hint={startTyped ? overriddenHint ?? t('contracts.candidate.overridden') : t('contracts.candidate.startDateHint')}
            >
              <Input
                type="date"
                value={startIso}
                disabled={disabled}
                onChange={(e) => {
                  const parts = partsOfIso(e.target.value);
                  setDraft((d) => ({ ...d, ...Object.fromEntries(parts.map((p) => [p.key, p.value])) }));
                }}
                // Saved as the box is left, as every other value: a year typed digit by digit is
                // one change, not four.
                onBlur={() => {
                  const was = isoOfParts(startParts[0]?.value ?? '', startParts[1]?.value ?? '', startParts[2]?.value ?? '');
                  if (startIso !== was) onSave(partsOfIso(startIso));
                }}
                data-value-key="employment.startDate"
              />
            </Field>
          );
        }
        const fixed = readOnly.has(v.key);
        return (
          <Field
            key={v.key}
            label={localized(v.label, locale)}
            hint={
              fixed
                ? readOnlyHint ?? t('contracts.candidate.codeAtPrint')
                : v.overridden
                  ? overriddenHint ?? t('contracts.candidate.overridden')
                  : undefined
            }
          >
            <Input
              value={draft[v.key] ?? ''}
              disabled={disabled || fixed}
              onChange={(e) => setDraft((d) => ({ ...d, [v.key]: e.target.value }))}
              onBlur={() => {
                const value = draft[v.key] ?? '';
                if (value !== v.value) onSave([{ key: v.key, value }]);
              }}
              data-value-key={v.key}
            />
          </Field>
        );
      })}
    </div>
  );
};

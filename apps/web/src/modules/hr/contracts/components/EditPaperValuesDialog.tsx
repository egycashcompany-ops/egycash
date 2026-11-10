// «تعديل» on one of the candidate's papers (A28): the values that paper prints, each one changeable
// for THIS candidate. A change is kept with the candidate's papers and used by every paper that
// prints the same value; the template itself never changes. Clearing a box gives the record's own
// value back.
import { useEffect, useState } from 'react';
import { type CandidatePaperDto, type CandidateValueDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { Field, Input } from '../../../../shared/ui/form';
import { localized } from '../../../../shared/lib/format';

export const EditPaperValuesDialog = ({
  paper,
  values,
  saving,
  onClose,
  onSave,
}: {
  paper: CandidatePaperDto | null;
  values: CandidateValueDto[];
  saving: boolean;
  onClose: () => void;
  /** Only the values changed here — '' gives the record's own value back. */
  onSave: (changed: { key: string; value: string }[]) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fields = paper === null ? [] : values.filter((v) => paper.placeholders.includes(v.key));
  const [draft, setDraft] = useState<Record<string, string>>({});

  // A fresh copy each time a paper is opened, so a closed dialog's typing never leaks into the next.
  useEffect(() => {
    setDraft(Object.fromEntries(fields.map((v) => [v.key, v.value])));
  }, [paper?.key]);

  const changed = fields
    .filter((v) => (draft[v.key] ?? '') !== v.value)
    .map((v) => ({ key: v.key, value: draft[v.key] ?? '' }));

  return (
    <Dialog
      open={paper !== null}
      onClose={onClose}
      title={paper === null ? '' : t('contracts.candidate.editTitle', { name: localized(paper.name, locale) })}
      description={t('contracts.candidate.editHint')}
      dismissOnOutsideClick={false}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={saving} disabled={changed.length === 0} onClick={() => onSave(changed)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {fields.length === 0 ? (
        <p className="text-sm text-slate-500">{t('contracts.candidate.editNothing')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((v) => (
            <Field
              key={v.key}
              label={localized(v.label, locale)}
              hint={v.overridden ? t('contracts.candidate.overridden') : undefined}
            >
              <Input
                value={draft[v.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [v.key]: e.target.value }))}
                data-value-key={v.key}
              />
            </Field>
          ))}
        </div>
      )}
    </Dialog>
  );
};

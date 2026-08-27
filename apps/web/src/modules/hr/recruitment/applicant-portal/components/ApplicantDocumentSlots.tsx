// The slots: what the candidate owes, what they handed in, and what they may still do about it.
//
// `mayReplace` COMES FROM THE SERVER and is never recomputed here. The rule it carries (accepted
// locks, refused reopens — D-APP-7ج) lives in one pure module on the API side, and a second copy
// in a component is exactly how a screen ends up offering a button the server then refuses.
//
// The refusal note is shown because the candidate is the one being asked to fix it. That is the
// narrow, deliberate exception to D-APP-7ب: not an internal review state, but the sentence that
// tells somebody which photograph to take again.
import { useRef, useState } from 'react';
import {
  PROFESSIONAL_DRIVING_LICENSE_CLASSES,
  type ApplicantDocumentDto,
  type ApplicantDocumentSetDto,
  type ApplicantDocumentSlotDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../../store';
import { useT } from '../../../../../platform/localization/useT';
import { Button, Select } from '../../../../../shared/ui';
import { useSubmitMyDocument } from '../api/applicant-portal-queries';

type Row =
  | { kind: 'filled'; document: ApplicantDocumentDto }
  | { kind: 'empty'; slot: ApplicantDocumentSlotDto };

const StatusPill = ({ document }: { document: ApplicantDocumentDto }): JSX.Element => {
  const t = useT();
  const tone =
    document.status === 'accepted'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : document.status === 'rejected'
        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`hr.applicantPortal.documents.status.${document.status}`)}
    </span>
  );
};

export const ApplicantDocumentSlots = ({ set }: { set: ApplicantDocumentSetDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const submit = useSubmitMyDocument();
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const [licenseClass, setLicenseClass] = useState<string>(
    PROFESSIONAL_DRIVING_LICENSE_CLASSES[0],
  );
  const [failed, setFailed] = useState<string | null>(null);

  // Filled slots first, in the order the catalogue asks for them, then what is still owed.
  const rows: Row[] = [
    ...set.documents.map((document): Row => ({ kind: 'filled', document })),
    ...set.missing.map((slot): Row => ({ kind: 'empty', slot })),
  ];

  const pick = (typeId: string): void => {
    inputs.current.get(typeId)?.click();
  };

  const send = (typeId: string, file: File, needsClass: boolean): void => {
    setFailed(null);
    submit.mutate(
      { typeId, file, ...(needsClass ? { licenseClass } : {}) },
      { onError: () => { setFailed(typeId); } },
    );
  };

  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
      {rows.map((row) => {
        const typeId = row.kind === 'filled' ? row.document.typeId : row.slot.typeId;
        const name = row.kind === 'filled' ? row.document.typeName : row.slot.typeName;
        const needsClass = row.kind === 'empty' && row.slot.licenseClassRequired;
        const canAct = row.kind === 'empty' || row.document.mayReplace;

        return (
          <li key={typeId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {name[locale]}
                </span>
                {row.kind === 'filled' && <StatusPill document={row.document} />}
              </div>
              {row.kind === 'filled' && row.document.reviewNote !== null && (
                <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                  {row.document.reviewNote}
                </p>
              )}
              {row.kind === 'filled' && (
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {row.document.fileName}
                </p>
              )}
              {failed === typeId && (
                <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                  {t('hr.applicantPortal.documents.uploadFailed')}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {needsClass && (
                <Select
                  aria-label={t('hr.applicantPortal.documents.licenseClass')}
                  value={licenseClass}
                  onChange={(e) => {
                    setLicenseClass(e.target.value);
                  }}
                >
                  {PROFESSIONAL_DRIVING_LICENSE_CLASSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`hr.applicantPortal.documents.licenseClass.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
              <input
                ref={(el) => {
                  inputs.current.set(typeId, el);
                }}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) send(typeId, file, needsClass);
                  e.target.value = '';
                }}
              />
              {canAct ? (
                <Button
                  variant={row.kind === 'filled' ? 'secondary' : 'primary'}
                  disabled={submit.isPending}
                  onClick={() => {
                    pick(typeId);
                  }}
                >
                  {row.kind === 'filled'
                    ? t('hr.applicantPortal.documents.replace')
                    : t('hr.applicantPortal.documents.upload')}
                </Button>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('hr.applicantPortal.documents.locked')}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

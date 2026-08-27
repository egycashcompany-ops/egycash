// One candidate's documents, as the reviewer works through them.
//
// THE REFUSAL IS THE INTERESTING CONTROL. Accepting is one click; refusing opens a reason field and
// will not submit without it — not as a nag, but because a rejected slot REOPENS for the candidate
// (D-APP-7ج), and «ارفع واحدة تانية» with nothing attached is a request nobody can act on. The
// server refuses a reasonless rejection too; this only means the reviewer finds out before they
// click rather than after.
//
// A SETTLED SLOT SHOWS ITS VERDICT AND NO BUTTONS. Re-deciding is not a review — the server answers
// 409 — so the screen does not offer it rather than offering it and apologising.
import { useState } from 'react';
import {
  type ApplicantDocumentDto,
  type ApplicantDocumentSetDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../../store';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { Button, Textarea } from '../../../../../shared/ui';
import { useReviewApplicantDocument } from '../api/applicant-document-queries';

const Verdict = ({ document }: { document: ApplicantDocumentDto }): JSX.Element => {
  const t = useT();
  const tone =
    document.status === 'accepted'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : document.status === 'rejected'
        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`hr.applicantDocuments.status.${document.status}`)}
    </span>
  );
};

export const ApplicantDocumentReview = ({ set }: { set: ApplicantDocumentSetDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const review = useReviewApplicantDocument();
  const [refusing, setRefusing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const mayReview = can('applicantDocument.review');

  const decide = (typeId: string, outcome: 'accepted' | 'rejected'): void => {
    review.mutate(
      {
        applicantId: set.applicantId,
        typeId,
        body: outcome === 'rejected' ? { outcome, note: note.trim() } : { outcome },
      },
      {
        onSuccess: () => {
          setRefusing(null);
          setNote('');
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {set.documents.map((document) => {
          const open = refusing === document.typeId;
          return (
            <li key={document.typeId} className="py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {document.typeName[locale]}
                    </span>
                    <Verdict document={document} />
                    {document.licenseClass !== null && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {t(`hr.applicantDocuments.licenseClass.${document.licenseClass}`)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {`${document.fileName} · ${t('hr.applicantDocuments.version', {
                      n: String(document.fileVersion),
                    })}`}
                  </p>
                  {document.reviewNote !== null && (
                    <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                      {document.reviewNote}
                    </p>
                  )}
                </div>

                {document.status === 'pending' && mayReview && !open && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={review.isPending}
                      onClick={() => {
                        setRefusing(document.typeId);
                        setNote('');
                      }}
                    >
                      {t('hr.applicantDocuments.reject')}
                    </Button>
                    <Button
                      disabled={review.isPending}
                      onClick={() => {
                        decide(document.typeId, 'accepted');
                      }}
                    >
                      {t('hr.applicantDocuments.accept')}
                    </Button>
                  </div>
                )}
              </div>

              {open && (
                <div className="mt-3 space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900 dark:bg-rose-950/20">
                  <label
                    className="block text-sm font-medium text-slate-800 dark:text-slate-200"
                    htmlFor={`note-${document.typeId}`}
                  >
                    {t('hr.applicantDocuments.rejectReason')}
                  </label>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('hr.applicantDocuments.rejectReasonHint')}
                  </p>
                  <Textarea
                    id={`note-${document.typeId}`}
                    rows={2}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setRefusing(null);
                        setNote('');
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      disabled={review.isPending || note.trim() === ''}
                      onClick={() => {
                        decide(document.typeId, 'rejected');
                      }}
                    >
                      {t('hr.applicantDocuments.confirmReject')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {set.missing.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
          {`${t('hr.applicantDocuments.stillMissing')}: ${set.missing
            .map((slot) => slot.typeName[locale])
            .join(' · ')}`}
        </div>
      )}
    </div>
  );
};

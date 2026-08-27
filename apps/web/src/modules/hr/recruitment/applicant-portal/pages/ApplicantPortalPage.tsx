// The candidate's one page: where their application stands, and what they still owe.
//
// ONE PAGE ON PURPOSE. A candidate has two questions — «أين وصل طلبي» and «ما المطلوب مني» — and
// splitting those across tabs would make somebody navigate to find out they are waiting. The
// screen answers both without a click.
//
// What is NOT on it: no timeline, no scores, no dates beyond the one they already knew, no name of
// whoever decided anything. The server does not send those (see `portal-step.ts`), and this file
// could not render them if it wanted to.
import { useT } from '../../../../../platform/localization/useT';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { useMyPortalDocuments, useMyPortalStatus } from '../api/applicant-portal-queries';
import { ApplicantStageMap } from '../components/ApplicantStageMap';
import { ApplicantDocumentSlots } from '../components/ApplicantDocumentSlots';

export const ApplicantPortalPage = (): JSX.Element => {
  const t = useT();
  const status = useMyPortalStatus();
  const documents = useMyPortalDocuments();

  if (status.isPending) return <LoadingState />;
  if (status.isError || status.data === undefined) {
    return <EmptyState title={t('hr.applicantPortal.loadFailed')} />;
  }

  const me = status.data;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{me.fullNameAr}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {me.position ?? t('hr.applicantPortal.noPosition')} · {me.applicantCode}
        </p>
        <div className="mt-5">
          <ApplicantStageMap step={me.step} />
        </div>
      </section>

      {/*
        A refused candidate is shown the refusal and NOTHING to do. §6 of the design: «لا رفع لمن
        رُفض. يرى أنه رُفض، وينتهي.» Leaving the upload slots on the page would be asking somebody
        to keep working on an application that is over.
      */}
      {me.step !== 'rejected' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {t('hr.applicantPortal.documents.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t('hr.applicantPortal.documents.hint')}
          </p>
          <div className="mt-4">
            {documents.isPending ? (
              <LoadingState />
            ) : documents.isError || documents.data === undefined ? (
              <EmptyState title={t('hr.applicantPortal.loadFailed')} />
            ) : (
              <ApplicantDocumentSlots set={documents.data} />
            )}
          </div>
        </section>
      )}
    </div>
  );
};

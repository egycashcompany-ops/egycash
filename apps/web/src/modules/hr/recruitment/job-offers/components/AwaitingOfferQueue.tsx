// «جاهزون لعرض عمل» — the people this screen exists to act on, above the offers already written.
//
// WHY THE BUTTON MOVED HERE FROM THE PAGE HEADER. A «+ new offer» button at the top asks somebody
// to remember who is ready and then find them in a picker. The information was already in the
// system; nothing was showing it. So the queue shows the candidates, and the button sits beside
// the person it is about.
//
// I11 IS UNCHANGED, AND THE BUTTON IS WHY. The offer stage is still never opened by progress
// alone — it is HR's explicit move, and that click IS the move. Somebody not yet moved gets a
// confirm dialog first; somebody already moved goes straight to the form. Two states, one button,
// and the decision it records is the same audited act it always was.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type AwaitingOfferCandidateDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { EmptyState, LoadingState, Pagination } from '../../../../../shared/ui';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useApplicant, useMoveApplicantToOffer } from '../../applicants/api/applicant-queries';
import { useAwaitingOffer } from '../api/job-offer-queries';

/**
 * One row's button.
 *
 * It owns its own move mutation because the move is version-checked against the APPLICANT, and
 * that version belongs to the row it acts on rather than to the list.
 */
const OfferAction = ({ row }: { row: AwaitingOfferCandidateDto }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const { data: applicant } = useApplicant(row.movedToOffer ? '' : row.applicantId);
  const move = useMoveApplicantToOffer(row.applicantId);
  const [confirming, setConfirming] = useState(false);

  // The form reads this from router state and skips its own applicant search.
  const openForm = (): void => {
    navigate('/job-offers/new', {
      state: {
        applicant: { id: row.applicantId, code: row.applicantCode, fullNameAr: row.fullNameAr },
      },
    });
  };

  const moveThenOpen = async (): Promise<void> => {
    if (applicant === undefined) return;
    try {
      await move.mutateAsync({ version: applicant.version });
      toast.success(t('applicants.moveToOffer.done'));
      setConfirming(false);
      openForm();
    } catch {
      // surfaced globally
    }
  };

  if (row.movedToOffer) {
    return (
      <Can permission="jobOffer.create">
        <Button size="sm" onClick={openForm}>
          {t('offers.awaiting.write')}
        </Button>
      </Can>
    );
  }

  return (
    <Can permission="applicant.moveToOffer">
      <Button size="sm" onClick={() => { setConfirming(true); }}>
        {t('offers.awaiting.moveAndWrite')}
      </Button>
      {confirming && (
        <Dialog
          open
          onClose={() => { setConfirming(false); }}
          title={t('applicants.moveToOffer.title')}
          description={t('applicants.moveToOffer.body')}
          footer={
            <>
              <Button variant="secondary" onClick={() => { setConfirming(false); }}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={move.isPending}
                disabled={applicant === undefined}
                onClick={() => void moveThenOpen()}
              >
                {t('applicants.moveToOffer.action')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{row.fullNameAr}</p>
        </Dialog>
      )}
    </Can>
  );
};

export const AwaitingOfferQueue = ({
  search,
  page,
  onPageChange,
}: {
  search: string;
  page: number;
  onPageChange: (page: number) => void;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const query = useAwaitingOffer({
    page,
    pageSize: 10,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  });

  // Nobody who cannot write an offer or move a candidate has anything to do here.
  if (!can('jobOffer.create') && !can('applicant.moveToOffer')) return null;

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
          {t('offers.awaiting.title')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('offers.awaiting.hint')}</p>
      </header>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError || query.data === undefined ? (
        <EmptyState title={t('offers.awaiting.loadFailed')} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title={t('offers.awaiting.empty')} />
      ) : (
        <>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {query.data.items.map((row) => (
              <li
                key={row.applicantId}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {row.fullNameAr}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {row.position === null
                      ? row.applicantCode
                      : `${row.applicantCode} · ${row.position}`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <OfferAction row={row} />
                </div>
              </li>
            ))}
          </ul>
          {query.data.meta.totalPages > 1 && (
            <Pagination meta={query.data.meta} onPageChange={onPageChange} />
          )}
        </>
      )}
    </section>
  );
};

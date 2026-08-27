// Create a new offer (pick an applicant + fill the package) or revise an existing draft/sent offer
// (edit its terms; version-checked, keeps history). Both use the shared OfferTermsForm. Arriving
// from the offer queue preselects the applicant (read-only) — search exists only for a
// completely standalone offer.
//
// WHO THE OFFER IS FOR LIVES IN THE URL, NOT IN ROUTER STATE. It used to arrive as
// `navigate(path, { state })`, which is held in the history entry and thrown away on reload: a
// recruiter who refreshed — or opened the form in a second tab, or came back through a restored
// session — was returned an empty picker with no sign that anything had been chosen. Everything
// else on this screen's sibling list is already synchronized with the query string for exactly
// this reason, so the applicant joins it: `?applicantId=…`, deep-linkable and refresh-proof.
//
// THE NAME IS RESOLVED FROM THE SERVER, never carried in the URL beside the id. A name in a query
// string is unverified text that renders as though the system had confirmed it, and the picker
// this screen already ships needs `applicant.view` regardless — so reading the applicant by id
// asks for nothing the screen did not already require.
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type OfferTerms } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Field } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { ApplicantPicker } from '../../shared/ApplicantPicker';
import { useApplicant } from '../../applicants/api/applicant-queries';
import { useApplicantSearch } from '../api/job-offer-queries';
import { OfferTermsForm } from '../components/OfferTermsForm';
import { useCreateJobOffer, useJobOffer, useReviseJobOffer } from '../api/job-offer-queries';

/** Minimal applicant shape the form needs — satisfied by a full ApplicantDto or a queue row. */
interface PickedApplicant {
  id: string;
  code: string;
  fullNameAr: string;
}

export const JobOfferFormPage = ({ mode }: { mode: 'create' | 'revise' }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { id = '' } = useParams();

  const create = useCreateJobOffer();
  const revise = useReviseJobOffer(id);
  const { data: offer, isLoading, isError, error, refetch } = useJobOffer(mode === 'revise' ? id : '');

  // Who this offer is for, and where they came from — both in the query string (see the header).
  const applicantId = mode === 'create' ? (sp.get('applicantId') ?? '') : '';
  // `from=queue` is not decoration. Arriving through «اكتب عرضًا» means the candidate has ALREADY
  // been moved to the offer stage — an audited, explicit act (I11) — so swapping to somebody else
  // here would leave one person moved and a different person offered. The queue's arrival is
  // therefore fixed, and only a standalone offer may change its mind. It rides in the URL for the
  // same reason the id does: a reload must not quietly turn a locked choice into a loose one.
  const fromQueue = sp.get('from') === 'queue';
  const { data: named, isLoading: namingApplicant } = useApplicant(applicantId);
  // A picker choice this session, before it has round-tripped through the URL.
  const [picked, setPicked] = useState<PickedApplicant | null>(null);
  const applicant: PickedApplicant | null =
    named === undefined ? (picked?.id === applicantId ? picked : null) : named;

  const chooseApplicant = (next: PickedApplicant | null): void => {
    setPicked(next);
    const params = new URLSearchParams(sp);
    if (next === null) params.delete('applicantId');
    else params.set('applicantId', next.id);
    // `replace` — choosing somebody is not a place to come Back to, it is this page being filled in.
    setSp(params, { replace: true });
  };

  if (mode === 'revise') {
    if (isLoading) {
      return (
        <PageContainer>
          <LoadingState />
        </PageContainer>
      );
    }
    if (isError || offer === undefined) {
      return (
        <PageContainer>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </PageContainer>
      );
    }
  }

  const submitCreate = async (terms: OfferTerms): Promise<void> => {
    if (applicant === null) return;
    try {
      const created = await create.mutateAsync({ applicantId: applicant.id, terms });
      toast.success(t('offers.create.done'));
      navigate(`/job-offers/${created.id}`);
    } catch {
      // surfaced globally
    }
  };

  const submitRevise = async (terms: OfferTerms): Promise<void> => {
    if (offer === undefined) return;
    try {
      await revise.mutateAsync({ terms, version: offer.version });
      toast.success(t('offers.revise.done'));
      navigate(`/job-offers/${offer.id}`);
    } catch {
      // surfaced globally
    }
  };

  const isCreate = mode === 'create';
  const title = isCreate ? t('offers.create.title') : t('offers.revise.title', { code: offer?.code ?? '' });

  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.offers'), to: '/job-offers' },
          { label: isCreate ? t('offers.create.crumb') : (offer?.code ?? '') },
        ]}
      />
      <Card>
        <CardHeader title={t('offers.form.package')} />
        <CardBody>
          {isCreate && (
            <div className="mb-6">
              <Field label={t('offers.form.applicant')} required>
                {/*
                  The spinner is for the RELOAD case only — a URL that names somebody nobody has
                  fetched yet. A choice just made from the picker is already known, so `applicant`
                  is non-null while its read is in flight and the chip never blinks into a spinner.
                */}
                {namingApplicant && applicant === null ? (
                  <LoadingState />
                ) : applicant === null ? (
                  <ApplicantPicker
                    onSelect={chooseApplicant}
                    useSearch={useApplicantSearch}
                    placeholder={t('offers.form.applicantSearch')}
                    emptyLabel={t('offers.form.noApplicants')}
                    className="w-full sm:w-96"
                  />
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">

                    <span className="text-slate-700 dark:text-slate-200">{applicant.fullNameAr}</span>
                    {!fromQueue && (
                      <button type="button" onClick={() => chooseApplicant(null)} className="ms-2 text-xs text-brand-600 hover:underline">
                        {t('offers.form.change')}
                      </button>
                    )}
                  </span>
                )}
              </Field>
            </div>
          )}

          {(!isCreate || applicant !== null) && (
            <OfferTermsForm
              initial={isCreate ? null : (offer?.terms ?? null)}
              submitLabel={isCreate ? t('offers.create.submit') : t('offers.revise.submit')}
              submitting={isCreate ? create.isPending : revise.isPending}
              onSubmit={isCreate ? submitCreate : submitRevise}
            />
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
};

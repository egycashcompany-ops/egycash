// Create a new offer (pick an applicant + fill the package) or revise an existing draft/sent offer
// (edit its terms; version-checked, keeps history). Both use the shared OfferTermsForm. Arriving
// from the offer queue preselects the applicant (read-only) — search exists only for a
// completely standalone offer.
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { type OfferTerms } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Field } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { ApplicantPicker } from '../components/ApplicantPicker';
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
  const location = useLocation();
  const { id = '' } = useParams();

  const create = useCreateJobOffer();
  const revise = useReviseJobOffer(id);
  const { data: offer, isLoading, isError, error, refetch } = useJobOffer(mode === 'revise' ? id : '');
  // Preselected from the offer queue (router state) — no second search.
  const preset = (location.state as { applicant?: PickedApplicant } | null)?.applicant ?? null;
  const [applicant, setApplicant] = useState<PickedApplicant | null>(preset);

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
                {applicant === null ? (
                  <ApplicantPicker onSelect={setApplicant} />
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">

                    <span className="text-slate-700 dark:text-slate-200">{applicant.fullNameAr}</span>
                    {preset === null && (
                      <button type="button" onClick={() => setApplicant(null)} className="ms-2 text-xs text-brand-600 hover:underline">
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

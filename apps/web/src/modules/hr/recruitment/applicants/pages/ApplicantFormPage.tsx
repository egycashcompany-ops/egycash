// Create/edit page: wires the ApplicantForm to the register/update mutations, loads reference
// data (sources) and — in edit mode — the existing applicant. On success it toasts and routes to
// the detail page; validation errors flow back into the form's summary.
import { useNavigate, useParams } from 'react-router-dom';
import { type RegisterApplicant, type UpdateApplicant } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { ApplicantForm } from '../components/ApplicantForm';
import {
  useApplicant,
  useApplicantSources,
  useRegisterApplicant,
  useUpdateApplicant,
} from '../api/applicant-queries';

export const ApplicantFormPage = ({ mode }: { mode: 'create' | 'edit' }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: sources = [] } = useApplicantSources();
  const register = useRegisterApplicant();
  const update = useUpdateApplicant(id);
  const { data: applicant, isLoading, isError, error, refetch } = useApplicant(mode === 'edit' ? id : '');

  const onSubmit = async (body: RegisterApplicant | UpdateApplicant): Promise<void> => {
    if (mode === 'create') {
      const created = await register.mutateAsync(body as RegisterApplicant);
      toast.success(t('applicants.form.created'));
      navigate(`/applicants/${created.id}`);
    } else {
      await update.mutateAsync(body as UpdateApplicant);
      toast.success(t('applicants.form.saved'));
      navigate(`/applicants/${id}`);
    }
  };

  const title = mode === 'create' ? t('applicants.form.createTitle') : t('applicants.form.editTitle');
  const crumbs = [
    { label: t('recruitment.title'), to: '/' },
    { label: t('recruitment.nav.applicants'), to: '/applicants' },
    { label: title },
  ];

  return (
    <PageContainer>
      <PageHeader title={title} breadcrumbs={crumbs} />
      {mode === 'edit' && isLoading ? (
        <LoadingState />
      ) : mode === 'edit' && (isError || applicant === undefined) ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-4">
          <ApplicantForm
            mode={mode}
            {...(mode === 'edit' && applicant !== undefined ? { initial: applicant } : {})}
            sources={sources}
            submitting={register.isPending || update.isPending}
            onSubmit={onSubmit}
            onCancel={() => navigate(mode === 'edit' ? `/applicants/${id}` : '/applicants')}
          />
        </div>
      )}
    </PageContainer>
  );
};

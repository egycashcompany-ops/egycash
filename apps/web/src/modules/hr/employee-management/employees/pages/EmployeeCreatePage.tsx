// Hire an employee from an Accepted Job Offer. The employment terms are copied server-side from the
// offer's immutable accepted snapshot — this page only picks the accepted offer and an optional
// hiring date. The server enforces the full rule (accepted + snapshot + not already hired).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type JobOfferDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, FormActions } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { OfferPicker } from '../components/OfferPicker';
import { useCreateEmployee } from '../api/employee-queries';

export const EmployeeCreatePage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateEmployee();
  const [offer, setOffer] = useState<JobOfferDto | null>(null);
  const [hiringDate, setHiringDate] = useState('');

  const submit = async (): Promise<void> => {
    if (offer === null) return;
    try {
      const employee = await create.mutateAsync({
        jobOfferId: offer.id,
        ...(hiringDate === '' ? {} : { hiringDate: new Date(hiringDate) }),
      });
      toast.success(t('employees.create.done'));
      navigate(`/employees/${employee.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.create.title')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.employees'), to: '/employees' },
          { label: t('employees.create.crumb') },
        ]}
      />
      <Card>
        <CardHeader title={t('employees.create.heading')} description={t('employees.create.body')} />
        <CardBody>
          <div className="space-y-6">
            <Field label={t('employees.create.offer')} required hint={t('employees.create.offerHint')}>
              {offer === null ? (
                <OfferPicker onSelect={setOffer} />
              ) : (
                <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                  <span className="font-mono text-xs text-slate-400" dir="ltr">{offer.code}</span>
                  <span className="font-mono text-xs text-slate-500" dir="ltr">{offer.applicantCode}</span>
                  <button type="button" onClick={() => setOffer(null)} className="ms-2 text-xs text-brand-600 hover:underline">
                    {t('offers.form.change')}
                  </button>
                </span>
              )}
            </Field>

            <Field label={t('employees.create.hiringDate')} hint={t('employees.create.hiringDateHint')}>
              <Input type="date" value={hiringDate} onChange={(e) => setHiringDate(e.target.value)} dir="ltr" className="w-auto" />
            </Field>

            <FormActions>
              <Button loading={create.isPending} disabled={offer === null} onClick={() => void submit()}>
                {t('employees.create.submit')}
              </Button>
            </FormActions>
          </div>
        </CardBody>
      </Card>
    </PageContainer>
  );
};

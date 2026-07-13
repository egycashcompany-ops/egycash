// Job Offer detail: the offer number, applicant link, status, the live package, the accepted
// snapshot + revision history, and the full lifecycle action surface — send / revise / withdraw
// (draft·sent), accept / reject (sent) — all permission-gated and version-checked.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { formatDateTime } from '../../../../../shared/lib/format';
import { OfferStatusBadge } from '../components/OfferStatusBadge';
import { TermsView } from '../components/TermsView';
import {
  AcceptOfferDialog,
  RejectOfferDialog,
  SendOfferDialog,
  WithdrawOfferDialog,
} from '../components/OfferDialogs';
import { useJobOffer } from '../api/job-offer-queries';

type ActionKind = 'send' | 'accept' | 'reject' | 'withdraw' | null;

export const JobOfferDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: o, isLoading, isError, error, refetch } = useJobOffer(id);
  const [action, setAction] = useState<ActionKind>(null);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || o === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const isDraft = o.status === 'draft';
  const isSent = o.status === 'sent';
  const canRevise = isDraft || isSent;

  return (
    <PageContainer>
      <PageHeader
        title={t('offers.detail.title', { code: o.code })}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.offers'), to: '/job-offers' },
          { label: o.code },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canRevise && (
              <Can permission="jobOffer.edit">
                <Button size="sm" variant="ghost" onClick={() => navigate('edit')}>{t('offers.actions.revise')}</Button>
              </Can>
            )}
            {isDraft && (
              <Can permission="jobOffer.send">
                <Button size="sm" variant="secondary" onClick={() => setAction('send')}>{t('offers.actions.send')}</Button>
              </Can>
            )}
            {isSent && (
              <Can permission="jobOffer.respond">
                <Button size="sm" variant="secondary" onClick={() => setAction('accept')}>{t('offers.actions.accept')}</Button>
                <Button size="sm" variant="danger" onClick={() => setAction('reject')}>{t('offers.actions.reject')}</Button>
              </Can>
            )}
            {canRevise && (
              <Can permission="jobOffer.withdraw">
                <Button size="sm" variant="ghost" onClick={() => setAction('withdraw')}>{t('offers.actions.withdraw')}</Button>
              </Can>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">{o.code}</span>
        <Link to={`/applicants/${o.applicantId}`} className="font-mono text-sm text-brand-600 hover:underline" dir="ltr">
          {o.applicantCode}
        </Link>
        <OfferStatusBadge status={o.status} />
        {o.revisionNumber > 0 && (
          <span className="text-xs text-slate-400">{t('offers.detail.revision', { n: o.revisionNumber })}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('offers.form.package')} />
            <CardBody>
              <TermsView terms={o.terms} />
            </CardBody>
          </Card>

          {o.acceptedSnapshot !== null && (
            <Card>
              <CardHeader
                title={t('offers.detail.acceptedSnapshot')}
                description={t('offers.detail.acceptedAt', { at: formatDateTime(o.acceptedSnapshot.acceptedAt, locale) })}
              />
              <CardBody>
                <TermsView terms={o.acceptedSnapshot.terms} />
              </CardBody>
            </Card>
          )}

          {o.revisions.length > 0 && (
            <Card>
              <CardHeader title={t('offers.detail.history')} />
              <CardBody>
                <ul className="space-y-4">
                  {o.revisions
                    .slice()
                    .reverse()
                    .map((rev) => (
                      <li key={rev.revisionNumber} className="border-s-2 border-slate-100 ps-4 dark:border-slate-800">
                        <p className="mb-2 text-xs text-slate-400">
                          {t('offers.detail.revisionN', { n: rev.revisionNumber })} · {formatDateTime(rev.revisedAt, locale)}
                        </p>
                        <TermsView terms={rev.terms} />
                      </li>
                    ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('offers.detail.summary')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">{t('offers.columns.status')}</dt>
                  <dd className="mt-1"><OfferStatusBadge status={o.status} /></dd>
                </div>
                {o.sentAt !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('offers.detail.sentAt')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(o.sentAt, locale)}</dd>
                  </div>
                )}
                {o.respondedAt !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('offers.detail.respondedAt')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(o.respondedAt, locale)}</dd>
                  </div>
                )}
                {o.expiredAt !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('offers.detail.expiredAt')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(o.expiredAt, locale)}</dd>
                  </div>
                )}
                {o.responseNote !== null && o.responseNote !== '' && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('offers.detail.responseNote')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{o.responseNote}</dd>
                  </div>
                )}
                {o.rejectionReason !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('offers.reject.reason')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{o.rejectionReason}</dd>
                  </div>
                )}
                {o.withdrawnReason !== null && (
                  <div>
                    <dt className="text-xs text-slate-400">{t('offers.withdraw.reason')}</dt>
                    <dd className="mt-1 text-slate-700 dark:text-slate-200">{o.withdrawnReason}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-slate-400">{t('offers.columns.created')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(o.createdAt, locale)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {action === 'send' && <SendOfferDialog onClose={() => setAction(null)} offerId={o.id} version={o.version} />}
      {action === 'accept' && <AcceptOfferDialog onClose={() => setAction(null)} offerId={o.id} version={o.version} />}
      {action === 'reject' && <RejectOfferDialog onClose={() => setAction(null)} offerId={o.id} version={o.version} />}
      {action === 'withdraw' && <WithdrawOfferDialog onClose={() => setAction(null)} offerId={o.id} version={o.version} />}
    </PageContainer>
  );
};

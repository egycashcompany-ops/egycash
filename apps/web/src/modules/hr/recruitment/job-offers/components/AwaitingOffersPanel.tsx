// "Awaiting offer" — the workflow queue into Job Offers. Applicants HR moved to the Job Offer
// stage who have no blocking offer yet (no active draft/sent one, no accepted one) surface here
// automatically (derived server-side; no offer record is fabricated). "New Offer" opens the
// create form with the applicant preselected — no second search. Hidden when empty; permission-
// gated (jobOffer.view to read; jobOffer.create to draft).
import { useNavigate } from 'react-router-dom';
import { type AwaitingOfferDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Badge } from '../../../../../shared/ui/Badge';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate } from '../../../../../shared/lib/format';
import { useAwaitingOffers } from '../api/job-offer-queries';

export const AwaitingOffersPanel = (): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { data: awaiting = [] } = useAwaitingOffers();

  if (awaiting.length === 0) return null;

  const draftFor = (a: AwaitingOfferDto): void =>
    navigate('new', {
      state: { applicant: { id: a.applicantId, code: a.applicantCode, fullNameAr: a.applicantName } },
    });

  return (
    <Card>
      <CardHeader title={t('offers.awaiting.title')} description={t('offers.awaiting.subtitle')} />
      <CardBody className="space-y-2">
        {awaiting.map((a) => (
          <div
            key={a.applicantId}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-mono text-xs text-slate-500" dir="ltr">{a.applicantCode}</span>
              <span className="truncate text-sm text-slate-700 dark:text-slate-200">{a.applicantName}</span>
              <Badge tone="info">{t('offers.awaiting.status')}</Badge>
              <span className="text-xs text-slate-400">
                {t('offers.awaiting.movedOn', { date: formatDate(a.movedToOfferAt, locale) })}
              </span>
            </div>
            <Can permission="jobOffer.create">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => draftFor(a)}
              >
                {t('offers.awaiting.newOffer')}
              </Button>
            </Can>
          </div>
        ))}
      </CardBody>
    </Card>
  );
};

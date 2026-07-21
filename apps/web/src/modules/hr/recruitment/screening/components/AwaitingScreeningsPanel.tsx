// "Awaiting screening" — the pipeline entry into Screening. Live applicants who registered but
// have no screening yet surface here automatically (derived server-side; no screening record is
// fabricated, so the manual open-screening workflow + permissions stay intact). Each row opens a
// screening via the existing dialog. Hidden when empty. Permission-gated (screening.view to read;
// screening.create to open).
import { type AwaitingScreeningDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate } from '../../../../../shared/lib/format';
import { useAwaitingScreenings } from '../api/screening-queries';
import { type PickedApplicant } from './CreateScreeningDialog';

export const AwaitingScreeningsPanel = ({
  onOpen,
}: {
  onOpen: (applicant: PickedApplicant) => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: awaiting = [] } = useAwaitingScreenings();

  if (awaiting.length === 0) return null;

  const openFor = (a: AwaitingScreeningDto): PickedApplicant => ({
    id: a.applicantId,
    code: a.applicantCode,
    fullNameAr: a.fullNameAr,
  });

  return (
    <Card>
      <CardHeader
        title={t('screening.awaiting.title')}
        description={t('screening.awaiting.subtitle')}
      />
      <CardBody className="space-y-2">
        {awaiting.map((a) => (
          <div
            key={a.applicantId}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-mono text-xs text-slate-500" dir="ltr">{a.applicantCode}</span>
              <span className="truncate text-sm text-slate-700 dark:text-slate-200">{a.fullNameAr}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {t('screening.awaiting.registeredOn', { date: formatDate(a.registeredAt, locale) })}
              </span>
            </div>
            <Can permission="screening.create">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => onOpen(openFor(a))}
              >
                {t('screening.awaiting.open')}
              </Button>
            </Can>
          </div>
        ))}
      </CardBody>
    </Card>
  );
};

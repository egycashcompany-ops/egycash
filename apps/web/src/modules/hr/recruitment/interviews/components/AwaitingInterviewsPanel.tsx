// "Awaiting scheduling" — the pipeline entry into Interviews. Applicants who passed Initial
// Screening and are still active but have no interview yet surface here automatically (derived
// server-side; no fabricated interview record). Each row schedules the first round via the shared
// dialog. Hidden when empty so it never clutters the queue. Permission-gated (interview.view to
// read; interview.create to schedule).
import { type AwaitingInterviewDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate } from '../../../../../shared/lib/format';
import { useAwaitingInterviews } from '../api/interview-queries';
import { type PickedApplicant } from './ScheduleInterviewDialog';

export const AwaitingInterviewsPanel = ({
  branchId,
  onSchedule,
}: {
  branchId?: string | undefined;
  onSchedule: (applicant: PickedApplicant) => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: awaiting = [] } = useAwaitingInterviews(
    branchId === undefined || branchId === '' ? {} : { branchId },
  );

  if (awaiting.length === 0) return null;

  const scheduleFor = (a: AwaitingInterviewDto): PickedApplicant => ({
    id: a.applicantId,
    code: a.applicantCode,
    fullNameAr: '',
  });

  return (
    <Card>
      <CardHeader
        title={t('interviews.awaiting.title')}
        description={t('interviews.awaiting.subtitle')}
      />
      <CardBody className="space-y-2">
        {awaiting.map((a) => (
          <div
            key={a.applicantId}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-mono text-xs text-slate-500" dir="ltr">{a.applicantCode}</span>
              {a.screeningDecidedAt !== null && (
                <span className="text-xs text-slate-400">
                  {t('interviews.awaiting.approvedOn', { date: formatDate(a.screeningDecidedAt, locale) })}
                </span>
              )}
            </div>
            <Can permission="interview.create">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => onSchedule(scheduleFor(a))}
              >
                {t('interviews.actions.schedule')}
              </Button>
            </Can>
          </div>
        ))}
      </CardBody>
    </Card>
  );
};

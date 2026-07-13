// The interview panel: each assigned interviewer with their evaluation state, recommendation,
// rating and notes. A pending member can be skipped (interview.edit) so a decision is no longer
// blocked on a no-show. Presentation only — the skip action is delegated to the caller.
import { type InterviewPanelistDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../../shared/ui/Badge';
import { Button } from '../../../../../shared/ui/Button';
import { UserName } from './UserName';

const STATE_TONE: Record<InterviewPanelistDto['state'], Tone> = {
  pending: 'warning',
  submitted: 'success',
  skipped: 'neutral',
};

const REC_TONE: Record<NonNullable<InterviewPanelistDto['recommendation']>, Tone> = {
  recommend: 'success',
  neutral: 'info',
  notRecommend: 'danger',
};

export const PanelList = ({
  panel,
  canSkip,
  onSkip,
}: {
  panel: InterviewPanelistDto[];
  canSkip: boolean;
  onSkip: (interviewerId: string) => void;
}): JSX.Element => {
  const t = useT();

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {panel.map((p) => (
        <li key={p.interviewerId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <UserName id={p.interviewerId} className="text-sm font-medium text-slate-800 dark:text-slate-100" />
              <Badge tone={STATE_TONE[p.state]}>{t(`interviews.evalState.${p.state}`)}</Badge>
              {p.recommendation !== null && (
                <Badge tone={REC_TONE[p.recommendation]}>{t(`interviews.recommendation.${p.recommendation}`)}</Badge>
              )}
              {p.rating !== null && (
                <span className="text-xs text-slate-400">{t('interviews.evaluate.rating')}: {p.rating}/5</span>
              )}
            </div>
            {p.notes !== null && p.notes !== '' && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{p.notes}</p>
            )}
          </div>
          {canSkip && p.state === 'pending' && (
            <Button size="sm" variant="ghost" onClick={() => onSkip(p.interviewerId)}>
              {t('interviews.panel.skip')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};

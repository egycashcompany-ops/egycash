// One person's goals for one round — set them, move them, close them (P-HR-PRF D9).
//
// A DIALOG OFF THE REVIEW ROW rather than a screen of its own, because a goal is only ever worked
// in the context of the person it belongs to: a company-wide goals list answers no question anybody
// asks («whose? which round?» is the first click every time), while the review row already answers
// both. The house DataTable has no row expansion, and building one for this would be new UI
// machinery for one caller.
//
// WHAT IS NOT HERE, on purpose: no progress bar, no percentage, no «3 of 5 achieved» summary. The
// two numbers sit side by side and the reader does the arithmetic they are qualified to do —
// a computed percentage is a rating wearing a different unit (D9), and the absence spec forbids it
// by name on the API side.
import { useState } from 'react';
import {
  type ClosedGoalStatus,
  type PerformanceGoalDto,
  type PerformanceGoalStatus,
  type PerformanceReviewDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { StatusBadge, type Tone } from '../../../../shared/ui/Badge';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import {
  useClosePerformanceGoal,
  useCreatePerformanceGoal,
  usePerformanceGoals,
  useProgressPerformanceGoal,
} from '../api/performance-queries';

const STATUS_TONE: Record<PerformanceGoalStatus, Tone> = {
  active: 'info',
  achieved: 'success',
  missed: 'danger',
  dropped: 'neutral',
};

/** Enough for one person's round — a review with more goals than this has a different problem. */
const GOALS_PAGE_SIZE = 50;

const NewGoalForm = ({
  reviewId,
  onDone,
}: {
  reviewId: string;
  onDone: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreatePerformanceGoal();
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');

  const submit = async (): Promise<void> => {
    if (title.trim().length < 3) return;
    try {
      await create.mutateAsync({
        reviewId,
        title: title.trim(),
        ...(target === '' ? {} : { targetValue: Number(target) }),
        ...(unit.trim() === '' ? {} : { unit: unit.trim() }),
      });
      toast.success(t('performance.goal.created'));
      onDone();
    } catch {
      // surfaced globally
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <Field label={t('performance.goal.titleField')} required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
      </Field>
      <div className="flex gap-3">
        {/* Optional on purpose: plenty of real goals are not numeric, and a required number would
            push people into inventing one — which then looks like a measurement. */}
        <Field label={t('performance.goal.target')}>
          <Input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('performance.goal.unit')}>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          loading={create.isPending}
          disabled={title.trim().length < 3}
          onClick={() => void submit()}
        >
          {t('performance.goal.add')}
        </Button>
      </div>
    </div>
  );
};

const GoalRow = ({ goal }: { goal: PerformanceGoalDto }): JSX.Element => {
  const t = useT();
  const progress = useProgressPerformanceGoal();
  const close = useClosePerformanceGoal();
  const [progressing, setProgressing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<ClosedGoalStatus>('achieved');

  const submitProgress = async (): Promise<void> => {
    try {
      await progress.mutateAsync({
        id: goal.id,
        body: {
          ...(value === '' ? {} : { currentValue: Number(value) }),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          version: goal.version,
        },
      });
      toast.success(t('performance.goal.progressed'));
      setProgressing(false);
      setValue('');
      setNote('');
    } catch {
      // surfaced globally
    }
  };

  const submitClose = async (): Promise<void> => {
    try {
      await close.mutateAsync({
        id: goal.id,
        body: {
          status: outcome,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          version: goal.version,
        },
      });
      toast.success(t('performance.goal.closedToast'));
      setClosing(false);
      setNote('');
    } catch {
      // surfaced globally — including «has to say why», which is the point of the rule
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
            {goal.title}
          </span>
          {/* The two numbers, SIDE BY SIDE and nothing between them (D9). */}
          {goal.targetValue !== null && (
            <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300" dir="ltr">
              {`${goal.currentValue ?? '—'} / ${goal.targetValue}${goal.unit === null ? '' : ` ${goal.unit}`}`}
            </span>
          )}
          {goal.lastNote !== null && (
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              {goal.lastNote}
            </span>
          )}
        </div>
        <StatusBadge
          tone={STATUS_TONE[goal.status]}
          label={t(`performance.goal.status.${goal.status}`)}
        />
      </div>

      {goal.status === 'active' && (
        <Can permission="performanceGoal.manage">
          <div className="mt-2 space-y-2">
            {!progressing && !closing && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setProgressing(true)}>
                  {t('performance.goal.progress')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setClosing(true)}>
                  {t('performance.goal.close')}
                </Button>
              </div>
            )}
            {progressing && (
              <div className="space-y-2">
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={t('performance.goal.current')}
                  dir="ltr"
                />
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('performance.goal.notePlaceholder')}
                  rows={2}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setProgressing(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={progress.isPending}
                    onClick={() => void submitProgress()}
                  >
                    {t('performance.goal.record')}
                  </Button>
                </div>
              </div>
            )}
            {closing && (
              <div className="space-y-2">
                {/* The outcome is CHOSEN, never suggested: no default computed from the numbers,
                    because reaching a target by luck and missing one because the work was
                    cancelled are both things only a person knows happened. */}
                <Select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as ClosedGoalStatus)}
                >
                  <option value="achieved">{t('performance.goal.status.achieved')}</option>
                  <option value="missed">{t('performance.goal.status.missed')}</option>
                  <option value="dropped">{t('performance.goal.status.dropped')}</option>
                </Select>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('performance.goal.whyPlaceholder')}
                  rows={2}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setClosing(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" loading={close.isPending} onClick={() => void submitClose()}>
                    {t('performance.goal.close')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Can>
      )}
    </li>
  );
};

export const GoalsDialog = ({
  review,
  onClose,
}: {
  review: PerformanceReviewDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = usePerformanceGoals({
    reviewId: review.id,
    page: 1,
    pageSize: GOALS_PAGE_SIZE,
  });
  const goals = data?.items ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('performance.goal.title')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {`${review.employeeName} · ${review.employeeCode}`}
      </p>

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {!isLoading && goals.length === 0 && !adding && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('performance.goal.none')}</p>
      )}

      <ul className="space-y-2">
        {goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} />
        ))}
      </ul>

      <div className="mt-3">
        {/* Goals are set while the review is a draft — the API refuses later, and the button
            agreeing with the server is what keeps the refusal from being the UI. */}
        {review.status === 'draft' && !adding && (
          <Can permission="performanceGoal.manage">
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              {t('performance.goal.add')}
            </Button>
          </Can>
        )}
        {adding && <NewGoalForm reviewId={review.id} onDone={() => setAdding(false)} />}
      </div>
    </Dialog>
  );
};

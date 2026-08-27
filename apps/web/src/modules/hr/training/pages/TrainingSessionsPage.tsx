// The deliveries (P-HR-TRN D2) — the screen that is somebody's daily work.
//
// THE TRANSITION BUTTONS ARE THE POINT. A session is scheduled, then it runs, then it is either
// completed or called off, and each of those is a decision with consequences: completing is what
// will qualify the people in the room (D7), and cancelling is what tells them not to come. So the
// screen offers exactly the transitions the state machine allows, and offers a REASON field for
// the one that needs it — the server refuses a reasonless cancellation, and this means the person
// finds out before they click rather than after.
//
// SEATS READ AS «—» UNTIL T3, and that is the truth rather than a placeholder: nothing can occupy
// a seat until the enrollment collection exists. A number that said «0 of 20» would imply we had
// counted.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type TrainingSessionDto, type TrainingSessionStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { SearchInput } from '../../../../shared/ui';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { formatDate } from '../../../../shared/lib/format';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { SessionStatusBadge } from '../components/SessionStatusBadge';
import {
  useActiveTrainingCourses,
  useCreateTrainingSession,
  useTrainingSessions,
  useTransitionTrainingSession,
} from '../api/training-queries';

const DEFAULT_PAGE_SIZE = 25;

/** Which transitions each status offers — the client half of `session-rules.ts`'s machine. */
const ACTIONS: Readonly<Record<TrainingSessionStatus, readonly ('start' | 'complete' | 'cancel')[]>> = {
  scheduled: ['start', 'cancel'],
  running: ['complete', 'cancel'],
  completed: [],
  cancelled: [],
};

const ScheduleDialog = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: courses = [] } = useActiveTrainingCourses();
  const create = useCreateTrainingSession();
  const [courseId, setCourseId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [capacity, setCapacity] = useState('');

  const complete = courseId !== '' && startsAt !== '' && endsAt !== '';

  const submit = async (): Promise<void> => {
    try {
      await create.mutateAsync({
        courseId,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        ...(location.trim() === '' ? {} : { location: location.trim() }),
        ...(trainerName.trim() === '' ? {} : { trainerName: trainerName.trim() }),
        ...(capacity.trim() === '' ? {} : { capacity: Number(capacity) }),
      });
      toast.success(t('training.session.scheduled'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('training.session.new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('training.session.schedule')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('training.session.course')} required>
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name[locale]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('training.session.startsAt')} required>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('training.session.endsAt')} required>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('training.session.location')}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label={t('training.session.trainer')}>
          <Input value={trainerName} onChange={(e) => setTrainerName(e.target.value)} />
        </Field>
        {/* Left empty means unlimited (D5), which is why the hint says so rather than defaulting to a number. */}
        <Field label={t('training.session.capacity')} hint={t('training.session.capacityHint')}>
          <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} dir="ltr" />
        </Field>
      </div>
    </Dialog>
  );
};

/** Cancelling asks why; starting and completing do not. */
const TransitionDialog = ({
  session,
  action,
  onClose,
}: {
  session: TrainingSessionDto;
  action: 'start' | 'complete' | 'cancel';
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const transition = useTransitionTrainingSession();
  const [reason, setReason] = useState('');
  const needsReason = action === 'cancel';

  const submit = async (): Promise<void> => {
    try {
      await transition.mutateAsync({
        id: session.id,
        body: {
          action,
          ...(needsReason ? { reason: reason.trim() } : {}),
          version: session.version,
        },
      });
      toast.success(t(`training.session.done.${action}`));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(`training.session.action.${action}`)}
      description={t(`training.session.confirm.${action}`)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={action === 'cancel' ? 'danger' : 'primary'}
            loading={transition.isPending}
            disabled={needsReason && reason.trim() === ''}
            onClick={() => void submit()}
          >
            {t(`training.session.action.${action}`)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {`${session.code} · ${session.courseKey}`}
      </p>
      {needsReason && (
        <Field label={t('training.session.cancelReason')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </Dialog>
  );
};

export const TrainingSessionsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const [scheduling, setScheduling] = useState(false);
  const [acting, setActing] = useState<{
    session: TrainingSessionDto;
    action: 'start' | 'complete' | 'cancel';
  } | null>(null);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const params = {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    ...(search === '' ? {} : { search }),
    ...(status === '' ? {} : { status }),
  };
  const { data, isLoading, isError, error, refetch } = useTrainingSessions(params);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<TrainingSessionDto>[] = [
    {
      key: 'code',
      header: t('training.session.code'),
      render: (s) => (
        <span className="font-mono text-xs" dir="ltr">
          {s.code}
        </span>
      ),
    },
    {
      key: 'course',
      header: t('training.session.course'),
      render: (s) => <span>{s.courseName[locale]}</span>,
    },
    {
      key: 'when',
      header: t('training.session.when'),
      render: (s) => <span>{formatDate(s.startsAt, locale)}</span>,
    },
    {
      key: 'where',
      header: t('training.session.location'),
      render: (s) => <span>{s.location ?? '—'}</span>,
    },
    {
      key: 'seats',
      header: t('training.session.seats'),
      align: 'end',
      // «—» while nothing can hold a seat (T3). Not «0 of 20», which would imply we had counted.
      render: (s) => (s.capacity === null ? '—' : `${String(s.enrolledCount)} / ${String(s.capacity)}`),
    },
    {
      key: 'status',
      header: t('training.statusColumn'),
      render: (s) => <SessionStatusBadge status={s.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <Can permission="trainingSession.conduct">
          <div className="flex items-center gap-2">
            {ACTIONS[s.status].map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === 'cancel' ? 'danger' : 'secondary'}
                onClick={() => setActing({ session: s, action })}
              >
                {t(`training.session.action.${action}`)}
              </Button>
            ))}
          </div>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('training.session.title')}
        description={t('training.session.subtitle')}
        breadcrumbs={[{ label: t('training.title') }, { label: t('training.session.title') }]}
        actions={
          <Can permission="trainingSession.create">
            <Button onClick={() => setScheduling(true)}>{t('training.session.new')}</Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value === '' ? null : value, page: null })}
            placeholder={t('training.session.searchPlaceholder')}
          />
          <Select
            value={status}
            onChange={(e) => patch({ status: e.target.value === '' ? null : e.target.value, page: null })}
            className="w-full sm:w-48"
          >
            <option value="">{t('training.session.allStatuses')}</option>
            {(['scheduled', 'running', 'completed', 'cancelled'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`training.session.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(s) => s.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
        )}
      </div>

      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} />}
      {acting !== null && (
        <TransitionDialog
          session={acting.session}
          action={acting.action}
          onClose={() => setActing(null)}
        />
      )}
    </PageContainer>
  );
};

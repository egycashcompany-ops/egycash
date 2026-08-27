// The training catalogue (P-HR-TRN D1) — configuration, administered.
//
// A SMALL SCREEN ON PURPOSE. A course carries no price, no required-by-job-title flag and no
// compliance rule (D12, D13), so there is very little here to edit: a name, a description, roughly
// how long it takes, and whether we still teach it. That smallness is the design working, not a
// screen somebody left half-built.
//
// RETIRING IS NOT DELETING. The historical records name this course, so the only way out of the
// catalogue is `active: false` — and the server refuses even that while sessions are scheduled,
// because a room booked to teach something we no longer teach is a promise to the people in it.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type TrainingCourseDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Badge, SearchInput } from '../../../../shared/ui';
import { Field, Input, Textarea } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useCreateTrainingCourse, useTrainingCourses, useUpdateTrainingCourse } from '../api/training-queries';

const DEFAULT_PAGE_SIZE = 25;

/** The editor, for a new course or an existing one. Empty strings mean «not stated». */
const CourseDialog = ({
  course,
  onClose,
}: {
  course: TrainingCourseDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateTrainingCourse();
  const update = useUpdateTrainingCourse();
  const [key, setKey] = useState(course?.key ?? '');
  const [ar, setAr] = useState(course?.name.ar ?? '');
  const [en, setEn] = useState(course?.name.en ?? '');
  const [descriptionAr, setDescriptionAr] = useState(course?.description?.ar ?? '');
  const [descriptionEn, setDescriptionEn] = useState(course?.description?.en ?? '');
  const [hours, setHours] = useState(
    course?.defaultDurationHours === null || course?.defaultDurationHours === undefined
      ? ''
      : String(course.defaultDurationHours),
  );

  const isNew = course === null;
  const pending = create.isPending || update.isPending;
  // Both languages, because a catalogue half-translated is a screen that reads as broken to
  // whichever half of the company opens it in the other language.
  const complete = ar.trim() !== '' && en.trim() !== '' && (!isNew || /^[a-z]/.test(key));

  const submit = async (): Promise<void> => {
    const description =
      descriptionAr.trim() === '' && descriptionEn.trim() === ''
        ? undefined
        : { ar: descriptionAr.trim(), en: descriptionEn.trim() };
    const duration = hours.trim() === '' ? null : Number(hours);
    try {
      if (isNew) {
        await create.mutateAsync({
          key: key.trim(),
          name: { ar: ar.trim(), en: en.trim() },
          ...(description === undefined ? {} : { description }),
          ...(duration === null ? {} : { defaultDurationHours: duration }),
          defaultDeliveryMode: 'classroom',
          order: 0,
        });
      } else {
        await update.mutateAsync({
          id: course.id,
          body: {
            name: { ar: ar.trim(), en: en.trim() },
            ...(description === undefined ? {} : { description }),
            defaultDurationHours: duration,
            version: course.version,
          },
        });
      }
      toast.success(t('training.saved'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t('training.course.new') : t('training.course.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isNew && (
          <Field label={t('training.course.key')} required hint={t('training.course.keyHint')}>
            <Input value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" />
          </Field>
        )}
        <Field label={t('training.course.nameAr')} required>
          <Input value={ar} onChange={(e) => setAr(e.target.value)} />
        </Field>
        <Field label={t('training.course.nameEn')} required>
          <Input value={en} onChange={(e) => setEn(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('training.course.descriptionAr')}>
          <Textarea rows={2} value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} />
        </Field>
        <Field label={t('training.course.descriptionEn')}>
          <Textarea rows={2} value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('training.course.hours')} hint={t('training.course.hoursHint')}>
          <Input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} dir="ltr" />
        </Field>
      </div>
    </Dialog>
  );
};

export const TrainingCoursesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const update = useUpdateTrainingCourse();
  const [editing, setEditing] = useState<TrainingCourseDto | null | undefined>(undefined);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const params = { page, pageSize: DEFAULT_PAGE_SIZE, ...(search === '' ? {} : { search }) };
  const { data, isLoading, isError, error, refetch } = useTrainingCourses(params);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const toggleActive = async (course: TrainingCourseDto): Promise<void> => {
    try {
      await update.mutateAsync({
        id: course.id,
        body: { active: !course.active, version: course.version },
      });
      toast.success(t('training.saved'));
    } catch {
      // surfaced globally — including the refusal to retire a course with live sessions
    }
  };

  const columns: Column<TrainingCourseDto>[] = [
    {
      key: 'key',
      header: t('training.course.key'),
      render: (c) => (
        <span className="font-mono text-xs" dir="ltr">
          {c.key}
        </span>
      ),
    },
    { key: 'name', header: t('training.course.name'), render: (c) => <span>{c.name[locale]}</span> },
    {
      key: 'hours',
      header: t('training.course.hours'),
      align: 'end',
      render: (c) => (c.defaultDurationHours === null ? '—' : String(c.defaultDurationHours)),
    },
    {
      key: 'active',
      header: t('training.statusColumn'),
      render: (c) => (
        <Badge tone={c.active ? 'success' : 'neutral'}>
          {t(c.active ? 'training.course.active' : 'training.course.retired')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <Can permission="trainingCourse.manage">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void toggleActive(c)}>
              {t(c.active ? 'training.course.retire' : 'training.course.restore')}
            </Button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('training.course.title')}
        description={t('training.course.subtitle')}
        breadcrumbs={[{ label: t('training.title') }, { label: t('training.course.title') }]}
        actions={
          <Can permission="trainingCourse.manage">
            <Button onClick={() => setEditing(null)}>{t('training.course.new')}</Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <SearchInput
          value={search}
          onChange={(value) => patch({ q: value === '' ? null : value, page: null })}
          placeholder={t('training.course.searchPlaceholder')}
        />
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(c) => c.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
        )}
      </div>

      {editing !== undefined && (
        <CourseDialog course={editing} onClose={() => setEditing(undefined)} />
      )}
    </PageContainer>
  );
};
